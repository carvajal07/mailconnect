import os
import re
import json
import uuid
import boto3
import hashlib
from datetime import datetime, timedelta

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')
table_customer = dynamodb.Table('customer')
table_activation = dynamodb.Table('userActivation')

dias
7
15
30
60
90
120
150
180
210
240
270
300
330
360


											
Campo	customerId	registerDate	tableName	lifecycleStatus	expirationTimeDynamo	sendToS3	sendToS3On	expirationDaysS3	sendToGlacierOn	expirationDaysGlacier	definitiveDeletionOn
Typo	String	String	String		epoch	bool		Int		Int	
Ejemplo1	8008954521		8008954521_sendStatus_{idCampaña}		1742000000	1		30		60	
Ejemplo2	8008954521		8008954522_sendStatus_{idCampaña}		1742000000	0		0		0	
	PK		SK	GSI-PK	GSI-SK						
											
				TABLE-ACTIVE							
				TABLE-DELETE							


def valid_email(email):
    projectionEmail_expression = 'email'  # Lista de campos a consultar

    response = table_user.scan(
        FilterExpression="email = :value",
        ExpressionAttributeValues={":value": email},
        ProjectionExpression=projectionEmail_expression
    )

    if response['Items']:
        return False
    else:
        return True
    
def exist_companyTin(companyTin):
    projectionCompanyTin_expression = 'companyTin'  # Lista de campos a consultar

    response = table_customer.scan(
        FilterExpression="companyTin = :value",
        ExpressionAttributeValues={":value": companyTin},
        ProjectionExpression=projectionCompanyTin_expression
    )

    if response['Items']:
        return True
    else:
        return False
    
def get_customerId(companyTin):
    projectionCustomerId_expression = 'customerId'  # Lista de campos a consultar

    response = table_customer.scan(
        FilterExpression="companyTin = :value",
        ExpressionAttributeValues={":value": companyTin},
        ProjectionExpression=projectionCustomerId_expression
    )

    if response['Items']:
        return response['Items'][0]['customerId']

def lambda_handler(event, context):
    nombre_funcion = context.function_name
    environment = context.invoked_function_arn.split(":")[-1]
    environment = "Dev" if environment == nombre_funcion else environment
    
    status = True
    description = "Usuario registrado exitosamente"
    statusCode = 201
    validData = True
    try:
        # Obtener datos del evento    
        password = event['password']
        name = event['name']
        email = event['email']
        phone = event['phone']
        company = event['company']
        companyTin = event['companyTin']

        print("Inicio validación de los datos del payload")
        # Validación del campo telefono
        if not bool(re.match('^[0-9]+$', phone)):
            validData = False
            print("El campo proporcionado para el telefono no es correcto, ya que este no contiene solo numeros o esta vacio")
    
        # Validación del campo nit
        if not bool(re.match('^[0-9]+$', str(companyTin))):
            validData = False
            print("El campo proporcionado para el nit no es correcto, ya que este no contiene solo numeros o esta vacio")
    
        # Validación del campo email
        # Expresión regular para validar un correo electrónico simple
        patron_email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
        if not bool(re.match(patron_email, email)):
            validData = False
            print("El campo proporcionado para el email no es correcto, ya que este no esta conformado por una estructura valida")
    
    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        if validData:
            try:
                if (valid_email(email)):                    
                    # Obtener la fecha y hora actual
                    now = datetime.utcnow()
                    # Formatear la fecha y hora según un formato específico
                    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
                    # Agrega 24 horas a la fecha y hora actual
                    expiracionDate = now + timedelta(hours=24)
    
                    # Convierte la fecha de expiración a un formato que DynamoDB pueda entender
                    expirationTime = expiracionDate.strftime('%Y-%m-%dT%H:%M:%SZ')
                        
                    userDataId = str(uuid.uuid4())
                    userId = str(uuid.uuid4())
                    activationId = str(uuid.uuid4())
                    activationKey = str(uuid.uuid4())
    
                    # Generar un salt aleatorio
                    salt = str(uuid.uuid4())
                    
                    # Concatenar la contraseña y el salt
                    saltedPassword = password + salt
    
                    # Crear un objeto hash (SHA-256 en este caso)
                    hash_object = hashlib.sha256(saltedPassword.encode())
                    hashed_password = hash_object.hexdigest()
                    if (exist_companyTin(companyTin)):
                        # Obtener el customer id
                        customerId = get_customerId(companyTin)
                    else:
                        customerId = str(uuid.uuid4())
                        # Insertar datos en la tabla de clientes
                        table_customer.put_item(
                            Item={
                                'customerId': customerId,
                                'company': company,
                                'companyTin': companyTin,
                                'date': formattedDate
                            }
                        )
    
                    # Insertar datos en la tabla de datos de usuarios
                    table_userData.put_item(
                        Item={
                            'userDataId': userDataId,
                            'customerId': customerId,
                            'userName': name,
                            'phone': phone,
                            'date': formattedDate
                        }
                    )
    
                    # Insertar datos en la tabla de usuarios
                    table_user.put_item(
                        Item={
                            'userId': userId,
                            'userDataId': userDataId,
                            'customerId': customerId,
                            'email': email,
                            'userHash': hashed_password,
                            'userSalt': salt,
                            'date': formattedDate,
                            'active': False
                        }
                    )
    
                    # Insertar datos en la tabla de clientes
                    table_activation.put_item(
                        Item={
                            'userActivationId': activationId,
                            'userId': userId,
                            'activationKey': activationKey,
                            'expirationTime': expirationTime
                        }
                    )
                else:
                    status = False
                    statusCode = 409
                    description = "Email ya se encuentra registrado"
            except:
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
            'description':description
        }

    return response