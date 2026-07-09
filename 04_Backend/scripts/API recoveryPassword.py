import uuid
import boto3
import json
import OneTimePassword as otp
from datetime import datetime, timedelta


# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_user_data = dynamodb.Table("userData")
table_session = dynamodb.Table('session')
template = "VerificacionEmailV2"
templateVersion = 1
system = "Recovery Password"

def create_Session(userId,ipAddress,device,numberAttemps):
    sessionId = str(uuid.uuid4())
    # Obtener la fecha y hora actual
    now = datetime.now()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
    # Insertar datos en la tabla de sesiones
    table_session.put_item(
        Item={
            'sessionId': sessionId,
            'userId': userId,
            'ipAddress': ipAddress,
            'device': device,
            'numberAttemps': numberAttemps,
            'active': True,
            'date': formattedDate
        }
    )
    
def select_name(userDataId):
    projectionName_expression = 'userName'  # Lista de campos a consultar

    response = table_user_data.scan(
        FilterExpression="userDataId = :value",
        ExpressionAttributeValues={":value": userDataId},
        ProjectionExpression=projectionName_expression
    )
    return response['Items'][0]['userName']

def lambda_handler(event, context):
    status = True
    description = "Email de recuperación enviado correctamente"
    statusCode = 200
    name = ""
    code = ""
    # Obtener datos del evento
    user = event['user']

    #consulta por scan
    projectionUser_expression = 'userId, active, userDataId'  # Lista de campos a consultar

    responseUser = table_user.scan(
        FilterExpression="email = :value",
        ExpressionAttributeValues={":value": user},
        ProjectionExpression=projectionUser_expression
    )
    try:
        # Obtener datos del evento
        user = event['user']

        #consulta por scan
        projectionUser_expression = 'userId, active, userDataId'  # Lista de campos a consultar

        responseUser = table_user.scan(
            FilterExpression="email = :value",
            ExpressionAttributeValues={":value": user},
            ProjectionExpression=projectionUser_expression
        )
    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        # Verificar si se encontró el elemento
        if responseUser['Items']:
            
            isActive = responseUser['Items'][0]['active']

            if (isActive):
                code = otp.createOTP(system,user,"10.1.0.1",1)
                message = {
                    'sender':"comunicaciones@mailconnect.com.co",
                    'recipient':user,
                    'template':template,
                    'templateVersion':templateVersion,
                    'data':'{"code":"{code}"}'
                }
                print(json.dumps(message))
                #realizar envio del email
                #realizar la solicitud del token
                #loguear en alguna tabla el envio para cambio de contraseña
                print("Envio de email para recuperacion exitoso")
            else:
                print('Usuario o cuenta inactiva, cuenta sin verificar')

        else:
            print(f"No se encontró el usuario {user}")

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description
        }

    return response