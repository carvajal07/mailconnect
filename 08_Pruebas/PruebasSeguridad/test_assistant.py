"""
Pruebas del asistente de IA (Api_V1_Assistant_Ask). No toca AWS: se inyecta un cliente
Bedrock falso (el módulo usa un cliente perezoso `_client`, que aquí se reemplaza).
"""
import os
import json
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')

import pytest  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDA = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Assistant_Ask' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('assistant_mod', str(LAMBDA))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class FakeBedrock:
    """Cliente Bedrock falso. Registra el último request y devuelve una respuesta fija
    (o lanza si raise_exc=True) para ejercitar el manejo de errores."""
    def __init__(self, answer='Respuesta del asistente.', raise_exc=False):
        self.answer = answer
        self.raise_exc = raise_exc
        self.last_kwargs = None

    def converse(self, **kwargs):
        self.last_kwargs = kwargs
        if self.raise_exc:
            raise RuntimeError('modelo no disponible')
        return {'output': {'message': {'content': [{'text': self.answer}]}}}


@pytest.fixture
def mod():
    return _load()


def _event(question, method='POST'):
    return {'httpMethod': method, 'body': json.dumps({'question': question})}


def test_pregunta_valida_devuelve_respuesta(mod):
    fake = FakeBedrock(answer='MailConnect envía correo, SMS, WhatsApp y voz.')
    mod._client = fake
    resp = mod.lambda_handler(_event('¿Qué es MailConnect?'), None)
    assert resp['statusCode'] == 200
    body = json.loads(resp['body'])
    assert body['answer'] == 'MailConnect envía correo, SMS, WhatsApp y voz.'
    # El system prompt se envía y menciona MailConnect (aterrizaje del modelo).
    assert 'MailConnect' in fake.last_kwargs['system'][0]['text']
    assert fake.last_kwargs['messages'][0]['content'][0]['text'] == '¿Qué es MailConnect?'
    # CORS presente (endpoint público llamado desde el navegador).
    assert resp['headers']['Access-Control-Allow-Origin'] == '*'


def test_pregunta_vacia_400(mod):
    mod._client = FakeBedrock()
    resp = mod.lambda_handler(_event('   '), None)
    assert resp['statusCode'] == 400
    assert 'pregunta' in json.loads(resp['body'])['error'].lower()


def test_preflight_options_200(mod):
    mod._client = FakeBedrock()
    resp = mod.lambda_handler({'httpMethod': 'OPTIONS'}, None)
    assert resp['statusCode'] == 200
    assert resp['headers']['Access-Control-Allow-Methods'] == 'POST,OPTIONS'


def test_error_del_modelo_502(mod):
    mod._client = FakeBedrock(raise_exc=True)
    resp = mod.lambda_handler(_event('¿Cuánto cuesta?'), None)
    assert resp['statusCode'] == 502
    # Mensaje amable + fallback a WhatsApp.
    assert 'WhatsApp' in json.loads(resp['body'])['error']


def test_pregunta_larga_se_acota(mod):
    fake = FakeBedrock()
    mod._client = fake
    long_q = 'a' * 5000
    resp = mod.lambda_handler(_event(long_q), None)
    assert resp['statusCode'] == 200
    # No se manda al modelo más de MAX_QUESTION_CHARS (1000).
    assert len(fake.last_kwargs['messages'][0]['content'][0]['text']) == mod.MAX_QUESTION_CHARS


def test_body_como_dict_directo(mod):
    # Integración directa (no-proxy): el evento ES el payload, sin 'body' string.
    fake = FakeBedrock(answer='ok')
    mod._client = fake
    resp = mod.lambda_handler({'question': 'hola'}, None)
    assert resp['statusCode'] == 200
    assert json.loads(resp['body'])['answer'] == 'ok'
