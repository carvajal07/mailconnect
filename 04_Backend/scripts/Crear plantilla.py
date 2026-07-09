import boto3

# Inicializar el cliente SES
ses_client = boto3.client('ses', region_name='us-east-2')

def lambda_handler(event, context):
    status = True
    description = "Plantilla creada correctamente"
    statusCode = 201

    try:
        # Obtener datos del evento
        templateName = event['templateName']
        subject = event['subject']
        htmlBody = event['htmlBody']
        textBody = event['textBody']
    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        # Crear la plantilla de correo electrónico
        try:
            response = ses_client.create_template(
                Template={
                    'TemplateName': templateName,
                    'SubjectPart': subject,
                    'HtmlPart': htmlBody,
                    "TextPart": textBody
                }
            )
            print("plantilla creada correctamente")
        except:
            status = False
            statusCode = 500
            description = "Error no controlado en el servicio"
    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description
        }

    return response