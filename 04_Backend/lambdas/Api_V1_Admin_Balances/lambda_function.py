'''
Lambda ADMIN: lista los SALDOS (monedero PREPAGO) de TODOS los clientes.

Ruta: POST /Admin/Balances  (integración no-proxy, envelope estándar)
Request:  {}   (endpoint administrativo)
Respuesta: 200 { data: { customers:[{customerId, company, companyTin, balance,
                          currency, updatedAt}], totals:{balance},
                          recentTransactions:[{txId, customerId, company, type,
                          amount, balanceAfter, reference, detail, date}], count } }

Une la tabla `customer` (nombres) con `customerBalance` (saldo) en memoria: un scan de
cada una (no un GetItem por cliente). Incluye a los clientes SIN recarga (saldo 0), para
que el admin pueda cargarles saldo desde el panel. Orden por saldo ascendente (los que
están por quedarse sin saldo salen primero). Además devuelve los últimos movimientos del
ledger `walletTransaction` (global, enriquecidos con el nombre de la empresa).

⚠️ Endpoint administrativo: valida rol admin (context del Authorizer).
'''
import json
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')
table_balance = dynamodb.Table('customerBalance')
table_wallet = dynamodb.Table('walletTransaction')

CURRENCY = 'COP'
MAX_RECENT_TX = 100   # tope de movimientos recientes devueltos (ledger global)


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) ───────────────────────────
# El context del Authorizer puede falsificarse si una ruta no-proxy queda sin
# mapping template (passthrough del body directo a la lambda). El JWT no: viene
# firmado (HS256) con SECRET_KEY. Con SECRET_KEY configurada, este gate EXIGE un
# token valido con claim role=admin (llega por el header Authorization en proxy,
# o por el campo `authToken` que inyecta el mapping template en no-proxy). Sin
# SECRET_KEY configurada se usa solo el context (compatibilidad de rollout);
# configurarla en esta lambda es requisito de despliegue (ver PENDIENTES.md).
# Verificacion manual con stdlib (hmac/base64): sin dependencia del layer PyJWT.
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json
import os as _os
import time as _time

_JWT_SECRET = _os.environ.get('SECRET_KEY', '')


def _jwt_claims(token):
    """Valida firma HS256 + exp del JWT con SECRET_KEY y devuelve sus claims (o None)."""
    try:
        header_b64, payload_b64, sig_b64 = str(token).split('.')

        def _dec(seg):
            return _b64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))

        expected = _hmac.new(_JWT_SECRET.encode(),
                             (header_b64 + '.' + payload_b64).encode(),
                             _hashlib.sha256).digest()
        if not _hmac.compare_digest(_dec(sig_b64), expected):
            return None
        if _json.loads(_dec(header_b64)).get('alg') != 'HS256':
            return None
        claims = _json.loads(_dec(payload_b64))
        exp = claims.get('exp')
        if exp is not None and _time.time() >= float(exp):
            return None
        return claims if isinstance(claims, dict) else None
    except Exception:
        return None


def _bearer_token(event):
    """Token de la peticion: header Authorization (proxy) o el campo `authToken`
    que inyecta el mapping template no-proxy ($input.params('Authorization'))."""
    raw = ''
    if isinstance(event, dict):
        for k, v in (event.get('headers') or {}).items():
            if str(k).lower() == 'authorization' and v:
                raw = v
                break
        if not raw:
            raw = event.get('authToken') or ''
        if not raw and isinstance(event.get('body'), dict):
            raw = event['body'].get('authToken') or ''
    raw = str(raw).strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return raw


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    context_admin = str(auth.get('role', '')).lower() == 'admin'
    if not _JWT_SECRET:
        print('ADVERTENCIA: SECRET_KEY no configurada; gate admin solo por context.')
        return context_admin
    claims = _jwt_claims(_bearer_token(event))
    return bool(claims) and str(claims.get('role', '')).lower() == 'admin'

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

        # Movimientos recientes del ledger global (enriquecidos con la empresa).
        company_by_id = {c.get('customerId'): c.get('company', '') for c in customers}
        wallet = _scan_all(table_wallet)
        wallet.sort(key=lambda x: str(x.get('createdAt', '')), reverse=True)
        recent = [{
            'txId': t.get('txId', ''),
            'customerId': t.get('customerId', ''),
            'company': company_by_id.get(t.get('customerId'), ''),
            'type': t.get('type', ''),
            'amount': _to_int(t.get('amount'), 0),
            'balanceAfter': _to_int(t.get('balanceAfter'), 0),
            'status': t.get('status', ''),
            'reference': t.get('reference', ''),
            'detail': t.get('detail', ''),
            'createdAt': t.get('createdAt', ''),
        } for t in wallet[:MAX_RECENT_TX]]

        return {'status': True, 'statusCode': 200,
                'description': 'Saldos de los clientes',
                'data': {'customers': rows, 'totals': {'balance': total},
                         'recentTransactions': recent,
                         'currency': CURRENCY, 'count': len(rows)}}
    except Exception as e:
        print('Error listando saldos: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar los saldos.',
                'data': {'customers': [], 'totals': {'balance': 0}, 'count': 0}}
