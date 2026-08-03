#!/usr/bin/env bash
# Construye el layer de PDF (reportlab + Pillow + xhtml2pdf + …) CON EL BYTECODE
# PRECOMPILADO, que es lo que lo hace arrancar rápido.
#
#   ./scripts/build_layer_pdf.sh                 # x86_64 (default)
#   ./scripts/build_layer_pdf.sh arm64           # Graviton
#
# ⚠️ POR QUÉ IMPORTA EL BYTECODE
# Python compila cada .py a .pyc la primera vez que lo importa y lo guarda en __pycache__
# para no repetirlo. En Lambda, `/opt` (los layers) y `/var/task` son **de SOLO LECTURA**:
# Python no puede escribir el .pyc, así que **recompila TODO en cada arranque en frío, para
# siempre**. Un `pip install -t` normal no deja bytecode, así que ese costo se paga entero.
#
# Medido en este repo con reportlab 4.5 + xhtml2pdf 0.2.17 (614 archivos .py):
#     sin bytecode ...... ~1.750 ms de import
#     con bytecode ......   ~640 ms de import      → ~1,1 s menos por arranque en frío
# Y en Lambda es PEOR que eso: la medición es en una máquina con CPU completa; a 256 MB
# (~0,15 vCPU) el mismo trabajo tarda varias veces más.
#
# ⚠️ El .pyc lleva dentro la versión de Python (`cpython-313`) y solo lo usa esa versión.
# El runtime del repo es python3.13, así que el layer debe compilarse con 3.13. Si el .pyc
# no coincide, Python lo IGNORA y recompila — no falla, solo pierdes la mejora en silencio.
#
# ⚠️ Los paquetes con binarios (reportlab, Pillow, lxml) hay que instalarlos para la
# arquitectura y la plataforma DESTINO, no para la máquina donde corres esto.
set -euo pipefail

ARCH="${1:-x86_64}"
PYVER="3.13"
case "$ARCH" in
  x86_64) PLAT="manylinux2014_x86_64" ;;
  arm64)  PLAT="manylinux2014_aarch64" ;;
  *) echo "Arquitectura no reconocida: $ARCH (usa x86_64 o arm64)"; exit 1 ;;
esac

OUT="build/layer-pdf-$ARCH"
DEST="$OUT/python"
rm -rf "$OUT"; mkdir -p "$DEST"

echo "🔧 Layer de PDF para $ARCH (python$PYVER)"

# --only-binary=:all: obliga a bajar la RUEDA precompilada de la plataforma destino en vez
# de compilar desde fuente con el compilador local (que produciría binarios de ESTA máquina).
pip install \
  --platform "$PLAT" \
  --python-version "$PYVER" \
  --implementation cp \
  --only-binary=:all: \
  --target "$DEST" \
  --quiet \
  reportlab Pillow xhtml2pdf qrcode python-barcode beautifulsoup4 lxml

echo "🧹 Quitando lo que no se usa en ejecución (peso del layer = tiempo de descarga)"
find "$DEST" -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -type d -name '*.dist-info' -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -type f -name '*.pyi' -delete 2>/dev/null || true

# EL PASO QUE IMPORTA. Sin esto el layer arranca ~1,1 s más lento, en cada contenedor nuevo.
echo "⚙️  Precompilando el bytecode (compileall)"
python3 -m compileall -q -f "$DEST" >/dev/null 2>&1 || true
echo "   $(find "$DEST" -name '*.pyc' | wc -l) archivos .pyc generados"

ZIP="build/layer-pdf-$ARCH.zip"
rm -f "$ZIP"
( cd "$OUT" && zip -qr "../$(basename "$ZIP")" python )
echo "📦 $ZIP ($(du -h "$ZIP" | cut -f1))"

cat <<FIN

Publicar:
  aws lambda publish-layer-version \\
    --layer-name mailconnect-pdf-$ARCH \\
    --zip-file fileb://$ZIP \\
    --compatible-runtimes python$PYVER \\
    --compatible-architectures $ARCH

Y apuntarlo en cada lambda que renderiza:
  aws lambda update-function-configuration \\
    --function-name Api_V1_Template_Combination-EAP-PDF \\
    --layers <ARN devuelto arriba>

⚠️ --layers REEMPLAZA la lista completa: incluye los layers que la función ya tenga.

Verificar que el bytecode se está usando de verdad: en CloudWatch, el "Init Duration" de un
arranque en frío debe bajar ~1 s. Si no baja, el .pyc no coincide con la versión de Python
(se compiló con otra) y Python lo está ignorando en silencio.
FIN
