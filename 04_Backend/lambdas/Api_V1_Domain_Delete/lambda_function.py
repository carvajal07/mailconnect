'''
Lambda: ELIMINAR un dominio de envío del cliente.

Borra el registro de la tabla `senderDomain` (verificando que sea del cliente del token) y,
best-effort, elimina la identidad en SES (`delete_identity`) para no dejarla huérfana.

Ruta: POST /Domain/Delete  (no-proxy, envelope estándar)
Request:  { domainId }
Respuesta: 200 ok · 400 falta id · 403 otro cliente · 404 no existe
'''
import os
import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get('SES_REGION', 'us-east-1')
ses = boto3.client('ses', region_name=REGION)
dynamodb = boto3.resource('dynamodb')
table_domain = dynamodb.Table('senderDomain')


def _get_payload(event):
    import json
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


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    domain_id = payload.get('domainId')
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}
    # RBAC: borrar un dominio/correo de envío es aún más sensible (un dominio VERIFICADO borrado
    # rompe la capacidad de envío de la empresa) → solo OWNER. Fail-CLOSED (ver Domain_Add): el
    # backend NO validaba el sub-rol; cualquier usuario del tenant podía borrar dominios.
    tenant_role = str(auth.get('tenantRole', 'operator') or 'operator')
    if tenant_role != 'owner':
        return {'status': False, 'statusCode': 403,
                'description': 'Solo el propietario de la cuenta puede eliminar los dominios de envío.'}
    if not domain_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el domainId.'}

    try:
        current = table_domain.get_item(Key={'domainId': domain_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'El dominio no existe.'}
        if current.get('customerId') != customer_id:
            return {'status': False, 'statusCode': 403, 'description': 'El dominio pertenece a otro cliente.'}

        # Quita la identidad en SES (best-effort; no rompe si falla).
        domain = str(current.get('domain', ''))
        if domain:
            try:
                ses.delete_identity(Identity=domain)
            except Exception as e:
                print('No se pudo eliminar la identidad SES {}: {}'.format(domain, e))

        table_domain.delete_item(Key={'domainId': domain_id})
        return {'status': True, 'statusCode': 200, 'description': 'Dominio eliminado.'}
    except ClientError as e:
        print('Error eliminando dominio: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo eliminar el dominio.'}
    except Exception as e:
        print('Error no controlado al eliminar dominio: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al eliminar el dominio.'}
