"""Helpers compartidos de autenticación para las pruebas.

Genera JWT HS256 firmados con la SECRET_KEY del entorno de pruebas SIN depender de
PyJWT (mismo esquema de verificación manual que usan las lambdas admin para la
SEGUNDA BARRERA del gate admin). Importar este módulo garantiza que SECRET_KEY
exista en el entorno ANTES de que los fixtures carguen las lambdas (que la leen a
nivel de módulo)."""
import base64
import hashlib
import hmac
import json
import os
import time

# Mismo default que test_seguridad.py: da igual el orden de importación, el valor
# del proceso es uno solo (todos usan setdefault).
os.environ.setdefault('SECRET_KEY', 'test-secret-key-para-pruebas-32bytes!')


def _b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def make_token(role='admin', user='admin@test.co', exp_in=3600, **extra):
    """JWT HS256 firmado con la SECRET_KEY del entorno (claims mínimos + extra)."""
    now = int(time.time())
    claims = {'user': user, 'role': role, 'iat': now, 'exp': now + exp_in}
    claims.update(extra)
    header = _b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    payload = _b64url(json.dumps(claims).encode())
    sig = hmac.new(os.environ['SECRET_KEY'].encode(),
                   (header + '.' + payload).encode(), hashlib.sha256).digest()
    return header + '.' + payload + '.' + _b64url(sig)
