'''
CASCADA omnicanal — LISTADO. POST /Cascade/List (no-proxy, envelope).
Devuelve las cascadas (cascadeRun) del tenant con su progreso agregado (counts), recientes
primero. El tenant SIEMPRE sale del Authorizer (multi-tenant). Ver PLAN_CASCADA.md.
'''
import os
import json
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table_run = dynamodb.Table('cascadeRun')
GSI_CUSTOMER_INDEX = os.environ.get('GSI_CASCADE_CUSTOMER_INDEX', 'customerId-index')


def _clean(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _tenant(event):
    auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
    return auth.get('customerId')


def lambda_handler(event, context):
    customer_id = _tenant(event)
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.',
                'data': {'runs': [], 'count': 0}}
    try:
        items = []
        kwargs = {'IndexName': GSI_CUSTOMER_INDEX, 'KeyConditionExpression': Key('customerId').eq(customer_id)}
        while True:
            resp = table_run.query(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
        runs = [_clean(i) for i in items]
        runs.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
        return {'status': True, 'statusCode': 200, 'description': 'Cascadas del cliente',
                'data': {'runs': runs, 'count': len(runs)}}
    except Exception as e:
        print('Error listando cascadas: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al listar cascadas',
                'data': {'runs': [], 'count': 0}}
