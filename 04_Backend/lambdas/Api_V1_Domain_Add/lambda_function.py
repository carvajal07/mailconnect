'''
Lambda: AGREGAR un dominio de envío propio del cliente (identidad SES por dominio).

El cliente registra su dominio (p. ej. empresa.com) para poder enviar desde
{cualquier}@empresa.com. Esta lambda pide a SES los tokens de verificación:
  - verify_domain_identity  → 1 registro TXT (`_amazonses.{dominio}` = token) [verificación]
  - verify_domain_dkim      → 3 registros CNAME (`{t}._domainkey.{dominio}` = `{t}.dkim.amazonses.com`) [DKIM]
Guarda el dominio (estado 'pending') + los registros DNS en la tabla `senderDomain` y los
DEVUELVE para que el cliente los cargue en su proveedor DNS. SES verifica solo cuando los
registros están publicados (ver Domain_List, que refresca el estado).

Ruta: POST /Domain/Add  (no-proxy, envelope estándar)
Request:  { domain }
Respuesta: 201 data:{ domainId, domain, status, records:[{type,name,value}] } · 400 · 403 · 409

⚠️ Las identidades SES son a NIVEL DE CUENTA AWS (compartidas entre tenants): esta tabla
guarda QUÉ cliente es dueño de cada dominio para no permitir que otro lo use como remitente.
'''
import os
import re
import time
import uuid
import boto3
from botocore.exceptions import ClientError

# La verificación de dominio DEBE hacerse en la MISMA región donde se envía (us-east-1).
REGION = os.environ.get('SES_REGION', 'us-east-1')
ses = boto3.client('ses', region_name=REGION)
dynamodb = boto3.resource('dynamodb')
table_domain = dynamodb.Table('senderDomain')

# Dominio del propio MailConnect: no se puede registrar como "propio" del cliente.
PLATFORM_DOMAIN = os.environ.get('PLATFORM_DOMAIN', 'mailconnect.com.co')
DOMAIN_RE = re.compile(r'^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$')


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


def _existing(customer_id, domain):
    """¿El cliente ya tiene ese dominio? (Query por el GSI). Devuelve el item o None."""
    try:
        from boto3.dynamodb.conditions import Key
        resp = table_domain.query(
            IndexName='customerId-index',
            KeyConditionExpression=Key('customerId').eq(customer_id))
        for it in resp.get('Items', []):
            if str(it.get('domain', '')).lower() == domain:
                return it
    except Exception as e:
        print('No se pudo consultar dominios existentes: {}'.format(e))
    return None


def _dns_records(domain, verification_token, dkim_tokens):
    """Arma la lista de registros DNS que el cliente debe publicar."""
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


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    customer = auth.get('customer') or ''
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    domain = str(payload.get('domain', '') or '').strip().lower().lstrip('@')
    # Quita un esquema o path por si el usuario pega una URL.
    domain = re.sub(r'^https?://', '', domain).split('/')[0]
    if not DOMAIN_RE.match(domain):
        return {'status': False, 'statusCode': 400, 'description': 'Indica un dominio válido (ej. empresa.com).'}
    if domain == PLATFORM_DOMAIN or domain.endswith('.' + PLATFORM_DOMAIN):
        return {'status': False, 'statusCode': 400,
                'description': 'Ese dominio es de MailConnect; usa el remitente por defecto.'}

    try:
        _ensure_table()
        if _existing(customer_id, domain):
            return {'status': False, 'statusCode': 409, 'description': 'Ya registraste ese dominio.'}

        # SES: token de verificación (TXT) + tokens DKIM (3 CNAME).
        verification_token = ses.verify_domain_identity(Domain=domain).get('VerificationToken', '')
        dkim_tokens = ses.verify_domain_dkim(Domain=domain).get('DkimTokens', [])
        records = _dns_records(domain, verification_token, dkim_tokens)

        domain_id = str(uuid.uuid4())
        now = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
        table_domain.put_item(Item={
            'domainId': domain_id,
            'customerId': customer_id,
            'customer': customer,
            'domain': domain,
            'status': 'pending',          # pending | verified | failed
            'verificationToken': verification_token,
            'dkimTokens': dkim_tokens,
            'records': records,
            'createdAt': now,
            'verifiedAt': '',
        })
        return {'status': True, 'statusCode': 201,
                'description': 'Dominio registrado. Publica los registros DNS para verificarlo.',
                'data': {'domainId': domain_id, 'domain': domain, 'status': 'pending', 'records': records}}
    except ClientError as e:
        print('Error SES/DynamoDB al agregar dominio: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo registrar el dominio.'}
    except Exception as e:
        print('Error no controlado al agregar dominio: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al agregar el dominio.'}
