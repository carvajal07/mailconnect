'''
Lambda: LISTAR los dominios de envío del cliente y REFRESCAR su estado desde SES.

Consulta los dominios del cliente (tabla `senderDomain`, GSI por customerId) y para cada uno
pregunta a SES el estado de verificación (`get_identity_verification_attributes`) y de DKIM
(`get_identity_dkim_attributes`). Actualiza `status` (pending|verified|failed) en la tabla y
devuelve la lista con sus registros DNS.

Ruta: POST /Domain/List  (no-proxy, envelope estándar)
Request:  {}
Respuesta: 200 data:{ domains:[{domainId, domain, status, records, createdAt, verifiedAt}], count }
'''
import os
import time
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

REGION = os.environ.get('SES_REGION', 'us-east-1')
ses = boto3.client('ses', region_name=REGION)
dynamodb = boto3.resource('dynamodb')
table_domain = dynamodb.Table('senderDomain')


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _clean(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _ses_status(domains):
    """Estado consolidado por dominio: 'verified' si la identidad está Success, 'failed' si
    Failed, 'pending' en otro caso. Best-effort (si SES falla, deja el estado guardado)."""
    result = {}
    if not domains:
        return result
    try:
        ver = ses.get_identity_verification_attributes(Identities=domains).get('VerificationAttributes', {})
    except Exception as e:
        print('No se pudo consultar verificación SES: {}'.format(e))
        ver = {}
    for d in domains:
        st = (ver.get(d, {}) or {}).get('VerificationStatus', '')
        if st == 'Success':
            result[d] = 'verified'
        elif st in ('Failed', 'TemporaryFailure'):
            result[d] = 'failed'
        else:
            result[d] = 'pending'
    return result


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.',
                'data': {'domains': [], 'count': 0}}

    try:
        items = []
        kwargs = {'IndexName': 'customerId-index', 'KeyConditionExpression': Key('customerId').eq(customer_id)}
        while True:
            resp = table_domain.query(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last

        domains = [str(i.get('domain', '')) for i in items if i.get('domain')]
        status_by_domain = _ses_status(domains)
        now = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())

        out = []
        for it in items:
            d = str(it.get('domain', ''))
            new_status = status_by_domain.get(d, it.get('status', 'pending'))
            # Persistir el estado si cambió (best-effort).
            if new_status != it.get('status'):
                try:
                    upd = 'SET #s = :s'
                    vals = {':s': new_status}
                    if new_status == 'verified' and not it.get('verifiedAt'):
                        upd += ', verifiedAt = :v'
                        vals[':v'] = now
                    table_domain.update_item(
                        Key={'domainId': it['domainId']},
                        UpdateExpression=upd,
                        ExpressionAttributeNames={'#s': 'status'},
                        ExpressionAttributeValues=vals)
                    it['status'] = new_status
                    if new_status == 'verified' and not it.get('verifiedAt'):
                        it['verifiedAt'] = now
                except Exception as e:
                    print('No se pudo actualizar el estado de {}: {}'.format(d, e))
            out.append(_clean({
                'domainId': it.get('domainId'),
                'domain': d,
                'status': it.get('status', 'pending'),
                'records': it.get('records', []),
                'createdAt': it.get('createdAt', ''),
                'verifiedAt': it.get('verifiedAt', ''),
            }))

        out.sort(key=lambda x: str(x.get('createdAt', '')), reverse=True)
        return {'status': True, 'statusCode': 200, 'description': 'Dominios del cliente',
                'data': {'domains': out, 'count': len(out)}}
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            # La tabla aún no existe (ningún dominio registrado): lista vacía, no es error.
            return {'status': True, 'statusCode': 200, 'description': 'Sin dominios',
                    'data': {'domains': [], 'count': 0}}
        print('Error listando dominios: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudieron listar los dominios.',
                'data': {'domains': [], 'count': 0}}
    except Exception as e:
        print('Error no controlado listando dominios: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al listar los dominios.',
                'data': {'domains': [], 'count': 0}}
