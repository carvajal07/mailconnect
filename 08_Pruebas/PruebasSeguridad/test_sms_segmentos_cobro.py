"""
Cobro de SMS POR SEGMENTO y coherencia de las tarifas de SMS/Voz con su costo.

Dos defectos que cubre este archivo:

1. **El débito real ignoraba los segmentos.** `Api_V1_Cost_Estimate` multiplicaba por
   `smsSegments` (lo que VE el cliente) pero `_campaign_unit` de Prepare-batch no (lo que
   se DEBITA). Un SMS de 300 caracteres se estimaba a 2 segmentos y se cobraba 1 → el gate
   de saldo decidía con un número y se cobraba otro.

2. **Se vendía por debajo del costo.** AWS cobra ~163 COP por segmento de SMS en Colombia
   y ~305 COP por minuto de voz (TRM 3.206), y **no da descuento por volumen**. La curva
   anterior bajaba hasta 10 COP/SMS: a más volumen, más pérdida. El guard de abajo impide
   que una edición futura vuelva a dejar un tramo bajo costo sin que nadie se entere.
"""
import os
import sys
import types
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'

#: Costo AWS en Colombia (TRM 3.206). Es la referencia contra la que se valida la tarifa.
COSTO_SMS_COP = 0.05087 * 3206      # ≈ 163 COP por SEGMENTO
COSTO_VOZ_COP = 0.095 * 3206        # ≈ 305 COP por MINUTO


