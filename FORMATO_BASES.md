# FORMATO_BASES.md — Definición de los archivos de bases de datos (CSV y JSON)

> **Propósito:** especificación EXACTA de los dos formatos de archivo que acepta la
> carga de **Bases de datos** del portal (además del Excel `.xlsx`, que es solo una
> comodidad de entrada: se convierte a CSV con estas mismas reglas). Corresponde con
> lo que está montado hoy en el código:
>
> - Front: `05_Frontend/Front/page/src/components/portal/csv.ts` (parser, análisis,
>   `jsonToRows`) y `BasesDatosSection.tsx` (carga y validación).
> - Backend: `Api_V1_Email_Prepare-batch-template` (lectura POSICIONAL del CSV en
>   muestras y envío real), `Api_V1_Database_Register-file` (registro + vista previa),
>   `Api_V1_Template_Combination-EAP-PDF` (celdas JSON → tablas con repetición).
>
> Si el código cambia, este documento debe actualizarse con él.

---

## 1. Modelo de datos (aplica a los dos formatos)

**Una fila = un destinatario.** No existe el concepto de "archivo multiregistro"
clásico (donde una columna trae el TIPO de registro — `01` encabezado, `02` detalle —
y cada tipo tiene su propio layout). En MailConnect **no hay columna de tipo de
registro**: todas las filas tienen la misma estructura, y los datos "hijos" de un
destinatario (por ejemplo, los movimientos de su extracto) viajan **dentro de una
celda** de su propia fila, como un array JSON (ver §4).

| Concepto | Cómo se resuelve en MailConnect |
|---|---|
| ¿Cuáles son las columnas? | **CSV:** la PRIMERA fila del archivo es el encabezado (nombres de columna). **JSON:** las LLAVES de cada objeto son las columnas. |
| ¿Dónde está el "tipo de registro"? | No existe. Una fila siempre es un destinatario. Los sub-registros van EMBEBIDOS como array JSON en una celda; el "tipo" del sub-registro es el **nombre de la columna** que lo contiene (`movimientos`, `facturas`, …). |
| ¿Campos obligatorios? | Tres, y se validan **POR POSICIÓN** (el backend lee `line[0]`, `line[1]`, `line[2]`): 1ª **Identificación** · 2ª **Contacto** (correo o celular según el canal) · 3ª **Nombre**. |
| ¿Campos adicionales? | Todas las demás columnas son libres y quedan disponibles como **variables `{{Columna}}`** en las plantillas. |

### 1.1 Las 3 columnas obligatorias (orden fijo)

| Pos. | Columna | Contenido | Sinónimos aceptados en el encabezado* |
|---|---|---|---|
| 1 | **Identificación** | Documento del destinatario (texto; conserva ceros a la izquierda) | `identificacion`, `cedula`, `documento`, `id`, `nit`, `nrodocumento` |
| 2 | **Contacto** | Canal EMAIL → **correo**. Canales SMS/WhatsApp/Voz → **celular** (E.164 `+57…` o local colombiano de 10 dígitos) | Correo: `correo`, `email`, `emails`, `mail`, `correoelectronico` · Celular: `celular`, `telefono`, `movil`, `phone`, `cel`, `tel`, `numero`, `whatsapp`, `msisdn` |
| 3 | **Nombre** | Nombre del destinatario | `nombre`, `nombres`, `name` |

\* Los encabezados se comparan **normalizados**: minúsculas, sin acentos y solo
`[a-z0-9]` (`normHeader` en `csv.ts`). Así `Correo Electrónico` ≡ `correoelectronico`
y `Cédula` ≡ `cedula`.

**El canal se elige al cargar la base** (selector Correo/SMS/WhatsApp/Voz) y queda
guardado en `databaseFile.channel`. Ese canal define qué se exige en la columna 2.

---

## 2. Formato CSV

### 2.1 Estructura

