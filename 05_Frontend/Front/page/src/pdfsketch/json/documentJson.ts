import type { DocumentModel } from '@/types/document';

/**
 * Serialización JSON del documento pdfsketch — el formato ESTÁNDAR con el que
 * el editor habla con el backend de MailConnect (reemplaza al XML del prototipo
 * original).
 *
 * Envelope versionado: `{ schema: 'pdfsketch@1', document: DocumentModel }`.
 * El backend (`Api_V1_Template_Render-engine/sketch_translator.py`) acepta el
 * envelope o el DocumentModel directo; el editor SIEMPRE exporta con envelope
 * para poder versionar el esquema a futuro.
 */
export const SKETCH_SCHEMA = 'pdfsketch@1';

export interface SketchEnvelope {
  schema: string;
  document: DocumentModel;
}

/** DocumentModel → envelope JSON (objeto, para enviar al backend). */
export function toEnvelope(doc: DocumentModel): SketchEnvelope {
  return { schema: SKETCH_SCHEMA, document: doc };
}

/** DocumentModel → string JSON legible (para exportar/descargar). */
export function serializeToJson(doc: DocumentModel): string {
  return JSON.stringify(toEnvelope(doc), null, 2);
}

/**
 * string JSON → DocumentModel. Acepta el envelope `pdfsketch@1` o un
 * DocumentModel "pelado" (con `pages`). Lanza Error con mensaje claro si el
 * contenido no es un documento válido.
 */
export function deserializeFromJson(text: string): DocumentModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es JSON válido.');
  }
  const obj = parsed as Record<string, unknown>;
  const doc = (obj && typeof obj === 'object' && 'document' in obj
    ? (obj as { document: unknown }).document
    : parsed) as Record<string, unknown>;

  if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { pages?: unknown }).pages)) {
    throw new Error('El JSON no es un documento pdfsketch (falta "pages").');
  }
  return doc as unknown as DocumentModel;
}
