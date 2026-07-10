/**
 * Parser y análisis de CSV del lado del cliente (sin dependencias) para la sección
 * "Bases de datos". Permite previsualizar y validar la lista de destinatarios antes
 * de subirla a S3 (el proyecto usa ';' como delimitador por defecto).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Celular en formato E.164 (recomendado para SMS/WhatsApp/Voz): +<indicativo><número>.
// Se aceptan 8 a 15 dígitos tras el '+'. Ej.: +573001234567.
const PHONE_E164_RE = /^\+?[1-9]\d{7,14}$/;

/** ¿Es un celular válido (E.164)? Para campañas SMS/WhatsApp/Voz la columna 2 es el celular. */
export const isValidPhone = (raw: string): boolean =>
  PHONE_E164_RE.test((raw || '').replace(/[\s()-]/g, ''));

export type Delimiter = ';' | ',' | '\t' | '|';

/**
 * Columnas OBLIGATORIAS y su ORDEN. El backend (Prepare-batch) lee por posición:
 * line[0] = Identificación (numérica), line[1] = Correo, line[2] = Nombre.
 * Por eso el orden importa; después pueden ir columnas opcionales.
 */
export const REQUIRED_COLUMNS = [
  { label: 'Identificación', hint: 'número de documento', numeric: true, synonyms: ['identificacion', 'cedula', 'documento', 'id', 'nit', 'nrodocumento'] },
  { label: 'Correo', hint: 'correo electrónico', numeric: false, synonyms: ['correo', 'email', 'emails', 'mail', 'correoelectronico'] },
  { label: 'Nombre', hint: 'nombre del destinatario', numeric: false, synonyms: ['nombre', 'nombres', 'name'] },
] as const;

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
  headers: string[];
  totalRows: number; // filas de datos (sin encabezado)
  emailColumnIndex: number; // -1 si no se detecta
  validEmails: number;
  invalidEmails: number;
  duplicateEmails: number;
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

/** Heurística: elige la columna de email por nombre de encabezado o por contenido. */
function findEmailColumn(headers: string[], dataRows: string[][]): number {
  const byName = headers.findIndex((h) => /correo|email|e-mail|mail/i.test(h));
  if (byName >= 0) return byName;
  // Por contenido: la columna con más celdas que parecen email en una muestra.
  const sample = dataRows.slice(0, 50);
  let bestCol = -1;
  let bestHits = 0;
  const cols = headers.length;
  for (let c = 0; c < cols; c++) {
    let hits = 0;
    for (const r of sample) if (r[c] && EMAIL_RE.test(r[c].trim())) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = c;
    }
  }
  return bestHits > 0 ? bestCol : -1;
}

/** Analiza el texto CSV completo y devuelve un resumen para la UI. */
export function analyzeCsv(text: string, forcedDelimiter?: Delimiter): CsvAnalysis {
  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  const all = parseCsv(text, delimiter);
  const headers = all[0] ?? [];
  const dataRows = all.slice(1);

  // Validación de estructura obligatoria por POSICIÓN (así lo lee el backend).
  const structure: ColumnCheck[] = REQUIRED_COLUMNS.map((col, i) => {
    const actualHeader = headers[i] ?? '';
    const ok = (col.synonyms as readonly string[]).includes(normHeader(actualHeader));
    return { label: col.label, hint: col.hint, position: i + 1, actualHeader, ok };
  });
  const structureOk = structure.every((c) => c.ok);

  // Correo = posición 2 si la estructura es correcta; si no, se intenta detectar.
  const emailColumnIndex = structure[1]?.ok ? 1 : findEmailColumn(headers, dataRows);

  let validEmails = 0;
  let invalidEmails = 0;
  let duplicateEmails = 0;
  if (emailColumnIndex >= 0) {
    const seen = new Set<string>();
    for (const r of dataRows) {
      const raw = (r[emailColumnIndex] ?? '').trim().toLowerCase();
      if (!raw) {
        invalidEmails++;
        continue;
      }
      if (EMAIL_RE.test(raw)) {
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
    headers,
    totalRows: dataRows.length,
    emailColumnIndex,
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
