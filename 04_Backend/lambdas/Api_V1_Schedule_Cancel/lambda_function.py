'''
Lambda: CANCELAR un envío programado (tabla `scheduledSend`).

Ruta: POST /Schedule/Cancel  (no-proxy, envelope estándar)
Request:  { scheduleId }
Respuesta: 200 ok · 400 falta id · 403 otro cliente · 404 no existe · 409 (ya no está pendiente)

Solo se puede cancelar mientras esté `pending` (aún no disparado). La transición
pending→canceled es condicional (atómica) para no chocar con el dispatcher que justo lo tome.
'''
import os
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_schedule = dynamodb.Table('scheduledSend')
scheduler_client = boto3.client('scheduler')

SCHEDULER_GROUP = os.environ.get('SCHEDULER_GROUP', 'default')
SCHEDULE_NAME_PREFIX = 'mc-send-'


def _delete_schedule(name):
    """Borra el schedule one-shot en EventBridge (best-effort). Aislada para poder mockearla."""
    scheduler_client.delete_schedule(Name=name, GroupName=SCHEDULER_GROUP)


def _get_payload(event):
    import json
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    payload = _get_payload(event)
    schedule_id = str(payload.get('scheduleId', '') or '').strip()
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}
    if not schedule_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el scheduleId.'}

    try:
        current = table_schedule.get_item(Key={'scheduleId': schedule_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'El envío programado no existe.'}
        if str(current.get('customerId')) != str(customer_id):
            return {'status': False, 'statusCode': 403, 'description': 'El envío programado pertenece a otro cliente.'}
        if str(current.get('status')) != 'pending':
            return {'status': False, 'statusCode': 409,
                    'description': 'Solo se puede cancelar un envío que sigue pendiente.'}

        try:
            table_schedule.update_item(
                Key={'scheduleId': schedule_id},
                UpdateExpression='SET #s = :c',
                ConditionExpression='#s = :p',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':c': 'canceled', ':p': 'pending'})
        except ClientError as ce:
            if ce.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return {'status': False, 'statusCode': 409,
                        'description': 'El envío ya no está pendiente (posiblemente ya se disparó).'}
            raise

        # Borra el schedule one-shot para que no dispare (best-effort; si ya se disparó y se
        # autoeliminó, o no existe, no es error). El nombre se deriva del scheduleId.
        name = str(current.get('scheduleName') or (SCHEDULE_NAME_PREFIX + schedule_id))
        try:
            _delete_schedule(name)
        except Exception as e:
            print('No se pudo borrar el schedule {} (best-effort): {}'.format(name, e))

        return {'status': True, 'statusCode': 200, 'description': 'Envío programado cancelado.'}
    except ClientError as e:
        print('Error cancelando programado: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo cancelar el envío programado.'}
    except Exception as e:
        print('Error no controlado al cancelar: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al cancelar.'}
