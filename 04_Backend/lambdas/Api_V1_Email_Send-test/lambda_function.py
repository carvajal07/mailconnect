'''
Lambda CLIENTE: PRUEBA de una plantilla de correo desde el constructor.

Envía el HTML tal como quedó en el editor, sin tener que publicarlo en SES ni crear una
campaña. Sirve para ver el correo REAL en la bandeja (que es donde de verdad se nota si
una imagen no carga, si el modo oscuro rompe el contraste o si Outlook desarma una tabla).

Ruta: POST /Email/Send-test  (integración no-proxy, envelope estándar)
Request:  { html, subject?, to?, sampleData? }   (el tenant sale del context del Authorizer)
Respuesta: 200 { data:{ to, messageId } } · 400 datos · 403 destinatario no permitido

⚠️ SEGURIDAD — por qué el destinatario está restringido:
un endpoint que envíe HTML ARBITRARIO a una dirección ARBITRARIA es un relay de spam con
la reputación de MailConnect (que es COMPARTIDA entre todos los clientes). Por eso solo se
acepta como destino un correo de un usuario ACTIVO del mismo tenant — normalmente el del
propio usuario que está diseñando. No se puede usar para enviarle a un tercero.

Además: tope diario por tenant (`TEST_SEND_DAILY_LIMIT`, default 20) sobre la misma tabla
del limitador del asistente, para que tampoco sirva para bombardear al propio equipo.

Env: SENDER_EMAIL (remitente verificado), TEST_SEND_DAILY_LIMIT.
⚠️ [J]: lambda + ruta /Email/Send-test (authorizer + CORS + mapping template con
customerId/customer/nit/user); IAM `ses:SendEmail`, `dynamodb:Scan user`,
`UpdateItem/CreateTable/DescribeTable assistantRateLimit`, `PutItem adminAudit`.
'''
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
ses = boto3.client('ses', region_name=REGION)
dynamodb = boto3.resource('dynamodb', region_name=REGION)

table_user = dynamodb.Table('user')
_cfg_table = dynamodb.Table('platformConfig')
_audit_table = dynamodb.Table('adminAudit')
_rate_table = dynamodb.Table('assistantRateLimit')

SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'notificaciones@mailconnect.com.co')
DAILY_LIMIT = int(os.environ.get('TEST_SEND_DAILY_LIMIT', '20'))
MAX_HTML_BYTES = 400 * 1024

_EMAIL_RE = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')


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


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _platform_cfg(key):
    """Ajuste global con fallback a la env var (mismo patrón del resto de lambdas)."""
    try:
        item = _cfg_table.get_item(Key={'configKey': key}).get('Item')
        if item and item.get('value') not in (None, ''):
            return item['value']
    except Exception:
        return None
    return None


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


def _tenant_emails(customer_id):
    """Correos de los usuarios ACTIVOS del tenant: el conjunto de destinos permitidos."""
    emails = set()
    try:
        kwargs = {'FilterExpression': 'customerId = :c',
                  'ExpressionAttributeValues': {':c': customer_id},
                  'ProjectionExpression': 'email, active'}
        while True:
            resp = table_user.scan(**kwargs)
            for u in resp.get('Items', []):
                if u.get('active') is not False and u.get('email'):
                    emails.add(str(u['email']).strip().lower())
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except Exception as e:
        print('No se pudieron leer los usuarios del tenant: {}'.format(e))
    return emails


def _within_daily_limit(customer_id):
    """Tope diario por tenant. FALLA ABIERTO: un problema del limitador no debe impedir
    una prueba legítima (el gate real de abuso es la lista de destinatarios)."""
    day = datetime.utcnow().strftime('%Y-%m-%d')
    key = 'testsend#{}#{}'.format(customer_id, day)
    try:
        resp = _rate_table.update_item(
            Key={'rlKey': key},
            UpdateExpression='ADD hits :one SET expiresAt = if_not_exists(expiresAt, :exp)',
            ExpressionAttributeValues={
                ':one': 1,
                ':exp': int((datetime.utcnow() + timedelta(days=2)).timestamp()),
            },
            ReturnValues='UPDATED_NEW')
        return int(resp['Attributes']['hits']) <= DAILY_LIMIT
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return True   # la tabla la crea el limitador del asistente; sin ella, no se limita
        print('Limitador de pruebas no disponible: {}'.format(e))
        return True
    except Exception as e:
        print('Limitador de pruebas no disponible: {}'.format(e))
        return True


