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

/** Lee la PRIMERA hoja de un Excel y devuelve las filas como string[][]. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  // La lib devuelve filas de celdas tipadas (string/number/Date/boolean/null) para la 1ª hoja.
  const rows = (await readXlsxFile(file)) as unknown as unknown[][];
  return rows.map((r) => (Array.isArray(r) ? r.map(cellToString) : []));
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
