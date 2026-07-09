import os
import json
import boto3
import base64

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

def lambda_handler(event, context):

    # Reemplazar con tus credenciales de SES
    ses_client = boto3.client('ses', region_name='us-east-1')
    
    # Datos personalizados
    nombre1 = 'Jhon'
    
    
    # Plantilla de correo electrónico
    template_name = 'MailConnect_0005_EM_PruebasEMAIL04'
    response_template = ses_client.get_template(TemplateName=template_name)
    html = response_template['Template']["HtmlPart"]
    
    body_text = "Content of your email."
    body_html = """<html>
    <head></head>
    <body>
    Hola {{nombre}},
    
    Adjunto encontrarás un archivo importante.
    {{nombre}}
    
    Atentamente,
    </body>
    </html>"""
    
    # Descargar el objeto S3 en un objeto BytesIO
    # Reemplazar con tus credenciales de S3 y nombre del bucket y archivo
    s3_client = boto3.client('s3', region_name='us-east-1')
    bucket_name = 'mailconnect.document'
    file_name = '2024-06-29/recibo.pdf'
    
    # Descargar el objeto
    objeto = s3_client.get_object(Bucket=bucket_name, Key=file_name)
    archivo_bytes = objeto['Body'].read()
    # Leer el contenido del archivo como string (asumiendo codificación UTF-8)
    contenido_archivo = archivo_bytes.decode('ISO-8859-1')

    #Descargar otro archivo
    objeto2 = s3_client.get_object(Bucket="milenaconnect.document", Key="f5811aa0-cbab-4fc2-a402-adadc9172e72/5250467297.docx")
    archivo_bytes2 = objeto2['Body'].read()
    # Leer el contenido del archivo como string (asumiendo codificación UTF-8)
    contenido_archivo2 = archivo_bytes2.decode('ISO-8859-1')
    
    
    body_html = body_html.replace('{{Nombre}}',nombre1)
    print(html)
 
    subject = "Asunto de prueba"
    source = "info@mailconnect.com.co"
    recipient_emails = ["jhoncarvajal88@gmail.com"]
    
    
    '''
    raw_message = {
        'Data': b''.join([
            b'Subject: ' + subject.encode('utf-8') + b'\n',
            b'\n',
            body_html.encode('utf-8'),
            b'Filename: "factura.pdf"',
            b'Content': file_object.getvalue(),
            b'ContentType': "application/pdf"
        ])
    }
    
    
    # Destinatario
    destinatario = 'jhoncarvajal88@gmail.com'
    
    # Envío del correo electrónico

    response = ses_client.send_raw_email(
        Source=source,
        Destinations=[destinatario],
        RawMessage=raw_message,
        ConfigurationSetName="my-first-configuration-set"

    )
    
    '''
    
    
    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = source
    msg['To'] = ', '.join(recipient_emails)
    
    # Add body to email
    msg_body = MIMEMultipart('alternative')
    textpart = MIMEText(body_text.encode('utf-8'), 'plain', 'utf-8')
    htmlpart = MIMEText(html.encode('utf-8'), 'html', 'utf-8')
    
    msg_body.attach(textpart)
    msg_body.attach(htmlpart)
    msg.attach(msg_body)
    

    #Poner est codigo dentro del for para agregar varios adjuntos
    part = MIMEApplication(contenido_archivo)
    part.add_header('Content-Disposition', 'attachment', filename=os.path.basename(file_name))
    msg.attach(part)
    
    part = MIMEApplication(contenido_archivo2)
    part.add_header('Content-Disposition', 'attachment', filename="prueba.docx")
    msg.attach(part)
    

    
    # Try to send the email.
    try:
        response = ses_client.send_raw_email(
            Destinations=recipient_emails,
            ConfigurationSetName="default",
            RawMessage={'Data': msg.as_string()}
        )
    except Exception as e:
        print(e)
    