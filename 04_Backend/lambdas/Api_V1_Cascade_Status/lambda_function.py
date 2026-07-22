'''
Cascada omnicanal — DETALLE de un run (definición + contadores + muestra de contactos).
Ruta: POST /Cascade/Status  { cascadeRunId, sample? }  (no-proxy, envelope).
Respuesta: 200 { data:{ run, contacts:[...muestra], byChannel:{canal:{sent,confirmed,...}} } }
· 403 · 404. Recalcula los contadores desde los contactos (fuente de verdad).
'''
import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

REGION = 'us-east-1'
SAMPLE_MAX = 50
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_run = dynamodb.Table('cascadeRun')
table_contact = dynamodb.Table('cascadeContact')


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


def _n(v):
    return int(v) if isinstance(v, Decimal) else v


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

    # Recorre los contactos: contadores por estado y por canal + una muestra.
    counts = {'total': 0, 'confirmed': 0, 'exhausted': 0, 'inProgress': 0, 'spent': 0}
    by_channel = {}
    sample = []
    kwargs = {'IndexName': 'cascadeRunId-index', 'KeyConditionExpression': Key('cascadeRunId').eq(run_id)}
    try:
        while True:
            r = table_contact.query(**kwargs)
            for it in r.get('Items', []):
                counts['total'] += 1
                counts['spent'] += _n(it.get('spent', 0)) or 0
                st = it.get('status')
                if st == 'confirmed':
                    counts['confirmed'] += 1
                elif st == 'exhausted':
                    counts['exhausted'] += 1
                elif st in ('pending', 'awaiting', 'sending'):
                    counts['inProgress'] += 1
                ch = it.get('currentChannel') or ''
                if ch:
                    b = by_channel.setdefault(ch, {'attempts': 0, 'confirmed': 0})
                    b['attempts'] += 1
                    if st == 'confirmed':
                        b['confirmed'] += 1
                if len(sample) < SAMPLE_MAX:
                    sample.append({
                        'cascadeContactId': it.get('cascadeContactId'),
                        'contactId': it.get('contactId'),
                        'name': it.get('name'),
                        'email': it.get('email'),
                        'phone': it.get('phone'),
                        'status': st,
                        'currentChannel': ch,
                        'stepIndex': _n(it.get('stepIndex', 0)),
                        'spent': _n(it.get('spent', 0)),
                        'attempts': it.get('attempts') or [],
                    })
            if not r.get('LastEvaluatedKey'):
                break
            kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']
    except Exception as e:
        print('Error leyendo contactos: {}'.format(e))

    run_out = {
        'cascadeRunId': run.get('cascadeRunId'), 'name': run.get('name'),
        'status': run.get('status'), 'confirmOn': run.get('confirmOn'),
        'stepTimeoutMin': _n(run.get('stepTimeoutMin', 60)), 'budgetCap': _n(run.get('budgetCap', 0)),
        'steps': run.get('steps') or [], 'counts': counts,
        'createdAt': run.get('createdAt'), 'startedAt': run.get('startedAt'), 'finishedAt': run.get('finishedAt'),
    }
    return {'status': True, 'statusCode': 200, 'description': 'Detalle de la cascada',
            'data': {'run': run_out, 'contacts': sample, 'byChannel': by_channel}}
