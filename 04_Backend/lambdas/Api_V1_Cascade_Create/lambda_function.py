'''
Cascada omnicanal — CREAR un run ("entrega garantizada al menor costo").

El cliente define UN mensaje lógico: una base de contactos + un ORDEN de canales
(Correo → WhatsApp → SMS → Voz, o el que elija) con el contenido por canal, un criterio
de confirmación (entregado/leído), un timeout de escalamiento y un tope de presupuesto.
La plataforma intenta el canal preferido/más barato y escala sola hasta confirmar
entrega/lectura (motor `Api_V1_Cascade_Tick`).

Esta lambda valida, materializa los contactos desde el CSV de la base y crea el run en
estado `draft`. `Api_V1_Cascade_Start` lo pasa a `running`.

Ruta: POST /Cascade/Create  (no-proxy, envelope). Tenant del token (Authorizer).

Request:
  {
    name,
    databaseFileId,                      # base ya cargada (databaseFile)
    emailCol, phoneCol, nameCol,         # índices de columna (0-based) en el CSV; -1 si no hay
    steps: [ {channel:'EM'|'SMS'|'WSP'|'VOZ', ...contenido} ],   # orden de prioridad
    confirmOn: 'delivered' | 'read',     # qué cuenta como éxito (default delivered)
    stepTimeoutMin,                      # minutos de espera por paso (default 60)
    budgetCap?                           # COP tope del run (opcional)
  }
  Contenido por canal:  EM {template, from} · SMS {body} · WSP {hsm} · VOZ {voiceText}

Respuesta: 201 { data:{ cascadeRunId, total } } · 400 · 403 · 404 (base no existe)

Tablas: cascadeRun (PK cascadeRunId + GSI customerId-index), cascadeContact (PK
cascadeContactId + GSI cascadeRunId-index). Se crean on-demand.
'''
import csv
import json
import os
import re
import uuid
from datetime import datetime
from decimal import Decimal

import boto3

REGION = 'us-east-1'
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
MAX_CONTACTS = int(os.environ.get('CASCADE_MAX_CONTACTS', '5000'))
VALID_CHANNELS = ('EM', 'SMS', 'WSP', 'VOZ')
PHONE_CHANNELS = ('SMS', 'WSP', 'VOZ')
PATRON_EMAIL = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$'
CANDIDATE_DELIMITERS = [';', ',', '\t', '|']

dynamodb = boto3.resource('dynamodb', region_name=REGION)
s3 = boto3.client('s3', region_name=REGION)
table_database = dynamodb.Table('databaseFile')
table_run = dynamodb.Table('cascadeRun')
table_contact = dynamodb.Table('cascadeContact')


def tenant_key(nit):
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit):
    return '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def normalize_phone(raw):
    if raw is None:
        return ''
    p = re.sub(r'[\s()\-.]', '', str(raw))
    if not p:
        return ''
    if p.startswith('00'):
        p = '+' + p[2:]
    if p.startswith('+'):
        digits = p[1:]
        return '+' + digits if (digits.isdigit() and 8 <= len(digits) <= 15) else ''
    if not p.isdigit():
        return ''
    if p.startswith('57') and len(p) == 12:
        return '+' + p
    if len(p) == 10:
        return '+57' + p
    return ''


def _valid_email(value):
    return bool(re.match(PATRON_EMAIL, str(value or '').strip()))


def detect_delimiter(temp_file, default=';'):
    try:
        with open(temp_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    counts = {d: line.count(d) for d in CANDIDATE_DELIMITERS}
                    best = max(counts, key=counts.get)
                    return best if counts[best] > 0 else default
    except Exception as e:
        print('No se pudo detectar el delimitador ({})'.format(e))
    return default


def download_base_csv(nit, customer_name, data_path, temp_file):
    candidates = []
    if nit:
        candidates.append(tenant_bucket(nit))
    candidates.append('{}.database'.format(str(customer_name or '').lower()))
    last = None
    for bucket in candidates:
        try:
            s3.download_file(bucket, data_path, temp_file)
            return bucket
        except Exception as e:
            last = e
    raise last if last else Exception('No se pudo descargar la base')


def _ensure_tables():
    """Crea cascadeRun / cascadeContact on-demand (idempotente)."""
    specs = [
        ('cascadeRun', 'cascadeRunId', 'customerId', 'customerId-index'),
        ('cascadeContact', 'cascadeContactId', 'cascadeRunId', 'cascadeRunId-index'),
    ]
    for name, pk, gsi_key, gsi_name in specs:
        try:
            dynamodb.meta.client.describe_table(TableName=name)
            continue
        except Exception:
            pass
        try:
            dynamodb.create_table(
                TableName=name,
                KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'},
                                      {'AttributeName': gsi_key, 'AttributeType': 'S'}],
                GlobalSecondaryIndexes=[{
                    'IndexName': gsi_name,
                    'KeySchema': [{'AttributeName': gsi_key, 'KeyType': 'HASH'}],
                    'Projection': {'ProjectionType': 'ALL'}}],
                BillingMode='PAY_PER_REQUEST')
            dynamodb.meta.client.get_waiter('table_exists').wait(TableName=name)
        except Exception as e:
            print('No se pudo crear {}: {}'.format(name, e))


