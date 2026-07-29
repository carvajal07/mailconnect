'''
Lambda: RECHAZAR una campaña (flujo maker-checker; ver PLAN_APROBACIONES.md).
Un aprobador rechaza la campaña con un motivo; vuelve al funcional para corregir.

Ruta: POST /Campaign/Reject  (no-proxy, envelope estándar)
Request:  { campaignId, reason }
Respuesta: 200 ok · 400 (sin motivo) · 403 (otro cliente) · 404 · 409 (no está pendiente)

Transición: approvalStatus pending → rejected (+ motivo). Multi-tenant por el token.
En la Fase 2 se endurece para exigir tenantRole owner|approver.
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
    reason = str(payload.get('reason', '') or '').strip()
    auth = _authorizer(event)
    tenant_customer_id = auth.get('customerId')

    if not tenant_customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}
    # RBAC (maker-checker): solo owner/approver pueden rechazar. Fail-CLOSED: si el context no
    # trae tenantRole, default al MENOR privilegio ('operator') → denegado (ver Campaign_Approve).
    tenant_role = str(auth.get('tenantRole', 'operator') or 'operator')
    if tenant_role not in ('owner', 'approver'):
        return {'status': False, 'statusCode': 403,
                'description': 'Tu rol no permite rechazar campañas.'}
    if not campaign_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el campaignId.'}
    if not reason:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el motivo del rechazo.'}

    try:
        current = table_campaign.get_item(Key={'campaignId': campaign_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'La campaña no existe.'}
        if current.get('customerId') != tenant_customer_id:
            return {'status': False, 'statusCode': 403, 'description': 'La campaña pertenece a otro cliente.'}

        approval = str(current.get('approvalStatus', 'none') or 'none')
        if approval != 'pending':
            return {'status': False, 'statusCode': 409,
                    'description': 'Solo se pueden rechazar campañas con aprobación pendiente.'}

        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        try:
            table_campaign.update_item(
                Key={'campaignId': campaign_id},
                UpdateExpression=('SET approvalStatus = :r, approvalRejectReason = :reason, '
                                  'approvalReviewedBy = :by, approvalReviewedByName = :nm, '
                                  'approvalReviewedAt = :at'),
                ConditionExpression='approvalStatus = :pending',
                ExpressionAttributeValues={
                    ':r': 'rejected',
                    ':reason': reason[:280],
                    ':by': str(auth.get('userId') or ''),
                    ':nm': str(auth.get('user') or ''),
                    ':at': now,
                    ':pending': 'pending',
                })
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                return {'status': False, 'statusCode': 409,
                        'description': 'La campaña ya no está pendiente de aprobación.'}
            raise

        _audit(event, 'campaign.reject', current.get('campaignName') or campaign_id,
               "Rechazo de la campaña '{}' ({}): {}".format(
                   current.get('campaignName', ''), current.get('channel', ''), reason[:120]))

        # El motivo va DENTRO del aviso: sin él, el usuario tiene que ir a buscarlo y el
        # rechazo se siente arbitrario.
        _notify_users(
            [str(current.get('approvalRequestedBy') or '')], 'campaign.rejected',
            'Campaña rechazada',
            "Tu campaña '{}' fue rechazada por {}. Motivo: {}".format(
                current.get('campaignName', ''), auth.get('user') or 'un aprobador', reason),
            level='error', link='campanas', customer_id=tenant_customer_id)
        return {'status': True, 'statusCode': 200, 'description': 'Campaña rechazada.'}
    except Exception as e:
        print('Error rechazando la campaña: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al rechazar la campaña'}
