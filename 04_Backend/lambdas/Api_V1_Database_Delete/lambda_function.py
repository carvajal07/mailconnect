'''
Lambda para eliminar una base de datos: borra su registro (metadata en la tabla
'databaseFile') Y el archivo CSV en S3 (bucket {customer}.database, key = s3Path). El
borrado en S3 es best-effort: si falla, se registra y NO tumba la operación (el registro
igual se elimina, para que la base desaparezca del listado del cliente).

Ruta: POST /Database/Delete  (integración no-proxy, envelope estándar)
Request:  { databaseFileId }
Respuesta: 200 ok · 400 falta id · 403 la base es de otro cliente · 404 no existe

Verifica que la base pertenezca al cliente del token (Authorizer) antes de borrar.
'''
import json
import boto3

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
table_database = dynamodb.Table('databaseFile')


def _delete_s3_object(item):
    """Borra el CSV en S3 (best-effort). El bucket es {customer}.database (minúsculas) y
    la key es el s3Path guardado en el registro. No propaga errores para no bloquear el
    borrado del registro si el objeto ya no está o falta un permiso puntual."""
    customer = item.get('customer')
    s3_path = item.get('s3Path')
    if not customer or not s3_path:
        print('Sin customer/s3Path en el registro; no se borra objeto en S3.')
        return
    bucket = '{}.database'.format(str(customer).lower())
    try:
        s3.delete_object(Bucket=bucket, Key=s3_path)
        print('Objeto S3 borrado: s3://{}/{}'.format(bucket, s3_path))
    except Exception as e:
        print('No se pudo borrar el objeto en S3 (se continúa): {}'.format(e))


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _tenant_from_authorizer(event):
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}


def lambda_handler(event, context):
    payload = _get_payload(event)
    database_file_id = payload.get('databaseFileId')
    auth = _tenant_from_authorizer(event)
    tenant_customer_id = auth.get('customerId')
    tenant_customer = auth.get('customer')

    if not database_file_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el databaseFileId.'}

    try:
        current = table_database.get_item(Key={'databaseFileId': database_file_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'La base de datos no existe.'}

        # Si el token trae identidad, se exige que la base sea del mismo cliente
        # (por customerId o, como respaldo, por nombre de empresa).
        if tenant_customer_id or tenant_customer:
            same = (
                (tenant_customer_id and current.get('customerId') == tenant_customer_id)
                or (tenant_customer and current.get('customer') == tenant_customer)
            )
            if not same:
                return {'status': False, 'statusCode': 403, 'description': 'La base pertenece a otro cliente.'}

        # Borra primero el CSV en S3 (best-effort) y luego el registro.
        _delete_s3_object(current)
        table_database.delete_item(Key={'databaseFileId': database_file_id})
        return {'status': True, 'statusCode': 200, 'description': 'Base de datos eliminada correctamente.'}
    except Exception as e:
        print('Error eliminando la base: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al eliminar la base de datos'}
