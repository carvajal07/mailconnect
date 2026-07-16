'''
Lambda ADMIN: lista los SALDOS (monedero PREPAGO) de TODOS los clientes.

Ruta: POST /Admin/Balances  (integración no-proxy, envelope estándar)
Request:  {}   (endpoint administrativo)
Respuesta: 200 { data: { customers:[{customerId, company, companyTin, balance,
                          currency, updatedAt}], totals:{balance}, count } }

Une la tabla `customer` (nombres) con `customerBalance` (saldo) en memoria: un scan de
cada una (no un GetItem por cliente). Incluye a los clientes SIN recarga (saldo 0), para
que el admin pueda cargarles saldo desde el panel. Orden por saldo ascendente (los que
están por quedarse sin saldo salen primero).

⚠️ Endpoint administrativo: valida rol admin (context del Authorizer).
'''
import json
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')
table_balance = dynamodb.Table('customerBalance')

CURRENCY = 'COP'


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _is_admin(event):
    return str(_authorizer(event).get('role', '')).lower() == 'admin'


def _to_int(value, default=0):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


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
                'description': 'Acceso restringido a administradores.',
                'data': {'customers': [], 'totals': {'balance': 0}, 'count': 0}}

    try:
        customers = _scan_all(table_customer,
                              ProjectionExpression='customerId, company, companyTin')
        balances = _scan_all(table_balance,
                             ProjectionExpression='customerId, balance, updatedAt')
        bal_by_id = {b.get('customerId'): b for b in balances}

        rows = []
        for c in customers:
            cid = c.get('customerId')
            b = bal_by_id.get(cid) or {}
            rows.append({
                'customerId': cid,
                'company': c.get('company', ''),
                'companyTin': c.get('companyTin', ''),
                'balance': _to_int(b.get('balance'), 0),
                'currency': CURRENCY,
                'updatedAt': b.get('updatedAt', ''),
            })

        # Saldo más bajo primero (surface los clientes por quedarse sin saldo).
        rows.sort(key=lambda x: x['balance'])
        total = sum(r['balance'] for r in rows)

        return {'status': True, 'statusCode': 200,
                'description': 'Saldos de los clientes',
                'data': {'customers': rows, 'totals': {'balance': total},
                         'currency': CURRENCY, 'count': len(rows)}}
    except Exception as e:
        print('Error listando saldos: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar los saldos.',
                'data': {'customers': [], 'totals': {'balance': 0}, 'count': 0}}
