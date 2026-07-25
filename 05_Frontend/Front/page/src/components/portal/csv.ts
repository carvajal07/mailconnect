/**
 * Parser y análisis de CSV del lado del cliente para la sección "Bases de datos".
 * Permite previsualizar y validar la lista de destinatarios antes de subirla a S3
 * (el proyecto usa ';' como delimitador por defecto).
 */
import { isValidPhoneNumber } from 'libphonenumber-js';
import readXlsxFile from 'read-excel-file/browser';

// País por defecto para números sin indicativo (Colombia). Un número con '+xx' se valida
// contra SU país; uno sin '+' se interpreta como colombiano.
const DEFAULT_COUNTRY = 'CO' as const;

// Correo: validación práctica y estricta (RFC-ish). Local part 1–64 sin puntos al inicio/fin,
// dominio con etiquetas válidas y TLD alfabético de 2+. Se rechazan puntos consecutivos.
const EMAIL_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

/**
 * ¿Es un celular válido? Usa libphonenumber-js (valida el patrón REAL del país, no solo la
 * longitud). Acepta E.164 (`+57…`, `+1…`) o formato local colombiano (`3001234567`). Rechaza
 * números con longitud/estructura imposible (p. ej. `567658787878675`).
 */
export const isValidPhone = (raw: string): boolean => {
  const v = (raw || '').trim();
  if (!v) return false;
  try {
    return isValidPhoneNumber(v, DEFAULT_COUNTRY);
  } catch {
    return false;
  }
};

/** ¿Es un correo con formato válido? (misma regla que usa el análisis de bases). */
export const isValidEmail = (raw: string): boolean => {
  const v = (raw || '').trim();
  if (!v || v.length > 254 || v.includes('..')) return false;
  const at = v.indexOf('@');
  if (at < 1 || at > 64) return false; // local part 1–64 chars
  return EMAIL_RE.test(v);
};

/**
 * Valida un contacto de lista negra: si contiene '@' se valida como correo, si no,
 * como celular E.164. Devuelve si es válido y una etiqueta del tipo detectado.
 */
export const validateContact = (raw: string): { valid: boolean; type: 'email' | 'phone' } => {
  const v = (raw || '').trim();
  const type: 'email' | 'phone' = v.includes('@') ? 'email' : 'phone';
  return { valid: type === 'email' ? isValidEmail(v) : isValidPhone(v), type };
};

export type Delimiter = ';' | ',' | '\t' | '|';

/**
 * Tipo de contacto de la columna 2 según el CANAL de la campaña:
 *  - EMAIL → correo electrónico.
 *  - SMS / WHATSAPP / VOICE → celular (E.164).
 */
export type ContactType = 'email' | 'phone';

/** Canal de la campaña → tipo de contacto que se valida en la columna 2. */
export const channelContactType = (channel: string): ContactType =>
  channel === 'EMAIL' || channel === 'EM' || channel === 'EAU' || channel === 'EAP' ? 'email' : 'phone';

interface ColumnSpec {
  label: string;
  hint: string;
  numeric: boolean;
  synonyms: readonly string[];
}

const COL_ID: ColumnSpec = { label: 'Identificación', hint: 'número de documento', numeric: true, synonyms: ['identificacion', 'cedula', 'documento', 'id', 'nit', 'nrodocumento'] };
const COL_EMAIL: ColumnSpec = { label: 'Correo', hint: 'correo electrónico', numeric: false, synonyms: ['correo', 'email', 'emails', 'mail', 'correoelectronico'] };
const COL_PHONE: ColumnSpec = { label: 'Celular', hint: 'celular E.164 (+57…)', numeric: false, synonyms: ['celular', 'telefono', 'movil', 'phone', 'cel', 'tel', 'numero', 'whatsapp', 'msisdn'] };
const COL_NAME: ColumnSpec = { label: 'Nombre', hint: 'nombre del destinatario', numeric: false, synonyms: ['nombre', 'nombres', 'name'] };

/**
 * Columnas OBLIGATORIAS y su ORDEN según el tipo de contacto. El backend
 * (Prepare-batch) lee por posición: line[0] = Identificación, line[1] = contacto
 * (correo o celular), line[2] = Nombre.
 */
export const requiredColumns = (contact: ContactType): ColumnSpec[] =>
  [COL_ID, contact === 'phone' ? COL_PHONE : COL_EMAIL, COL_NAME];

