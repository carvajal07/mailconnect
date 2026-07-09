import urllib.parse
import boto3
from datetime import datetime

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
table_otp = dynamodb.Table('otp')

def update_otp(otpId):
    # Actualizar estado del OTP a false
    table_otp.update_item(
        Key={'otpId':otpId},
        UpdateExpression='SET #estado = :nuevo_estado',
        ExpressionAttributeNames={'#estado': 'active'},
        ExpressionAttributeValues={':nuevo_estado': False}
    )

def lambda_handler(event, context):
  # Obtener el parámetro del otp
  #url = evento["rawQueryString"]
  #parametros = parse_qs(urlparse(url).query)
  print(event)


  otpHash = event['queryStringParameters']["qs"]
  print(otpHash)

  '''
  #Consultar la informacion en la BD
  projectionOtp_expression = 'otpId, expirationTime'  # Lista de campos a consultar
    
  response = table_otp.scan(
      FilterExpression="otpHash = :otpHashToValidate AND active = :activeToValidate",
      ExpressionAttributeValues={
          ":otpHashToValidate": otpHash,
          ":activeToValidate": True
      },
      ProjectionExpression=projectionOtp_expression
  )

  if response['Items']:
    items = response['Items']
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Ordena los resultados por el campo "expiration"
    campoOrdenamiento = "expirationTime"
    itemsOrdenados = sorted(items, key=lambda x: x[campoOrdenamiento], reverse=True)
    otpId = itemsOrdenados[0]['otpId']
    expirationTime = itemsOrdenados[0]['expirationTime']

    if expirationTime > int(now.timestamp()):
      update_otp(otpId)
  '''
  # Redirigir a la URL predeterminada
  return {
    "statusCode": 302,
    "headers": {
      "Location": "https://www.mailconnect.com.co/"
    }
  }
