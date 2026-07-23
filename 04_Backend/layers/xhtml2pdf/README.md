# Lambda Layer — `xhtml2pdf`

Layer con el árbol de render de PDF que necesitan **dos** funciones:

- `Api_V1_Template_Render-pdf` — "Vista previa PDF" del editor de plantillas.
- `Api_V1_Template_Combination-EAP-PDF` — combinador del envío real EAP-PDF (un PDF por destinatario).

Ambas hacen `from xhtml2pdf import pisa` + `pisa.CreatePDF(...)`. Como en el resto del
proyecto **no hay imports compartidos entre lambdas**, el código de render está copiado en
las dos; este layer les entrega las **librerías** (no se bundlean en el zip de cada función).

## Contenido y compatibilidad

- `xhtml2pdf==0.2.16` + su árbol: `reportlab`, `Pillow`, `lxml`, `pyhanko`→`cryptography`,
  `svglib`, `pypdf`, `html5lib`, `python-bidi`, `arabic-reshaper`, … (ver `requirements.txt`).
- **Runtime objetivo: `python3.13`, arquitectura `x86_64`.** Los wheels son
  **manylinux2014** (glibc 2.17), compatibles con Amazon Linux 2023 (el SO de `python3.13`, glibc 2.34).
- Tamaño: **~21 MB** comprimido · **~58 MB** descomprimido (límite de Lambda: 250 MB
  descomprimido sumando función + layers).

> ⚠️ Las extensiones nativas (`Pillow`, `lxml`, `cryptography`, `cffi`, `python-bidi`) son
> **específicas de la versión de CPython (ABI) y de la arquitectura**. Este layer sirve para
> **python3.13 / x86_64**. Para `python3.12`/`python3.11` o `arm64 (Graviton)` hay que
> **reconstruir** (ver abajo) — un layer cp313 no carga en un runtime cp312/cp311.

## Construir el layer

Requiere `pip` (con salida a PyPI) y `zip`. **No** requiere Docker (usa wheels precompilados):

```bash
cd 04_Backend/layers/xhtml2pdf
./build.sh                    # python3.13 / x86_64 (default) → xhtml2pdf-layer.zip
# variantes:
PY_VERSION=3.12 ./build.sh    # otro runtime (ABI cp312)
ARCH=arm64 ./build.sh         # Graviton (manylinux2014_aarch64)
```

El zip queda con la estructura que Lambda espera (`python/xhtml2pdf/…`, `python/PIL/…`, …);
Lambda agrega `/opt/python` a `sys.path`, así que el import funciona sin más.

> El `.zip` es un **artefacto** (no se versiona; ver `.gitignore`). Se regenera con `build.sh`.

## Publicar y adjuntar (una sola vez, y en cada actualización de versión)

**1) Publicar la versión del layer** (zip < 50 MB ⇒ subida directa):

```bash
aws lambda publish-layer-version \
  --layer-name xhtml2pdf-py313 \
  --description "xhtml2pdf 0.2.16 + reportlab + Pillow (render PDF) — py3.13 x86_64" \
  --compatible-runtimes python3.13 \
  --compatible-architectures x86_64 \
  --zip-file fileb://xhtml2pdf-layer.zip
# → anota el "LayerVersionArn" que devuelve
```

**2) Adjuntar el layer a las DOS funciones.** `update-function-configuration --layers`
**reemplaza** la lista completa, así que incluye también los layers que ya tuvieran:

```bash
LAYER_ARN=arn:aws:lambda:us-east-1:<ACCOUNT>:layer:xhtml2pdf-py313:1
for FN in Api_V1_Template_Render-pdf Api_V1_Template_Combination-EAP-PDF; do
  aws lambda update-function-configuration --function-name "$FN" --layers "$LAYER_ARN"
done
```

**Alternativa por consola:** Lambda → *Layers* → *Create layer* → sube `xhtml2pdf-layer.zip`,
runtime `python3.13`, arch `x86_64`. Luego en cada función → *Layers* → *Add a layer* →
*Custom layers* → elige `xhtml2pdf-py313`.

## Verificar

Tras adjuntarlo, prueba `POST /Template/Render-pdf` con `{ "html": "<h1>Hola {{nombre}}</h1>",
"variables": {"nombre":"Ana"} }` → debe devolver `data.pdfBase64`. Si falta el layer, la lambda
responde **500** por el `ImportError` de `xhtml2pdf` (así se distingue de otros errores).

## Notas

- La `SECRET_KEY`/otras env no aplican aquí; el layer es solo librerías.
- Si en el futuro se bundlea en el zip de la función (en vez de layer), hay que asegurar que el
  Python del runner de CI coincida con el runtime (los `requirements.txt` de cada lambda lo
  advierten y traen las líneas comentadas).
