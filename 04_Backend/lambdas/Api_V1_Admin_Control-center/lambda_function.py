'''
Lambda ADMIN del CENTRO DE MANDO: tablero de OPERACIÓN en vivo (no de métricas
históricas). Agrega en una sola llamada lo que un operador necesita cada mañana:

Ruta: POST /Admin/Control-center  (no-proxy, envelope estándar, admin-only)
Request: {}   (sin parámetros; todo es "estado actual")
Respuesta 200 data:
  pipeline: {
    stuckProcesses: [{processId, customerName, campaignName, processState, date, hoursStuck}],
    stuckCount,                       # atascados totales (la lista muestra los primeros)
    failedSchedules: [{scheduleId, campaignName, customerId, scheduledAt, error}],
    queues: [{queue, depth, oldestSeconds, dlqDepth, level(ok|warning|critical), error?}],
  }
  money: {
    todayDebits, todayDebitsCount,    # débitos de envío de HOY (COP)
    todayTopups, todayTopupsCount,    # recargas ACREDITADAS hoy (manual aprobada/wompi/ajuste)
    pendingTopups: {count, amount},   # solicitudes manuales sin revisar (bandeja)
    platformBalance,                  # suma del saldo de todos los clientes
  }
  reputation: [{company, tenant, sent, bounceRate, complaintRate, level, trend(up|down|flat),
                prevBounceRate}],     # top 5 en riesgo, últimos 7 días vs los 7 anteriores
  health: { services: [{service, status(ok|warning|error), detail}] }
  audit: [{date, actor, action, target, detail}]   # últimas 10 acciones admin
  generatedAt

Fuentes: tablas existentes (process, scheduledSend, walletTransaction, customerBalance,
adminAudit, {tenant}_sendSummary) + SQS GetQueueAttributes + SES GetSendQuota. Cada
sección es BEST-EFFORT e independiente: si una falla, las demás salen igual (la sección
reporta su error). Los topes de escaneo evitan que el tablero se vuelva caro con volumen.

⚠️ [J] despliegue: ruta /Admin/Control-center (admin) + env SECRET_KEY; IAM: Scan sobre
process/scheduledSend/walletTransaction/customerBalance/adminAudit, BatchGetItem sobre
*_sendSummary, sqs:GetQueueUrl/GetQueueAttributes, ses:GetSendQuota/GetAccountSendingEnabled,
dynamodb:DescribeTable (salud de tablas).
'''
import json
import time
from datetime import datetime, timedelta
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
ddb_client = boto3.client('dynamodb', region_name=REGION)
sqs = boto3.client('sqs', region_name=REGION)
ses = boto3.client('ses', region_name=REGION)

# Un proceso en estos estados por MÁS de STUCK_HOURS horas se considera atascado.
STUCK_STATES = ('Enviando', 'Procesando')
STUCK_HOURS = 2
MAX_STUCK_SHOWN = 15
MAX_FAILED_SCHEDULES = 10
MAX_AUDIT_TAIL = 10

# Colas del pipeline (las de trigger-map.json); cada una tiene su DLQ {cola}-dlq.
PIPELINE_QUEUES = [
    'Email_Prepare-batch-part',
    'Email_Send-batch-template-EM',
    'Email_Send-batch-raw-EAU',
    'Email_Send-batch-raw-EAP',
    'Template_Combination-EAP',
    'Template_Combination-EAP-PDF',
    'Sms_Send-batch',
    'Wsp_Send-batch',
    'Voice_Send-batch',
]
QUEUE_DEPTH_WARNING = 1000       # backlog alto
QUEUE_OLDEST_WARNING_S = 1800    # mensaje esperando > 30 min

# Tablas núcleo cuya existencia/estado se verifica en la salud de servicios.
CORE_TABLES = ['user', 'customer', 'campaign', 'process', 'walletTransaction',
               'customerBalance', 'scheduledSend', 'messageTemplate', 'adminAudit']

