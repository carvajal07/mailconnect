'''
Lambda ADMIN: PANEL DE SALUD DE DESPLIEGUE (Bloque K). Verifica, contra AWS, si los
recursos que el repo declara `[J]` EXISTEN de verdad — ataca la deriva "construido pero
no desplegado" (una lambda/tabla/cola/env que quedó en el código sin crearse en AWS).

Ruta: POST /Admin/Deployment-health  (no-proxy, envelope; admin-only + 2ª barrera JWT)
Respuesta 200 `data: { sections:[{key, title, level, ok, total, items:[{name, status,
  detail}]}], summary:{ok, warning, error, unknown}, generatedAt }`.
  status ∈ ok | missing | inactive | unwired | no-secret | unknown.

Qué verifica (best-effort: si falta el permiso IAM de un chequeo, ese ítem queda
`unknown`, no rompe el panel):
  - TABLAS núcleo (DescribeTable → ACTIVE). Las on-demand (assistantRateLimit,
    notificationLog) NO penalizan si faltan (se crean al primer uso).
  - COLAS del pipeline + sus DLQ (GetQueueUrl).
  - LAMBDAS críticas (GetFunctionConfiguration): existen; las admin/JWT llevan `SECRET_KEY`
    (sin ella la 2ª barrera cae al modo solo-context); las de pipeline tienen su event
    source mapping ENABLED (cola conectada).
  - Nº de funciones desplegadas (ListFunctions) como panorama.

⚠️ No es un inventario EXHAUSTIVO de las 90+ rutas: cubre el conjunto CRÍTICO (seguridad,
admin, pipeline y features recientes) donde la deriva es peligrosa. Al agregar una lambda
crítica nueva, súmala a CRITICAL_LAMBDAS.

[J]: ruta admin `/Admin/Deployment-health` + env `SECRET_KEY` (2ª barrera). IAM (todo
solo-lectura; cada chequeo es best-effort): `dynamodb:DescribeTable`, `sqs:GetQueueUrl`,
`lambda:GetFunctionConfiguration/ListFunctions/ListEventSourceMappings`.
'''
import os
import json
import boto3
from datetime import datetime, timezone
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb_client = boto3.client('dynamodb', region_name=REGION)
sqs = boto3.client('sqs', region_name=REGION)
lambda_client = boto3.client('lambda', region_name=REGION)

# ── Inventario esperado (mantener en sync con routes.json / trigger-map.json) ──
CORE_TABLES = ['user', 'customer', 'campaign', 'process', 'databaseFile', 'messageTemplate',
               'session', 'walletTransaction', 'customerBalance', 'scheduledSend',
               'pricingRate', 'platformConfig', 'adminAudit', 'senderDomain', 'sendingConfig']
# Tablas que las lambdas crean on-demand: si faltan, NO es error (aún no se han usado).
ONDEMAND_TABLES = ['assistantRateLimit', 'notificationLog']

PIPELINE_QUEUES = ['Email_Prepare-batch-part', 'Email_Send-batch-template-EM',
                   'Email_Send-batch-raw-EAU', 'Email_Send-batch-raw-EAP',
                   'Template_Combination-EAP', 'Template_Combination-EAP-PDF',
                   'Sms_Send-batch', 'Wsp_Send-batch', 'Voice_Send-batch']

