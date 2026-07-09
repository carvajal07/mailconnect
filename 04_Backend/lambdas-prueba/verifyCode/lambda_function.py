from OneTimePassword import validateOTP
import OneTimePassword as otp

def lambda_handler(event, context):
    status = True
    description = "Codigo validado correctamente"
    statusCode = 200
    print(event)
    print(context)
    ip = "1.10.10.1"

    try:
        # Obtener datos del evento
        code = event['code']
        user = event['user']
        
        
        response = otp.validateOTP(code,user,ip)
        
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