# Reputación: mismos umbrales de referencia SES del Admin/Dashboard.
BOUNCE_WARNING, BOUNCE_CRITICAL = 0.05, 0.10
COMPLAINT_WARNING, COMPLAINT_CRITICAL = 0.001, 0.005
REPUTATION_WINDOW_DAYS = 7
MAX_REPUTATION_PROCESSES = 400   # tope de procesos agregados (14 días)
MAX_REPUTATION_TENANTS = 30
TOP_REPUTATION = 5

SES_QUOTA_WARNING = 0.80         # >80% de la cuota diaria usada


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) ───────────────────────────
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json
import os as _os
import time as _time

_JWT_SECRET = _os.environ.get('SECRET_KEY', '')


def _jwt_claims(token):
    try:
        header_b64, payload_b64, sig_b64 = str(token).split('.')

        def _dec(seg):
            return _b64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))

        expected = _hmac.new(_JWT_SECRET.encode(),
                             (header_b64 + '.' + payload_b64).encode(),
                             _hashlib.sha256).digest()
        if not _hmac.compare_digest(_dec(sig_b64), expected):
            return None
        if _json.loads(_dec(header_b64)).get('alg') != 'HS256':
            return None
        claims = _json.loads(_dec(payload_b64))
        exp = claims.get('exp')
        if exp is not None and _time.time() >= float(exp):
            return None
        return claims if isinstance(claims, dict) else None
    except Exception:
        return None


def _bearer_token(event):
    raw = ''
    if isinstance(event, dict):
        for k, v in (event.get('headers') or {}).items():
            if str(k).lower() == 'authorization' and v:
                raw = v
                break
        if not raw:
            raw = event.get('authToken') or ''
        if not raw and isinstance(event.get('body'), dict):
            raw = event['body'].get('authToken') or ''
    raw = str(raw).strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return raw


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    context_admin = str(auth.get('role', '')).lower() == 'admin'
    if not _JWT_SECRET:
        print('ADVERTENCIA: SECRET_KEY no configurada; gate admin solo por context.')
        return context_admin
    claims = _jwt_claims(_bearer_token(event))
    return bool(claims) and str(claims.get('role', '')).lower() == 'admin'


# ── Helpers ──────────────────────────────────────────────────────────────────

def _n(v):
    """Decimal→int/float para serializar a JSON."""
    if isinstance(v, Decimal):
        return int(v) if v == int(v) else float(v)
    return v


def _scan_all(table, cap_pages=8, **kwargs):
    """Scan paginado con tope de páginas (cada página ≤1 MB). Devuelve (items, truncated)."""
    items = []
    pages = 0
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get('Items', []))
        pages += 1
        last = resp.get('LastEvaluatedKey')
        if not last or pages >= cap_pages:
            return items, bool(last and pages >= cap_pages)
        kwargs['ExclusiveStartKey'] = last


def _parse_iso(s):
    """'2026-07-26T12:34:56.789Z' (o sin ms) → datetime naive UTC; None si no parsea."""
    s = str(s or '').strip().rstrip('Z')
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _is_sample_process(p):
    """Mismo criterio que reportes/facturación: marca isSamples con fallbacks legacy."""
    if bool(p.get('isSamples')):
        return True
    if str(p.get('processState', '')) == 'Muestras':
        return True
    return str(p.get('campaignName', '')).endswith('-Samples')


# ── Secciones (cada una best-effort) ─────────────────────────────────────────

