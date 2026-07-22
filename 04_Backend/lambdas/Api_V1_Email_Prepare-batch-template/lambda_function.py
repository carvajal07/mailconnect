'''
Lambda para preparar la base de datos del cliente para su posterior envio
'''
import os
import re
import csv
import sys
import json
import uuid
import time
from decimal import Decimal
from datetime import datetime

import boto3
import pandas as pd
from botocore.exceptions import ClientError

#pylint: disable=C0301
#pylint: disable=C0303
#Podemos manejar cada mensaje de SQS para EM con 250 registros cada uno
#SQS soporta un peso de 256kb

#podemos recibir por cada registro el identificador unico, email y 20 opcionales para personalizacion

#EM  -> Email marketing                  #Real:250
#EAU -> Email con adjunto unico          #Real:250
#EAP -> Email con adjunto personalizado  #Real:100

REGISTERS_FOR_EM:int = 250
REGISTERS_FOR_EAU:int = 250
REGISTERS_FOR_EAP:int = 100
REGISTERS_FOR_SMS:int = 100
REGISTERS_FOR_WSP:int = 100
REGISTERS_FOR_VOICE:int = 50

URL_SQS_EM = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-template-EM'
URL_SQS_EAU = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-raw-EAU'
#URL_SQS_EAP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-raw-EAP'
# EAP con DOCX: combinación de correspondencia (armado del .docx por destinatario).
URL_SQS_EAP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Template_Combination-EAP'
# EAP con PDF: personalización de campos en un PDF (armador DISTINTO al de Word).
# ⚠️ [J]: crear esta cola + la lambda que arma el PDF personalizado (aún no existe).
URL_SQS_EAP_PDF = 'https://sqs.us-east-1.amazonaws.com/873837768806/Template_Combination-EAP-PDF'
# Canal SMS: cola que consume la lambda Api_V1_Sms_Send-batch (AWS End User Messaging).
URL_SQS_SMS = 'https://sqs.us-east-1.amazonaws.com/873837768806/Sms_Send-batch'
# Canal WhatsApp: cola que consume la lambda Api_V1_Wsp_Send-batch (End User Messaging Social).
URL_SQS_WSP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Wsp_Send-batch'
# Canal Voz: cola que consume la lambda Api_V1_Voice_Send-batch (End User Messaging Voice).
URL_SQS_VOICE = 'https://sqs.us-east-1.amazonaws.com/873837768806/Voice_Send-batch'
# Fase 4 — Fan-out de CSV grandes: la MISMA lambda se dispara con esta cola para procesar
# UNA parte del envío real. El envío real por API "trocea" el CSV en part-files en S3 y
# encola un trabajo por parte aquí; cada disparo procesa su parte (valida/filtra/encola al
# canal). Evita que UNA sola invocación procese 100k+ registros (timeout de 15 min).
URL_SQS_PREPARE_PART = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Prepare-batch-part'
# Filas por part-file (tamaño del troceo). Cada parte se procesa en su propia invocación.
PART_SIZE:int = 5000
REGION = 'us-east-1'
DELIMITER = ';'          # delimitador por defecto si no se puede detectar
CANDIDATE_DELIMITERS = [';', ',', '\t', '|']
ENCODING = 'utf-8'

# Headers CORS para las respuestas PROXY (samples/real). En integración Lambda-proxy,
# "Enable CORS" en API Gateway solo crea el preflight OPTIONS; el header de la respuesta
# real lo DEBE emitir la lambda. Sin esto el navegador bloquea el POST ("Failed to fetch").
CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

# Bucket por cliente por NIT: {prefix}-{nit}-{database|document} (DNS-safe). Se prefiere el
# NIT sobre el nombre de empresa; hay fallback al esquema viejo por nombre en las lecturas.
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')


def tenant_key(nit):
    """Llave de tenant para nombres de recursos por cliente (tablas y buckets): el NIT
    (companyTin) saneado a [a-z0-9] → DNS/DynamoDB-safe. UNIFICA el naming: las tablas
    ({tenant_key}_sendStatus, _sendDetail, _blackList, …) y los buckets usan la MISMA
    llave, en vez de mezclar nombre-de-empresa (tablas) con NIT (buckets). Es idempotente:
    tenant_key(tenant_key(x)) == tenant_key(x)."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit, doc_type):
    return '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))


def require_tenant(nit):
    """Llave de tenant (tenant_key) EXIGIENDO que exista. Un cliente sin NIT no puede
    nombrar sus tablas por cliente: si se dejara vacío, TODOS los clientes sin NIT
    compartirían la tabla '_sendStatus' (fuga entre tenants). Falla ruidosamente."""
    key = tenant_key(nit)
    if not key:
        raise ValueError('El cliente no tiene NIT (companyTin); no se pueden nombrar sus '
                         'recursos por cliente. Configure companyTin antes de enviar.')
    return key


def detect_delimiter(temp_file, default=DELIMITER):
    """Detecta el delimitador del CSV leyendo el encabezado: elige, entre ; , tab |,
    el que más aparece en la primera línea con datos. Así el cliente puede subir la
    base con cualquiera de los 4 delimitadores (antes se asumía siempre ';')."""
    try:
        with open(temp_file, 'r', encoding=ENCODING) as f:
            for line in f:
                if line.strip():
                    counts = {d: line.count(d) for d in CANDIDATE_DELIMITERS}
                    best = max(counts, key=counts.get)
                    chosen = best if counts[best] > 0 else default
                    print("Delimitador detectado: {!r}".format(chosen))
                    return chosen
    except Exception as e:
        print("No se pudo detectar el delimitador ({}); se usa {!r}".format(e, default))
    return default


class ProcessState:
    """Estado POR INVOCACIÓN del envío. Antes vivía en variables globales del módulo, un
    patrón frágil en Lambda "caliente" (los globals persisten entre invocaciones y se
    pisan). Ahora se arma UNA vez en el handler y se pasa EXPLÍCITAMENTE a
    preparar_muestras()/preparar_split()/procesar_parte() y a los helpers que lo necesitan."""

    def __init__(self):
        self.process_id = None
        self.campaign_id = None
        self.customer_id = None
        self.customer_name = None
        self.formatted_date = None
        self.from_email = None
        self.headers = None
        self.template_name = None
        self.attachment = False
        self.channel = ''        # canal de la campaña (EM/EAU/EAP/SMS/WSP/VOZ) → tipo de contacto
        self.sms_body = ''       # texto SMS (solo canal SMS)
        self.wsp_template = ''   # nombre HSM (solo canal WSP)
        self.voice_message = ''  # texto TTS (solo canal VOZ)
        self.nit = None          # NIT (companyTin) del cliente → llave de recursos por cliente
        self.is_samples = False  # True en el flujo de MUESTRAS → el worker cuenta el envío OK

    @property
    def tenant(self):
        """Llave de tenant (NIT saneado) para las tablas/buckets por cliente. Se deriva
        del NIT: todas las tablas del cliente son {tenant}_sendStatus, _sendDetail, etc."""
        return tenant_key(self.nit)


# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb', region_name=REGION)

# Inicializa el cliente de S3
s3 = boto3.client('s3', region_name=REGION)

# Configurar el cliente de SQS
sqs = boto3.client('sqs', region_name=REGION)

# Inicializar el cliente SES
ses = boto3.client('ses', region_name=REGION)

table_process = dynamodb.Table('process')
table_campaign = dynamodb.Table('campaign')
table_customer = dynamodb.Table('customer')
table_database = dynamodb.Table('databaseFile')
# Plantillas de mensaje SMS/WSP (canales no-SES). El envío resuelve el contenido EN VIVO
# desde esta tabla (por campaign.messageTemplateId) para reflejar ediciones posteriores a la
# creación de la campaña; el texto guardado en campaign.template queda solo como respaldo.
table_message_template = dynamodb.Table('messageTemplate')
_audit_table = dynamodb.Table('adminAudit')

# --- Cobro PREPAGO (monedero) -------------------------------------------------
# El envío REAL debita el saldo del cliente ANTES de trocear (bloqueo DURO por saldo).
# El costo se calcula con la MISMA lógica/tarifas del estimador (Api_V1_Cost_Estimate),
# replicada aquí como hace Api_V1_Billing_Summary.
# ⚠️ SINCRONÍA: si cambian DEFAULT_RATES o la fórmula en Cost_Estimate, hay que
# replicarlo aquí (y en Billing_Summary / Pricing_*). No hay una fuente única todavía.
table_balance = dynamodb.Table('customerBalance')
table_wallet = dynamodb.Table('walletTransaction')
table_rates = dynamodb.Table('pricingRate')

DEFAULT_TAX_RATE = 0.19          # IVA Colombia
DEFAULT_MIN_CAMPAIGN = 5000      # mínimo por campaña (COP)
DEFAULT_RATES = {
    'EMAIL': {'baseEM': None, 'baseEAU': None, 'baseEAP': None, 'attachmentPerMB': 0, 'personalizedPdf': 0, 'personalizedDocx': 0},
    'SMS': {'baseSms': None},
    'WHATSAPP': {'baseMarketing': None},
    'VOICE': {'basePerMinute': None, 'avgMinutes': 0.5},
    'COMMON': {'taxRate': DEFAULT_TAX_RATE, 'minCampaign': DEFAULT_MIN_CAMPAIGN},
}
# Precio unitario por TRAMO de volumen (COP). Réplica de Api_V1_Cost_Estimate.VOLUME_TIERS
# (mantener en sync). El precio del tramo aplica a TODO el envío (se elige por el total de
# destinatarios) y es "todo incluido". Si pricingRate trae un valor plano, ese override gana.
VOLUME_TIERS = {
    'EM':       [(1, 30), (2000, 28), (5000, 27), (10000, 25), (20000, 21), (50000, 19), (100000, 14), (200000, 9), (500000, 5), (1000000, 4)],
    'EAU':      [(1, 45), (2000, 42), (5000, 40), (10000, 37), (20000, 31), (50000, 28), (100000, 21), (200000, 14), (500000, 8), (1000000, 6)],
    'EAP':      [(1, 60), (2000, 55), (5000, 50), (10000, 46), (20000, 38), (50000, 33), (100000, 24), (200000, 16), (500000, 10), (1000000, 8)],
    'SMS':      [(1, 55), (2000, 50), (5000, 45), (10000, 40), (20000, 35), (50000, 28), (100000, 22), (200000, 18), (500000, 14), (1000000, 10)],
    'WHATSAPP': [(1, 130), (2000, 125), (5000, 118), (10000, 110), (20000, 100), (50000, 90), (100000, 82), (200000, 76), (500000, 70), (1000000, 65)],
    'VOICE':    [(1, 150), (2000, 140), (5000, 130), (10000, 120), (20000, 110), (50000, 95), (100000, 80), (200000, 70), (500000, 60), (1000000, 48)],
}
# channel de la campaña -> (clave de override plano en la tarifa, clave del tramo por volumen).
CAMPAIGN_TIER = {
    'EM': ('baseEM', 'EM'), 'EAU': ('baseEAU', 'EAU'), 'EAP': ('baseEAP', 'EAP'),
    'SMS': ('baseSms', 'SMS'), 'WSP': ('baseMarketing', 'WHATSAPP'), 'VOZ': ('basePerMinute', 'VOICE'),
}
# Hook de precio ONLINE (enlace) vs ONFILE (adjunto). Hoy 1.0 = mismo precio. Réplica.
ONLINE_FACTOR = 1.0
# channel de la campaña (EM/EAU/EAP/SMS/WSP/VOZ) -> canal de tarifa del estimador.
CHANNEL_MAP = {
    'EM': 'EMAIL', 'EAU': 'EMAIL', 'EAP': 'EMAIL',
    'SMS': 'SMS', 'WSP': 'WHATSAPP', 'VOZ': 'VOICE',
}


def _num(value, default=0.0):
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _tier_unit(tier_key, recipients):
    """Precio unitario del TRAMO por volumen (el mayor tramo cuyo mínimo no supere a
    `recipients`). Réplica de Api_V1_Cost_Estimate._tier_unit."""
    tiers = VOLUME_TIERS.get(tier_key) or []
    if not tiers:
        return 0
    unit = tiers[0][1]
    for min_qty, price in tiers:
        if recipients >= min_qty:
            unit = price
        else:
            break
    return unit


def _base_unit(rate, override_key, tier_key, recipients):
    """Base del canal: override plano de pricingRate si existe; si no, el tramo por volumen."""
    v = rate.get(override_key)
    if v is not None:
        return _num(v)
    return _tier_unit(tier_key, recipients)


def _load_rate(customer_id, channel):
    """Tarifa efectiva: DEFAULT_RATES[channel]+COMMON, sobreescrito por pricingRate
    (primero la global '*', luego la del cliente). Nunca falla: sin tabla, usa defaults.
    Réplica de Api_V1_Cost_Estimate._load_rate (mantener en sync)."""
    rate = dict(DEFAULT_RATES.get(channel, {}))
    rate.update(DEFAULT_RATES['COMMON'])
    for cid in ('*', customer_id):
        if not cid:
            continue
        try:
            item = table_rates.get_item(Key={'customerId': cid, 'channel': channel}).get('Item')
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                break
            raise
        except Exception:
            continue
        if item:
            for k, v in item.items():
                if k not in ('customerId', 'channel'):
                    rate[k] = _num(v, rate.get(k, 0))
    return rate


def _campaign_unit(rate, channel_name, recipients, document_format=None, delivery='ONFILE'):
    """Tarifa unitaria por destinatario según el canal y el VOLUMEN (tramo por `recipients`).
    El precio del tramo es "todo incluido" (misma lógica que Cost_Estimate). Réplica —
    mantener en sync. Si pricingRate trae un valor plano para el canal, ese override gana.
    ONLINE (enlace) vs ONFILE (adjunto): hook de precio en EAU/EAP (hoy factor 1.0)."""
    mapping = CAMPAIGN_TIER.get(channel_name)
    if not mapping:
        return 0.0
    override_key, tier_key = mapping
    unit = _base_unit(rate, override_key, tier_key, recipients)
    if channel_name == 'VOZ':
        unit = unit * rate.get('avgMinutes', 0.5)
    if channel_name in ('EAU', 'EAP') and str(delivery).upper() == 'ONLINE' and ONLINE_FACTOR != 1.0:
        unit = unit * ONLINE_FACTOR
    return unit


def _campaign_cost(customer_id, channel_name, recipients, document_format=None, delivery='ONFILE'):
    """Costo TOTAL (COP entero, con IVA y mínimo por campaña) de enviar `recipients`
    mensajes del canal dado. Misma fórmula que Api_V1_Cost_Estimate para UNA campaña:
    subtotal = max(unit × recipients, minCampaign); total = subtotal + IVA. El unitario es
    ESCALONADO por volumen (tramo elegido por `recipients`)."""
    channel = CHANNEL_MAP.get(channel_name)
    if not channel or recipients <= 0:
        return 0
    rate = _load_rate(customer_id, channel)
    unit = _campaign_unit(rate, channel_name, recipients, document_format, delivery)
    subtotal = max(unit * recipients, rate.get('minCampaign', DEFAULT_MIN_CAMPAIGN))
    total = subtotal * (1 + rate.get('taxRate', DEFAULT_TAX_RATE))
    return int(round(total))


def _audit_send(event, data, action, detail):
    """Bitácora (adminAudit) de quién disparó un envío (muestras / real). Best-effort:
    nunca rompe el envío. Actor del context del Authorizer, con fallback al userId del body."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        d = data if isinstance(data, dict) else {}
        actor = auth.get('user') or auth.get('userId') or d.get('userId') or 'cliente'
        customer = auth.get('customer') or d.get('customerName') or ''
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(actor),
            'actorId': str(auth.get('userId') or d.get('userId') or ''),
            'customer': str(customer),
            'target': str(d.get('campaignName') or ''),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría de envío: {}'.format(e))

