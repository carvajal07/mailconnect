'''
Lambda: APROBAR una campaña (flujo maker-checker; ver PLAN_APROBACIONES.md).
Un aprobador autoriza la campaña; queda habilitado el envío real.

Ruta: POST /Campaign/Approve  (no-proxy, envelope estándar)
Request:  { campaignId }
Respuesta: 200 ok · 403 (otro cliente) · 404 · 409 (no está pendiente)

Transición: approvalStatus pending → approved. Multi-tenant por el token (Authorizer).
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

        approval = str(current.get('approvalStatus', 'none') or 'none')
        if approval == 'approved':
            return {'status': True, 'statusCode': 200, 'description': 'La campaña ya estaba aprobada.'}
        if approval != 'pending':
            return {'status': False, 'statusCode': 409,
                    'description': 'Solo se pueden aprobar campañas con aprobación pendiente.'}

        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        try:
            table_campaign.update_item(
                Key={'campaignId': campaign_id},
                UpdateExpression=('SET approvalStatus = :a, approvalReviewedBy = :by, '
                                  'approvalReviewedByName = :nm, approvalReviewedAt = :at '
                                  'REMOVE approvalRejectReason'),
                ConditionExpression='approvalStatus = :pending',
                ExpressionAttributeValues={
                    ':a': 'approved',
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

        _audit(event, 'campaign.approve', current.get('campaignName') or campaign_id,
               "Aprobación de la campaña '{}' ({})".format(
                   current.get('campaignName', ''), current.get('channel', '')))
        return {'status': True, 'statusCode': 200, 'description': 'Campaña aprobada.'}
    except Exception as e:
        print('Error aprobando la campaña: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al aprobar la campaña'}
