'''
Cascada omnicanal — CANCELAR un run (deja de enviar/escalar).
Ruta: POST /Cascade/Cancel  { cascadeRunId }  (no-proxy, envelope).
draft/running/paused → canceled. Los contactos ya confirmados/enviados no se tocan.
Respuesta: 200 ok · 403 · 404 · 409 (ya terminada/cancelada).
'''
import json
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
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

    try:
        table_run.update_item(
            Key={'cascadeRunId': run_id},
            UpdateExpression='SET #s = :c, finishedAt = :now',
            ConditionExpression='#s IN (:draft, :running, :paused)',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':c': 'canceled', ':draft': 'draft', ':running': 'running',
                                       ':paused': 'paused',
                                       ':now': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')})
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return {'status': False, 'statusCode': 409,
                    'description': 'La cascada ya está {}.'.format(run.get('status')), 'data': {}}
        raise
    return {'status': True, 'statusCode': 200, 'description': 'Cascada cancelada', 'data': {'cascadeRunId': run_id}}