/** Compat: columnas para email (canal por defecto). */
export const REQUIRED_COLUMNS = requiredColumns('email');

/** Normaliza un encabezado: minúsculas, sin acentos ni signos. */
export const normHeader = (s: string) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ColumnCheck {
  label: string; // nombre esperado (Identificación, Correo, Nombre)
  hint: string;
  position: number; // 1-based
  actualHeader: string; // lo que trae el archivo en esa posición
  ok: boolean; // el encabezado en esa posición coincide con el esperado
}

export interface CsvAnalysis {
  delimiter: Delimiter;
  contactType: ContactType; // qué se validó en la columna 2 (email o celular)
  headers: string[];
  totalRows: number; // filas de datos (sin encabezado)
  emailColumnIndex: number; // índice de la columna de contacto; -1 si no se detecta
  validEmails: number; // contactos válidos (correos o celulares)
  invalidEmails: number; // contactos inválidos
  duplicateEmails: number; // contactos duplicados
  structure: ColumnCheck[]; // estado de las 3 columnas obligatorias (por posición)
  structureOk: boolean; // las 3 obligatorias están en el orden correcto
  sample: string[][]; // primeras filas para la vista previa
}

/** Detecta el delimitador más probable mirando la primera línea. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates: Delimiter[] = [';', ',', '\t', '|'];
  let best: Delimiter = ';';
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Parser CSV con soporte de comillas ("campo con ; o comillas ""dobles""" ). */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // quita BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += c;
    }
  }
  // Última celda/fila si el archivo no termina en salto de línea.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Descartar filas totalmente vacías.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Heurística: elige la columna de contacto por nombre de encabezado o por contenido. */
function findContactColumn(headers: string[], dataRows: string[][], contact: ContactType): number {
  const nameRe = contact === 'phone' ? /celular|telefono|movil|phone|cel|whatsapp/i : /correo|email|e-mail|mail/i;
  const isValid = contact === 'phone' ? isValidPhone : (v: string) => EMAIL_RE.test(v);
  const byName = headers.findIndex((h) => nameRe.test(h));
  if (byName >= 0) return byName;
  // Por contenido: la columna con más celdas que parecen del tipo esperado.
  const sample = dataRows.slice(0, 50);
  let bestCol = -1;
  let bestHits = 0;
  for (let c = 0; c < headers.length; c++) {
    let hits = 0;
    for (const r of sample) if (r[c] && isValid(r[c].trim())) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = c;
    }
  }
  return bestHits > 0 ? bestCol : -1;
}

/**
 * Analiza el texto CSV completo y devuelve un resumen para la UI. `contact` define
 * qué se valida en la columna 2: 'email' (canal EMAIL) o 'phone' (SMS/WhatsApp/Voz).
 */
export function analyzeCsv(text: string, forcedDelimiter?: Delimiter, contact: ContactType = 'email'): CsvAnalysis {
  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  const all = parseCsv(text, delimiter);
  const headers = all[0] ?? [];
  const dataRows = all.slice(1);

  // Validación de estructura obligatoria por POSICIÓN (así lo lee el backend).
  const cols = requiredColumns(contact);
  const structure: ColumnCheck[] = cols.map((col, i) => {
    const actualHeader = headers[i] ?? '';
    const ok = col.synonyms.includes(normHeader(actualHeader));
    return { label: col.label, hint: col.hint, position: i + 1, actualHeader, ok };
  });
  const structureOk = structure.every((c) => c.ok);

  // Columna de contacto = posición 2 si la estructura es correcta; si no, se detecta.
  const contactColumnIndex = structure[1]?.ok ? 1 : findContactColumn(headers, dataRows, contact);
  const isValidContact = contact === 'phone' ? isValidPhone : (v: string) => EMAIL_RE.test(v);
  const norm = (v: string) => (contact === 'phone' ? v.replace(/[\s()-]/g, '') : v.toLowerCase());

  let validEmails = 0;
  let invalidEmails = 0;
  let duplicateEmails = 0;
  if (contactColumnIndex >= 0) {
    const seen = new Set<string>();
    for (const r of dataRows) {
      const raw = norm((r[contactColumnIndex] ?? '').trim());
      if (!raw) {
        invalidEmails++;
        continue;
      }
      if (isValidContact(raw)) {
        if (seen.has(raw)) duplicateEmails++;
        else {
          seen.add(raw);
          validEmails++;
        }
      } else {
        invalidEmails++;
      }
    }
  }

  return {
    delimiter,
    contactType: contact,
    headers,
    totalRows: dataRows.length,
    emailColumnIndex: contactColumnIndex,
    validEmails,
    invalidEmails,
    duplicateEmails,
    structure,
    structureOk,
    sample: dataRows.slice(0, 8),
  };
}

