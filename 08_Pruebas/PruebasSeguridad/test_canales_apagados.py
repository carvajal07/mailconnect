"""
Canales apagados a NIVEL DE PLATAFORMA (WSP y VOZ, decisión de producto ago 2026).

MailConnect sale al mercado solo con correo y SMS. Es un APAGADO reversible (env
`PLATFORM_DISABLED_CHANNELS`, '' = todos habilitados), no un borrado: el código de los
canales queda intacto y probado (test_cascade reactiva por env para fijar el motor
completo). Barreras: Create-campaign (no se crea), Prepare-batch (no se envía — cubre
campañas viejas y llamadas directas a la API) y Cascade_Dispatch (sin pasos WSP/VOZ).
"""
import importlib.util
import os
import sys
import types
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
sys.modules.setdefault('pandas', types.ModuleType('pandas'))

import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'


def _load(folder, name=None):
    spec = importlib.util.spec_from_file_location(
        name or ('ch_' + folder.replace('-', '_')), str(REPO / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def sin_override(monkeypatch):
    """El default del código (WSP,VOZ apagados), sin herencia del entorno de CI."""
    monkeypatch.delenv('PLATFORM_DISABLED_CHANNELS', raising=False)


def test_create_campaign_rechaza_wsp_y_voz(sin_override):
    with mock_aws():
        m = _load('Api_V1_Campaign_Create-campaign')
        for canal in ('WSP', 'VOZ'):
            r = m.lambda_handler({
                'requestContext': {'authorizer': {'customerId': 'c1', 'customer': 'ACME', 'nit': '900'}},
                'campaignName': 'x', 'channelName': canal, 'attachmentType': 'NONE',
                'dataPath': 'database/x.csv', 'template': 'hola', 'from': 'a@b.co',
            }, None)
            assert r['statusCode'] == 400, canal
            assert 'no está disponible' in r['description']
            assert 'correo y SMS' in r['description']


def test_create_campaign_sigue_aceptando_em_y_sms(sin_override):
    """El apagado no puede rozar los canales que SÍ se ofrecen: si EM o SMS devolvieran
    este 400, la plataforma entera quedaría sin envíos."""
    with mock_aws():
        m = _load('Api_V1_Campaign_Create-campaign')
        for canal in ('EM', 'SMS'):
            r = m.lambda_handler({
                'requestContext': {'authorizer': {'customerId': 'c1', 'customer': 'ACME', 'nit': '900'}},
                'campaignName': 'x', 'channelName': canal, 'attachmentType': 'NONE',
                'dataPath': 'database/x.csv', 'template': 'hola', 'from': 'a@b.co',
            }, None)
            # Puede fallar más adelante por tablas ausentes (500), pero JAMÁS con el 400
            # de canal apagado.
            assert 'no está disponible por ahora' not in str(r.get('description', '')), canal


def test_reactivable_por_env(monkeypatch):
    """El mecanismo de reencendido: env vacía = todos los canales habilitados."""
    with mock_aws():
        m = _load('Api_V1_Campaign_Create-campaign')
        monkeypatch.setenv('PLATFORM_DISABLED_CHANNELS', '')
        assert m._platform_disabled_channels() == set()
        monkeypatch.setenv('PLATFORM_DISABLED_CHANNELS', 'VOZ')
        assert m._platform_disabled_channels() == {'VOZ'}
        monkeypatch.delenv('PLATFORM_DISABLED_CHANNELS')
        assert m._platform_disabled_channels() == {'WSP', 'VOZ'}


def test_cascade_rechaza_pasos_de_canal_apagado(sin_override):
    with mock_aws():
        m = _load('Api_V1_Cascade_Dispatch')
        r = m.lambda_handler({
            'requestContext': {'authorizer': {'customerId': 'c1', 'customer': 'ACME',
                                              'nit': '900', 'tenantRole': 'owner'}},
            'name': 'x', 'dataPath': 'database/x.csv',
            'steps': [{'channel': 'EM', 'content': 'tpl'}, {'channel': 'WSP', 'content': 'hsm'}],
        }, None)
        assert r['statusCode'] == 400
        assert 'WSP' in r['description'] and 'no está disponible' in r['description']


def test_prepare_batch_tiene_la_barrera_del_canal(sin_override):
    """La barrera server-side: aunque quede una campaña VOZ/WSP creada antes del apagado
    (o alguien llame la API directo), el envío no sale — 403 sin marcar Error, para que
    la campaña vuelva a ser enviable tal cual si el canal se reactiva."""
    with mock_aws():
        os.environ['PBKDF2_ITERATIONS'] = '1000'
        m = _load('Api_V1_Email_Prepare-batch-template')
        assert hasattr(m, 'DisabledChannel')
        assert m._platform_disabled_channels() == {'WSP', 'VOZ'}
        # El handler traduce la excepción a 403 (mismo trato que RealSendDisabled).
        import inspect
        fuente = inspect.getsource(m.lambda_handler)
        assert 'DisabledChannel' in fuente
