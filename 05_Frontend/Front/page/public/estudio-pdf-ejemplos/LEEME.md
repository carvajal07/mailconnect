# Plantillas de ejemplo — Estudio PDF

Archivos `.json` para **importar** en el **Estudio PDF** (portal → Plantillas → Estudio PDF →
botón **Importar JSON**). Sirven para probar y verificar, de un vistazo, qué funciones del
editor funcionan en el lienzo y cuáles se renderizan en el PDF real (motor del backend, botón
**Vista previa PDF**).

## Archivos

| Archivo | Hojas | Qué prueba |
|---|---|---|
| `00-demo-completa.json` | 3 | Todo lo de abajo en un solo documento (figuras + texto + tablas/códigos). |
| `01-formas.json` | 1 | Rectángulos, círculos/elipses, triángulos y líneas en distintos **tamaños**, **girados**, con **borde**, **relleno** (sólido, degradado lineal/radial, opacidad) y **tipos de línea** (sólida, guiones, punteada, grosores). Incluye un **trazo libre** (lápiz). |
| `02-texto.json` | 1 | Texto con distintas **fuentes** (Helvetica/Times/Courier), **tamaños**, **negrita/cursiva**, **subrayado/tachado**, **MAYÚSCULAS**, **interletra**, **super/subíndice** y color por fragmento, **alineación** (izq/centro/der/justificado bloque), **listas** (viñetas/numerada/letras), **sangrías + espaciado** de párrafo y un **campo de datos** `{{variable}}`. |
| `03-tablas-qr-imagenes.json` | 1 | **Tabla** con encabezado, filas cebra y pie; **QR** (fijo y por variable); **códigos de barras** CODE128 y EAN-13; **imágenes**. |

## Cómo usarlos

1. Portal → **Plantillas → Estudio PDF**.
2. **Importar JSON** → elige uno de estos archivos → se abre el editor con el diseño.
3. Revisa en el lienzo; usa **Vista previa PDF** para ver el render real del motor.
4. **Exportar** vuelve a descargar el diseño actual como `.json` (ida y vuelta).

## Qué NO se renderiza en el PDF (limitaciones conocidas del motor)

Estas funciones se ven en el **lienzo** pero el **motor del backend** aún no las renderiza; al
generar la Vista previa aparecen como **avisos** (⚠️), no como error:

- **Trazo libre (lápiz / `pen`)** → se omite en el PDF (solo lienzo).
- **Imágenes con `data:` URI** (como las de `03-…` y `00-…`) → el motor pone un **marcador**;
  para que salgan en el PDF hay que subir la imagen a S3 y usar su **URL pública** (`https://…`).

El resto (formas con degradados/opacidad/giro, todo el texto enriquecido, tablas, QR y códigos
de barras) **sí** se renderiza en el PDF.
