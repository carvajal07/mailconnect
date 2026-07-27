'''
Lambda ADMIN de SOPORTE: "¿qué le llegó a fulano@x.com?" — línea de tiempo de TODOS los
envíos a un contacto (correo o celular) de un cliente.

Ruta: POST /Admin/Recipient-lookup  (no-proxy, envelope estándar, admin-only)
Request: { customerId, contact }
    - customerId : cliente sobre el que se busca (define la tabla {tenant}_sendStatus).
    - contact    : correo (case-insensitive) o celular (se normaliza a E.164, +57 default).
Respuesta 200 data: {
  company, contact,
  timeline: [{date, campaignName, channel, state, stateLabel, detail, processId, messageId}],
  count, truncated,
  lists: { blacklisted: bool, unsubscribed: bool }   # ¿está en lista negra / desuscritos?
}

Cómo: Scan de {tenant}_sendStatus filtrando por email/phone (con tope de páginas — es una
herramienta de soporte puntual, no un reporte masivo), join con la tabla `process` para
el nombre de campaña/canal, y consulta puntual a {tenant}_blackList / {tenant}_unsubscribe.

⚠️ [J] despliegue: ruta /Admin/Recipient-lookup (admin) + env SECRET_KEY; IAM: GetItem
customer, Scan *_sendStatus, BatchGetItem process, GetItem *_blackList / *_unsubscribe.
'''
import re
import json
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')
table_process = dynamodb.Table('process')

MAX_SCAN_PAGES = 12     # tope del Scan de sendStatus (≤ ~12 MB leídos)
MAX_TIMELINE = 200      # entradas devueltas (las más recientes)

STATE_LABEL = {
    1: 'Enviado', 2: 'Entregado', 3: 'Rechazado', 4: 'Abierto', 5: 'Clic',
    6: 'Rebote', 7: 'Queja', 8: 'Falla de renderizado', 9: 'Retrasado',
    10: 'Suscrito', 11: 'Contacto inválido',
}


def tenant_key(nit):
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def normalize_phone(raw):
    """Celular → E.164 (+57 por defecto), mismo criterio de Prepare-batch."""
    p = re.sub(r'[\s()\-.]', '', str(raw or ''))
    if not p:
        return ''
    if p.startswith('00'):
        p = '+' + p[2:]
    if p.startswith('+'):
        digits = p[1:]
        return '+' + digits if (digits.isdigit() and 8 <= len(digits) <= 15) else ''
    if not p.isdigit():
        return ''
    if p.startswith('57') and len(p) == 12:
        return '+' + p
    if len(p) == 10:
        return '+57' + p
    return ''


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


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


def _n(v):
    if isinstance(v, Decimal):
        return int(v) if v == int(v) else float(v)
    return v


def _in_list(table_name, contact_keys):
    """¿El contacto está en la tabla {tenant}_blackList / _unsubscribe (PK email)?"""
    try:
        table = dynamodb.Table(table_name)
        for key in contact_keys:
            if table.get_item(Key={'email': key}).get('Item'):
                return True
        return False
    except Exception:
        return False  # tabla ausente = no listado


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}
    payload = _get_payload(event)
    customer_id = str(payload.get('customerId') or '').strip()
    contact = str(payload.get('contact') or '').strip()
    if not customer_id or not contact:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica customerId y contact (correo o celular).'}

    customer = table_customer.get_item(Key={'customerId': customer_id}).get('Item')
    if not customer:
        return {'status': False, 'statusCode': 404, 'description': 'El cliente no existe.'}
    tenant = tenant_key(customer.get('companyTin'))
    if not tenant:
        return {'status': False, 'statusCode': 400,
                'description': 'El cliente no tiene NIT; no hay tablas de envío que consultar.'}

    # Variantes del contacto a comparar: correo en minúsculas; celular crudo + E.164.
    keys = {contact, contact.lower()}
    e164 = normalize_phone(contact)
    if e164:
        keys.add(e164)
    keys = [k for k in keys if k]

    # Scan con tope de la tabla única {tenant}_sendStatus (PK processId, SK sendStatusId).
    rows, truncated = [], False
    try:
        table = dynamodb.Table('{}_sendStatus'.format(tenant))
        or_parts, values = [], {}
        for i, k in enumerate(keys):
            or_parts.append('email = :c{0} OR phone = :c{0}'.format(i))
            values[':c{}'.format(i)] = k
        kwargs = {'FilterExpression': ' OR '.join(or_parts),
                  'ExpressionAttributeValues': values}
        pages = 0
        while True:
            resp = table.scan(**kwargs)
            rows.extend(resp.get('Items', []))
            pages += 1
            last = resp.get('LastEvaluatedKey')
            if not last or pages >= MAX_SCAN_PAGES:
                truncated = bool(last)
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as ce:
        if ce.response.get('Error', {}).get('Code') != 'ResourceNotFoundException':
            raise
        # Sin tabla de envíos aún: el cliente no ha enviado nada.

    # Join con `process` (nombre de campaña) por lotes.
    process_ids = sorted({str(r.get('processId', '')) for r in rows if r.get('processId')})
    process_by_id = {}
    for i in range(0, len(process_ids), 100):
        chunk = [{'processId': pid} for pid in process_ids[i:i + 100]]
        try:
            resp = dynamodb.batch_get_item(RequestItems={'process': {'Keys': chunk}})
            for it in resp.get('Responses', {}).get('process', []):
                process_by_id[str(it.get('processId'))] = it
        except Exception:
            break

    timeline = []
    for r in rows:
        proc = process_by_id.get(str(r.get('processId', '')), {})
        state = int(_n(r.get('state', 0)) or 0)
        timeline.append({
            'date': r.get('date', ''),
            'campaignName': proc.get('campaignName', ''),
            'channel': r.get('type1', '') or '',
            'state': state,
            'stateLabel': STATE_LABEL.get(state, str(state)),
            'detail': str(r.get('type2', '') or '')[:160],
            'processId': r.get('processId', ''),
            'messageId': r.get('messageId', ''),
        })
    timeline.sort(key=lambda x: str(x['date']), reverse=True)
    timeline = timeline[:MAX_TIMELINE]

    lists = {
        'blacklisted': _in_list('{}_blackList'.format(tenant), keys),
        'unsubscribed': _in_list('{}_unsubscribe'.format(tenant), keys),
    }

    return {'status': True, 'statusCode': 200,
            'description': 'Historial del contacto',
            'data': json.loads(json.dumps({
                'company': customer.get('company', ''),
                'contact': contact,
                'timeline': timeline,
                'count': len(timeline),
                'truncated': truncated,
                'lists': lists,
            }, default=_n))}