# Máximo de OPERACIONES de envío de muestras permitidas por campaña (acumulado en toda
# la vida de la campaña). Cada llamada a Send-batch-template-samples cuenta como 1.
MAX_SAMPLE_SENDS:int = 5


class RealSendDisabled(Exception):
    """El cliente tiene deshabilitados los envíos reales (campo realSendEnabled=false)."""


class AlreadySending(Exception):
    """La campaña ya tomó el lock de envío real (otro proceso / reintento). Idempotencia."""


class InsufficientBalance(Exception):
    """El cliente no tiene saldo suficiente para el envío real (cobro PREPAGO, bloqueo
    DURO: sin cupo negativo). El handler responde 402."""


class RealSendNotApproved(Exception):
    """La campaña está en el flujo de aprobación pero NO aprobada (pending/rejected): no
    se permite el envío real hasta aprobarla. Ver PLAN_APROBACIONES.md. El handler → 409.
    Fail-open de rollout: si approvalStatus es 'none'/ausente (campaña que nunca usó el
    flujo), NO se bloquea (compatibilidad con el envío directo previo)."""


def _wallet_ledger(st, tx_type, amount, balance_after, detail):
    """Escribe SIEMPRE un movimiento en walletTransaction (ledger auditable). Best-effort:
    el saldo ya se movió atómicamente; si el ledger falla se loguea, no se revierte.
    Para débitos/reembolsos deja la traza al proceso/campaña (processId/campaignId)."""
    try:
        table_wallet.put_item(Item={
            'txId': str(uuid.uuid4()),
            'customerId': st.customer_id,
            'type': tx_type,               # debit_send | refund_send
            'amount': int(amount),         # negativo=débito, positivo=reembolso
            'balanceAfter': int(balance_after),
            'currency': 'COP',
            'status': 'approved',
            'actor': 'sistema',
            'reference': str(st.process_id or ''),
            'processId': str(st.process_id or ''),
            'campaignId': str(st.campaign_id or ''),
            'detail': str(detail),
            'createdAt': st.formatted_date,
        })
    except Exception as e:
        print('No se pudo registrar walletTransaction: {}'.format(e))


def reserve_balance(st, cost, campaign_name):
    """Reserva ATÓMICA de `cost` COP del saldo del cliente (débito condicionado a
    balance >= cost, sin leer-modificar-escribir). Bloqueo DURO: sin saldo suficiente
    lanza InsufficientBalance (no hay cupo negativo). La condición también falla si el
    cliente no tiene ítem de saldo (nunca recargó). Devuelve el saldo resultante y deja
    el movimiento en el ledger.

    Devuelve None (sin cobrar) SOLO si la tabla customerBalance aún no existe: fail-open
    durante el rollout del monedero (deploy del código antes de crear la tabla), para no
    bloquear todos los envíos. Una vez creada la tabla, el bloqueo por saldo es DURO."""
    try:
        resp = table_balance.update_item(
            Key={'customerId': st.customer_id},
            UpdateExpression='SET balance = balance - :c, updatedAt = :now',
            ConditionExpression='balance >= :c',
            ExpressionAttributeValues={':c': cost, ':now': st.formatted_date},
            ReturnValues='UPDATED_NEW',
        )
    except ClientError as e:
        code = e.response['Error']['Code']
        if code == 'ConditionalCheckFailedException':
            raise InsufficientBalance(
                'Saldo insuficiente para el envío real. Recarga tu monedero e intenta de nuevo.')
        if code == 'ResourceNotFoundException':
            print('customerBalance no existe todavía; se omite el cobro (rollout del monedero).')
            return None
        raise
    new_balance = int(resp['Attributes']['balance'])
    _wallet_ledger(st, 'debit_send', -cost, new_balance,
                   "Débito por envío real de la campaña '{}'".format(campaign_name))
    return new_balance


def refund_balance(st, cost, campaign_name):
    """COMPENSACIÓN: reembolsa `cost` COP (crédito atómico) cuando el envío real falla
    DESPUÉS de haber debitado. Best-effort: si el reembolso falla se loguea (soporte lo
    corrige con el ledger)."""
    try:
        resp = table_balance.update_item(
            Key={'customerId': st.customer_id},
            UpdateExpression='SET balance = if_not_exists(balance, :z) + :c, updatedAt = :now',
            ExpressionAttributeValues={':c': cost, ':z': 0, ':now': st.formatted_date},
            ReturnValues='UPDATED_NEW',
        )
        new_balance = int(resp['Attributes']['balance'])
        _wallet_ledger(st, 'refund_send', cost, new_balance,
                       "Reembolso por fallo del envío de la campaña '{}'".format(campaign_name))
    except Exception as e:
        print('No se pudo reembolsar el saldo debitado: {}'.format(e))


def release_real_send_lock(st, previous_state):
    """Revierte la campaña de 'Enviando' a su estado previo (libera el lock que tomó
    try_start_real_send). Se usa cuando, tras tomar el lock, el envío NO procede (p. ej.
    saldo insuficiente), para que la campaña vuelva a ser enviable. Condicional a que
    todavía seamos los dueños del lock (no pisar un envío concurrente). El sendProcessId
    queda apuntando a un proceso que no se creó; se sobreescribe en el próximo intento."""
    try:
        table_campaign.update_item(
            Key={'campaignId': st.campaign_id},
            UpdateExpression='SET campaignState = :prev',
            ConditionExpression='campaignState = :sending AND sendProcessId = :pid',
            ExpressionAttributeValues={
                ':prev': previous_state, ':sending': 'Enviando', ':pid': st.process_id},
        )
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    except Exception as e:
        print('No se pudo liberar el lock de envío: {}'.format(e))


# Estados desde los que se PUEDE iniciar un envío real (compare-and-set atómico).
REAL_SEND_ALLOWED_STATES = ('Pendiente', 'Muestras', 'Error')


def insert_process(st:'ProcessState',campaign_name:str,user_id:str,registers_on_spool:int,registers_to_send:int,quantity_blacklist:int,quantity_unsubscribe:int,quantity_deletions:int,parts:int,template_version:int,state:str,charged_amount:int=0)->None:
    """
    Esta función inserta los datos del proceso completo, con sus cantidades.

    Args:
        st (ProcessState): Estado de la invocación (process_id, customer_name, campaign_id, fecha)
        campaign_name (str): En el campo proceso se inserta el nombre de la campaña
        user_id (str): Identificador unico del usuario
        registers_on_spool (int): Cantidad de registros que llegaron en la BD del cliente
        registers_to_send (int): Cantidad de registros a enviar, descontando los errores, lista negra y desinscritos
        quantity_blacklist (int): Cantidad de registros encontrados en la lista negra del cliente
        quantity_unsubscribe (int): Cantidad de registros encontrados en la lista de desinscritos
        quantity_deletions (int): Cantidad de registros con estructura de email incorrecta
        parts (int): Cantidad de partes a enviar (Dividiendo el total de registros a enviar en paquetes de 500 para EM y EAU, y en paquetes de 100 para EAP)
        template_version (int): Version del template que se va a enviar
        state (str): Estado del envio, inicialmente "Procesando"

    Returns:
        None: No retorna resultados
    """
    # Insertar datos en la tabla de campañas
    table_process.put_item(
        Item={
            'processId': st.process_id,
            'customerName': st.customer_name,
            # NIT del cliente: permite a los lectores (p. ej. Admin/Jobs) construir la llave
            # de las tablas por cliente ({tenant_key(nit)}_sendStatus) sin re-mapear el nombre.
            'companyTin': str(st.nit or ''),
            'campaignName': campaign_name,
            'campaignId': st.campaign_id,
            'userId': user_id,
            'registersOnSpool': registers_on_spool,
            'registersToSend': registers_to_send,
            'quantityBlacklist': quantity_blacklist,
            'quantityUnsubscribe': quantity_unsubscribe,
            'quantityDeletions': quantity_deletions,
            'parts': parts,
            'templateVersion': template_version,
            'date': st.formatted_date,
            'processState': state,
            # ¿Es un proceso de MUESTRAS (envío de prueba)? st.is_samples ya viene True desde
            # preparar_muestras y False en el envío real. Los reportes/estadísticas/facturación
            # EXCLUYEN los procesos de muestra (el mercado no cuenta las pruebas y el monedero
            # no las cobra). Marca explícita para no depender de interpretar processState/nombre.
            'isSamples': bool(st.is_samples),
            # Monto debitado del saldo por este envío (0 en muestras). Sirve para la
            # conciliación fina (fase posterior) y para el reembolso si aplica.
            'chargedAmount': charged_amount,
        }
    )

