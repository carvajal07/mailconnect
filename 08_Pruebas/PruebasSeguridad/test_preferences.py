"""
Pruebas del CENTRO DE PREFERENCIAS del suscriptor (Api_V1_Email_Preferences, Bloque H):
validación del token firmado, render de la página (GET), guardado (POST) con frecuencia/
temas, y que "ninguna"/sin-temas da de baja (escribe en {tenant}_unsubscribe) mientras que
cualquier otra opción re-suscribe. DynamoDB con moto.
"""
import os
import json
import base64
import hmac
import hashlib
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
os.environ.setdefault('SECRET_KEY', 'test-secret-key-para-pruebas-32bytes!')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDA = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Email_Preferences' / 'lambda_function.py'
SECRET = os.environ['SECRET_KEY']


def _load():
    spec = importlib.util.spec_from_file_location('preferences', str(LAMBDA))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _token(email='ana@acme.co', tenant='900', customer='Acme'):
    payload = json.dumps({'c': customer, 'n': tenant, 'e': email}, separators=(',', ':'))
    b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    sig = hmac.new(SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:32]
    return '{}.{}'.format(b64, sig)


def _get(token):
    return {'httpMethod': 'GET', 'queryStringParameters': {'t': token}}


def _post(token, body):
    return {'httpMethod': 'POST', 'queryStringParameters': {'t': token}, 'body': body}


@pytest.fixture
def prefs():
    with mock_aws():
        yield _load()


def test_token_invalido_muestra_error(prefs):
    resp = prefs.lambda_handler(_get('basura.mala'), None)
    assert resp['statusCode'] == 200
    assert 'inv' in resp['body'].lower()   # "Enlace inválido"


def test_get_muestra_pagina(prefs):
    resp = prefs.lambda_handler(_get(_token()), None)
    assert resp['statusCode'] == 200
    assert 'ana@acme.co' in resp['body']
    assert 'Administrar' not in resp['body'] or 'preferencias' in resp['body'].lower()
    assert 'frequency' in resp['body']   # el form trae el selector de frecuencia


def test_post_guarda_preferencias(prefs):
    resp = prefs.lambda_handler(_post(_token(), 'frequency=reduced&topic=novedades'), None)
    assert resp['statusCode'] == 200 and 'Guardamos' in resp['body']
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('900_preferences').get_item(
        Key={'email': 'ana@acme.co'})['Item']
    assert item['frequency'] == 'reduced'
    assert item['topics']['novedades'] is True and item['topics']['promociones'] is False


def test_post_ninguna_da_de_baja(prefs):
    prefs.lambda_handler(_post(_token(), 'frequency=none'), None)
    # Escribió en la lista de desuscritos del tenant (que Prepare-batch YA filtra).
    unsub = boto3.resource('dynamodb', region_name='us-east-1').Table('900_unsubscribe').get_item(
        Key={'email': 'ana@acme.co'})['Item']
    assert unsub['email'] == 'ana@acme.co'


def test_post_sin_temas_da_de_baja(prefs):
    # Desmarcar TODOS los temas equivale a darse de baja.
    prefs.lambda_handler(_post(_token(), 'frequency=normal'), None)
    unsub = boto3.resource('dynamodb', region_name='us-east-1').Table('900_unsubscribe').get_item(
        Key={'email': 'ana@acme.co'})['Item']
    assert unsub['email'] == 'ana@acme.co'


def test_post_reactiva_resuscribe(prefs):
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    # Estaba dado de baja...
    prefs.lambda_handler(_post(_token(), 'frequency=none'), None)
    assert 'Item' in ddb.Table('900_unsubscribe').get_item(Key={'email': 'ana@acme.co'})
    # ...y vuelve a elegir recibir con un tema marcado → se quita de la baja.
    prefs.lambda_handler(_post(_token(), 'frequency=normal&topic=promociones'), None)
    assert 'Item' not in ddb.Table('900_unsubscribe').get_item(Key={'email': 'ana@acme.co'})
