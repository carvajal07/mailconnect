'''
Lambda pública de DESUSCRIPCIÓN (link "cancelar suscripción" de los correos).

Ruta: GET/POST /Email/Unsubscribe?t=<token>   (integración PROXY, SIN authorizer:
la abre el destinatario del correo, que no tiene sesión).

El token viene firmado por la lambda de envío (Send-batch-*) con HMAC-SHA256 y la
misma SECRET_KEY, para que nadie pueda desuscribir a terceros por fuerza bruta:

    t = base64url({"c": customer, "e": email}) + "." + hmac_sha256(payload, SECRET_KEY)[:32]

Al validar, inserta el email en la tabla '{customer}_unsubscribe' (PK 'email'; la
crea si no existe) y responde una página HTML de confirmación. Es idempotente:
desuscribirse dos veces muestra la misma confirmación.

Soporta POST además de GET para el estándar "List-Unsubscribe-Post: One-Click"
(RFC 8058): los clientes de correo hacen POST a la misma URL.

Env:
  SECRET_KEY  — la misma de Login/Authorizers (firma del token).
'''
import os
import json
import hmac
import uuid
import base64
import hashlib
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
SECRET_KEY = os.environ.get('SECRET_KEY', '')

dynamodb = boto3.resource('dynamodb', region_name=REGION)
dynamodb_client = boto3.client('dynamodb', region_name=REGION)


def _html_page(title, message, ok=True):
    """Página de respuesta con la marca (autocontenida, sin assets externos)."""
    icon = '✅' if ok else '⚠️'
    body = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title} · MailConnect</title>
  <style>
    body {{ margin:0; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
           background:#f4f8fc; color:#16233f; }}
    .card {{ max-width:520px; margin:10vh auto; background:#ffffff; border-radius:14px;
            padding:40px 36px; text-align:center; box-shadow:0 8px 30px rgba(22,35,63,.10); }}
    h1 {{ font-size:22px; margin:16px 0 8px; }}
    p {{ color:#5b6b86; font-size:15px; line-height:1.6; margin:8px 0; }}
    .icon {{ font-size:44px; }}
    .brand {{ margin-top:28px; font-size:13px; color:#9aa7bd; }}
    .brand b {{ color:#0075be; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">{icon}</div>
    <h1>{title}</h1>
    <p>{message}</p>
    <div class="brand">Mail<b>connect</b> · mailconnect.com.co</div>
  </div>
</body>
</html>"""
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'},
        'body': body,
    }


def _b64url_decode(data):
    padding = '=' * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def parse_token(token):
    """Valida la firma HMAC y devuelve (customer, email) o None si es inválido."""
    try:
        payload_b64, signature = token.split('.', 1)
        expected = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(signature, expected):
            print('Firma del token inválida')
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        customer = str(payload.get('c', '')).strip()
        email = str(payload.get('e', '')).strip().lower()
        if not customer or not email or '@' not in email:
            return None
        return customer, email
    except Exception as e:
        print('Token ilegible: {}'.format(e))
        return None


def ensure_unsubscribe_table(table_name):
    """Crea la tabla de desuscritos del cliente (PK 'email') si no existe.
    Devuelve True si la tabla queda lista para escribir."""
    try:
        dynamodb.create_table(
            TableName=table_name,
            KeySchema=[{'AttributeName': 'email', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'email', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST',
        )
        # Esperar a que quede ACTIVE para poder insertar de inmediato.
        waiter = dynamodb_client.get_waiter('table_exists')
        waiter.wait(TableName=table_name, WaiterConfig={'Delay': 2, 'MaxAttempts': 15})
        print(f"Tabla '{table_name}' creada (PK email).")
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceInUseException':
            return True  # ya existía
        print('Error creando la tabla {}: {}'.format(table_name, e))
        return False


def lambda_handler(event, context):
    print(json.dumps({k: event.get(k) for k in ('httpMethod', 'queryStringParameters')}))

    qsp = (event or {}).get('queryStringParameters') or {}
    token = qsp.get('t', '')

    if not SECRET_KEY:
        print('SECRET_KEY no configurada en la lambda Unsubscribe')
        return _html_page('No pudimos procesar tu solicitud',
                          'El servicio no está disponible en este momento. Intenta más tarde.', ok=False)

    parsed = parse_token(token) if token else None
    if not parsed:
        return _html_page('Enlace inválido',
                          'Este enlace de cancelación no es válido o está incompleto. '
                          'Usa el enlace tal como llegó en tu correo.', ok=False)

    customer, email = parsed
    table_name = f'{customer}_unsubscribe'

    try:
        if not ensure_unsubscribe_table(table_name):
            raise RuntimeError('No fue posible preparar la tabla de desuscritos')

        now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
        table = dynamodb.Table(table_name)
        # PK = email → idempotente: re-desuscribirse solo refresca la fecha.
        table.put_item(
            Item={
                'email': email,
                'unsubscribeId': str(uuid.uuid4()),
                'date': now,
                'source': 'link',
            }
        )
        print(f'{email} desuscrito de {customer}')
        return _html_page('Suscripción cancelada',
                          f'La dirección <b>{email}</b> no volverá a recibir correos de esta lista. '
                          'Si fue un error, contacta al remitente.')
    except Exception as e:
        print('Error en unsubscribe: {}'.format(e))
        return _html_page('No pudimos procesar tu solicitud',
                          'Ocurrió un error al registrar la cancelación. Intenta de nuevo en unos minutos.',
                          ok=False)
