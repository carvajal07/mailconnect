"""
Los renderizadores de PDF no pueden dejar basura en /tmp (ago 2026).

El PDF en sí SIEMPRE se arma en memoria (`io.BytesIO` → `put_object`), nunca toca disco.
Lo que sí bajaba a `/tmp` son las **imágenes remotas** del HTML: xhtml2pdf no descarga por
URL, así que `_link_callback` las trae a un archivo temporal y le pasa la ruta.

⚠️ El defecto: ese temporal **no se borraba nunca** y **no había caché**. El combinador
renderiza 100 PDFs por invocación, así que la MISMA imagen se descargaba 100 veces y dejaba
100 copias. Como Lambda REUTILIZA el contenedor y `/tmp` persiste (512 MB por defecto, tope
de imagen 8 MB), se llenaba y reventaba con "No space left on device" — a mitad de un lote,
en una lambda que ya había enviado parte de los correos.
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
RENDERIZADORES = ['Api_V1_Template_Render-pdf', 'Api_V1_Template_Combination-EAP-PDF']


def _load(folder, sufijo=''):
    # El combinador VENDORIZA el motor (importa sketch_translator + pdf_engine a nivel de
    # módulo) → su carpeta tiene que estar en sys.path, y se limpian los módulos cacheados
    # para no chocar con la copia de otro test (mismo nombre, contenido idéntico).
    d = REPO / folder
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))
    for nombre in list(sys.modules):
        if nombre == 'sketch_translator' or nombre.startswith('pdf_engine'):
            del sys.modules[nombre]
    spec = importlib.util.spec_from_file_location(
        'pdftmp_' + folder.replace('-', '_') + sufijo, str(d / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class _Respuesta:
    def __init__(self, data):
        self._data = data

    def read(self, n=None):
        return self._data[:n] if n else self._data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture(params=RENDERIZADORES)
def mod(request, monkeypatch):
    with mock_aws():
        m = _load(request.param)
    llamadas = {'n': 0}

    def _fake_urlopen(req, timeout=0):
        llamadas['n'] += 1
        return _Respuesta(b'PNG' * 100)

    monkeypatch.setattr(m.urllib.request, 'urlopen', _fake_urlopen)
    m._IMG_CACHE.clear()
    m._llamadas = llamadas
    yield m
    m._limpiar_imagenes()


def test_el_pdf_se_arma_en_memoria_y_sube_como_bytes(mod):
    """Contrato que no debe cambiar: BytesIO → put_object(Body=bytes). Escribir el PDF a
    /tmp para después leerlo sería un viaje a disco por destinatario, y en el combinador
    son 100 por invocación."""
    fuente = (REPO / mod.__name__.replace('pdftmp_', '').replace('_', '-')).name
    src = Path(mod.__file__).read_text(encoding='utf-8')
    assert 'io.BytesIO()' in src and 'out.getvalue()' in src, fuente
    assert 'Body=pdf_bytes' in src, 'el PDF debe subirse como bytes en memoria'


def test_la_misma_imagen_se_descarga_UNA_vez(mod):
    """Sin caché, el combinador pedía la misma URL 100 veces (una por destinatario)."""
    p1 = mod._link_callback('https://ejemplo.com/logo.png', None)
    p2 = mod._link_callback('https://ejemplo.com/logo.png', None)
    assert p1 == p2
    assert mod._llamadas['n'] == 1, 'se descargó más de una vez la misma imagen'


def test_urls_distintas_bajan_por_separado(mod):
    a = mod._link_callback('https://ejemplo.com/a.png', None)
    b = mod._link_callback('https://ejemplo.com/b.png', None)
    assert a != b and mod._llamadas['n'] == 2


def test_limpiar_borra_los_temporales(mod):
    """El invariante que evita el 'No space left on device': al terminar la invocación,
    /tmp queda como estaba."""
    rutas = [mod._link_callback('https://ejemplo.com/{}.png'.format(i), None) for i in range(5)]
    assert all(os.path.exists(r) for r in rutas)
    mod._limpiar_imagenes()
    assert not any(os.path.exists(r) for r in rutas), 'quedaron imágenes en /tmp'
    assert mod._IMG_CACHE == {}


def test_una_imagen_demasiado_grande_no_deja_el_temporal(mod, monkeypatch):
    """⚠️ El temporal se crea ANTES de conocer el tamaño: al descartar la imagen por pasarse
    del tope hay que borrarlo, o cada imagen rechazada deja un archivo vacío para siempre."""
    monkeypatch.setattr(mod.urllib.request, 'urlopen',
                        lambda req, timeout=0: _Respuesta(b'x' * (mod.IMG_MAX_BYTES + 10)))
    antes = set(os.listdir('/tmp'))
    r = mod._link_callback('https://ejemplo.com/enorme.png', None)
    assert r == 'https://ejemplo.com/enorme.png', 'debe devolver la URL sin tocar'
    nuevos = set(os.listdir('/tmp')) - antes
    assert not nuevos, 'quedó un temporal huérfano: {}'.format(nuevos)


def test_el_handler_limpia_aunque_el_render_falle(mod):
    """La limpieza va en un `finally`: si el render lanza, /tmp igual queda limpio. Sin eso,
    justo las invocaciones que fallan (las que SQS reintenta) serían las que más basura
    dejarían."""
    src = Path(mod.__file__).read_text(encoding='utf-8')
    assert 'finally:' in src and '_limpiar_imagenes()' in src
    # El handler público debe ser el envoltorio, no el cuerpo con los `return` sueltos.
    i_wrap = src.index('def lambda_handler(')
    i_real = src.index('def _handler(')
    assert i_wrap < i_real, 'lambda_handler debe envolver a _handler'


def test_pandas_no_vuelve_a_colarse_en_prepare_batch():
    """Estaba importado sin usarse: arrastraba el layer de pandas+numpy (~60 MB) y ~1-2 s de
    arranque en frío en la lambda MÁS caliente del pipeline. Y es el layer más difícil de
    recompilar si algún día se pasa a arm64."""
    src = (REPO / 'Api_V1_Email_Prepare-batch-template' / 'lambda_function.py').read_text(encoding='utf-8')
    codigo = [l for l in src.split('\n') if not l.strip().startswith('#')]
    assert not any('import pandas' in l for l in codigo), 'volvió el import de pandas'
