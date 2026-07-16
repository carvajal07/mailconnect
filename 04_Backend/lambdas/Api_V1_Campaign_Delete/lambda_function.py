'''
Lambda para ELIMINAR una campaña: borra el registro de la tabla `campaign` (y sus
documentos asociados en `document`, best-effort). No borra el CSV de la base ni el
historial de procesos/envíos (queda como trazabilidad).

Ruta: POST /Campaign/Delete  (integración no-proxy, envelope estándar)
Request:  { campaignId }
Respuesta: 200 ok · 400 falta id · 403 la campaña es de otro cliente · 404 no existe

Verifica que la campaña pertenezca al cliente del token (Authorizer) antes de borrar.
'''
import json
import time
import uuid
import boto3

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')
table_document = dynamodb.Table('document')
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
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def _delete_documents(campaign_id):
    """Borra los documentos asociados a la campaña (EAU/EAP). Best-effort."""
    try:
        resp = table_document.scan(
            FilterExpression='campaignId = :c',
            ExpressionAttributeValues={':c': campaign_id},
            ProjectionExpression='documentId')
        for item in resp.get('Items', []):
            if item.get('documentId'):
                table_document.delete_item(Key={'documentId': item['documentId']})
    except Exception as e:
        print('No se pudieron borrar los documentos de la campaña (se continúa): {}'.format(e))


def lambda_handler(event, context):
    payload = _get_payload(event)
    campaign_id = payload.get('campaignId')
    auth = _authorizer(event)
    tenant_customer_id = auth.get('customerId')
    tenant_customer = auth.get('customer')

    if not (tenant_customer_id or tenant_customer):
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}
    if not campaign_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el campaignId.'}

    try:
        current = table_campaign.get_item(Key={'campaignId': campaign_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'La campaña no existe.'}

        # Aislamiento multi-tenant: la campaña debe ser del cliente del token.
        if tenant_customer_id and current.get('customerId') != tenant_customer_id:
            return {'status': False, 'statusCode': 403, 'description': 'La campaña pertenece a otro cliente.'}

        _delete_documents(campaign_id)
        table_campaign.delete_item(Key={'campaignId': campaign_id})
        _audit(event, 'campaign.delete', current.get('campaignName') or campaign_id,
               "Campaña '{}' ({}) eliminada".format(current.get('campaignName', ''), current.get('channel', '')))
        return {'status': True, 'statusCode': 200, 'description': 'Campaña eliminada correctamente.'}
    except Exception as e:
        print('Error eliminando la campaña: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al eliminar la campaña'}
