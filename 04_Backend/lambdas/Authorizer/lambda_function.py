import os

import jwt  # PyJWT (mismo layer/lib que usa Login)

# Autorizador de API Gateway para MailConnect.
#
# Valida el JWT (HS256) firmado por la lambda de Login con SECRET_KEY.
# - Soporta autorizadores de tipo TOKEN (event['authorizationToken']) y
#   REQUEST (event['headers']['Authorization']).
# - Devuelve una policy "Allow" si el token es válido y no ha expirado.
# - Lanza Exception('Unauthorized') (=> 401) si falta el token, es inválido,
#   expiró, o si SECRET_KEY no está configurada (deniega por defecto).

SECRET_KEY = os.environ.get('SECRET_KEY', '')


def _extract_token(event):
    """Obtiene el token del evento, soportando autorizadores TOKEN y REQUEST."""
    raw = ''
    if isinstance(event, dict):
        # TOKEN authorizer: el valor llega en authorizationToken.
        raw = event.get('authorizationToken') or ''
        if not raw:
            # REQUEST authorizer: el valor llega en un header. Se acepta 'Authorization'
            # o 'token' (esta API usa identity source = header 'token').
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
    # Recurso a autorizar (methodArn); "*" evita problemas de caché entre métodos.
    resource = event.get('methodArn', '*') if isinstance(event, dict) else '*'

    # Sin SECRET_KEY no podemos validar nada: denegar por defecto.
    if not SECRET_KEY:
        print("Authorizer: SECRET_KEY no configurada; se deniega el acceso.")
        raise Exception('Unauthorized')

    token = _extract_token(event)
    if not token:
        print("Authorizer: no se envió token.")
        raise Exception('Unauthorized')

    try:
        decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        print("Authorizer: token expirado.")
        raise Exception('Unauthorized')
    except Exception as e:
        print("Authorizer: token inválido: {}".format(e))
        raise Exception('Unauthorized')

    user = decoded.get('user')
    if not user:
        print("Authorizer: el token no contiene 'user'.")
        raise Exception('Unauthorized')

    # Reenviar la identidad del tenant en el context. API Gateway la expone a las
    # lambdas como event.requestContext.authorizer.<clave> (proxy) o, en no-proxy,
    # se inyecta al body con un mapping template ($context.authorizer.customerId).
    # Los valores del context deben ser strings.
    ctx = {
        'user': str(user),
        'customerId': str(decoded.get('customerId', '') or ''),
        'customer': str(decoded.get('customer', '') or ''),
        'userId': str(decoded.get('userId', '') or ''),
        'role': str(decoded.get('role', 'client') or 'client'),
    }
    return _build_policy(user, 'Allow', resource, context=ctx)