# Lambdas críticas. Flags: secret=lleva SECRET_KEY (admin 2ª barrera / firma JWT);
# sqs=nombre de la cola que debe estar conectada por event source mapping.
CRITICAL_LAMBDAS = {
    # Autenticación / seguridad
    'Authorizer': {'secret': True}, 'Authorizer2': {'secret': True},
    'Api_V1_Security_Login': {'secret': True},
    'Api_V1_Security_Refresh-token': {'secret': True},
    'Api_V1_Security_Verify-2fa': {'secret': True},
    'Api_V1_Security_Totp': {},
    'Api_V1_Email_Unsubscribe': {'secret': True},
    'Api_V1_Email_Preferences': {'secret': True},
    # Admin (2ª barrera → necesitan SECRET_KEY)
    'Api_V1_Customer_List': {'secret': True}, 'Api_V1_Customer_Update': {'secret': True},
    'Api_V1_Admin_Dashboard': {'secret': True}, 'Api_V1_Admin_Control-center': {'secret': True},
    'Api_V1_Admin_Audit': {'secret': True}, 'Api_V1_Billing_Summary': {'secret': True},
    'Api_V1_Pricing_Update': {'secret': True}, 'Api_V1_Config_Set': {'secret': True},
    'Api_V1_User_SetRole': {'secret': True},
    'Api_V1_Admin_User-support': {'secret': True},
    'Api_V1_SendingConfig_Set': {'secret': True},
    # Pipeline de envío (cola conectada)
    'Api_V1_Email_Prepare-batch-template': {'sqs': 'Email_Prepare-batch-part'},
    'Api_V1_Email_Send-batch-template-EM': {'sqs': 'Email_Send-batch-template-EM'},
    'Api_V1_Email_Send-batch-template-EAU': {'sqs': 'Email_Send-batch-raw-EAU'},
    'Api_V1_Email_Send-batch-template-EAP': {'sqs': 'Email_Send-batch-raw-EAP'},
    'Api_V1_Template_Combination': {'sqs': 'Template_Combination-EAP'},
    'Api_V1_Template_Combination-EAP-PDF': {'sqs': 'Template_Combination-EAP-PDF'},
    'Api_V1_Sms_Send-batch': {'sqs': 'Sms_Send-batch'},
    'Api_V1_Wsp_Send-batch': {'sqs': 'Wsp_Send-batch'},
    'Api_V1_Voice_Send-batch': {'sqs': 'Voice_Send-batch'},
    # Features recientes (deriva típica "creada en el código, no en AWS")
    'Api_V1_Reports_Series': {}, 'Api_V1_Database_Verify': {},
    'Api_V1_Notifications_Prefs': {}, 'Api_V1_Notifications_Scan': {},
    'Api_V1_Assistant_Ask': {}, 'Api_V1_Assistant_Copilot': {},
}


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


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) ───────────────────────────
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json
import time as _time

_JWT_SECRET = os.environ.get('SECRET_KEY', '')


def _jwt_claims(token):
    try:
        header_b64, payload_b64, sig_b64 = str(token).split('.')

        def _dec(seg):
            return _b64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))

        expected = _hmac.new(_JWT_SECRET.encode(),
                             (header_b64 + '.' + payload_b64).encode(), _hashlib.sha256).digest()
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


# ── Chequeos (cada uno best-effort → status 'unknown' si falta el permiso) ────
def _check_tables():
    items = []
    ok = 0
    for name in CORE_TABLES:
        try:
            st = dynamodb_client.describe_table(TableName=name)['Table']['TableStatus']
            if st == 'ACTIVE':
                items.append({'name': name, 'status': 'ok', 'detail': 'ACTIVE'})
                ok += 1
            else:
                items.append({'name': name, 'status': 'inactive', 'detail': st})
        except ClientError as e:
            code = e.response['Error']['Code']
            if code == 'ResourceNotFoundException':
                items.append({'name': name, 'status': 'missing', 'detail': 'no existe en AWS'})
            else:
                items.append({'name': name, 'status': 'unknown', 'detail': code})
                ok += 1  # sin permiso para verificar → no penaliza
        except Exception as e:
            items.append({'name': name, 'status': 'unknown', 'detail': str(e)[:60]})
            ok += 1
    for name in ONDEMAND_TABLES:
        try:
            dynamodb_client.describe_table(TableName=name)
            items.append({'name': name, 'status': 'ok', 'detail': 'ACTIVE'})
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                items.append({'name': name, 'status': 'ok',
                              'detail': 'aún no creada (on-demand; no penaliza)'})
            else:
                items.append({'name': name, 'status': 'unknown', 'detail': e.response['Error']['Code']})
        except Exception as e:
            items.append({'name': name, 'status': 'unknown', 'detail': str(e)[:60]})
    total = len(CORE_TABLES)
    level = 'ok' if ok == total else ('error' if ok < total * 0.8 else 'warning')
    return {'key': 'tables', 'title': 'Tablas DynamoDB núcleo', 'level': level,
            'ok': ok, 'total': total, 'items': items}


def _check_queues():
    items = []
    ok = 0
    total = 0
    for q in PIPELINE_QUEUES:
        for name in (q, '{}-dlq'.format(q)):
            total += 1
            try:
                sqs.get_queue_url(QueueName=name)
                items.append({'name': name, 'status': 'ok', 'detail': 'existe'})
                ok += 1
            except ClientError as e:
                if e.response['Error']['Code'].endswith('NonExistentQueue'):
                    items.append({'name': name, 'status': 'missing', 'detail': 'no existe'})
                else:
                    items.append({'name': name, 'status': 'unknown', 'detail': e.response['Error']['Code']})
                    ok += 1
            except Exception as e:
                items.append({'name': name, 'status': 'unknown', 'detail': str(e)[:60]})
                ok += 1
    level = 'ok' if ok == total else ('error' if ok < total * 0.8 else 'warning')
    return {'key': 'queues', 'title': 'Colas SQS del pipeline (+ DLQ)', 'level': level,
            'ok': ok, 'total': total, 'items': items}


