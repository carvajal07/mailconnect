'''
CENTRO DE NOTIFICACIONES del portal: listar y marcar como leídas.

Ruta: POST /Notifications/List  (no-proxy, envelope; detrás del Authorizer del portal)
Request:
  - Listar:  { limit?: 30 }                       → las del usuario, recientes primero
  - Leer:    { action: 'read', notificationId }   → marca UNA como leída
  - Leer todo:{ action: 'read-all' }              → marca todas las del usuario
Respuesta 200 `data: { items: [...], unread: N }` · 403 sin identidad.

Tabla `notification` (PK `notificationId`, GSI `userId-createdAt-index`). Cada ítem:
  notificationId, userId, customerId, kind, title, body, level, link, read, createdAt,
  expiresAt (TTL).

⚠️ El destinatario es un USUARIO, no un tenant: quien aprueba una campaña no es el mismo
que la creó, y mostrarle a todo el equipo las notificaciones de todos convertiría el panel
en ruido. El aislamiento va por `userId` del token, nunca del body.

[J]: tabla `notification` + GSI `userId-createdAt-index` (la crea la lambda on-demand);
ruta /Notifications/List (authorizer + CORS + mapping template con userId/customerId);
IAM: `dynamodb:Query/UpdateItem/CreateTable/DescribeTable/UpdateTimeToLive` sobre
`notification`.
'''
import json
import os
import time

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
_client = boto3.client('dynamodb', region_name=REGION)

TABLE = 'notification'
GSI = 'userId-createdAt-index'
table = dynamodb.Table(TABLE)

DEFAULT_LIMIT = int(os.environ.get('NOTIFICATIONS_LIMIT', '30'))
MAX_LIMIT = 100


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _auth(event):
    return ((event or {}).get('requestContext') or {}).get('authorizer') or {}


def _ensure_table():
    """Crea la tabla la primera vez. Igual que `assistantRateLimit`: evita un paso manual
    de despliegue para una tabla que solo esta feature usa."""
    try:
        _client.describe_table(TableName=TABLE)
        return True
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') != 'ResourceNotFoundException':
            return False
    try:
        _client.create_table(
            TableName=TABLE,
            KeySchema=[{'AttributeName': 'notificationId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[
                {'AttributeName': 'notificationId', 'AttributeType': 'S'},
                {'AttributeName': 'userId', 'AttributeType': 'S'},
                {'AttributeName': 'createdAt', 'AttributeType': 'S'},
            ],
            GlobalSecondaryIndexes=[{
                'IndexName': GSI,
                'KeySchema': [
                    {'AttributeName': 'userId', 'KeyType': 'HASH'},
                    {'AttributeName': 'createdAt', 'KeyType': 'RANGE'},
                ],
                'Projection': {'ProjectionType': 'ALL'},
            }],
            BillingMode='PAY_PER_REQUEST')
        _client.get_waiter('table_exists').wait(TableName=TABLE)
        try:
            _client.update_time_to_live(
                TableName=TABLE,
                TimeToLiveSpecification={'Enabled': True, 'AttributeName': 'expiresAt'})
        except Exception:
            pass       # el TTL es higiene, no correctitud
        return True
    except Exception as e:
        print('No se pudo crear la tabla de notificaciones: {}'.format(e))
        return False


def _items(user_id, limit):
    """Notificaciones del usuario, recientes primero."""
    try:
        resp = table.query(
            IndexName=GSI,
            KeyConditionExpression=Key('userId').eq(user_id),
            ScanIndexForward=False,
            Limit=limit)
        return resp.get('Items', [])
    except ClientError as e:
        code = e.response.get('Error', {}).get('Code', '')
        if code == 'ResourceNotFoundException':
            return []
        raise


def _mark(notification_id, user_id):
    """Marca una como leída verificando el DUEÑO: sin la condición, cualquiera con un id
    podría marcar (o descubrir) notificaciones ajenas."""
    try:
        table.update_item(
            Key={'notificationId': notification_id},
            UpdateExpression='SET #r = :true',
            ConditionExpression='userId = :u',
            ExpressionAttributeNames={'#r': 'read'},
            ExpressionAttributeValues={':true': True, ':u': user_id})
        return True
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
            return False
        raise


def lambda_handler(event, context):
    auth = _auth(event)
    user_id = str(auth.get('userId') or '')
    if not user_id:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de usuario.', 'data': {}}

    payload = _get_payload(event)
    action = str(payload.get('action', '') or '').lower()

    if not _ensure_table():
        # Sin tabla no hay notificaciones que mostrar: lista vacía, no un error que
        # rompa el portal por una función accesoria.
        return {'status': True, 'statusCode': 200, 'description': 'Sin notificaciones',
                'data': {'items': [], 'unread': 0}}

    try:
        if action == 'read':
            nid = str(payload.get('notificationId', '') or '').strip()
            if not nid:
                return {'status': False, 'statusCode': 400,
                        'description': 'Falta el notificationId.', 'data': {}}
            if not _mark(nid, user_id):
                return {'status': False, 'statusCode': 404,
                        'description': 'La notificación no existe o no es tuya.', 'data': {}}

        elif action == 'read-all':
            for it in _items(user_id, MAX_LIMIT):
                if not it.get('read'):
                    _mark(it['notificationId'], user_id)

        try:
            limit = int(payload.get('limit') or DEFAULT_LIMIT)
        except (TypeError, ValueError):
            limit = DEFAULT_LIMIT
        limit = max(1, min(limit, MAX_LIMIT))

        items = _items(user_id, limit)
        salida = [{
            'notificationId': it.get('notificationId'),
            'kind': it.get('kind', ''),
            'title': it.get('title', ''),
            'body': it.get('body', ''),
            'level': it.get('level', 'info'),
            'link': it.get('link', ''),
            'read': bool(it.get('read')),
            'createdAt': it.get('createdAt', ''),
        } for it in items]
        return {'status': True, 'statusCode': 200, 'description': 'Notificaciones',
                'data': {'items': salida, 'unread': sum(1 for i in salida if not i['read'])}}
    except Exception as e:
        print('Error listando notificaciones: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'No se pudieron cargar las notificaciones.', 'data': {}}
