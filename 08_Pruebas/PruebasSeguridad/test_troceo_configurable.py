"""
Tamaños del troceo configurables por env (ago 2026).

El envío real corta en TRES niveles y cada uno tiene su propia lógica de idempotencia:

    CSV → part-files de PART_SIZE (5.000)          ← Prepare-batch (splitter)
        → mensajes de REGISTERS_FOR_<canal> (250)  ← Prepare-batch (worker de parte)
            → chunks de QUANTITY_BATCH (50)        ← Send-EM (claim y reanudación por chunk)

Con los valores de producción, ejercitar el PRIMER corte exige >5.000 destinatarios reales
— y para ver la última parte INCOMPLETA, que es donde viven los errores de borde, hace falta
que además no sea múltiplo exacto. Eso es un envío de verdad, con su costo y su reputación.

Bajando los tres por env se recorre EXACTAMENTE el mismo código con 50 destinatarios.

⚠️ Lo que estas pruebas protegen no es la comodidad, es que el default no cambie: sin la env
los valores tienen que seguir siendo los de producción, y una env basura NO puede dejar un
tamaño de lote en 0 (un `range(0, n, 0)` revienta y un lote de 0 no avanza nunca).
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

# (carpeta, constante, valor de PRODUCCIÓN, env que lo ajusta)
TROCEO = [
    ('Api_V1_Email_Prepare-batch-template', 'PART_SIZE', 5000, 'PART_SIZE'),
    ('Api_V1_Email_Prepare-batch-template', 'REGISTERS_FOR_EM', 250, 'REGISTERS_FOR_EM'),
    ('Api_V1_Email_Prepare-batch-template', 'REGISTERS_FOR_EAP', 100, 'REGISTERS_FOR_EAP'),
    ('Api_V1_Email_Prepare-batch-template', 'REGISTERS_FOR_SMS', 100, 'REGISTERS_FOR_SMS'),
    ('Api_V1_Email_Prepare-batch-template', 'REGISTERS_FOR_VOICE', 50, 'REGISTERS_FOR_VOICE'),
    ('Api_V1_Email_Send-batch-template-EM', 'QUANTITY_BATCH', 50, 'QUANTITY_BATCH'),
    ('Api_V1_Email_Send-batch-template-EAU', 'QUANTITY_BATCH', 25, 'QUANTITY_BATCH'),
]


def _load(folder, sufijo=''):
    spec = importlib.util.spec_from_file_location(
        'tr_' + folder.replace('-', '_') + sufijo, str(REPO / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.mark.parametrize('folder,const,produccion,env', TROCEO)
def test_sin_env_manda_el_valor_de_produccion(folder, const, produccion, env, monkeypatch):
    """Desplegar esto NO cambia nada por sí solo: sin la env, el tamaño es el de siempre."""
    monkeypatch.delenv(env, raising=False)
    with mock_aws():
        assert getattr(_load(folder), const) == produccion


@pytest.mark.parametrize('folder,const,produccion,env', TROCEO)
def test_la_env_baja_el_tamano(folder, const, produccion, env, monkeypatch):
    monkeypatch.setenv(env, '7')
    with mock_aws():
        assert getattr(_load(folder, '_env'), const) == 7


@pytest.mark.parametrize('valor', ['0', '-5', 'diez', '', '  '])
def test_env_invalida_cae_al_default(valor, monkeypatch):
    """⚠️ El caso que importa de verdad: un 0 (o una env mal escrita) NO puede llegar al
    troceo. `range(0, n, 0)` lanza ValueError y un lote de tamaño 0 nunca avanza — el envío
    quedaría colgado por un typo en una variable de entorno."""
    monkeypatch.setenv('PART_SIZE', valor)
    monkeypatch.setenv('QUANTITY_BATCH', valor)
    with mock_aws():
        assert _load('Api_V1_Email_Prepare-batch-template', '_bad').PART_SIZE == 5000
        assert _load('Api_V1_Email_Send-batch-template-EM', '_bad').QUANTITY_BATCH == 50


def test_los_tres_niveles_se_pueden_bajar_a_la_vez(monkeypatch):
    """La combinación que hace útil todo esto: con 10/3/2 bastan ~50 destinatarios para
    recorrer los tres cortes CON resto en cada uno (que es lo que se quiere probar)."""
    monkeypatch.setenv('PART_SIZE', '10')
    monkeypatch.setenv('REGISTERS_FOR_EM', '3')
    monkeypatch.setenv('QUANTITY_BATCH', '2')
    with mock_aws():
        pb = _load('Api_V1_Email_Prepare-batch-template', '_mini')
        em = _load('Api_V1_Email_Send-batch-template-EM', '_mini')

    destinatarios = 53
    partes = [pb.PART_SIZE] * (destinatarios // pb.PART_SIZE)
    if destinatarios % pb.PART_SIZE:
        partes.append(destinatarios % pb.PART_SIZE)

    assert len(partes) == 6 and partes[-1] == 3, 'la última parte debe quedar INCOMPLETA'
    # Dentro de esa última parte: 3 filas → 1 mensaje de 3 (completo) … subamos el resto
    # al nivel del mensaje con la primera parte, que sí tiene 10.
    mensajes_p1 = [pb.REGISTERS_FOR_EM] * (partes[0] // pb.REGISTERS_FOR_EM)
    if partes[0] % pb.REGISTERS_FOR_EM:
        mensajes_p1.append(partes[0] % pb.REGISTERS_FOR_EM)
    assert mensajes_p1 == [3, 3, 3, 1], 'el último mensaje de la parte debe quedar INCOMPLETO'

    chunks = [em.QUANTITY_BATCH] * (3 // em.QUANTITY_BATCH) + ([3 % em.QUANTITY_BATCH] if 3 % em.QUANTITY_BATCH else [])
    assert chunks == [2, 1], 'el último chunk del mensaje debe quedar INCOMPLETO'
