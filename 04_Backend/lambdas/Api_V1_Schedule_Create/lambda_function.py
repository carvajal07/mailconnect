'''
Lambda: PROGRAMAR el envío real de una campaña para una fecha/hora futura.

El cliente elige una campaña aprobada/lista y una fecha-hora (UTC ISO 8601). Se guarda una
fila `pending` en la tabla `scheduledSend` con TODO el contexto necesario para refirir el
envío real más tarde (lo hace `Api_V1_Schedule_Dispatch`, un cron, invocando la MISMA lambda
Prepare-batch-template que usa el envío on-demand → se reutilizan los gates de aprobación,
saldo y RBAC; no se duplica lógica).

Ruta: POST /Schedule/Create  (no-proxy, envelope estándar)
Request:  { campaignId, scheduledAt (ISO UTC, ej. 2026-07-20T15:30:00.000Z), templateVersion? }
Respuesta: 201 data:{ scheduleId, scheduledAt, status:'pending' } · 400 · 403 · 404 · 409

Gates en la creación (los DUROS —saldo, lock— se revalidan al disparar):
  - RBAC: programar es una acción de envío → solo owner/approver.
  - La campaña debe existir y ser del tenant, no estar ya en envío, y no estar
    pending/rejected de aprobación (mismo criterio que Prepare-batch).
'''
import os
import json
import time
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_schedule = dynamodb.Table('scheduledSend')
table_campaign = dynamodb.Table('campaign')
scheduler_client = boto3.client('scheduler')

# Estados de campaña en los que YA NO tiene sentido programar (ya salió o terminó).
NON_SCHEDULABLE_STATES = ('Enviando', 'Procesando', 'Terminada')

# EventBridge Scheduler: se crea un schedule de UNA sola vez por campaña (hora EXACTA). El
# target es la lambda Api_V1_Schedule_Fire; el schedule se autoelimina al dispararse.
FIRE_LAMBDA_ARN = os.environ.get('SCHEDULER_FIRE_LAMBDA_ARN', '')     # ARN de Api_V1_Schedule_Fire
SCHEDULER_ROLE_ARN = os.environ.get('SCHEDULER_ROLE_ARN', '')        # rol que EventBridge Scheduler asume para invocar
SCHEDULER_GROUP = os.environ.get('SCHEDULER_GROUP', 'default')
SCHEDULE_NAME_PREFIX = 'mc-send-'   # nombre del schedule = prefijo + scheduleId (derivable en Cancel)


