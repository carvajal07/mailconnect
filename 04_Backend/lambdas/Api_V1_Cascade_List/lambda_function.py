'''
Cascada omnicanal — LISTAR los runs del cliente (tenant del token).
Ruta: POST /Cascade/List  {}  (no-proxy, envelope).
Respuesta: 200 { data:{ runs:[{cascadeRunId, name, status, confirmOn, steps(canales),
                                counts, createdAt, startedAt, finishedAt}], count } }
'''
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

REGION = 'us-east-1'
GSI = os.environ.get('GSI_CUSTOMER_INDEX', 'customerId-index')
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_run = dynamodb.Table('cascadeRun')


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.',
                'data': {'runs': [], 'count': 0}}
    try:
        items = []
        kwargs = {'IndexName': GSI, 'KeyConditionExpression': Key('customerId').eq(customer_id)}
        while True:
            r = table_run.query(**kwargs)
            items.extend(r.get('Items', []))
            if not r.get('LastEvaluatedKey'):
                break
            kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']
    except Exception as e:
        print('Error listando cascadas: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error al listar', 'data': {'runs': [], 'count': 0}}

    items.sort(key=lambda x: str(x.get('createdAt', '')), reverse=True)
    runs = [{
        'cascadeRunId': it.get('cascadeRunId'),
        'name': it.get('name'),
        'status': it.get('status'),
        'confirmOn': it.get('confirmOn'),
        'channels': [s.get('channel') for s in (it.get('steps') or [])],
        'counts': it.get('counts') or {},
        'budgetCap': it.get('budgetCap'),
        'createdAt': it.get('createdAt'),
        'startedAt': it.get('startedAt'),
        'finishedAt': it.get('finishedAt'),
    } for it in items]
    return {'status': True, 'statusCode': 200, 'description': 'Cascadas del cliente',
            'data': {'runs': runs, 'count': len(runs)}}
