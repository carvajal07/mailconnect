"""
Resultado del envío de MUESTRAS (ago 2026).

El envío es ASÍNCRONO: la API solo encola y el worker manda el mensaje segundos después.
Por eso el cupo (`samplesSentCount`) lo sube el WORKER y solo cuando el envío SALE — una
muestra que se prepara pero no se entrega no debe consumir cupo.

⚠️ El problema que cierra esta tanda: con solo el contador, un FALLO se ve EXACTAMENTE
igual que "todavía va en camino" (en ambos casos el contador sigue igual) → el cliente
espera un correo que nunca va a llegar y "Solicitar aprobación" le responde que no ha
enviado muestras. `note_sample_result` deja constancia del fallo (`lastSampleError`) para
que el portal pueda decir qué pasó.
"""
import importlib.util
import inspect
import json
import os
import sys
import types
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
sys.modules.setdefault('pandas', types.ModuleType('pandas'))

import boto3  # noqa: E402
import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'

# Los 6 workers de envío. Todos cuentan muestras y todos llevan el helper COPIADO
# (convención del repo: sin imports compartidos entre lambdas).
WORKERS = [
    'Api_V1_Email_Send-batch-template-EM',
    'Api_V1_Email_Send-batch-template-EAU',
    'Api_V1_Email_Send-batch-template-EAP',
    'Api_V1_Sms_Send-batch',
    'Api_V1_Voice_Send-batch',
    'Api_V1_Wsp_Send-batch',
]


