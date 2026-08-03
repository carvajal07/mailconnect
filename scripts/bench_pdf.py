#!/usr/bin/env python3
"""
Mide cuánto tarda de verdad generar un PDF, con el código REAL del combinador.

    python3 scripts/bench_pdf.py                      # documentos sintéticos de varios tamaños
    python3 scripts/bench_pdf.py --html mi_plantilla.html   # TU plantilla
    python3 scripts/bench_pdf.py --repeticiones 20

Para qué sirve: antes de tocar memoria, arquitectura o fan-out conviene saber en qué se va el
tiempo. Los números de `PROVISION.md` §11 salieron de aquí.

Requiere `reportlab` + `xhtml2pdf` instalados localmente (los mismos del layer).

⚠️ La medición local NO es la de Lambda: aquí hay una CPU completa. En Lambda el tiempo
escala con la memoria asignada (1 vCPU a ~1.769 MB), así que a 256 MB todo esto es varias
veces más lento. Sirve para comparar ENTRE plantillas y para ver el efecto del bytecode, no
como predicción absoluta.
"""
import argparse
import importlib.util
import os
import sys
import time
import types
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
sys.modules.setdefault('pandas', types.ModuleType('pandas'))

RAIZ = Path(__file__).resolve().parent.parent
COMB = RAIZ / '04_Backend' / 'lambdas' / 'Api_V1_Template_Combination-EAP-PDF'


def cargar_combinador():
    """Importa la lambda REAL (no una copia): lo que se mide es lo que corre en producción."""
    sys.path.insert(0, str(COMB))
    from moto import mock_aws
    with mock_aws():
        spec = importlib.util.spec_from_file_location('comb', str(COMB / 'lambda_function.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
    return m


def documento(filas):
    cuerpo = ''.join(
        '<tr><td>{0}</td><td>Movimiento {0}</td><td>$ {1:,}</td></tr>'.format(i, i * 1234)
        for i in range(1, filas + 1))
    return ('<h1>Certificado</h1><p>Estimado <b>Ana Gómez</b>, certificamos su estado de cuenta.</p>'
            '<table border="1" cellpadding="4"><thead><tr><th>#</th><th>Concepto</th>'
            '<th>Valor</th></tr></thead><tbody>{}</tbody></table>'.format(cuerpo))


def medir(m, html, n):
    m.html_to_pdf(html)                      # el primero calienta cachés internas; se descarta
    t0 = time.perf_counter()
    for _ in range(n):
        salida = m.html_to_pdf(html)
    return (time.perf_counter() - t0) / n * 1000, len(salida)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--html', help='archivo HTML propio a medir (si no, usa documentos sintéticos)')
    ap.add_argument('--repeticiones', type=int, default=10)
    ap.add_argument('--por-lote', type=int, default=100,
                    help='PDFs por invocación (REGISTERS_FOR_EAP); default 100')
    args = ap.parse_args()

    # El import se mide APARTE: en Lambda se paga una vez por contenedor, no por PDF.
    t0 = time.perf_counter()
    import reportlab.platypus, xhtml2pdf.pisa  # noqa: F401
    t_import = (time.perf_counter() - t0) * 1000
    print('Importar la pila de PDF: {:.0f} ms (por arranque en frío)'.format(t_import))
    if t_import > 1200:
        print('  ⚠️  Alto: ¿el paquete trae el bytecode precompilado? Ver scripts/build_layer_pdf.sh')
    print()

    m = cargar_combinador()

    if args.html:
        html = Path(args.html).read_text(encoding='utf-8')
        ms, tam = medir(m, html, args.repeticiones)
        print('{}: {:.0f} ms/PDF ({:.0f} KB)'.format(args.html, ms, tam / 1024))
        casos = [(None, ms)]
    else:
        print('{:>8}  {:>12}  {:>9}'.format('filas', 'ms por PDF', 'KB'))
        casos = []
        for filas in (5, 25, 100, 300):
            ms, tam = medir(m, documento(filas), args.repeticiones)
            print('{:>8}  {:>12.0f}  {:>9.0f}'.format(filas, ms, tam / 1024))
            casos.append((filas, ms))

    print('\nTiempo de RENDER por invocación, según cuántos PDFs lleve cada mensaje:')
    print('(el fan-out reparte el lote en invocaciones que Lambda corre en PARALELO)')
    print('{:>8}  {:>10}  {:>10}  {:>10}'.format('filas', 'x100 (hoy)', 'x20', 'x10'))
    for filas, ms in casos:
        etiqueta = filas if filas is not None else 'propio'
        print('{:>8}  {:>9.1f}s  {:>9.1f}s  {:>9.1f}s'.format(
            etiqueta, ms * 100 / 1000, ms * 20 / 1000, ms * 10 / 1000))
    print('\n⚠️  A esos tiempos hay que sumarles el arranque en frío de arriba cuando el')
    print('    contenedor es nuevo. Por eso el fan-out y el bytecode van juntos.')


if __name__ == '__main__':
    main()