def _schedule_event(schedule_id, scheduled_dt):
    """Crea el schedule de una sola vez que disparará el envío a la hora EXACTA. Lanza si el
    scheduling no está configurado (env) o si la API de EventBridge falla → el caller hace
    rollback de la fila. Aislada para poder mockearla en pruebas."""
    if not FIRE_LAMBDA_ARN or not SCHEDULER_ROLE_ARN:
        raise RuntimeError('Scheduling no configurado: faltan SCHEDULER_FIRE_LAMBDA_ARN / SCHEDULER_ROLE_ARN.')
    at_expr = 'at({})'.format(scheduled_dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'))
    scheduler_client.create_schedule(
        Name=SCHEDULE_NAME_PREFIX + schedule_id,
        GroupName=SCHEDULER_GROUP,
        ScheduleExpression=at_expr,
        ScheduleExpressionTimezone='UTC',
        FlexibleTimeWindow={'Mode': 'OFF'},        # dispara a la hora exacta (sin ventana)
        ActionAfterCompletion='DELETE',            # el schedule de un solo uso se limpia solo
        Target={'Arn': FIRE_LAMBDA_ARN, 'RoleArn': SCHEDULER_ROLE_ARN,
                'Input': json.dumps({'scheduleId': schedule_id})})


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


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _parse_iso(value):
    """Parsea un ISO 8601 UTC (acepta el sufijo 'Z'). Devuelve datetime aware o None."""
    s = str(value or '').strip()
    if not s:
        return None
    try:
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _ensure_table():
    """Crea `scheduledSend` si no existe (PK scheduleId + GSI customerId-index)."""
    try:
        dynamodb.meta.client.describe_table(TableName='scheduledSend')
        return
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
    try:
        dynamodb.create_table(
            TableName='scheduledSend',
            KeySchema=[{'AttributeName': 'scheduleId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[
                {'AttributeName': 'scheduleId', 'AttributeType': 'S'},
                {'AttributeName': 'customerId', 'AttributeType': 'S'},
            ],
            GlobalSecondaryIndexes=[{
                'IndexName': 'customerId-index',
                'KeySchema': [{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
                'Projection': {'ProjectionType': 'ALL'},
            }],
            BillingMode='PAY_PER_REQUEST')
        dynamodb.meta.client.get_waiter('table_exists').wait(
            TableName='scheduledSend', WaiterConfig={'Delay': 2, 'MaxAttempts': 30})
        print('Tabla scheduledSend creada.')
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceInUseException':
            raise


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    customer = auth.get('customer') or ''
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    # RBAC: programar un envío real = acción de envío → owner/approver (default owner si falta).
    tenant_role = str(auth.get('tenantRole', 'owner') or 'owner')
    if tenant_role not in ('owner', 'approver'):
        return {'status': False, 'statusCode': 403,
                'description': 'Tu rol no permite programar envíos. Pídelo a un aprobador de tu empresa.'}

    payload = _get_payload(event)
    campaign_id = str(payload.get('campaignId', '') or '').strip()
    if not campaign_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el campaignId.'}

    # Fecha-hora futura (UTC).
    scheduled_dt = _parse_iso(payload.get('scheduledAt'))
    if not scheduled_dt:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica una fecha y hora válidas (scheduledAt en ISO 8601).'}
    now = datetime.now(timezone.utc)
    if scheduled_dt <= now:
        return {'status': False, 'statusCode': 400,
                'description': 'La fecha y hora deben ser futuras.'}

    try:
        campaign = table_campaign.get_item(Key={'campaignId': campaign_id}).get('Item')
        if not campaign:
            return {'status': False, 'statusCode': 404, 'description': 'La campaña no existe.'}
        if str(campaign.get('customerId')) != str(customer_id):
            return {'status': False, 'statusCode': 403, 'description': 'La campaña pertenece a otro cliente.'}

        state = str(campaign.get('campaignState', 'Pendiente'))
        if state in NON_SCHEDULABLE_STATES:
            return {'status': False, 'statusCode': 409,
                    'description': 'La campaña ya está en envío o terminada; no se puede programar.'}
        approval = str(campaign.get('approvalStatus', 'none') or 'none')
        if approval in ('pending', 'rejected'):
            return {'status': False, 'statusCode': 409,
                    'description': 'La campaña requiere aprobación antes de programar el envío.'}

        _ensure_table()
        schedule_id = str(uuid.uuid4())
        scheduled_at = scheduled_dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        try:
            template_version = int(payload.get('templateVersion', 1) or 1)
        except (TypeError, ValueError):
            template_version = 1

        table_schedule.put_item(Item={
            'scheduleId': schedule_id,
            'customerId': customer_id,
            'customer': customer,                              # nombre de empresa = customerName del envío
            'nit': str(auth.get('nit') or ''),                 # llave de tablas por cliente en Prepare-batch
            'userId': str(auth.get('userId') or ''),
            'tenantRole': tenant_role,                          # para pasar el gate RBAC al refirir
            'campaignId': campaign_id,
            'campaignName': campaign.get('campaignName', ''),
            'template': campaign.get('template', ''),
            'templateVersion': template_version,
            'scheduledAt': scheduled_at,
            'status': 'pending',                                # pending | firing | sent | canceled | failed
            'scheduleName': SCHEDULE_NAME_PREFIX + schedule_id, # nombre del schedule EventBridge (para Cancel)
            'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()),
            'firedAt': '',
            'processId': '',
            'error': '',
        })

        # Crea el schedule de HORA EXACTA (EventBridge Scheduler). Si falla, se hace ROLLBACK
        # de la fila para no dejar un envío "pending" que nunca se dispararía.
        try:
            _schedule_event(schedule_id, scheduled_dt)
        except Exception as e:
            print('No se pudo crear el schedule de {}: {}'.format(schedule_id, e))
            try:
                table_schedule.delete_item(Key={'scheduleId': schedule_id})
            except Exception as del_e:
                print('No se pudo revertir la fila {}: {}'.format(schedule_id, del_e))
            return {'status': False, 'statusCode': 500,
                    'description': 'No se pudo agendar el disparo del envío. Intenta de nuevo.'}

        return {'status': True, 'statusCode': 201,
                'description': 'Envío programado.',
                'data': {'scheduleId': schedule_id, 'scheduledAt': scheduled_at, 'status': 'pending'}}
    except ClientError as e:
        print('Error programando el envío: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo programar el envío.'}
    except Exception as e:
        print('Error no controlado al programar: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al programar el envío.'}