def _load(folder, name=None):
    spec = importlib.util.spec_from_file_location(
        name or ('ms_' + folder.replace('-', '_')), str(REPO / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _mk_campaign_table(**campos):
    boto3.client('dynamodb').create_table(
        TableName='campaign',
        KeySchema=[{'AttributeName': 'campaignId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'campaignId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')
    item = {'campaignId': 'c1', 'campaignName': 'Promo'}
    item.update(campos)
    boto3.resource('dynamodb').Table('campaign').put_item(Item=item)


def _campaign():
    return boto3.resource('dynamodb').Table('campaign').get_item(
        Key={'campaignId': 'c1'})['Item']


# ── El helper en sí ─────────────────────────────────────────────────────────
def test_ok_suma_el_cupo_y_marca_la_fecha():
    with mock_aws():
        _mk_campaign_table(samplesSentCount=1)
        m = _load('Api_V1_Sms_Send-batch')
        m.note_sample_result('c1', True)
        c = _campaign()
        assert int(c['samplesSentCount']) == 2
        assert c.get('lastSampleAt')


def test_ok_borra_el_aviso_de_fallo_anterior():
    """Si el reintento de SQS termina bien, el cliente NO puede seguir viendo el error de
    la vez anterior: ya no existe."""
    with mock_aws():
        _mk_campaign_table(samplesSentCount=0,
                           lastSampleError='Número inválido', lastSampleErrorAt='2026-08-01 10:00:00')
        m = _load('Api_V1_Sms_Send-batch')
        m.note_sample_result('c1', True)
        c = _campaign()
        assert int(c['samplesSentCount']) == 1
        assert 'lastSampleError' not in c
        assert 'lastSampleErrorAt' not in c


def test_fallo_no_consume_cupo_y_deja_el_motivo():
    with mock_aws():
        _mk_campaign_table(samplesSentCount=2)
        m = _load('Api_V1_Sms_Send-batch')
        m.note_sample_result('c1', False, 'El número +57300... no existe')
        c = _campaign()
        assert int(c['samplesSentCount']) == 2, 'un fallo NO puede gastar un envío de muestra'
        assert 'no existe' in c['lastSampleError']
        assert c['lastSampleErrorAt']


def test_fallo_sin_motivo_no_deja_el_aviso_vacio():
    """Un aviso en blanco no le dice nada a nadie: peor que no avisar."""
    with mock_aws():
        _mk_campaign_table()
        m = _load('Api_V1_Sms_Send-batch')
        m.note_sample_result('c1', False, '')
        assert _campaign()['lastSampleError'].strip()


def test_no_rompe_sin_la_tabla():
    """Best-effort: dejar constancia jamás puede tumbar un envío ya hecho."""
    with mock_aws():
        m = _load('Api_V1_Sms_Send-batch')
        m.note_sample_result('c1', True)      # sin tabla `campaign`
        m.note_sample_result('c1', False, 'x')
        m.note_sample_result('', True)        # sin campaña (envío real, no muestra)


# ── Guard de inventario: las 6 copias tienen que ser IDÉNTICAS ──────────────
def test_las_seis_copias_del_helper_son_identicas():
    """El helper va copiado por lambda (convención del repo). Si alguien toca una sola,
    el contador y el aviso dejan de comportarse igual según el canal — y eso se vería como
    "en SMS sí me avisa y en correo no", que es imposible de diagnosticar desde el portal."""
    fuentes = {}
    for w in WORKERS:
        m = _load(w, name='copia_' + w.replace('-', '_'))
        assert hasattr(m, 'note_sample_result'), w
        fuentes[w] = inspect.getsource(m.note_sample_result)
    unicas = set(fuentes.values())
    assert len(unicas) == 1, 'las copias divergieron: {}'.format(sorted(fuentes))


def test_ningun_worker_cuenta_muestras_por_su_cuenta():
    """Guard: contar con un update_item suelto se salta el borrado del aviso de fallo (y el
    registro del fallo). Toda escritura de samplesSentCount en un worker pasa por el helper."""
    for w in WORKERS:
        fuente = (REPO / w / 'lambda_function.py').read_text(encoding='utf-8')
        antes, resto = fuente.split('def note_sample_result(')
        cuerpo = antes + resto.split('\ndef ', 1)[1]
        # Solo CÓDIGO: los comentarios que MENCIONAN el contador para explicar el diseño no
        # son escrituras, y un guard que los marque se vuelve ruido que se acaba silenciando.
        sueltas = [l for l in cuerpo.split('\n')
                   if 'samplesSentCount' in l and not l.strip().startswith('#')]
        assert sueltas == [], \
            '{} escribe samplesSentCount fuera de note_sample_result:\n{}'.format(w, '\n'.join(sueltas))


# ── Los workers, de punta a punta ───────────────────────────────────────────
def _sms_event(samples=True):
    body = {'customerName': 'ACME', 'nit': '900123456', 'processId': 'p1',
            'campaignId': 'c1', 'part': 0, 'headers': ['Id', 'Celular', 'Nombre'],
            'smsBody': 'Hola {{Nombre}}', 'provider': 'aws', 'samples': samples,
            'data': [['1', '+573001112233', 'Ana']]}
    return {'Records': [{'body': json.dumps(body)}]}


def _stub_tablas(m, monkeypatch):
    monkeypatch.setattr(m, '_claim_part', lambda *a, **k: True)
    monkeypatch.setattr(m, '_record_status', lambda *a, **k: None)
    monkeypatch.setattr(m, '_mark_part', lambda *a, **k: None)


def test_sms_muestra_que_sale_cuenta(monkeypatch):
    with mock_aws():
        _mk_campaign_table(samplesSentCount=0)
        m = _load('Api_V1_Sms_Send-batch')
        m.ORIGINATION_IDENTITY = 'MAILCONNECT'
        _stub_tablas(m, monkeypatch)
        monkeypatch.setattr(m.sms, 'send_text_message', lambda **kw: {'MessageId': 'aws-1'})
        m.lambda_handler(_sms_event(), None)
        assert int(_campaign()['samplesSentCount']) == 1


def test_sms_muestra_que_falla_no_cuenta_y_explica(monkeypatch):
    """El caso que dejaba al usuario colgado: el destinatario es rechazado, el contador se
    queda igual y —antes— no había NADA que distinguiera eso de "va en camino"."""
    with mock_aws():
        _mk_campaign_table(samplesSentCount=0)
        m = _load('Api_V1_Sms_Send-batch')
        m.ORIGINATION_IDENTITY = 'MAILCONNECT'
        _stub_tablas(m, monkeypatch)

        def _boom(**kw):
            raise RuntimeError('DestinationPhoneNumber no es válido')
        monkeypatch.setattr(m.sms, 'send_text_message', _boom)

        m.lambda_handler(_sms_event(), None)
        c = _campaign()
        assert int(c.get('samplesSentCount', 0)) == 0
        assert 'no es válido' in c['lastSampleError']


def test_envio_real_no_toca_el_contador_ni_el_aviso(monkeypatch):
    """`samples: False` = envío real: ni cuenta ni deja avisos de muestra, aunque falle."""
    with mock_aws():
        _mk_campaign_table(samplesSentCount=0)
        m = _load('Api_V1_Sms_Send-batch')
        m.ORIGINATION_IDENTITY = 'MAILCONNECT'
        _stub_tablas(m, monkeypatch)

        def _boom(**kw):
            raise RuntimeError('lo que sea')
        monkeypatch.setattr(m.sms, 'send_text_message', _boom)

        m.lambda_handler(_sms_event(samples=False), None)
        c = _campaign()
        assert int(c.get('samplesSentCount', 0)) == 0
        assert 'lastSampleError' not in c


def test_primer_error_toma_el_motivo_del_rechazado():
    with mock_aws():
        m = _load('Api_V1_Sms_Send-batch')
        filas = [{'state': m.STATE_SENT, 'type2': 'SMS enviado'},
                 {'state': m.STATE_REJECTED, 'type2': 'Número en lista de bloqueo'}]
        assert m._primer_error(filas) == 'Número en lista de bloqueo'
        assert m._primer_error([]).strip()


# ── Defecto acoplado: EM ACKeaba un lote sin credenciales ───────────────────
def test_em_sin_credencial_lanza_desde_el_handler(monkeypatch):
    """⚠️ `_check_provider_config` vivía dentro del `try` de lectura de entrada de EM, cuyo
    `except` solo imprime → el lote quedaba ACKeado (SQS lo BORRA) sin enviar nada, que es
    justo lo contrario del fail-closed que se buscaba. Debe PROPAGAR para que SQS reintente."""
    with mock_aws():
        m = _load('Api_V1_Email_Send-batch-template-EM')
        m.SOCKETLABS_SERVER_ID = ''
        m.SOCKETLABS_API_KEY = ''
        body = {'customerId': 'cid', 'customerName': 'ACME', 'nit': '900123456',
                'processId': 'p1', 'campaignId': 'c1', 'samples': True,
                'fromEmail': 'a@b.co', 'provider': 'socketlabs', 'headers': ['Id', 'Correo'],
                'templateName': 'tpl', 'part': 0, 'data': [['1', 'a@b.co']]}
        with pytest.raises(RuntimeError, match='socketlabs'):
            m.lambda_handler({'Records': [{'body': json.dumps(body)}]}, None)