export const DELIMITER_LABELS: Record<Delimiter, string> = {
  ';': 'Punto y coma ( ; )',
  ',': 'Coma ( , )',
  '\t': 'Tabulación',
  '|': 'Barra ( | )',
};

// ─────────────────────────── Soporte de Excel (.xlsx) ───────────────────────────
// El Excel se convierte a CSV EN EL NAVEGADOR y se sube a S3 como CSV, así el backend
// (Prepare-batch lee CSV con csv.reader) y el registro de la base quedan intactos: el
// .xlsx es solo una comodidad de entrada, no un formato nuevo que el backend deba entender.

/** ¿El archivo es una hoja de cálculo (Excel), por extensión o tipo MIME? */
export const isSpreadsheetFile = (file: File): boolean =>
  /\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name) || /spreadsheet|ms-excel/i.test(file.type);

/** Convierte una celda de Excel a texto. OJO: Excel guarda números/fechas tipados; las
 *  identificaciones y celulares conviene tenerlos como TEXTO en Excel para no perder ceros
 *  a la izquierda ni el '+' (si no, la validación de la vista previa lo marca inválido). */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso; // fecha sola → YYYY-MM-DD
  }
  if (typeof v === 'number') {
    // Enteros sin notación científica (ids/celulares); decimales tal cual.
    return Number.isInteger(v) ? v.toLocaleString('en-US', { useGrouping: false }) : String(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Lee la PRIMERA hoja de un Excel y devuelve las filas como string[][].
 *
 *  ⚠️ `read-excel-file` (v9.x) por defecto devuelve un ARRAY DE HOJAS
 *  `[{ sheet, data: [[...]] }]`, NO un array plano de filas. (Versiones/paths antiguos
 *  devolvían filas planas `[[...], [...]]`.) Antes esto rompía la carga de Excel: el
 *  `.map` trataba cada objeto-hoja como fila → filas vacías → "faltan las columnas
 *  obligatorias". Aquí se soportan AMBAS formas y se toma la 1ª hoja. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const result = (await readXlsxFile(file)) as unknown;
  let rawRows: unknown[] = [];
  if (Array.isArray(result)) {
    const first = result[0];
    if (first && !Array.isArray(first) && typeof first === 'object' && 'data' in (first as object)) {
      // Forma [{ sheet, data }]: se usa la data de la PRIMERA hoja.
      rawRows = ((first as { data?: unknown[] }).data) ?? [];
    } else {
      // Forma plana [[...], [...]].
      rawRows = result;
    }
  }
  return rawRows.map((r) => (Array.isArray(r) ? r.map(cellToString) : []));
}

// ─────────────────────────── Soporte de JSON (.json) ───────────────────────────
// Igual que el Excel: el JSON se convierte a CSV EN EL NAVEGADOR y se sube a S3 como
// CSV (el backend no cambia). Formatos aceptados: un ARRAY de objetos `[{...}, ...]`
// (cada objeto = un destinatario) o un objeto envoltorio `{ data|rows|records|items:
// [{...}] }`. Los valores ANIDADOS (arrays u objetos — p. ej. la lista de movimientos
// de un extracto) se guardan como JSON DENTRO de la celda; el motor de PDF del Estudio
// los parsea para alimentar tablas con `repeatBy` (una fila por ítem, y si desbordan
// el alto de la tabla el PDF pagina a una hoja nueva).

/** ¿El archivo es JSON, por extensión o tipo MIME? */
export const isJsonFile = (file: File): boolean =>
  /\.json$/i.test(file.name) || /\bjson\b/i.test(file.type);

const WRAPPER_KEYS = ['data', 'rows', 'records', 'items', 'destinatarios', 'registros'] as const;

/** Un valor de celda del JSON → texto para el CSV. Escalares como texto plano;
 *  arrays/objetos como JSON embebido (los parsea el motor / la vista previa). */
function jsonCellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) return JSON.stringify(v);
  return cellToString(v);
}