def _fill_sample(html, sample):
    """Rellena las variables con valores de ejemplo para que la prueba se vea como el
    envío real. Resuelve la forma condicional `{{#if x}}a{{else}}b{{/if}}` igual que el
    motor de plantillas, para poder VER el valor por defecto en la prueba."""
    def cond(m):
        field, yes, no = m.group(1), m.group(2), m.group(3)
        value = str(sample.get(field, '') or '')
        return yes.replace('{{' + field + '}}', value) if value else no

    out = re.sub(r'\{\{#if\s+([a-zA-Z0-9_.-]+)\}\}(.*?)\{\{else\}\}(.*?)\{\{/if\}\}',
                 cond, html, flags=re.S)
    for k, v in sample.items():
        out = out.replace('{{' + k + '}}', str(v))
    # Lo que quede sin dato se marca visiblemente en la PRUEBA (no en el envío real),
    # para que el diseñador note que ese campo no está llegando.
    out = re.sub(r'\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}', r'[\1]', out)
    return out


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    customer_id = str(auth.get('customerId', '') or '').strip()
    actor_email = str(auth.get('user', '') or '').strip().lower()
    if not customer_id:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    html = payload.get('html') or ''
    if not isinstance(html, str) or not html.strip():
        return {'status': False, 'statusCode': 400,
                'description': 'No hay HTML que enviar.', 'data': {}}
    if len(html.encode('utf-8')) > MAX_HTML_BYTES:
        return {'status': False, 'statusCode': 400,
                'description': 'La plantilla es demasiado grande para una prueba.', 'data': {}}

    to = str(payload.get('to') or actor_email).strip().lower()
    if not _EMAIL_RE.match(to):
        return {'status': False, 'statusCode': 400,
                'description': 'Indica un correo de destino válido.', 'data': {}}

    # Gate anti-relay: solo a usuarios del PROPIO tenant.
    allowed = _tenant_emails(customer_id)
    if actor_email:
        allowed.add(actor_email)
    if allowed and to not in allowed:
        return {'status': False, 'statusCode': 403,
                'description': 'Las pruebas solo se pueden enviar a un correo de tu equipo.',
                'data': {}}

    if not _within_daily_limit(customer_id):
        return {'status': False, 'statusCode': 429,
                'description': 'Llegaste al tope de {} pruebas por día. Intenta mañana.'.format(DAILY_LIMIT),
                'data': {}}

    sample = payload.get('sampleData')
    if not isinstance(sample, dict):
        sample = {}
    sample.setdefault('nombre', 'Ana')
    sample.setdefault('empresa', auth.get('customer') or 'Tu empresa')
    sample.setdefault('email', to)
    sample.setdefault('ciudad', 'Bogotá')
    # En una PRUEBA no se puede firmar un token de baja real: se apunta a la raíz para
    # que el pie se vea y sea clicable sin dar de baja a nadie.
    sample.setdefault('unsubscribeUrl', '#prueba-sin-baja')
    sample.setdefault('preferencesUrl', '#prueba-sin-preferencias')

    subject = str(payload.get('subject') or '[Prueba] Vista previa de tu plantilla')[:200]
    sender = str(_platform_cfg('SENDER_EMAIL') or SENDER_EMAIL)

    try:
        resp = ses.send_email(
            Source=sender,
            Destination={'ToAddresses': [to]},
            Message={
                'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                'Body': {'Html': {'Data': _fill_sample(html, sample), 'Charset': 'UTF-8'}},
            },
        )
    except ClientError as e:
        print('No se pudo enviar la prueba: {}'.format(e))
        return {'status': False, 'statusCode': 502,
                'description': 'SES rechazó el envío de prueba: {}'.format(
                    e.response.get('Error', {}).get('Message', '')), 'data': {}}
    except Exception as e:
        print('Error no controlado enviando la prueba: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al enviar la prueba.', 'data': {}}

    _audit(event, 'template.test-send', to, 'Prueba de plantilla enviada desde el constructor')
    return {'status': True, 'statusCode': 200, 'description': 'Prueba enviada',
            'data': {'to': to, 'messageId': resp.get('MessageId', '')}}
