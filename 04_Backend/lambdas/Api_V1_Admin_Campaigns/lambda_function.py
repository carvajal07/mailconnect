'''
Lambda ADMIN: LISTAR las campañas de TODOS los clientes (con el nombre de la empresa).

A diferencia de Api_V1_Campaign_List (acotada al tenant del token), esta es una vista
GLOBAL de solo lectura para el panel admin: enriquece cada campaña con la empresa a la
que pertenece y permite filtrar por mes, estado, cliente y canal.

Ruta: POST /Admin/Campaigns  (integración no-proxy, envelope estándar)
Request:  { month?, state?, customerId?, channel? }
    - month      : 'YYYY-MM' por fecha de la campaña. Vacío = todas.
    - state      : filtra por campaignState (Pendiente | Muestras | Enviando | Terminada | Error).
    - customerId : acota a un cliente.
    - channel    : filtra por canal (EM | EAU | EAP | SMS | WSP | VOZ).
Respuesta: 200 { data: { campaigns:[{...campos..., company, companyTin}],
                         customers:[{customerId, company}], count, truncated } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
'''
import json
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')
table_customer = dynamodb.Table('customer')

MAX_CAMPAIGNS = 1000  # tope de campañas devueltas (las más recientes)


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def _clean(item):
    out = {}
    for key, value in item.items():
        out[key] = int(value) if isinstance(value, Decimal) else value
    return out


def _scan_all(table, **kwargs):
    items = []
    try:
        while True:
            resp = table.scan(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    return items


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    month = str(payload.get('month', '') or '').strip()
    state = str(payload.get('state', '') or '').strip()
    only_customer = str(payload.get('customerId', '') or '').strip()
    channel = str(payload.get('channel', '') or '').strip().upper()

    try:
        # Mapa customerId -> {company, companyTin} (un solo scan de customer).
        customers = _scan_all(table_customer,
                              ProjectionExpression='customerId, company, companyTin')
        cust_map = {c.get('customerId'): c for c in customers}
        customer_options = sorted(
            [{'customerId': c.get('customerId'), 'company': c.get('company', '')}
             for c in customers if c.get('customerId')],
            key=lambda x: str(x.get('company', '')).lower())

        # Un solo scan de campaign; se enriquece y filtra en memoria.
        campaigns = _scan_all(table_campaign)
        rows = []
        for c in campaigns:
            item = _clean(c)
            cid = item.get('customerId')
            cust = cust_map.get(cid) or {}
            item['company'] = cust.get('company', '')
            item['companyTin'] = cust.get('companyTin', '')
            if month and not str(item.get('date', '')).startswith(month):
                continue
            if state and str(item.get('campaignState', '')) != state:
                continue
            if only_customer and cid != only_customer:
                continue
            if channel and str(item.get('channel', '')).upper() != channel:
                continue
            rows.append(item)

        rows.sort(key=lambda x: str(x.get('date', '')), reverse=True)
        truncated = len(rows) > MAX_CAMPAIGNS
        rows = rows[:MAX_CAMPAIGNS]

        return {
            'status': True, 'statusCode': 200,
            'description': 'Campañas (todas las empresas)' + (' (parcial)' if truncated else ''),
            'data': {'campaigns': rows, 'customers': customer_options,
                     'count': len(rows), 'truncated': truncated}
        }
    except Exception as e:
        print('Error listando campañas admin: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar las campañas', 'data': {}}