/**
 * Convierte el texto de un archivo .json en filas CSV (encabezado + datos).
 * Reordena las columnas OBLIGATORIAS a las posiciones que lee el backend
 * (1 Identificación · 2 contacto · 3 Nombre) buscándolas por sinónimos; el resto
 * de campos conserva su orden de aparición. Lanza Error (mensaje en español) si
 * el JSON no es un array de objetos.
 */
export function jsonToRows(text: string, contact: ContactType = 'email'): string[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }

  let records: unknown[] | null = Array.isArray(parsed) ? parsed : null;
  if (!records && parsed && typeof parsed === 'object') {
    for (const key of WRAPPER_KEYS) {
      const v = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(v)) { records = v; break; }
    }
  }
  if (!records || records.length === 0) {
    throw new Error('El JSON debe ser un array de objetos (o traer la lista en "data"/"rows"/"records"/"items").');
  }
  if (!records.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    throw new Error('Cada registro del JSON debe ser un objeto { campo: valor }.');
  }

  // Columnas = unión de llaves en orden de aparición.
  const keys: string[] = [];
  for (const rec of records as Record<string, unknown>[]) {
    for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  }

  // Obligatorias primero, en el ORDEN posicional del backend (por sinónimos).
  const ordered: string[] = [];
  for (const col of requiredColumns(contact)) {
    const hit = keys.find((k) => !ordered.includes(k) && col.synonyms.includes(normHeader(k)));
    if (hit) ordered.push(hit);
  }
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);

  const rows = (records as Record<string, unknown>[]).map((rec) =>
    ordered.map((k) => jsonCellToString(rec[k])));
  return [ordered, ...rows];
}

// ──────────────── Soporte de CSV MULTIREGISTRO (sin encabezado) ────────────────
// Layout clásico "multiregistro": el archivo NO trae fila de encabezado y una
// COLUMNA (por defecto la 1) de cada línea es la ETIQUETA del TIPO de registro. El
// tipo de la PRIMERA línea es el tipo PRINCIPAL (el destinatario); cada línea
// principal abre un registro y las líneas siguientes de otros tipos (ingresos,
// egresos, detalles, …) son sus SUB-REGISTROS, hasta la próxima línea principal:
//
//   principal;1030567890;ana@correo.com;Ana Pérez
//   ingresos;20.000;sueldo
//   egresos;10.000;arriendo
//   principal;79345123;luis@correo.com;Luis Gómez
//   ingresos;30.000;sueldo
//
// Se convierte EN EL NAVEGADOR al modelo interno (el backend no cambia): una fila
// por destinatario, con los campos de la línea principal como columnas y UNA
// columna por cada tipo hijo cuyo valor es el ARRAY JSON de sus líneas — la misma
// mecánica de las bases .json, que alimenta las tablas `repeatBy` del Estudio PDF.
//
// CONTRATO de la línea principal: `tipo;identificación;contacto;nombre;extras…`
// (los 3 obligatorios en ese orden después de la etiqueta, porque el backend lee
// por posición). Como el archivo no trae nombres de columna, el ASISTENTE de carga
// (MultiRecordWizard) los mapea: alias amigable por canal + un nombre por columna.

/** Líneas de muestra que lee el asistente para detectar tipos y volúmenes. */
export const MULTIRECORD_SAMPLE_LINES = 20;

export interface MultiRecordType {
  /** Etiqueta del tipo de registro (valor de la columna identificadora), tal cual. */
  tag: string;
  /** Nombre amigable del canal. Para los tipos HIJO es además el NOMBRE de la columna
   *  del array en el CSV generado (lo que se vincula con `repeatBy` en la plantilla). */
  alias: string;
  /** ¿Es el tipo principal (el de la primera línea = el destinatario)? */
  isMaster: boolean;
  /** Líneas de este tipo en TODO el archivo. */
  count: number;
  /** Líneas de este tipo en la MUESTRA (primeras MULTIRECORD_SAMPLE_LINES). */
  sampleCount: number;
  /** Máximo de campos de datos (columnas sin contar la etiqueta). */
  maxFields: number;
  /** Nombre asignado a cada columna física de datos (editable en el asistente). */
  fieldNames: string[];
}

/** Mapa de salida indexado por POSICIÓN FÍSICA de columna (1-based), listo para el
 *  backend / trazabilidad. `tagColumn` es la columna identificadora; cada canal
 *  lista sus columnas de datos por su posición física en la línea original. */
