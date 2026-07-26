"""
Pruebas del LÍMITE DE USO de los chatbots (Bloque E — protección de costo/abuso):
- Api_V1_Assistant_Ask (endpoint PÚBLICO): ventanas por IP (minuto/día) + tope GLOBAL
  diario, 429 al exceder, fail-open sin tabla (primer uso) y creación on-demand.
- Api_V1_Assistant_Copilot (portal): ventanas por TENANT solo en draft/rewrite (las
  acciones que invocan Bedrock); analyze es determinista y no se limita.
DynamoDB con moto; Bedrock con un cliente falso.
"""
import os
import json
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder, name):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(name, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class FakeBedrock:
    def __init__(self):
        self.calls = 0

    def converse(self, **kwargs):
        self.calls += 1
        return {'output': {'message': {'content': [{'text': 'ok'}]}}}


# ───────────────────────── Assistant_Ask (público, por IP) ─────────────────────────

def _ask_event(question='hola', ip='1.2.3.4'):
    return {'httpMethod': 'POST', 'body': json.dumps({'question': question}),
            'requestContext': {'identity': {'sourceIp': ip}}}


@pytest.fixture
def ask():
    with mock_aws():
        m = _load('Api_V1_Assistant_Ask', 'ask_rl')
        m._client = FakeBedrock()
        m._ensure_rate_table()   # tabla lista → contadores deterministas
        yield m


def test_ask_limite_por_minuto_429(ask, monkeypatch):
    monkeypatch.setattr(ask, 'RATE_PER_MINUTE', 2)
    assert ask.lambda_handler(_ask_event(), None)['statusCode'] == 200
    assert ask.lambda_handler(_ask_event(), None)['statusCode'] == 200
    resp = ask.lambda_handler(_ask_event(), None)
    assert resp['statusCode'] == 429
    body = json.loads(resp['body'])
    assert 'consultas' in body['error'].lower()
    # CORS también en el 429 (el widget lo lee desde el navegador).
    assert resp['headers']['Access-Control-Allow-Origin'] == '*'
    # El modelo NO se invocó en la petición limitada (ahí está el costo).
    assert ask._client.calls == 2


def test_ask_ips_independientes(ask, monkeypatch):
    monkeypatch.setattr(ask, 'RATE_PER_MINUTE', 1)
    assert ask.lambda_handler(_ask_event(ip='10.0.0.1'), None)['statusCode'] == 200
    assert ask.lambda_handler(_ask_event(ip='10.0.0.1'), None)['statusCode'] == 429
    # Otra IP tiene su propio contador.
    assert ask.lambda_handler(_ask_event(ip='10.0.0.2'), None)['statusCode'] == 200


def test_ask_tope_global_diario(ask, monkeypatch):
    # El tope GLOBAL acota el costo total aunque el atacante rote IPs.
    monkeypatch.setattr(ask, 'RATE_PER_MINUTE', 100)
    monkeypatch.setattr(ask, 'RATE_PER_DAY', 100)
    monkeypatch.setattr(ask, 'RATE_GLOBAL_PER_DAY', 2)
    assert ask.lambda_handler(_ask_event(ip='10.1.1.1'), None)['statusCode'] == 200
    assert ask.lambda_handler(_ask_event(ip='10.2.2.2'), None)['statusCode'] == 200
    assert ask.lambda_handler(_ask_event(ip='10.3.3.3'), None)['statusCode'] == 429


def test_ask_fail_open_sin_tabla():
    # Sin la tabla del limitador (primer despliegue) la petición PASA (fail-open)
    # y la tabla se crea on-demand para las siguientes.
    with mock_aws():
        m = _load('Api_V1_Assistant_Ask', 'ask_rl_open')
        m._client = FakeBedrock()
        resp = m.lambda_handler(_ask_event(), None)
        assert resp['statusCode'] == 200
        assert m._client.calls == 1
        import boto3
        tables = boto3.client('dynamodb', region_name='us-east-1').list_tables()['TableNames']
        assert m.RATE_TABLE in tables


# ──────────────────────── Assistant_Copilot (portal, por tenant) ────────────────────────

def _cop_event(action, customer_id='CU1', **extra):
    return {'action': action,
            'requestContext': {'authorizer': {'customerId': customer_id}}, **extra}


@pytest.fixture
def cop():
    with mock_aws():
        m = _load('Api_V1_Assistant_Copilot', 'cop_rl')
        m._client = FakeBedrock()
        m._ensure_rate_table()
        yield m


def test_copilot_draft_limitado_por_tenant(cop, monkeypatch):
    monkeypatch.setattr(cop, 'RATE_PER_MINUTE', 1)
    ok = cop.lambda_handler(_cop_event('draft', objective='Promocionar', channel='EM'), None)
    assert ok['statusCode'] == 200
    limited = cop.lambda_handler(_cop_event('draft', objective='Promocionar', channel='EM'), None)
    assert limited['statusCode'] == 429 and limited['status'] is False
    # Otro tenant no comparte el contador.
    other = cop.lambda_handler(
        _cop_event('draft', customer_id='CU2', objective='Promocionar', channel='EM'), None)
    assert other['statusCode'] == 200


def test_copilot_analyze_no_se_limita(cop, monkeypatch):
    # analyze es determinista (sin Bedrock) → nunca pasa por el limitador.
    monkeypatch.setattr(cop, 'RATE_PER_MINUTE', 0)
    for _ in range(3):
        resp = cop.lambda_handler(
            _cop_event('analyze', channel='EM', subject='Hola', body='Cuerpo del correo'), None)
        assert resp['statusCode'] == 200
    assert cop._client.calls == 0
