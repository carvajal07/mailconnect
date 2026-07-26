# FORMATO_BASES.md — Definición de los archivos de bases de datos (CSV, CSV multiregistro y JSON)

> **Propósito:** especificación EXACTA de los formatos de archivo que acepta la carga
> de **Bases de datos** del portal (además del Excel `.xlsx`, que es solo una comodidad
> de entrada: se convierte a CSV con estas mismas reglas). Corresponde con lo que está
> montado hoy en el código:
>
> - Front: `05_Frontend/Front/page/src/components/portal/csv.ts` (parser, análisis,
>   `jsonToRows`, `multiRecordToRows`) y `BasesDatosSection.tsx` (carga y validación).
> - Backend: `Api_V1_Email_Prepare-batch-template` (lectura POSICIONAL del CSV en
>   muestras y envío real), `Api_V1_Database_Register-file` (registro + vista previa),
>   `Api_V1_Template_Combination-EAP-PDF` (celdas JSON → tablas con repetición).
>
> Si el código cambia, este documento debe actualizarse con él.

---

## 1. Modelo de datos interno (a lo que TODO se convierte)

El pipeline de envío (Prepare-batch, combinadores, reportes) siempre consume **un CSV
con encabezado donde una fila = un destinatario**. Los tres formatos de entrada llegan
ahí por caminos distintos:

| Formato de entrada | ¿Cómo llega al modelo interno? |
|---|---|
| **CSV con encabezado** (§2) | Tal cual (es el modelo interno). |
| **CSV multiregistro** sin encabezado (§3) | Se convierte EN EL NAVEGADOR: la línea principal → la fila del destinatario; los sub-registros → columnas con array JSON. |
| **JSON** (§4) | Se convierte EN EL NAVEGADOR: cada objeto → una fila; los campos anidados → columnas con array JSON. |
| **Excel .xlsx** | Primera hoja → CSV (comodidad de entrada; mismas reglas del §2). |

**Sub-registros ("registros de múltiples tipos"):** los datos hijos de un destinatario
(movimientos de un extracto, gastos de una tarjeta, facturas…) viven como **array JSON
dentro de una celda** de su fila (§5). Ese array alimenta las **tablas con repetición**
(`repeatBy`) del Estudio PDF, una fila por ítem y por destinatario, con paginación
automática a hojas nuevas si desbordan.

### 1.1 Las 3 columnas obligatorias (orden posicional fijo)

El backend lee por POSICIÓN: `line[0]`, `line[1]`, `line[2]`.

| Pos. | Columna | Contenido | Sinónimos aceptados en el encabezado* |
|---|---|---|---|
| 1 | **Identificación** | Documento del destinatario (texto; conserva ceros a la izquierda) | `identificacion`, `cedula`, `documento`, `id`, `nit`, `nrodocumento` |
| 2 | **Contacto** | Canal EMAIL → **correo**. Canales SMS/WhatsApp/Voz → **celular** (E.164 `+57…` o local colombiano de 10 dígitos) | Correo: `correo`, `email`, `emails`, `mail`, `correoelectronico` · Celular: `celular`, `telefono`, `movil`, `phone`, `cel`, `tel`, `numero`, `whatsapp`, `msisdn` |
| 3 | **Nombre** | Nombre del destinatario | `nombre`, `nombres`, `name` |

\* Comparación **normalizada**: minúsculas, sin acentos, solo `[a-z0-9]`
(`Correo Electrónico` ≡ `correoelectronico`, `Cédula` ≡ `cedula`).

**El canal se elige al cargar la base** (selector Correo/SMS/WhatsApp/Voz), queda en
`databaseFile.channel` y define qué se exige en la columna 2. Las demás columnas son
libres y quedan disponibles como **variables `{{Columna}}`** en las plantillas.

---

## 2. Formato CSV con encabezado (modelo interno)

### 2.1 Estructura