export interface MultiRecordColumnMap {
  tagColumn: number; // 1-based
  channels: Record<string, {
    alias: string;
    isMaster: boolean;
    columns: Record<number, string>; // posición física 1-based → nombre de campo
  }>;
}

/** Campos de datos de una línea = todas las columnas MENOS la identificadora. */
const dataFieldsOf = (r: string[], tagCol: number): string[] =>
  r.filter((_, i) => i !== tagCol);

/** Posiciones físicas (0-based) de las columnas de datos, excluyendo `tagCol`. */
function dataFieldPositions(maxFields: number, tagCol: number): number[] {
  const positions: number[] = [];
  let p = 0;
  while (positions.length < maxFields) {
    if (p !== tagCol) positions.push(p);
    p++;
  }
  return positions;
}

/** Sugerencia de nombre para la columna `i` de un canal (placeholder del asistente). */
export function suggestFieldName(isMaster: boolean, i: number, contact: ContactType): string {
  if (isMaster) {
    if (i === 0) return 'Identificacion';
    if (i === 1) return contact === 'phone' ? 'Celular' : 'Correo';
    if (i === 2) return 'Nombre';
  }
  return `Campo ${i + 1}`;
}

/** Alias por defecto del canal (el principal se rotula; los hijos toman su etiqueta). */
const defaultChannelAlias = (isMaster: boolean, tag: string): string =>
  isMaster ? 'Datos del destinatario' : tag;

function defaultFieldNames(isMaster: boolean, n: number, contact: ContactType): string[] {
  return Array.from({ length: n }, (_, i) => suggestFieldName(isMaster, i, contact));
}

/**
 * ¿El CSV parece MULTIREGISTRO? En un CSV normal la primera línea es un encabezado
 * ÚNICO; si el valor de la columna identificadora (`tagCol`, 0-based) se repite en
 * otras líneas, esa columna es una etiqueta de tipo de registro (no un nombre de
 * campo). La detección mira solo la MUESTRA (primeras N líneas), como el asistente.
 */
export function detectMultiRecord(text: string, forcedDelimiter?: Delimiter, tagCol = 0): boolean {
  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  const rows = parseCsv(text, delimiter).slice(0, MULTIRECORD_SAMPLE_LINES);
  if (rows.length < 2) return false;
  const first = (rows[0][tagCol] ?? '').trim();
  if (!first) return false;
  return rows.slice(1).some((r) => (r[tagCol] ?? '').trim() === first);
}

/** Cantidad de columnas de la línea más ancha (para el selector de posición del tag). */
export function maxColumns(text: string, forcedDelimiter?: Delimiter): number {
  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  const rows = parseCsv(text, delimiter).slice(0, MULTIRECORD_SAMPLE_LINES);
  return rows.reduce((m, r) => Math.max(m, r.length), 0);
}

/**
 * Inventario de los tipos de registro del archivo (en orden de aparición), con alias
 * y nombres de columna POR DEFECTO según el canal. El tipo de la primera línea es el
 * principal. `tagCol` (0-based) indica qué columna trae la etiqueta del tipo.
 * Lanza Error (mensaje en español) si el archivo no sirve.
 */
export function analyzeMultiRecordTypes(
  text: string,
  forcedDelimiter: Delimiter | undefined,
  contact: ContactType,
  tagCol = 0,
): { delimiter: Delimiter; types: MultiRecordType[] } {
  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  const masterTag = (rows[0]?.[tagCol] ?? '').trim();
  if (!masterTag) throw new Error('La primera línea no trae la etiqueta del tipo de registro en esa columna.');

  const order: string[] = [];
  const info = new Map<string, { count: number; sampleCount: number; maxFields: number }>();
  rows.forEach((r, idx) => {
    const tag = (r[tagCol] ?? '').trim();
    if (!tag) return;
    if (!info.has(tag)) {
      info.set(tag, { count: 0, sampleCount: 0, maxFields: 0 });
      order.push(tag);
    }
    const e = info.get(tag)!;
    e.count++;
    if (idx < MULTIRECORD_SAMPLE_LINES) e.sampleCount++;
    e.maxFields = Math.max(e.maxFields, dataFieldsOf(r, tagCol).length);
  });

  const types = order.map((tag) => {
    const e = info.get(tag)!;
    const isMaster = tag === masterTag;
    return {
      tag, isMaster, count: e.count, sampleCount: e.sampleCount, maxFields: e.maxFields,
      alias: defaultChannelAlias(isMaster, tag),
      fieldNames: defaultFieldNames(isMaster, e.maxFields, contact),
    };
  });
  return { delimiter, types };
}

