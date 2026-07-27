'''
CENTRO DE PREFERENCIAS del suscriptor (Bloque H): página pública donde el destinatario
elige QUÉ y con qué FRECUENCIA quiere recibir, en vez de solo la baja total. Mismo patrón
firmado del "unsubscribe" (token HMAC), sin sesión.

Ruta: GET/POST /Email/Preferences?t=<token>   (PROXY, SIN authorizer)

Token (idéntico al de Unsubscribe, generado por las lambdas Send con SECRET_KEY):
    t = base64url({"c": customer, "n": tenant, "e": email}) + "." + hmac_sha256(payload)[:32]

Estado por destinatario en `{tenant}_preferences` (PK 'email'):
    { email, frequency ('normal'|'reduced'|'none'), topics: {promociones, novedades,
      transaccional} (bool), updatedAt, source }

- Al GUARDAR con frequency='none' (o desmarcar TODOS los temas) → además se inserta el
  correo en `{tenant}_unsubscribe` (baja total, que Prepare-batch YA filtra en el envío
  real). Al elegir cualquier otra opción → se RE-SUSCRIBE (se borra de _unsubscribe).
- La granularidad por TEMA se guarda como consentimiento del suscriptor; su APLICACIÓN
  (filtrar por tema en el envío) queda para cuando las campañas se etiqueten por tema.

Env: SECRET_KEY (misma del JWT/unsubscribe).
[J]: ruta pública /Email/Preferences (proxy, sin authorizer, CORS); IAM sobre
`*_preferences` (Get/Put/CreateTable/DescribeTable) y `*_unsubscribe` (Put/Delete).
'''
import os
import re
import html
import json
import hmac
import uuid
import base64
import hashlib
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get('DYNAMODB_REGION', 'us-east-1')
SECRET_KEY = os.environ.get('SECRET_KEY', '')

dynamodb = boto3.resource('dynamodb', region_name=REGION)
dynamodb_client = boto3.client('dynamodb', region_name=REGION)

# Temas ofrecidos (id → etiqueta). Fijos por ahora; el consentimiento se guarda aunque el
# filtrado por tema en el envío llegue después (las campañas aún no se etiquetan por tema).
TOPICS = [('promociones', 'Promociones y ofertas'),
          ('novedades', 'Novedades y boletín'),
          ('transaccional', 'Avisos importantes de mi cuenta')]
FREQUENCIES = [('normal', 'Todas las comunicaciones'),
               ('reduced', 'Solo lo esencial (menos frecuencia)'),
               ('none', 'No quiero recibir más correos')]


def tenant_key(nit):
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def _b64url_decode(data):
    return base64.urlsafe_b64decode(data + '=' * (-len(data) % 4))


def parse_token(token):
    """(tenant, email) si la firma es válida, o None."""
    try:
        payload_b64, signature = token.split('.', 1)
        expected = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        tenant = tenant_key(payload.get('n', '')) or tenant_key(str(payload.get('c', '')))
        email = str(payload.get('e', '')).strip().lower()
        if not tenant or not email or '@' not in email:
            return None
        return tenant, email
    except Exception as e:
        print('Token ilegible: {}'.format(e))
        return None


