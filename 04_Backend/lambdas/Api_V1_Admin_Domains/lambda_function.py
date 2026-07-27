'''
Lambda ADMIN: vista GLOBAL de dominios/correos remitentes de TODOS los clientes (tabla
`senderDomain`), con el nombre de la empresa. Hoy solo cada cliente ve los suyos; soporte
necesita el panorama completo (quién tiene qué verificado y qué sigue pendiente).

Ruta: POST /Admin/Domains  (no-proxy, envelope estándar, admin-only)
Request: {}
Respuesta 200 data: { domains: [{domainId, customerId, company, kind, domain, status,
                                 createdAt, verifiedAt}], count }
Orden: pendientes/fallidos primero (lo accionable), luego por empresa. Los estados son
los PERSISTIDOS (los refresca Domain/List del cliente contra SES); esta vista es barata
a propósito (solo lecturas DynamoDB).

⚠️ [J] despliegue: ruta /Admin/Domains (admin) + env SECRET_KEY; IAM Scan senderDomain +
Scan customer.
'''
import json
import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) ───────────────────────────
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json
import os as _os
import time as _time

_JWT_SECRET = _os.environ.get('SECRET_KEY', '')


def _jwt_claims(token):
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


def _scan_all(table, **kwargs):
    items = []
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            return items
        kwargs['ExclusiveStartKey'] = last


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.',
                'data': {'domains': [], 'count': 0}}
    try:
        try:
            rows = _scan_all(dynamodb.Table('senderDomain'))
        except ClientError as ce:
            if ce.response.get('Error', {}).get('Code') == 'ResourceNotFoundException':
                rows = []  # ningún cliente ha registrado dominios aún
            else:
                raise

        # customerId → nombre de empresa (para no mostrar uuids).
        company_by_id = {}
        try:
            for c in _scan_all(dynamodb.Table('customer'),
                               ProjectionExpression='customerId, company'):
                company_by_id[str(c.get('customerId', ''))] = str(c.get('company', ''))
        except Exception as e:
            print('customer lookup: {}'.format(e))

        domains = [{
            'domainId': r.get('domainId', ''),
            'customerId': r.get('customerId', ''),
            'company': company_by_id.get(str(r.get('customerId', '')), ''),
            'kind': r.get('kind', 'domain'),
            'domain': r.get('domain', ''),
            'status': r.get('status', 'pending'),
            'createdAt': r.get('createdAt', ''),
            'verifiedAt': r.get('verifiedAt', ''),
        } for r in rows]
        status_rank = {'failed': 0, 'pending': 1, 'verified': 2}
        domains.sort(key=lambda d: (status_rank.get(d['status'], 1), d['company'].lower(), d['domain']))
        return {'status': True, 'statusCode': 200,
                'description': 'Dominios remitentes de todos los clientes',
                'data': {'domains': domains, 'count': len(domains)}}
    except Exception as e:
        print('Error listando dominios: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar los dominios',
                'data': {'domains': [], 'count': 0}}
