import boto3
from botocore.exceptions import NoCredentialsError

def send_email(subject, body, to_address, from_address):
    # Credenciales via variables de entorno o AWS CLI (nunca hardcodear)
    aws_region = 'us-east-2'

    # Crear un cliente SES
    client = boto3.client('ses', region_name=aws_region)

    # Crear el mensaje
    message = {
        'Subject': {
            'Data': subject
        },
        'Body': {
            'Text': {
                'Data': body
            }
        }
    }

    # Enviar el correo electrónico
    try:
        response = client.send_email(
            Source=from_address,
            Destination={
                'ToAddresses': [
                    to_address,
                ],
            },
            Message=message
        )
        print("Correo electrónico enviado! Mensaje ID:", response['MessageId'])
    except NoCredentialsError:
        print('Credenciales no disponibles')

# Uso
send_email('Asunto del Correo', 'Cuerpo del Correo', 'mail.connect2000@gmail.com', 'mail.connect2000@gmail.com')
send_email('Asunto del Correo', 'Cuerpo del Correo', 'mail.connect2000@gmail.com', 'mail.connect2000@gmail.com')
send_email('Asunto del Correo', 'Cuerpo del Correo', 'mail.connect2000@gmail.com', 'mail.connect2000@gmail.com')