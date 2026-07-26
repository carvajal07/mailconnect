'''
Lambda de SERIE TEMPORAL del cliente: envíos/entregas/aperturas por DÍA de los últimos
N días (default 30) — la dimensión que faltaba en los tableros (sparklines + gráfico
de área), calculada BARATA desde el rollup {tenant}_sendSummary (GetItem por proceso;
sin escanear sendStatus).

Ruta: POST /Report/Series  (no-proxy, envelope estándar; identidad del Authorizer)
Request: { days? }   (default 30, máx. 90)
Respuesta 200 data: {
  from, to,                       # rango YYYY-MM-DD (inclusivo, continuo)
  days: [{date, enviados, entregados, abiertos, clics, rebotes, quejas}],
  totals: {enviados, entregados, abiertos, clics, rebotes, quejas},
  withoutRollup                   # procesos sin fila de resumen (aprox. por registersToSend)
}

Cómo: se listan los procesos del cliente (tabla `process` por customerName) del rango,
se EXCLUYEN las muestras, se leen sus resúmenes por lotes (BatchGetItem sobre
{tenant}_sendSummary) y se agrupan por el DÍA del proceso (métricas atribuidas a la
fecha de envío, como hacen las plataformas de email marketing). Un proceso sin fila de
rollup (histórico previo a la preagregación; correr scripts/backfill_send_summary.py)
aporta `registersToSend` como enviados (aproximación) y se cuenta en withoutRollup.

⚠️ [J] despliegue: crear la lambda (el CD la crea) + ruta /Report/Series (authorizer +
CORS + mapping template con customerId/customer/nit); IAM: Scan process, BatchGetItem
*_sendSummary.
'''
import re
import json
from datetime import datetime, timedelta

import boto3
from boto3.dynamodb.conditions import Attr

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_process = dynamodb.Table('process')

DEFAULT_DAYS = 30
MAX_DAYS = 90
MAX_PROCESSES = 1000   # tope defensivo (cada proceso cuesta 1 lectura de resumen)

MILESTONES = ('enviados', 'entregados', 'abiertos', 'clics', 'rebotes', 'quejas')


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para {tenant}_sendSummary. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _resolve_tenant(event):
    """(customer, nit) SOLO del context del Authorizer (multi-tenant obligatorio)."""
    auth = ((event or {}).get('requestContext') or {}).get('authorizer') or {}
    return auth.get('customer'), auth.get('nit')


def _is_sample_process(p):
    if p.get('isSamples'):
        return True
    if str(p.get('processState', '')) == 'Muestras':
        return True
    return str(p.get('campaignName', '')).endswith('-Samples')


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _scan_all(table, **kwargs):
    items = []
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            return items
        kwargs['ExclusiveStartKey'] = last


def _empty_day(date_str):
    d = {'date': date_str}
    for m in MILESTONES:
        d[m] = 0
    return d


def lambda_handler(event, context):
    payload = _get_payload(event)
    customer, nit = _resolve_tenant(event)
    if not customer:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}
    tenant = tenant_key(nit)

    days = min(max(_to_int(payload.get('days')) or DEFAULT_DAYS, 1), MAX_DAYS)
    today = datetime.utcnow().date()
    date_from = today - timedelta(days=days - 1)
    cutoff = date_from.strftime('%Y-%m-%d')

    try:
        # Procesos del cliente en el rango (la fecha ISO ordena lexicográficamente).
        processes = _scan_all(
            table_process,
            FilterExpression=Attr('customerName').eq(customer) & Attr('date').gte(cutoff))
        processes = [p for p in processes if not _is_sample_process(p)]
        processes.sort(key=lambda p: str(p.get('date', '')), reverse=True)
        processes = processes[:MAX_PROCESSES]

        # Rollup por proceso (BatchGetItem en lotes de 100).
        summary_by_pid = {}
        if tenant and processes:
            table_name = '{}_sendSummary'.format(tenant)
            pids = [str(p.get('processId', '')) for p in processes if p.get('processId')]
            for i in range(0, len(pids), 100):
                chunk = [{'processId': pid} for pid in pids[i:i + 100]]
                try:
                    resp = dynamodb.batch_get_item(RequestItems={table_name: {'Keys': chunk}})
                    for it in resp.get('Responses', {}).get(table_name, []):
                        summary_by_pid[str(it.get('processId'))] = it
                except Exception as e:
                    print('batch sendSummary: {}'.format(e))
                    break  # tabla ausente → todos caen a la aproximación

        # Serie CONTINUA (todos los días del rango, con ceros donde no hubo actividad).
        series = {}
        for i in range(days):
            d = (date_from + timedelta(days=i)).strftime('%Y-%m-%d')
            series[d] = _empty_day(d)

        totals = {m: 0 for m in MILESTONES}
        without_rollup = 0
        for p in processes:
            day = str(p.get('date', ''))[:10]
            if day not in series:
                continue
            summ = summary_by_pid.get(str(p.get('processId', '')))
            if summ:
                for m in MILESTONES:
                    v = _to_int(summ.get(m, 0))
                    series[day][m] += v
                    totals[m] += v
            else:
                # Sin rollup (histórico sin backfill): al menos los enviados del proceso.
                sent = _to_int(p.get('registersToSend', 0))
                series[day]['enviados'] += sent
                totals['enviados'] += sent
                without_rollup += 1

        return {'status': True, 'statusCode': 200,
                'description': 'Serie de actividad de {} días'.format(days),
                'data': {
                    'from': cutoff,
                    'to': today.strftime('%Y-%m-%d'),
                    'days': [series[k] for k in sorted(series.keys())],
                    'totals': totals,
                    'withoutRollup': without_rollup,
                }}
    except Exception as e:
        print('Error en Report/Series: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al calcular la serie', 'data': {}}
