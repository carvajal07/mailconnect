'''
Lambda: AGREGAR un remitente propio del cliente — DOMINIO o CORREO — como identidad SES.

SES soporta DOS tipos de identidad de remitente, y esta lambda registra ambos:
  - DOMINIO (ej. empresa.com): habilita enviar desde {cualquier}@empresa.com. Se verifica por
    DNS → verify_domain_identity (1 registro TXT) + verify_domain_dkim (3 CNAME). El cliente
    publica los registros en su proveedor DNS y SES verifica cuando están propagados.
  - CORREO (ej. ventas@empresa.com): habilita enviar SOLO desde esa dirección exacta. Se verifica
    por correo → verify_email_identity: SES manda un mensaje con un enlace de confirmación a esa
    dirección; el dueño de la bandeja hace clic y queda verificada (NO requiere tocar el DNS).

El tipo se detecta por la presencia de '@' en el valor recibido (o el hint opcional `kind`).
Se guarda en la MISMA tabla `senderDomain` con un campo `kind` ('domain' | 'email'); el valor
(dominio o correo) se guarda en el campo `domain` para no cambiar el esquema ni los lectores.

Ruta: POST /Domain/Add  (no-proxy, envelope estándar)
Request:  { identity }   (alias legacy: { domain } / { email })
Respuesta:
  - dominio → 201 data:{ domainId, kind:'domain', domain, status:'pending', records:[TXT + 3 CNAME] }
  - correo  → 201 data:{ domainId, kind:'email',  domain(=correo), status:'pending', records:[] }
  - correo pendiente ya registrado → 200 (REENVÍA el correo de verificación)
  - 400 inválido · 403 sin sesión · 409 duplicado (dominio, o correo ya verificado)

⚠️ Las identidades SES son a NIVEL DE CUENTA AWS (compartidas entre tenants): esta tabla guarda
QUÉ cliente es dueño de cada identidad para no permitir que otro la use como remitente.
'''
import os
import re
import time
import uuid
import boto3
from botocore.exceptions import ClientError

# La verificación de identidad DEBE hacerse en la MISMA región donde se envía (us-east-1).
REGION = os.environ.get('SES_REGION', 'us-east-1')
ses = boto3.client('ses', region_name=REGION)
dynamodb = boto3.resource('dynamodb')
table_domain = dynamodb.Table('senderDomain')

# Dominio del propio MailConnect: no se puede registrar como "propio" del cliente.
PLATFORM_DOMAIN = os.environ.get('PLATFORM_DOMAIN', 'mailconnect.com.co')
DOMAIN_RE = re.compile(r'^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$')
# Correo: parte local simple + dominio válido (reusa la forma del dominio).
EMAIL_RE = re.compile(r"^[a-z0-9._%+\-]+@(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$")


def _get_payload(event):
    import json
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