def update_campaign_status(st:'ProcessState',state:str)->None:
    """
    Esta función realiza la actualizacion del estado de la campaña.

    Args:
        st (ProcessState): Estado de la invocación (campaign_id)
        state (str): Estado de la campaña

    Returns:
        None: No retorna resultados
    """
    response_update_campaign_status = table_campaign.update_item(
        Key={'campaignId':st.campaign_id},
        UpdateExpression='SET campaignState = :s',
        ExpressionAttributeValues={':s': state},
        ReturnValues='UPDATED_NEW'
    )
    print(response_update_campaign_status['Attributes'])


def try_start_real_send(st:'ProcessState',process_id_value:str)->bool:
    """IDEMPOTENCIA del envío real. Transición ATÓMICA de la campaña a 'Enviando' SOLO si su
    estado actual permite iniciar el envío (Pendiente/Muestras/Error), y guarda el processId
    ganador en `sendProcessId`.

    Devuelve True si ESTA invocación ganó el lock; False si otra ya lo tomó (reintento de
    Lambda/API Gateway, doble clic o envío concurrente) → NO se debe re-encolar. Cierra la
    ventana de carrera entre leer el estado y marcarlo 'Enviando'."""
    try:
        table_campaign.update_item(
            Key={'campaignId': st.campaign_id},
            UpdateExpression='SET campaignState = :sending, sendProcessId = :pid',
            ConditionExpression='campaignState IN (:s1, :s2, :s3)',
            ExpressionAttributeValues={
                ':sending': 'Enviando',
                ':pid': process_id_value,
                ':s1': REAL_SEND_ALLOWED_STATES[0],
                ':s2': REAL_SEND_ALLOWED_STATES[1],
                ':s3': REAL_SEND_ALLOWED_STATES[2],
            }
        )
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise

def select_campaign(campaign_name:str, customer_id:str=None)->dict:
    """
    Esta función obtiene los datos de la campaña.

    Args:
        campaign_name (str): Nombre de la campana
        customer_id (str): Si se indica, la campaña DEBE pertenecer a este cliente
            (aislamiento multi-tenant): se filtra por customerId además del nombre. Así un
            tenant no puede disparar/cobrar la campaña de OTRO cliente, ni se resuelve por
            accidente una campaña HOMÓNIMA de otro cliente (el scan por solo-nombre devolvía
            un Items[0] arbitrario). Si es None (rollout/legado sin el context del Authorizer),
            se busca solo por nombre (comportamiento previo).

    Returns:
        dict: Nombre de la campaña
    """
    projection_campaign_expression = 'campaignId, customerId, consecutive, channel, dataPath, campaignState, originEmail, template, messageTemplateId, samplesSentCount, documentFormat, attachmentType, approvalStatus'  # Lista de campos a consultar

    if customer_id:
        response_campaign = table_campaign.scan(
            FilterExpression="campaignName = :value AND customerId = :cid",
            ExpressionAttributeValues={":value": campaign_name, ":cid": customer_id},
            ProjectionExpression=projection_campaign_expression
        )
    else:
        response_campaign = table_campaign.scan(
            FilterExpression="campaignName = :value",
            ExpressionAttributeValues={":value": campaign_name},
            ProjectionExpression=projection_campaign_expression
        )
    return response_campaign


def resolve_live_message_content(message_template_id, customer_id, channel):
    """Contenido EN VIVO de la plantilla de mensaje (SMS/WSP) referenciada por la campaña.

    La campaña de SMS/WSP guarda una REFERENCIA (`messageTemplateId`) a la plantilla, no solo
    una copia del texto. Así, si el cliente edita la plantilla DESPUÉS de crear la campaña, el
    envío usa el texto/HSM ACTUALIZADO (igual que el email, que referencia la plantilla SES por
    nombre). Devuelve el `body` (SMS) o el `hsmName` (WSP) vigente, o None si no se puede
    resolver — el llamador cae entonces al respaldo `campaign.template` (snapshot).

    Fail-safe: cualquier problema (sin id, plantilla borrada, de otro tenant, error de DynamoDB)
    devuelve None y NO rompe el envío.
    """
    if not message_template_id:
        return None
    try:
        item = table_message_template.get_item(
            Key={'messageTemplateId': message_template_id}).get('Item')
    except Exception as e:
        print('No se pudo resolver la plantilla de mensaje en vivo (se usa el snapshot): {}'.format(e))
        return None
    if not item:
        return None
    # Aislamiento multi-tenant: si la plantilla es de otro cliente, ignorarla (usar snapshot).
    if customer_id and item.get('customerId') and item.get('customerId') != customer_id:
        print('La plantilla {} no pertenece al cliente de la campaña; se usa el snapshot.'.format(message_template_id))
        return None
    if channel == 'SMS':
        body = str(item.get('body', '') or '')
        return body if body.strip() else None
    if channel == 'WSP':
        hsm = str(item.get('hsmName', '') or '')
        return hsm if hsm.strip() else None
    return None


def increment_samples_count(st:'ProcessState')->int:
    """Suma 1 (atómico) al contador de envíos de muestras de la campaña actual y
    devuelve el nuevo valor."""
    response = table_campaign.update_item(
        Key={'campaignId': st.campaign_id},
        UpdateExpression='SET samplesSentCount = if_not_exists(samplesSentCount, :zero) + :one',
        ExpressionAttributeValues={':one': 1, ':zero': 0},
        ReturnValues='UPDATED_NEW'
    )
    return int(response['Attributes'].get('samplesSentCount', 0))


