'''
Lambda ADMIN: LEER la configuración de plataforma (tabla `platformConfig`).

Centraliza ajustes globales que antes vivían como variables de entorno sueltas por
lambda. Devuelve el catálogo de ajustes conocidos (SCHEMA) con su valor actual
(guardado o por defecto), agrupados para la UI.

Ruta: POST /Config/Get  (integración no-proxy, envelope estándar)
Request:  {}
Respuesta: 200 { data: { settings:[{key, label, group, type, default, help,
                                    consumers[], value, isOverridden}] } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Los ajustes marcados aquí SÍ los consumen sus lambdas (leen platformConfig con
fallback a su env var). Tabla: platformConfig (PK configKey; attr value).
'''
import json
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('platformConfig')

# Catálogo de ajustes conocidos. `consumers` = lambdas que YA lo leen (con fallback a env).
SCHEMA = [
    {'key': 'SENDER_EMAIL', 'label': 'Remitente de correos', 'group': 'Correo', 'type': 'email',
     'default': 'comunicaciones@mailconnect.com.co',
     'help': 'Dirección "From" de los correos transaccionales (activación, OTP, recuperación).',
     'consumers': ['Register', 'Create-otp', 'Recovery-password']},
    {'key': 'ACTIVATION_URL', 'label': 'URL de activación', 'group': 'Correo', 'type': 'string',
     'default': 'https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api/account-activation',
     'help': 'Endpoint público al que apunta el botón "Activar mi cuenta" del correo de registro.',
     'consumers': ['Register']},
    {'key': 'OTP_EXPIRATION_MIN', 'label': 'Vigencia del OTP (minutos)', 'group': 'Seguridad', 'type': 'number',
     'default': 5,
     'help': 'Minutos de validez de los códigos OTP (verificación y recuperación).',
     'consumers': ['Create-otp', 'Recovery-password']},
]


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def _coerce(value, type_):
    if isinstance(value, Decimal):
        value = int(value) if value % 1 == 0 else float(value)
    if type_ == 'number':
        try:
            return int(value) if float(value) % 1 == 0 else float(value)
        except (TypeError, ValueError):
            return value
    return value


def _stored():
    """Todos los ítems guardados: {configKey: value}. {} si la tabla no existe."""
    out = {}
    try:
        resp = table.scan(ProjectionExpression='configKey, #v', ExpressionAttributeNames={'#v': 'value'})
        for it in resp.get('Items', []):
            out[it.get('configKey')] = it.get('value')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {}
        raise
    return out


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}
    try:
        stored = _stored()
        settings = []
        for s in SCHEMA:
            has = s['key'] in stored and stored[s['key']] not in (None, '')
            value = _coerce(stored[s['key']], s['type']) if has else s['default']
            settings.append({**s, 'value': value, 'isOverridden': has})
        return {'status': True, 'statusCode': 200,
                'description': 'Configuración de plataforma', 'data': {'settings': settings}}
    except Exception as e:
        print('Error leyendo configuración: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al leer la configuración', 'data': {}}
