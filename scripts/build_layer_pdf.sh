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
# Medido en este repo (614 archivos .py de reportlab + xhtml2pdf):
#     sin bytecode ...... ~1.750 ms de import
#     con bytecode ......   ~640 ms de import      → ~1,1 s menos por arranque en frío
# Y en Lambda es PEOR: la medición es con una CPU completa; a 256 MB (~0,15 vCPU) el mismo
# trabajo tarda varias veces más.
#
# ⚠️ EL .pyc LLEVA DENTRO LA VERSIÓN DE PYTHON (`cpython-313`) y **solo lo usa esa versión**.
# Si se compila con otra, Python lo IGNORA y recompila — no falla, simplemente pierdes la
# mejora sin enterarte. Por eso este script EXIGE python3.13 (el runtime del repo) y aborta
# si no lo encuentra, en vez de compilar con el `python3` que haya a mano.
set -euo pipefail

ARCH="${1:-x86_64}"
PYVER="3.13"
PY="python${PYVER}"

case "$ARCH" in
  x86_64) PLAT="manylinux2014_x86_64" ;;
  arm64)  PLAT="manylinux2014_aarch64" ;;
  *) echo "❌ Arquitectura no reconocida: $ARCH (usa x86_64 o arm64)"; exit 1 ;;
esac

if ! command -v "$PY" >/dev/null 2>&1; then
  cat <<FIN
❌ Falta $PY, que es el runtime de las lambdas de este repo.

   Compilar con otra versión produce .pyc que Lambda IGNORA: el layer pesaría más y
   arrancaría igual de lento, sin ningún aviso. Opciones:

     · Instalar Python $PYVER localmente, o
     · usar el workflow .github/workflows/deploy-layer-pdf.yml (lo hace en CI con la
       versión correcta y además publica el layer).
FIN
  exit 1
fi
echo "🐍 $($PY -V)"

OUT="build/layer-pdf-$ARCH"
DEST="$OUT/python"
rm -rf "$OUT"; mkdir -p "$DEST"

echo "🔧 Layer de PDF para $ARCH"

# --only-binary=:all: obliga a bajar la RUEDA precompilada de la plataforma DESTINO en vez de
# compilar desde fuente con el compilador local (que produciría binarios de ESTA máquina).
"$PY" -m pip install \
  --platform "$PLAT" \
  --python-version "$PYVER" \
  --implementation cp \
  --only-binary=:all: \
  --target "$DEST" \
  --quiet --upgrade \
  'xhtml2pdf>=0.2.16' 'reportlab>=4.0' 'Pillow>=10.0' qrcode python-barcode beautifulsoup4 lxml

echo "🧹 Quitando lo que no se usa en ejecución (el peso del layer es tiempo de descarga)"
find "$DEST" -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -type d -name '*.dist-info' -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -type f -name '*.pyi' -delete 2>/dev/null || true

# EL PASO QUE IMPORTA. Sin esto el layer arranca ~1,1 s más lento en cada contenedor nuevo.
echo "⚙️  Precompilando el bytecode con $PY"
"$PY" -m compileall -q -f "$DEST" >/dev/null 2>&1 || true
PYC=$(find "$DEST" -name '*.pyc' | wc -l)
TAG=$(find "$DEST" -name '*.pyc' | head -1 | sed 's/.*\.\(cpython-[0-9]*\)\.pyc/\1/')
echo "   $PYC archivos .pyc ($TAG)"

# Guard: si el tag no es el del runtime, el layer NO va a aprovechar el bytecode.
if [ "$TAG" != "cpython-313" ]; then
  echo "❌ El bytecode quedó como '$TAG' y el runtime es python$PYVER. Lambda lo ignoraría."
  exit 1
fi

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

Y apuntarlo en las tres lambdas que renderizan:
  Api_V1_Template_Combination-EAP-PDF · Api_V1_Template_Render-pdf · Api_V1_Template_Render-engine

⚠️ \`--layers\` REEMPLAZA la lista completa: incluye los layers que la función ya tenga.
   Léelos antes con:
     aws lambda get-function-configuration --function-name X --query 'Layers[].Arn'

Verificar que sirvió: en CloudWatch, el "Init Duration" de un arranque en frío debe bajar
~1 s. Si no baja, el bytecode no se está usando.
FIN
