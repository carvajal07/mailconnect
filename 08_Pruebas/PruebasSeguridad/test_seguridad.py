"""
Pruebas de integración de las lambdas de seguridad de MailConnect.

Se ejecutan 100% en local usando `moto` (mock de DynamoDB y SES), sin tocar AWS.
Cubren el flujo: registro -> activación -> login -> OTP (crear/validar) ->
cambio de contraseña (por OTP y por token) -> logout, más casos de error.

Cómo correrlas:
    cd 08_Pruebas/PruebasSeguridad
    pip install -r requirements.txt
    pytest -v

Cómo mantenerlas:
    - Cada test crea su propio usuario (email único) para ser independiente.
    - Si agregas/renombras una lambda de seguridad, ajusta LAMBDA_FILES.
    - Si cambia el esquema de una tabla (PK), ajusta TABLES.
"""

import os
import sys
import importlib.util
from pathlib import Path

import pytest

# --- Configuración de entorno para moto (antes de importar las lambdas) ---
os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
os.environ.setdefault('SECRET_KEY', 'test-secret-key-para-pruebas-32bytes!')
os.environ.setdefault('SENDER_EMAIL', 'comunicaciones@mailconnect.com.co')

from datetime import datetime, timedelta  # noqa: E402

import jwt  # noqa: E402 (PyJWT)
from moto import mock_aws  # noqa: E402
import boto3  # noqa: E402


def _make_jwt(user, minutes=60):
    """Genera un JWT HS256 con la SECRET_KEY de prueba (positivo/expirado)."""
    payload = {'user': user, 'exp': datetime.utcnow() + timedelta(minutes=minutes)}
    token = jwt.encode(payload, os.environ['SECRET_KEY'], algorithm='HS256')
    return token if isinstance(token, str) else token.decode()

# --- Rutas: se calculan desde la raíz del repo, no hay rutas absolutas ---
REPO_ROOT = Path(__file__).resolve().parents[2]          # .../ProyectoMailconnect
LAMBDAS_DIR = REPO_ROOT / '04_Backend' / 'lambdas'

# Nombre lógico -> carpeta de la lambda
LAMBDA_FILES = {
    'register':   'Api_V1_Security_Register',
    'login':      'Api_V1_Security_Login',
    'activation': 'Api_V1_Security_Acount-activation',
    'create_otp': 'Api_V1_Security_Create-otp',
    'validate_otp': 'Api_V1_Security_Validate-otp',
    'change_password': 'Api_V1_Security_Change-password',
    'recovery':   'Api_V1_Security_Recovery-password',
    'logout':     'Api_V1_Security_Logout',
    'authorizer': 'Authorizer',
}

# Tabla -> clave primaria (HASH)
TABLES = {
    'user': 'userId',
    'userData': 'userDataId',
    'customer': 'customerId',
    'userActivation': 'userActivationId',
    # La tabla real en AWS se llama 'oneTimePassword' (PK 'oneTimePasswordId').
    'oneTimePassword': 'oneTimePasswordId',
    'session': 'sessionId',
}

SENDER = os.environ['SENDER_EMAIL']


