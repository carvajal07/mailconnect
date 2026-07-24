"""
Paridad de estilos del Estudio PDF (pdfsketch) con el Diseñador PDF — motor.

Cubre las features NUEVAS del traductor (`sketch_translator`) y del motor
(`pdf_engine`) traídas del Diseñador:
  - Texto: subrayado / tachado / super-subíndice / interletra / transformación
    de mayúsculas / interlineado (estilo por elemento y por span).
  - Listas (viñetas / numeradas) → <ul>/<ol> del contentarea.
  - Formas: triángulo, opacidad de relleno y degradado lineal/radial.
  - html_parser: <s>/<strike>/<del> y text-decoration: line-through.

Sin AWS: solo el traductor + render real con reportlab.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[2]
ENGINE_DIR = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Template_Render-engine'


@pytest.fixture
def engine():
    if str(ENGINE_DIR) not in sys.path:
        sys.path.insert(0, str(ENGINE_DIR))
    for name in list(sys.modules):
        if name == 'sketch_translator' or name.startswith('pdf_engine'):
            del sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        'render_engine_paridad', str(ENGINE_DIR / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _base_el(**kw):
    el = {
        'id': 'e1', 'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 1,
    }
    el.update(kw)
    return el


def _doc(elements):
    return {'schema': 'pdfsketch@1', 'document': {
        'unit': 'mm', 'name': 'paridad',
        'pages': [{'id': 'p1', 'name': 'P1', 'visible': True,
                   'size': {'width': 210, 'height': 297, 'unit': 'mm'},
                   'background': '#ffffff',
                   'margin': {'top': 10, 'right': 10, 'bottom': 10, 'left': 10},
                   'elements': elements}],
    }}


def _text_el(**kw):
    base = _base_el(
        type='text', x=10, y=10, width=120, height=20, text='Hola',
        fontFamily='Helvetica', fontSize=12, fontStyle='normal', fontWeight=400,
        align='left', lineHeight=1.3, color='#111111')
    base.update(kw)
    return base


# ── Traductor: estilos de texto ───────────────────────────────────────────────

def test_estilo_texto_decoraciones_y_reglas(engine):
    from sketch_translator import translate_sketch
    out = translate_sketch(_doc([_text_el(
        textDecoration='underline', letterSpacing=1.5,
        textTransform='uppercase', lineHeight=1.8)]))
    tj = out['templateJson']
    el = tj['pages'][0]['elements'][0]
    assert el['type'] == 'text'
    ts = {t['id']: t for t in tj['styles']['text']}[el['textStyleId']]
    assert ts['underline'] is True
    assert ts['letterSpacing'] == 1.5
    assert ts['textTransform'] == 'uppercase'
    assert ts['lineHeight'] == 1.8


def test_estilo_texto_tachado(engine):
    from sketch_translator import translate_sketch
    tj = translate_sketch(_doc([_text_el(textDecoration='line-through')]))['templateJson']
    el = tj['pages'][0]['elements'][0]
    ts = {t['id']: t for t in tj['styles']['text']}[el['textStyleId']]
    assert ts['strikethrough'] is True


def test_spans_ricos_van_a_contentarea_con_estilos(engine):
    from sketch_translator import translate_sketch
    out = translate_sketch(_doc([_text_el(text='', spans=[
        {'text': 'normal '},
        {'text': 'tachado', 'textDecoration': 'line-through'},
        {'text': '2', 'baselineShift': 'super'},
        {'text': '2', 'baselineShift': 'sub'},
        {'text': 'rojo', 'color': '#ff0000', 'fontWeight': 700},
    ])]))
    tj = out['templateJson']
    el = tj['pages'][0]['elements'][0]
    assert el['type'] == 'contentarea'
    html = tj['contentAreas'][0]['content']
    assert 'text-decoration:line-through' in html
    assert 'vertical-align:super' in html
    assert 'vertical-align:sub' in html
    assert 'color:#ff0000' in html
    assert 'font-weight:bold' in html


def test_listas_traducen_a_ul_ol(engine):
    from sketch_translator import translate_sketch
    tj = translate_sketch(_doc([
        _text_el(id='b', text='uno\ndos', listStyle='bullet'),
        _text_el(id='n', x=10, y=50, text='uno\ndos', listStyle='numbered'),
    ]))['templateJson']
    contents = [a['content'] for a in tj['contentAreas']]
    assert any(c.startswith('<ul>') and '<li>uno</li>' in c for c in contents)
    assert any(c.startswith('<ol>') and '<li>dos</li>' in c for c in contents)


# ── Traductor: formas ─────────────────────────────────────────────────────────

def test_triangulo_y_opacidad(engine):
    from sketch_translator import translate_sketch
    tj = translate_sketch(_doc([_base_el(
        type='triangle', x=10, y=10, width=40, height=30,
        fill='#ff0000', stroke='#000000', strokeWidth=1, opacity=0.5)]))['templateJson']
    el = tj['pages'][0]['elements'][0]
    assert el['type'] == 'shape' and el['shape'] == 'triangle'
    assert el['fill'] == {'type': 'solid', 'color': '#ff0000', 'opacity': 0.5}


def test_gradiente_lineal_y_radial(engine):
    from sketch_translator import translate_sketch
    tj = translate_sketch(_doc([
        _base_el(id='g1', type='rect', x=10, y=10, width=40, height=30,
                 fill='transparent', stroke='#000000', strokeWidth=1, cornerRadius=0,
                 fillGradient={'kind': 'linear', 'angle': 90, 'stops': [
                     {'offset': 0, 'color': '#ff0000'}, {'offset': 100, 'color': '#0000ff'}]}),
        _base_el(id='g2', type='circle', x=60, y=10, width=40, height=30,
                 fill='transparent', stroke='#000000', strokeWidth=1,
                 fillGradient={'kind': 'radial', 'cx': 30, 'cy': 70, 'stops': [
                     {'offset': 0, 'color': '#ffffff'}, {'offset': 100, 'color': '#16a34a'}]}),
    ]))['templateJson']
    g1, g2 = tj['pages'][0]['elements']
    assert g1['fill']['type'] == 'gradient'
    assert g1['fill']['gradient']['type'] == 'linear'
    assert g1['fill']['gradient']['angle'] == 90
    assert g2['fill']['gradient']['type'] == 'radial'
    assert g2['fill']['gradient']['cx'] == 30
    assert len(g2['fill']['gradient']['stops']) == 2


# ── html_parser: tachado ──────────────────────────────────────────────────────

def test_html_parser_strike_tags_y_css(engine):
    from pdf_engine.html_parser import parse_content
    for html in ('<p><s>x</s></p>', '<p><strike>x</strike></p>', '<p><del>x</del></p>',
                 '<p><span style="text-decoration:line-through">x</span></p>'):
        runs = [r for r in parse_content(html)[0].runs if r.text.strip()]
        assert runs and runs[0].style.strikethrough is True, html


def test_html_parser_line_through_no_rompe_underline(engine):
    from pdf_engine.html_parser import parse_content
    runs = parse_content('<p><span style="text-decoration:underline line-through">x</span></p>')[0].runs
    r = [x for x in runs if x.text.strip()][0]
    assert r.style.underline is True and r.style.strikethrough is True


# ── Render real (reportlab): todo junto produce un PDF válido ─────────────────

def test_render_pdf_con_todas_las_features(engine):
    from sketch_translator import translate_sketch
    from pdf_engine.normalize import normalize
    from pdf_engine.page_renderer import render_pdf

    doc = _doc([
        _text_el(id='t1', textDecoration='underline', letterSpacing=1.2,
                 textTransform='uppercase'),
        _text_el(id='t2', y=40, text='', spans=[
            {'text': 'x'}, {'text': '2', 'baselineShift': 'super'},
            {'text': ' tach', 'textDecoration': 'line-through'}]),
        _text_el(id='t3', y=70, text='uno\ndos\ntres', listStyle='bullet'),
        _base_el(id='s1', type='triangle', x=20, y=110, width=50, height=40,
                 fill='#ff0000', stroke='#000000', strokeWidth=1, opacity=0.8,
                 fillGradient={'kind': 'linear', 'angle': 45, 'stops': [
                     {'offset': 0, 'color': '#ff0000'}, {'offset': 100, 'color': '#0000ff'}]}),
        _base_el(id='s2', type='rect', x=90, y=110, width=60, height=40,
                 fill='transparent', stroke='#333333', strokeWidth=0.5, cornerRadius=0,
                 fillGradient={'kind': 'radial', 'stops': [
                     {'offset': 0, 'color': '#ffffff'}, {'offset': 100, 'color': '#16a34a'}]}),
        _base_el(id='s3', type='circle', x=20, y=170, width=40, height=40,
                 fill='#f59e0b', stroke='#000000', strokeWidth=0.5, opacity=0.5),
    ])
    out = translate_sketch(doc)
    assert out['warnings'] == []
    pdf = render_pdf(normalize(out['templateJson']))
    assert pdf[:4] == b'%PDF'
    assert len(pdf) > 1200


def test_render_pdf_interletra_alineaciones(engine):
    """El branch manual de interletra (charSpace) renderiza en las 3 alineaciones."""
    from sketch_translator import translate_sketch
    from pdf_engine.normalize import normalize
    from pdf_engine.page_renderer import render_pdf

    els = [
        _text_el(id=f't{i}', y=10 + i * 25, align=al,
                 text='texto con interletra que se parte en varias lineas para el wrap manual',
                 letterSpacing=2)
        for i, al in enumerate(['left', 'center', 'right'])
    ]
    pdf = render_pdf(normalize(translate_sketch(_doc(els))['templateJson']))
    assert pdf[:4] == b'%PDF'


# ── Plantillas de ejemplo del Estudio PDF (public/estudio-pdf-ejemplos) ───────

def test_plantillas_ejemplo_renderizan(engine):
    """Cada .json de ejemplo importa (traductor) y produce un PDF válido."""
    import json
    from sketch_translator import translate_sketch
    from pdf_engine.normalize import normalize
    from pdf_engine.page_renderer import render_pdf

    samples = REPO_ROOT / '05_Frontend' / 'Front' / 'page' / 'public' / 'estudio-pdf-ejemplos'
    files = sorted(samples.glob('*.json'))
    assert len(files) >= 4, f'faltan ejemplos en {samples}'
    for f in files:
        doc = json.loads(f.read_text(encoding='utf-8'))
        out = translate_sketch(doc)
        pdf = render_pdf(normalize(out['templateJson']))
        assert pdf[:4] == b'%PDF', f'{f.name} no rinde PDF'
        # Los únicos warnings esperados son pen (lápiz) e imágenes data-URI.
        for w in out['warnings']:
            assert ('pen' in w) or ('data-URI' in w) or ('Imagen' in w), \
                f'{f.name}: warning inesperado: {w}'