def _section_pipeline(now):
    out = {'stuckProcesses': [], 'stuckCount': 0, 'failedSchedules': [], 'queues': []}

    # Procesos atascados: en estado de envío hace más de STUCK_HOURS.
    try:
        items, _ = _scan_all(
            dynamodb.Table('process'), cap_pages=8,
            FilterExpression='#s IN (:a, :b)',
            ExpressionAttributeNames={'#s': 'processState', '#d': 'date'},
            ExpressionAttributeValues={':a': STUCK_STATES[0], ':b': STUCK_STATES[1]},
            ProjectionExpression='processId, customerName, campaignName, #s, #d',
        )
    except Exception as e:
        out['error'] = 'process: {}'.format(e)
        items = []
    stuck = []
    for p in items or []:
        dt = _parse_iso(p.get('date'))
        if not dt:
            continue
        hours = (now - dt).total_seconds() / 3600.0
        if hours >= STUCK_HOURS:
            stuck.append({
                'processId': p.get('processId', ''),
                'customerName': p.get('customerName', ''),
                'campaignName': p.get('campaignName', ''),
                'processState': p.get('processState', ''),
                'date': p.get('date', ''),
                'hoursStuck': round(hours, 1),
            })
    stuck.sort(key=lambda x: -x['hoursStuck'])
    out['stuckCount'] = len(stuck)
    out['stuckProcesses'] = stuck[:MAX_STUCK_SHOWN]

    # Schedules fallidos (los pending vencidos ya los recoge el barrido; aquí los failed).
    try:
        items, _ = _scan_all(
            dynamodb.Table('scheduledSend'), cap_pages=4,
            FilterExpression='#s = :f',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':f': 'failed'})
        items.sort(key=lambda x: str(x.get('scheduledAt', '')), reverse=True)
        out['failedSchedules'] = [{
            'scheduleId': i.get('scheduleId', ''),
            'campaignName': i.get('campaignName', '') or i.get('campaignId', ''),
            'customerId': i.get('customerId', ''),
            'scheduledAt': i.get('scheduledAt', ''),
            'error': str(i.get('error', ''))[:200],
        } for i in items[:MAX_FAILED_SCHEDULES]]
    except Exception as e:
        out.setdefault('error', '')
        out['error'] = (out['error'] + ' scheduledSend: {}'.format(e)).strip()

    # Profundidad de colas + DLQs (una llamada por cola; barato).
    for qname in PIPELINE_QUEUES:
        row = {'queue': qname, 'depth': 0, 'oldestSeconds': 0, 'dlqDepth': 0, 'level': 'ok'}
        try:
            qurl = sqs.get_queue_url(QueueName=qname)['QueueUrl']
            attrs = sqs.get_queue_attributes(
                QueueUrl=qurl,
                AttributeNames=['ApproximateNumberOfMessages', 'ApproximateAgeOfOldestMessage'],
            )['Attributes']
            row['depth'] = int(attrs.get('ApproximateNumberOfMessages', 0))
            row['oldestSeconds'] = int(attrs.get('ApproximateAgeOfOldestMessage', 0))
        except Exception as e:
            row['error'] = 'cola: {}'.format(type(e).__name__)
        try:
            dlq_url = sqs.get_queue_url(QueueName=qname + '-dlq')['QueueUrl']
            dlq_attrs = sqs.get_queue_attributes(
                QueueUrl=dlq_url, AttributeNames=['ApproximateNumberOfMessages'])['Attributes']
            row['dlqDepth'] = int(dlq_attrs.get('ApproximateNumberOfMessages', 0))
        except Exception:
            pass  # sin DLQ aún (no desplegada): no es alarma
        if row['dlqDepth'] > 0:
            row['level'] = 'critical'
        elif row['depth'] > QUEUE_DEPTH_WARNING or row['oldestSeconds'] > QUEUE_OLDEST_WARNING_S:
            row['level'] = 'warning'
        out['queues'].append(row)
    return out


def _section_money(now):
    today = now.strftime('%Y-%m-%d')
    out = {'todayDebits': 0, 'todayDebitsCount': 0, 'todayTopups': 0, 'todayTopupsCount': 0,
           'pendingTopups': {'count': 0, 'amount': 0}, 'platformBalance': 0}
    try:
        items, truncated = _scan_all(dynamodb.Table('walletTransaction'), cap_pages=8)
        for t in items:
            created = str(t.get('createdAt', ''))
            amount = _n(t.get('amount', 0)) or 0
            ttype = str(t.get('type', ''))
            status = str(t.get('status', '') or '')
            if ttype == 'topup_manual' and status == 'pending':
                out['pendingTopups']['count'] += 1
                out['pendingTopups']['amount'] += abs(amount)
            if not created.startswith(today):
                continue
            if ttype == 'debit_send':
                out['todayDebits'] += abs(amount)
                out['todayDebitsCount'] += 1
            elif ttype in ('topup_manual', 'topup_wompi', 'adjustment') and status not in ('pending', 'declined'):
                out['todayTopups'] += abs(amount)
                out['todayTopupsCount'] += 1
        out['truncated'] = truncated
    except Exception as e:
        out['error'] = 'walletTransaction: {}'.format(e)
    try:
        balances, _ = _scan_all(dynamodb.Table('customerBalance'), cap_pages=4)
        out['platformBalance'] = sum(_n(b.get('balance', 0)) or 0 for b in balances)
    except Exception as e:
        out.setdefault('error', '')
        out['error'] = (out['error'] + ' customerBalance: {}'.format(e)).strip()
    return out


