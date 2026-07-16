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
import uuid
from datetime import datetime
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')
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
    # RBAC: solo owner/approver pueden rechazar. Fail-open de rollout (default 'owner').
    tenant_role = str(auth.get('tenantRole', 'owner') or 'owner')
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
        return {'status': True, 'statusCode': 200, 'description': 'Campaña rechazada.'}
    except Exception as e:
        print('Error rechazando la campaña: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al rechazar la campaña'}
