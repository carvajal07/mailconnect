import jwt
import hashlib
import datetime

user = 'Jhon.carvajal'
SECRET_KEY = '$&ULCq$=M1;{{#":&S/kj&0!W|ROoQMC'


def generate_jwt(username):
    # Configurar la información del token (puedes incluir más información según tus necesidades)

    payload = {
        'userId': 123,
        'username':username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=1)
    }

    payload = {
        'userId': 123,
        'username':username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(minutes=1)
    }

    # Generar el token JWT
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    return token

token = generate_jwt(user)
print(token)
##No valido
##token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMywidXNlcm5hbWUiOiJKaG9uLmNhcnZhamFsMiIsImV4cCI6MTcwMjE0MjcyMX0=.jcbgDcxAzfJNYudWsVvoPcs8YHCSYsTBkXhPn7dlMDM'

##Expirado
token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMywidXNlcm5hbWUiOiJKaG9uLmNhcnZhamFsIiwiZXhwIjoxNzA4Mzc4Mjc3fQ.xJ0uqQ1ApHa8NSf840039jzeTIcB_qKV5rfC0m2ZWcQ'

# Verificar el token usando la misma clave secreta
try:
    decoded_payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
    print('Token JWT verificado:', decoded_payload)
except jwt.ExpiredSignatureError:
    print('Token JWT expirado.')
except jwt.InvalidTokenError:
    print('Token JWT no válido.')