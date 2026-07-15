'''
Lambda ADMIN: GUARDAR un ajuste de configuración de plataforma (tabla `platformConfig`).

Ruta: POST /Config/Set  (integración no-proxy, envelope estándar)
Request:  { key, value }   key debe pertenecer al catálogo conocido (ver Config/Get).
Respuesta: 200 ok · 400 key inválida / valor inválido

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

La tabla `platformConfig` se crea sola si no existe (PK configKey). Las lambdas
consumidoras la leen con fallback a su env var, así que un cambio aquí se refleja
sin redesplegar.
'''
import re
import json
import time
import uuid
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
ddb_client = boto3.client('dynamodb')
table = dynamodb.Table('platformConfig')
_audit_table = dynamodb.Table('adminAudit')


def _audit(event, action, target='', detail=''):
    """Registra una acción admin en adminAudit (best-effort; nunca rompe la operación)."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {}
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'admin'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))

# Tipos permitidos por clave (debe reflejar el SCHEMA de Config/Get).
FIELD_TYPES = {
    'SENDER_EMAIL': 'email',
    'ACTIVATION_URL': 'string',
    'OTP_EXPIRATION_MIN': 'number',
}


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


def _actor(event):
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('userId') or auth.get('customer') or 'admin')


def _ensure_table():
    """Crea platformConfig (PK configKey) si no existe."""
    try:
        ddb_client.describe_table(TableName='platformConfig')
        return
    except ddb_client.exceptions.ResourceNotFoundException:
        pass
    except Exception:
        return
    try:
        ddb_client.create_table(
            TableName='platformConfig',
            KeySchema=[{'AttributeName': 'configKey', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'configKey', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        ddb_client.get_waiter('table_exists').wait(TableName='platformConfig')
    except Exception as e:
        print('No se pudo crear platformConfig: {}'.format(e))


# Rangos por clave numérica (evita valores absurdos que rompen la seguridad/flujo).
_NUMBER_RANGES = {
    'OTP_EXPIRATION_MIN': (1, 60),
}
_EMAIL_RE = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')


def _validate(key, value):
    """Devuelve (valor_normalizado, error). El valor numérico se guarda como Decimal."""
    type_ = FIELD_TYPES[key]
    if type_ == 'number':
        try:
            num = float(value)
        except (TypeError, ValueError):
            return None, 'El valor debe ser numérico.'
        lo, hi = _NUMBER_RANGES.get(key, (0, None))
        if num < lo:
            return None, 'El valor mínimo es {}.'.format(lo)
        if hi is not None and num > hi:
            return None, 'El valor máximo es {}.'.format(hi)
        return (Decimal(str(int(num))) if num % 1 == 0 else Decimal(str(num))), None
    # string / email
    text = str(value).strip()
    if not text:
        return None, 'El valor no puede estar vacío.'
    if type_ == 'email' and not _EMAIL_RE.match(text):
        return None, 'Ingresa un correo válido.'
    # ACTIVATION_URL alimenta el enlace de activación de TODOS los correos:
    # exigir https:// (evita inyectar un dominio de phishing por HTTP).
    if key == 'ACTIVATION_URL' and not text.lower().startswith('https://'):
        return None, 'La URL debe empezar con https://'
    return text, None


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}

    payload = _get_payload(event)
    key = str(payload.get('key', '')).strip()
    if key not in FIELD_TYPES:
        return {'status': False, 'statusCode': 400, 'description': 'Ajuste (key) no reconocido.'}
    if 'value' not in payload:
        return {'status': False, 'statusCode': 400, 'description': 'Falta el value.'}

    value, err = _validate(key, payload.get('value'))
    if err:
        return {'status': False, 'statusCode': 400, 'description': err}

    try:
        _ensure_table()
        table.put_item(Item={
            'configKey': key,
            'value': value,
            'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
            'updatedBy': _actor(event),
        })
        _audit(event, 'config.set', key, str(value))
        return {'status': True, 'statusCode': 200, 'description': 'Ajuste guardado',
                'data': {'key': key}}
    except ClientError as e:
        print('Error guardando ajuste: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al guardar el ajuste'}
    except Exception as e:
        print('Error guardando ajuste: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al guardar el ajuste'}