def _tenant_key(nit):
    import re
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def _section_reputation(now):
    """Top clientes en riesgo (rebote/queja) con TENDENCIA: últimos 7 días vs los 7
    anteriores, leyendo el ROLLUP {tenant}_sendSummary por processId (barato: el
    rollup lo mantiene bump_send_summary; no se escanea sendStatus)."""
    out = {'top': [], 'truncated': False}
    cutoff_prev = (now - timedelta(days=2 * REPUTATION_WINDOW_DAYS)).strftime('%Y-%m-%dT%H:%M:%S')
    cutoff_last = (now - timedelta(days=REPUTATION_WINDOW_DAYS)).strftime('%Y-%m-%dT%H:%M:%S')
    try:
        items, truncated = _scan_all(
            dynamodb.Table('process'), cap_pages=8,
            FilterExpression='#d >= :cut',
            ExpressionAttributeNames={'#d': 'date'},
            ExpressionAttributeValues={':cut': cutoff_prev})
        out['truncated'] = truncated
    except Exception as e:
        out['error'] = 'process: {}'.format(e)
        return out

    items = [p for p in items if not _is_sample_process(p)]
    items.sort(key=lambda p: str(p.get('date', '')), reverse=True)
    items = items[:MAX_REPUTATION_PROCESSES]

    tenants = {}
    for p in items:
        tenant = _tenant_key(p.get('companyTin'))
        if not tenant:
            continue
        e = tenants.setdefault(tenant, {'company': p.get('customerName', ''), 'last': [], 'prev': []})
        window = 'last' if str(p.get('date', '')) >= cutoff_last else 'prev'
        e[window].append(str(p.get('processId', '')))

    rows = []
    for tenant, info in list(tenants.items())[:MAX_REPUTATION_TENANTS]:
        table_name = '{}_sendSummary'.format(tenant)

        def _window_totals(pids):
            tot = {'enviados': 0, 'rebotes': 0, 'quejas': 0}
            for i in range(0, len(pids), 100):
                chunk = [{'processId': pid} for pid in pids[i:i + 100] if pid]
                if not chunk:
                    continue
                try:
                    resp = dynamodb.batch_get_item(RequestItems={table_name: {'Keys': chunk}})
                    for it in resp.get('Responses', {}).get(table_name, []):
                        for k in tot:
                            tot[k] += int(_n(it.get(k, 0)) or 0)
                except Exception:
                    return None  # tabla del tenant ausente → sin datos (no rompe)
            return tot

        last = _window_totals(info['last'])
        prev = _window_totals(info['prev'])
        if not last or last['enviados'] <= 0:
            continue
        br = last['rebotes'] / last['enviados']
        cr = last['quejas'] / last['enviados']
        prev_br = (prev['rebotes'] / prev['enviados']) if prev and prev['enviados'] else None

        if br >= BOUNCE_CRITICAL or cr >= COMPLAINT_CRITICAL:
            level = 'critical'
        elif br >= BOUNCE_WARNING or cr >= COMPLAINT_WARNING:
            level = 'warning'
        else:
            level = 'ok'
        if prev_br is None:
            trend = 'flat'
        elif br - prev_br > 0.005:
            trend = 'up'      # empeorando
        elif prev_br - br > 0.005:
            trend = 'down'    # mejorando
        else:
            trend = 'flat'
        rows.append({'company': info['company'], 'tenant': tenant, 'sent': last['enviados'],
                     'bounceRate': round(br, 4), 'complaintRate': round(cr, 4),
                     'prevBounceRate': round(prev_br, 4) if prev_br is not None else None,
                     'level': level, 'trend': trend})

    level_rank = {'critical': 0, 'warning': 1, 'ok': 2}
    rows.sort(key=lambda r: (level_rank[r['level']], -r['bounceRate'], -r['sent']))
    out['top'] = rows[:TOP_REPUTATION]
    return out


