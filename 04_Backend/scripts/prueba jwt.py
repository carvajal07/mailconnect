"""
Script de prueba: genera un JWT simple. La clave se toma de la variable de
entorno SECRET_KEY (nunca en el código; este repo es público).
"""
import os

import jwt

SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise SystemExit('Define la variable de entorno SECRET_KEY antes de ejecutar.')


def generate_jwt(username):
    payload = {"sub": username, "iss": "mailconnect"}
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    print(token)
    return token


generate_jwt('pruebas')
