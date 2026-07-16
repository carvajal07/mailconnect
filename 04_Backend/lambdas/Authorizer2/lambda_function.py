import os

import jwt  # PyJWT (mismo layer/lib que usa Login)

# Autorizador de API Gateway para MailConnect (variante secundaria).
#
# Comparte la lógica de `Authorizer`: valida el JWT (HS256) firmado por Login
# con SECRET_KEY y devuelve "Allow" solo si el token es válido y no expiró.
# Ante cualquier duda deniega (fail-closed): lanza Exception('Unauthorized').

SECRET_KEY = os.environ.get('SECRET_KEY', '')


def _extract_token(event):
    """Obtiene el token del evento, soportando autorizadores TOKEN y REQUEST."""
    raw = ''
    if isinstance(event, dict):
        raw = event.get('authorizationToken') or ''
        if not raw:
            # REQUEST authorizer: acepta header 'Authorization' o 'token' (esta API usa 'token').
            headers = event.get('headers') or {}
            for key, value in headers.items():
                if str(key).lower() in ('authorization', 'token'):
                    raw = value or ''
                    break
    raw = (raw or '').strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return raw


def _build_policy(principal_id, effect, resource, context=None):
    policy = {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{
                'Effect': effect,
                'Action': 'execute-api:Invoke',
                'Resource': resource,
            }],
        },
    }
    if context:
        policy['context'] = context
    return policy


def lambda_handler(event, context):
    resource = event.get('methodArn', '*') if isinstance(event, dict) else '*'

    if not SECRET_KEY:
        print("Authorizer2: SECRET_KEY no configurada; se deniega el acceso.")
        raise Exception('Unauthorized')

    token = _extract_token(event)
    if not token:
        print("Authorizer2: no se envió token.")
        raise Exception('Unauthorized')

    try:
        decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        print("Authorizer2: token expirado.")
        raise Exception('Unauthorized')
    except Exception as e:
        print("Authorizer2: token inválido: {}".format(e))
        raise Exception('Unauthorized')

    user = decoded.get('user')
    if not user:
        print("Authorizer2: el token no contiene 'user'.")
        raise Exception('Unauthorized')

    # Reenviar la identidad del tenant en el context (ver Authorizer).
    ctx = {
        'user': str(user),
        'customerId': str(decoded.get('customerId', '') or ''),
        'customer': str(decoded.get('customer', '') or ''),
        # NIT (companyTin): llave de los recursos por cliente (tablas/buckets).
        'nit': str(decoded.get('nit', '') or ''),
        'userId': str(decoded.get('userId', '') or ''),
        'role': str(decoded.get('role', 'client') or 'client'),
        # Sub-rol de empresa (RBAC): owner|approver|operator. Default owner.
        'tenantRole': str(decoded.get('tenantRole', 'owner') or 'owner'),
    }
    return _build_policy(user, 'Allow', resource, context=ctx)
