import type {
  DocumentModel, ElementModel, Page, Unit, ColorToken, Font, TextStyle,
  ParagraphStyle, BorderStyle, LineStyle, FillStyle, ImageAsset, TableDef,
  RowSet, CellDef, Flow, DynamicComm,
} from '@/types/document';
import { nextId } from '@/utils/id';

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
 * contenido no es un documento válido. El resultado se NORMALIZA para tolerar
 * JSON escrito a mano / de otra herramienta (rellena campos estructurales que
 * falten y genera ids), así una plantilla externa importa sin romper el editor.
 */
export function deserializeFromJson(text: string): DocumentModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es JSON válido.');
  }
  const obj = parsed as Record<string, unknown>;
  const raw = (obj && typeof obj === 'object' && 'document' in obj
    ? (obj as { document: unknown }).document
    : parsed) as Record<string, unknown>;

  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { pages?: unknown }).pages)) {
    throw new Error('El JSON no es un documento pdfsketch (falta "pages").');
  }
  return normalizeDocument(raw as Partial<DocumentModel>);
}

/* ─── Normalización defensiva ─── */

const UNITS: Unit[] = ['mm', 'pt', 'px'];

function str(v: unknown, def: string): string {
  return typeof v === 'string' ? v : def;
}
function num(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Rellena todos los campos estructurales de un DocumentModel que puedan faltar
 * en un JSON hecho a mano o por otra herramienta. NO valida la semántica de cada
 * elemento (eso lo hace el render), solo garantiza que el esqueleto exista.
 */
export function normalizeDocument(raw: Partial<DocumentModel>): DocumentModel {
  const nowIso = '1970-01-01T00:00:00.000Z'; // evitar new Date() (impuro para el historial)
  const a = (raw.assets ?? {}) as Partial<DocumentModel['assets']>;

  const pages = arr<Partial<Page>>(raw.pages).map((p, i) => normalizePage(p, i));

  return {
    id: str(raw.id, nextId('doc')),
    name: str(raw.name, 'Documento importado'),
    unit: UNITS.includes(raw.unit as Unit) ? (raw.unit as Unit) : 'mm',
    pages: pages.length ? pages : [normalizePage({}, 0)],
    assets: {
      fonts: arr<Font>(a.fonts),
      colors: arr<ColorToken>(a.colors),
      textStyles: arr<TextStyle>(a.textStyles),
      paragraphStyles: arr<ParagraphStyle>(a.paragraphStyles),
      borderStyles: arr<BorderStyle>(a.borderStyles),
      lineStyles: arr<LineStyle>(a.lineStyles),
      fillStyles: arr<FillStyle>(a.fillStyles),
      images: arr<ImageAsset>(a.images),
      tables: arr<TableDef>(a.tables),
      rowSets: arr<RowSet>(a.rowSets),
      cells: arr<CellDef>(a.cells),
    },
    data: {
      variables: arr(raw.data?.variables),
      datasets: arr(raw.data?.datasets),
    },
    dynamicComms: arr<DynamicComm>(raw.dynamicComms),
    flows: arr<Flow>(raw.flows),
    createdAt: str(raw.createdAt, nowIso),
    updatedAt: str(raw.updatedAt, nowIso),
  };
}

function normalizePage(p: Partial<Page>, index: number): Page {
  const size = (p.size ?? {}) as Partial<Page['size']>;
  const margin = (p.margin ?? {}) as Partial<Page['margin']>;
  return {
    id: str(p.id, nextId('page')),
    name: str(p.name, `Página ${index + 1}`),
    size: {
      width: num(size.width, 210),
      height: num(size.height, 297),
      unit: UNITS.includes(size.unit as Unit) ? (size.unit as Unit) : 'mm',
    },
    background: str(p.background, '#ffffff'),
    margin: {
      top: num(margin.top, 15),
      right: num(margin.right, 15),
      bottom: num(margin.bottom, 15),
      left: num(margin.left, 15),
    },
    rotation: num(p.rotation, 0),
    visible: bool(p.visible, true),
    weight: num(p.weight, 5),
    repeatedBy: (p.repeatedBy as Page['repeatedBy']) ?? 'Empty',
    addHeight: num(p.addHeight, 5),
    elements: arr<Partial<ElementModel>>(p.elements)
      .map((e, i) => normalizeElement(e, i))
      .filter((e): e is ElementModel => e !== null),
  };
}

/** Campos base comunes a TODOS los elementos + saneo mínimo por tipo. */
function normalizeElement(e: Partial<ElementModel>, index: number): ElementModel | null {
  if (!e || typeof e !== 'object' || typeof e.type !== 'string') return null;
  const base = {
    id: str(e.id, nextId('el')),
    type: e.type,
    name: typeof e.name === 'string' ? e.name : undefined,
    x: num(e.x, 0),
    y: num(e.y, 0),
    width: num(e.width, 20),
    height: num(e.height, 20),
    rotation: num(e.rotation, 0),
    visible: bool(e.visible, true),
    locked: bool(e.locked, false),
    zIndex: num(e.zIndex, index),
  };
  // El resto de campos específicos del tipo se conservan tal cual (el render y
  // los editores ya toleran los opcionales ausentes con sus propios defaults).
  return { ...(e as object), ...base } as ElementModel;
}
