#!/usr/bin/env bash
#
# Construye el Lambda LAYER del MOTOR ESTÁNDAR de PDF (ReportLab) para la función
# Api_V1_Template_Render-engine (Estudio PDF / Diseñador PDF).
#
# Produce pdf-engine-layer.zip con la estructura que AWS Lambda espera:
#     python/reportlab/...   python/PIL/...   python/qrcode/...   python/barcode/...
# Lambda agrega /opt/python a sys.path, por lo que el import funciona directo.
#
# CLAVE (compatibilidad binaria): Pillow trae extensiones nativas (.so).
# Se DEBEN bajar wheels manylinux2014 (glibc 2.17), que son
# compatibles con el runtime python3.13 de Lambda (Amazon Linux 2023, glibc 2.34) y
# también con python3.11/3.12. Por eso se fuerza --platform/--only-binary y NO se compila
# localmente. El ABI (cp313, cp312, cp311…) SÍ es específico: un layer cp313 NO carga en
# cp311 y viceversa → hay que rebuild con el PY_VERSION del runtime real.
#
# Uso:
#   ./build.sh                      # python3.13, x86_64 (default — runtime de las lambdas)
#   PY_VERSION=3.12 ./build.sh      # otro runtime
#   ARCH=arm64 ./build.sh           # Graviton (manylinux2014_aarch64)
#
# Requiere: pip (con acceso a PyPI) y zip. NO requiere Docker (usa wheels precompilados).
set -euo pipefail

PY_VERSION="${PY_VERSION:-3.13}"
ARCH="${ARCH:-x86_64}"                    # x86_64 | arm64
OUT="${OUT:-pdf-engine-layer.zip}"
ABI="cp${PY_VERSION//./}"                 # 3.11 -> cp311

case "$ARCH" in
  x86_64) PLATFORM="manylinux2014_x86_64" ;;
  arm64|aarch64) PLATFORM="manylinux2014_aarch64" ;;
  *) echo "ARCH inválida: $ARCH (usa x86_64 o arm64)"; exit 1 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
mkdir -p "$BUILD/python"

echo ">> pip install (py${PY_VERSION} / ${PLATFORM} / ${ABI}) → wheels precompilados"
pip install \
  --platform "$PLATFORM" \
  --implementation cp \
  --python-version "$PY_VERSION" \
  --abi "$ABI" \
  --only-binary=:all: \
  --target "$BUILD/python" \
  ${PIP_CERT:+--cert "$PIP_CERT"} \
  -r "$HERE/requirements.txt"

echo ">> trim (cachés/tests) + strip de símbolos de .so"
find "$BUILD/python" -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
find "$BUILD/python" -type d \( -name tests -o -name test \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$BUILD/python" -type f -name "*.pyc" -delete 2>/dev/null || true
find "$BUILD/python" -type f -name "*.so*" -exec strip --strip-unneeded {} + 2>/dev/null || true

echo ">> zip → $HERE/$OUT"
( cd "$BUILD" && zip -rq9 "$OUT" python )
mv "$BUILD/$OUT" "$HERE/$OUT"

echo ">> listo: $HERE/$OUT ($(du -h "$HERE/$OUT" | cut -f1)), descomprimido $(du -sh "$BUILD/python" | cut -f1)"
echo "   Publica:  aws lambda publish-layer-version --layer-name pdf-engine-py${PY_VERSION//./} \\"
echo "               --compatible-runtimes python${PY_VERSION} --compatible-architectures ${ARCH} \\"
echo "               --zip-file fileb://$OUT"
