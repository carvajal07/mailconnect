from datetime import datetime, timedelta
import hashlib
import random
import boto3
import uuid

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_otpAudit = dynamodb.Table('otpAudit')
table_otp = dynamodb.Table('oneTimePassword')

def update_otp(otpId):
    # Actualizar estado del OTP a false
    response = table_otp.update_item(
        Key={'oneTimePasswordId':otpId},
        UpdateExpression='SET #estado = :nuevo_estado',
        ExpressionAttributeNames={'#estado': 'active'},
        ExpressionAttributeValues={':nuevo_estado': False}
    )

def validateOTP(otp: int,user: str,ip: str) -> dict:
    """
    This function return a dictionary with status from Otp validation
    It also inserts into the otpAudit table for traceability

    Parameters:
        otp: Otp to validate
        user: user who makes the request (email)
        ip: user ip

    Return:
        Dictionary with status and description
    """
    print(f"otp: {otp}")
    print(f"usuario: {user}")
    print(f"ip: {ip}")        
    status = True
    statusCode = 200
    description = ""
    try:
        stringOtp = str(otp)
        # Obtener la fecha y hora actual
        now = datetime.utcnow()
        # Formatear la fecha y hora según un formato específico
        formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
        otpAuditId = str(uuid.uuid4())
        projectionOtp_expression = 'oneTimePasswordId, otpHash, otpSalt, expirationTime'  # Lista de campos a consultar
    
        response = table_otp.scan(
            FilterExpression="userId = :userToValidate AND active = :activeToValidate",
            ExpressionAttributeValues={
                ":userToValidate": user,
                ":activeToValidate": True
            },
            ProjectionExpression=projectionOtp_expression
        )
        
        if response['Items']:
            items = response['Items']
            # Ordena los resultados por el campo "expiration"
            campoOrdenamiento = "expirationTime"
            itemsOrdenados = sorted(items, key=lambda x: x[campoOrdenamiento], reverse=True)
            otpId = itemsOrdenados[0]['oneTimePasswordId']
            otpHash = itemsOrdenados[0]['otpHash']
            otpSalt = itemsOrdenados[0]['otpSalt']
            expirationTime = itemsOrdenados[0]['expirationTime']
            print("Id otp: " + otpId)
            if expirationTime > int(now.timestamp()):
                # Concatenar el OTP y el salt
                saltedPassword = stringOtp + otpSalt
                hashObject = hashlib.sha256(saltedPassword.encode())
                hashInput = hashObject.hexdigest()
                if (hashInput == otpHash):
                    print("Código OTP válido")
                    description = "Código OTP válido"
                    update_otp(otpId)
                else:
                    print("Código incorrecto")
                    statusCode = 400
                    status = False
                    description = "Código incorrecto"
            else:
                print("Código OTP expirado")
                update_otp(otpId)
                statusCode = 400
                status = False
                description = "Código OTP expirado"
        else:
            print("Código OTP no encontrado")
            statusCode = 400
            status = False
            description = "Código OTP no encontrado"
        
        # Insertar datos en la tabla de auditorias de OTP
        table_otpAudit.put_item(
            Item={
                'otpAuditId': otpAuditId,
                'userId': user,
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
    return {
            'status':status,
            'description':description
        }

def createOTP(system: str,user: str,ip: str,expiration: int) -> str:
    """
    This function return a one time password with 6 digits and a expiration time indicate on input
    It also inserts into the OTP table for traceability

    Parameters:
        system: system from where the OTP is being generated
            Examples: 
            ->Authentication
            ->Login
            ->SendCampaing
            ->Varification
        user: user who makes the request (email)
        ip: user ip
        expiration: time on minutes for OTP expiration

    Return:
        One time password with 6 digits
    """
    otp = 0
    print(f"system: {system}")
    print(f"usuario: {user}")
    print(f"ip: {ip}")        
    print(f"expiration: {expiration}")
        
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

        # Insertar datos en la tabla de activaciones
        table_otp.put_item(
            Item={
                'oneTimePasswordId': otpId,
                'active': True,
                'userId': user,
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

    return otp