def _load_lambda(name, folder):
    path = LAMBDAS_DIR / folder / 'lambda_function.py'
    if not path.exists():
        raise FileNotFoundError(f"No se encontró la lambda: {path}")
    spec = importlib.util.spec_from_file_location(f"mc_{name}", str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Ctx:
    """Contenedor con handlers, recursos de tablas y helpers para las pruebas."""

    def __init__(self):
        self.mods = {name: _load_lambda(name, folder) for name, folder in LAMBDA_FILES.items()}
        res = boto3.resource('dynamodb', region_name='us-east-1')
        self.tables = {t: res.Table(t) for t in TABLES}
        self._email_seq = 0

    def handler(self, name):
        return self.mods[name].lambda_handler

    def unique_email(self, prefix='user'):
        self._email_seq += 1
        return f"{prefix}{self._email_seq}@test.com"

    # ---- Helpers de flujo ----
    def register(self, email, password='Password123', tin=900123456):
        return self.handler('register')({
            'name': 'Usuario Test', 'phone': '3204586576', 'email': email,
            'company': 'Empresa Test', 'companyTin': tin, 'password': password,
        }, None)

    def user_id(self, email):
        items = self.tables['user'].scan(
            FilterExpression='email = :e',
            ExpressionAttributeValues={':e': email},
        )['Items']
        return items[0]['userId'] if items else None

    def activation_key(self, email):
        uid = self.user_id(email)
        items = self.tables['userActivation'].scan(
            FilterExpression='userId = :u',
            ExpressionAttributeValues={':u': uid},
        )['Items']
        return items[0]['activationKey'] if items else None

    def make_active_user(self, email, password='Password123'):
        self.register(email, password)
        key = self.activation_key(email)
        self.handler('activation')({'queryStringParameters': {'qs': key}}, None)
        return email

    def set_otp_code(self, code):
        """Fija el código que generará create-otp (para poder validarlo)."""
        self.mods['create_otp'].secrets.randbelow = lambda n: code

    def set_recovery_code(self, code):
        """Fija el código que generará recovery-password (para poder usarlo)."""
        self.mods['recovery'].secrets.randbelow = lambda n: code

    def active_otps(self, email):
        """OTPs activos del usuario (para verificar consumo)."""
        uid = self.user_id(email)
        return [
            i for i in self.tables['oneTimePassword'].scan(
                FilterExpression='userId = :u',
                ExpressionAttributeValues={':u': uid},
            )['Items']
            if i.get('active')
        ]


@pytest.fixture(scope="module")
def ctx():
    with mock_aws():
        client = boto3.client('dynamodb', region_name='us-east-1')
        for table, pk in TABLES.items():
            client.create_table(
                TableName=table,
                KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                BillingMode='PAY_PER_REQUEST',
            )
        boto3.client('ses', region_name='us-east-1').verify_email_identity(EmailAddress=SENDER)
        yield Ctx()


# ============================ REGISTRO ============================

def test_registro_exitoso_crea_usuario_inactivo(ctx):
    email = ctx.unique_email('reg')
    resp = ctx.register(email)
    assert resp['statusCode'] == 201
    assert ctx.user_id(email) is not None
    items = ctx.tables['user'].scan(
        FilterExpression='email = :e', ExpressionAttributeValues={':e': email})['Items']
    assert items[0]['active'] is False


def test_registro_email_duplicado_409(ctx):
    email = ctx.unique_email('dup')
    ctx.register(email)
    resp = ctx.register(email)
    assert resp['statusCode'] == 409


def test_registro_telefono_invalido_400(ctx):
    resp = ctx.handler('register')({
        'name': 'X', 'phone': 'abc', 'email': ctx.unique_email('bad'),
        'company': 'C', 'companyTin': 900111, 'password': 'Password123',
    }, None)
    assert resp['statusCode'] == 400


# ============================ ACTIVACIÓN ============================

def test_activacion_valida_activa_cuenta(ctx):
    email = ctx.unique_email('act')
    ctx.register(email)
    key = ctx.activation_key(email)
    resp = ctx.handler('activation')({'queryStringParameters': {'qs': key}}, None)
    assert resp['statusCode'] == 302
    items = ctx.tables['user'].scan(
        FilterExpression='email = :e', ExpressionAttributeValues={':e': email})['Items']
    assert items[0]['active'] is True


def test_activacion_clave_invalida_redirige(ctx):
    resp = ctx.handler('activation')({'queryStringParameters': {'qs': 'clave-inexistente'}}, None)
    assert resp['statusCode'] == 302
    assert 'activated=0' in resp['headers']['Location']


# ============================ LOGIN ============================

def test_login_cuenta_inactiva_423(ctx):
    email = ctx.unique_email('inact')
    ctx.register(email)  # sin activar
    resp = ctx.handler('login')({'user': email, 'password': 'Password123'}, None)
    assert resp['statusCode'] == 423


def test_login_exitoso_devuelve_token(ctx):
    email = ctx.make_active_user(ctx.unique_email('login'))
    resp = ctx.handler('login')({'user': email, 'password': 'Password123'}, None)
    assert resp['statusCode'] == 200
    assert resp['data']['token']
    assert resp['data']['userId']


def test_login_password_incorrecta_404(ctx):
    email = ctx.make_active_user(ctx.unique_email('badpwd'))
    resp = ctx.handler('login')({'user': email, 'password': 'ClaveErrada9'}, None)
    assert resp['statusCode'] == 404


# ============================ OTP ============================

def test_create_y_validate_otp(ctx):
    email = ctx.make_active_user(ctx.unique_email('otp'))
    ctx.set_otp_code(123456)
    creado = ctx.handler('create_otp')({'user': email, 'expiration': 5, 'system': 'Prueba'}, None)
    assert creado['statusCode'] == 201

    malo = ctx.handler('validate_otp')({'user': email, 'otp': 999999, 'ip': '1.1.1.1'}, None)
    assert malo['statusCode'] == 401

    ok = ctx.handler('validate_otp')({'user': email, 'otp': 123456, 'ip': '1.1.1.1'}, None)
    assert ok['statusCode'] == 200


def test_validate_otp_se_consume(ctx):
    email = ctx.make_active_user(ctx.unique_email('otpc'))
    ctx.set_otp_code(654321)
    ctx.handler('create_otp')({'user': email, 'expiration': 5}, None)
    ctx.handler('validate_otp')({'user': email, 'otp': 654321}, None)
    # Reusarlo debe fallar (ya consumido)
    segundo = ctx.handler('validate_otp')({'user': email, 'otp': 654321}, None)
    assert segundo['statusCode'] == 401


# ============================ CAMBIO DE CONTRASEÑA ============================

def test_change_password_por_otp(ctx):
    email = ctx.make_active_user(ctx.unique_email('chotp'))
    ctx.set_otp_code(222333)
    ctx.handler('create_otp')({'user': email, 'expiration': 5}, None)
    resp = ctx.handler('change_password')({'user': email, 'password': 'NuevaClave456', 'otp': 222333}, None)
    assert resp['statusCode'] == 200
    login = ctx.handler('login')({'user': email, 'password': 'NuevaClave456'}, None)
    assert login['statusCode'] == 200


def test_change_password_por_token(ctx):
    email = ctx.make_active_user(ctx.unique_email('chtok'))
    login = ctx.handler('login')({'user': email, 'password': 'Password123'}, None)
    token = login['data']['token']
    resp = ctx.handler('change_password')(
        {'user': email, 'password': 'OtraClave789', 'headers': {'Authorization': 'Bearer ' + token}}, None)
    assert resp['statusCode'] == 200


def test_change_password_sin_autorizacion_401(ctx):
    email = ctx.make_active_user(ctx.unique_email('noauth'))
    resp = ctx.handler('change_password')({'user': email, 'password': 'SinAuth123'}, None)
    assert resp['statusCode'] == 401


def test_change_password_debil_400(ctx):
    email = ctx.make_active_user(ctx.unique_email('weak'))
    login = ctx.handler('login')({'user': email, 'password': 'Password123'}, None)
    token = login['data']['token']
    resp = ctx.handler('change_password')(
        {'user': email, 'password': 'debil', 'headers': {'Authorization': 'Bearer ' + token}}, None)
    assert resp['statusCode'] == 400


# ==================== RECUPERACIÓN DE CONTRASEÑA ====================

def test_recovery_password_flujo_completo(ctx):
    """forgot-password genera un OTP que sirve para cambiar la contraseña."""
    email = ctx.make_active_user(ctx.unique_email('rec'))
    ctx.set_recovery_code(345678)

    resp = ctx.handler('recovery')({'user': email, 'ip': '2.2.2.2'}, None)
    assert resp['statusCode'] == 200

    # El OTP generado permite cambiar la contraseña y loguearse con la nueva.
    cambio = ctx.handler('change_password')(
        {'user': email, 'password': 'Recuperada789', 'otp': 345678}, None)
    assert cambio['statusCode'] == 200
    login = ctx.handler('login')({'user': email, 'password': 'Recuperada789'}, None)
    assert login['statusCode'] == 200


def test_recovery_password_email_inexistente_200_generico(ctx):
    """No revela si el correo existe: responde 200 y no genera OTP."""
    resp = ctx.handler('recovery')({'user': 'noexiste@test.com'}, None)
    assert resp['statusCode'] == 200
    assert resp['status'] is True


def test_recovery_password_sin_correo_400(ctx):
    resp = ctx.handler('recovery')({}, None)
    assert resp['statusCode'] == 400


def test_recovery_password_debil_no_consume_otp(ctx):
    """Una contraseña débil no debe gastar el OTP; se puede reintentar."""
    email = ctx.make_active_user(ctx.unique_email('recweak'))
    ctx.set_recovery_code(456789)
    ctx.handler('recovery')({'user': email}, None)

    # Intento con clave débil -> 400 y el OTP sigue activo.
    debil = ctx.handler('change_password')(
        {'user': email, 'password': 'debil', 'otp': 456789}, None)
    assert debil['statusCode'] == 400
    assert len(ctx.active_otps(email)) == 1

    # Reintento con clave válida y el MISMO OTP -> 200.
    ok = ctx.handler('change_password')(
        {'user': email, 'password': 'ClaveFuerte9', 'otp': 456789}, None)
    assert ok['statusCode'] == 200


# ============================ AUTHORIZER ============================

def test_authorizer_token_valido_permite(ctx):
    token = _make_jwt('user@test.com')
    policy = ctx.handler('authorizer')(
        {'authorizationToken': 'Bearer ' + token, 'methodArn': 'arn:aws:execute-api:xx'}, None)
    assert policy['policyDocument']['Statement'][0]['Effect'] == 'Allow'
    assert policy['context']['user'] == 'user@test.com'


def test_authorizer_token_en_header_request(ctx):
    token = _make_jwt('req@test.com')
    policy = ctx.handler('authorizer')(
        {'headers': {'Authorization': 'Bearer ' + token}, 'methodArn': 'arn:aws:execute-api:xx'}, None)
    assert policy['policyDocument']['Statement'][0]['Effect'] == 'Allow'


def test_authorizer_sin_token_deniega(ctx):
    with pytest.raises(Exception, match='Unauthorized'):
        ctx.handler('authorizer')({'methodArn': 'arn:aws:execute-api:xx'}, None)


def test_authorizer_token_invalido_deniega(ctx):
    with pytest.raises(Exception, match='Unauthorized'):
        ctx.handler('authorizer')({'authorizationToken': 'Bearer no-es-un-token'}, None)


def test_authorizer_token_expirado_deniega(ctx):
    token = _make_jwt('exp@test.com', minutes=-5)  # ya expirado
    with pytest.raises(Exception, match='Unauthorized'):
        ctx.handler('authorizer')({'authorizationToken': 'Bearer ' + token}, None)


def test_authorizer_token_firmado_con_otra_clave_deniega(ctx):
    otro = jwt.encode({'user': 'x@test.com', 'exp': datetime.utcnow() + timedelta(hours=1)},
                      'clave-distinta', algorithm='HS256')
    otro = otro if isinstance(otro, str) else otro.decode()
    with pytest.raises(Exception, match='Unauthorized'):
        ctx.handler('authorizer')({'authorizationToken': 'Bearer ' + otro}, None)


# ============================ LOGOUT ============================

def test_logout_ok(ctx):
    email = ctx.make_active_user(ctx.unique_email('logout'))
    resp = ctx.handler('logout')({'user': email}, None)
    assert resp['statusCode'] == 200


# ============================ DESUSCRIPCIÓN ============================
# La lambda Unsubscribe valida un token HMAC firmado por las lambdas de envío
# (build_unsubscribe_url) e inserta el email en {customer}_unsubscribe (PK email).

def _load_unsubscribe_mods():
    unsub = _load_lambda('unsubscribe', 'Api_V1_Email_Unsubscribe')
    send_em = _load_lambda('send_em', 'Api_V1_Email_Send-batch-template-EM')
    return unsub, send_em


def test_unsubscribe_token_valido_inserta_email(ctx):
    unsub, send_em = _load_unsubscribe_mods()
    url = send_em.build_unsubscribe_url('empresatest', 'baja@test.com')
    token = url.split('?t=')[1]
    resp = unsub.lambda_handler({'queryStringParameters': {'t': token}}, None)
    assert resp['statusCode'] == 200
    assert 'Suscripci' in resp['body']  # página de confirmación
    item = boto3.resource('dynamodb', region_name='us-east-1').Table(
        'empresatest_unsubscribe').get_item(Key={'email': 'baja@test.com'})
    assert 'Item' in item


def test_unsubscribe_es_idempotente(ctx):
    unsub, send_em = _load_unsubscribe_mods()
    url = send_em.build_unsubscribe_url('empresatest', 'baja2@test.com')
    token = url.split('?t=')[1]
    assert unsub.lambda_handler({'queryStringParameters': {'t': token}}, None)['statusCode'] == 200
    assert unsub.lambda_handler({'queryStringParameters': {'t': token}}, None)['statusCode'] == 200


def test_unsubscribe_token_alterado_no_inserta(ctx):
    unsub, send_em = _load_unsubscribe_mods()
    url = send_em.build_unsubscribe_url('empresatest', 'victima@test.com')
    payload_b64 = url.split('?t=')[1].split('.')[0]
    resp = unsub.lambda_handler(
        {'queryStringParameters': {'t': payload_b64 + '.firma-falsa'}}, None)
    assert 'inv' in resp['body'].lower()  # página de enlace inválido
    item = boto3.resource('dynamodb', region_name='us-east-1').Table(
        'empresatest_unsubscribe').get_item(Key={'email': 'victima@test.com'})
    assert 'Item' not in item


def test_unsubscribe_sin_token_no_revienta(ctx):
    unsub, _ = _load_unsubscribe_mods()
    resp = unsub.lambda_handler({'queryStringParameters': None}, None)
    assert resp['statusCode'] == 200
    assert 'inv' in resp['body'].lower()


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-v']))
