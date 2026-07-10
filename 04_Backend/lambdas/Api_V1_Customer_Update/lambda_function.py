'''
Lambda ADMIN para actualizar el estado de un cliente (habilitar/deshabilitar los
envíos reales).

Ruta: POST /Customer/Update  (integración no-proxy, envelope estándar)
Request:  { customerId, realSendEnabled (bool) }
Respuesta: 200 ok · 400 datos inválidos · 404 cliente no existe

Cuando realSendEnabled = false, la lambda Prepare-batch bloquea el envío REAL de las
campañas de ese cliente (las muestras siguen permitidas).

⚠️ Endpoint administrativo: debe quedar restringido a un rol administrador en el
despliegue (Authorizer de admin). Pendiente [J]/seguridad: role-based access.
'''
import json
import boto3

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')


def _get_payload(event):
    """Soporta integración directa (event = body) y Lambda-proxy (event['body'])."""
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _customer_exists(customer_id):
    response = table_customer.scan(
        FilterExpression="customerId = :value",
        ExpressionAttributeValues={":value": customer_id},
        ProjectionExpression='customerId'
    )
    return bool(response['Items'])


def _is_admin(event):
    """Solo un administrador (rol en el context del Authorizer) puede usar este endpoint."""
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}
    payload = _get_payload(event)
    customer_id = payload.get('customerId')
    raw_flag = payload.get('realSendEnabled')

    if not customer_id or raw_flag is None:
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Indica customerId y realSendEnabled (true/false).'
        }

    # Aceptar bool o string ('true'/'false'/'1'/'0') desde el mapping/proxy.
    if isinstance(raw_flag, str):
        real_send_enabled = raw_flag.strip().lower() in ('true', '1', 'yes', 'si', 'sí')
    else:
        real_send_enabled = bool(raw_flag)

    try:
        if not _customer_exists(customer_id):
            return {
                'status': False,
                'statusCode': 404,
                'description': 'El cliente no existe.'
            }

        table_customer.update_item(
            Key={'customerId': customer_id},
            UpdateExpression='SET realSendEnabled = :v',
            ExpressionAttributeValues={':v': real_send_enabled},
            ReturnValues='UPDATED_NEW'
        )

        estado = 'habilitados' if real_send_enabled else 'deshabilitados'
        return {
            'status': True,
            'statusCode': 200,
            'description': f'Envíos reales {estado} para el cliente.',
            'data': {'customerId': customer_id, 'realSendEnabled': real_send_enabled}
        }
    except Exception as e:
        print('Error actualizando el cliente: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al actualizar el cliente'
        }