def _ensure_table():
    """Crea la tabla senderDomain si no existe (PK domainId + GSI por customerId)."""
    try:
        dynamodb.meta.client.describe_table(TableName='senderDomain')
        return
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
    try:
        dynamodb.create_table(
            TableName='senderDomain',
            KeySchema=[{'AttributeName': 'domainId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[
                {'AttributeName': 'domainId', 'AttributeType': 'S'},
                {'AttributeName': 'customerId', 'AttributeType': 'S'},
            ],
            GlobalSecondaryIndexes=[{
                'IndexName': 'customerId-index',
                'KeySchema': [{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
                'Projection': {'ProjectionType': 'ALL'},
            }],
            BillingMode='PAY_PER_REQUEST')
        dynamodb.meta.client.get_waiter('table_exists').wait(
            TableName='senderDomain', WaiterConfig={'Delay': 2, 'MaxAttempts': 30})
        print('Tabla senderDomain creada.')
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceInUseException':
            raise


def _existing(customer_id, value):
    """¿El cliente ya tiene esa identidad (dominio o correo)? (Query por el GSI).
    Devuelve el item o None. La comparación es sobre el campo `domain` (guarda ambos)."""
    try:
        from boto3.dynamodb.conditions import Key
        resp = table_domain.query(
            IndexName='customerId-index',
            KeyConditionExpression=Key('customerId').eq(customer_id))
        for it in resp.get('Items', []):
            if str(it.get('domain', '')).lower() == value:
                return it
    except Exception as e:
        print('No se pudo consultar identidades existentes: {}'.format(e))
    return None


def _dns_records(domain, verification_token, dkim_tokens):
    """Arma la lista de registros DNS que el cliente debe publicar (solo dominios)."""
    records = [{
        'type': 'TXT',
        'name': '_amazonses.{}'.format(domain),
        'value': verification_token,
        'purpose': 'Verificación del dominio',
    }]
    for t in dkim_tokens:
        records.append({
            'type': 'CNAME',
            'name': '{}._domainkey.{}'.format(t, domain),
            'value': '{}.dkim.amazonses.com'.format(t),
            'purpose': 'Firma DKIM',
        })
    return records


def _add_email(customer_id, customer, email):
    """Registra un CORREO como identidad SES (verificación por enlace enviado al correo).
    Si el correo pendiente ya existe, REENVÍA la verificación (200) en vez de duplicar (409)."""
    existing = _existing(customer_id, email)
    if existing:
        if existing.get('status') == 'verified':
            return {'status': False, 'statusCode': 409, 'description': 'Ese correo ya está verificado.'}
        # Pendiente: reenviar el correo de verificación (idempotente, útil si el enlace venció).
        ses.verify_email_identity(EmailAddress=email)
        return {'status': True, 'statusCode': 200,
                'description': 'Te reenviamos el correo de verificación a {}. Revisa la bandeja '
                               '(y spam) y haz clic en el enlace.'.format(email),
                'data': {'domainId': existing['domainId'], 'kind': 'email', 'domain': email,
                         'status': existing.get('status', 'pending'), 'records': []}}

    # SES envía un correo con un enlace de confirmación a esa dirección.
    ses.verify_email_identity(EmailAddress=email)

    domain_id = str(uuid.uuid4())
    now = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
    table_domain.put_item(Item={
        'domainId': domain_id,
        'customerId': customer_id,
        'customer': customer,
        'kind': 'email',
        'domain': email,               # el valor (correo) va en `domain` para no cambiar lectores
        'status': 'pending',           # pending | verified | failed
        'records': [],                 # los correos NO llevan registros DNS
        'createdAt': now,
        'verifiedAt': '',
    })
    return {'status': True, 'statusCode': 201,
            'description': 'Correo registrado. Revisa la bandeja de {} y haz clic en el enlace '
                           'de verificación de Amazon SES.'.format(email),
            'data': {'domainId': domain_id, 'kind': 'email', 'domain': email,
                     'status': 'pending', 'records': []}}


def _add_domain(customer_id, customer, domain):
    """Registra un DOMINIO como identidad SES (verificación por DNS: 1 TXT + 3 CNAME DKIM)."""
    if _existing(customer_id, domain):
        return {'status': False, 'statusCode': 409, 'description': 'Ya registraste ese dominio.'}

    verification_token = ses.verify_domain_identity(Domain=domain).get('VerificationToken', '')
    dkim_tokens = ses.verify_domain_dkim(Domain=domain).get('DkimTokens', [])
    records = _dns_records(domain, verification_token, dkim_tokens)

    domain_id = str(uuid.uuid4())
    now = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
    table_domain.put_item(Item={
        'domainId': domain_id,
        'customerId': customer_id,
        'customer': customer,
        'kind': 'domain',
        'domain': domain,
        'status': 'pending',           # pending | verified | failed
        'verificationToken': verification_token,
        'dkimTokens': dkim_tokens,
        'records': records,
        'createdAt': now,
        'verifiedAt': '',
    })
    return {'status': True, 'statusCode': 201,
            'description': 'Dominio registrado. Publica los registros DNS para verificarlo.',
            'data': {'domainId': domain_id, 'kind': 'domain', 'domain': domain,
                     'status': 'pending', 'records': records}}


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    customer = auth.get('customer') or ''
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    # Valor recibido: acepta `identity` (canónico) o los alias legacy `domain` / `email`.
    raw = str(payload.get('identity') or payload.get('domain') or payload.get('email') or '').strip().lower()
    kind_hint = str(payload.get('kind') or '').strip().lower()
    # Es correo si el hint lo dice, o si trae '@' y el hint no fuerza 'domain'.
    is_email = kind_hint == 'email' or ('@' in raw and kind_hint != 'domain')

    try:
        _ensure_table()
        if is_email:
            email = raw.lstrip('@')  # por si pegan "@correo" por error
            if not EMAIL_RE.match(email):
                return {'status': False, 'statusCode': 400,
                        'description': 'Indica un correo válido (ej. ventas@tuempresa.com).'}
            dom = email.split('@')[-1]
            if dom == PLATFORM_DOMAIN or dom.endswith('.' + PLATFORM_DOMAIN):
                return {'status': False, 'statusCode': 400,
                        'description': 'Ese correo es de MailConnect; usa el remitente por defecto.'}
            return _add_email(customer_id, customer, email)

        # Dominio: quita un esquema o path por si pegan una URL, y un '@' al inicio.
        domain = re.sub(r'^https?://', '', raw).split('/')[0].lstrip('@')
        if not DOMAIN_RE.match(domain):
            return {'status': False, 'statusCode': 400,
                    'description': 'Indica un dominio válido (ej. empresa.com) o un correo (ej. ventas@empresa.com).'}
        if domain == PLATFORM_DOMAIN or domain.endswith('.' + PLATFORM_DOMAIN):
            return {'status': False, 'statusCode': 400,
                    'description': 'Ese dominio es de MailConnect; usa el remitente por defecto.'}
        return _add_domain(customer_id, customer, domain)
    except ClientError as e:
        print('Error SES/DynamoDB al agregar identidad: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo registrar el remitente.'}
    except Exception as e:
        print('Error no controlado al agregar identidad: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al agregar el remitente.'}