- **Codificación:** UTF-8 (el BOM `﻿` de Excel se tolera y se elimina).
- **Fila 1 = encabezado** (nombres de columna → las variables disponibles).
- **Filas 2..N = datos**, una por destinatario. Filas totalmente vacías se descartan.
- **Delimitador:** `;` `,` `TAB` `|`. Se **detecta solo** contando cuál aparece más en
  la primera línea (corregible en el diálogo). Los CSV que genera el sistema (desde
  Excel, JSON o multiregistro) usan siempre `;`.
- **Comillas (RFC 4180):** una celda con el delimitador, comillas o saltos de línea va
  entre comillas dobles; las comillas internas se duplican (`""`). Así una celda puede
  llevar un **JSON embebido** (§5) sin romper el archivo — tanto el parser del
  navegador (`parseCsv`) como el del backend (`csv.reader` de Python) lo entienden.

### 2.2 Validación en el navegador (antes de subir)

`analyzeCsv(text, delimitador, tipoContacto)` muestra en el diálogo:

1. **Estructura obligatoria (por POSICIÓN):** el encabezado de las posiciones 1–3 se
   compara contra los sinónimos de §1.1 según el canal. Cada columna sale ✓/✗; si
   alguna falla aparece la advertencia *"La estructura no cumple el orden requerido…"*.
   ⚠️ La advertencia **no bloquea** el botón "Subir a S3", pero un archivo mal
   posicionado enviará datos equivocados (el backend lee por posición).
2. **Contactos** (columna 2, o la detectada por nombre/contenido si la 2 no valida):
   - **Válidos:** formato correcto y sin repetir. Correo → regex estricta; celular →
     `libphonenumber` (país por defecto `CO`: acepta `+573001234567` o `3001234567`).
   - **Inválidos:** vacíos o con formato imposible para el canal.
   - **Duplicados:** mismo contacto repetido (correos en minúsculas; celulares
     normalizados: `3001234567` ≡ `+573001234567`).
3. **Vista previa:** primeras filas del archivo.

### 2.3 Qué hace el backend en el envío

- `next(reader)` → la primera línea es el encabezado (viaja en el mensaje SQS como
  `headers` para resolver variables).
- Por fila: `line[0]` identificación · `line[1]` contacto · `line[2]` nombre.
- **Validación por canal** (`valid_contact`): correo (EM/EAU/EAP) o celular (SMS/WSP/
  VOZ) **normalizado a E.164** (`normalize_phone`, `+57` por defecto). Un contacto
  inválido queda con **estado 11** y no se encola.
- **Deduplicación** (`_contact_key`): por defecto el envío real deduplica por contacto
  normalizado y el cobro va sobre contactos DISTINTOS; con la casilla **"Permitir
  duplicados"** de la carga se envía el total.
- **Filtros:** lista negra y desuscritos del cliente se excluyen en el envío real.

### 2.4 Ejemplo (canal EMAIL, delimitador `;`)

```csv
Identificacion;Correo;Nombre;Ciudad;Cupo
1030567890;ana.perez@correo.com;Ana Pérez;Bogotá;5000000
79345123;luis@correo.com;Luis Gómez;Cali;1200000
```

---

## 3. Formato CSV MULTIREGISTRO (sin encabezado; columna 1 = tipo de registro)

Layout clásico de archivos planos jerárquicos: **no hay fila de encabezado** y la
**columna 1 de cada línea es la ETIQUETA del tipo de registro**. Un destinatario ocupa
VARIAS líneas: su línea principal + las líneas de sus sub-registros.

### 3.1 Reglas del formato

1. **El tipo de la PRIMERA línea es el tipo PRINCIPAL** (el destinatario). No se
   declara en ninguna parte: se infiere de la primera línea del archivo.
2. **Cada línea principal abre un registro.** Todas las líneas siguientes de otros
   tipos (`ingresos`, `egresos`, `detalles`, …) pertenecen a ESE destinatario, hasta
   la próxima línea principal. Un mismo tipo puede repetirse N veces por destinatario.
3. **Contrato de la línea principal:** `tipo;identificación;contacto;nombre;extras…` —
   los 3 obligatorios de §1.1 **en ese orden** después de la etiqueta (el backend lee
   por posición). El contacto es correo o celular según el canal elegido.
