'''
Lambda: BARRIDO de respaldo de envíos programados (cron) — OPCIONAL.

⚠️ El disparo PRINCIPAL es por HORA EXACTA: `Schedule_Create` crea un EventBridge Scheduler
de una sola vez por campaña cuyo target es `Api_V1_Schedule_Fire`. ESTA lambda es un
**barrido de respaldo OPCIONAL** (belt-and-suspenders): si se la conecta a una regla de baja
frecuencia (p. ej. cada 15-30 min), recoge cualquier fila `pending` cuya hora ya pasó pero
cuyo schedule one-shot no llegó a dispararse (create_schedule falló silenciosamente, se borró
el schedule, etc.). Si confías solo en el one-shot, puedes NO desplegar este cron.

Busca en `scheduledSend` los envíos `pending` cuya fecha ya llegó (`scheduledAt <= ahora`) y,
por cada uno, dispara el ENVÍO REAL invocando Prepare-batch con el MISMO evento del envío
on-demand → reutiliza todos los gates (aprobación, saldo, RBAC, lock) sin duplicar lógica.
NO es una ruta de API Gateway (no lleva Authorizer): es un worker interno.

Idempotencia: cada fila se "reclama" con una transición atómica `pending→firing` (condicional)
antes de invocar; ni el one-shot Fire ni este barrido la disparan dos veces (la reclamación +
el lock de Prepare-batch, `try_start_real_send`, lo garantizan aunque coincidan).

Env:
  PREPARE_BATCH_FUNCTION — nombre de la función Prepare-batch (default Api_V1_Email_Prepare-batch-template).
  SCHEDULE_MAX_BATCH     — tope de envíos a disparar por corrida (default 50).
'''
import os
import json
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_schedule = dynamodb.Table('scheduledSend')
table_campaign = dynamodb.Table('campaign')
lambda_client = boto3.client('lambda')

PREPARE_BATCH_FUNCTION = os.environ.get('PREPARE_BATCH_FUNCTION', 'Api_V1_Email_Prepare-batch-template')
MAX_BATCH = int(os.environ.get('SCHEDULE_MAX_BATCH', '50'))


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().strftime('%Y-%m-%dT%H:%M:%S.000Z')


def _parse_iso(value):
    s = str(value or '').strip()
    if not s:
        return None
    try:
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


def _due_items(now_dt):
    """Filas `pending` cuya fecha ya llegó (scheduledAt <= ahora). Pagina el scan; [] si la
    tabla no existe."""
    items = []
    kwargs = {'FilterExpression': Attr('status').eq('pending')}
    try:
        while True:
            resp = table_schedule.scan(**kwargs)
            for it in resp.get('Items', []):
                dt = _parse_iso(it.get('scheduledAt'))
                if dt is not None and dt <= now_dt:
                    items.append(it)
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    items.sort(key=lambda x: str(x.get('scheduledAt', '')))
    return items[:MAX_BATCH]


def _claim(schedule_id):
    """Reclama la fila (pending→firing) de forma atómica. True si la tomó esta corrida."""
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
        # `status` y `error` son palabras reservadas de DynamoDB → alias con ExpressionAttributeNames.
        table_schedule.update_item(
            Key={'scheduleId': schedule_id},
            UpdateExpression='SET #s = :s, #err = :e, processId = :p',
            ExpressionAttributeNames={'#s': 'status', '#err': 'error'},
            ExpressionAttributeValues={':s': status, ':e': error[:300], ':p': process_id})
    except Exception as e:
        print('No se pudo marcar el envío {} como {}: {}'.format(schedule_id, status, e))


def _process_id_of(campaign_id):
    """processId del envío real recién disparado (best-effort, para trazabilidad)."""
    try:
        c = table_campaign.get_item(Key={'campaignId': campaign_id},
                                    ProjectionExpression='sendProcessId').get('Item') or {}
        return str(c.get('sendProcessId') or '')
    except Exception:
        return ''


def _invoke_prepare_batch(item):
    """Invoca Prepare-batch (envío real) con el evento equivalente al on-demand. Devuelve
    (ok, detalle). Función aislada para poder mockearla en pruebas."""
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
    # Prepare-batch (ruta API) responde {statusCode, body: json {status, status_code, description}}.
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
    now_dt = _now()
    items = _due_items(now_dt)
    fired = sent = failed = 0
    for it in items:
        sid = it.get('scheduleId')
        if not sid or not _claim(sid):
            continue  # ya no está pending (cancelado, o lo tomó otra corrida)
        fired += 1
        try:
            ok, detail = _invoke_prepare_batch(it)
        except Exception as e:
            ok, detail = False, 'Excepción al invocar: {}'.format(e)
        if ok:
            _mark(sid, 'sent', error='', process_id=_process_id_of(it.get('campaignId')))
            sent += 1
        else:
            _mark(sid, 'failed', error=detail or 'fallo desconocido')
            failed += 1
        print('Programado {}: {}'.format(sid, 'enviado' if ok else 'falló ({})'.format(detail)))

    return {'statusCode': 200,
            'body': json.dumps({'due': len(items), 'fired': fired, 'sent': sent, 'failed': failed})}
