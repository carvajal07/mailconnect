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

PBKDF2_ITERATIONS = int(os.environ.get('PBKDF2_ITERATIONS', '600000'))

# ── Bloqueo progresivo por intentos fallidos de login ────────────────────────
# Al 2º fallo se avisa que queda 1 intento; al 3º la cuenta se bloquea 5 min.
# Si tras habilitarse vuelve a fallar → 1 hora; si se repite → 24 horas (y se
# mantiene en 24 h para los siguientes). Un login CORRECTO con la cuenta ya
# desbloqueada limpia el contador y la escalera. Durante un bloqueo vigente se
# rechaza el ingreso aunque la contraseña sea correcta (si no, el bloqueo no
# frenaría la fuerza bruta que acierta).
LOCK_THRESHOLD = int(os.environ.get('LOGIN_LOCK_THRESHOLD', '3'))
LOCK_DURATIONS_SECONDS = (5 * 60, 60 * 60, 24 * 60 * 60)

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


def _needs_rehash(stored_hash):
    """True si el hash guardado es el viejo sha256 o un pbkdf2 con MENOS iteraciones
    que las actuales. El formato auto-descriptivo 'pbkdf2$<iter>$<hex>' permite subir
    el costo sin migración: se re-hashea en el siguiente login exitoso."""
    stored = str(stored_hash or '')
    if not stored.startswith('pbkdf2$'):
        return True
    try:
        return int(stored.split('$', 2)[1]) < PBKDF2_ITERATIONS
    except Exception:
        return True


def _lock_state(item):
    """(bloqueadaHasta epoch, etapa de bloqueo) del item de usuario; 0/0 si no hay."""
    try:
        lock_until = int(item.get('lockUntil', 0) or 0)
    except Exception:
        lock_until = 0
    try:
        stage = int(item.get('lockStage', 0) or 0)
    except Exception:
        stage = 0
    return lock_until, stage


def _lock_message(seconds):
    if seconds >= 86400:
        return 'Cuenta bloqueada por 24 horas por intentos fallidos.'
    if seconds >= 3600:
        return 'Cuenta bloqueada por 1 hora por intentos fallidos.'
    return 'Cuenta bloqueada por 5 minutos por intentos fallidos.'


