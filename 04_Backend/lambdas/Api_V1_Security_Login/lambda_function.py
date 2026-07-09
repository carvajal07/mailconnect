import os
import jwt
import uuid
import boto3
import hashlib
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
# Crear un cliente de DynamoDB
dynamodb2 = boto3.client('dynamodb')
table_user = dynamodb.Table('user')
table_customer = dynamodb.Table("customer")
table_user_data = dynamodb.Table("userData")
table_session = dynamodb.Table('session')
SECRET_KEY = os.environ['SECRET_KEY']  # Variable de entorno en la consola Lambda

def generate_jwt(username):
    # Información de la carga util
    payload = {
        'user': username,
        'exp': datetime.utcnow() + timedelta(days=1)  # Expira en 1 día
    }

    # Generar el token JWT
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    return token

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
    
def select_client(customerId):
    projectionCustomer_expression = 'company'  # Lista de campos a consultar

    response = table_customer.scan(
        FilterExpression="customerId = :value",
        ExpressionAttributeValues={":value": customerId},
        ProjectionExpression=projectionCustomer_expression
    )
    return response['Items'][0]['company']
    
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
    description = "Usuario logueado correctamente"
    statusCode = 201
    customer = ""
    name = ""
    token = ""
    userId = ""
    try:
        # Obtener datos del evento
        user = event['user']

        '''
        #consulta por query
        # Parámetros de la consulta
        key_condition_expression = Key('username').eq(user)
        projection_expression = 'userName, hash, salt, isActive'  # Lista de campos a consultar

        response = dynamodb2.query(
            TableName=table_user,
            KeyConditionExpression=key_condition_expression,
            ProjectionExpression=projection_expression
        )
        
        # Imprimir los resultados
        items = response.get('Items', [])
        for item in items:
            print(item)
        '''
        #consulta por scan
        #projectionUser_expression = 'userHash, userSalt, isActive, isBlocked, timeBlocked'  # Lista de campos a consultar
        projectionUser_expression = 'userId, userHash, userSalt, active, customerId, userDataId'  # Lista de campos a consultar

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
            #isBlocked = response['Items'][0]['isBlocked']
            isBlocked = False

            if (isActive):
                if (isBlocked):
                    status = False
                    statusCode = 400
                    description = "Usuario bloqueado"
                else:
                    #validar la contraseña enviada
                    password = event['password']
                    userHash = responseUser['Items'][0]['userHash']
                    
                    # Concatenar la contraseña y el salt
                    salt = responseUser['Items'][0]['userSalt']
                    saltedPassword = password + salt
                    hashObject = hashlib.sha256(saltedPassword.encode())
                    inputHashed = hashObject.hexdigest()
                    if (inputHashed == userHash):
                        token = generate_jwt(user)
                        customerId = responseUser['Items'][0]['customerId']
                        userId = responseUser['Items'][0]['userId']
                        customer = select_client(customerId)
                        userDataId = responseUser['Items'][0]['userDataId']
                        name = select_name(userDataId)
                        print(name)
                        #create_Session();
                        status = True
                        statusCode = 200
                        description = "Usuario correcto"
                    else:
                        print("Contraseña incorrecta")
                        status = False
                        statusCode = 404
                        description = 'Usuario o contraseña incorrectos' 
            else:
                status = False
                statusCode = 423
                description = 'Usuario o cuenta inactiva, cuenta sin verificar'

        else:
            print(f"No se encontró el usuario {user}")
            status = False
            statusCode = 404
            description = 'Usuario o contraseña incorrectos'

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description,
            'data':{
                'token': token,
                'customer': customer,
                'userId': userId,
                'name': name
            }
        }

    return response