def _load(folder, alias):
    # `pandas` viene por layer en AWS; aquí se stubea (nada de lo que se prueba lo usa).
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location(alias, str(DIR / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def prep():
    with mock_aws():
        yield _load('Api_V1_Email_Prepare-batch-template', 'prep_seg')


@pytest.fixture
def cost():
    with mock_aws():
        yield _load('Api_V1_Cost_Estimate', 'cost_seg')


# ─────────────────────────── Conteo de segmentos ───────────────────────────

@pytest.mark.parametrize('texto, esperado', [
    ('', 1),                       # vacío: igual sale un mensaje
    ('Hola', 1),
    ('a' * 160, 1),                # justo el límite de GSM-7
    ('a' * 161, 2),                # al concatenar caben 153, no 160
    ('a' * 306, 2),                # 2 × 153
    ('a' * 307, 3),
])
def test_segmentos_gsm7(prep, texto, esperado):
    assert prep._sms_segments(texto) == esperado


@pytest.mark.parametrize('texto, esperado', [
    ('Hola 🎉', 1),                # una emoji fuerza UCS-2, pero cabe en uno
    ('a' * 70 + '🎉', 2),          # UCS-2: 70 en uno solo; la emoji ocupa 2 unidades
    ('a' * 100 + '🎉', 2),         # el caso que el conteo viejo daba como 1
])
def test_una_emoji_cambia_el_alfabeto_y_parte_el_mensaje(prep, texto, esperado):
    """Un solo carácter fuera de GSM-7 baja la capacidad de 160 a 70 para TODO el mensaje."""
    assert prep._sms_segments(texto) == esperado


def test_caracteres_del_gsm_extendido_ocupan_dos(prep):
    # '€' y '{' se codifican con un escape: 80 de ellos ocupan 160 espacios (aún 1 segmento),
    # 81 se pasan.
    assert prep._sms_segments('€' * 80) == 1
    assert prep._sms_segments('€' * 81) == 2


# ─────────────────────────── El débito los cobra ───────────────────────────

def _rate(prep):
    return dict(prep.DEFAULT_RATES['SMS'], **prep.DEFAULT_RATES['COMMON'])


def test_el_debito_multiplica_por_segmentos(prep):
    """Antes esto no pasaba: un SMS largo se debitaba como uno corto."""
    corto = prep._campaign_unit(_rate(prep), 'SMS', 1000, sms_body='Hola')
    largo = prep._campaign_unit(_rate(prep), 'SMS', 1000, sms_body='a' * 300)
    assert largo == corto * 2


def test_sin_texto_cobra_un_segmento(prep):
    """Campaña vieja sin `smsBody` resuelto: no se puede cobrar de más por adivinar."""
    assert prep._campaign_unit(_rate(prep), 'SMS', 1000, sms_body='') == \
        prep._campaign_unit(_rate(prep), 'SMS', 1000, sms_body='Hola')


def test_los_otros_canales_no_se_ven_afectados(prep):
    """El texto del SMS no debe alterar el precio de un correo."""
    rate = dict(prep.DEFAULT_RATES['EMAIL'], **prep.DEFAULT_RATES['COMMON'])
    assert prep._campaign_unit(rate, 'EM', 1000, sms_body='a' * 500) == \
        prep._campaign_unit(rate, 'EM', 1000)


def test_paridad_estimador_y_debito_con_varios_segmentos(prep, cost):
    """El front compara el ESTIMADO contra el saldo y el backend DEBITA: si difieren, el
    gate decide con un número y se cobra otro."""
    texto = 'a' * 300                       # 2 segmentos
    estimado = cost.lambda_handler(
        {'channel': 'SMS', 'recipients': 1000, 'smsSegments': 2}, None)['data']
    debito = prep._campaign_cost('CU1', 'SMS', 1000, sms_body=texto)
    assert debito == estimado['estimatedCost']


# ─────────────────────────── Ningún tramo bajo costo ───────────────────────────

def test_ningun_tramo_de_sms_vende_bajo_costo(cost):
    for volumen, precio in cost.VOLUME_TIERS['SMS']:
        assert precio > COSTO_SMS_COP, (
            'El tramo de {} SMS vende a {} COP y a AWS le cuesta {:.0f} COP por SEGMENTO. '
            'AWS no da descuento por volumen: a más envíos, más pérdida.'
        ).format(volumen, precio, COSTO_SMS_COP)


def test_ningun_tramo_de_voz_vende_bajo_costo(cost):
    for volumen, precio in cost.VOLUME_TIERS['VOICE']:
        assert precio > COSTO_VOZ_COP, (
            'El tramo de {} llamadas vende a {} COP/min y a AWS le cuesta {:.0f} COP/min.'
        ).format(volumen, precio, COSTO_VOZ_COP)


def test_la_curva_de_sms_es_suave_no_agresiva(cost):
    """El descuento por volumen en SMS solo puede salir del MARGEN propio, porque el costo
    es plano. Una caída fuerte (como la vieja, de 55 a 10) significa vender bajo costo."""
    tramos = cost.VOLUME_TIERS['SMS']
    primero, ultimo = tramos[0][1], tramos[-1][1]
    assert ultimo >= primero * 0.75, (
        'El precio del tramo más alto ({}) cae más del 25% respecto al primero ({}). '
        'Con costo plano eso se come el margen entero.'.format(ultimo, primero))


def test_los_seis_lambdas_comparten_las_mismas_tarifas():
    """Las tarifas están COPIADAS en 6 lambdas (convención del repo). Si una se edita sola,
    el cliente ve un precio y se le cobra otro."""
    modulos = [
        'Api_V1_Cost_Estimate', 'Api_V1_Email_Prepare-batch-template', 'Api_V1_Billing_Summary',
        'Api_V1_Pricing_List', 'Api_V1_Cascade_Dispatch', 'Api_V1_Cascade_Advance',
    ]
    with mock_aws():
        referencia = None
        for i, nombre in enumerate(modulos):
            tiers = _load(nombre, 'tiers_{}'.format(i)).VOLUME_TIERS
            if referencia is None:
                referencia = tiers
                continue
            # Las de cascada solo llevan los canales que ellas despachan (no EAU/EAP): se
            # comparan los canales que ambas tienen, no el diccionario completo.
            for canal in set(tiers) & set(referencia):
                assert tiers[canal] == referencia[canal], \
                    'VOLUME_TIERS[{}] difiere en {}'.format(canal, nombre)
