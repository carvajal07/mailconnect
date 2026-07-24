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
