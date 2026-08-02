"""
Pruebas del ARMAZÓN de los correos internos de la plataforma (activación, códigos de un
solo uso, avisos al owner).

⚠️ El armazón está COPIADO en las 6 lambdas que envían correo, siguiendo la convención del
repo (no hay imports compartidos). El guard `test_las_seis_comparten_el_armazon` es la red
que detecta que una quedó atrás: si alguien cambia el diseño en una sola, la prueba falla.
"""
import importlib.util
import os
import sys
import types
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
# Prepare-batch importa pandas, que no está en el entorno de pruebas.
sys.modules.setdefault('pandas', types.ModuleType('pandas'))

import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'

# Las 6 lambdas que envían correo interno. Añadir una nueva aquí al crearla.
CON_CORREO = [
    'Api_V1_Security_Register',
    'Api_V1_Security_Create-otp',
    'Api_V1_Security_Recovery-password',
    'Api_V1_Notifications_Scan',
    'Api_V1_Email_Prepare-batch-template',
    'Api_V1_Admin_User-support',
]


def _load(folder):
    spec = importlib.util.spec_from_file_location(
        'mail_' + folder.replace('-', '_'), str(DIR / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture(scope='module')
def mod():
    with mock_aws():
        yield _load('Api_V1_Security_Register')


# ---- estructura del correo ------------------------------------------------
def test_es_un_documento_html_completo(mod):
    """Los correos anteriores eran FRAGMENTOS (`<div>` suelto, sin doctype ni head).
    Gmail lo tolera, pero es lo que hace que un cliente estricto los muestre mal."""
    html = mod.brand_email('Hola', mod.mail_p('cuerpo'))
    assert html.startswith('<!DOCTYPE html')
    assert '<html' in html and '</html>' in html
    assert 'charset=UTF-8' in html


def test_maqueta_con_TABLAS_y_ghost_table_de_outlook(mod):
    """⚠️ Outlook de escritorio (motor de Word) IGNORA `max-width`: con el `<div>` de antes
    el correo se desparramaba a todo el ancho de la ventana. El ancho se fija con una tabla
    y, para Outlook, con la ghost table del condicional."""
    html = mod.brand_email('Hola', mod.mail_p('cuerpo'))
    assert '<!--[if mso]><table role="presentation" width="600"' in html
    assert 'width="600"' in html


def test_lleva_el_logo_con_texto_alternativo(mod):
    """Gmail y Outlook bloquean las imágenes por defecto: sin `alt` el correo abre con un
    hueco donde debería ir la marca."""
    html = mod.brand_email('Hola', mod.mail_p('cuerpo'))
    assert '/email/logo.png' in html
    assert 'alt="MailConnect"' in html


def test_pie_con_las_redes_y_el_contacto(mod):
    html = mod.brand_email('Hola', mod.mail_p('cuerpo'))
    for red in ('linkedin', 'x', 'facebook', 'reddit', 'whatsapp'):
        assert 'red-{}.png'.format(red) in html, 'falta la red {}'.format(red)
    assert 'comunicaciones@mailconnect.com.co' in html


def test_cada_red_del_pie_tiene_su_imagen_en_el_repo(mod):
    """⚠️ Los PNG se sirven desde el sitio (`public/email/`), o sea desde OTRO despliegue.
    Agregar una red a MAIL_SOCIAL sin subir su icono deja el correo con una imagen rota —
    y en un correo transaccional eso se lee como que el correo es falso."""
    assets = (Path(__file__).resolve().parents[2] / '05_Frontend' / 'Front' / 'page'
              / 'public' / 'email')
    for slug, nombre, url in mod.MAIL_SOCIAL:
        if not str(url or '').strip():
            continue
        assert (assets / 'red-{}.png'.format(slug)).exists(), \
            'falta public/email/red-{}.png para {}'.format(slug, nombre)


def test_las_redes_del_correo_son_las_mismas_de_la_landing(mod):
    """El pie del correo y el de la landing publican los MISMOS perfiles. WhatsApp es la
    excepción a propósito: en el correo es el canal de contacto, no una red social, y en la
    landing ya vive como botón flotante y en la columna de Contacto."""
    landing = (Path(__file__).resolve().parents[2] / '05_Frontend' / 'Front' / 'page'
               / 'src' / 'pages' / 'landing' / 'LandingPage.tsx').read_text(encoding='utf-8')
    for slug, nombre, url in mod.MAIL_SOCIAL:
        url = str(url or '').strip()
        if not url or slug == 'whatsapp':
            continue
        assert url in landing, \
            'el correo enlaza {} a una URL que la landing NO publica: {}'.format(nombre, url)


def test_una_red_sin_url_no_se_dibuja(mod, monkeypatch):
    """Así, quitar una red del pie es borrar su URL — sin tocar el maquetado."""
    monkeypatch.setattr(mod, 'MAIL_SOCIAL',
                        [('linkedin', 'LinkedIn', 'https://x'), ('facebook', 'Facebook', '')])
    html = mod.brand_email('Hola', mod.mail_p('cuerpo'))
    assert 'red-linkedin.png' in html
    assert 'red-facebook.png' not in html


def test_boton_bulletproof_una_sola_version_por_motor(mod):
    """⚠️ El motor de Word ignora `border-radius` y el `padding` del `<a>`. Se emite VML
    para Outlook y la tabla para el resto; si los condicionales se rompen, el botón se
    DUPLICA en algún cliente."""
    html = mod.brand_email('Hola', mod.mail_p('c'), cta=('Activar', 'https://x'))
    # La etiqueta aparece DOS veces —una por motor— y cada una dentro de su condicional,
    # que es lo que garantiza que ningún cliente vea el botón repetido.
    assert html.count('Activar') == 2
    assert html.count('<v:roundrect') == 1
    assert html.count('<!--[if !mso]><!-->') == 1


def test_sin_cta_no_hay_boton(mod):
    assert 'v:roundrect' not in mod.brand_email('Hola', mod.mail_p('c'))


def test_preheader_va_oculto(mod):
    """Es lo que la bandeja muestra junto al asunto; no debe verse dentro del correo."""
    html = mod.brand_email('Hola', mod.mail_p('c'), preheader='Tu código es 123456')
    assert 'Tu código es 123456' in html
    assert 'display:none' in html


def test_escapa_el_contenido_que_viene_de_datos(mod):
    """El título y los valores salen de datos del usuario (nombre, empresa)."""
    html = mod.brand_email('<script>alert(1)</script>', mod.mail_p('ok'))
    assert '<script>' not in html
    assert '&lt;script&gt;' in html


def test_las_filas_del_resumen_escapan_y_colorean(mod):
    html = mod.mail_rows([('Rebotes', '<b>5</b>', '#e5484d'), ('Enviados', '100', None)])
    assert '&lt;b&gt;5&lt;/b&gt;' in html
    assert '#e5484d' in html


# ---- guard: las 6 copias no pueden divergir -------------------------------
@pytest.mark.parametrize('folder', CON_CORREO)
def test_las_seis_comparten_el_armazon(folder):
    """⚠️ El armazón está copiado en las 6 lambdas. Si se cambia el diseño en una sola,
    los correos de la plataforma dejan de verse iguales entre sí — esta prueba lo detecta
    comparando el HTML que produce cada copia."""
    with mock_aws():
        m = _load(folder)
        assert hasattr(m, 'brand_email'), '{} no tiene el armazón'.format(folder)
        base = _load('Api_V1_Security_Register')
        args = ('Título', '<p>cuerpo</p>')
        kwargs = {'cta': ('Ir', 'https://x'), 'nota': 'nota', 'preheader': 'pre'}
        assert m.brand_email(*args, **kwargs) == base.brand_email(*args, **kwargs), \
            '{} tiene una versión distinta del armazón'.format(folder)


def test_el_inventario_de_lambdas_con_correo_esta_completo():
    """Si una lambda nueva empieza a enviar correo, debe entrar a la lista de arriba (y
    llevar el armazón). Se excluyen las que envían el correo DEL CLIENTE, no de la
    plataforma: esas llevan la plantilla que diseñó el cliente."""
    del_cliente = {'Api_V1_Email_Send-batch-template-EAP', 'Api_V1_Email_Send-batch-template-EAU',
                   'Api_V1_Email_Send-test'}
    envian = set()
    for carpeta in DIR.iterdir():
        f = carpeta / 'lambda_function.py'
        if f.is_file() and 'ses.send_email(' in f.read_text(encoding='utf-8'):
            envian.add(carpeta.name)
    faltan = envian - set(CON_CORREO) - del_cliente
    assert not faltan, 'estas lambdas envían correo y no están en CON_CORREO: {}'.format(faltan)
