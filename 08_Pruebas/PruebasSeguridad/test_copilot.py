"""
Pruebas del COPILOTO de campañas (Api_V1_Assistant_Copilot). Ver PLAN_COPILOTO.md.
- Analizador DETERMINISTA (spam/entregabilidad + Habeas Data + hora óptima): sin IA.
- draft/rewrite con Bedrock STUBEADO (cliente falso).
"""
import os
import json
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')

import pytest  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDA = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Assistant_Copilot' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('copilot_mod', str(LAMBDA))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def mod():
    return _load()


class FakeBedrock:
    def __init__(self, text):
        self.text = text
        self.last = None

    def converse(self, **kwargs):
        self.last = kwargs
        return {'output': {'message': {'content': [{'text': self.text}]}}}


# ---------------------------- Analizador determinista ----------------------------
def test_mensaje_limpio_score_alto(mod):
    score, level, issues, _ = mod.analyze_content(
        'Tu resumen mensual de MailConnect',
        'Hola, te compartimos el resumen de tu cuenta. Si no deseas más correos, puedes darte de baja.',
        'EM')
    assert score >= 80 and level == 'ok'


def test_mensaje_spam_score_bajo(mod):
    score, level, issues, suggestions = mod.analyze_content(
        'GANASTE UN PREMIO GRATIS!!!',
        'URGENTE!!! COMPRA YA con 100% gratis y sin costo. Dinero facil GARANTIZADO!!!',
        'EM')
    assert score < 55 and level == 'critical'
    kinds = {i['type'] for i in issues}
    assert 'spam-words' in kinds and 'caps' in kinds and 'exclamations' in kinds
    assert suggestions  # da recomendaciones


def test_email_sin_asunto_penaliza(mod):
    _, _, issues, _ = mod.analyze_content('', 'Cuerpo suficientemente largo para no penalizar por corto.', 'EM')
    assert any(i['type'] == 'subject' and i['severity'] == 'critical' for i in issues)


def test_habeas_data_completo_ok(mod):
    hd = mod.check_habeas_data(
        'Novedades', 'Somos ACME SAS. Recibes este correo porque te suscribiste. '
        'Puedes darte de baja cuando quieras.', company='ACME SAS')
    assert hd['ok'] is True and hd['requiredMissing'] == []


def test_habeas_data_falta_optout(mod):
    hd = mod.check_habeas_data('Novedades', 'Somos ACME SAS y te contactamos por tu compra reciente.', company='ACME SAS')
    assert hd['ok'] is False
    assert any('exclusión' in m for m in hd['requiredMissing'])


def test_habeas_data_detecta_unsubscribe_token(mod):
    hd = mod.check_habeas_data('x', 'Somos ACME. Recibes este correo porque eres cliente. {{unsubscribeUrl}}', company='ACME')
    assert hd['ok'] is True  # el token de desuscripción cuenta como opt-out


@pytest.mark.parametrize('channel,audience,needle', [
    ('EM', 'b2b', 'Martes'),
    ('SMS', 'b2c', 'Tardes'),
    ('WSP', 'b2b', 'Días hábiles'),
    ('VOZ', 'b2c', 'Tardes'),
])
def test_hora_optima(mod, channel, audience, needle):
    st = mod.suggest_send_time(channel, audience)
    assert needle in st['suggestion'] and st['rationale']


def test_do_analyze_integra_todo(mod):
    data = mod.do_analyze({'channel': 'EM', 'subject': 'Hola', 'body': 'Somos ACME. Recibes esto porque te suscribiste. Baja: ...', 'company': 'ACME', 'audience': 'b2b'})
    assert 'score' in data and 'habeasData' in data and 'sendTime' in data


# ---------------------------- IA (Bedrock stub) ----------------------------
def test_draft_parsea_asuntos_y_cuerpo(mod):
    mod._client = FakeBedrock('ASUNTOS:\n- Opción A\n- Opción B\n- Opción C\n\nCUERPO:\nHola, este es el cuerpo del correo.')
    resp = mod.lambda_handler({'action': 'draft', 'objective': 'promocionar el nuevo plan', 'channel': 'EM'}, None)
    assert resp['statusCode'] == 200
    assert resp['data']['subjects'] == ['Opción A', 'Opción B', 'Opción C']
    assert resp['data']['body'] == 'Hola, este es el cuerpo del correo.'


def test_draft_sin_objetivo_400(mod):
    mod._client = FakeBedrock('x')
    resp = mod.lambda_handler({'action': 'draft', 'channel': 'EM'}, None)
    assert resp['statusCode'] == 400


def test_rewrite_devuelve_texto(mod):
    mod._client = FakeBedrock('Texto mejorado y más claro.')
    resp = mod.lambda_handler({'action': 'rewrite', 'text': 'texto original', 'channel': 'SMS', 'goal': 'más corto'}, None)
    assert resp['statusCode'] == 200 and resp['data']['text'] == 'Texto mejorado y más claro.'


def test_analyze_por_handler(mod):
    resp = mod.lambda_handler({'action': 'analyze', 'channel': 'SMS', 'body': 'Hola {{Nombre}}, recuerda tu cita. Responde BAJA para no recibir más.'}, None)
    assert resp['statusCode'] == 200 and resp['data']['sendTime']


def test_accion_invalida_400(mod):
    assert mod.lambda_handler({'action': 'nope'}, None)['statusCode'] == 400
