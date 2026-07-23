import os
import re
import json
import csv
import io
import ast
import base64
import boto3
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from botocore.config import Config

_dynamo = boto3.resource("dynamodb", config=Config(retries={"max_attempts": 10, "mode": "standard"}))
_s3 = boto3.client("s3", config=Config(retries={"max_attempts": 10, "mode": "standard"}))


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para las tablas por cliente ({tenant}_sendStatus,
    _sendDetail). Igual que en Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())

# ---- Mapeo SES: descripción -> número (tu tabla) y su inverso número -> descripción
STATE_SES_MAPPING = {
    'Send': 1,
    'Delivery': 2,
    'Reject': 3,
    'Open': 4,
    'Click': 5,
    'Bounce': 6,
    'Complaint': 7,
    'Rendering Failure': 8,
    'DeliveryDelay': 9,
    'Subscription': 10
}
STATE_BY_NUMBER = {str(v): k for k, v in STATE_SES_MAPPING.items()}  # ej: "4" -> "Open"

def _scan_all(table):
    last_key = None
    while True:
        if last_key:
            resp = table.scan(ExclusiveStartKey=last_key)
        else:
            resp = table.scan()
        for item in resp.get("Items", []):
            yield item
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break


def _query_process(table, process_id):
    """Estados de UN proceso desde la tabla única {cliente}_sendStatus (PK processId)."""
    from boto3.dynamodb.conditions import Key
    last_key = None
    while True:
        kwargs = {'KeyConditionExpression': Key('processId').eq(process_id)}
        if last_key:
            kwargs['ExclusiveStartKey'] = last_key
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            yield item
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break

def _parse_data_field(raw):
    if not isinstance(raw, str):
        return []
    try:
        lst = ast.literal_eval(raw)
        return lst if isinstance(lst, list) else []
    except Exception:
        return []

def _now_utc_compact():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

def _csv_safe(value):
    """Neutraliza inyección de fórmulas CSV/Excel: si el valor empieza con
    = + - @ (o tab/CR), se antepone un apóstrofo para que Excel no lo ejecute."""
    s = "" if value is None else str(value)
    if s and s[0] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + s
    return s


def _write_csv_semicolon(rows, header):
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=header, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    for r in rows:
        writer.writerow({k: _csv_safe(v) for k, v in r.items()})
    text = buf.getvalue()
    buf.close()
    return text, text.encode("utf-8")

def _parse_iso_dt(s):
    # Maneja formatos ISO8601 con 'Z' al final
    try:
        if isinstance(s, str) and s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        return datetime.fromisoformat(s)
    except Exception:
        return None