/** Nombre efectivo de un campo (los vacíos caen a "Campo N", para no perder datos). */
const fieldName = (names: string[], i: number): string =>
  (names[i] ?? '').trim() || `Campo ${i + 1}`;

/** Nombre efectivo de la columna del array de un tipo hijo (alias o su etiqueta). */
const childColumnName = (t: MultiRecordType): string => (t.alias || '').trim() || t.tag;

/**
 * Convierte el texto MULTIREGISTRO en filas del modelo interno (encabezado + una
 * fila por destinatario). Los campos de la línea principal quedan como columnas
 * (con sus `fieldNames`); cada tipo hijo queda como UNA columna (con su `alias`)
 * cuyo valor es el array JSON de sus líneas (objetos con los `fieldNames` del tipo).
 * Las líneas de tipo desconocido o anteriores a la primera línea principal se ignoran.
 */
export function multiRecordToRows(
  text: string,
  delimiter: Delimiter,
  types: MultiRecordType[],
  tagCol = 0,
): string[][] {
  const master = types.find((t) => t.isMaster);
  if (!master) throw new Error('No se detectó el tipo de registro principal (el de la primera línea).');
  const childTypes = types.filter((t) => !t.isMaster);
  const byTag = new Map(types.map((t) => [t.tag, t]));

  const nMaster = Math.max(master.maxFields, master.fieldNames.length);
  const header = [
    ...Array.from({ length: nMaster }, (_, i) => fieldName(master.fieldNames, i)),
    ...childTypes.map(childColumnName),
  ];

  const out: string[][] = [header];
  let current: { fields: string[]; children: Map<string, Record<string, string>[]> } | null = null;

  const flush = () => {
    if (!current) return;
    const row = Array.from({ length: nMaster }, (_, i) => current!.fields[i] ?? '');
    for (const ct of childTypes) {
      const items = current!.children.get(ct.tag) ?? [];
      row.push(items.length ? JSON.stringify(items) : '');
    }
    out.push(row);
  };

  const rows = parseCsv(text, delimiter);
  for (const r of rows) {
    const tag = (r[tagCol] ?? '').trim();
    if (!tag) continue;
    const data = dataFieldsOf(r, tagCol).map((c) => String(c));
    if (tag === master.tag) {
      flush();
      current = { fields: data, children: new Map() };
      continue;
    }
    const t = byTag.get(tag);
    if (!current || !t || t.isMaster) continue;
    const item: Record<string, string> = {};
    for (let i = 0; i < Math.max(t.maxFields, t.fieldNames.length); i++) {
      item[fieldName(t.fieldNames, i)] = data[i] ?? '';
    }
    if (!current.children.has(tag)) current.children.set(tag, []);
    current.children.get(tag)!.push(item);
  }
  flush();
  return out;
}

/**
 * Mapa de salida indexado por POSICIÓN FÍSICA de columna (1-based) — la estructura
 * canónica de la configuración, para trazabilidad o para enviarla al backend. Deriva
 * de los mismos `types` que alimentan `multiRecordToRows`.
 */
export function buildMultiRecordMap(types: MultiRecordType[], tagCol = 0): MultiRecordColumnMap {
  const channels: MultiRecordColumnMap['channels'] = {};
  for (const t of types) {
    const positions = dataFieldPositions(Math.max(t.maxFields, t.fieldNames.length), tagCol);
    const columns: Record<number, string> = {};
    positions.forEach((physical, i) => { columns[physical + 1] = fieldName(t.fieldNames, i); });
    channels[t.tag] = { alias: t.isMaster ? t.alias : childColumnName(t), isMaster: t.isMaster, columns };
  }
  return { tagColumn: tagCol + 1, channels };
}

/** Serializa filas a texto CSV (comillas donde el valor contenga el delimitador, comillas o
 *  saltos de línea) — mismo criterio que parseCsv, para poder re-analizarlo y subirlo. */
export function rowsToCsv(rows: string[][], delimiter: Delimiter = ';'): string {
  const esc = (cell: string) => {
    const s = cell ?? '';
    return s.includes(delimiter) || s.includes('"') || /[\r\n]/.test(s)
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  return rows.map((r) => r.map(esc).join(delimiter)).join('\n');
}
