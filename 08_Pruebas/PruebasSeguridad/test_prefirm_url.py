"""
Pruebas de Api_V1_Campaign_Prefirm-url con el bucket ÚNICO por cliente:
- bucket = mailconnect-{nit}
- la key lleva el PREFIJO del tipo: {tipo}/{fecha}/{nombre}
- tipos válidos: database | document | resources | attachment
"""
import os
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Campaign_Prefirm-url' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('presign_mod', str(PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def mod():
    with mock_aws():
        yield _load()


def _event(doc_type, name='archivo.csv', nit='900.123-4'):
    return {'documentName': name, 'documentType': doc_type,
            'requestContext': {'authorizer': {'nit': nit, 'customer': 'ACME'}}}


def test_bucket_unico(mod):
    resp = mod.lambda_handler(_event('database'), None)
    # tenant_bucket ignora el tipo: bucket único mailconnect-{nit saneado}.
    assert mod.tenant_bucket('900.123-4') == 'mailconnect-9001234'
    assert resp['statusCode'] == 200


@pytest.mark.parametrize('doc_type', ['database', 'document', 'resources', 'attachment'])
def test_key_lleva_prefijo(mod, doc_type):
    resp = mod.lambda_handler(_event(doc_type, name='foto.png'), None)
    assert resp['statusCode'] == 200
    path = resp['data']['path']
    assert path.startswith(doc_type + '/')     # prefijo del tipo
    assert path.endswith('/foto.png')          # {tipo}/{fecha}/{nombre}


def test_tipo_invalido_400(mod):
    resp = mod.lambda_handler(_event('otro'), None)
    assert resp['statusCode'] == 400


def test_sin_identidad_403(mod):
    resp = mod.lambda_handler({'documentName': 'x.csv', 'documentType': 'database',
                               'requestContext': {'authorizer': {}}}, None)
    assert resp['statusCode'] == 403