- **Codificación:** UTF-8 (el BOM `﻿` de Excel se tolera y se elimina).
- **Fila 1 = encabezado** (obligatoria). Nombres de columna; son los que quedan
  disponibles como variables `{{Columna}}`.
- **Filas 2..N = datos**, una por destinatario. Filas totalmente vacías se descartan.
- **Delimitador:** cualquiera de `;` `,` `TAB` `|`. Se **detecta solo** contando cuál
  aparece más en la primera línea (el usuario puede corregirlo en el diálogo). Los CSV
  que genera el sistema (desde Excel o JSON) usan siempre `;`.
- **Comillas (RFC 4180):** una celda que contenga el delimitador, comillas o saltos de
  línea va entre comillas dobles; las comillas internas se duplican (`""`). Tanto el
  parser del navegador (`parseCsv`) como el del backend (`csv.reader` de Python) las
  entienden — por eso una celda puede llevar un **JSON embebido** (§4) sin romper el
  archivo.

### 2.2 Validación en el navegador (antes de subir)

`analyzeCsv(text, delimitador, tipoContacto)` calcula y muestra en el diálogo:

1. **Estructura obligatoria (por POSICIÓN):** compara el encabezado de las posiciones
   1–3 contra los sinónimos de la tabla de §1.1 (según el canal elegido). Cada columna
   sale con ✓/✗; si alguna falla, se muestra la advertencia *"La estructura no cumple
   el orden requerido…"*. ⚠️ La advertencia **no bloquea** el botón "Subir a S3" — pero
   un archivo mal posicionado enviará datos equivocados (el backend lee por posición),
   así que debe corregirse.
2. **Contactos:** sobre la columna 2 (o, si la posición 2 no valida, sobre la columna
   detectada por nombre/contenido) cuenta:
   - **Válidos:** formato correcto y sin repetir. Correo → regex estricta; celular →
     `libphonenumber` con país por defecto `CO` (acepta `+573001234567` o `3001234567`).
   - **Inválidos:** vacíos o con formato imposible para el canal.
   - **Duplicados:** mismo contacto repetido (correos en minúsculas; celulares
     normalizados, `3001234567` ≡ `+573001234567`).
3. **Vista previa:** primeras filas del archivo.

### 2.3 Qué hace el backend con el CSV (envío)

`Prepare-batch` (muestras y envío real) lee el archivo de S3 así:

- `next(reader)` → la **primera línea es el encabezado** (viaja en el mensaje SQS como
  `headers` para resolver variables).
- Por cada fila: `line[0]` = identificación · `line[1]` = contacto · `line[2]` = nombre.
- **Validación por canal** (`valid_contact`): correo (EM/EAU/EAP) o celular (SMS/WSP/
  VOZ). Los celulares se **normalizan a E.164** (`normalize_phone`, `+57` por defecto);
  un contacto inválido queda registrado con **estado 11** (no se encola).
- **Deduplicación** (`_contact_key`): por defecto el envío real deduplica por contacto
  normalizado y el cobro se dimensiona sobre contactos DISTINTOS; si la base se cargó
  con **"Permitir duplicados"**, se envía el total.
- **Filtros:** lista negra y desuscritos del cliente se excluyen en el envío real.

### 2.4 Ejemplo mínimo (canal EMAIL, delimitador `;`)

```csv
Identificacion;Correo;Nombre;Ciudad;Cupo
1030567890;ana.perez@correo.com;Ana Pérez;Bogotá;5000000
79345123;luis@correo.com;Luis Gómez;Cali;1200000
```

`Ciudad` y `Cupo` quedan disponibles como `{{Ciudad}}` y `{{Cupo}}` en las plantillas.

---

## 3. Formato JSON

### 3.1 Formas aceptadas

**(a) Array de objetos** — cada objeto es UN destinatario:

```json
[
  { "cedula": "1030567890", "correo": "ana@correo.com", "nombre": "Ana", "ciudad": "Bogotá" },
  { "cedula": "79345123",   "correo": "luis@correo.com", "nombre": "Luis", "ciudad": "Cali" }
]
```

