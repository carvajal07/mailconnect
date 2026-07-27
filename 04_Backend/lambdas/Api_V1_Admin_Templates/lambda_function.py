'''
Lambda ADMIN: gestión GLOBAL de las plantillas SES de la cuenta (todas, de todos los
clientes). Convención de nombre: {customer}_{consecutivo}_{nombre} → se deriva el prefijo
de cliente para agrupar/buscar.

Ruta: POST /Admin/Templates  (no-proxy, envelope estándar, admin-only + 2ª barrera JWT)
Request: { action?, name? }
  - action ausente | 'list'  → listado completo (el filtrado/búsqueda lo hace el front).
  - action 'get'    { name } → contenido REAL de la plantilla (asunto + HTML + texto).
  - action 'delete' { name } → elimina la plantilla de SES.
Respuestas 200 data:
  list   → { templates: [{name, customerPrefix, createdAt}], count, truncated }
  get    → { template: {name, subject, html, text} }
  delete → { name }
404 si la plantilla no existe · 400 sin nombre.

⚠️ Por qué get/delete viven AQUÍ y no en las rutas de cliente (/Template/Get-template,
/Template/Delete-template): esas exigen que el nombre empiece por el prefijo del tenant
del token (aislamiento multi-tenant), así que un admin viendo la plantilla de OTRA empresa
recibía 403. En vez de abrirles un bypass por rol (superficie de escalación en una ruta de
cliente), la operación admin se hace en esta lambda, que ya valida la FIRMA del JWT.

⚠️ [J] despliegue: ruta /Admin/Templates (admin) + env SECRET_KEY; IAM
`ses:ListTemplates` + **`ses:GetTemplate`** + **`ses:DeleteTemplate`**.
'''
import json
import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
ses = boto3.client('ses', region_name=REGION)

MAX_PAGES = 30  # ListTemplates devuelve hasta 100 por página → tope 3000 plantillas


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


def _template_content(name):
    """Contenido real de la plantilla en SES (asunto + HTML + texto)."""
    tpl = ses.get_template(TemplateName=name).get('Template', {})
    return {'name': tpl.get('TemplateName', name),
            'subject': tpl.get('SubjectPart', '') or '',
            'html': tpl.get('HtmlPart', '') or '',
            'text': tpl.get('TextPart', '') or ''}


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.',
                'data': {'templates': [], 'count': 0}}

    payload = _get_payload(event)
    action = str(payload.get('action', 'list') or 'list').lower()

    if action in ('get', 'delete'):
        name = str(payload.get('name', '') or '').strip()
        if not name:
            return {'status': False, 'statusCode': 400,
                    'description': 'Indica el nombre de la plantilla.', 'data': {}}
        try:
            if action == 'get':
                return {'status': True, 'statusCode': 200,
                        'description': 'Contenido de la plantilla',
                        'data': {'template': _template_content(name)}}
            ses.delete_template(TemplateName=name)
            return {'status': True, 'statusCode': 200,
                    'description': 'Plantilla eliminada de SES', 'data': {'name': name}}
        except ClientError as e:
            code = e.response.get('Error', {}).get('Code', '')
            if code in ('TemplateDoesNotExist', 'NotFoundException'):
                return {'status': False, 'statusCode': 404,
                        'description': 'La plantilla no existe en SES.', 'data': {}}
            print('Error en Admin/Templates {}: {}'.format(action, e))
            return {'status': False, 'statusCode': 500,
                    'description': 'Error no controlado con la plantilla', 'data': {}}
        except Exception as e:
            print('Error en Admin/Templates {}: {}'.format(action, e))
            return {'status': False, 'statusCode': 500,
                    'description': 'Error no controlado con la plantilla', 'data': {}}

    try:
        templates = []
        token = None
        truncated = False
        for _ in range(MAX_PAGES):
            kwargs = {'MaxItems': 100}
            if token:
                kwargs['NextToken'] = token
            resp = ses.list_templates(**kwargs)
            for meta in resp.get('TemplatesMetadata', []):
                name = str(meta.get('Name', ''))
                created = meta.get('CreatedTimestamp')
                templates.append({
                    'name': name,
                    # Convención {customer}_{consecutivo}_{nombre} → prefijo de cliente.
                    'customerPrefix': name.split('_', 1)[0] if '_' in name else '',
                    'createdAt': created.strftime('%Y-%m-%d %H:%M:%S') if created else '',
                })
            token = resp.get('NextToken')
            if not token:
                break
        else:
            truncated = True
        templates.sort(key=lambda t: (t['customerPrefix'].lower(), t['name'].lower()))
        return {'status': True, 'statusCode': 200,
                'description': 'Plantillas SES de la cuenta',
                'data': {'templates': templates, 'count': len(templates), 'truncated': truncated}}
    except Exception as e:
        print('Error listando plantillas SES: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar las plantillas SES',
                'data': {'templates': [], 'count': 0}}
