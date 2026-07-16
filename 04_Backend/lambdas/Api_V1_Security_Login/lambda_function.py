import os
import jwt
import time
import uuid
import boto3
import hashlib
import hmac
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key

# Vigencia del JWT (segundos). 1 día.
JWT_TTL_SECONDS = 24 * 60 * 60

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
# Crear un cliente de DynamoDB
dynamodb2 = boto3.client('dynamodb')
table_user = dynamodb.Table('user')
table_customer = dynamodb.Table("customer")
table_user_data = dynamodb.Table("userData")
table_session = dynamodb.Table('session')
_audit_table = dynamodb.Table('adminAudit')
SECRET_KEY = os.environ['SECRET_KEY']  # Variable de entorno en la consola Lambda


def _audit(action, actor, detail, customer='', target=''):
    """Bitácora de seguridad (adminAudit). Best-effort: nunca rompe el login.

    Aquí el actor NO viene del Authorizer (es pre-autenticación): es el correo con
    el que se intentó ingresar. Registra intentos de login (éxito/fallo/usuario
    inexistente/cuenta inactiva) y la emisión de tokens.
    """
    try:
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(actor or 'desconocido'),
            'actorId': '',
            'customer': str(customer or ''),
            'target': str(target or actor or ''),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))

PBKDF2_ITERATIONS = int(os.environ.get('PBKDF2_ITERATIONS', '100000'))

# GSI de `user` por email (PK 'email'). El login busca SIEMPRE por Query O(1) al índice
# (escalable por defecto). Si el GSI no existe, el login FALLA (no cae a Scan de tabla
# completa) para que la ausencia del índice se detecte en el despliegue. Override del nombre
# por env solo si el índice se llama distinto.
USER_EMAIL_GSI = os.environ.get('USER_EMAIL_GSI', 'email-index').strip() or 'email-index'


def _hash_password(password, salt):
    """PBKDF2-HMAC-SHA256 (stdlib, sin dependencias/layer). Formato auto-descriptivo
    'pbkdf2$<iter>$<hex>'. Reemplaza el SHA-256 de una sola pasada (débil ante GPU)."""
    dk = hashlib.pbkdf2_hmac('sha256', str(password).encode(), str(salt).encode(), PBKDF2_ITERATIONS)
    return 'pbkdf2${}${}'.format(PBKDF2_ITERATIONS, dk.hex())


def _verify_password(password, stored_hash, salt):
    """Verifica contra el hash nuevo (pbkdf2) o el viejo (sha256), timing-safe."""
    stored = str(stored_hash or '')
    if stored.startswith('pbkdf2$'):
        try:
            _, iters, hexhash = stored.split('$', 2)
            dk = hashlib.pbkdf2_hmac('sha256', str(password).encode(), str(salt).encode(), int(iters))
            return hmac.compare_digest(dk.hex(), hexhash)
        except Exception:
            return False
    legacy = hashlib.sha256((str(password) + str(salt)).encode()).hexdigest()
    return hmac.compare_digest(legacy, stored)


def _is_legacy_hash(stored_hash):
    return not str(stored_hash or '').startswith('pbkdf2$')


def generate_jwt(username, customer_id="", customer="", user_id="", role="client", nit="", tenant_role="owner"):
    # Información de la carga útil. Se embeben la identidad del tenant (customerId,
    # customer, nit), el userId y el rol como claims: el Authorizer los reenvía en el
    # context y las lambdas pueden confiar en ellos (multi-tenant + roles) en vez del body.
    # El `nit` (companyTin) es la LLAVE de los recursos por cliente (tablas/buckets):
    # las lambdas construyen p. ej. {tenant_key(nit)}_sendStatus con él (ver tenant_key).
    # exp/iat como TIMESTAMP ENTERO (UTC), no como objeto datetime: es robusto entre
    # versiones de PyJWT (algunas serializan mal el datetime) y evita ambigüedad de zona.
    now_ts = int(time.time())
    payload = {
        'user': username,
        'customerId': customer_id,
        'customer': customer,
        'nit': str(nit or ''),
        'userId': user_id,
        'role': role,
        # Sub-rol dentro de la empresa (RBAC): owner|approver|operator. Default owner
        # (compatibilidad con cuentas antiguas). El Authorizer lo reenvía en el context.
        'tenantRole': tenant_role or 'owner',
        'iat': now_ts,
        'exp': now_ts + JWT_TTL_SECONDS,  # Expira en 1 día
    }

    # Generar el token JWT
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    # PyJWT < 2 devuelve bytes; normalizar a str para que el envelope JSON no lo altere.
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token

