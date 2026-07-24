'''
Lambda ADMIN: bandeja de SOLICITUDES de recarga manual (comprobante) — cobro PREPAGO.

Ruta: POST /Admin/Topups  (integración no-proxy, envelope estándar)
Request:  { status? (default 'pending'; 'all' = todos), month? ('YYYY-MM') }
Respuesta: 200 { data:{ topups:[{txId, customerId, company, amount, bank, reference,
                 status, rejectReason, proofUrl, detail, createdAt}], count } }

Lista los movimientos `topup_manual` (solicitudes del cliente) filtrados por estado y mes,
enriquecidos con el nombre de la empresa y una **URL prefirmada de LECTURA** del comprobante
(para verlo sin exponer el bucket). El admin decide con Admin_Topup-approve / -reject.

⚠️ Endpoint administrativo: valida rol admin (context del Authorizer).
'''
import json
import boto3
from decimal import Decimal
from botocore.client import Config
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_wallet = dynamodb.Table('walletTransaction')
table_customer = dynamodb.Table('customer')
s3 = boto3.client('s3', region_name=REGION, config=Config(signature_version='s3v4'))

PROOF_URL_EXPIRES = 600   # 10 min para ver el comprobante
MAX_TOPUPS = 500


def _get_payload(event):
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


def _proof_url(item):
    """URL prefirmada de lectura del comprobante (o '' si no hay bucket/key)."""
    bucket = item.get('proofBucket')
    key = item.get('proofS3Path')
    if not bucket or not key:
        return ''
    try:
        return s3.generate_presigned_url(
            ClientMethod='get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=PROOF_URL_EXPIRES)
    except Exception as e:
        print('No se pudo prefirmar el comprobante {}: {}'.format(key, e))
        return ''


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.',
                'data': {'topups': [], 'count': 0}}

    payload = _get_payload(event)
    status = str(payload.get('status', 'pending') or 'pending').strip().lower()
    month = str(payload.get('month', '') or '').strip()

    try:
        customers = _scan_all(table_customer, ProjectionExpression='customerId, company')
        company_by_id = {c.get('customerId'): c.get('company', '') for c in customers}

        # Solo solicitudes manuales del cliente (type='topup_manual'); el ajuste directo
        # del admin es type='adjustment' y no entra a esta bandeja.
        rows = [r for r in _scan_all(table_wallet) if r.get('type') == 'topup_manual']
        if status != 'all':
            rows = [r for r in rows if str(r.get('status', '')).lower() == status]
        if month:
            rows = [r for r in rows if str(r.get('createdAt', '')).startswith(month)]
        rows.sort(key=lambda x: str(x.get('createdAt', '')), reverse=True)
        rows = rows[:MAX_TOPUPS]

        topups = [{
            'txId': r.get('txId', ''),
            'customerId': r.get('customerId', ''),
            'company': company_by_id.get(r.get('customerId'), ''),
            'amount': _to_int(r.get('amount'), 0),
            'bank': r.get('bank', ''),
            'reference': r.get('reference', ''),
            'status': r.get('status', ''),
            'rejectReason': r.get('rejectReason', ''),
            'detail': r.get('detail', ''),
            'proofUrl': _proof_url(r),
            'createdAt': r.get('createdAt', ''),
        } for r in rows]

        return {'status': True, 'statusCode': 200,
                'description': 'Solicitudes de recarga manual',
                'data': {'topups': topups, 'count': len(topups)}}
    except Exception as e:
        print('Error listando solicitudes de recarga: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar las solicitudes.',
                'data': {'topups': [], 'count': 0}}