def _lambda_conf(name):
    try:
        return lambda_client.get_function_configuration(FunctionName=name), None
    except ClientError as e:
        return None, e.response['Error']['Code']
    except Exception as e:
        return None, str(e)[:60]


def _has_enabled_mapping(name):
    try:
        maps = lambda_client.list_event_source_mappings(FunctionName=name).get('EventSourceMappings', [])
        return any(str(m.get('State', '')).lower() in ('enabled', 'creating') for m in maps), None
    except ClientError as e:
        return None, e.response['Error']['Code']
    except Exception as e:
        return None, str(e)[:60]


def _check_lambdas():
    items = []
    ok = 0
    total = len(CRITICAL_LAMBDAS)
    for name, flags in sorted(CRITICAL_LAMBDAS.items()):
        conf, err = _lambda_conf(name)
        if conf is None and err in ('ResourceNotFoundException',):
            items.append({'name': name, 'status': 'missing', 'detail': 'la función no existe en AWS'})
            continue
        if conf is None:
            items.append({'name': name, 'status': 'unknown', 'detail': err or 'sin acceso'})
            ok += 1
            continue
        problems = []
        if flags.get('secret'):
            envs = (conf.get('Environment') or {}).get('Variables') or {}
            if not str(envs.get('SECRET_KEY', '')):
                problems.append('falta SECRET_KEY')
        if flags.get('sqs'):
            wired, werr = _has_enabled_mapping(name)
            if wired is False:
                problems.append('sin cola conectada ({})'.format(flags['sqs']))
            elif wired is None:
                problems.append('trigger no verificable ({})'.format(werr))
        runtime = conf.get('Runtime', '')
        if problems:
            status = 'no-secret' if any('SECRET_KEY' in p for p in problems) else 'unwired'
            items.append({'name': name, 'status': status,
                          'detail': '; '.join(problems) + ' · {}'.format(runtime)})
        else:
            items.append({'name': name, 'status': 'ok', 'detail': runtime or 'desplegada'})
            ok += 1
    level = 'ok' if ok == total else ('error' if ok < total * 0.85 else 'warning')
    return {'key': 'lambdas', 'title': 'Lambdas críticas (existencia · SECRET_KEY · trigger)',
            'level': level, 'ok': ok, 'total': total, 'items': items}


def _deployed_overview():
    try:
        count = 0
        kwargs = {}
        while True:
            resp = lambda_client.list_functions(**kwargs)
            count += len(resp.get('Functions', []))
            marker = resp.get('NextMarker')
            if not marker:
                break
            kwargs['Marker'] = marker
        return {'key': 'overview', 'title': 'Funciones desplegadas (total en AWS)',
                'level': 'ok', 'ok': count, 'total': count,
                'items': [{'name': 'Lambdas en la cuenta', 'status': 'ok',
                           'detail': '{} funciones'.format(count)}]}
    except Exception as e:
        return {'key': 'overview', 'title': 'Funciones desplegadas (total en AWS)',
                'level': 'warning', 'ok': 0, 'total': 0,
                'items': [{'name': 'Lambdas en la cuenta', 'status': 'unknown',
                           'detail': str(e)[:80]}]}


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}
    _get_payload(event)
    try:
        sections = [_check_tables(), _check_queues(), _check_lambdas(), _deployed_overview()]
        summary = {'ok': 0, 'warning': 0, 'error': 0, 'unknown': 0}
        for s in sections:
            for it in s['items']:
                st = it['status']
                if st == 'ok':
                    summary['ok'] += 1
                elif st in ('missing', 'inactive'):
                    summary['error'] += 1
                elif st in ('no-secret', 'unwired'):
                    summary['warning'] += 1
                else:
                    summary['unknown'] += 1
        return {'status': True, 'statusCode': 200,
                'description': 'Salud de despliegue',
                'data': {'sections': sections, 'summary': summary,
                         'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}}
    except Exception as e:
        print('Error en Deployment-health: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al verificar el despliegue', 'data': {}}