def _client_info(event):
    """Extrae IP y user-agent del evento (soporta proxy y no-proxy).

    En integración NO-PROXY (como esta lambda), API Gateway NO incluye
    requestContext.identity.sourceIp a menos que el mapping template lo inyecte. Por eso,
    además del caso proxy, se busca la IP en:
      - el body (campo 'ip'/'sourceIp' que el mapping puede rellenar con
        $context.identity.sourceIp), y
      - el header 'X-Forwarded-For' (si el mapping reenvía los headers).
    Si nada de eso llega, queda 'unknown' (ver DESPLIEGUE.md → inyectar la IP en el
    mapping template del login).
    """
    ip = "unknown"
    device = "unknown"
    if isinstance(event, dict):
        rc = event.get('requestContext') or {}
        identity = rc.get('identity') or {}
        ip = identity.get('sourceIp') or ip
        # No-proxy: el mapping template puede inyectar la IP en el body.
        if ip == "unknown":
            ip = event.get('ip') or event.get('sourceIp') or ip
        headers = event.get('headers') or {}
        # Los headers pueden venir con distinta capitalización.
        for k, v in headers.items():
            lk = str(k).lower()
            if lk == 'user-agent' and v:
                device = v
            elif ip == "unknown" and lk == 'x-forwarded-for' and v:
                # X-Forwarded-For puede traer varias IPs; la primera es el cliente.
                ip = str(v).split(',')[0].strip()
    return ip, device


def create_Session(userId,ipAddress,device,numberAttemps):
    sessionId = str(uuid.uuid4())
    # Obtener la fecha y hora actual
    now = datetime.now()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
    # Insertar datos en la tabla de sesiones
    table_session.put_item(
        Item={
            'sessionId': sessionId,
            'userId': userId,
            'ipAddress': ipAddress,
            'device': device,
            'numberAttemps': numberAttemps,
            'active': True,
            'date': formattedDate
        }
    )
    
def select_client(customerId):
    # customerId es la PK de `customer` → GetItem O(1). Antes era Scan+FilterExpression,
    # que lee toda la tabla y, peor, si superaba 1 MB sin paginar podía NO encontrar el
    # ítem (login fallaba intermitentemente al crecer la tabla).
    item = table_customer.get_item(
        Key={'customerId': customerId},
        ProjectionExpression='company, companyTin, realSendEnabled').get('Item') or {}
    # Si el cliente es antiguo y no tiene el campo, se asume habilitado (fail-open).
    return item.get('company', ''), item.get('companyTin', ''), bool(item.get('realSendEnabled', True))

def select_name(userDataId):
    # userDataId es la PK de `userData` → GetItem O(1) (antes Scan+filter).
    item = table_user_data.get_item(
        Key={'userDataId': userDataId},
        ProjectionExpression='userName').get('Item') or {}
    return item.get('userName', '')

def _find_user_by_email(email):
    """Busca el usuario por email con Query O(1) al GSI `USER_EMAIL_GSI` (PK 'email').
    Escalable por defecto; si el GSI no existe, propaga el error (no cae a Scan)."""
    proj = 'userId, userHash, userSalt, active, customerId, userDataId, #r, tenantRole'
    names = {'#r': 'role'}  # 'role' es palabra reservada → alias
    resp = table_user.query(
        IndexName=USER_EMAIL_GSI,
        KeyConditionExpression=Key('email').eq(email),
        ProjectionExpression=proj,
        ExpressionAttributeNames=names)
    return resp.get('Items', [])


