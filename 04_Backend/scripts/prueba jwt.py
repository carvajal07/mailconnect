import jwt
import json
import hashlib

def generateJwt(username):
    # Configurar la información del token (puedes incluir más información según tus necesidades)
    payload = {"sub": username, "iss": "your_issuer"}

    # Generar el token JWT
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    print(token)

SECRET_KEY = '1sfdgtewrgedfv'
username = 'pruebas'
token = generateJwt(username)
  

  