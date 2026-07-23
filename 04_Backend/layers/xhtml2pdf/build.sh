#!/usr/bin/env bash
#
# Construye el Lambda LAYER de xhtml2pdf (render de PDF) para las funciones
# Api_V1_Template_Render-pdf y Api_V1_Template_Combination-EAP-PDF.
#
# Produce xhtml2pdf-layer.zip con la estructura que AWS Lambda espera:
#     python/xhtml2pdf/...   python/PIL/...   python/reportlab/...   (etc.)
# Lambda agrega /opt/python a sys.path, por lo que el import funciona directo.
#
# CLAVE (compatibilidad binaria): reportlab/Pillow/lxml/cryptography traen extensiones
# nativas (.so). Se DEBEN bajar wheels manylinux2014 (glibc 2.17), compatibles con el
# runtime python3.11 de Lambda (Amazon Linux 2, glibc 2.26). Por eso se fuerza
# --platform/--only-binary y NO se compila localmente. Para python3.12 (AL2023, glibc
# 2.34) sirve igual manylinux2014, pero hay que rebuild con PY_VERSION=3.12 (ABI cp312).
#
# Uso:
#   ./build.sh                      # python3.11, x86_64 (default)
#   PY_VERSION=3.12 ./build.sh      # otro runtime
#   ARCH=arm64 ./build.sh           # Graviton (manylinux2014_aarch64)
#
# Requiere: pip (con acceso a PyPI) y zip. NO requiere Docker (usa wheels precompilados).
set -euo pipefail

PY_VERSION="${PY_VERSION:-3.11}"
ARCH="${ARCH:-x86_64}"                    # x86_64 | arm64
OUT="${OUT:-xhtml2pdf-layer.zip}"
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
echo "   Publica:  aws lambda publish-layer-version --layer-name xhtml2pdf-py${PY_VERSION//./} \\"
echo "               --compatible-runtimes python${PY_VERSION} --compatible-architectures ${ARCH} \\"
echo "               --zip-file fileb://$OUT"