**(b) Objeto envoltorio** — la lista viene bajo una de estas llaves (la primera que
sea un array): `data`, `rows`, `records`, `items`, `destinatarios`, `registros`:

```json
{ "data": [ { "cedula": "...", "correo": "...", "nombre": "..." }, … ] }
```

Cualquier otra forma se rechaza con un error claro en el diálogo:
- No parsea → *"El archivo no es un JSON válido."*
- No es array (ni envoltorio con array) o está vacío → *"El JSON debe ser un array de
  objetos (o traer la lista en "data"/"rows"/"records"/"items")."*
- Un elemento no es objeto (p. ej. un array o un escalar suelto) → *"Cada registro del
  JSON debe ser un objeto { campo: valor }."*

### 3.2 Cómo se derivan las columnas

- **Columnas = unión de las llaves** de todos los objetos, en orden de aparición (si un
  registro trae una llave que otros no tienen, la columna existe para todos y queda
  vacía donde falte).
- **Reordenamiento automático de las obligatorias:** se buscan por los **sinónimos** de
  §1.1 (misma normalización) y se mueven a las posiciones 1–2–3 que exige el backend
  (`Identificación`, contacto según el canal elegido, `Nombre`). El resto de columnas
  conserva su orden. Es la ventaja del JSON sobre el CSV: **el orden de las llaves no
  importa**, el sistema las acomoda.
- Si alguna obligatoria **no se encuentra** por sinónimos, no se inventa: la validación
  de estructura (§2.2, la misma) la marcará ✗ y habrá que renombrar el campo en el
  archivo.

### 3.3 Valores: escalares y ANIDADOS

| Valor en el JSON | Cómo queda en la celda del CSV generado |
|---|---|
| `string` | Tal cual |
| `number` | Texto sin notación científica (enteros completos) |
| `boolean` | `true` / `false` |
| `null` / ausente | Celda vacía |
| **`array` u `object`** | **JSON serializado DENTRO de la celda** (ver §4) |

### 3.4 Conversión y subida

El JSON se convierte a CSV **en el navegador** (`jsonToRows` + `rowsToCsv`, delimitador
`;`) y a S3 sube **ese CSV** con el nombre `archivo.csv`. El backend no cambió: todo el
pipeline (Prepare-batch, combinadores, reportes) sigue leyendo CSV. Después de la
conversión aplican las MISMAS validaciones del §2.2.

### 3.5 Ejemplo completo (extracto con movimientos, canal EMAIL)

```json
[
  {
    "cedula": "1030567890",
    "correo": "ana@correo.com",
    "nombre": "Ana Pérez",
    "saldo": 2450000,
    "movimientos": [
      { "Fecha": "2026-07-01", "Detalle": "Compra supermercado", "Valor": "-185.000" },
      { "Fecha": "2026-07-03", "Detalle": "Abono nómina",        "Valor": "+3.200.000" },
      { "Fecha": "2026-07-10", "Detalle": "Pago tarjeta",        "Valor": "-950.000" }
    ]
  }
]
```

Genera este CSV (las obligatorias reordenadas; el array queda como JSON en la celda,
entre comillas porque contiene `,` y `"`):

```csv
cedula;correo;nombre;saldo;movimientos
1030567890;ana@correo.com;Ana Pérez;2450000;"[{""Fecha"": ""2026-07-01"", ""Detalle"": ""Compra supermercado"", ""Valor"": ""-185.000""}, …]"
```

---

## 4. Celdas con array (sub-registros) → tablas con repetición

Así se logra el equivalente al "archivo multiregistro": los registros hijos van en una
**columna con nombre** dentro de la fila del destinatario.

1. **En la base:** la columna (p. ej. `movimientos`) trae un array JSON de objetos.
   En un `.json` sale natural (§3.3); en un CSV hecho a mano hay que escribir el JSON
   en la celda respetando las comillas del §2.1.
