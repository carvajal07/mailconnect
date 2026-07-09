import boto3

# Inicializar el cliente SES
ses_client = boto3.client('ses', region_name='us-east-2')

def lambda_handler(event, context):
    status = True
    description = "Plantilla recuperada correctamente"
    statusCode = 200

    try:
        # Obtener datos del evento
        templateName = event['templateName']
    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        # Crear la plantilla de correo electrónico
        try:
            responseTemplate = ses_client.get_template(TemplateName=templateName)
            print("plantilla recuperada correctamente")
        except:
            status = False
            statusCode = 500
            description = "Error no controlado en el servicio"
    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description,
            'template':responseTemplate['Template']
        }

    return response