def lambda_handler(event, context):
    status = True
    description = "Usuario logueado correctamente"
    statusCode = 201
    customer = ""
    customerId = ""
    companyTin = ""
    name = ""
    token = ""
    userId = ""
    realSendEnabled = True
    role = "client"
    tenantRole = "owner"
    try:
        # Obtener datos del evento (email normalizado a minúsculas, como en Register)
        user = str(event['user']).strip().lower()

        '''
        #consulta por query
        # Parámetros de la consulta
        key_condition_expression = Key('username').eq(user)
        projection_expression = 'userName, hash, salt, isActive'  # Lista de campos a consultar

        response = dynamodb2.query(
            TableName=table_user,
            KeyConditionExpression=key_condition_expression,
            ProjectionExpression=projection_expression
        )
        
        # Imprimir los resultados
        items = response.get('Items', [])
        for item in items:
            print(item)
        '''
        # Búsqueda por email: Query O(1) por GSI si está configurado; si no, Scan paginado.
        responseUser = {'Items': _find_user_by_email(user)}
    except KeyError:
        # Falta un campo obligatorio del cliente → 400 (no 500).
        status = False
        statusCode = 400
        description = "Faltan datos obligatorios"
    except Exception as e:
        print("Error en login: {}".format(e))
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        # Verificar si se encontró el elemento
        if responseUser['Items']:
            
            isActive = responseUser['Items'][0]['active']
            #isBlocked = response['Items'][0]['isBlocked']
            isBlocked = False

            if (isActive):
                if (isBlocked):
                    status = False
                    statusCode = 400
                    description = "Usuario bloqueado"
                else:
                    #validar la contraseña enviada
                    password = event.get('password', '')
                    userHash = responseUser['Items'][0]['userHash']
                    salt = responseUser['Items'][0]['userSalt']

                    if _verify_password(password, userHash, salt):
                        userId = responseUser['Items'][0]['userId']
                        # Rehash transparente: si el hash guardado es el viejo (sha256),
                        # se regenera con PBKDF2 + nuevo salt en este login exitoso.
                        if _is_legacy_hash(userHash):
                            try:
                                new_salt = str(uuid.uuid4())
                                table_user.update_item(
                                    Key={'userId': userId},
                                    UpdateExpression='SET userHash = :h, userSalt = :s',
                                    ExpressionAttributeValues={
                                        ':h': _hash_password(password, new_salt), ':s': new_salt}
                                )
                            except Exception as _e:
                                print('No se pudo re-hashear (se continúa): {}'.format(_e))
                        customerId = responseUser['Items'][0]['customerId']
                        # Rol del usuario (default 'client' si el usuario es antiguo/no lo tiene).
                        role = responseUser['Items'][0].get('role', 'client') or 'client'
                        # Sub-rol de empresa (default 'owner' para cuentas antiguas).
                        tenantRole = responseUser['Items'][0].get('tenantRole', 'owner') or 'owner'
                        customer, companyTin, realSendEnabled = select_client(customerId)
                        userDataId = responseUser['Items'][0]['userDataId']
                        name = select_name(userDataId)
                        # Token con los claims del tenant + rol (multi-tenant + roles vía Authorizer).
                        # companyTin (NIT) va como claim `nit`: es la llave de los recursos por cliente.
                        token = generate_jwt(user, customerId, customer, userId, role, companyTin, tenantRole)
                        # Registrar la sesión. No debe romper el login si falla
                        # (p. ej. permisos de la tabla), por eso va en su propio try.
                        try:
                            ipAddress, device = _client_info(event)
                            create_Session(userId, ipAddress, device, 1)
                        except Exception as session_error:
                            print("No se pudo registrar la sesion: {}".format(session_error))
                        status = True
                        statusCode = 200
                        description = "Usuario correcto"
                        ip_audit, _ = _client_info(event)
                        _audit('security.login', user,
                               'Ingreso exitoso (IP {})'.format(ip_audit), customer)
                        _audit('security.token', user,
                               'Token emitido en el login (IP {})'.format(ip_audit), customer, userId)
                    else:
                        status = False
                        statusCode = 404
                        description = 'Usuario o contraseña incorrectos'
                        ip_audit, _ = _client_info(event)
                        _audit('security.login', user,
                               'Contraseña incorrecta (IP {})'.format(ip_audit))
            else:
                status = False
                statusCode = 423
                description = 'Usuario o cuenta inactiva, cuenta sin verificar'
                ip_audit, _ = _client_info(event)
                _audit('security.login', user,
                       'Intento con cuenta inactiva / sin verificar (IP {})'.format(ip_audit))

        else:
            # Usuario no existe: se computa un hash "dummy" para igualar el tiempo de
            # respuesta con el caso de usuario existente (evita enumeración por timing).
            _verify_password(event.get('password', ''),
                             'pbkdf2${}${}'.format(PBKDF2_ITERATIONS, '0' * 64), 'x')
            status = False
            statusCode = 404
            description = 'Usuario o contraseña incorrectos'
            ip_audit, _ = _client_info(event)
            _audit('security.login', user,
                   'Intento con usuario inexistente (IP {})'.format(ip_audit))

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description,
            'data':{
                'token': token,
                'customer': customer,
                'customerId': customerId,
                'companyTin': str(companyTin) if companyTin != "" else "",
                'userId': userId,
                'name': name,
                'realSendEnabled': realSendEnabled,
                'role': role,
                'tenantRole': tenantRole
            }
        }

    return response