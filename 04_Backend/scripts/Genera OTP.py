from datetime import datetime, timedelta
import hashlib
import random
import boto3
import uuid
import re

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_otp = dynamodb.Table('otp')

def lambda_handler(event, context):
    status = True
    description = "Otp generado correctamente"
    statusCode = 200
    validData = True
    otp = 0
    
    try:
        # Obtener datos del evento
        userId = event['userId']
        ip = event['ip']
        system = event['system']
        expiration = event['expiration']
        
        print(userId)
        print(ip)
        print(system)
        print(expiration)

        # Validación del campo expiration
        if not bool(re.match('^[0-9]+$', str(expiration))):
            validData = False
            print("El campo proporcionado para expiration no es correcto, ya que este no contiene solo numeros o esta vacio")
        
    except Exception as e:
        print(e)
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        if validData:
            try:
                otp = str(random.randint(100000, 999999))
                # Obtener la fecha y hora actual
                now = datetime.utcnow()
                # Formatear la fecha y hora según un formato específico
                formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")

                expirationTime = int((now + timedelta(minutes=expiration)).timestamp())
                # Generar un salt aleatorio
                otpId = str(uuid.uuid4())
                salt = str(uuid.uuid4())
     
                # Concatenar el OTP y el salt
                saltedPassword = otp + salt
 
                # Crear un objeto hash (SHA-256 en este caso)
                hashObject = hashlib.sha256(saltedPassword.encode())
                hashedPassword = hashObject.hexdigest()
   
                # Insertar datos en la tabla de otp
                table_otp.put_item(
                    Item={
                        'otpId': otpId,
                        'active': True,
                        'userId': userId,
                        'otpHash': hashedPassword,
                        'otpSalt': salt,
                        'system': system,
                        'ip': ip,
                        'date': formattedDate,
                        'expirationTime': expirationTime
                    }
                )
            except Exception as e:
                print(e)
                status = False
                statusCode = 500
                description = "Error no controlado en el servicio"

        else:
            status = False
            statusCode = 400
            description = "Algunos capos enviados no cumplen con los requisitos del servicio"
    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description,
            'data':{
                'otp': otp
            }
        }

    return response