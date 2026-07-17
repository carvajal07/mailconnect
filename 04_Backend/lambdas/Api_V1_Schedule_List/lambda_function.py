'''
Lambda: LISTAR los envíos programados del cliente (tabla `scheduledSend`).

Ruta: POST /Schedule/List  (no-proxy, envelope estándar)
Request:  {}
Respuesta: 200 data:{ schedules:[{scheduleId, campaignId, campaignName, scheduledAt, status,
                                  createdAt, firedAt, processId, error}], count }

Multi-tenant: se listan SOLO los del cliente del token (GSI customerId-index). Devuelve
lista vacía si la tabla aún no existe (nadie ha programado nada).
'''
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_schedule = dynamodb.Table('scheduledSend')


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _clean(v):
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.',
                'data': {'schedules': [], 'count': 0}}

    try:
        items = []
        kwargs = {'IndexName': 'customerId-index', 'KeyConditionExpression': Key('customerId').eq(customer_id)}
        while True:
            resp = table_schedule.query(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last

        out = [_clean({
            'scheduleId': it.get('scheduleId'),
            'campaignId': it.get('campaignId', ''),
            'campaignName': it.get('campaignName', ''),
            'scheduledAt': it.get('scheduledAt', ''),
            'status': it.get('status', 'pending'),
            'createdAt': it.get('createdAt', ''),
            'firedAt': it.get('firedAt', ''),
            'processId': it.get('processId', ''),
            'error': it.get('error', ''),
        }) for it in items]
        # Próximos primero (fecha programada ascendente).
        out.sort(key=lambda x: str(x.get('scheduledAt', '')))
        return {'status': True, 'statusCode': 200, 'description': 'Envíos programados del cliente',
                'data': {'schedules': out, 'count': len(out)}}
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {'status': True, 'statusCode': 200, 'description': 'Sin envíos programados',
                    'data': {'schedules': [], 'count': 0}}
        print('Error listando programados: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudieron listar los envíos programados.',
                'data': {'schedules': [], 'count': 0}}
    except Exception as e:
        print('Error no controlado listando programados: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al listar.',
                'data': {'schedules': [], 'count': 0}}