def build_report(cliente: str, id_proceso: str, s3_bucket: str | None, s3_prefix: str | None):
    # Tablas ÚNICAS del cliente (antes: una por proceso). Se consultan por processId.
    table_detail_name = f"{cliente}_sendDetail"
    table_status_name = f"{cliente}_sendStatus"
    table_detail = _dynamo.Table(table_detail_name)
    table_status = _dynamo.Table(table_status_name)

    # 1) Leer sendStatus del proceso y conservar SOLO el último por messageId (date más reciente)
    latest_status_by_msgid = {}
    for it in _query_process(table_status, id_proceso):
        message_id = it.get("messageId") or it.get("MessageId")
        if not message_id:
            continue

        date_s = it.get("date", "")
        dt = _parse_iso_dt(date_s) or datetime.min.replace(tzinfo=timezone.utc)
        # Convertir de UTC a hora de Colombia (America/Bogota)
        dt_col = dt.astimezone(ZoneInfo("America/Bogota"))
        date_col_str = dt_col.strftime("%Y-%m-%d %H:%M:%S")

        curr = latest_status_by_msgid.get(message_id)
        if (curr is None) or (dt > curr["__dt"]):
            # Normaliza state como string
            state_raw = it.get("state", "")
            state_str = str(state_raw) if state_raw is not None else ""
            state_desc = STATE_BY_NUMBER.get(state_str, "")  # "" si no mapea

            latest_status_by_msgid[message_id] = {
                "__dt": dt,                 # campo interno para comparar
                "date": date_col_str,
                "state": state_str,
                "state_desc": state_desc,
                "type1": it.get("type1", ""),
                "type2": it.get("type2", ""),
            }

    # 2) Leer sendDetail del proceso (Query por processId, tabla única) y unir por
    #    sendDetailId == messageId (solo si hay status más reciente)
    header = ["uniqueId", "email", "nombre", "date", "state", "state_desc", "type1", "type2"]
    rows = []

    for it in _query_process(table_detail, id_proceso):
        send_detail_id = it.get("sendDetailId") or it.get("SendDetailId")
        if not send_detail_id:
            continue

        st = latest_status_by_msgid.get(send_detail_id)
        if not st:
            # sin estado asociado -> omitir (tu reporte requiere date/state/type1/type2 del status)
            continue

        unique_id = it.get("uniqueId", "")
        email = it.get("email", "")
        data_list = _parse_data_field(it.get("data", ""))
        nombre = data_list[4].strip() if (len(data_list) > 4 and isinstance(data_list[4], str)) else ""

        rows.append({
            "uniqueId": unique_id,
            "email": email,
            "nombre": nombre,
            "date": st["date"],
            "state": st["state"],               # num como string (p.ej. "4")
            "state_desc": st["state_desc"],     # p.ej. "Open"
            "type1": st["type1"],
            "type2": st["type2"],
        })

    csv_text, csv_bytes = _write_csv_semicolon(rows, header)

    s3_key = None
    if s3_bucket:
        prefix = (s3_prefix or f"{cliente}/{id_proceso}").strip("/")
        s3_key = f"{prefix}/send_report_{_now_utc_compact()}.csv"
        _s3.put_object(Bucket=s3_bucket, Key=s3_key, Body=csv_bytes, ContentType="text/csv; charset=utf-8")

    return {
        "count": len(rows),
        "s3_bucket": s3_bucket,
        "s3_key": s3_key,
        "csv_preview": "\n".join(csv_text.splitlines()[:5]),
        "csv_base64": base64.b64encode(csv_bytes).decode("ascii") if not s3_bucket else None,
    }



def lambda_handler(event, context):
    try:
        # El cliente (tenant) SIEMPRE sale del Authorizer, NO del body: si no,
        # cualquier usuario descargaría el reporte (con correos/nombres) de otro
        # cliente. Sin context del token se deniega. La llave de las tablas por cliente es
        # el NIT saneado (tenant_key), igual que en el resto de la plataforma.
        auth = (event.get("requestContext") or {}).get("authorizer") or {} if isinstance(event, dict) else {}
        cliente = tenant_key(auth.get("nit") or "")
        if not cliente:
            return {"statusCode": 403, "body": json.dumps({"error": "Sesión sin identidad de cliente."})}

        # El body puede llegar como objeto (integración no-proxy con mapping template →
        # event['body']), como string JSON (proxy) o, sin template, como el propio event.
        # El tenant (nit) SIEMPRE sale del Authorizer (arriba), nunca del body.
        _b = event.get("body") if isinstance(event, dict) else None
        if isinstance(_b, str):
            try:
                _b = json.loads(_b)
            except Exception:
                _b = None
        payload = _b if isinstance(_b, dict) else (event if isinstance(event, dict) else {})
        id_proceso = (payload.get("idProceso") or event.get("idProceso")
                      or os.environ.get("ID_PROCESO") or "").strip()

        if not cliente or not id_proceso:
            return {"statusCode": 400, "body": json.dumps({"error": "Faltan 'cliente' o 'idProceso'."})}

        # El bucket/prefijo de salida NO se toman del request (evita exfiltración a
        # un bucket ajeno). Solo por configuración del servidor.
        s3_bucket = (os.environ.get("OUTPUT_BUCKET") or "").strip() or None
        s3_prefix = (os.environ.get("OUTPUT_PREFIX") or "").strip() or None

        result = build_report(cliente, id_proceso, s3_bucket, s3_prefix)
        return {"statusCode": 200, "body": json.dumps(result, ensure_ascii=False)}
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