def _remaining_text(seconds):
    minutes = max(1, int((seconds + 59) // 60))
    if minutes >= 60:
        return '{} hora(s)'.format((minutes + 59) // 60)
    return '{} minuto(s)'.format(minutes)


def _apply_lock(user_id, stage):
    """Aplica el bloqueo de la etapa dada (0→5 min, 1→1 h, 2+→24 h). Deja el contador
    en cero: al expirar el bloqueo, UN solo fallo escala a la siguiente etapa."""
    duration = LOCK_DURATIONS_SECONDS[min(stage, len(LOCK_DURATIONS_SECONDS) - 1)]
    table_user.update_item(
        Key={'userId': user_id},
        UpdateExpression='SET lockUntil = :u, lockStage = :s, failedLoginAttempts = :z',
        ExpressionAttributeValues={':u': int(time.time()) + duration, ':s': stage + 1, ':z': 0})
    return True, _lock_message(duration)


def _register_failed_attempt(user_id, stage):
    """Cuenta un fallo y aplica el bloqueo progresivo. Devuelve (bloqueado, aviso).
    El contador es atómico (ADD) para no perder fallos concurrentes."""
    if stage > 0:
        # Ya hubo un bloqueo previo (expirado): un solo fallo escala al siguiente nivel.
        return _apply_lock(user_id, stage)
    resp = table_user.update_item(
        Key={'userId': user_id},
        UpdateExpression='ADD failedLoginAttempts :one',
        ExpressionAttributeValues={':one': 1},
        ReturnValues='UPDATED_NEW')
    attempts = int(resp.get('Attributes', {}).get('failedLoginAttempts', 1))
    if attempts >= LOCK_THRESHOLD:
        return _apply_lock(user_id, 0)
    if attempts == LOCK_THRESHOLD - 1:
        return False, ' Te queda 1 intento antes de que la cuenta se bloquee temporalmente.'
    return False, ''


def _reset_lock(user_id):
    """Login correcto (cuenta desbloqueada): limpia contador y escalera. Best-effort."""
    try:
        table_user.update_item(
            Key={'userId': user_id},
            UpdateExpression='SET failedLoginAttempts = :z, lockStage = :z REMOVE lockUntil',
            ExpressionAttributeValues={':z': 0})
    except Exception as e:
        print('No se pudo resetear el contador de intentos: {}'.format(e))


def generate_jwt(username, customer_id="", customer="", user_id="", role="client", nit="", tenant_role="owner", session_id=""):
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
        # Id de la sesión en la tabla `session` (revocación server-side): el Authorizer
        # deniega tokens cuya sesión ya no está activa (logout / cambio de contraseña).
        'sid': str(session_id or ''),
        'iat': now_ts,
        'exp': now_ts + JWT_TTL_SECONDS,  # Expira en 1 día
    }

    # Generar el token JWT
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    # PyJWT < 2 devuelve bytes; normalizar a str para que el envelope JSON no lo altere.
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token

# Vigencia del DESAFÍO de 2FA (segundos): tras validar la contraseña, si el usuario tiene
# segundo factor, Login NO emite el token; devuelve este desafío firmado y de vida corta,
# que Api_V1_Security_Verify-2fa consume junto con el código TOTP/respaldo para emitir el JWT.
TWOFA_CHALLENGE_TTL_SECONDS = 5 * 60


def generate_2fa_challenge(user_id):
    """JWT corto (claim twofa=True) que autoriza SOLO a Verify-2fa a completar el ingreso."""
    now_ts = int(time.time())
    token = jwt.encode({'twofa': True, 'userId': user_id,
                        'iat': now_ts, 'exp': now_ts + TWOFA_CHALLENGE_TTL_SECONDS},
                       SECRET_KEY, algorithm='HS256')
    return token.decode('utf-8') if isinstance(token, bytes) else token


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


def create_Session(userId, ipAddress, device, numberAttemps, session_id=None):
    sessionId = session_id or str(uuid.uuid4())
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
        ProjectionExpression='company, companyTin, realSendEnabled, featureFlags').get('Item') or {}
    # Si el cliente es antiguo y no tiene el campo, se asume habilitado (fail-open).
    # featureFlags = banderas de funciones por cliente ({key: bool}); ausente = todo habilitado.
    flags = item.get('featureFlags') or {}
    flags = {str(k): bool(v) for k, v in flags.items()} if isinstance(flags, dict) else {}
    return (item.get('company', ''), item.get('companyTin', ''),
            bool(item.get('realSendEnabled', True)), flags)

def select_name(userDataId):
    # userDataId es la PK de `userData` → GetItem O(1) (antes Scan+filter).
    item = table_user_data.get_item(
        Key={'userDataId': userDataId},
        ProjectionExpression='userName').get('Item') or {}
    return item.get('userName', '')

def _find_user_by_email(email):
    """Busca el usuario por email con Query O(1) al GSI `USER_EMAIL_GSI` (PK 'email').
    Escalable por defecto; si el GSI no existe, propaga el error (no cae a Scan)."""
    proj = ('userId, userHash, userSalt, active, customerId, userDataId, #r, tenantRole, '
            'failedLoginAttempts, lockUntil, lockStage, totpEnabled')
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
    feature_flags = {}
    role = "client"
    tenantRole = "owner"
    twofa_required = False
    challenge = ""
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
            item_user = responseUser['Items'][0]
            isActive = item_user['active']

            # Estado del bloqueo progresivo por intentos fallidos (ver LOCK_THRESHOLD).
            lock_until, lock_stage = _lock_state(item_user)
            now_epoch = int(time.time())

            if (isActive):
                if now_epoch < lock_until:
                    # Bloqueo vigente: se rechaza aunque la contraseña sea correcta.
                    status = False
                    statusCode = 429
                    description = ('Cuenta bloqueada temporalmente por intentos fallidos. '
                                   'Intenta de nuevo en {}.'.format(_remaining_text(lock_until - now_epoch)))
                    ip_audit, _ = _client_info(event)
                    _audit('security.lockout', user,
                           'Intento con la cuenta bloqueada (IP {})'.format(ip_audit))
                else:
                    #validar la contraseña enviada
                    password = event.get('password', '')
                    userHash = item_user['userHash']
                    salt = item_user['userSalt']

                    if _verify_password(password, userHash, salt):
                        userId = item_user['userId']
                        # Login correcto con la cuenta desbloqueada: limpia el contador
                        # de fallos y la escalera de bloqueos (si había).
                        if item_user.get('failedLoginAttempts') or lock_stage or lock_until:
                            _reset_lock(userId)
                        # Rehash transparente: hash viejo (sha256) o pbkdf2 con menos
                        # iteraciones que las actuales → se regenera en este login.
                        if _needs_rehash(userHash):
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
                        # SEGUNDO FACTOR (2FA): si el usuario lo tiene activo, la contraseña
                        # correcta NO basta. Se devuelve un DESAFÍO firmado y de vida corta;
                        # el ingreso se completa en Verify-2fa con el código TOTP/respaldo.
                        # No se crea sesión ni token aquí (evita un token válido sin 2FA).
                        if item_user.get('totpEnabled'):
                            twofa_required = True
                            challenge = generate_2fa_challenge(userId)
                            status = True
                            statusCode = 200
                            description = 'Ingresa el código de tu app de autenticación.'
                            ip_audit, _ = _client_info(event)
                            _audit('security.2fa.challenge', user,
                                   'Contraseña correcta; se solicita 2FA (IP {})'.format(ip_audit))
                        else:
                            customerId = item_user['customerId']
                            # Rol del usuario (default 'client' si es antiguo/no lo tiene).
                            role = item_user.get('role', 'client') or 'client'
                            # Sub-rol de empresa (default 'owner' para cuentas antiguas).
                            tenantRole = item_user.get('tenantRole', 'owner') or 'owner'
                            customer, companyTin, realSendEnabled, feature_flags = select_client(customerId)
                            userDataId = item_user['userDataId']
                            name = select_name(userDataId)
                            # La sesión se registra ANTES de emitir el token y es OBLIGATORIA:
                            # el token lleva su sessionId (claim `sid`) y el Authorizer deniega
                            # tokens cuya sesión no está activa (revocación server-side). Sin
                            # registro de sesión NO se emite token (sería irrevocable).
                            try:
                                ipAddress, device = _client_info(event)
                                session_id = str(uuid.uuid4())
                                create_Session(userId, ipAddress, device, 1, session_id)
                            except Exception as session_error:
                                print("No se pudo registrar la sesion: {}".format(session_error))
                                status = False
                                statusCode = 500
                                description = 'No se pudo iniciar la sesión. Intenta de nuevo.'
                                token = ""
                            else:
                                # Token con los claims del tenant + rol + sesión (sid).
                                # companyTin (NIT) va como claim `nit`: llave de recursos por cliente.
                                token = generate_jwt(user, customerId, customer, userId, role,
                                                     companyTin, tenantRole, session_id)
                                status = True
                                statusCode = 200
                                description = "Usuario correcto"
                                ip_audit, _ = _client_info(event)
                                _audit('security.login', user,
                                       'Ingreso exitoso (IP {})'.format(ip_audit), customer)
                                _audit('security.token', user,
                                       'Token emitido en el login (IP {})'.format(ip_audit), customer, userId)
                    else:
                        # Contraseña incorrecta: cuenta el fallo y aplica el bloqueo
                        # progresivo (best-effort: si la escritura falla, igual se niega).
                        blocked, aviso = False, ''
                        try:
                            blocked, aviso = _register_failed_attempt(item_user['userId'], lock_stage)
                        except Exception as lock_error:
                            print('No se pudo registrar el intento fallido: {}'.format(lock_error))
                        status = False
                        ip_audit, _ = _client_info(event)
                        if blocked:
                            statusCode = 429
                            description = aviso
                            _audit('security.lockout', user,
                                   '{} (IP {})'.format(aviso, ip_audit))
                        else:
                            statusCode = 404
                            description = 'Usuario o contraseña incorrectos.' + aviso
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
                'tenantRole': tenantRole,
                'featureFlags': feature_flags,
                # 2FA: si el usuario tiene segundo factor, twofaRequired=True y el token va
                # vacío; el front usa `challenge` para completar el ingreso en Verify-2fa.
                'twofaRequired': twofa_required,
                'challenge': challenge
            }
        }

    return response