2. **En la plantilla del Estudio PDF:** la tabla se vincula con `repeatBy =
   movimientos` (panel de Datos). **Las llaves de cada ítem deben llamarse IGUAL que
   los encabezados de las columnas de la tabla** (en el ejemplo: columnas `Fecha`,
   `Detalle`, `Valor`). La comparación es exacta (o minúsculas como último recurso).
3. **En el envío real (EAP-PDF):** el combinador parsea la celda (`_coerce_json_cell`:
   toda celda que empiece por `[` o `{` se intenta parsear; si no parsea, queda como
   texto literal) → la variable llega como LISTA al motor → la tabla pinta **una fila
   por ítem, por destinatario**. Si las filas no caben en el alto de la tabla, el PDF
   **pagina a hojas nuevas** (encabezado de tabla repetido; los demás elementos como
   membrete).
4. **En la vista previa del Estudio:** mismo comportamiento con la primera fila de
   muestra de la base (`coerceSampleCell`).
5. **En el camino HTML** (editor básico xhtml2pdf): una variable-lista se sustituye
   como texto JSON (no hay tabla con repetición en ese nivel).

**Límites prácticos:**
- El JSON de la celda debe ser **array de objetos planos** para alimentar la tabla
  (objetos anidados dentro del ítem no se despliegan en columnas).
- La **vista previa persistente** de la base guarda las celdas JSON hasta **4.000
  caracteres** (las normales a 500). Un array más largo se trunca SOLO en esa vista
  previa (el envío real siempre lee el CSV completo de S3).
- Un solo nivel de anidamiento útil: destinatario → lista de ítems. No hay listas
  dentro de listas.

---

## 5. Qué pasa con las columnas después de la carga

- `Database/Register-file` guarda `columns` (los encabezados) y `previewRows` (máx. 5
  filas × 40 columnas; celdas a 500 chars, JSON a 4.000, presupuesto total ~100 KB).
  De ahí salen el "ver detalle", el selector de variables (`DatabaseFieldPicker`) y el
  panel de Datos del Estudio.
- **Variables por canal:**
  - **Email (EM/EAU/EAP):** `{{Columna}}` en plantillas SES/HTML/DOCX/PDF (cualquier
    columna del encabezado).
  - **SMS / Voz:** `{{Columna}}` dentro del texto del mensaje.
  - **WhatsApp:** los parámetros `{{1}}, {{2}}, …` de la plantilla HSM se llenan **por
    posición** con las columnas desde Nombre en adelante (`{{1}}` = columna 3,
    `{{2}}` = columna 4, …).
  - **EAP (DOCX/PDF):** la combinación reemplaza `{{Columna}}`/`data-var` con la fila
    de CADA destinatario; tolera diferencias de BOM/espacios/mayúsculas entre el
    encabezado del CSV y el binding del editor (alias saneados).

---

## 6. Preguntas frecuentes

**¿Puedo mezclar filas de distintos "tipos" (encabezado/detalle) en el mismo CSV?**
No. Ese layout multiregistro no existe: cada fila debe ser un destinatario completo.
Los detalles van como array JSON en una celda de la fila de su destinatario (§4). Si
la fuente de datos exporta multiregistro clásico, hay que transformarla a este modelo
(el `.json` con arrays anidados es el camino directo).

**¿El orden de las columnas importa?**
En CSV, sí para las 3 obligatorias (posiciones 1–2–3); el resto es libre. En JSON no:
el sistema reordena las obligatorias por sinónimos.

**¿Qué pasa si un contacto es inválido?**
En la carga solo se informa (contadores). En el envío real no se encola y queda con
estado 11 (email/celular inválido) en el reporte.

**¿Los duplicados se envían?**
Por defecto no (se deduplica por contacto normalizado y el cobro va sobre contactos
distintos). Con la casilla "Permitir duplicados" al cargar la base, se envía el total.
