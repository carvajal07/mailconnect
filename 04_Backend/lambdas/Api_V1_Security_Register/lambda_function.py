import os
import re
import json
import uuid
import boto3
import hashlib
from datetime import datetime, timedelta

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')
table_customer = dynamodb.Table('customer')
table_activation = dynamodb.Table('userActivation')

# Cliente SES para el correo de activación
ses = boto3.client('ses')

# Configuración por variables de entorno (con valores por defecto)
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'comunicaciones@mailconnect.com.co')
# URL del endpoint de activación. Al hacer clic, el usuario llega a Acount-activation.
ACTIVATION_URL = os.environ.get(
    'ACTIVATION_URL',
    'https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api/account-activation'
)


def _get_payload(event):
    """Soporta integración directa (event = body) y Lambda-proxy (event['body'] string)."""
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def valid_email(email):
    response = table_user.scan(
        FilterExpression="email = :value",
        ExpressionAttributeValues={":value": email},
        ProjectionExpression='email'
    )
    return not response['Items']


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
    link = "{base}?qs={key}".format(base=ACTIVATION_URL, key=activation_key)
    subject = "Activa tu cuenta de MailConnect"
    html_body = """
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#16233f">
      <h2 style="color:#0075be">Bienvenido a MailConnect, {name}</h2>
      <p>Gracias por registrarte. Para activar tu cuenta haz clic en el siguiente botón:</p>
      <p style="text-align:center;margin:28px 0">
        <a href="{link}" style="background:#0075be;color:#fff;text-decoration:none;
           padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block">
           Activar mi cuenta
        </a>
      </p>
      <p>O copia y pega este enlace en tu navegador:<br>
        <a href="{link}">{link}</a>
      </p>
      <p style="color:#5b6b86;font-size:13px">El enlace expira en 24 horas.
         Si no creaste esta cuenta, ignora este mensaje.</p>
    </div>
    """.format(name=name, link=link)

    text_body = "Activa tu cuenta de MailConnect en este enlace: {link} (expira en 24 horas).".format(link=link)

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
        email = payload['email']
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

                    # Generar un salt aleatorio y hashear la contraseña
                    salt = str(uuid.uuid4())
                    saltedPassword = password + salt
                    hashed_password = hashlib.sha256(saltedPassword.encode()).hexdigest()

                    # Cliente (customer) por NIT: reutilizar o crear
                    if exist_companyTin(companyTin):
                        customerId = get_customerId(companyTin)
                    else:
                        customerId = str(uuid.uuid4())
                        table_customer.put_item(
                            Item={
                                'customerId': customerId,
                                'company': company,
                                'companyTin': companyTin,
                                # Envíos reales habilitados por defecto. El admin puede
                                # deshabilitarlos (Customer/Update) para bloquear el envío
                                # real de este cliente (Prepare-batch lo verifica).
                                'realSendEnabled': True,
                                'date': formattedDate
                            }
                        )

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