4. **Líneas de sub-registro:** `tipo;campo1;campo2;…` — estructura libre por tipo
   (cada tipo puede tener distinto número de campos; si varía entre líneas del mismo
   tipo, se toma el máximo y las cortas se rellenan con vacío).
5. Líneas con la columna 1 vacía, o sub-registros ANTES de la primera línea principal,
   se ignoran.
6. Delimitadores y comillas: las mismas reglas del §2.1.

### 3.2 Ejemplo

```csv
principal;1030567890;ana@correo.com;Ana Pérez
ingresos;20.000;sueldo
egresos;10.000;arriendo
egresos;5.000;servicios
principal;79345123;luis@correo.com;Luis Gómez
ingresos;30.000;sueldo
egresos;1.000;arriendo
```

Dos destinatarios; Ana con 1 ingreso y 2 egresos, Luis con 1 y 1.

### 3.3 Detección y carga — Asistente paso a paso

Al cargar un CSV que parece multiregistro, el diálogo abre un **asistente (wizard) de
3 pasos** (`MultiRecordWizard`) en lugar del mapeo por texto. La detección es
automática: en un CSV normal la primera línea es un encabezado ÚNICO; si el valor de
la columna identificadora **se repite** en otras líneas (mirando las primeras 20), es
una etiqueta de tipo → se activa el asistente. Un **switch "Archivo multiregistro"**
corrige la detección en ambos sentidos (p. ej. un archivo con UN solo destinatario,
donde la etiqueta principal no alcanza a repetirse).

- **Paso 1 — Detección del identificador:** un selector **"¿En qué columna está el
  tipo de registro?"** (por defecto **Columna 1**) por si la etiqueta no está en la
  primera posición, y las **etiquetas detectadas** en la muestra como chips (el
  principal marcado).
- **Paso 2 — Alias de los canales:** una tarjeta por canal con su etiqueta original,
  el **volumen** (`ingresos • 4 líneas en la muestra`) y un campo **"Nombre amigable
  para este canal"**. En los canales secundarios ese alias es además el **nombre de la
  columna** que agrupa sus líneas (la que se vincula con una tabla en la plantilla).
- **Paso 3 — Nombres de columna:** dentro de la tarjeta de cada canal, **un input por
  cada columna física** detectada (`Nombre del Campo 1`, `Nombre del Campo 2`…), con
  **placeholders sugeridos** (`Identificacion`, `Correo`/`Celular`, `Nombre` en el
  principal). Validación en vivo: marca los campos vacíos (caen a `Campo N`) y los
  **nombres repetidos** dentro de un canal (bloquean la subida). ⚠️ Los nombres de los
  campos de un sub-registro deben coincidir con los **encabezados de las columnas de la
  tabla** en la plantilla del Estudio (§5.2).

La **vista previa inferior se actualiza en tiempo real** con los encabezados mapeados
(las columnas de lista muestran "N ítems"). Internamente la configuración se
estructura como un **mapa indexado por la posición física de la columna**
(`buildMultiRecordMap`): `{ tagColumn, channels: { <tag>: { alias, isMaster,
columns: { <posición 1-based>: <nombre> } } } }`.

- **Conversión:** al modelo interno, en el navegador. El ejemplo de §3.2, con los
  campos de `ingresos`/`egresos` renombrados a `Valor, Concepto`, genera:

```csv
Identificacion;Correo;Nombre;ingresos;egresos
1030567890;ana@correo.com;Ana Pérez;"[{""Valor"":""20.000"",""Concepto"":""sueldo""}]";"[{""Valor"":""10.000"",""Concepto"":""arriendo""},{""Valor"":""5.000"",""Concepto"":""servicios""}]"
79345123;luis@correo.com;Luis Gómez;"[{""Valor"":""30.000"",""Concepto"":""sueldo""}]";"[{""Valor"":""1.000"",""Concepto"":""arriendo""}]"
```

  Es decir: **cada tipo hijo se vuelve UNA columna** (con el nombre de su etiqueta)
  cuyo valor es el array JSON de sus líneas. A S3 sube ese CSV generado (sufijo
  `-registros.csv`, delimitador `;`); el backend no cambia.
