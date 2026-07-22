'''
Cascada omnicanal — INICIAR (o reanudar) un run.

draft/paused → running. Asegura las tablas por tenant e invoca el motor (Tick) una vez
para un arranque inmediato; de ahí en adelante el cron de EventBridge lo sigue moviendo.

Ruta: POST /Cascade/Start  { cascadeRunId }  (no-proxy, envelope). Tenant del token.
Respuesta: 200 ok · 403 · 404 · 409 (ya terminada/cancelada).
'''
import json
import os
from datetime import datetime

import boto3

REGION = 'us-east-1'
TICK_FUNCTION = os.environ.get('CASCADE_TICK_FUNCTION', 'Api_V1_Cascade_Tick')

dynamodb = boto3.resource('dynamodb', region_name=REGION)
lambda_client = boto3.client('lambda', region_name=REGION)
table_run = dynamodb.Table('cascadeRun')


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


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


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.', 'data': {}}
    run_id = str(payload.get('cascadeRunId', '')).strip()
    if not run_id:
        return {'status': False, 'statusCode': 400, 'description': 'Falta cascadeRunId.', 'data': {}}

    run = table_run.get_item(Key={'cascadeRunId': run_id}).get('Item')
    if not run:
        return {'status': False, 'statusCode': 404, 'description': 'La cascada no existe.', 'data': {}}
    if run.get('customerId') != customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'La cascada no pertenece a tu cuenta.', 'data': {}}
    if run.get('status') in ('done', 'canceled'):
        return {'status': False, 'statusCode': 409,
                'description': 'La cascada ya está {}.'.format(run.get('status')), 'data': {}}

    try:
        table_run.update_item(
            Key={'cascadeRunId': run_id},
            UpdateExpression='SET #s = :r, startedAt = if_not_exists(startedAt, :now)',
            ConditionExpression='#s IN (:draft, :paused, :running)',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':r': 'running', ':draft': 'draft',
                                       ':paused': 'paused', ':running': 'running',
                                       ':now': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')})
    except Exception as e:
        print('No se pudo iniciar: {}'.format(e))
        return {'status': False, 'statusCode': 409, 'description': 'No se pudo iniciar la cascada.', 'data': {}}

    # Arranque inmediato (best-effort): invoca el motor una vez.
    try:
        lambda_client.invoke(FunctionName=TICK_FUNCTION, InvocationType='Event',
                             Payload=json.dumps({'cascadeRunId': run_id}).encode('utf-8'))
    except Exception as e:
        print('No se pudo invocar el Tick (seguirá el cron): {}'.format(e))

    return {'status': True, 'statusCode': 200, 'description': 'Cascada iniciada', 'data': {'cascadeRunId': run_id}}
