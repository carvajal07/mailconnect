import os
import re
import json
import uuid
import boto3
import hashlib
import hmac
import time
from datetime import datetime, timedelta

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')
table_customer = dynamodb.Table('customer')
table_activation = dynamodb.Table('userActivation')

# Cliente SES para el correo de activación
ses = boto3.client('ses')
# Cliente S3 para crear los buckets del cliente (por NIT) al registrar la empresa.
s3 = boto3.client('s3')

# Prefijo de los buckets por cliente. Convención: {prefix}-{nit}-{database|document}
# (nombres S3 DNS-safe: minúsculas, sin espacios/acentos). Se usa el NIT (no el nombre)
# para evitar colisiones y nombres inválidos.
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')


PBKDF2_ITERATIONS = int(os.environ.get('PBKDF2_ITERATIONS', '600000'))

# Funciones que un cliente NUEVO NO trae habilitadas (opt-in): canales avanzados y
# editores/cargas especiales. El admin las enciende por cliente desde "Funciones por
# cliente" (Customer/Update {features}). El resto de funciones sigue FAIL-OPEN (clave
# ausente = habilitada), por eso estas se escriben explícitamente en false.
# ⚠️ Mantener en sync con el catálogo del front (05_Frontend/.../src/config/features.ts).
DEFAULT_DISABLED_FEATURES = (
    'func:canal_voz',          # canal Voz en campañas y cascada
    'func:canal_whatsapp',     # canal WhatsApp en campañas y cascada
    'tab:whatsapp',            # tab Plantillas WhatsApp
    'tab:estudio',             # Plantillas PDF avanzadas (Estudio, lienzo)
    'tab:disenador',           # Plantillas PDF profesionales (Diseñador)
    'func:csv_multiregistro',  # asistente de CSV multiregistro
    'func:json_import',        # importar bases en JSON
)


# ---------------------------------------------------------------------------
# Armazón de los correos INTERNOS de la plataforma (activación, códigos, avisos).
#
# ⚠️ Está COPIADO en cada lambda que envía correo, siguiendo la convención del repo
# (igual que `tenant_key` o `_audit`): no hay imports compartidos entre lambdas. Si se
# toca aquí, hay que replicarlo en TODAS — la lista está en `DESPLIEGUE.md`.
#
# Por qué tablas y no `<div>`: los correos anteriores usaban `<div style="max-width:600px">`,
# y **Outlook de escritorio ignora `max-width`** (motor de Word) → el correo se desparramaba
# a todo el ancho de la ventana. La maquetación de correo se hace con tablas y una
# "ghost table" condicional para Outlook.
# ---------------------------------------------------------------------------
MAIL_INK = '#16233f'        # navy de la marca
MAIL_BLUE = '#0075be'       # azul de acción
MAIL_CYAN = '#00c3ff'
MAIL_MUTED = '#5b6b86'
MAIL_BORDER = '#e4ebf3'
MAIL_BG = '#f4f7fb'

MAIL_SITE = os.environ.get('SITE_URL', 'https://www.mailconnect.com.co')
# Los assets se sirven junto al sitio (se despliegan con el frontend).
MAIL_ASSETS = os.environ.get('EMAIL_ASSETS_URL', MAIL_SITE + '/email')
MAIL_CONTACT = os.environ.get('CONTACT_EMAIL', 'comunicaciones@mailconnect.com.co')
MAIL_WHATSAPP = os.environ.get('WHATSAPP_URL', 'https://wa.me/573204586576')

# ⚠️ CONFIRMAR los perfiles reales antes de desplegar. Una red con URL vacía simplemente
# NO se dibuja, así que borrar la línea la quita del pie sin tocar nada más.
MAIL_SOCIAL = [
    ('linkedin', 'LinkedIn', os.environ.get('SOCIAL_LINKEDIN', 'https://www.linkedin.com/company/mailconnect')),
    ('facebook', 'Facebook', os.environ.get('SOCIAL_FACEBOOK', 'https://www.facebook.com/mailconnect')),
    ('instagram', 'Instagram', os.environ.get('SOCIAL_INSTAGRAM', 'https://www.instagram.com/mailconnect')),
    ('whatsapp', 'WhatsApp', MAIL_WHATSAPP),
]