def _ensure_table(name, pk='email'):
    try:
        dynamodb.create_table(
            TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        dynamodb_client.get_waiter('table_exists').wait(
            TableName=name, WaiterConfig={'Delay': 2, 'MaxAttempts': 15})
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceInUseException':
            return True
        print('No se pudo crear {}: {}'.format(name, e))
        return False


def _load_prefs(tenant, email):
    try:
        item = dynamodb.Table('{}_preferences'.format(tenant)).get_item(
            Key={'email': email}).get('Item')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return None
        raise
    return item


def _page(tenant, email, token, prefs=None, saved=False):
    """Página HTML del centro de preferencias (autocontenida, con la marca)."""
    prefs = prefs or {}
    freq = str(prefs.get('frequency', 'normal') or 'normal')
    topics = prefs.get('topics') or {}
    safe_email = html.escape(email)
    safe_token = html.escape(token)

    freq_html = ''
    for fid, flabel in FREQUENCIES:
        checked = 'checked' if fid == freq else ''
        freq_html += (
            '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;'
            'border:1px solid #e2e8f0;border-radius:10px;margin:6px 0;cursor:pointer">'
            '<input type="radio" name="frequency" value="{fid}" {checked}>'
            '<span>{flabel}</span></label>').format(fid=fid, checked=checked, flabel=flabel)

    topics_html = ''
    for tid, tlabel in TOPICS:
        checked = 'checked' if bool(topics.get(tid, True)) else ''
        topics_html += (
            '<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer">'
            '<input type="checkbox" name="topic" value="{tid}" {checked}>'
            '<span>{tlabel}</span></label>').format(tid=tid, checked=checked, tlabel=tlabel)

    saved_banner = ('<div style="background:#e6f6ec;color:#0f7a43;border-radius:10px;'
                    'padding:12px 14px;margin-bottom:16px;font-size:14px">✅ Guardamos tus '
                    'preferencias. Puedes cerrar esta página.</div>') if saved else ''

    body = """<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Preferencias de correo · MailConnect</title>
<style>
  body {{ margin:0; font-family:Arial,'Helvetica Neue',Helvetica,sans-serif; background:#f4f8fc; color:#16233f; }}
  .card {{ max-width:520px; margin:6vh auto; background:#fff; border-radius:14px; padding:32px 30px;
          box-shadow:0 8px 30px rgba(22,35,63,.10); }}
  h1 {{ font-size:22px; margin:0 0 4px; }}
  p.sub {{ color:#5b6b86; font-size:14px; margin:0 0 18px; }}
  h2 {{ font-size:15px; margin:20px 0 6px; }}
  button {{ background:#0075be; color:#fff; border:none; border-radius:10px; padding:12px 22px;
           font-size:15px; font-weight:bold; cursor:pointer; margin-top:20px; width:100%; }}
  .brand {{ margin-top:24px; font-size:13px; color:#9aa7bd; text-align:center; }}
  .brand b {{ color:#0075be; }}
</style></head>
<body><div class="card">
  {saved}
  <h1>Tus preferencias de correo</h1>
  <p class="sub">{email}</p>
  <form method="POST" action="?t={token}">
    <h2>¿Qué tan seguido quieres saber de nosotros?</h2>
    {freq}
    <h2>Temas que te interesan</h2>
    {topics}
    <button type="submit">Guardar preferencias</button>
  </form>
  <div class="brand">Mail<b>connect</b> · mailconnect.com.co</div>
</div></body></html>""".format(saved=saved_banner, email=safe_email, token=safe_token,
                               freq=freq_html, topics=topics_html)
    return {'statusCode': 200,
            'headers': {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'},
            'body': body}


def _error_page(title, message):
    body = """<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{t} · MailConnect</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f8fc;color:#16233f">
<div style="max-width:480px;margin:12vh auto;background:#fff;border-radius:14px;padding:36px;text-align:center;box-shadow:0 8px 30px rgba(22,35,63,.1)">
<div style="font-size:44px">⚠️</div><h1 style="font-size:21px">{t}</h1>
<p style="color:#5b6b86">{m}</p></div></body></html>""".format(t=html.escape(title), m=html.escape(message))
    return {'statusCode': 200, 'headers': {'Content-Type': 'text/html; charset=utf-8'}, 'body': body}


def _parse_form(event):
    """Body de un POST de formulario (application/x-www-form-urlencoded)."""
    from urllib.parse import parse_qs
    body = (event or {}).get('body') or ''
    if (event or {}).get('isBase64Encoded'):
        try:
            body = base64.b64decode(body).decode('utf-8')
        except Exception:
            body = ''
    return parse_qs(body)


def lambda_handler(event, context):
    method = str((event or {}).get('httpMethod', 'GET')).upper()
    qsp = (event or {}).get('queryStringParameters') or {}
    token = qsp.get('t', '')

    if not SECRET_KEY:
        return _error_page('No disponible', 'El servicio no está disponible en este momento.')

    parsed = parse_token(token) if token else None
    if not parsed:
        return _error_page('Enlace inválido',
                           'Este enlace de preferencias no es válido o está incompleto. '
                           'Usa el enlace tal como llegó en tu correo.')
    tenant, email = parsed

    try:
        if method == 'GET':
            prefs = _load_prefs(tenant, email)
            return _page(tenant, email, token, prefs)

        # POST → guardar.
        form = _parse_form(event)
        freq = (form.get('frequency', ['normal']) or ['normal'])[0]
        if freq not in ('normal', 'reduced', 'none'):
            freq = 'normal'
        checked = set(form.get('topic', []) or [])
        topics = {tid: (tid in checked) for tid, _ in TOPICS}
        no_topics = not any(topics.values())

        pref_table_name = '{}_preferences'.format(tenant)
        _ensure_table(pref_table_name)
        now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
        dynamodb.Table(pref_table_name).put_item(Item={
            'email': email, 'frequency': freq, 'topics': topics,
            'preferenceId': str(uuid.uuid4()), 'updatedAt': now, 'source': 'preferences'})

        unsub_table_name = '{}_unsubscribe'.format(tenant)
        opt_out = freq == 'none' or no_topics
        if opt_out:
            # Baja total: honrada YA por el filtro de Prepare-batch.
            _ensure_table(unsub_table_name)
            dynamodb.Table(unsub_table_name).put_item(Item={
                'email': email, 'unsubscribeId': str(uuid.uuid4()),
                'date': now, 'source': 'preferences'})
        else:
            # Re-suscripción: si estaba dado de baja, se quita de la lista.
            try:
                dynamodb.Table(unsub_table_name).delete_item(Key={'email': email})
            except ClientError as e:
                if e.response['Error']['Code'] != 'ResourceNotFoundException':
                    raise

        print('Preferencias de {} guardadas en {} (freq={}, optOut={})'.format(
            email, tenant, freq, opt_out))
        return _page(tenant, email, token, {'frequency': freq, 'topics': topics}, saved=True)
    except Exception as e:
        print('Error en Preferences: {}'.format(e))
        return _error_page('No pudimos procesar tu solicitud',
                           'Ocurrió un error al guardar tus preferencias. Intenta de nuevo en unos minutos.')
