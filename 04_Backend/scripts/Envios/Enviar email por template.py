import boto3
import json

def send_bulk_email(template_name, sender_email, recipients_data):
    # Inicializar el cliente SES
    ses_client = boto3.client('ses', region_name='tu-region')

    # Cargar la plantilla de correo electrónico
    template_data = ses_client.get_template(TemplateName=template_name)
    template_subject = template_data['Template']['SubjectPart']
    template_body = template_data['Template']['HtmlPart']

    # Iterar sobre los datos de los destinatarios y enviar correos electrónicos
    for recipient_data in recipients_data:
        # Reemplazar las variables en la plantilla con los datos específicos del destinatario
        subject = template_subject.format(**recipient_data)
        body = template_body.format(**recipient_data)

        # Enviar correo electrónico
        response = ses_client.send_email(
            Source=sender_email,
            Destination={'ToAddresses': [recipient_data['email']]},
            Message={
                'Subject': {'Data': subject},
                'Body': {'Html': {'Data': body}}
            }
        )

        print(f"Correo electrónico enviado a {recipient_data['email']}: {response['MessageId']}")


# Datos de ejemplo de los destinatarios con variables para reemplazo en la plantilla
recipients_data = [
    {'email': 'destinatario1@example.com', 'nombre': 'Juan'},
    {'email': 'destinatario2@example.com', 'nombre': 'María'},
    # Agrega más datos de destinatarios según sea necesario
]

# Nombre de la plantilla creada en AWS SES
template_name = 'nombre_de_la_plantilla'

# Dirección de correo electrónico del remitente
sender_email = 'tudireccion@example.com'

# Llamar a la función para enviar correos electrónicos masivos
send_bulk_email(template_name, sender_email, recipients_data)