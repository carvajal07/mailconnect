# Lambda Layer — `pdf-engine` (motor estándar de PDF)

Layer con las librerías que necesita la función **`Api_V1_Template_Render-engine`**
(`POST /Template/Render-engine`) — el motor **ReportLab** que renderiza el JSON
posicionado del **Estudio PDF** (pdfsketch) y del **Diseñador PDF**.

> Es **distinto** del layer `xhtml2pdf` (ese es para `Render-pdf` / `Combination-EAP-PDF`,
> que renderizan **HTML**). Este motor toma `templateJson`/`sketch` (formas, texto,
> tablas, QR, códigos de barras posicionados) y no consume HTML.

El código del motor (`pdf_engine/`, `sketch_translator.py`) se bundlea en el **zip de la
función** (lo sube el CD); este layer solo entrega las **librerías** de terceros.

## Contenido y compatibilidad

- `reportlab` (dibuja el PDF), `Pillow` (imágenes / `ImageReader` para QR y códigos de
  barras), `qrcode` (genera el QR), `python-barcode` (CODE128/EAN13/EAN8/CODE39/ITF).
  Ver `requirements.txt`.
- **Runtime objetivo: `python3.13`, arquitectura `x86_64`.** Los wheels son
  **manylinux2014** (glibc 2.17), compatibles con Amazon Linux 2023 (glibc 2.34).

> ⚠️ La extensión nativa de `Pillow` es **específica de la versión de CPython (ABI) y de la
> arquitectura**. Este layer sirve para **python3.13 / x86_64**. Para `python3.12`/`3.11`
> o `arm64 (Graviton)` hay que **reconstruir** (un layer cp313 no carga en cp312/cp311).

## Construir el layer

Requiere `pip` (con salida a PyPI) y `zip`. **No** requiere Docker (usa wheels precompilados):

```bash
cd 04_Backend/layers/pdf-engine
./build.sh                    # python3.13 / x86_64 (default) → pdf-engine-layer.zip
# variantes:
PY_VERSION=3.12 ./build.sh    # otro runtime (ABI cp312)
ARCH=arm64 ./build.sh         # Graviton (manylinux2014_aarch64)
```

El zip queda con la estructura que Lambda espera (`python/reportlab/…`, `python/PIL/…`,
`python/qrcode/…`, `python/barcode/…`); Lambda agrega `/opt/python` a `sys.path`, así que
el import funciona sin más.

> El `.zip` es un **artefacto** (no se versiona; ver `.gitignore`). Se regenera con `build.sh`.

## Publicar y adjuntar

**1) Publicar la versión del layer** (zip < 50 MB ⇒ subida directa):

```bash
aws lambda publish-layer-version \
  --layer-name pdf-engine-py313 \
  --description "reportlab + Pillow + qrcode + python-barcode (motor PDF) — py3.13 x86_64" \
  --compatible-runtimes python3.13 \
  --compatible-architectures x86_64 \
  --zip-file fileb://pdf-engine-layer.zip
# → anota el "LayerVersionArn" que devuelve
```

**2) Adjuntar el layer a la función.** `update-function-configuration --layers`
**reemplaza** la lista completa, así que incluye también los layers que ya tuviera:

```bash
LAYER_ARN=arn:aws:lambda:us-east-1:<ACCOUNT>:layer:pdf-engine-py313:1
aws lambda update-function-configuration \
  --function-name Api_V1_Template_Render-engine --layers "$LAYER_ARN"
```

**Alternativa por consola:** Lambda → *Layers* → *Create layer* → sube `pdf-engine-layer.zip`,
runtime `python3.13`, arch `x86_64`. Luego en la función → *Layers* → *Add a layer* →
*Custom layers* → elige `pdf-engine-py313`.

## Verificar

Tras adjuntarlo, prueba `POST /Template/Render-engine` con un `sketch`/`templateJson`
mínimo → debe devolver `data.pdfBase64`. Si falta el layer, la lambda responde **500**
por el `ImportError` de `reportlab` (así se distingue de otros errores). QR y códigos de
barras: si faltan `qrcode`/`python-barcode` NO revienta — el motor dibuja un marcador
("qrcode not installed" / "python-barcode not installed"), así que conviene confirmar que
ambos estén en el layer para que salgan de verdad.

## Notas

- La ruta `/Template/Render-engine` se declara en `infra/api/routes.json` (la crea
  `deploy-api.yml`). La función `Api_V1_Template_Render-engine` la crea/actualiza
  `deploy-lambdas.yml`. Este layer es el **último** requisito para que la vista previa
  del Estudio/Diseñador funcione de punta a punta.
- El layer es solo librerías (no lleva env vars).