def _section_health():
    services = []

    # SES: cuota de envío diaria + habilitación de la cuenta.
    try:
        quota = ses.get_send_quota()
        max24 = float(quota.get('Max24HourSend', 0) or 0)
        sent24 = float(quota.get('SentLast24Hours', 0) or 0)
        rate = float(quota.get('MaxSendRate', 0) or 0)
        usage = (sent24 / max24) if max24 > 0 else 0
        status = 'warning' if usage >= SES_QUOTA_WARNING else 'ok'
        detail = 'Cuota 24h: {:.0f}/{:.0f} ({:.0f}%) · {} correos/seg'.format(
            sent24, max24, usage * 100, int(rate))
        try:
            enabled = ses.get_account_sending_enabled().get('Enabled', True)
            if not enabled:
                status, detail = 'error', 'ENVÍO DESHABILITADO en la cuenta SES. ' + detail
        except Exception:
            pass
        services.append({'service': 'SES (correo)', 'status': status, 'detail': detail,
                         'metric': {'used': sent24, 'max': max24, 'pct': round(usage * 100, 1)}})
    except Exception as e:
        services.append({'service': 'SES (correo)', 'status': 'error',
                         'detail': 'No consultable: {}'.format(type(e).__name__)})

    # DynamoDB: tablas núcleo presentes y ACTIVE.
    missing, inactive = [], []
    for t in CORE_TABLES:
        try:
            st = ddb_client.describe_table(TableName=t)['Table']['TableStatus']
            if st != 'ACTIVE':
                inactive.append('{}({})'.format(t, st))
        except ClientError as ce:
            if ce.response.get('Error', {}).get('Code') == 'ResourceNotFoundException':
                missing.append(t)
            else:
                inactive.append('{}(?)'.format(t))
        except Exception:
            inactive.append('{}(?)'.format(t))
    if missing:
        services.append({'service': 'DynamoDB (tablas núcleo)', 'status': 'error',
                         'detail': 'Faltan: {}'.format(', '.join(missing))})
    elif inactive:
        services.append({'service': 'DynamoDB (tablas núcleo)', 'status': 'warning',
                         'detail': 'No activas: {}'.format(', '.join(inactive))})
    else:
        services.append({'service': 'DynamoDB (tablas núcleo)', 'status': 'ok',
                         'detail': '{} tablas activas'.format(len(CORE_TABLES))})

    # SQS: accesibilidad de las colas del pipeline (el detalle por cola va en pipeline.queues).
    reachable = 0
    for q in PIPELINE_QUEUES:
        try:
            sqs.get_queue_url(QueueName=q)
            reachable += 1
        except Exception:
            pass
    status = 'ok' if reachable == len(PIPELINE_QUEUES) else ('warning' if reachable else 'error')
    services.append({'service': 'SQS (colas del pipeline)', 'status': status,
                     'detail': '{}/{} colas accesibles'.format(reachable, len(PIPELINE_QUEUES))})

    return {'services': services}


def _section_audit():
    try:
        items, _ = _scan_all(dynamodb.Table('adminAudit'), cap_pages=4)
        items.sort(key=lambda x: str(x.get('date', '')), reverse=True)
        return [{
            'date': i.get('date', ''),
            'actor': i.get('actor', ''),
            'action': i.get('action', ''),
            'target': i.get('target', ''),
            'detail': str(i.get('detail', ''))[:160],
        } for i in items[:MAX_AUDIT_TAIL]]
    except Exception as e:
        print('audit tail: {}'.format(e))
        return []


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}
    now = datetime.utcnow()
    data = {
        'pipeline': _section_pipeline(now),
        'money': _section_money(now),
        'reputation': _section_reputation(now),
        'health': _section_health(),
        'audit': _section_audit(),
        'generatedAt': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    return {'status': True, 'statusCode': 200,
            'description': 'Centro de mando', 'data': json.loads(json.dumps(data, default=_n))}
