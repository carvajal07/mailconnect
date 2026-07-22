"""
Idempotencia de los workers de ENVÍO (anti-duplicado por redelivery de SQS).

Garantía que cubre esta suite: una redelivery del mismo mensaje SQS (entrega
at-least-once, o vencimiento del visibility timeout en un lote lento) NO reenvía el
lote. El mecanismo es un "claim" ATÓMICO de (processId, part) por etapa: una escritura
condicional `attribute_not_exists` sobre la clave DETERMINISTA `processId#part#stage`
en {tenant}_processDetail. Solo la PRIMERA entrega gana; la duplicada se descarta.

Reemplaza el patrón anterior (scan + put con uuid ALEATORIO), que NO era atómico y a
escala ni siquiera encontraba la fila (scan de una sola página de 1 MB). En SMS/Voz/
WhatsApp/EAU/EAP directamente NO había guarda → cada redelivery reenviaba (y en los
canales telefónicos eso cuesta dinero real y llega al teléfono de una persona).

Usa moto (DynamoDB). Los clientes de envío (pinpoint-sms-voice-v2 / socialmessaging /
ses) se mockean por monkeypatch.
"""
import os
import json
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAM = REPO_ROOT / '04_Backend' / 'lambdas'

NIT = '900123456'
TENANT = '900123456'   # tenant_key(NIT)