def _mail_esc(texto):
    return (str(texto or '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def mail_button(etiqueta, url):
    """Botón BULLETPROOF.

    ⚠️ Outlook de escritorio usa el motor de Word, que ignora `border-radius` (el botón
    sale cuadrado) y el `padding` del `<a>` (se encoge al texto, sin alto ni ancho). Se
    emite VML dentro de `[if mso]` y la versión con tabla dentro de `[if !mso]`, así cada
    motor ve UNA sola versión y no se duplica en ninguno.
    """
    etiqueta, url = _mail_esc(etiqueta), _mail_esc(url)
    alto, ancho = 46, max(180, len(etiqueta) * 10 + 56)
    vml = (
        '<!--[if mso]>'
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"'
        ' href="{url}" style="width:{w}px;height:{h}px;v-text-anchor:middle;" arcsize="18%"'
        ' fillcolor="{blue}" stroke="f"><w:anchorlock/>'
        '<center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">'
        '{txt}</center></v:roundrect>'
        '<![endif]-->'
    ).format(url=url, w=ancho, h=alto, blue=MAIL_BLUE, txt=etiqueta)
    estandar = (
        '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;">'
        '<tr><td align="center" bgcolor="{blue}" style="border-radius:8px;">'
        '<a href="{url}" target="_blank" style="display:inline-block;padding:14px 28px;'
        'font-family:Arial,sans-serif;font-size:15px;font-weight:bold;line-height:1.2;'
        'color:#ffffff;text-decoration:none;border-radius:8px;">{txt}</a>'
        '</td></tr></table>'
    ).format(url=url, blue=MAIL_BLUE, txt=etiqueta)
    return ('<div style="text-align:center;margin:28px 0;">' + vml
            + '<!--[if !mso]><!-->' + estandar + '<!--<![endif]--></div>')


def mail_code(codigo):
    """Bloque del código de un solo uso: lo que el destinatario viene a copiar."""
    return (
        '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:24px auto;">'
        '<tr><td align="center" bgcolor="#eef7fd" style="border-radius:10px;padding:18px 32px;'
        'border:1px solid {border};">'
        '<div style="font-family:Arial,sans-serif;font-size:34px;font-weight:bold;'
        'letter-spacing:8px;color:{blue};">{code}</div></td></tr></table>'
    ).format(code=_mail_esc(codigo), blue=MAIL_BLUE, border=MAIL_BORDER)


def mail_rows(pares):
    """Filas etiqueta/valor (resumen diario, reputación, saldo)."""
    filas = ''.join(
        '<tr><td style="padding:9px 0;border-bottom:1px solid {b};font-family:Arial,sans-serif;'
        'font-size:14px;color:{m};">{k}</td>'
        '<td style="padding:9px 0;border-bottom:1px solid {b};text-align:right;'
        'font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:{c};">{v}</td></tr>'.format(
            b=MAIL_BORDER, m=MAIL_MUTED, k=_mail_esc(k), v=_mail_esc(v),
            c=(color or MAIL_INK))
        for k, v, color in pares)
    return ('<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"'
            ' style="margin:8px 0 4px;">' + filas + '</table>')


def _mail_social():
    iconos = ''.join(
        '<a href="{url}" target="_blank" style="text-decoration:none;display:inline-block;margin:0 6px;">'
        '<img src="{assets}/red-{slug}.png" width="22" height="22" alt="{nom}"'
        ' style="display:inline-block;border:0;" /></a>'.format(
            url=_mail_esc(url), assets=MAIL_ASSETS, slug=slug, nom=nombre)
        for slug, nombre, url in MAIL_SOCIAL if str(url or '').strip())
    if not iconos:
        return ''
    return '<div style="margin:0 0 14px;">' + iconos + '</div>'


def brand_email(titulo, contenido, cta=None, nota='', preheader=''):
    """Correo interno con la identidad de la plataforma.

    `contenido` es HTML ya compuesto (párrafos, código, filas). `cta` es (texto, url).
    `nota` es la letra chica de por qué se recibe este correo.
    """
    # El preheader es lo que la bandeja muestra JUNTO al asunto; sin él, Gmail muestra el
    # primer texto que encuentre (normalmente el enlace del logo, que no dice nada).
    pre = ('<div style="display:none;font-size:1px;color:#f4f7fb;line-height:1px;'
           'max-height:0;max-width:0;opacity:0;overflow:hidden;">' + _mail_esc(preheader)
           + '&#8199;&#65279;&#847; ' * 20 + '</div>') if preheader else ''

    boton = mail_button(cta[0], cta[1]) if cta else ''
    pie_nota = ('<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:12px;'
                'line-height:1.6;color:#9aa7bd;">' + nota + '</p>') if nota else ''

    # `<style>` aparte del .format() porque lleva llaves literales de CSS.
    estilos = (
        '<style type="text/css">'
        '@media only screen and (max-width:620px){'
        '  .mc-card{width:100% !important;}'
        '  .mc-pad{padding-left:22px !important;padding-right:22px !important;}'
        '}'
        '</style>'
    )

    cabeza = (
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'
        ' "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'
        '<html xmlns="http://www.w3.org/1999/xhtml"><head>'
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        '<title>' + _mail_esc(titulo) + '</title>' + estilos + '</head>'
    )

    cuerpo = (
        '<body style="margin:0;padding:0;background-color:{bg};">' + pre +
        '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"'
        ' style="background-color:{bg};"><tr><td align="center" style="padding:28px 12px;">'
        # Ghost table: Outlook no respeta max-width, así que allí el ancho se fija aquí.
        '<!--[if mso]><table role="presentation" width="600" border="0" cellpadding="0"'
        ' cellspacing="0"><tr><td><![endif]-->'
        '<table role="presentation" class="mc-card" width="600" border="0" cellpadding="0"'
        ' cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;'
        'border:1px solid {border};border-radius:14px;">'

        # Encabezado con el logotipo
        '<tr><td class="mc-pad" align="center" style="padding:30px 36px 8px;">'
        '<a href="{site}" target="_blank" style="text-decoration:none;">'
        '<img src="{assets}/logo.png" width="180" alt="MailConnect"'
        ' style="display:block;border:0;width:180px;max-width:180px;height:auto;" /></a>'
        '</td></tr>'
        # Filete de marca
        '<tr><td style="padding:14px 36px 0;">'
        '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">'
        '<tr><td height="3" bgcolor="{cyan}" style="height:3px;line-height:3px;font-size:0;'
        'border-radius:2px;">&nbsp;</td></tr></table></td></tr>'

        # Contenido
        '<tr><td class="mc-pad" style="padding:26px 36px 6px;">'
        '<h1 style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:22px;'
        'line-height:1.3;color:{ink};">{titulo}</h1>{contenido}</td></tr>'
        '<tr><td class="mc-pad" style="padding:0 36px;">{boton}</td></tr>'

        # Pie
        '<tr><td class="mc-pad" align="center" style="padding:26px 36px 30px;">'
        '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">'
        '<tr><td height="1" bgcolor="{border}" style="height:1px;line-height:1px;font-size:0;">'
        '&nbsp;</td></tr></table>'
        '<div style="padding-top:20px;">{redes}'
        '<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:{muted};">'
        '<a href="{site}" target="_blank" style="color:{blue};text-decoration:none;">'
        'mailconnect.com.co</a>'
        ' &nbsp;·&nbsp; <a href="mailto:{correo}" style="color:{blue};text-decoration:none;">'
        '{correo}</a></p>'
        '{nota}'
        '<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#b3bdcc;">'
        'MailConnect · Comunicaciones masivas omnicanal · Colombia</p>'
        '</div></td></tr>'

        '</table>'
        '<!--[if mso]></td></tr></table><![endif]-->'
        '</td></tr></table></body></html>'
    ).format(bg=MAIL_BG, border=MAIL_BORDER, ink=MAIL_INK, blue=MAIL_BLUE, cyan=MAIL_CYAN,
             muted=MAIL_MUTED, site=MAIL_SITE, assets=MAIL_ASSETS, correo=MAIL_CONTACT,
             titulo=_mail_esc(titulo), contenido=contenido, boton=boton,
             redes=_mail_social(), nota=pie_nota)

    return cabeza + cuerpo


def mail_p(texto, color=None, size=15):
    """Párrafo del cuerpo, con la tipografía del correo."""
    return ('<p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:{s}px;'
            'line-height:1.65;color:{c};">{t}</p>').format(
                s=size, c=(color or MAIL_INK), t=texto)


def _hash_password(password, salt):
    """PBKDF2-HMAC-SHA256 (stdlib, sin dependencias/layer). Formato auto-descriptivo
    'pbkdf2$<iter>$<hex>'. Reemplaza el SHA-256 de una sola pasada (débil ante GPU)."""
    dk = hashlib.pbkdf2_hmac('sha256', str(password).encode(), str(salt).encode(), PBKDF2_ITERATIONS)
    return 'pbkdf2${}${}'.format(PBKDF2_ITERATIONS, dk.hex())


def _verify_password(password, stored_hash, salt):
    """Verifica contra el hash nuevo (pbkdf2) o el viejo (sha256), timing-safe."""
    stored = str(stored_hash or '')
    if stored.startswith('pbkdf2$'):
        try:
            _, iters, hexhash = stored.split('$', 2)
            dk = hashlib.pbkdf2_hmac('sha256', str(password).encode(), str(salt).encode(), int(iters))
            return hmac.compare_digest(dk.hex(), hexhash)
        except Exception:
            return False
    legacy = hashlib.sha256((str(password) + str(salt)).encode()).hexdigest()
    return hmac.compare_digest(legacy, stored)


def _is_legacy_hash(stored_hash):
    return not str(stored_hash or '').startswith('pbkdf2$')


def tenant_bucket(nit, doc_type=None):
    """Bucket ÚNICO del cliente por NIT: {prefix}-{nit}. Los tipos (database/document/
    resources/attachment) son PREFIJOS de la key, no buckets separados. doc_type se
    conserva por compatibilidad de firma y se ignora."""
    clean = re.sub(r'[^a-z0-9]', '', str(nit or '').lower())
    return '{}-{}'.format(BUCKET_PREFIX, clean)


# Prefijos "de carpeta" del bucket del cliente (S3 no tiene carpetas; son prefijos de key).
# `personalized/` guarda los adjuntos personalizados por destinatario (docx/pdf con datos
# personales) y queda PRIVADO: la política pública solo cubre attachment/ y resources/.
BUCKET_PREFIXES = ('database/', 'document/', 'resources/', 'attachment/', 'personalized/')

# CORS del bucket del cliente: el front necesita leer/subir objetos (p. ej. el comprobante
# de transferencia que ve el admin en la bandeja de aprobación, o subir bases/adjuntos).
_CORS_RULES = {
    'CORSRules': [{
        'AllowedHeaders': ['*'],
        'AllowedMethods': ['GET', 'PUT', 'HEAD'],
        'AllowedOrigins': ['*'],
        'ExposeHeaders': ['ETag'],
        'MaxAgeSeconds': 3000,
    }]
}


def _public_read_policy(bucket):
    """Política que hace PÚBLICOS de lectura solo los prefijos attachment/ y resources/
    (imágenes de plantillas y adjuntos que deben verse en los clientes de correo). Los
    prefijos database/, document/ y personalized/ quedan PRIVADOS (los personalizados por
    destinatario se adjuntan por get_object/IAM; los demás con URL prefirmada)."""
    return json.dumps({
        'Version': '2012-10-17',
        'Statement': [{
            'Sid': 'PublicReadAttachmentResources',
            'Effect': 'Allow',
            'Principal': '*',
            'Action': 's3:GetObject',
            'Resource': [
                'arn:aws:s3:::{}/attachment/*'.format(bucket),
                'arn:aws:s3:::{}/resources/*'.format(bucket),
            ],
        }],
    })


def ensure_bucket(name):
    """Crea el bucket ÚNICO del cliente (idempotente) y le aplica CORS + política de lectura
    pública para attachment/ y resources/. Best-effort: NUNCA interrumpe el registro."""
    created = False
    try:
        s3.head_bucket(Bucket=name)
    except Exception:
        try:
            s3.create_bucket(Bucket=name)  # us-east-1: sin LocationConstraint
            created = True
            print('Bucket creado: {}'.format(name))
        except s3.exceptions.BucketAlreadyOwnedByYou:
            pass
        except Exception as e:
            print('No se pudo crear el bucket {}: {}'.format(name, e))
            return
    # Permitir una política pública en el bucket (S3 bloquea políticas públicas por
    # defecto). Se bloquean las ACLs públicas pero se permite la POLÍTICA (más segura).
    try:
        s3.put_public_access_block(Bucket=name, PublicAccessBlockConfiguration={
            'BlockPublicAcls': True, 'IgnorePublicAcls': True,
            'BlockPublicPolicy': False, 'RestrictPublicBuckets': False})
    except Exception as e:
        print('No se pudo ajustar el public access block de {}: {}'.format(name, e))
    try:
        s3.put_bucket_cors(Bucket=name, CORSConfiguration=_CORS_RULES)
    except Exception as e:
        print('No se pudo configurar CORS de {}: {}'.format(name, e))
    try:
        s3.put_bucket_policy(Bucket=name, Policy=_public_read_policy(name))
    except Exception as e:
        print('No se pudo aplicar la política pública de {}: {}'.format(name, e))
    # Marcadores de prefijo (para que se vean las "carpetas" en la consola). Best-effort.
    if created:
        for pfx in BUCKET_PREFIXES:
            try:
                s3.put_object(Bucket=name, Key=pfx)
            except Exception:
                pass

# Configuración por variables de entorno (con valores por defecto)
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'comunicaciones@mailconnect.com.co')
# URL del endpoint de activación. Al hacer clic, el usuario llega a Acount-activation.
ACTIVATION_URL = os.environ.get(
    'ACTIVATION_URL',
    'https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api/account-activation'
)

# Ajustes de plataforma (tabla platformConfig, editable desde /admin) con fallback a env.
_cfg_table = dynamodb.Table('platformConfig')
_audit_table = dynamodb.Table('adminAudit')


def _platform_cfg(key):
    """Lee un ajuste global desde platformConfig. Nunca falla: None si no existe."""
    try:
        item = _cfg_table.get_item(Key={'configKey': key}).get('Item')
        if item and item.get('value') not in (None, ''):
            return item['value']
    except Exception:
        return None
    return None


def _get_payload(event):
    """Soporta integración directa (event = body) y Lambda-proxy (event['body'] string)."""
    # API Gateway (mapping template) puede inyectar el body como OBJETO JSON
    # (integración no-proxy) o como STRING (proxy). Se aceptan ambos.
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _valid_password(password):
    """Reglas mínimas de contraseña (coinciden con change-password y el front)."""
    if not password or len(str(password)) < 8:
        return False
    p = str(password)
    return bool(re.search(r'[a-z]', p) and re.search(r'[A-Z]', p) and re.search(r'\d', p))


def valid_email(email):
    response = table_user.scan(
        FilterExpression="email = :value",
        ExpressionAttributeValues={":value": email},
        ProjectionExpression='email'
    )
    return not response['Items']


class CompanyAlreadyRegistered(Exception):
    """El NIT ya pertenece a una empresa registrada → no se permite auto-unirse."""


def exist_companyTin(companyTin):
    response = table_customer.scan(
        FilterExpression="companyTin = :value",
        ExpressionAttributeValues={":value": companyTin},
        ProjectionExpression='companyTin'
    )
    return bool(response['Items'])


def get_customerId(companyTin):
    response = table_customer.scan(
        FilterExpression="companyTin = :value",
        ExpressionAttributeValues={":value": companyTin},
        ProjectionExpression='customerId'
    )
    if response['Items']:
        return response['Items'][0]['customerId']
    return None


def send_activation_email(email, name, activation_key):
    """Envía el correo de activación con el enlace. No interrumpe el registro si falla."""
    base = str(_platform_cfg('ACTIVATION_URL') or ACTIVATION_URL)
    link = "{base}?qs={key}".format(base=base, key=activation_key)
    subject = "Activa tu cuenta de MailConnect"
    html_body = brand_email(
        'Bienvenido a MailConnect, {}'.format(_mail_esc(name)),
        mail_p('Gracias por registrarte. Para empezar a enviar, activa tu cuenta con el '
               'botón de abajo.')
        # El enlace en texto va DESPUÉS del botón: quien abre el correo busca el botón, y
        # la URL cruda antes de él solo hace ruido.
        + mail_p('¿El botón no funciona? Copia este enlace en tu navegador:<br />'
                 '<a href="{l}" style="color:#0075be;word-break:break-all;">{l}</a>'.format(
                     l=_mail_esc(link)), color='#5b6b86', size=13),
        cta=('Activar mi cuenta', link),
        nota='El enlace expira en 24 horas. Si no creaste esta cuenta, ignora este mensaje.',
        preheader='Activa tu cuenta para empezar a enviar.')

    text_body = "Activa tu cuenta de MailConnect en este enlace: {link} (expira en 24 horas).".format(link=link)

    ses.send_email(
        Source=str(_platform_cfg('SENDER_EMAIL') or SENDER_EMAIL),
        Destination={'ToAddresses': [email]},
        Message={
            'Subject': {'Data': subject, 'Charset': 'UTF-8'},
            'Body': {
                'Html': {'Data': html_body, 'Charset': 'UTF-8'},
                'Text': {'Data': text_body, 'Charset': 'UTF-8'},
            }
        }
    )


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _audit(event, action, target, detail):
    """Bitácora (adminAudit) best-effort — nunca rompe la operación."""
    try:
        auth = _authorizer(event)
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'cliente'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def lambda_handler(event, context):
    status = True
    description = "Usuario registrado exitosamente"
    statusCode = 201
    validData = True

    payload = _get_payload(event)

    try:
        # Obtener datos del evento
        password = payload['password']
        name = payload['name']
        # Normalizar email a minúsculas: evita cuentas duplicadas por diferencia de
        # mayúsculas (User@x.com vs user@x.com) y hace consistentes los lookups.
        email = str(payload['email']).strip().lower()
        phone = payload['phone']
        company = payload['company']
        # La tabla 'customer' define companyTin como String (S) en el índice
        # companyTin-date. El front lo envía como número, así que lo normalizamos
        # a str para que coincida con el tipo del índice (evita ValidationException
        # "Type mismatch for Index Key companyTin") y para que los scan comparen S==S.
        companyTin = str(payload['companyTin'])
        # Aceptación de términos + autorización de tratamiento de datos (Habeas Data).
        # El front exige marcar la casilla; guardamos la evidencia (bool + fecha + versión).
        accepted_terms = bool(payload.get('acceptedTerms', False))
        terms_version = str(payload.get('termsVersion', '2026-07-10'))

        print("Inicio validación de los datos del payload")

        # Validación del teléfono (solo números)
        if not bool(re.match('^[0-9]+$', str(phone))):
            validData = False
            print("Teléfono inválido")

        # Validación del NIT (solo números)
        if not bool(re.match('^[0-9]+$', str(companyTin))):
            validData = False
            print("NIT inválido")

        # Validación del email
        patron_email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
        if not bool(re.match(patron_email, email)):
            validData = False
            print("Email inválido")

        # Validación de fortaleza de la contraseña (mismas reglas que change-password
        # y el front): >=8, minúscula, mayúscula y dígito.
        if not _valid_password(password):
            validData = False
            print("Contraseña débil")

    except KeyError:
        status = False
        statusCode = 400
        description = "Faltan datos obligatorios"
    except Exception:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        if validData:
            try:
                if valid_email(email):
                    now = datetime.utcnow()
                    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")

                    # La activación expira en 24 horas
                    expiracionDate = now + timedelta(hours=24)
                    expirationTime = expiracionDate.strftime('%Y-%m-%dT%H:%M:%SZ')

                    userDataId = str(uuid.uuid4())
                    userId = str(uuid.uuid4())
                    activationId = str(uuid.uuid4())
                    activationKey = str(uuid.uuid4())

                    # Generar un salt aleatorio y hashear la contraseña (PBKDF2)
                    salt = str(uuid.uuid4())
                    hashed_password = _hash_password(password, salt)

                    # Cliente (customer) por NIT: crear SOLO si el NIT es nuevo.
                    # SEGURIDAD (aislamiento multi-tenant): un NIT ya registrado NO se
                    # reutiliza. Antes se tomaba el customerId del dueño → cualquiera que
                    # conociera el NIT se registraba y quedaba dentro del tenant de otra
                    # empresa como owner (veía campañas/saldo/bases y podía enviar a su
                    # nombre). Ahora el auto-registro con un NIT existente se RECHAZA (409);
                    # el dueño suma a su equipo desde el portal (User/Create, tope 2).
                    if exist_companyTin(companyTin):
                        raise CompanyAlreadyRegistered()
                    else:
                        customerId = str(uuid.uuid4())
                        table_customer.put_item(
                            Item={
                                'customerId': customerId,
                                'company': company,
                                'companyTin': companyTin,
                                # Envíos reales DESHABILITADOS por defecto (opt-in): un
                                # cliente nuevo no puede disparar envíos reales hasta que
                                # un admin lo habilite (Customer/Update). Evita envíos no
                                # autorizados de cuentas recién registradas. Prepare-batch
                                # lo verifica en el envío real.
                                'realSendEnabled': False,
                                # Funciones AVANZADAS deshabilitadas por defecto (opt-in):
                                # canales Voz/WhatsApp, editores PDF de lienzo, plantillas
                                # WhatsApp y las cargas especiales de bases. El cliente nuevo
                                # arranca con lo básico y el admin habilita lo demás desde
                                # "Funciones por cliente". Convención FAIL-OPEN del resto:
                                # una clave ausente = habilitada, por eso se escriben
                                # EXPLÍCITAMENTE en false (ver 05_Frontend .../config/features.ts).
                                'featureFlags': {k: False for k in DEFAULT_DISABLED_FEATURES},
                                'date': formattedDate
                            }
                        )
                        # Crear el bucket ÚNICO del cliente (por NIT) la PRIMERA vez que
                        # aparece la empresa: mailconnect-{nit} con los prefijos database/,
                        # document/, resources/ y attachment/, su CORS y la política pública
                        # (attachment/ y resources/). Antes no se creaba → el primer upload
                        # del cliente fallaba (NoSuchBucket).
                        ensure_bucket(tenant_bucket(companyTin))

                    # Datos del usuario
                    table_userData.put_item(
                        Item={
                            'userDataId': userDataId,
                            'customerId': customerId,
                            'userName': name,
                            'phone': phone,
                            'date': formattedDate
                        }
                    )

                    # Usuario (inactivo hasta activar). Rol por defecto: 'client'.
                    # Los administradores de MailConnect se provisionan aparte
                    # (cambiando este campo a 'admin' en la tabla / por un script).
                    table_user.put_item(
                        Item={
                            'userId': userId,
                            'userDataId': userDataId,
                            'customerId': customerId,
                            'email': email,
                            'userHash': hashed_password,
                            'userSalt': salt,
                            'role': 'client',
                            # Sub-rol dentro de la empresa (RBAC; ver PLAN_APROBACIONES.md).
                            # El que registra la empresa queda como 'owner' (hace todo);
                            # owner/approver aprueban y envían, operator solo prepara/prueba.
                            'tenantRole': 'owner',
                            # Evidencia de aceptación de términos (Ley 1581).
                            'termsAccepted': accepted_terms,
                            'termsAcceptedAt': formattedDate if accepted_terms else '',
                            'termsVersion': terms_version,
                            'date': formattedDate,
                            'active': False
                        }
                    )

                    # Registro de activación
                    table_activation.put_item(
                        Item={
                            'userActivationId': activationId,
                            'userId': userId,
                            'activationKey': activationKey,
                            'expirationTime': expirationTime,
                            'used': False
                        }
                    )

                    # Alta de una EMPRESA nueva en la plataforma (un NIT = un solo
                    # auto-registro, el que registra queda owner): queda en la bitácora
                    # con el NIT, que es la llave de todos sus recursos.
                    _audit(event, 'security.register', email,
                           'Empresa "{}" (NIT {}) registrada; el usuario queda owner'.format(
                               company, companyTin))

                    # Enviar correo de activación (no rompe el registro si falla)
                    try:
                        send_activation_email(email, name, activationKey)
                    except Exception as mail_error:
                        print("No se pudo enviar el correo de activación: {}".format(mail_error))
                        description = ("Usuario registrado. No se pudo enviar el correo de "
                                       "activación; solicita el reenvío.")
                else:
                    status = False
                    statusCode = 409
                    description = "Email ya se encuentra registrado"
            except CompanyAlreadyRegistered:
                status = False
                statusCode = 409
                description = ("Esta empresa (NIT) ya está registrada. Pídele al administrador "
                               "de tu empresa que te cree el usuario desde el portal.")
            except Exception as e:
                print("Error en registro: {}".format(e))
                status = False
                statusCode = 500
                description = "Error no controlado en el servicio"
        else:
            status = False
            statusCode = 400
            description = "Algunos campos enviados no cumplen con los requisitos del servicio"
    finally:
        response = {
            'status': status,
            'statusCode': statusCode,
            'description': description
        }

    return response
