import os
import json
import time
import uuid
import hashlib
import secrets
import boto3

dynamodb = boto3.resource('dynamodb')
ddb_client = boto3.client('dynamodb')
table_otp = dynamodb.Table('oneTimePassword')
table_user = dynamodb.Table('user')


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


def _ensure_otp_table():
    """Crea la tabla oneTimePassword (PK oneTimePasswordId) si no existe. Evita el
    ResourceNotFoundException del PutItem cuando la tabla no ha sido aprovisionada."""
    try:
        ddb_client.describe_table(TableName='oneTimePassword')
        return
    except ddb_client.exceptions.ResourceNotFoundException:
        pass
    except Exception:
        return
    try:
        ddb_client.create_table(
            TableName='oneTimePassword',
            KeySchema=[{'AttributeName': 'oneTimePasswordId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'oneTimePasswordId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        ddb_client.get_waiter('table_exists').wait(TableName='oneTimePassword')
        print('Tabla oneTimePassword creada.')
    except Exception as e:
        print('No se pudo crear la tabla oneTimePassword: {}'.format(e))

ses = boto3.client('ses')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'comunicaciones@mailconnect.com.co')
DEFAULT_EXPIRATION_MIN = int(os.environ.get('OTP_EXPIRATION_MIN', '5'))
MAX_OTP_EXPIRATION_MIN = int(os.environ.get('MAX_OTP_EXPIRATION_MIN', '15'))


def _invalidate_active_otps(user_id):
    """Desactiva los OTP activos del usuario (paginado). Se llama antes de emitir
    uno nuevo para que solo exista un código válido a la vez."""
    kwargs = {
        'FilterExpression': 'userId = :u AND active = :a',
        'ExpressionAttributeValues': {':u': user_id, ':a': True},
        'ProjectionExpression': 'oneTimePasswordId',
    }
    while True:
        resp = table_otp.scan(**kwargs)
        for it in resp.get('Items', []):
            try:
                table_otp.update_item(
                    Key={'oneTimePasswordId': it['oneTimePasswordId']},
                    UpdateExpression='SET active = :f',
                    ExpressionAttributeValues={':f': False})
            except Exception as e:
                print('No se pudo invalidar OTP previo: {}'.format(e))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last

# Ajustes de plataforma (tabla platformConfig, editable desde /admin) con fallback a
# las env vars de arriba. Se leen en cada invocación para reflejar cambios sin redesplegar.
_cfg_table = dynamodb.Table('platformConfig')


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


def _resolve_user(payload):
    """Devuelve (userId, email) a partir de userId o user(email)."""
    user_id = payload.get('userId')
    email = payload.get('user') or payload.get('email')
    email = str(email).strip().lower() if email else email

    if user_id and email:
        return user_id, email

    if user_id:
        # userId es la PK de `user` → GetItem O(1) (antes Scan+filter).
        item = table_user.get_item(
            Key={'userId': user_id}, ProjectionExpression='userId, email').get('Item')
        if item:
            return user_id, item.get('email')
        return user_id, None

    if email:
        resp = table_user.scan(
            FilterExpression="email = :v",
            ExpressionAttributeValues={":v": email},
            ProjectionExpression='userId, email'
        )
        if resp['Items']:
            return resp['Items'][0]['userId'], email
        return None, email

    return None, None


def send_otp_email(email, code, system):
    subject = "Tu código de verificación MailConnect"
    html_body = brand_email(
        'Tu código de verificación',
        mail_p('Usa este código para continuar ({}):'.format(_mail_esc(system)))
        + mail_code(code),
        nota='El código es de un solo uso. Si no lo solicitaste, ignora este mensaje.',
        # El preheader lleva el código: en la bandeja se ve sin abrir el correo, que es
        # justo lo que uno quiere cuando está esperando un código.
        preheader='Tu código es {}.'.format(code))
    text_body = "Tu código de verificación MailConnect es: {code}".format(code=code)

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


def lambda_handler(event, context):
    payload = _get_payload(event)

    system = payload.get('system', 'Autenticacion')
    ip = payload.get('ip', '')
    # Vigencia por defecto: ajuste de plataforma → env → 5 min.
    default_exp = DEFAULT_EXPIRATION_MIN
    _cfg_exp = _platform_cfg('OTP_EXPIRATION_MIN')
    if _cfg_exp not in (None, ''):
        try:
            default_exp = int(float(_cfg_exp))
        except Exception:
            default_exp = DEFAULT_EXPIRATION_MIN
    try:
        expiration_min = int(payload.get('expiration', default_exp))
    except Exception:
        expiration_min = default_exp
    # Tope de vigencia: el cliente no puede pedir un OTP válido por horas/años.
    expiration_min = max(1, min(expiration_min, MAX_OTP_EXPIRATION_MIN))

    try:
        user_id, email = _resolve_user(payload)
        if not user_id:
            return {'status': False, 'statusCode': 404, 'description': "Usuario no encontrado"}

        # Invalidar OTPs previos del usuario: solo uno activo a la vez (reduce la
        # superficie de fuerza bruta: N/10^6 en vez de sumar por cada OTP emitido).
        _invalidate_active_otps(user_id)

        # Generar código de 6 dígitos y guardarlo hasheado
        code = secrets.randbelow(1000000)
        code_str = "{:06d}".format(code)
        otp_id = str(uuid.uuid4())
        otp_hash = hashlib.sha256(code_str.encode()).hexdigest()
        expiration_time = int(time.time()) + expiration_min * 60

        table_otp.put_item(
            Item={
                'oneTimePasswordId': otp_id,
                'userId': user_id,
                'otpHash': otp_hash,
                'expirationTime': expiration_time,
                'active': True,
                'attempts': 0,
                'system': system,
                'ip': ip,
                'createdAt': int(time.time())
            }
        )

        # Enviar el código por correo (si tenemos email)
        email_sent = False
        if email:
            try:
                send_otp_email(email, code_str, system)
                email_sent = True
            except Exception as mail_error:
                print("No se pudo enviar el OTP por correo: {}".format(mail_error))

        return {
            'status': True,
            'statusCode': 201,
            'description': "OTP generado correctamente" if email_sent
                           else "OTP generado (no se pudo enviar el correo)",
            'data': {'otpId': otp_id}
        }
    except Exception as e:
        print("Error en create-otp: {}".format(e))
        return {'status': False, 'statusCode': 500, 'description': "Error no controlado en el servicio"}