- **Validación:** después de la conversión aplican las MISMAS reglas del §2.2. Ojo:
  como los nombres de las 3 primeras columnas son generados, la señal útil es el
  conteo de **válidos/inválidos** — si la línea principal no trae el contacto en la
  posición 2 del contrato (§3.1.3), los destinatarios saldrán inválidos.

### 3.4 Límites

- **Un solo tipo principal** por archivo (el de la primera línea).
- **Un nivel de jerarquía:** principal → sub-registros. No hay sub-sub-registros
  (para eso, el formato JSON con objetos anidados dentro del ítem tampoco despliega
  más de un nivel en tablas — ver §5.4).
- El "tipo" de cada sub-registro queda implícito en su columna; no se conserva la
  intercalación GLOBAL entre tipos distintos (los `ingresos` y `egresos` de un
  destinatario son listas separadas, cada una en su orden original).

---

## 4. Formato JSON

### 4.1 Formas aceptadas

**(a) Array de objetos** — cada objeto es UN destinatario:

```json
[
  { "cedula": "1030567890", "correo": "ana@correo.com", "nombre": "Ana", "ciudad": "Bogotá" },
  { "cedula": "79345123",   "correo": "luis@correo.com", "nombre": "Luis", "ciudad": "Cali" }
]
```

**(b) Objeto envoltorio** — la lista bajo una llave conocida (**sin importar
mayúsculas**): `Documents`, `data`, `rows`, `records`, `items`, `destinatarios`,
`registros`; o, en su defecto, la **primera propiedad de nivel superior que sea un
array**. Ejemplo:

```json
{ "Documents": [ { "IdUnico": "00000127850", "Canal_Datos": "MUPEINT" }, … ] }
```

Se toleran las **comas finales** (`,]` / `,}`) comunes en exportaciones.

Errores (mensaje en el diálogo): no parsea → *"El archivo no es un JSON válido."* ·
no es array ni envoltorio con array, o vacío → *"El JSON debe ser un array de objetos
(o traer la lista en "Documents"/"data"/"rows"/"records"/"items")."* · un elemento no
es objeto → *"Cada registro del JSON debe ser un objeto { campo: valor }."*

### 4.2 Columnas y obligatorias

- **Columnas = unión de las llaves** de todos los objetos, en orden de aparición.
- **Reordenamiento automático:** las 3 obligatorias se buscan por los **sinónimos** de
  §1.1 y se mueven a las posiciones 1–2–3. El orden de las llaves en el archivo NO
  importa (ventaja sobre el CSV). Si una obligatoria no aparece por sinónimos, la
  validación de estructura la marcará ✗ (hay que renombrar el campo en el archivo).

### 4.3 Valores

| Valor JSON | En la celda del CSV generado |
|---|---|
| `string` | Tal cual |
| `number` | Texto sin notación científica |
| `boolean` | `true` / `false` |
| `null` / ausente | Vacío |
| **`array` / `object`** | **JSON serializado dentro de la celda** (§5) |

### 4.4 Ejemplo (extracto con movimientos)

```json
[
  {
    "cedula": "1030567890",
    "correo": "ana@correo.com",
    "nombre": "Ana Pérez",
    "saldo": 2450000,
    "movimientos": [
      { "Fecha": "2026-07-01", "Detalle": "Compra supermercado", "Valor": "-185.000" },
      { "Fecha": "2026-07-03", "Detalle": "Abono nómina",        "Valor": "+3.200.000" }
    ]
  }
]
```

El JSON se convierte a CSV en el navegador (`jsonToRows` + `rowsToCsv`, `;`) y a S3
sube ese CSV. Después aplican las validaciones del §2.2.

---

## 5. Celdas con array (sub-registros) → tablas con repetición

El punto de encuentro de los tres formatos: los registros hijos de un destinatario van
en una **columna con nombre**, como array JSON, dentro de su fila.

1. **Origen del array:** columna de tipo hijo del multiregistro (§3.3), campo anidado
   del JSON (§4.3), o JSON escrito a mano en una celda del CSV (§2.1, con comillas).
