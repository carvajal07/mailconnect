'''
Lambda para EDITAR una campaña existente.

Ruta: POST /Campaign/Update  (integración no-proxy, envelope estándar)
Request: { campaignId, campaignName?, channelName?, attachmentType?, dataPath?,
           template?, from? }

Solo se permite editar campañas en estado "Pendiente" (aún no enviadas ni con
muestras/enviando/terminadas), para no alterar procesos ya disparados. El cliente
se toma del context del Authorizer (multi-tenant): una campaña solo puede editarla
su dueño.
'''
import json
import boto3
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')

# Campos editables → nombre del atributo en la tabla campaign.
EDITABLE = {
    'campaignName': 'campaignName',
    'channelName': 'channel',
    'attachmentType': 'attachmentType',
    'dataPath': 'dataPath',
    'template': 'template',
    'from': 'originEmail',
    # Solo EAP: DOCX (combinación Word) / PDF (campos personalizados).
    'documentFormat': 'documentFormat',
}


def _get_payload(event):
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


def lambda_handler(event, context):
    payload = _get_payload(event)
    campaign_id = payload.get('campaignId')
    if not campaign_id:
        return {'status': False, 'statusCode': 400, 'description': 'Falta el campaignId.'}

    tenant_customer_id = _tenant_customer_id(event)  # confiable si viene del Authorizer

    try:
        # Buscar la campaña (por campaignId) y validar estado + dueño.
        resp = table_campaign.scan(FilterExpression=Attr('campaignId').eq(campaign_id))
        items = resp.get('Items', [])
        if not items:
            return {'status': False, 'statusCode': 404, 'description': 'Campaña no encontrada.'}
        campaign = items[0]

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
        return {'status': True, 'statusCode': 200, 'description': 'Campaña actualizada',
                'data': {'campaignId': campaign_id}}
    except Exception as e:
        print('Error actualizando campaña: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al actualizar la campaña'}