# Workers de ENVÍO que comparten el primitivo _claim_part (clave del anti-duplicado).
WORKER_MODULES = {
    'sms':  LAM / 'Api_V1_Sms_Send-batch' / 'lambda_function.py',
    'voice': LAM / 'Api_V1_Voice_Send-batch' / 'lambda_function.py',
    'wsp':  LAM / 'Api_V1_Wsp_Send-batch' / 'lambda_function.py',
    'em':   LAM / 'Api_V1_Email_Send-batch-template-EM' / 'lambda_function.py',
    'eau':  LAM / 'Api_V1_Email_Send-batch-template-EAU' / 'lambda_function.py',
    'eap':  LAM / 'Api_V1_Email_Send-batch-template-EAP' / 'lambda_function.py',
}


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, str(path))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _mk_process_detail_table():
    """Tabla {tenant}_processDetail (PK processDetailId), donde se hace el claim atómico."""
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=f'{TENANT}_processDetail',
        KeySchema=[{'AttributeName': 'processDetailId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'processDetailId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _mk_send_status_table():
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=f'{TENANT}_sendStatus',
        KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                   {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                              {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


# --------------------------------------------------------------------------------------
# 1) El primitivo _claim_part: primer claim gana (True), el duplicado pierde (False).
#    Se ejercita en LOS SEIS workers (misma garantía copiada en cada uno, sin imports
#    compartidos entre lambdas).
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize('worker', list(WORKER_MODULES))
def test_claim_part_es_atomico_y_dedup(worker):
    with mock_aws():
        _mk_process_detail_table()
        mod = _load(WORKER_MODULES[worker], f'{worker}_idem_mod')

        # Primera entrega de (P1, parte 7): gana el claim.
        assert mod._claim_part(TENANT, 'P1', 7, 3, '2026-01-01T00:00:00Z') is True
        # Redelivery de la MISMA parte: pierde la condición → NO se reenvía.
        assert mod._claim_part(TENANT, 'P1', 7, 3, '2026-01-01T00:00:00Z') is False
        # Otra parte del mismo proceso: independiente → gana.
        assert mod._claim_part(TENANT, 'P1', 8, 3, '2026-01-01T00:00:00Z') is True
        # Otro proceso, misma parte: independiente → gana.
        assert mod._claim_part(TENANT, 'P2', 7, 3, '2026-01-01T00:00:00Z') is True


@pytest.mark.parametrize('worker', list(WORKER_MODULES))
def test_claim_part_separa_etapas_combine_y_send(worker):
    """La etapa 'combine' (combinador) y 'send' (worker) comparten (processId, part) en la
    MISMA tabla; el sufijo de etapa evita que el claim de una bloquee a la otra."""
    with mock_aws():
        _mk_process_detail_table()
        mod = _load(WORKER_MODULES[worker], f'{worker}_stage_mod')
        assert mod._claim_part(TENANT, 'P1', 5, 1, 'd', stage='combine') is True
        # Misma parte, etapa distinta: NO se bloquea (clave distinta).
        assert mod._claim_part(TENANT, 'P1', 5, 1, 'd', stage='send') is True
        # Repetir la etapa 'send' sí se bloquea.
        assert mod._claim_part(TENANT, 'P1', 5, 1, 'd', stage='send') is False


@pytest.mark.parametrize('worker', list(WORKER_MODULES))
def test_claim_part_failopen_sin_llave(worker):
    """Sin tenant/processId/part (p. ej. mensaje viejo en vuelo) NO se puede deduplicar:
    fail-open (procesa), como el comportamiento previo — no rompe."""
    with mock_aws():
        _mk_process_detail_table()
        mod = _load(WORKER_MODULES[worker], f'{worker}_failopen_mod')
        assert mod._claim_part('', 'P1', 7, 1, 'd') is True
        assert mod._claim_part(TENANT, '', 7, 1, 'd') is True
        assert mod._claim_part(TENANT, 'P1', None, 1, 'd') is True


# --------------------------------------------------------------------------------------
# 2) Dedup a NIVEL HANDLER en los canales telefónicos (los que NO tenían guarda y donde
#    un duplicado cuesta dinero real): la segunda entrega no vuelve a enviar.
# --------------------------------------------------------------------------------------
def _sms_event(process_id, part, data):
    return {'Records': [{'body': json.dumps({
        'customerName': 'empresa', 'nit': NIT, 'processId': process_id, 'part': part,
        'headers': ['Identificacion', 'Celular', 'Nombre'],
        'smsBody': 'Hola {{Nombre}}', 'data': data,
    })}]}


def test_sms_handler_no_reenvia_en_redelivery(monkeypatch):
    with mock_aws():
        _mk_process_detail_table()
        _mk_send_status_table()
        sms = _load(WORKER_MODULES['sms'], 'sms_handler_mod')

        enviados = []
        monkeypatch.setattr(sms, 'ORIGINATION_IDENTITY', 'sender-demo')
        monkeypatch.setattr(sms.sms, 'send_text_message',
                            lambda **kw: enviados.append(kw) or {'MessageId': 'MID'})

        data = [['1', '+573001112233', 'Ana'], ['2', '+573004445566', 'Luis']]
        ev = _sms_event('P1', 3, data)

        sms.lambda_handler(ev, None)     # primera entrega → 2 SMS
        sms.lambda_handler(ev, None)     # redelivery de la MISMA parte → 0 SMS

        assert len(enviados) == 2, 'La redelivery NO debe reenviar los SMS (idempotencia)'
        # Estados registrados una sola vez (no se duplican en sendStatus → no infla facturación).
        items = boto3.resource('dynamodb', region_name='us-east-1').Table(f'{TENANT}_sendStatus').scan()['Items']
        assert len(items) == 2


def test_voice_handler_no_rellama_en_redelivery(monkeypatch):
    with mock_aws():
        _mk_process_detail_table()
        _mk_send_status_table()
        voice = _load(WORKER_MODULES['voice'], 'voice_handler_mod')

        llamadas = []
        monkeypatch.setattr(voice, 'ORIGINATION_IDENTITY', 'voice-demo')
        monkeypatch.setattr(voice.voice, 'send_voice_message',
                            lambda **kw: llamadas.append(kw) or {'MessageId': 'MID'})

        ev = {'Records': [{'body': json.dumps({
            'customerName': 'empresa', 'nit': NIT, 'processId': 'P1', 'part': 4,
            'headers': ['Id', 'Celular', 'Nombre'], 'voiceMessage': 'Hola {{Nombre}}',
            'data': [['1', '+573001112233', 'Ana']],
        })}]}

        voice.lambda_handler(ev, None)
        voice.lambda_handler(ev, None)

        assert len(llamadas) == 1, 'La redelivery NO debe repetir la llamada (idempotencia)'


def test_wsp_handler_no_reenvia_en_redelivery(monkeypatch):
    with mock_aws():
        _mk_process_detail_table()
        _mk_send_status_table()
        # messageIndex (índice global de WhatsApp) — el worker lo escribe best-effort.
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='messageIndex',
            KeySchema=[{'AttributeName': 'messageId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'messageId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        wsp = _load(WORKER_MODULES['wsp'], 'wsp_handler_mod')

        enviados = []
        monkeypatch.setattr(wsp, 'ORIGINATION_PHONE_NUMBER_ID', 'wa-demo')
        monkeypatch.setattr(wsp.social, 'send_whatsapp_message',
                            lambda **kw: enviados.append(kw) or {'messageId': 'WA-1'})

        ev = {'Records': [{'body': json.dumps({
            'customerName': 'empresa', 'nit': NIT, 'processId': 'P1', 'part': 9,
            'wspTemplate': 'promo_hsm', 'data': [['1', '+573001112233', 'Ana']],
        })}]}

        wsp.lambda_handler(ev, None)
        wsp.lambda_handler(ev, None)

        assert len(enviados) == 1, 'La redelivery NO debe reenviar el WhatsApp (idempotencia)'
