'''
Lambda ADMIN: REINTENTAR / REENCOLAR un envío atascado.

Un proceso de envío real (Fase 4) trocea el CSV en part-files (S3: _parts/{processId}/N.json)
y encola un trabajo por parte. Si un worker se cae o SQS pierde un mensaje, algunas partes
quedan sin procesar y el proceso se queda "Procesando" sin avanzar. Esta lambda RE-ENCOLA
SOLO las partes que no se completaron (las que no están en `processedParts`), reconstruyendo
el trabajo desde el contexto que Prepare-batch guardó en la fila del proceso (`resumeCtx`).

Es SEGURO: el worker (procesar_parte) salta las partes ya terminadas (idempotencia por
`processedParts`) y deduplica el encolado al canal por (processId, part). Reintentar dos
veces no duplica envíos.

Ruta: POST /Admin/Requeue  (integración no-proxy, envelope estándar)
Request:  { processId }
Respuesta: 200 { data: { processId, parts, done, requeued, pendingParts:[...] } }
           · 400 falta processId · 404 proceso no existe · 409 sin contexto de reanudación

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue. Permisos: GetItem sobre
`process`; `sqs:SendMessage` sobre la cola Email_Prepare-batch-part; PutItem sobre `adminAudit`.
'''
import os
import json
import time
import uuid
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
sqs = boto3.client('sqs', region_name=REGION)
table_process = dynamodb.Table('process')
_audit_table = dynamodb.Table('adminAudit')

# Misma cola de partes que usa Prepare-batch (URL_SQS_PREPARE_PART).
URL_SQS_PREPARE_PART = os.environ.get(
    'URL_SQS_PREPARE_PART',
    'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Prepare-batch-part')


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


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def _audit(event, action, target, detail):
    """Bitácora (adminAudit) best-effort."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'admin'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def _to_int(v):
    if isinstance(v, Decimal):
        return int(v)
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _clean(v):
    """Normaliza Decimals (de DynamoDB) a int/float para poder serializar el job a JSON."""
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, set):
        return [_clean(x) for x in v]
    return v


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    process_id = str(payload.get('processId', '') or '').strip()
    if not process_id:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica el processId a reintentar.', 'data': {}}

    try:
        item = table_process.get_item(Key={'processId': process_id}).get('Item')
        if not item:
            return {'status': False, 'statusCode': 404,
                    'description': 'El proceso no existe.', 'data': {}}

        parts = _to_int(item.get('parts'))
        resume = item.get('resumeCtx')
        if parts <= 0 or not resume or not resume.get('ctx'):
            return {'status': False, 'statusCode': 409,
                    'description': 'Este proceso no tiene contexto de reanudación (se creó '
                                   'antes de esta función o no es un envío troceado). No se '
                                   'puede reintentar automáticamente.',
                    'data': {}}

        processed = item.get('processedParts') or set()
        # processedParts es un String Set en DynamoDB → set de strings.
        done = set(str(p) for p in processed)

        pending = [p for p in range(1, parts + 1) if str(p) not in done]
        if not pending:
            return {'status': True, 'statusCode': 200,
                    'description': 'No hay partes pendientes; el proceso ya está completo.',
                    'data': {'processId': process_id, 'parts': parts,
                             'done': len(done), 'requeued': 0, 'pendingParts': []}}

        ctx = _clean(resume.get('ctx') or {})
        bucket = resume.get('bucket')
        channel_queue = resume.get('channelQueue')
        registers_for_message = _to_int(resume.get('registersForMessage'))
        unsubscribe_existed = bool(resume.get('unsubscribeExisted'))
        blacklist_existed = bool(resume.get('blacklistExisted'))

        requeued = 0
        for part in pending:
            job = dict(ctx)
            job.update({
                'prepareJob': True,
                'part': part,
                'partKey': '_parts/{}/{}.json'.format(process_id, part),
                'bucket': bucket,
                'channelQueue': channel_queue,
                'registersForMessage': registers_for_message,
                'unsubscribeExisted': unsubscribe_existed,
                'blacklistExisted': blacklist_existed,
            })
            sqs.send_message(QueueUrl=URL_SQS_PREPARE_PART, MessageBody=json.dumps(job))
            requeued += 1

        _audit(event, 'job.requeue', item.get('campaignName') or process_id,
               'Reencoladas {} de {} parte(s) pendientes del proceso {}'.format(
                   requeued, parts, process_id))

        return {'status': True, 'statusCode': 200,
                'description': 'Se reencolaron {} parte(s) pendiente(s).'.format(requeued),
                'data': {'processId': process_id, 'parts': parts, 'done': len(done),
                         'requeued': requeued, 'pendingParts': pending}}
    except ClientError as e:
        print('Error reencolando: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al reintentar el proceso', 'data': {}}
    except Exception as e:
        print('Error reencolando: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al reintentar el proceso', 'data': {}}
