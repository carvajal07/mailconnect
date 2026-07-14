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

    if user_id and email:
        return user_id, email

    if user_id:
        resp = table_user.scan(
            FilterExpression="userId = :v",
            ExpressionAttributeValues={":v": user_id},
            ProjectionExpression='userId, email'
        )
        if resp['Items']:
            return user_id, resp['Items'][0].get('email')
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
    html_body = """
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#16233f">
      <h2 style="color:#0075be">Tu código de verificación</h2>
      <p>Usa este código para continuar ({system}):</p>
      <p style="text-align:center;font-size:34px;font-weight:bold;letter-spacing:8px;color:#0075be;margin:24px 0">
        {code}
      </p>
      <p style="color:#5b6b86;font-size:13px">El código es de un solo uso.
         Si no lo solicitaste, ignora este mensaje.</p>
    </div>
    """.format(code=code, system=system)
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

    try:
        user_id, email = _resolve_user(payload)
        if not user_id:
            return {'status': False, 'statusCode': 404, 'description': "Usuario no encontrado"}

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