def record_sample_batch(st:'ProcessState', data:dict, event)->None:
    """Registra en la campaña el envío de muestras (historial para el aprobador; ver
    PLAN_APROBACIONES.md). Best-effort: nunca rompe el envío de muestras. Guarda quién
    envió, a quién y de qué tipo, en la lista `sampleBatches`."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        recipients = [str(r) for r in (data.get('recipients') or [])]
        batch = {
            'batchId': str(uuid.uuid4()),
            'tipo': 'selectivas' if data.get('selectiveSamples') else 'aleatorias',
            'recipients': recipients,
            'quantity': len(recipients),
            'sentBy': str(auth.get('userId') or data.get('userId') or ''),
            'sentByName': str(auth.get('user') or ''),
            'sentAt': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        }
        table_campaign.update_item(
            Key={'campaignId': st.campaign_id},
            UpdateExpression='SET sampleBatches = list_append(if_not_exists(sampleBatches, :empty), :b)',
            ExpressionAttributeValues={':empty': [], ':b': [batch]})
    except Exception as e:
        print('No se pudo registrar el lote de muestras (se continúa): {}'.format(e))


def is_real_send_enabled(customer_id_value:str)->bool:
    """¿El cliente tiene habilitados los envíos reales? Lee el campo realSendEnabled
    de la tabla customer. Si falta el campo (clientes antiguos) se asume HABILITADO
    (fail-open, para no bloquear a nadie por una migración pendiente)."""
    try:
        # customerId es la PK de `customer` → GetItem O(1) (antes Scan+filter, que además
        # podía no ver el ítem si la tabla superaba 1 MB sin paginar).
        item = table_customer.get_item(
            Key={'customerId': customer_id_value},
            ProjectionExpression='realSendEnabled').get('Item')
        if item:
            return bool(item.get('realSendEnabled', True))
    except Exception as e:
        print("No se pudo verificar realSendEnabled ({}); se asume habilitado".format(e))
    return True


def get_customer_nit(customer_id_value:str):
    """Devuelve el NIT (companyTin) del cliente para construir el bucket S3 por NIT.
    Si no se encuentra, devuelve None y las lecturas caen al bucket viejo por nombre."""
    try:
        # customerId es la PK de `customer` → GetItem O(1) (antes Scan+filter).
        item = table_customer.get_item(
            Key={'customerId': customer_id_value},
            ProjectionExpression='companyTin').get('Item')
        if item:
            return item.get('companyTin')
    except Exception as e:
        print("No se pudo obtener el NIT del cliente ({})".format(e))
    return None


def download_base_csv(nit, customer_name, data_path, temp_file):
    """Descarga el CSV de la base intentando primero el bucket por NIT y, si falla,
    el bucket viejo por nombre (migración sin romper datos existentes)."""
    candidates = []
    if nit:
        candidates.append(tenant_bucket(nit, 'database'))
    candidates.append('{}.database'.format(customer_name.lower()))  # legacy por nombre
    last_error = None
    for bucket in candidates:
        try:
            s3.download_file(bucket, data_path, temp_file)
            print("Base descargada de {}".format(bucket))
            return bucket
        except Exception as e:
            last_error = e
            print("No se pudo descargar de {} ({})".format(bucket, e))
    raise last_error if last_error else Exception("No se pudo descargar la base")

def build_ctx(st:'ProcessState')->dict:
    """Arma el contexto del envío (los campos que van en cada mensaje SQS) a partir del
    estado `st` de la invocación. Las funciones puras de abajo reciben `ctx` y no leen
    ningún estado global."""
    return {
        "customerId": st.customer_id,
        "customerName": st.customer_name,
        "processId": st.process_id,
        "campaignId": st.campaign_id,
        "attachment": st.attachment,
        "fromEmail": st.from_email,
        "headers": st.headers,
        "templateName": st.template_name,
        "channel": st.channel,           # EM/EAU/EAP/SMS/WSP/VOZ → tipo de contacto en el worker
        "smsBody": st.sms_body,          # texto SMS (solo canal SMS)
        "wspTemplate": st.wsp_template,  # nombre HSM (solo canal WSP)
        "voiceMessage": st.voice_message,  # texto TTS (solo canal VOZ)
        "nit": st.nit,                   # NIT → bucket S3 en las lambdas de envío (.document)
        "samples": bool(st.is_samples),  # True → el worker cuenta el envío de muestra OK (por campaignId)
    }


def prepare_message(ctx:dict, data:list, part:int)-> str:
    """Crea el JSON de UN mensaje SQS a partir del contexto `ctx` (ver build_ctx) + los
    registros `data` de ese lote y el número de parte. Función PURA (no lee globals),
    testeable de forma aislada."""
    body = dict(ctx)  # copia de los campos comunes del envío
    body["part"] = part
    body["data"] = data
    return json.dumps(body)


def classify_and_enqueue(ctx:dict, registers_correct:list, blacklist_emails:set,
                         unsubscribes_emails:set, registers_for_message:int,
                         url_sqs:str, send_fn=None, part_offset:int=0):
    """Núcleo del envío real (extraído del handler para poder testearlo). Clasifica los
    registros con estructura válida en (lista negra / desuscritos / a enviar), agrupa los
    'a enviar' en lotes de `registers_for_message` y los ENCOLA en SQS.

    Devuelve (registers_blacklist, registers_unsubscribe, enqueued, parts):
      - registers_blacklist / registers_unsubscribe: filas filtradas (para registrar su estado).
      - enqueued: cantidad realmente encolada.
      - parts: número de mensajes SQS generados.
    `send_fn` permite inyectar un doble en las pruebas (por defecto send_sqs real).
    `part_offset` desplaza la numeración de las partes: en el fan-out (Fase 4) cada part-file
    aporta varios lotes al canal y el número de parte debe ser ÚNICO en todo el proceso (la
    lambda de envío deduplica por (processId, part)); se pasa `part_offset = part * PART_SIZE`."""
    if send_fn is None:
        send_fn = send_sqs
    registers_blacklist = []
    registers_unsubscribe = []
    batch = []
    count_register = 0
    parts = 0
    enqueued = 0
    for line in registers_correct:
        email = line[1]
        if email in blacklist_emails:
            registers_blacklist.append(line)
        elif email in unsubscribes_emails:
            registers_unsubscribe.append(line)
        else:
            batch.append(line)
            enqueued += 1
            count_register += 1
            if count_register == registers_for_message:
                parts += 1
                count_register = 0
                send_fn(url_sqs, prepare_message(ctx, batch, part_offset + parts))
                batch = []
    # Último lote incompleto.
    if batch:
        parts += 1
        send_fn(url_sqs, prepare_message(ctx, batch, part_offset + parts))
    return registers_blacklist, registers_unsubscribe, enqueued, parts

def send_sqs_batch(url_sqs:str,messages:list)->None:
    """
    Esta función realiza el envio a las colas de SQS.

    Args:
        url_sqs (str): Url de la cola SQS en AWS
        messages (list): Lista con los mensajes (Maximo 10)

    Returns:
        dict: Nombre de la campaña
    """
    print("Url: " + url_sqs)
    # OJO: antes esta función atrapaba la excepción y solo hacía print → si el encolado
    # fallaba, la campaña quedaba "Enviando"/"Procesando" pero los mensajes NO salían y
    # nadie se enteraba. Ahora el error se PROPAGA para que el bloque que llama marque la
    # campaña en Error.
    response = sqs.send_message_batch(QueueUrl=url_sqs, Entries=messages)
    print(response)
    print("Mensaje enviado")

def send_sqs(url_sqs:str,message:list)->None:
    """
    Esta función realiza el envio a las colas de SQS.

    Args:
        url_sqs (str): Url de la cola SQS en AWS
        messages (list): Lista con los mensajes (Maximo 10)

    Returns:
        dict: Nombre de la campaña
    """

    # Igual que send_sqs_batch: el error se PROPAGA (antes se tragaba con un print) para
    # que el bloque que llama marque la campaña en Error si no se pudo encolar.
    response = sqs.send_message(QueueUrl=url_sqs, MessageBody=message)
    print(response)

def wait_tables_active(table_names)->None:
    """Espera a que las tablas por cliente estén ACTIVE antes de encolar los mensajes. En
    el PRIMER envío de un cliente, sus tablas ({tenant}_processDetail, _sendDetail,
    _sendStatus, …) se acaban de crear y DynamoDB las deja en CREATING unos segundos; si el
    worker (Send-*) las lee antes, falla con ResourceNotFoundException. El waiter matchea
    TableStatus == ACTIVE. Best-effort: nunca interrumpe el flujo."""
    client = dynamodb.meta.client
    for name in table_names:
        try:
            client.get_waiter('table_exists').wait(
                TableName=name, WaiterConfig={'Delay': 2, 'MaxAttempts': 30})
        except Exception as e:
            print('No se pudo esperar a que la tabla {} esté ACTIVE: {}'.format(name, e))


def check_and_create_table(table_name:str, id:str)->bool:
    """
    Esta función intenta crear una tabla en dynamo, si la puede crear retorna True, si no la crea retorna False.

    Args:
        table_name (str): Nombre de la tabla que se va a crear
        id (str): Id de la tabla a crear

    Returns:
        bool: Si puede crear la tabla retorna True, si no la crea retorna False
    """
    was_created = False
    key_schema = [
        {
            'AttributeName': id,
            'KeyType': 'HASH'
        }
    ]
    attribute_definitions = [
        {
            'AttributeName': id,
            'AttributeType': 'S'
        }
    ]
    try:
        #Intenta crear la tabla
        table = dynamodb.create_table(
            TableName=table_name,
            KeySchema=key_schema,
            AttributeDefinitions=attribute_definitions,
            BillingMode='PAY_PER_REQUEST'  #Configurar capacidad bajo demanda
        )
        print(f"La tabla '{table_name}' ha sido creada con éxito.")
        was_created = True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceInUseException':
            print(f"La tabla '{table_name}' ya existe.")
        else:
            print("Error al crear la tabla:", e)
    return was_created


def ensure_status_table(tenant:str)->str:
    """Crea (si no existe) la tabla ÚNICA de estados del cliente {tenant}_sendStatus con
    llave compuesta PK 'processId' + SK 'sendStatusId', y devuelve su nombre. `tenant` es la
    llave por NIT (tenant_key), no el nombre de empresa.

    Reemplaza al anti-patrón de una tabla por proceso ({tenant}_sendStatus_{uuid}): ahora
    hay UNA tabla por cliente y cada proceso es una partición (query por processId)."""
    table_name = f'{tenant}_sendStatus'
    try:
        dynamodb.create_table(
            TableName=table_name,
            KeySchema=[
                {'AttributeName': 'processId', 'KeyType': 'HASH'},
                {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'},
            ],
            AttributeDefinitions=[
                {'AttributeName': 'processId', 'AttributeType': 'S'},
                {'AttributeName': 'sendStatusId', 'AttributeType': 'S'},
            ],
            BillingMode='PAY_PER_REQUEST')
        print(f"La tabla '{table_name}' ha sido creada con éxito.")
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceInUseException':
            print(f"La tabla '{table_name}' ya existe.")
        else:
            print("Error al crear la tabla de estados:", e)
    return table_name


def ensure_detail_table(tenant:str)->str:
    """Crea (si no existe) la tabla ÚNICA de DETALLE del cliente {tenant}_sendDetail con
    llave compuesta PK 'processId' + SK 'sendDetailId'. Reemplaza el anti-patrón de una tabla
    por proceso ({tenant}_sendDetail_{uuid}) → una sola tabla por cliente (query por
    processId), consistente con {tenant}_sendStatus. `tenant` es la llave por NIT (tenant_key)."""
    table_name = f'{tenant}_sendDetail'
    try:
        dynamodb.create_table(
            TableName=table_name,
            KeySchema=[
                {'AttributeName': 'processId', 'KeyType': 'HASH'},
                {'AttributeName': 'sendDetailId', 'KeyType': 'RANGE'},
            ],
            AttributeDefinitions=[
                {'AttributeName': 'processId', 'AttributeType': 'S'},
                {'AttributeName': 'sendDetailId', 'AttributeType': 'S'},
            ],
            BillingMode='PAY_PER_REQUEST')
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceInUseException':
            print("Error al crear la tabla de detalle:", e)
    return table_name


def ensure_summary_tables(tenant:str)->None:
    """Crea (si no existen) las tablas de PRE-AGREGACIÓN del cliente para que los reportes
    lean O(1): {tenant}_sendSummary (PK processId, contadores del embudo) y
    {tenant}_sendState (PK processId + SK messageId, estado actual por mensaje). Las llena
    ReceptionStatus (bump_send_summary) al llegar cada evento. Best-effort: si no se pueden
    crear, la recepción sigue y los reportes caen al scan por proceso. `tenant` = tenant_key(NIT)."""
    for name, schema, attrs in (
        (f'{tenant}_sendSummary',
         [{'AttributeName': 'processId', 'KeyType': 'HASH'}],
         [{'AttributeName': 'processId', 'AttributeType': 'S'}]),
        (f'{tenant}_sendState',
         [{'AttributeName': 'processId', 'KeyType': 'HASH'},
          {'AttributeName': 'messageId', 'KeyType': 'RANGE'}],
         [{'AttributeName': 'processId', 'AttributeType': 'S'},
          {'AttributeName': 'messageId', 'AttributeType': 'S'}]),
    ):
        try:
            dynamodb.create_table(TableName=name, KeySchema=schema,
                                  AttributeDefinitions=attrs, BillingMode='PAY_PER_REQUEST')
        except ClientError as e:
            if e.response['Error']['Code'] != 'ResourceInUseException':
                print(f"No se pudo crear '{name}':", e)


def _batch_get_emails(table_name:str, keys:list)->set:
    """
    Consulta por lotes qué emails de `keys` existen en la tabla `table_name`
    (cuya PK debe ser 'email'). BatchGetItem admite máximo 100 llaves y no
    acepta duplicados, así que se deduplica y se trocea. Si la tabla no existe
    o su esquema no coincide (tablas viejas con otra PK), devuelve vacío y
    registra el error en lugar de tumbar el envío.

    Args:
        table_name (str): Nombre de la tabla (PK 'email')
        keys (list): Lista de llaves [{'email': ...}]

    Returns:
        set: Emails encontrados en la tabla
    """
    found = set()
    unique_keys = list({k['email']: k for k in keys}.values())
    try:
        for start in range(0, len(unique_keys), 100):
            chunk = unique_keys[start:start + 100]
            request_items = {table_name: {'Keys': chunk, 'ProjectionExpression': 'email'}}
            while request_items:
                response = dynamodb.batch_get_item(RequestItems=request_items)
                for item in response.get('Responses', {}).get(table_name, []):
                    found.add(item['email'])
                # Reintentar las llaves que DynamoDB no alcanzó a procesar.
                request_items = response.get('UnprocessedKeys') or None
    except Exception as e:
        print(f'No se pudo consultar la tabla {table_name} (se continúa sin filtrar): {e}')
        return set()
    return found

def check_blacklist(tenant:str, keys:list)->set:
    """
    Consulta los email en la lista negra del cliente. La tabla
    '{tenant}_blackList' se crea con PK 'email' (ReceptionStatus escribe
    compatible porque su Item incluye 'email'). Tablas viejas con PK
    'blackListId' devuelven vacío sin interrumpir el envío. `tenant` = tenant_key(NIT).
    """
    return _batch_get_emails(f'{tenant}_blackList', keys)

def check_unsubscribes(tenant:str, keys:list)->set:
    """
    Consulta los email desuscritos del cliente. La tabla '{tenant}_unsubscribe'
    se crea con PK 'email' (igual que la escribe la lambda Unsubscribe). `tenant` = tenant_key(NIT).
    """
    return _batch_get_emails(f'{tenant}_unsubscribe', keys)

def insert_mails_status(st:'ProcessState',emails:list,state:str,description:str,id_prefix:str=None)->None:
    """
    Función encargada de insertar los detalles de cada envio a la base de datos con su respectivo estado. Aplica solo para desinscritos y lista negra

    Args:
        st (ProcessState): Estado de la invocación (process_id, customer_name, fecha)
        emails (list): Lista con los email de lista negra o desinscritos que se van a insertar a la base de datos
        state (str): Estado 12 (Desinscrito) o 13 (Lista negra)
        description (str): Descripcion de cualquiera de los dos estados
        id_prefix (str): Prefijo para IDs DETERMINISTAS (fan-out Fase 4). Con él, reprocesar
            una parte SOBRESCRIBE las mismas filas (put idempotente) en vez de duplicarlas.
            Sin él (None) se usa un uuid aleatorio (comportamiento legacy).

    Returns:
        None: No retorna resultados
    """
    start_time = time.time()
    data_to_insert_send_detail = []
    data_to_insert_send_status = []
    # Define los datos que deseas insertar
    for idx, register in enumerate(emails):
        id = f'{id_prefix}-{idx}' if id_prefix else str(uuid.uuid4())

        unique_id = register[0]
        email = register[1]

        #Data para insertar en los datos de envios. processId = PK (tabla única
        #{customer}_sendDetail, PK processId + SK sendDetailId).
        data_to_insert_send_detail.append({
            'processId': st.process_id,
            'sendDetailId': id,
            'processDetailId': id,
            'uniqueId': unique_id,
            'email': email,
            'data': register,
            'date': st.formatted_date
        })

        #Data para insertar en los estados. processId = PK (tabla única {customer}_sendStatus).
        data_to_insert_send_status.append({
            'processId': st.process_id,
            'sendStatusId': id,
            'sendDetailId': id,
            'date': st.formatted_date,
            'state': state,
            'type1': description,
            'type2': description
        })

    # Tabla ÚNICA de detalle del cliente (antes: una por proceso {tenant}_sendDetail_{uuid}).
    table_name_details = f'{st.tenant}_sendDetail'
    table_details = dynamodb.Table(table_name_details)

    #Almacena en bufer la data para hacer el insert por batch y maneja internamente los reintentos de elementos no procesados
    with table_details.batch_writer() as batch:
        for item in data_to_insert_send_detail:
            batch.put_item(Item=item)

    # Tabla ÚNICA de estados del cliente (antes: una por proceso).
    table_status = dynamodb.Table(f'{st.tenant}_sendStatus')
    with table_status.batch_writer() as batch:
        for item in data_to_insert_send_status:
            batch.put_item(Item=item)
    end_time = time.time()
    tiempo = (end_time - start_time) * 1000
    print(f"{tiempo:.2f} milisegundos")

def upload_s3(bucket_name:str,object_key:str,data:any) ->None:
    try:
        list_string = str(data)
        file_content_bytes = bytes(list_string, 'utf-8')
        response = s3.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=bytes(file_content_bytes)
        )
        print(f"File '{object_key}' uploaded successfully to bucket '{bucket_name}'.")
    except Exception as e:
        print(f"Error uploading file: {e}")

def validate_csv():
    pass


def preparar_muestras(st, data, response_campaign, user_id, template_version,
                      temp_file, delimiter, url_sqs):
    """Rama de ENVÍO DE MUESTRAS (correos de prueba). Reemplaza el correo real de los
    primeros registros (o de las identificaciones seleccionadas) por los correos de
    prueba y los encola. No toca la base real ni marca la campaña como 'Enviando'.

    Devuelve (status, status_code, description). El estado `st` lleva todo el contexto
    de la invocación (antes eran globals)."""
    status = True
    status_code = 200
    description = "Campaña enviandose correctamente"

    registers = []
    count_register = 0

    print("Inica proceso de envio de muestras")
    st.is_samples = True  # el worker (Send-*) contará el envío de muestra SOLO si sale bien
    process = data["campaignName"] + "-Samples"
    quantity_samples = data['quantitySamples']
    print("Cantidad  muestras en el payload: " + str(quantity_samples))
    selective_samples = data.get('selectiveSamples', False)
    recipients = data["recipients"]
    print(f"Destinatarios de muestras: {recipients}")
    # Validar los destinatarios SEGÚN EL CANAL: correo (EM/EAU/EAP) o celular E.164
    # (SMS/WSP/VOZ). Antes se validaban SIEMPRE como correo, por lo que un celular como
    # "3502452219" era rechazado ("emails con error"). Los celulares se normalizan a E.164
    # (`+57...`) para que las lambdas de envío (que exigen E.164) los acepten.
    quantity_recipients = len(recipients)
    invalid_mail = False
    invalid_mails = ""

    registers_to_send = 0
    quantity_blacklist = 0
    quantity_unsubscribe = 0
    quantity_deletions = 0
    normalized_recipients = []
    for recipient in recipients:
        ok, value = valid_contact(st.channel, recipient)
        if not ok:
            invalid_mail = True
            invalid_mails += (", " if invalid_mails else "") + str(recipient)
        normalized_recipients.append(value)
    recipients = normalized_recipients  # celulares ya en E.164; correos sin cambios

    # Límite de envíos de muestras por campaña (acumulado). Cada operación de muestras
    # cuenta 1; al llegar a MAX_SAMPLE_SENDS se bloquea (evita abuso/costos con envíos
    # de prueba repetidos).
    samples_sent_before = int(response_campaign['Items'][0].get('samplesSentCount', 0))
    limit_reached = samples_sent_before >= MAX_SAMPLE_SENDS
    print(f"Muestras enviadas antes: {samples_sent_before}/{MAX_SAMPLE_SENDS}")

    if limit_reached:
        description = (f'Se alcanzó el máximo de {MAX_SAMPLE_SENDS} envíos de '
                       f'muestras para esta campaña. Aprueba y envía la campaña '
                       f'real o crea una nueva campaña.')
        status = False
        print(description)
        status_code = 429
        return status, status_code, description

    if invalid_mail:
        tipo = 'celulares' if is_phone_channel(st.channel) else 'emails'
        description = f'Error en los destinatarios enviados para las muestras, {tipo} con error: {invalid_mails}'
        status = False
        print(description)
        status_code = 400
        return status, status_code, description

    print("Todos los destinatarios de muestras son validos")
    if selective_samples:
        print("Proceso con muestras selectivas")
        #En el proceso de muestras selectivas solo se van a enviar la cantidad de registros que se encuentren en el spool del cliente
        #No se realizara el proceso de completar la cantidad de muestras
        try:
            # Las identificaciones llegan del front como texto; el spool trae line[0]
            # numérico. Normalizamos ambos a texto (sin espacios) para que la comparación
            # haga match (antes int == str nunca coincidía y no se enviaba nada).
            sample_identifications = set(str(i).strip() for i in data["identifications"])
            index_recipient = 0
            samples_count = 0
            print(f"Identificaciones para las muestras: {sample_identifications}")

            print('Inicio lectura del archivo para filtrar los registros de muestras selectivas y reemplazar el email real con el de muestras')
            with open(temp_file, 'r', encoding=ENCODING) as file:
                print("Apertura correcta del archivo Csv")
                # Delimitador detectado (no se asume ';')
                reader = csv.reader(file, delimiter=delimiter)
                print("Lectura correcta del archivo como Csv")
                st.headers = next(reader)  # primer linea = encabezado
                print("Headers: " + str(st.headers))
                for line in reader:
                    #Reviso si ya asigne la cantidad total de muestras para no seguir recorriendo las lineas
                    if samples_count == quantity_samples:
                        print("Salgo del bucle porque ya encontre todas las muestras solicitadas")
                        break
                    id = str(line[0]).strip()
                    for identification in sample_identifications:
                        if id == identification:
                            samples_count += 1
                            print("Muestra selectiva encontrada en la base de datos del cliente")
                            #Reemplazar email real
                            if index_recipient == quantity_recipients:
                                index_recipient = 0
                            #Reemplazar el email real por el email de muestras
                            new_email = recipients[index_recipient]
                            real_email = line[1]
                            print(f'Reemplazando el email "{real_email}" por el email "{new_email}"')
                            line[1] = new_email
                            registers.append(line)
                            index_recipient += 1
                            break

            registers_to_send = samples_count
        except Exception as e:
            print(e)
            update_campaign_status(st, "Error")
            description = 'Error en el filtrado de los registros desde la base de datos original'
            status = False
            print(description)
            status_code = 400
        else:
            print('Los filtros de registros se realizaron de manera correcta')
            samples_found = len(registers)
            if samples_found > 0:
                print("Se procede a realizar los envios a la cola")
                messages = prepare_message(build_ctx(st), registers, 1)
                send_sqs(url_sqs, messages)
            else:
                print(f'No se encontro ningura de las cedulas "{sample_identifications}" en el spool de envios')
    else:
        print("Proceso con muestras automaticas")
        try:
            #Se realiza el envio de la cantidad de email indicados con la data de los primeros registros de la BD
            index_recipient = 0
            print('Inicio lectura del archivo para tomar los primeros registros y reemplazar el email real con el de muestras')
            with open(temp_file, 'r', encoding=ENCODING) as file:
                print("Apertura correcta del archivo Csv")
                reader = csv.reader(file, delimiter=delimiter)
                print("Lectura correcta del archivo como Csv")
                st.headers = next(reader)  # primer linea = encabezado
                print("Headers: " + str(st.headers))
                for line in reader:
                    print("Registro a procesar: " + str(line))
                    #Reinicio el indice de los recipient para cuando la cantidad de muestras es mayor a los email enviados en la lista
                    if index_recipient == quantity_recipients:
                        index_recipient = 0
                    #Reemplazar el email real por el email de muestras
                    print(recipients)
                    new_email = recipients[index_recipient]
                    print(f"Line: {line}")
                    real_email = line[1]
                    print(f'Reemplazando el email "{real_email}" por el email "{new_email}"')
                    line[1] = new_email
                    registers.append(line)
                    count_register += 1
                    index_recipient += 1
                    if count_register == quantity_samples:
                        print("Preparar mensaje para enviar")
                        messages = prepare_message(build_ctx(st), registers, 1)
                        send_sqs(url_sqs, messages)
                        registers = []
                        break
            #Valido si hay registros, es decir que la BD original no contenia los suficientes registros para las muestras
            if registers:
                print("La cantidad de muestras solicitada es mayor a la data que se encuentra en la BD")
                messages = prepare_message(build_ctx(st), registers, 1)
                send_sqs(url_sqs, messages)

            # Elimina el archivo temporal descargado
            os.remove(temp_file)
            print("Se elimino el archivo temporal")
            registers_to_send = len(registers)
            print("Se asigno nuevamente la cantidad de registros a enviar")
        except:
            update_campaign_status(st, "Error")
            description = 'Error en el proceso de muestras automaticas'
            status = False
            print(description)
            status_code = 400

    insert_process(st, process, user_id, registers_to_send, registers_to_send, quantity_blacklist, quantity_unsubscribe, quantity_deletions, 1, template_version, "Muestras")
    print("Finaliza insercion en la tabla de procesos")
    update_campaign_status(st, "Muestras")
    print("Finaliza actualizacion de la tabla de estado de la campaña")
    # El contador de muestras (campaign.samplesSentCount) YA NO se incrementa aquí: se
    # cuenta en la lambda de ENVÍO (Send-batch-*) SOLO cuando el envío sale bien, para que
    # una muestra que se prepara pero no se entrega no consuma el cupo. El mensaje SQS lleva
    # `samples: True` (ver build_ctx / st.is_samples) para que el worker sepa contarlo.

    return status, status_code, description


def registers_for_channel(channel_name:str)->int:
    """Tamaño de lote (destinatarios por mensaje SQS al canal) según el canal."""
    return {
        "EM": REGISTERS_FOR_EM, "EAU": REGISTERS_FOR_EAU, "EAP": REGISTERS_FOR_EAP,
        "SMS": REGISTERS_FOR_SMS, "WSP": REGISTERS_FOR_WSP, "VOZ": REGISTERS_FOR_VOICE,
    }.get(channel_name, REGISTERS_FOR_EM)


def upload_part_file(bucket_name:str, process_id:str, part:int, rows:list)->str:
    """Sube UN part-file (trozo del CSV) a S3 como JSON (lista de filas) y devuelve su key.
    Serializar como JSON evita re-parsear CSV (delimitadores/comillas) en el worker."""
    key = f'_parts/{process_id}/{part}.json'
    s3.put_object(Bucket=bucket_name, Key=key, Body=json.dumps(rows).encode('utf-8'))
    return key


def enqueue_part_job(st, part:int, part_key:str, bucket_name:str, channel_queue:str,
                     registers_for_message:int, unsubscribe_existed:bool,
                     blacklist_existed:bool)->None:
    """Encola UN trabajo de parte en la cola de partes (URL_SQS_PREPARE_PART). El worker
    (esta misma lambda, disparada por SQS) descarga el part-file y lo procesa."""
    job = dict(build_ctx(st))  # campos comunes del envío (customerId, processId, headers, …)
    job.update({
        "prepareJob": True,
        "part": part,
        "partKey": part_key,
        "bucket": bucket_name,
        "channelQueue": channel_queue,
        "registersForMessage": registers_for_message,
        "unsubscribeExisted": unsubscribe_existed,
        "blacklistExisted": blacklist_existed,
    })
    send_sqs(URL_SQS_PREPARE_PART, json.dumps(job))


# Columna del CONTACTO en el CSV (por posición): line[1] = correo (EMAIL) o celular
# (SMS/WhatsApp/Voz). Es la clave para deduplicar contactos repetidos.
CONTACT_COL = 1

# Canales cuyo contacto (columna 2 del CSV) es un CELULAR (E.164), no un correo.
PHONE_CHANNELS = ('SMS', 'WSP', 'VOZ')
# Patrón de correo (estructura del email). Se usa para validar el contacto de los canales
# de EMAIL, tanto en las muestras como en el envío real (procesar_parte).
PATRON_EMAIL = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$'


def is_phone_channel(channel):
    """¿El canal usa CELULAR como contacto (SMS/WhatsApp/Voz)?"""
    return str(channel or '').upper() in PHONE_CHANNELS


def normalize_phone(raw):
    """Normaliza un celular a formato E.164 (`+57...`). Colombia (+57) por defecto cuando el
    número viene sin indicativo, igual que el front (`csv.ts` usa libphonenumber con
    DEFAULT_COUNTRY='CO', que acepta E.164 o el celular local colombiano de 10 dígitos). Las
    lambdas de envío (SMS/Voz → DestinationPhoneNumber; WhatsApp → `to`) EXIGEN E.164, así que
    un local `3502452219` debe convertirse a `+573502452219`. Devuelve el E.164 o '' si no es
    un celular con longitud/estructura plausible."""
    if raw is None:
        return ''
    p = re.sub(r'[\s()\-.]', '', str(raw))
    if not p:
        return ''
    if p.startswith('00'):            # prefijo de salida internacional (00XX) → +
        p = '+' + p[2:]
    if p.startswith('+'):
        digits = p[1:]
        return '+' + digits if (digits.isdigit() and 8 <= len(digits) <= 15) else ''
    if not p.isdigit():
        return ''
    if p.startswith('57') and len(p) == 12:   # 57 + celular de 10 dígitos → ya trae indicativo
        return '+' + p
    if len(p) == 10:                          # celular local colombiano → anteponer +57
        return '+57' + p
    return ''


def valid_contact(channel, raw):
    """Valida el contacto (columna 2) SEGÚN EL CANAL. Devuelve (ok, valor_normalizado):
      - EMAIL (EM/EAU/EAP): ok si cumple el patrón de correo; el valor no se altera.
      - CELULAR (SMS/WSP/VOZ): ok si se puede normalizar a E.164; devuelve el E.164.
    Antes se validaba SIEMPRE como correo, lo que rechazaba los celulares de SMS/WhatsApp/Voz
    (tanto en muestras como en el envío real)."""
    value = str(raw or '').strip()
    if is_phone_channel(channel):
        norm = normalize_phone(value)
        return (bool(norm), norm or value)
    return (bool(re.match(PATRON_EMAIL, value)), value)


def _contact_key(line):
    """Clave normalizada del contacto (columna 2) para deduplicar. '' si no hay contacto.
    Los correos se comparan en minúsculas; los celulares se normalizan a E.164 para que
    `3502452219` y `+573502452219` cuenten como el MISMO contacto."""
    if not line or len(line) <= CONTACT_COL:
        return ''
    raw = str(line[CONTACT_COL] or '').strip()
    if not raw:
        return ''
    if '@' in raw:
        return raw.lower()
    return normalize_phone(raw) or raw.lower()


def base_allows_duplicates(customer_id, data_path):
    """¿La base asociada a la campaña permite duplicados? Busca el registro en
    `databaseFile` por (customerId, s3Path). Default False (deduplicar) — best-effort:
    si la tabla/registro no está o falla la consulta, se devuelve False (se deduplica)."""
    if not data_path:
        return False
    try:
        resp = table_database.scan(
            FilterExpression='s3Path = :p AND customerId = :c',
            ExpressionAttributeValues={':p': data_path, ':c': customer_id},
            ProjectionExpression='allowDuplicates')
        items = resp.get('Items', [])
        if items:
            return bool(items[0].get('allowDuplicates', False))
    except Exception as e:
        print('No se pudo resolver allowDuplicates de la base ({}); se deduplica por defecto'.format(e))
    return False


def count_base_rows(temp_file, delimiter, allow_duplicates=True):
    """Cuenta las filas de DATOS del CSV (sin el encabezado) que se van a ENVIAR.
    Dimensiona el cobro PREPAGO. Si `allow_duplicates` es False, cuenta contactos
    DISTINTOS (columna 2) — así el cobro no incluye los duplicados que se filtran en el
    envío real. Si es True, cuenta todas las filas. Lee en streaming."""
    total = 0
    seen = set()
    with open(temp_file, 'r', encoding=ENCODING) as f:
        reader = csv.reader(f, delimiter=delimiter)
        next(reader, None)  # descarta el encabezado
        for line in reader:
            if not allow_duplicates:
                key = _contact_key(line)
                if key:
                    if key in seen:
                        continue  # contacto repetido → no se envía → no se cobra
                    seen.add(key)
            total += 1
    return total
def store_resume_ctx(st, bucket_name, channel_queue, registers_for_message,
                     unsubscribe_existed, blacklist_existed)->None:
    """Persiste en la fila del proceso el contexto necesario para RE-ENCOLAR (reintentar)
    las partes que no se completen. Los part-files ya viven en S3 (_parts/{processId}/N.json);
    con este contexto, la lambda Admin_Requeue reconstruye el trabajo de cada parte faltante
    (las que no están en processedParts) sin la base original. Best-effort: si falla, el
    reintento simplemente no estará disponible para ese proceso."""
    try:
        table_process.update_item(
            Key={'processId': st.process_id},
            UpdateExpression='SET resumeCtx = :c',
            ExpressionAttributeValues={':c': {
                'ctx': build_ctx(st),
                'bucket': bucket_name,
                'channelQueue': channel_queue,
                'registersForMessage': registers_for_message,
                'unsubscribeExisted': unsubscribe_existed,
                'blacklistExisted': blacklist_existed,
            }})
    except Exception as e:
        print('No se pudo guardar resumeCtx (reintento no disponible): {}'.format(e))


def preparar_split(st, data, response_campaign, user_id, template_version, temp_file,
                   delimiter, url_sqs, channel_name, unsubscribe_existed,
                   blacklist_existed):
    """SPLITTER del ENVÍO REAL (Fase 4). Aplica el bloqueo por cliente + la idempotencia de
    campaña + el COBRO PREPAGO (reserva de saldo), TROCEA el CSV en part-files de PART_SIZE
    filas subidos a S3 y encola UN trabajo por parte en URL_SQS_PREPARE_PART. NO valida/
    filtra/encola al canal (eso lo hace cada worker en su propia invocación) → una base de
    100k+ ya no se procesa en una sola llamada.

    Orden del envío real: gate manual (realSendEnabled) → lock (try_start_real_send) →
    reserva de saldo (débito atómico) → troceo. Si el saldo no alcanza se libera el lock
    y se lanza InsufficientBalance (402). Si el troceo falla tras debitar, se reembolsa.

    Devuelve (status, status_code, description). Puede lanzar RealSendDisabled/
    AlreadySending/InsufficientBalance, que el handler atrapa."""
    status = True
    status_code = 200
    description = "Campaña enviandose correctamente"

    print("Inicia SPLIT del envio real")
    # Bloqueo por cliente: si el cliente tiene deshabilitados los envíos reales, no se
    # procesa la campaña real (las muestras sí). Se lanza RealSendDisabled y se atrapa en
    # el handler (mantiene el 403 y NO marca la campaña en Error).
    if not is_real_send_enabled(st.customer_id):
        raise RealSendDisabled(
            'Los envíos reales están deshabilitados para este cliente. '
            'Contacta al administrador de MailConnect.')
    # Gate de APROBACIÓN (maker-checker): si la campaña entró al flujo de aprobación y NO
    # está aprobada (pending/rejected), se bloquea el envío real. Fail-open de rollout:
    # approvalStatus 'none'/ausente (campaña que nunca usó el flujo) NO bloquea.
    approval_status = str(response_campaign['Items'][0].get('approvalStatus', 'none') or 'none')
    if approval_status in ('pending', 'rejected'):
        raise RealSendNotApproved(
            'La campaña requiere aprobación antes del envío real '
            '(estado de aprobación: {}).'.format(approval_status))
    # IDEMPOTENCIA: transición atómica a 'Enviando'. Si otra invocación (reintento de
    # Lambda/API Gateway, doble clic, envío concurrente) ya tomó el lock, NO se re-trocea
    # (se lanza AlreadySending → 200 limpio). Como el débito va DESPUÉS del lock, un
    # reintento que choca con AlreadySending NUNCA vuelve a cobrar.
    if not try_start_real_send(st, st.process_id):
        raise AlreadySending('La campaña ya está en proceso de envío; no se re-encola.')

    # --- Cobro PREPAGO: reserva de saldo ANTES de trocear (débito atómico) ---
    # Se dimensiona por el TAMAÑO de la base y se debita con bloqueo DURO. Si no alcanza,
    # se libera el lock (la campaña vuelve a su estado previo) y se lanza 402. El monto
    # debitado se guarda para reembolsar si el troceo falla después (compensación).
    previous_state = response_campaign['Items'][0].get('campaignState', 'Pendiente')
    document_format = response_campaign['Items'][0].get('documentFormat')
    # Modo de entrega del adjunto (ONFILE=adjunto / ONLINE=enlace). Hoy cobra igual (hook).
    delivery_mode = response_campaign['Items'][0].get('attachmentType') or 'ONFILE'
    data_path = response_campaign['Items'][0].get('dataPath')
    # ¿La base permite duplicados? Si NO (default), se filtran los contactos repetidos en
    # el envío real (y el cobro se dimensiona sobre contactos distintos).
    allow_duplicates = base_allows_duplicates(st.customer_id, data_path)
    print("Permitir duplicados: {}".format(allow_duplicates))
    debited = 0
    try:
        recipients_count = count_base_rows(temp_file, delimiter, allow_duplicates)
        cost = _campaign_cost(st.customer_id, channel_name, recipients_count, document_format, delivery_mode)
        if cost > 0:
            new_balance = reserve_balance(st, cost, data["campaignName"])
            if new_balance is not None:  # None = tabla de saldos no desplegada (rollout)
                debited = cost
                print("Saldo reservado: ${} por {} destinatarios (saldo: ${})".format(
                    cost, recipients_count, new_balance))
    except InsufficientBalance:
        # Saldo insuficiente: se libera el lock (campaña vuelve a ser enviable) y se
        # propaga → el handler responde 402. NO se marca la campaña en Error.
        release_real_send_lock(st, previous_state)
        raise
    except Exception:
        # Error inesperado calculando/reservando el saldo: liberar el lock para no dejar
        # la campaña atascada en 'Enviando' y propagar (handler → 500). El débito es
        # atómico, así que o se aplicó (debited>0) o no; aquí debited=0 (falló antes/en
        # la reserva), no hay nada que reembolsar.
        release_real_send_lock(st, previous_state)
        raise

    registers_for_message = registers_for_channel(channel_name)
    # Bucket del cliente por NIT (los part-files se suben aquí y el worker los lee de aquí).
    bucket_name = tenant_bucket(st.nit, 'database') if st.nit else f'{st.customer_name.lower()}.database'
    registers_on_spool = 0
    part = 0
    try:
        # Lee el CSV descargado y trocea en part-files. Solo se acumulan PART_SIZE filas en
        # memoria a la vez (se suben y se libera el buffer) → apto para bases grandes.
        with open(temp_file, 'r', encoding=ENCODING) as file:
            reader = csv.reader(file, delimiter=delimiter)
            st.headers = next(reader)  # primer linea = encabezado (va en el ctx)
            print("Headers: " + str(st.headers))
            buffer = []
            # Dedup de contactos: si la base NO permite duplicados (default), se descarta
            # la fila cuyo contacto (columna 2) ya salió antes → el mismo destinatario no
            # recibe la comunicación más de una vez. Los duplicados NO se trocean/encolan.
            seen_contacts = set()
            duplicates_skipped = 0
            for line in reader:
                if not allow_duplicates:
                    key = _contact_key(line)
                    if key:
                        if key in seen_contacts:
                            duplicates_skipped += 1
                            continue
                        seen_contacts.add(key)
                buffer.append(line)
                registers_on_spool += 1
                if len(buffer) == PART_SIZE:
                    part += 1
                    key = upload_part_file(bucket_name, st.process_id, part, buffer)
                    enqueue_part_job(st, part, key, bucket_name, url_sqs,
                                     registers_for_message, unsubscribe_existed, blacklist_existed)
                    buffer = []
            if buffer:  # último trozo incompleto
                part += 1
                key = upload_part_file(bucket_name, st.process_id, part, buffer)
                enqueue_part_job(st, part, key, bucket_name, url_sqs,
                                 registers_for_message, unsubscribe_existed, blacklist_existed)
        os.remove(temp_file)
        print(f"SPLIT: {registers_on_spool} registros en {part} parte(s); "
              f"{duplicates_skipped} duplicado(s) omitido(s)")
    except Exception as e:
        update_campaign_status(st, "Error")
        print(e)
        print('Error al trocear/encolar el envio real')
        # COMPENSACIÓN: el débito ya se aplicó (débito antes del troceo). Si el troceo
        # falla, se reembolsa el saldo para no cobrarle al cliente un envío que no salió.
        if debited > 0:
            refund_balance(st, debited, data["campaignName"])
        status = False
        description = 'Error al trocear/encolar el envio real'
        status_code = 400
    else:
        # Fila del proceso: registersOnSpool y el total de partes ya se conocen; los conteos
        # por categoría (a enviar / lista negra / desuscritos / inválidos) los ACUMULAN los
        # workers de cada parte (ADD atómico). Estado inicial "Procesando".
        insert_process(st, data["campaignName"], user_id, registers_on_spool, 0, 0, 0, 0,
                       part, template_version, "Procesando", charged_amount=debited)
        # Guarda el contexto para poder RE-ENCOLAR las partes que no terminen (reintento admin).
        store_resume_ctx(st, bucket_name, url_sqs, registers_for_message,
                         unsubscribe_existed, blacklist_existed)

    return status, status_code, description


def _part_already_done(st, part)->bool:
    """¿La parte `part` ya fue procesada por completo? Se consulta el set `processedParts`
    de la fila del proceso. Como el worker MARCA la parte al FINAL (después de encolar y
    registrar estados), 'marcada' ⇒ 'terminada' → es seguro saltarla (idempotencia)."""
    try:
        item = table_process.get_item(Key={'processId': st.process_id}).get('Item') or {}
        return str(part) in (item.get('processedParts') or set())
    except Exception as e:
        print(f'No se pudo leer processedParts ({e}); se procesa la parte')
        return False


def _mark_and_count_part(st, part, enqueued, quantity_blacklist, quantity_unsubscribe,
                         quantity_deletions)->bool:
    """Marca la parte como procesada Y acumula sus conteos en la fila del proceso en UNA
    operación ATÓMICA condicionada a que la parte no estuviera ya marcada. Devuelve False si
    ya estaba marcada (otra invocación la contó) → no se duplica el conteo."""
    try:
        table_process.update_item(
            Key={'processId': st.process_id},
            UpdateExpression=('ADD processedParts :p, registersToSend :rts, '
                              'quantityBlacklist :bl, quantityUnsubscribe :un, quantityDeletions :de'),
            ConditionExpression='attribute_not_exists(processedParts) OR NOT contains(processedParts, :pv)',
            ExpressionAttributeValues={
                ':p': set([str(part)]), ':pv': str(part),
                ':rts': enqueued, ':bl': quantity_blacklist,
                ':un': quantity_unsubscribe, ':de': quantity_deletions,
            })
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def procesar_parte(st, job)->None:
    """WORKER del ENVÍO REAL (Fase 4). Procesa UNA parte: descarga el part-file, valida el
    contacto (correo o celular E.164 según el canal), filtra lista negra/desuscritos, agrupa
    en lotes y ENCOLA al canal
    con numeración de parte ÚNICA, registra los estados de los filtrados y ACUMULA los
    conteos en la fila del proceso. IDEMPOTENTE: encolado deduplicado por la lambda de envío
    (por (processId, part)); estados con IDs deterministas (put idempotente); conteo con
    marca condicional → una redelivery de SQS no duplica nada."""
    # Reconstruye el estado de la invocación desde el ctx que viaja en el trabajo.
    st.customer_id = job['customerId']
    st.customer_name = job['customerName']
    st.nit = job.get('nit')   # llave de tablas por cliente (st.tenant) en el worker
    st.process_id = job['processId']
    st.campaign_id = job['campaignId']
    st.attachment = job.get('attachment', False)
    st.from_email = job.get('fromEmail', '')
    st.headers = job.get('headers')
    st.template_name = job.get('templateName')
    st.channel = job.get('channel', '')   # tipo de contacto (correo vs celular E.164)
    st.sms_body = job.get('smsBody', '')
    st.wsp_template = job.get('wspTemplate', '')
    st.voice_message = job.get('voiceMessage', '')

    part = job['part']
    registers_for_message = job['registersForMessage']
    channel_queue = job['channelQueue']
    unsubscribe_existed = job.get('unsubscribeExisted', False)
    blacklist_existed = job.get('blacklistExisted', False)

    # Idempotencia rápida: si la parte ya se completó, no se rehace el trabajo.
    if _part_already_done(st, part):
        print(f"La parte {part} del proceso {st.process_id} ya fue procesada; se omite")
        return

    # Descarga el part-file (JSON con las filas de esta parte).
    obj = s3.get_object(Bucket=job['bucket'], Key=job['partKey'])
    rows = json.loads(obj['Body'].read().decode('utf-8'))

    keys = []
    emails_error = []
    registers_correct = []
    for line in rows:
        raw = line[CONTACT_COL] if len(line) > CONTACT_COL else ''
        # Validación del contacto SEGÚN EL CANAL: correo (EM/EAU/EAP) o celular E.164
        # (SMS/WSP/VOZ). Antes se validaba SIEMPRE como correo, por lo que en el envío real de
        # SMS/WhatsApp/Voz TODOS los contactos caían en emails_error (estado 11) y NO se
        # encolaba nada. Los celulares válidos se normalizan a E.164 en la fila.
        ok, contact = valid_contact(st.channel, raw)
        if ok:
            if len(line) > CONTACT_COL:
                line[CONTACT_COL] = contact   # celular → E.164 (el correo queda igual)
            keys.append({'email': contact})
            registers_correct.append(line)
        else:
            emails_error.append(line)

    #Solo se consulta si la tabla ya existía (si es el primer proceso del cliente, las tablas
    #recién creadas están vacías).
    blacklist_emails = set()
    unsubscribes_emails = set()
    if unsubscribe_existed:
        unsubscribes_emails = check_unsubscribes(st.tenant, keys)
    if blacklist_existed:
        blacklist_emails = check_blacklist(st.tenant, keys)

    # Encola al canal con parte ÚNICA (part_offset garantiza que no choque con otras partes).
    ctx = build_ctx(st)
    registers_blacklist, registers_unsubscribe, enqueued, _channel_parts = classify_and_enqueue(
        ctx, registers_correct, blacklist_emails, unsubscribes_emails,
        registers_for_message, channel_queue, part_offset=part * PART_SIZE)

    # Estados de los filtrados con IDs deterministas (reprocesar SOBREESCRIBE, no duplica).
    invalid_desc = ("El celular no tiene un formato valido (E.164)"
                    if is_phone_channel(st.channel)
                    else "El email no tiene una estructura valida")
    insert_mails_status(st, emails_error, 11, invalid_desc, id_prefix=f'{part}-11')
    insert_mails_status(st, registers_unsubscribe, 12, "El email se encuentra desinscrito para este cliente", id_prefix=f'{part}-12')
    insert_mails_status(st, registers_blacklist, 13, "El email se encuentra en la lista negra de este cliente", id_prefix=f'{part}-13')

    # Marca la parte + acumula conteos (atómico, condicional). Al final: si crasheó antes,
    # una redelivery rehace el trabajo idempotente y recién aquí cuenta una sola vez.
    counted = _mark_and_count_part(st, part, enqueued, len(registers_blacklist),
                                   len(registers_unsubscribe), len(emails_error))
    print(f"Parte {part}: encolados={enqueued}, contada={counted}")


def lambda_handler(event, context):
    """
    Función principal. Tiene DOS modos:
      - SQS (evento con 'Records'): WORKER de una parte del envío real (Fase 4) → procesar_parte.
      - API Gateway (evento con 'resource'): SETUP común (parseo, campaña, tablas, descarga del
        CSV) y DESPACHA a preparar_muestras() (muestras) o preparar_split() (envío real → fan-out).
    El estado de la invocación viaja en un objeto ProcessState (antes eran variables globales).

    Args:
        event (dict): Datos de evento
        context (dict): Datos de contexto

    Returns:
        None: Personalizado
    """
    st = ProcessState()

    status = True
    description = "Campaña enviandose correctamente"
    status_code = 200

    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    st.formatted_date = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'

    try:
        # WORKER (Fase 4): si el evento viene de SQS (cola de partes), procesa cada parte.
        # Es la MISMA lambda, disparada por URL_SQS_PREPARE_PART. La validación del contacto
        # (correo o celular E.164) la resuelve procesar_parte por canal (job['channel']).
        if 'Records' in event:
            for record in event['Records']:
                job = json.loads(record['body'])
                procesar_parte(st, job)  # st ya trae formatted_date
            return {'statusCode': 200, 'headers': CORS_HEADERS,
                    'body': json.dumps({'status': True, 'status_code': 200,
                    'description': 'Partes procesadas'})}

        # Obtener datos del evento
        endpoint = event["resource"]
        print("endpoint: " + endpoint)
        data = json.loads(event["body"])
        st.customer_name = data["customerName"]
        print("Customer: " + st.customer_name)
        campaign_name = data["campaignName"]
        user_id = data["userId"]

        #Puedo dejar estos dos datos para posiblemente mas adelante usarlos
        #Para enviar alguna prueba, muestra, reenvio de una version especifica
        template = data['template']
        template_version = data['templateVersion']
        ####################################

        samples = "Send-batch-template-samples" in endpoint
        print("Samples: " + str(samples))
        # Aislamiento multi-tenant: el cliente del token (Authorizer) es la autoridad sobre a
        # quién pertenece la campaña. Si el context lo trae, la búsqueda se ACOTA a ese
        # customerId → un tenant no puede enviar/cobrar la campaña de otro, ni se resuelve por
        # accidente una campaña homónima de otro cliente. Fail-open de rollout: sin customerId
        # en el context (rutas aún sin el mapping template) se busca solo por nombre (legado).
        auth_ctx = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        auth_customer_id = str(auth_ctx.get('customerId') or '').strip() or None
        response_campaign = select_campaign(campaign_name, auth_customer_id)
        print(response_campaign)
        if response_campaign['Items']:
            print(f'La campaña "{campaign_name}" fue encontrada en la BD')
            state = response_campaign['Items'][0]["campaignState"]

            # Solo se procesa el envío si la campaña está en un estado enviable
            # (REAL_SEND_ALLOWED_STATES = Pendiente/Muestras/Error). "Enviando"/"Terminada" ya
            # no se reenvían; "Error" permite reintentar tras un fallo previo. Fuente única:
            # la constante REAL_SEND_ALLOWED_STATES (antes había un toggle productiva/pruebas
            # comentado a mano que era fácil de dejar en el estado equivocado).
            if state in REAL_SEND_ALLOWED_STATES:
                print(f'La campaña se encuentra en estado "{state}" y se puede realizar su envio')
                st.process_id = str(uuid.uuid4())
                # Ruta temporal para el archivo descargado de S3.
                temp_file = f'/tmp/{st.customer_name}_{st.formatted_date}.tmp'
                print("Process id:" + st.process_id)

                st.campaign_id = response_campaign['Items'][0]["campaignId"]
                print("Despues de capturar el id de campaña")
                st.customer_id = response_campaign['Items'][0]["customerId"]
                # NIT del cliente → define el bucket S3 (por NIT, no por nombre).
                st.nit = get_customer_nit(st.customer_id)
                consecutive = response_campaign['Items'][0]["consecutive"]
                channel_name = response_campaign['Items'][0]["channel"]
                st.channel = channel_name  # define el tipo de contacto (correo vs celular E.164)
                data_path = response_campaign['Items'][0]["dataPath"]
                st.from_email = response_campaign['Items'][0]["originEmail"]
                # Contenido de SMS/WSP: se RESUELVE EN VIVO desde la plantilla referenciada
                # (campaign.messageTemplateId) para reflejar ediciones posteriores a la creación
                # de la campaña. Si no hay referencia o no se puede resolver, cae al snapshot
                # guardado en campaign.template (compat con campañas viejas y con Voz).
                snapshot_template = response_campaign['Items'][0].get("template", "") or ""
                message_template_id = response_campaign['Items'][0].get("messageTemplateId") or ""
                live_content = resolve_live_message_content(message_template_id, st.customer_id, channel_name)
                # Para SMS el campo 'template' de la campaña guarda el TEXTO del mensaje
                # (no un template de SES). Para email queda vacío y no se usa.
                st.sms_body = (live_content if live_content is not None else snapshot_template) if channel_name == "SMS" else ""
                # Para WhatsApp el campo 'template' guarda el NOMBRE de la plantilla HSM
                # aprobada por Meta. Para el resto de canales queda vacío y no se usa.
                st.wsp_template = (live_content if live_content is not None else snapshot_template) if channel_name == "WSP" else ""
                # Para Voz el campo 'template' guarda el TEXTO a leer por TTS (sin plantilla
                # referenciada: la voz se escribe libre en el form, el snapshot ES la fuente).
                st.voice_message = snapshot_template if channel_name == "VOZ" else ""

                # Todas las tablas por cliente se nombran con la LLAVE POR NIT (st.tenant =
                # tenant_key(companyTin)), igual que los buckets S3. Antes se usaba el nombre
                # de empresa (inconsistente con los buckets); ahora tabla y bucket comparten llave.
                # require_tenant falla si el cliente no tiene NIT (evita colisión entre tenants).
                tenant = require_tenant(st.nit)

                # Define los detalles de la tabla processDetail
                check_and_create_table(f'{tenant}_processDetail', 'processDetailId')

                # Tabla de desuscritos: PK 'email' (así la escribe la lambda Unsubscribe y
                # así la consulta check_unsubscribes). Si la tabla ya existía, hay que
                # FILTRAR contra ella en el envío real.
                unsubscribe_existed = not check_and_create_table(f'{tenant}_unsubscribe', 'email')

                # Tabla de lista negra: PK 'email' (igual que unsubscribe), para que el
                # filtrado por email de check_blacklist funcione directo. ReceptionStatus
                # incluye 'email' en sus inserts, así que escribe compatible. Tablas viejas
                # con PK 'blackListId' se ignoran con gracia (borrar y dejar que se recreen).
                blacklist_existed = not check_and_create_table(f'{tenant}_blackList', 'email')

                #Estas tablas siempre se deben crear
                # Tabla ÚNICA de detalle del cliente (PK processId + SK sendDetailId).
                # Antes se creaba una tabla por proceso ({tenant}_sendDetail_{uuid}).
                ensure_detail_table(tenant)

                # Tabla ÚNICA de estados del cliente (PK processId + SK sendStatusId).
                # Antes se creaba una tabla por proceso ({tenant}_sendStatus_{uuid}).
                ensure_status_table(tenant)
                # Tablas de PRE-AGREGACIÓN (resumen O(1) para reportes). Se crean acá para
                # que existan antes de que lleguen los eventos de recepción (best-effort).
                ensure_summary_tables(tenant)
                # BARRERA: esperar a que las tablas que LEE/ESCRIBE el worker (Send-*) estén
                # ACTIVE antes de encolar. Evita el ResourceNotFoundException del primer
                # envío de un cliente (tablas recién creadas en estado CREATING).
                wait_tables_active([
                    f'{tenant}_processDetail', f'{tenant}_sendDetail', f'{tenant}_sendStatus',
                    f'{tenant}_unsubscribe', f'{tenant}_blackList',
                ])

                # Nombre de la PLANTILLA SES: se USA el que viene en el payload de la campaña
                # (campaign.template = la plantilla que el cliente eligió al crear la campaña),
                # NO se reconstruye. Así el envío usa exactamente la plantilla seleccionada y no
                # depende de que el nombre coincida con {customer}_{consecutivo}_{campaña}.
                # Solo aplica a los canales de EMAIL (para SMS/WSP/VOZ, `template` guarda el
                # texto/HSM y no se usa como nombre de plantilla SES). Fallback a la convención
                # por compatibilidad con campañas viejas sin `template` guardado.
                campaign_template = response_campaign['Items'][0].get('template') or ''
                if channel_name in ('EM', 'EAU', 'EAP') and campaign_template:
                    st.template_name = campaign_template
                else:
                    st.template_name = f'{st.customer_name}_{consecutive}_{campaign_name}'

                print(f"Channel: {channel_name}")
                #EAU = Email con adjunto unico (El mismo adjunto se envia a todos los destinatarios)
                #EAP = Email con adjunto personalizado (Se realiza personalizacion en campos para enviar a cada destinatario un adjunto diferente)
                if channel_name == "EAU":
                    st.attachment = True
                    url_sqs = URL_SQS_EAU
                elif channel_name == "EAP":
                    st.attachment = True
                    # EAP tiene dos armadores según el formato del documento: DOCX
                    # (combinación de correspondencia) o PDF (personalización de campos).
                    # Cada uno tiene su propia cola/lambda que construye el archivo.
                    document_format = str(response_campaign['Items'][0].get('documentFormat', 'DOCX') or 'DOCX').upper()
                    url_sqs = URL_SQS_EAP_PDF if document_format == 'PDF' else URL_SQS_EAP
                    print(f"EAP documentFormat: {document_format} → {url_sqs}")
                elif channel_name == "SMS":
                    st.attachment = False
                    url_sqs = URL_SQS_SMS
                elif channel_name == "WSP":
                    st.attachment = False
                    url_sqs = URL_SQS_WSP
                elif channel_name == "VOZ":
                    st.attachment = False
                    url_sqs = URL_SQS_VOICE
                else:
                    st.attachment = False
                    url_sqs = URL_SQS_EM
                print("Queue: " + url_sqs)

                try:
                    # Descarga el CSV desde S3 (bucket por NIT, con fallback al viejo por nombre).
                    download_base_csv(st.nit, st.customer_name, data_path, temp_file)
                except Exception as e:
                    update_campaign_status(st, "Error")
                    # Antes el mensaje usaba `bucket_name`, variable NO definida en este scope
                    # → NameError que caía al catch-all y respondía 500 en vez de este 404 útil
                    # (el fallo más común es que la base no esté en S3). Se arma con datos definidos.
                    description = f'No se pudo descargar la base "{data_path}" del cliente (NIT {st.nit}) desde S3.'
                    status = False
                    print(description)
                    print(e)
                    status_code = 404
                else:
                    # Detectar el delimitador del CSV (el cliente pudo subirlo con ; , tab o |).
                    delimiter = detect_delimiter(temp_file)
                    # Estructura obligatoria por posición: line[0]=Identificación, line[1]=contacto
                    # (correo o celular según el canal), line[2]=Nombre. La validación del contacto
                    # la hacen preparar_muestras/procesar_parte con valid_contact(st.channel, ...).

                    if samples:
                        status, status_code, description = preparar_muestras(
                            st, data, response_campaign, user_id, template_version,
                            temp_file, delimiter, url_sqs)
                        if status:
                            # Historial de muestras para el flujo de aprobación (best-effort).
                            record_sample_batch(st, data, event)
                            _audit_send(event, data, 'send.samples',
                                        "Envío de {} muestra(s) de la campaña '{}' ({})".format(
                                            data.get('quantitySamples', ''), campaign_name, channel_name))
                    else:
                        # RBAC: el envío real solo lo puede disparar owner/approver (el
                        # funcional/operator solo prepara y solicita aprobación). Fail-open
                        # de rollout: si el context no trae tenantRole, default 'owner'.
                        _trole = str(((event.get('requestContext') or {}).get('authorizer') or {})
                                     .get('tenantRole', 'owner') or 'owner') if isinstance(event, dict) else 'owner'
                        if _trole not in ('owner', 'approver'):
                            status = False
                            status_code = 403
                            description = ('Tu rol no permite el envío real. Solicita la '
                                           'aprobación a un aprobador de tu empresa.')
                            print(description)
                        else:
                            # Envío real → SPLIT: trocea el CSV y encola un trabajo por parte
                            # (cada parte la procesa un worker en su propia invocación, Fase 4).
                            status, status_code, description = preparar_split(
                                st, data, response_campaign, user_id, template_version,
                                temp_file, delimiter, url_sqs, channel_name,
                                unsubscribe_existed, blacklist_existed)
                        if status:
                            _audit_send(event, data, 'send.real',
                                        "Envío REAL iniciado de la campaña '{}' ({})".format(
                                            campaign_name, channel_name))

            #Si el estado es "Enviando" o "Terminada" quiere decir que es una campaña que ya no se debe enviar
            else:
                description = f'La campaña se encuentra en estado "{state}" y por esta razon no puede ser enviada'
                status = False
                print(description)
                status_code = 404
        else:
            description = f'La campaña "{campaign_name}" no se encuentra registrada en la Base de datos'
            status = False
            print(description)
            status_code = 404
            # No hay campaña que marcar en Error (st.campaign_id no está seteado).
    except AlreadySending as e:
        # Reintento / envío concurrente: la campaña ya tomó el lock. Es el comportamiento
        # correcto (idempotencia), NO un error: 200 y sin marcar Error ni re-encolar.
        description = str(e)
        status = True
        status_code = 200
        print(description)
    except RealSendDisabled as e:
        # Cliente con envíos reales deshabilitados: 403 claro, sin marcar Error.
        description = str(e)
        status = False
        status_code = 403
        print(description)
    except RealSendNotApproved as e:
        # Campaña en el flujo de aprobación pero no aprobada: 409, sin marcar Error (la
        # campaña sigue enviable una vez aprobada). El gate va antes de tomar el lock.
        description = str(e)
        status = False
        status_code = 409
        print(description)
    except InsufficientBalance as e:
        # Saldo insuficiente (cobro PREPAGO, bloqueo duro): 402, sin marcar Error. El
        # lock ya se liberó en preparar_split, así que la campaña sigue enviable.
        description = str(e)
        status = False
        status_code = 402
        print(description)
    except Exception as e:
        description = "Error no controlado en el servicio"
        status = False
        status_code = 500
        print(description)
        print(e)
    finally:
        # Respuesta PROXY (con header CORS para que el navegador no bloquee el POST).
        response = {
            'statusCode': status_code,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'status':status,
                'status_code': status_code,
                'description':description
            })
        }

    return response
