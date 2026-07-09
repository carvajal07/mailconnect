import OneTimePassword as otp

def lambda_handler(event, context):
    status = True
    description = "Codigo validado correctamente"
    statusCode = 200

    try:
        # Obtener datos del evento
        code = event['code']
        response = otp.validateOTP(code,"Usuario","10.1.3.4")
        
    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        status = response['status']
        description = response['description']

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description
        }

    return response