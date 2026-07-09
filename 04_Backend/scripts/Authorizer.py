import json
import jwt
import os

def handler(event, context):
  secretKey = os.environ['secretKey']
  token = get_bearer_token(event['headers'])

  if not token:
    return generate_error_response('Token no encontrado')

  try:
    decoded = jwt.decode(token, secretKey, algorithms=['HS256'])
    print("Autorizado: Token correcto")
  except jwt.ExpiredSignatureError:
    return generate_error_response('Token expirado')
  except jwt.InvalidTokenError:
    return generate_error_response('Token inválido')

def get_bearer_token(headers):
  authorization_header = headers.get('Authorization')

  if not authorization_header:
    return None

  parts = authorization_header.split(' ')

  if len(parts) != 2 or parts[0].lower() != 'bearer':
    return None

  return parts[1]

def generate_error_response(message):
  return json.dumps({
    'errorMessage': message,
    'errorType': 'Unauthorized',
  })