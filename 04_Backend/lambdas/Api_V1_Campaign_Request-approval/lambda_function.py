'''
Lambda: SOLICITAR APROBACIÓN de una campaña (flujo maker-checker; ver PLAN_APROBACIONES.md).
El funcional que ya envió muestras solicita que un aprobador autorice el envío real.

Ruta: POST /Campaign/Request-approval  (no-proxy, envelope estándar)
Request:  { campaignId }
Respuesta: 200 ok · 400 (sin muestras) · 403 (otro cliente) · 404 · 409 (estado inválido)

Transición: approvalStatus none|rejected → pending (solo si samplesSentCount > 0 y la
campaña está en estado enviable Pendiente/Muestras). Multi-tenant por el token (Authorizer).
'''
import json
import os
import time
import uuid
from datetime import datetime
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')

# ─────────────────────────── Notificaciones al portal ───────────────────────────
# Helper COPIADO (convención del repo: las lambdas no comparten imports).
# Escribe en la tabla `notification`, que alimenta la campanita del portal.
# Es BEST-EFFORT: una notificación que no se pudo escribir jamás debe tumbar la
# operación del cliente, que es lo que de verdad importa.
_notif_table = dynamodb.Table('notification')

NOTIFY_TTL_DAYS = int(os.environ.get('NOTIFY_TTL_DAYS', '60'))


def _notify_users(user_ids, kind, title, body, level='info', link='', customer_id=''):
    """Crea una notificación in-app por cada usuario destinatario."""
    ahora = datetime.utcnow()
    expira = int(time.time()) + NOTIFY_TTL_DAYS * 86400
    for uid in {str(u) for u in (user_ids or []) if u}:
        try:
            _notif_table.put_item(Item={
                'notificationId': str(uuid.uuid4()),
                'userId': uid,
                'customerId': str(customer_id or ''),
                'kind': str(kind),
                'title': str(title)[:140],
                'body': str(body)[:500],
                'level': str(level),
                'link': str(link or ''),
                'read': False,
                # ISO con microsegundos: es la clave de ordenamiento del GSI y dos avisos
                # del mismo segundo tienen que quedar en orden estable.
                'createdAt': ahora.strftime('%Y-%m-%dT%H:%M:%S.%f'),
                'expiresAt': expira,
            })
        except Exception as e:
            print('No se pudo notificar a {}: {}'.format(uid, e))


def _tenant_users(customer_id, roles=None):
    """userIds ACTIVOS del tenant, opcionalmente filtrados por `tenantRole`."""
    try:
        resp = dynamodb.Table('user').scan(
            ProjectionExpression='userId, customerId, active, tenantRole')
        out = []
        for u in resp.get('Items', []):
            if str(u.get('customerId') or '') != str(customer_id):
                continue
            if u.get('active') is False:
                continue
            if roles and str(u.get('tenantRole') or 'owner') not in roles:
                continue
            out.append(str(u.get('userId') or ''))
        return [u for u in out if u]
    except Exception as e:
        print('No se pudieron listar los usuarios del tenant: {}'.format(e))
        return []


_audit_table = dynamodb.Table('adminAudit')


def _get_payload(event):
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


def _audit(event, action, target, detail):
    """Bitácora (adminAudit) best-effort — nunca rompe la operación."""
    try:
        auth = _authorizer(event)
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'cliente'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def lambda_handler(event, context):
    payload = _get_payload(event)
    campaign_id = payload.get('campaignId')
    auth = _authorizer(event)
    tenant_customer_id = auth.get('customerId')

    if not tenant_customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}
    if not campaign_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el campaignId.'}

    try:
        current = table_campaign.get_item(Key={'campaignId': campaign_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'La campaña no existe.'}
        if current.get('customerId') != tenant_customer_id:
            return {'status': False, 'statusCode': 403, 'description': 'La campaña pertenece a otro cliente.'}

        if int(current.get('samplesSentCount', 0) or 0) <= 0:
            return {'status': False, 'statusCode': 400,
                    'description': 'Envía al menos una muestra antes de solicitar la aprobación.'}

        approval = str(current.get('approvalStatus', 'none') or 'none')
        if approval == 'pending':
            return {'status': True, 'statusCode': 200, 'description': 'La aprobación ya estaba solicitada.'}
        if approval == 'approved':
            return {'status': False, 'statusCode': 409, 'description': 'La campaña ya fue aprobada.'}

        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        try:
            table_campaign.update_item(
                Key={'campaignId': campaign_id},
                UpdateExpression=('SET approvalStatus = :p, approvalRequestedBy = :by, '
                                  'approvalRequestedByName = :nm, approvalRequestedAt = :at '
                                  'REMOVE approvalRejectReason'),
                # Idempotente/seguro: solo transiciona desde none/rejected (o ausente).
                ConditionExpression='attribute_not_exists(approvalStatus) OR approvalStatus IN (:none, :rej)',
                ExpressionAttributeValues={
                    ':p': 'pending',
                    ':by': str(auth.get('userId') or ''),
                    ':nm': str(auth.get('user') or ''),
                    ':at': now,
                    ':none': 'none', ':rej': 'rejected',
                })
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                return {'status': False, 'statusCode': 409,
                        'description': 'La campaña no está en un estado que permita solicitar aprobación.'}
            raise

        _audit(event, 'campaign.request-approval', current.get('campaignName') or campaign_id,
               "Solicitud de aprobación de la campaña '{}' ({})".format(
                   current.get('campaignName', ''), current.get('channel', '')))

        # Avisa SOLO a quien puede aprobar (owner/approver). Un operator no puede hacer
        # nada con este aviso, así que mandárselo sería ruido. Se excluye a quien la
        # solicitó: ya sabe que la solicitó.
        aprobadores = [u for u in _tenant_users(tenant_customer_id, roles=('owner', 'approver'))
                       if u != str(auth.get('userId') or '')]
        _notify_users(
            aprobadores, 'campaign.approval',
            'Campaña por aprobar',
            "{} solicitó aprobar la campaña '{}'.".format(
                auth.get('user') or 'Un usuario', current.get('campaignName', '')),
            level='warning', link='aprobaciones', customer_id=tenant_customer_id)
        return {'status': True, 'statusCode': 200, 'description': 'Aprobación solicitada.'}
    except Exception as e:
        print('Error solicitando aprobación: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al solicitar la aprobación'}
