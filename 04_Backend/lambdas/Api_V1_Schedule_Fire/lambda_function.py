'''
Lambda: DISPARA un envío programado puntual (target del EventBridge Scheduler one-shot).

`Api_V1_Schedule_Create` crea, por cada campaña programada, un schedule de UNA SOLA VEZ
(`at(fecha exacta)`) cuyo target es ESTA lambda, con `Input = {"scheduleId": "..."}`. Al llegar
la hora, EventBridge la invoca: carga esa fila de `scheduledSend`, la reclama (transición
atómica `pending→firing`, idempotente) e invoca Prepare-batch con el MISMO evento del envío
on-demand → reutiliza todos los gates (aprobación, saldo, RBAC, lock). Marca `sent`/`failed`.

El schedule de un solo uso se autoelimina (ActionAfterCompletion=DELETE), así no queda basura.
NO es una ruta de API (no lleva Authorizer).

Env:
  PREPARE_BATCH_FUNCTION — nombre de la función Prepare-batch (default Api_V1_Email_Prepare-batch-template).
'''
import os
import json
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_schedule = dynamodb.Table('scheduledSend')
table_campaign = dynamodb.Table('campaign')
lambda_client = boto3.client('lambda')

PREPARE_BATCH_FUNCTION = os.environ.get('PREPARE_BATCH_FUNCTION', 'Api_V1_Email_Prepare-batch-template')


def _now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def _schedule_id_from_event(event):
    """El Input del schedule llega como el evento (dict) o como string JSON."""
    if isinstance(event, dict):
        sid = event.get('scheduleId')
        if sid:
            return sid
        # Por si viniera anidado en 'detail' u otra envoltura.
        detail = event.get('detail')
        if isinstance(detail, dict) and detail.get('scheduleId'):
            return detail['scheduleId']
        if isinstance(detail, str):
            try:
                return json.loads(detail).get('scheduleId')
            except Exception:
                return None
    if isinstance(event, str):
        try:
            return json.loads(event).get('scheduleId')
        except Exception:
            return None
    return None


def _claim(schedule_id):
    """Reclama la fila (pending→firing) de forma atómica. True si la tomó esta invocación."""
    try:
        table_schedule.update_item(
            Key={'scheduleId': schedule_id},
            UpdateExpression='SET #s = :f, firedAt = :t',
            ConditionExpression='#s = :p',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':f': 'firing', ':p': 'pending', ':t': _now_iso()})
        return True
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
            return False
        raise


def _mark(schedule_id, status, error='', process_id=''):
    try:
        # `status` y `error` son palabras reservadas de DynamoDB → alias.
        table_schedule.update_item(
            Key={'scheduleId': schedule_id},
            UpdateExpression='SET #s = :s, #err = :e, processId = :p',
            ExpressionAttributeNames={'#s': 'status', '#err': 'error'},
            ExpressionAttributeValues={':s': status, ':e': error[:300], ':p': process_id})
    except Exception as e:
        print('No se pudo marcar el envío {} como {}: {}'.format(schedule_id, status, e))


def _process_id_of(campaign_id):
    try:
        c = table_campaign.get_item(Key={'campaignId': campaign_id},
                                    ProjectionExpression='sendProcessId').get('Item') or {}
        return str(c.get('sendProcessId') or '')
    except Exception:
        return ''


def _invoke_prepare_batch(item):
    """Invoca Prepare-batch (envío real) con el evento equivalente al on-demand. Devuelve
    (ok, detalle). Aislada para poder mockearla en pruebas."""
    body = {
        'customerName': item.get('customer', ''),
        'campaignName': item.get('campaignName', ''),
        'userId': item.get('userId', ''),
        'template': item.get('template', ''),
        'templateVersion': int(item.get('templateVersion', 1) or 1),
    }
    event = {
        'resource': '/Email/Send-batch-template',
        'body': json.dumps(body),
        'requestContext': {'authorizer': {
            'customerId': item.get('customerId', ''),
            'customer': item.get('customer', ''),
            'nit': item.get('nit', ''),
            'userId': item.get('userId', ''),
            'tenantRole': item.get('tenantRole', 'owner') or 'owner',
        }},
    }
    resp = lambda_client.invoke(
        FunctionName=PREPARE_BATCH_FUNCTION,
        InvocationType='RequestResponse',
        Payload=json.dumps(event).encode('utf-8'))
    raw = resp.get('Payload')
    text = raw.read().decode('utf-8') if raw is not None else ''
    if resp.get('FunctionError'):
        return (False, 'Prepare-batch error: {}'.format(text[:250]))
    try:
        payload = json.loads(text)
    except Exception:
        return (False, 'Respuesta ilegible de Prepare-batch')
    inner = payload
    if isinstance(payload, dict) and isinstance(payload.get('body'), str):
        try:
            inner = json.loads(payload['body'])
        except Exception:
            inner = {}
    code = 0
    for k in ('status_code', 'statusCode'):
        try:
            code = int(inner.get(k)) if inner.get(k) is not None else code
        except (TypeError, ValueError):
            pass
    if not code and isinstance(payload, dict):
        try:
            code = int(payload.get('statusCode') or 0)
        except (TypeError, ValueError):
            code = 0
    ok = code == 200 or bool(inner.get('status'))
    return (ok, str(inner.get('description') or ('HTTP {}'.format(code))))


def lambda_handler(event, context):
    schedule_id = _schedule_id_from_event(event)
    if not schedule_id:
        print('Evento sin scheduleId: {}'.format(event))
        return {'statusCode': 400, 'body': json.dumps({'error': 'missing scheduleId'})}

    try:
        item = table_schedule.get_item(Key={'scheduleId': schedule_id}).get('Item')
    except ClientError as e:
        print('No se pudo leer el envío {}: {}'.format(schedule_id, e))
        return {'statusCode': 500, 'body': json.dumps({'error': 'read failed'})}
    if not item:
        print('El envío programado {} no existe (¿cancelado y borrado?).'.format(schedule_id))
        return {'statusCode': 404, 'body': json.dumps({'scheduleId': schedule_id, 'skipped': 'not found'})}
    if str(item.get('status')) != 'pending':
        # Cancelado, o ya disparado por un reintento/otra vía.
        return {'statusCode': 200, 'body': json.dumps({'scheduleId': schedule_id, 'skipped': str(item.get('status'))})}
    if not _claim(schedule_id):
        return {'statusCode': 200, 'body': json.dumps({'scheduleId': schedule_id, 'skipped': 'not-claimed'})}

    try:
        ok, detail = _invoke_prepare_batch(item)
    except Exception as e:
        ok, detail = False, 'Excepción al invocar: {}'.format(e)
    if ok:
        _mark(schedule_id, 'sent', error='', process_id=_process_id_of(item.get('campaignId')))
    else:
        _mark(schedule_id, 'failed', error=detail or 'fallo desconocido')
    print('Programado {}: {}'.format(schedule_id, 'enviado' if ok else 'falló ({})'.format(detail)))
    return {'statusCode': 200, 'body': json.dumps({'scheduleId': schedule_id, 'status': 'sent' if ok else 'failed'})}
