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

# Mensaje genérico: no revela si el correo existe o no (evita enumeración de usuarios).
GENERIC_DESCRIPTION = ("Si el correo está registrado, enviaremos un código para "
                       "restablecer la contraseña.")


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _resolve_user(payload):
    """Devuelve (userId, email, active) a partir del email (o userId)."""
    user_id = payload.get('userId')
    email = payload.get('user') or payload.get('email')

    if email:
        resp = table_user.scan(
            FilterExpression="email = :v",
            ExpressionAttributeValues={":v": email},
            ProjectionExpression='userId, email, active'
        )
        if resp['Items']:
            item = resp['Items'][0]
            return item['userId'], item.get('email'), item.get('active')
        return None, email, None

    if user_id:
        resp = table_user.scan(
            FilterExpression="userId = :v",
            ExpressionAttributeValues={":v": user_id},
            ProjectionExpression='userId, email, active'
        )
        if resp['Items']:
            item = resp['Items'][0]
            return user_id, item.get('email'), item.get('active')
        return user_id, None, None

    return None, None, None


def send_recovery_email(email, code):
    subject = "Restablece tu contraseña de MailConnect"
    html_body = """
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#16233f">
      <h2 style="color:#0075be">Restablece tu contraseña</h2>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.
         Usa este código para continuar:</p>
      <p style="text-align:center;font-size:34px;font-weight:bold;letter-spacing:8px;color:#0075be;margin:24px 0">
        {code}
      </p>
      <p style="color:#5b6b86;font-size:13px">El código es de un solo uso.
         Si no solicitaste este cambio, ignora este mensaje y tu contraseña seguirá igual.</p>
    </div>
    """.format(code=code)
    text_body = "Tu código para restablecer la contraseña de MailConnect es: {code}".format(code=code)

    ses.send_email(
        Source=SENDER_EMAIL,
        Destination={'ToAddresses': [email]},
        Message={
            'Subject': {'Data': subject, 'Charset': 'UTF-8'},
            'Body': {
                'Html': {'Data': html_body, 'Charset': 'UTF-8'},
                'Text': {'Data': text_body, 'Charset': 'UTF-8'},
            }
        }
    )


def _create_and_send_otp(user_id, email, ip, expiration_min):
    """Genera un OTP (hasheado), lo guarda y lo envía por correo. Devuelve el otpId."""
    code = secrets.randbelow(1000000)
    code_str = "{:06d}".format(code)
    otp_id = str(uuid.uuid4())
    otp_hash = hashlib.sha256(code_str.encode()).hexdigest()
    expiration_time = int(time.time()) + expiration_min * 60

    _ensure_otp_table()
    table_otp.put_item(
        Item={
            'oneTimePasswordId': otp_id,
            'userId': user_id,
            'otpHash': otp_hash,
            'expirationTime': expiration_time,
            'active': True,
            'system': 'RecuperacionPassword',
            'ip': ip,
            'createdAt': int(time.time())
        }
    )

    if email:
        send_recovery_email(email, code_str)
    return otp_id


def lambda_handler(event, context):
    """Recuperación de contraseña: crea un OTP y lo envía al correo del usuario.

    Por seguridad responde SIEMPRE 200 con un mensaje genérico (no revela si el
    correo existe). El frontend continúa a la pantalla de reseteo, donde el
    usuario ingresa el código y su nueva contraseña (change-password con OTP).
    """
    payload = _get_payload(event)
    ip = payload.get('ip', '')
    try:
        expiration_min = int(payload.get('expiration', DEFAULT_EXPIRATION_MIN))
    except Exception:
        expiration_min = DEFAULT_EXPIRATION_MIN

    generic_ok = {'status': True, 'statusCode': 200, 'description': GENERIC_DESCRIPTION}

    if not (payload.get('user') or payload.get('email') or payload.get('userId')):
        return {'status': False, 'statusCode': 400,
                'description': "Falta el correo (user) para la recuperación."}

    try:
        user_id, email, active = _resolve_user(payload)

        # Usuario inexistente o cuenta sin activar: respondemos genérico igual,
        # sin generar OTP (no tiene sentido y evita enumeración).
        if not user_id or active is False:
            return generic_ok

        try:
            otp_id = _create_and_send_otp(user_id, email, ip, expiration_min)
            print("OTP de recuperación generado: {}".format(otp_id))
        except Exception as mail_error:
            # No filtramos el fallo de correo al cliente; queda en logs.
            print("No se pudo enviar el OTP de recuperación: {}".format(mail_error))

        return generic_ok
    except Exception as e:
        print("Error en recovery-password: {}".format(e))
        return {'status': False, 'statusCode': 500, 'description': "Error no controlado en el servicio"}