2. **En la plantilla del Estudio PDF:** la tabla se vincula con `repeatBy = <nombre de
   la columna>` (panel de Datos). **Las llaves de cada ítem deben llamarse IGUAL que
   los encabezados de las columnas de la tabla** (comparación exacta, o minúsculas
   como último recurso). Por eso el diálogo del multiregistro permite renombrar
   `Campo1, Campo2…` a nombres reales (`Valor, Concepto`).
3. **En el envío real (EAP-PDF):** el combinador parsea la celda (`_coerce_json_cell`:
   toda celda que empiece por `[` o `{`; si no parsea, queda como texto literal) → la
   variable llega como LISTA al motor → la tabla pinta **una fila por ítem, por
   destinatario**. Si no caben en el alto de la tabla, el PDF **pagina a hojas
   nuevas** (encabezado de tabla repetido; los demás elementos como membrete).
4. **En la vista previa del Estudio:** igual, con la primera fila de muestra de la
   base (`coerceSampleCell`).
5. **En el camino HTML** (editor básico xhtml2pdf) y en SMS/WhatsApp/Voz: una
   variable-lista se sustituye como texto JSON (no hay tablas con repetición ahí).

**Límites:** array de **objetos planos** (objetos anidados dentro del ítem no se
despliegan en columnas); un nivel de anidamiento útil (destinatario → ítems). La vista
previa persistente guarda las celdas JSON hasta **4.000 caracteres** (las normales a
500); un array más largo se trunca SOLO en esa vista previa — el envío real siempre
lee el CSV completo de S3.

---

## 6. Qué pasa con las columnas después de la carga

- `Database/Register-file` guarda `columns` (encabezados) y `previewRows` (máx. 5
  filas × 40 columnas; celdas a 500 chars, JSON a 4.000, presupuesto total ~100 KB).
  De ahí salen el "ver detalle", el selector de variables (`DatabaseFieldPicker`) y el
  panel de Datos del Estudio.
- **Variables por canal:**
  - **Email (EM/EAU/EAP):** `{{Columna}}` en plantillas SES/HTML/DOCX/PDF.
  - **SMS / Voz:** `{{Columna}}` dentro del texto del mensaje.
  - **WhatsApp:** los parámetros `{{1}}, {{2}}, …` de la plantilla HSM se llenan **por
    posición** con las columnas desde Nombre en adelante (`{{1}}` = columna 3,
    `{{2}}` = columna 4, …).
  - **EAP (DOCX/PDF):** la combinación reemplaza `{{Columna}}`/`data-var` con la fila
    de CADA destinatario; tolera diferencias de BOM/espacios/mayúsculas entre el
    encabezado del CSV y el binding del editor (alias saneados).

---

## 7. Preguntas frecuentes

**¿Puedo mezclar líneas de distintos tipos (principal/detalle) en el mismo CSV?**
Sí — ese es exactamente el formato **multiregistro** del §3: sin encabezado, columna 1
= tipo, la primera línea define el tipo principal y los demás tipos se agrupan bajo el
destinatario anterior. El sistema lo detecta solo y lo convierte al modelo interno.

**¿El orden de las columnas importa?**
CSV con encabezado: sí para las 3 obligatorias (posiciones 1–2–3), el resto libre.
Multiregistro: sí en la línea principal (`tipo;identificación;contacto;nombre;…`).
JSON: no — el sistema reordena las obligatorias por sinónimos.

**¿Cómo sabe el sistema qué columna trae el tipo de registro?**
Solo aplica al multiregistro: SIEMPRE es la **columna 1** de cada línea, y el tipo
principal es el de la **primera línea** del archivo. En los otros formatos no hay
columna de tipo (una fila/objeto = un destinatario).

**¿Qué pasa si un contacto es inválido?**
En la carga solo se informa (contadores). En el envío real no se encola y queda con
estado 11 (email/celular inválido) en el reporte.

**¿Los duplicados se envían?**
Por defecto no (se deduplica por contacto normalizado y el cobro va sobre contactos
distintos). Con "Permitir duplicados" al cargar la base, se envía el total.
