"""
Pruebas de la HIGIENE DE LISTAS (Api_V1_Database_Verify, Bloque E): verificación
previa de una base — sintaxis, duplicados, dominios desechables, cuentas de rol y
dominios no resolubles (DNS falso controlado) — con reporte, score y persistencia
del resumen. DynamoDB y S3 con moto.
"""
import os
import json
import socket
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDA = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Database_Verify' / 'lambda_function.py'

# Dominios que "existen" en el DNS falso de estas pruebas.
RESOLVABLE = {'gmail.com', 'empresa.com', 'acme.co'}


def _load():
    spec = importlib.util.spec_from_file_location('db_verify', str(LAMBDA))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    # DNS controlado: sin dnspython y con getaddrinfo falso (sin red).
    m._dns_resolver = None

    def fake_getaddrinfo(host, *a, **kw):
        if host in RESOLVABLE:
            return [(2, 1, 6, '', ('1.2.3.4', 0))]
        raise socket.gaierror('NXDOMAIN')

    m.socket = type('S', (), {'getaddrinfo': staticmethod(fake_getaddrinfo),
                              'gaierror': socket.gaierror})
    return m


def _event(file_id, customer_id='CU1', customer='Acme', nit='900'):
    return {'databaseFileId': file_id,
            'requestContext': {'authorizer': {'customerId': customer_id,
                                              'customer': customer, 'nit': nit}}}


def _setup(csv_text, channel='EMAIL', file_id='F1'):
    ddb = boto3.client('dynamodb', region_name='us-east-1')
    ddb.create_table(TableName='databaseFile',
                     KeySchema=[{'AttributeName': 'databaseFileId', 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': 'databaseFileId', 'AttributeType': 'S'}],
                     BillingMode='PAY_PER_REQUEST')
    boto3.resource('dynamodb', region_name='us-east-1').Table('databaseFile').put_item(
        Item={'databaseFileId': file_id, 'customerId': 'CU1', 'customer': 'Acme',
              'fileName': 'base.csv', 's3Path': 'database/2026/base.csv', 'channel': channel})
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.create_bucket(Bucket='mailconnect-900')
    s3.put_object(Bucket='mailconnect-900', Key='database/2026/base.csv',
                  Body=csv_text.encode('utf-8'))


def test_reporte_completo_email():
    with mock_aws():
        _setup('Identificacion;Correo;Nombre\n'
               '1;ana@gmail.com;Ana\n'            # válido
               '2;pepe@@mal;Pepe\n'               # sintaxis
               '3;ana@gmail.com;Ana bis\n'        # duplicado
               '4;temp@mailinator.com;Temp\n'     # desechable
               '5;info@empresa.com;Info\n'        # rol (advertencia, cuenta como válido)
               '6;x@noexiste.invalid;X\n')        # dominio no resoluble
        m = _load()
        resp = m.lambda_handler(_event('F1'), None)
        assert resp['statusCode'] == 200
        d = resp['data']
        assert d['analyzed'] == 6 and d['total'] == 6 and d['contactType'] == 'correo'
        assert d['counts'] == {'valid': 2, 'invalidSyntax': 1, 'duplicates': 1,
                               'disposable': 1, 'roleAccounts': 1,
                               'unresolvableDomains': 1}
        assert 'x@noexiste.invalid' in d['samples']['unresolvableDomains']
        assert 'noexiste.invalid' in d['domains']['unresolved']
        # Score: 6 analizados, 4 penalizados (sintaxis+dup+desechable+dominio) → 33.3.
        assert d['hygieneScore'] == 33.3 and d['level'] == 'critical'
        # El resumen queda PERSISTIDO en el registro de la base.
        item = boto3.resource('dynamodb', region_name='us-east-1').Table('databaseFile') \
            .get_item(Key={'databaseFileId': 'F1'})['Item']
        assert item['hygiene']['level'] == 'critical'
        assert int(item['hygiene']['duplicates']) == 1


def test_base_limpia_ok():
    with mock_aws():
        _setup('Identificacion;Correo;Nombre\n'
               '1;ana@gmail.com;Ana\n'
               '2;beto@acme.co;Beto\n')
        m = _load()
        d = m.lambda_handler(_event('F1'), None)['data']
        assert d['counts']['valid'] == 2
        assert d['hygieneScore'] == 100.0 and d['level'] == 'ok'


def test_canal_celular_valida_e164():
    with mock_aws():
        _setup('Identificacion;Celular;Nombre\n'
               '1;3001234567;Ana\n'          # local de 10 → normaliza +57 (válido)
               '2;+573001234567;Ana bis\n'   # MISMO celular en E.164 → duplicado
               '3;123;Corto\n',              # inválido
               channel='SMS')
        m = _load()
        d = m.lambda_handler(_event('F1'), None)['data']
        assert d['contactType'] == 'celular'
        assert d['counts']['valid'] == 1
        assert d['counts']['duplicates'] == 1
        assert d['counts']['invalidSyntax'] == 1
        # Los checks de dominio no aplican al celular.
        assert d['counts']['disposable'] == 0 and d['counts']['unresolvableDomains'] == 0


def test_aislamiento_de_tenant_403():
    with mock_aws():
        _setup('Identificacion;Correo;Nombre\n1;ana@gmail.com;Ana\n')
        m = _load()
        resp = m.lambda_handler(_event('F1', customer_id='CU2', customer='Otra', nit='901'), None)
        assert resp['statusCode'] == 403


def test_base_inexistente_404_y_sin_id_400():
    with mock_aws():
        _setup('Identificacion;Correo;Nombre\n1;ana@gmail.com;Ana\n')
        m = _load()
        assert m.lambda_handler(_event('NO-EXISTE'), None)['statusCode'] == 404
        assert m.lambda_handler(_event(''), None)['statusCode'] == 400


def test_tope_de_dominios_no_penaliza(monkeypatch):
    # Dominios más allá del tope de lookups quedan "skipped" y NO bajan el score.
    with mock_aws():
        _setup('Identificacion;Correo;Nombre\n'
               '1;a@gmail.com;A\n'
               '2;b@dominio-nuevo-1.com;B\n'
               '3;c@dominio-nuevo-2.com;C\n')
        m = _load()
        monkeypatch.setattr(m, 'MAX_DOMAIN_LOOKUPS', 1)
        d = m.lambda_handler(_event('F1'), None)['data']
        # Solo gmail.com se consultó (resuelve); los otros 2 se saltaron sin penalizar.
        assert d['domains']['checked'] == 1 and d['domains']['skipped'] == 2
        assert d['counts']['unresolvableDomains'] == 0
        assert d['counts']['valid'] == 3
