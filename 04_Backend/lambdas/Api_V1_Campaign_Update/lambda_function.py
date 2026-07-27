'''
Lambda para EDITAR una campaña existente.

Ruta: POST /Campaign/Update  (integración no-proxy, envelope estándar)
Request: { campaignId, campaignName?, channelName?, attachmentType?, dataPath?,
           template?, messageTemplateId?, from? }

Solo se permite editar campañas en estado "Pendiente" (aún no enviadas ni con
muestras/enviando/terminadas), para no alterar procesos ya disparados. El cliente
se toma del context del Authorizer (multi-tenant): una campaña solo puede editarla
su dueño.
'''
import json
import os
import time
import uuid
import boto3
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')
_audit_table = dynamodb.Table('adminAudit')

# Campos editables → nombre del atributo en la tabla campaign.
EDITABLE = {
    'campaignName': 'campaignName',
    'channelName': 'channel',
    'attachmentType': 'attachmentType',
    'dataPath': 'dataPath',
    'template': 'template',
    # Referencia a la plantilla de mensaje SMS/WSP (para que el envío resuelva el contenido
    # en vivo). Vacío ('') = sin referencia → el envío cae al snapshot de `template`.
    'messageTemplateId': 'messageTemplateId',
    'from': 'originEmail',
    # Solo EAP: DOCX (combinación Word) / PDF (campos personalizados).
    'documentFormat': 'documentFormat',
}


def _get_payload(event):
    # API Gateway (mapping template) puede inyectar el body como OBJETO JSON
    # (integración no-proxy) o como STRING (proxy). Se aceptan ambos.
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _tenant_customer_id(event):
    if not isinstance(event, dict):
        return ''
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth.get('customerId', '') if isinstance(auth, dict) else ''




def _resolve_tenant(event, payload):
    """(customerId, customer) del token (Authorizer). Multi-tenant OBLIGATORIO:
    el tenant nunca sale del body; si el context no llega, el handler deniega."""
    # El tenant SIEMPRE sale del token (Authorizer); NUNCA del body.
    a = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
    return a.get('customerId'), a.get('customer')


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


def lambda_handler(event, context):
    payload = _get_payload(event)
    campaign_id = payload.get('campaignId')
    if not campaign_id:
        return {'status': False, 'statusCode': 400, 'description': 'Falta el campaignId.'}

    tenant_customer_id, _tenant_customer = _resolve_tenant(event, payload)  # confiable si viene del Authorizer
    if not tenant_customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    try:
        # campaignId es la PK de campaign: GetItem O(1) en vez de Scan O(tabla).
        campaign = table_campaign.get_item(Key={'campaignId': campaign_id}).get('Item')
        if not campaign:
            return {'status': False, 'statusCode': 404, 'description': 'Campaña no encontrada.'}

        if tenant_customer_id and campaign.get('customerId') != tenant_customer_id:
            return {'status': False, 'statusCode': 403, 'description': 'La campaña no pertenece a tu cuenta.'}

        state = campaign.get('campaignState', '')
        if state != 'Pendiente':
            return {'status': False, 'statusCode': 409,
                    'description': f'Solo se pueden editar campañas en estado "Pendiente" (esta está en "{state}").'}

        # Construir la actualización solo con los campos enviados.
        set_parts, names, values = [], {}, {}
        for key, attr in EDITABLE.items():
            if key in payload and payload[key] is not None:
                set_parts.append(f'#{attr} = :{attr}')
                names[f'#{attr}'] = attr
                values[f':{attr}'] = payload[key]

        if not set_parts:
            return {'status': False, 'statusCode': 400, 'description': 'No hay campos para actualizar.'}

        table_campaign.update_item(
            Key={'campaignId': campaign_id},
            UpdateExpression='SET ' + ', '.join(set_parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
        # Crear/borrar/aprobar/rechazar ya se auditaban; EDITAR no, y es justo lo que
        # puede cambiar destinatarios, plantilla o remitente antes del envío. Se registran
        # los campos tocados (no los valores: pueden ser HTML o rutas largas).
        _audit(event, 'campaign.update', campaign.get('campaignName') or campaign_id,
               'Campos editados: {}'.format(', '.join(sorted(
                   k for k in EDITABLE if k in payload and payload[k] is not None))))
        return {'status': True, 'statusCode': 200, 'description': 'Campaña actualizada',
                'data': {'campaignId': campaign_id}}
    except Exception as e:
        print('Error actualizando campaña: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al actualizar la campaña'}
