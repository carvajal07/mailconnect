from datetime import datetime, timedelta
import hashlib
import boto3
import uuid
import re

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_otp = dynamodb.Table('otp')
table_otpAudit = dynamodb.Table('otpAudit')

def update_otp(otpId):
    # Actualizar estado del OTP a false
    response = table_otp.update_item(
        Key={'otpId':otpId},
        UpdateExpression='SET #estado = :nuevo_estado',
        ExpressionAttributeNames={'#estado': 'active'},
        ExpressionAttributeValues={':nuevo_estado': False}
    )

def lambda_handler(event, context):
    status = True
    description = "Otp validado correctamente"
    statusCode = 200
    validData = True

    try:
        # Obtener datos del evento
        otp = event['otp']
        userId = event['userId']
        ip = event['ip']
        stringOtp = str(otp)

        # Validación del campo otp
        if not bool(re.match('^\d{6}$', stringOtp)):
            validData = False
            print("El campo proporcionado OTP no es correcto, ya que este no contiene solo numeros, esta vacio o no tiene 6 digitos")

        # Validacion del campo ip
        if not bool(re.match('^(\d{1,3}\.){3}\d{1,3}$', ip)):
            validData = False
            print("El campo proporcionado para la ip no es correcto, ya que este no contiene una estructura de una IP valida")

    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio1"
    else:
        if validData:
            try:
                # Obtener la fecha y hora actual
                now = datetime.utcnow()
                # Formatear la fecha y hora según un formato específico
                formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
                otpAuditId = str(uuid.uuid4())
                projectionOtp_expression = 'otpId, otpHash, otpSalt, expirationTime'  # Lista de campos a consultar
          
                response = table_otp.scan(
                    FilterExpression="userId = :userToValidate AND active = :activeToValidate",
                    ExpressionAttributeValues={
                        ":userToValidate": userId,
                        ":activeToValidate": True
                    },
                    ProjectionExpression=projectionOtp_expression
                )
                
                if response['Items']:
                    items = response['Items']
                    # Ordena los resultados por el campo "expiration"
                    campoOrdenamiento = "expirationTime"
                    itemsOrdenados = sorted(items, key=lambda x: x[campoOrdenamiento], reverse=True)
                    otpId = itemsOrdenados[0]['otpId']
                    otpHash = itemsOrdenados[0]['otpHash']
                    otpSalt = itemsOrdenados[0]['otpSalt']
                    expirationTime = itemsOrdenados[0]['expirationTime']

                    if expirationTime > int(now.timestamp()):
                        # Concatenar el OTP y el salt
                        saltedPassword = stringOtp + otpSalt
                        hashObject = hashlib.sha256(saltedPassword.encode())
                        hashInput = hashObject.hexdigest()
                        if (hashInput == otpHash):
                            description = "Código OTP válido"
                            update_otp(otpId)
                        else:
                            #si el usuario pide varios OTP solo se tiene el cuenta es mas reciente
                            status = False
                            statusCode = 404
                            description = "Código incorrecto"
                    else:
                        update_otp(otpId)
                        status = False
                        statusCode = 404
                        description = "Código OTP expirado"
                else:
                    status = False
                    statusCode = 404
                    description = "Código OTP no encontrado"
                
                # Insertar datos en la tabla de auditorias de OTP
                table_otpAudit.put_item(
                    Item={
                        'otpAuditId': otpAuditId,
                        'userId': userId,
                        'ip': ip,
                        'date': formattedDate,
                        'otp': otp,
                        'message': description
                    }
                )
         
            except Exception as e:
                print(e)
                status = False
                statusCode = 500
                description = "Error no controlado en el servicio2"

        else:
            status = False
            statusCode = 400
            description = "Algunos capos enviados no cumplen con los requisitos del servicio"
    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description
        }

    return response