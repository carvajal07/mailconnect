"""Interruptor GLOBAL del IVA (`platformConfig` · TAX_ENABLED).

MailConnect puede no ser responsable de IVA: el admin lo apaga desde Configuración y
TODA la plataforma pasa a cotizar y cobrar a tarifa neta.

Lo crítico que fijan estas pruebas:
  · El default (sin la clave) es COBRAR — desplegar el código no cambia por sí solo lo
    que se le cobra a nadie.
  · El estimador y el DÉBITO real leen el mismo interruptor y dan el mismo número: si
    discreparan, el gate de saldo decidiría con una cifra y se cobraría otra.
  · Facturación y Tarifas reflejan el mismo estado (nada de mostrar 19% si no se cobra).
"""
import importlib.util
import os
import sys
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import boto3  # noqa: E402
import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers_auth import make_token  # noqa: E402

LAMBDAS = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'


def _load(folder, alias):
    spec = importlib.util.spec_from_file_location(
        'tax_' + alias, str(LAMBDAS / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _table(name, pk, sk=None):
    keys = [{'AttributeName': pk, 'KeyType': 'HASH'}]
    attrs = [{'AttributeName': pk, 'AttributeType': 'S'}]
    if sk:
        keys.append({'AttributeName': sk, 'KeyType': 'RANGE'})
        attrs.append({'AttributeName': sk, 'AttributeType': 'S'})
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=keys, AttributeDefinitions=attrs,
        BillingMode='PAY_PER_REQUEST')


def _set_tax(value):
    boto3.resource('dynamodb', region_name='us-east-1').Table('platformConfig').put_item(
        Item={'configKey': 'TAX_ENABLED', 'value': value})


def _admin(body=None):
    return {**(body or {}), 'authToken': make_token(),
            'requestContext': {'authorizer': {'role': 'admin'}}}


def _client(body=None):
    return {**(body or {}),
            'requestContext': {'authorizer': {'customerId': 'CU1', 'customer': 'Acme', 'nit': '900'}}}


# ── El interruptor en sí ─────────────────────────────────────────────────────

def test_default_es_cobrar_iva():
    """Sin la clave (y sin la tabla) se cobra IVA: desplegar no cambia el cobro."""
    with mock_aws():
        _table('pricingRate', 'customerId', 'channel')
        est = _load('Api_V1_Cost_Estimate', 'est_default')
        assert est.tax_enabled() is True        # sin tabla platformConfig
        _table('platformConfig', 'configKey')
        assert est.tax_enabled() is True        # con tabla pero sin la clave


@pytest.mark.parametrize('stored,esperado', [
    (True, True), (False, False),
    ('true', True), ('false', False), ('0', False), ('no', False),
])
def test_lee_booleano_y_texto(stored, esperado):
    """El valor se guarda como booleano, pero se tolera texto por si se editó a mano
    en la consola de DynamoDB."""
    with mock_aws():
        _table('pricingRate', 'customerId', 'channel')
        _table('platformConfig', 'configKey')
        est = _load('Api_V1_Cost_Estimate', 'est_parse')
        _set_tax(stored)
        assert est.tax_enabled() is esperado


def test_falla_abierto_si_no_puede_leer(monkeypatch):
    """Un error transitorio de DynamoDB no debe dejar de cobrar en silencio."""
    with mock_aws():
        _table('pricingRate', 'customerId', 'channel')
        est = _load('Api_V1_Cost_Estimate', 'est_failopen')

        def boom(**kwargs):
            raise RuntimeError('throttling')

        monkeypatch.setattr(est._cfg_table, 'get_item', boom)
        assert est.tax_enabled() is True


# ── Estimador ────────────────────────────────────────────────────────────────

def _estimate(mod, recipients=10000):
    return mod.lambda_handler(_client({'channel': 'EMAIL', 'emailMode': 'EM',
                                       'recipients': recipients}), None)


def test_estimador_con_y_sin_iva():
    with mock_aws():
        _table('pricingRate', 'customerId', 'channel')
        _table('platformConfig', 'configKey')
        est = _load('Api_V1_Cost_Estimate', 'est_calc')

        con = _estimate(est)['data']
        assert con['taxRate'] == 0.19
        assert con['tax'] > 0
        assert con['estimatedCost'] == con['subtotal'] + con['tax']

        _set_tax(False)
        sin = _estimate(est)['data']
        assert sin['taxRate'] == 0
        assert sin['tax'] == 0
        # El neto NO cambia: apagar el IVA no altera la tarifa, solo el impuesto.
        assert sin['subtotal'] == con['subtotal']
        assert sin['estimatedCost'] == sin['subtotal']


# ── El cobro REAL coincide con el estimado ───────────────────────────────────

def test_cobro_real_coincide_con_el_estimado_sin_iva():
    """Es la prueba que importa: el front compara el estimado con el saldo y Prepare-batch
    es quien DEBITA. Si uno aplicara IVA y el otro no, el gate decidiría con un número y
    se cobraría otro."""
    import types
    sys.modules.setdefault('pandas', types.ModuleType('pandas'))
    with mock_aws():
        _table('pricingRate', 'customerId', 'channel')
        _table('platformConfig', 'configKey')
        est = _load('Api_V1_Cost_Estimate', 'est_par')
        pb = _load('Api_V1_Email_Prepare-batch-template', 'pb_par')

        for enabled in (True, False):
            _set_tax(enabled)
            estimado = _estimate(est, 10000)['data']['estimatedCost']
            cobrado = pb._campaign_cost('CU1', 'EM', 10000, None, 'NONE')
            assert cobrado == estimado, (
                'con IVA={} el estimador dice {} y el débito {}'.format(enabled, estimado, cobrado))


# ── Facturación y Tarifas ────────────────────────────────────────────────────

def test_pricing_list_muestra_iva_en_cero_y_avisa():
    with mock_aws():
        _table('pricingRate', 'customerId', 'channel')
        _table('platformConfig', 'configKey')
        pl = _load('Api_V1_Pricing_List', 'pl')

        con = pl.lambda_handler(_admin({'customerId': '*'}), None)['data']
        assert con['taxEnabled'] is True
        assert con['effective']['EMAIL']['taxRate'] == 0.19

        _set_tax(False)
        sin = pl.lambda_handler(_admin({'customerId': '*'}), None)['data']
        assert sin['taxEnabled'] is False
        assert sin['effective']['EMAIL']['taxRate'] == 0
        # Los DEFAULTS embebidos no se tocan: el 19% sigue ahí para cuando se reactive.
        assert sin['defaults']['EMAIL']['taxRate'] == 0.19


def test_cascada_cobra_sin_iva():
    with mock_aws():
        _table('pricingRate', 'customerId', 'channel')
        _table('platformConfig', 'configKey')
        cd = _load('Api_V1_Cascade_Dispatch', 'cd')

        con = cd.channel_cost('CU1', 'EM', 10000)
        _set_tax(False)
        sin = cd.channel_cost('CU1', 'EM', 10000)
        assert sin < con
        assert sin == round(con / 1.19)


# ── Config/Set valida el booleano ────────────────────────────────────────────

@pytest.mark.parametrize('enviado,guardado', [
    (False, False), (True, True), ('false', False), ('true', True),
])
def test_config_set_guarda_booleano(enviado, guardado):
    with mock_aws():
        _table('platformConfig', 'configKey')
        _table('adminAudit', 'auditId')
        cs = _load('Api_V1_Config_Set', 'cs_{}'.format(enviado))
        out = cs.lambda_handler(_admin({'key': 'TAX_ENABLED', 'value': enviado}), None)
        assert out['statusCode'] == 200
        item = boto3.resource('dynamodb', region_name='us-east-1').Table(
            'platformConfig').get_item(Key={'configKey': 'TAX_ENABLED'})['Item']
        assert item['value'] is guardado


def test_config_set_rechaza_valor_no_booleano():
    with mock_aws():
        _table('platformConfig', 'configKey')
        cs = _load('Api_V1_Config_Set', 'cs_bad')
        out = cs.lambda_handler(_admin({'key': 'TAX_ENABLED', 'value': 'quizá'}), None)
        assert out['statusCode'] == 400


def test_config_get_expone_el_ajuste():
    with mock_aws():
        _table('platformConfig', 'configKey')
        cg = _load('Api_V1_Config_Get', 'cg')

        s = next(x for x in cg.lambda_handler(_admin(), None)['data']['settings']
                 if x['key'] == 'TAX_ENABLED')
        assert s['type'] == 'bool' and s['default'] is True and s['isOverridden'] is False

        _set_tax(False)
        s = next(x for x in cg.lambda_handler(_admin(), None)['data']['settings']
                 if x['key'] == 'TAX_ENABLED')
        # Un `false` guardado cuenta como personalizado (no como "sin definir").
        assert s['value'] is False and s['isOverridden'] is True
