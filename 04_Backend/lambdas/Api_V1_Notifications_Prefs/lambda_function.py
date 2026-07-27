'''
Preferencias de NOTIFICACIÓN del cliente (Bloque H), gestionadas por el OWNER desde el
portal (Mi cuenta). Guarda `customer.notify` para el tenant del token.

Ruta: POST /Notifications/Prefs  (no-proxy, envelope; detrás del Authorizer del portal)
Request:
  - Leer:   { action: 'get' }  (o sin action)
  - Guardar:{ action: 'set', prefs: { reputation?, digest?, lowBalance?,
                                       lowBalanceThreshold? } }   (owner-only)
Respuesta 200 `data: { notify: {reputation, digest, lowBalance, lowBalanceThreshold} }`
403 sin tenant / no-owner al guardar · 404 cliente no existe.

Convención FAIL-OPEN por defecto: reputation/lowBalance ON, digest OFF, umbral 20.000 COP.
El aviso de saldo bajo lo dispara Prepare-batch; reputación/resumen la lambda de barrido
`Api_V1_Notifications_Scan`. Aquí solo se administra la preferencia.

[J]: ruta /Notifications/Prefs (authorizer + CORS + mapping template con customerId +
tenantRole). IAM: `dynamodb:GetItem/UpdateItem customer`.
'''
import json
import time
import uuid
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')
_audit_table = dynamodb.Table('adminAudit')

_DEFAULTS = {'reputation': True, 'digest': False, 'lowBalance': True,
             'lowBalanceThreshold': 20000}
_BOOL_KEYS = ('reputation', 'digest', 'lowBalance')


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _auth(event):
    return ((event or {}).get('requestContext') or {}).get('authorizer') or {}


def _as_bool(v):
    if isinstance(v, str):
        return v.strip().lower() in ('true', '1', 'yes', 'si', 'sí')
    return bool(v)


def _merge_defaults(raw):
    """Aplica los defaults FAIL-OPEN sobre lo guardado (normaliza a JSON-safe)."""
    raw = raw if isinstance(raw, dict) else {}
    out = dict(_DEFAULTS)
    for k in _BOOL_KEYS:
        if raw.get(k) is not None:
            out[k] = _as_bool(raw.get(k))
    if raw.get('lowBalanceThreshold') is not None:
        try:
            out['lowBalanceThreshold'] = max(int(raw['lowBalanceThreshold']), 0)
        except (TypeError, ValueError):
            pass
    return out


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _audit(event, action, target, detail):
    """Bitácora (adminAudit) best-effort — nunca rompe la operación."""
    try:
        auth = _authorizer(event)
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'cliente'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _auth(event)
    customer_id = auth.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    action = str(payload.get('action', 'get') or 'get').lower()

    try:
        item = table_customer.get_item(
            Key={'customerId': customer_id}, ProjectionExpression='notify').get('Item')
        if item is None:
            return {'status': False, 'statusCode': 404,
                    'description': 'El cliente no existe.', 'data': {}}
        current = _merge_defaults(item.get('notify'))

        if action != 'set':
            return {'status': True, 'statusCode': 200,
                    'description': 'Preferencias de notificación', 'data': {'notify': current}}

        # Guardar: solo el OWNER del tenant (config de la cuenta). Fail-closed.
        if str(auth.get('tenantRole', 'operator') or 'operator').lower() != 'owner':
            return {'status': False, 'statusCode': 403,
                    'description': 'Solo el dueño de la cuenta puede cambiar las notificaciones.',
                    'data': {}}
        incoming = payload.get('prefs') if isinstance(payload.get('prefs'), dict) else {}
        merged = dict(current)
        for k in _BOOL_KEYS:
            if incoming.get(k) is not None:
                merged[k] = _as_bool(incoming.get(k))
        if incoming.get('lowBalanceThreshold') is not None:
            try:
                merged['lowBalanceThreshold'] = max(int(incoming['lowBalanceThreshold']), 0)
            except (TypeError, ValueError):
                pass
        try:
            table_customer.update_item(
                Key={'customerId': customer_id},
                UpdateExpression='SET notify = :n',
                ConditionExpression='attribute_exists(customerId)',
                ExpressionAttributeValues={':n': {k: (Decimal(v) if k == 'lowBalanceThreshold' else v)
                                                  for k, v in merged.items()}})
        except ClientError as ce:
            if ce.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return {'status': False, 'statusCode': 404,
                        'description': 'El cliente no existe.', 'data': {}}
            raise
        # Apagar los avisos de reputación o de saldo bajo deja a la cuenta a ciegas ante
        # un problema de entregabilidad o un agotamiento de saldo: queda quién lo cambió.
        _audit(event, 'notifications.prefs', customer_id,
               'Avisos: ' + ', '.join('{}={}'.format(k, merged.get(k)) for k in sorted(merged)))
        return {'status': True, 'statusCode': 200,
                'description': 'Preferencias de notificación guardadas',
                'data': {'notify': merged}}
    except Exception as e:
        print('Error en Notifications/Prefs: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al gestionar las notificaciones', 'data': {}}
