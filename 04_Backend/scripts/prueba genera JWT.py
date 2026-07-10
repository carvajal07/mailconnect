"""
Script de prueba: genera y verifica un JWT como lo hace la Lambda de Login.

La clave NUNCA va en el código (este repo es público). Se toma de la variable
de entorno SECRET_KEY (la misma configurada en las lambdas):

    set SECRET_KEY=...   (Windows)  |  export SECRET_KEY=...  (Linux/Mac)
    python "prueba genera JWT.py"
"""
import os
import datetime

import jwt

SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise SystemExit('Define la variable de entorno SECRET_KEY antes de ejecutar.')

user = 'Jhon.carvajal'


def generate_jwt(username):
    payload = {
        'user': username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=1)
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    return token if isinstance(token, str) else token.decode()


token = generate_jwt(user)
print(token)

# Verificar el token usando la misma clave secreta
try:
    decoded_payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
    print('Token JWT verificado:', decoded_payload)
except jwt.ExpiredSignatureError:
    print('Token JWT expirado.')
except jwt.InvalidTokenError:
    print('Token JWT no válido.')
