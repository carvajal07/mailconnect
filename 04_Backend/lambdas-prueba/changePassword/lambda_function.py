import uuid
import boto3
import hashlib
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_user_data = dynamodb.Table("userData")
table_session = dynamodb.Table('session')
table_userChangePassword = dynamodb.Table('userChangePassword')

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

def insert_audit(userId):
    id = str(uuid.uuid4())
    # Obtener la fecha y hora actual
    now = datetime.now()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
    # Insertar datos en la tabla de sesiones
    table_userChangePassword.put_item(
        Item={
            'userChangePasswordId': id,
            'userId': userId,
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

def update_password(userId,userhash):
    # Obtener la fecha y hora actual
    now = datetime.now()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")

    # Actualizar estado del OTP a false
    response = table_user.update_item(
        Key={'userId':userId},
        UpdateExpression='SET userHash = :nuevo_hash, dateUpdate = :nueva_fecha',
        ExpressionAttributeValues={':nuevo_hash': userhash,':nueva_fecha': formattedDate}
    )


def lambda_handler(event, context):
    status = True
    description = "Contraseña cambiada correctamente"
    statusCode = 200

    try:
        # Obtener datos del evento
        user = event['user']
        password = event['password']         

        #consulta por scan
        projectionUser_expression = 'userId, active, userDataId, userHash, userSalt'  # Lista de campos a consultar

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
                #validar la contraseña enviada
                userHash = responseUser['Items'][0]['userHash']
                
                # Concatenar la contraseña y el salt
                salt = responseUser['Items'][0]['userSalt']
                saltedPassword = password + salt
                hashObject = hashlib.sha256(saltedPassword.encode())
                inputHashed = hashObject.hexdigest()
                if (inputHashed == userHash):
                    #La contraseña ingresada es igual a la anterior
                    status = False
                    statusCode = 409
                    description = "La contraseña ingresada no puede ser igual a la anterior"
                else:
                    #realizar actualizacion de la contraseña
                    userId = responseUser['Items'][0]['userId']
                    update_password(userId,inputHashed)
                    print("Contraseña actualizada correctamente")
                    insert_audit(userId)
                    print("Insert de trazabilidad realizado correctamente")
            else:
                print('Usuario o cuenta inactiva, cuenta sin verificar')
                status = False
                statusCode = 403
                description = "Se esta intentando cambiar una contraseña para un usuario inactivo"
        else:
            print(f"No se encontró el usuario {user}")
            status = False
            statusCode = 404
            description = "El usuario no existe"

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description
        }

    return response