def _norm_step(step):
    """Valida y normaliza un paso del orden de canales."""
    ch = str(step.get('channel', '')).upper()
    if ch not in VALID_CHANNELS:
        return None
    out = {'channel': ch}
    if ch == 'EM':
        out['template'] = str(step.get('template', '')).strip()
        out['from'] = str(step.get('from', '')).strip()
        if not out['template'] or not out['from']:
            return None
    elif ch == 'SMS':
        out['body'] = str(step.get('body', '')).strip()
        if not out['body']:
            return None
    elif ch == 'WSP':
        out['hsm'] = str(step.get('hsm', '')).strip()
        if not out['hsm']:
            return None
    elif ch == 'VOZ':
        out['voiceText'] = str(step.get('voiceText', '')).strip()
        if not out['voiceText']:
            return None
    return out


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    customer = auth.get('customer') or ''
    nit = auth.get('nit') or auth.get('companyTin')
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.', 'data': {}}

    name = str(payload.get('name', '')).strip()
    database_file_id = str(payload.get('databaseFileId', '')).strip()
    raw_steps = payload.get('steps') or []
    confirm_on = str(payload.get('confirmOn', 'delivered')).lower()
    confirm_on = 'read' if confirm_on == 'read' else 'delivered'
    try:
        step_timeout_min = int(payload.get('stepTimeoutMin', 60))
    except (TypeError, ValueError):
        step_timeout_min = 60
    step_timeout_min = max(1, min(step_timeout_min, 7 * 24 * 60))
    budget_cap = payload.get('budgetCap')
    try:
        budget_cap = int(budget_cap) if budget_cap not in (None, '', 0, '0') else None
    except (TypeError, ValueError):
        budget_cap = None

    if not name:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el nombre de la cascada.', 'data': {}}
    if not database_file_id:
        return {'status': False, 'statusCode': 400, 'description': 'Selecciona la base de contactos.', 'data': {}}
    steps = [s for s in (_norm_step(x) for x in raw_steps) if s]
    if not steps:
        return {'status': False, 'statusCode': 400,
                'description': 'Define al menos un canal con su contenido (correo/SMS/WhatsApp/voz).', 'data': {}}

    def _col(k):
        try:
            return int(payload.get(k, -1))
        except (TypeError, ValueError):
            return -1
    email_col, phone_col, name_col = _col('emailCol'), _col('phoneCol'), _col('nameCol')

    # Coherencia: si hay un paso de correo, se necesita columna de email; si hay paso de
    # teléfono, columna de celular.
    needs_email = any(s['channel'] == 'EM' for s in steps)
    needs_phone = any(s['channel'] in PHONE_CHANNELS for s in steps)
    if needs_email and email_col < 0:
        return {'status': False, 'statusCode': 400, 'description': 'Indica la columna de correo (emailCol) para el paso de correo.', 'data': {}}
    if needs_phone and phone_col < 0:
        return {'status': False, 'statusCode': 400, 'description': 'Indica la columna de celular (phoneCol) para SMS/WhatsApp/Voz.', 'data': {}}

    # Base
    try:
        db = table_database.get_item(Key={'databaseFileId': database_file_id}).get('Item')
    except Exception as e:
        print('Error leyendo databaseFile: {}'.format(e))
        db = None
    if not db:
        return {'status': False, 'statusCode': 404, 'description': 'La base de contactos no existe.', 'data': {}}
    if db.get('customerId') and db.get('customerId') != customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'La base no pertenece a tu cuenta.', 'data': {}}
    data_path = db.get('s3Path') or ''
    columns = [str(c) for c in (db.get('columns') or [])]
    if not data_path:
        return {'status': False, 'statusCode': 400, 'description': 'La base no tiene ruta de archivo (s3Path).', 'data': {}}

    _ensure_tables()

    # Descargar + parsear el CSV → materializar contactos.
    tmp = '/tmp/casc_{}.csv'.format(uuid.uuid4().hex[:8])
    try:
        download_base_csv(nit, customer, data_path, tmp)
    except Exception as e:
        print('No se pudo descargar la base: {}'.format(e))
        return {'status': False, 'statusCode': 400, 'description': 'No se pudo leer la base en S3.', 'data': {}}
    delimiter = str(db.get('delimiter') or detect_delimiter(tmp))

    run_id = str(uuid.uuid4())
    run_short = run_id[:8]
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

    contacts = []
    seen = set()
    truncated = False
    try:
        with open(tmp, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=delimiter)
            header = next(reader, None)  # descarta la fila de encabezados
            if not columns and header:
                columns = [str(c) for c in header]
            seq = 0
            for row in reader:
                if not row or not any(str(c).strip() for c in row):
                    continue
                email = str(row[email_col]).strip() if 0 <= email_col < len(row) else ''
                phone_raw = str(row[phone_col]).strip() if 0 <= phone_col < len(row) else ''
                phone = normalize_phone(phone_raw)
                name_val = str(row[name_col]).strip() if 0 <= name_col < len(row) else ''
                email = email if _valid_email(email) else ''
                # Dedup por (email|phone).
                dkey = (email.lower() or '') + '|' + (phone or '')
                if dkey == '|' or dkey in seen:
                    continue
                seen.add(dkey)
                if len(contacts) >= MAX_CONTACTS:
                    truncated = True
                    break
                seq += 1
                contacts.append({
                    'cascadeContactId': '{}-{}'.format(run_short, seq),
                    'cascadeRunId': run_id,
                    'customerId': customer_id,
                    'nit': str(nit or ''),
                    'contactId': str(row[0]).strip() if row else str(seq),
                    'email': email,
                    'phone': phone,
                    'name': name_val,
                    'row': [str(c) for c in row],
                    'stepIndex': 0,
                    'status': 'pending',
                    'currentChannel': '',
                    'processId': '',
                    'nextEscalationAt': 0,
                    'spent': 0,
                    'attempts': [],
                    'lastState': 0,
                    'updatedAt': now,
                })
    except Exception as e:
        print('Error parseando el CSV: {}'.format(e))
        return {'status': False, 'statusCode': 400, 'description': 'No se pudo parsear la base (revisa el delimitador/columnas).', 'data': {}}
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass

    if not contacts:
        return {'status': False, 'statusCode': 400,
                'description': 'La base no tiene contactos válidos para los canales elegidos.', 'data': {}}

    # Persistir contactos (batch) + run.
    try:
        with table_contact.batch_writer() as batch:
            for c in contacts:
                batch.put_item(Item=c)
    except Exception as e:
        print('Error guardando contactos: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudieron guardar los contactos.', 'data': {}}

    run_item = {
        'cascadeRunId': run_id,
        'customerId': customer_id,
        'customer': customer,
        'nit': str(nit or ''),
        'name': name,
        'databaseFileId': database_file_id,
        'dataPath': data_path,
        'columns': columns,
        'emailCol': email_col, 'phoneCol': phone_col, 'nameCol': name_col,
        'steps': steps,
        'confirmOn': confirm_on,
        'stepTimeoutMin': step_timeout_min,
        'budgetCap': budget_cap,
        'status': 'draft',
        'counts': {'total': len(contacts), 'confirmed': 0, 'exhausted': 0,
                   'inProgress': 0, 'skipped': 0, 'spent': 0},
        'truncated': truncated,
        'createdAt': now,
        'startedAt': '',
        'finishedAt': '',
    }
    try:
        table_run.put_item(Item=run_item)
    except Exception as e:
        print('Error guardando el run: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo crear la cascada.', 'data': {}}

    return {'status': True, 'statusCode': 201, 'description': 'Cascada creada',
            'data': {'cascadeRunId': run_id, 'total': len(contacts), 'truncated': truncated}}
