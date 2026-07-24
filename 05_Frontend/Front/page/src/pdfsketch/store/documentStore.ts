import { create } from 'zustand';
import { temporal } from 'zundo';
import type { DocumentModel, ElementModel, Page, TextStyle, ParagraphStyle, BorderStyle, LineStyle, FillStyle, LineDashStyle, TextEl } from '@/types/document';
import { nextId } from '@/utils/id';

function getDashPattern(lineDash: LineDashStyle): number[] | undefined {
  switch (lineDash) {
    case 'Dashed': return [8, 4];
    case 'Dotted': return [2, 4];
    case 'DashDot': return [8, 4, 2, 4];
    default: return undefined;
  }
}

function applyBorderStyleProps(el: ElementModel, style: BorderStyle): ElementModel {
  const dash = getDashPattern(style.lineDash);
  const cornerRadius = style.corner === 'Round' ? style.radiusX : 0;
  const common = { stroke: style.colorId, strokeWidth: style.lineWidth, dash, borderStyleId: style.id };
  if (el.type === 'rect' || el.type === 'frame') {
    return { ...el, ...common, cornerRadius };
  }
  return { ...el, ...common };
}

function applyLineStyleProps(el: ElementModel, style: LineStyle): ElementModel {
  const base = { strokeWidth: style.width, lineStyleId: style.id } as Partial<ElementModel>;
  if (style.colorId) Object.assign(base, { stroke: style.colorId });
  if (el.type === 'line') return { ...el, ...base, dash: style.dash } as ElementModel;
  return { ...el, ...base } as ElementModel;
}

/** Copia las props de un TextStyle sobre un elemento de texto/dataField (vinculación en vivo). */
export function applyTextStyleProps(el: ElementModel, s: TextStyle): ElementModel {
  if (el.type === 'text') {
    const patch: Partial<TextEl> = {
      fontSize: s.fontSize,
      fontFamily: s.fontId,
      fontWeight: s.subFont === 'Bold' || s.subFont === 'BoldItalic' ? 700 : 400,
      fontStyle: s.subFont === 'Italic' || s.subFont === 'BoldItalic' ? 'italic' : 'normal',
      color: s.fillStyleId || el.color,
      textDecoration: s.underline ? 'underline' : s.strikethrough ? 'line-through' : undefined,
      letterSpacing: s.letterSpacing ?? undefined,
      textTransform: s.textTransform ?? 'none',
      textStyleId: s.id,
    };
    if (s.lineHeight) patch.lineHeight = s.lineHeight;
    return { ...el, ...patch };
  }
  if (el.type === 'dataField') {
    return { ...el, fontSize: s.fontSize, fontFamily: s.fontId, color: s.fillStyleId || el.color };
  }
  return el;
}

/** Copia las props de un ParagraphStyle sobre un elemento de texto (vinculación en vivo). */
export function applyParagraphStyleProps(el: ElementModel, s: ParagraphStyle): ElementModel {
  if (el.type !== 'text') return el;
  const alignMap: Record<string, TextEl['align']> = {
    Left: 'left', Center: 'center', Right: 'right', Justify: 'justify-block',
  };
  const patch: Partial<TextEl> = {
    align: alignMap[s.hAlign] ?? 'left',
    lineHeight: s.lineSpacing,
    leftIndent: s.leftIndent,
    rightIndent: s.rightIndent,
    firstLineIndent: s.firstLineLeftIndent,
    spaceBefore: s.spaceBefore,
    spaceAfter: s.spaceAfter,
    listStyle: s.listStyle ?? 'none',
    listIndent: s.listIndent,
    bulletChar: s.bulletChar,
    numberFormat: s.numberFormat,
    paragraphStyleId: s.id,
  };
  return { ...el, ...patch };
}

/** Copia las props de un FillStyle (sólido/degradado/opacidad) sobre una forma. */
export function applyFillStyleProps(el: ElementModel, s: FillStyle): ElementModel {
  if (el.type !== 'rect' && el.type !== 'circle' && el.type !== 'triangle'
    && el.type !== 'frame' && el.type !== 'flowable') return el;
  const isGradient = s.fillType === 'linear' || s.fillType === 'radial';
  const patch = {
    fill: s.fillType === 'none' ? 'transparent' : (s.colorId || '#ffffff'),
    fillGradient: isGradient && s.gradient
      ? { ...s.gradient, kind: s.fillType as 'linear' | 'radial' }
      : undefined,
    opacity: s.opacity ?? 1,
    fillStyleId: s.id,
  };
  return { ...el, ...patch } as ElementModel;
}

/** Etiqueta base por tipo de elemento (para el auto-nombrado: Texto, Texto_1, …). */
export const ELEMENT_TYPE_LABELS: Record<string, string> = {
  text: 'Texto', rect: 'Rectángulo', circle: 'Círculo', triangle: 'Triángulo', line: 'Línea',
  pen: 'Trazo', image: 'Imagen', table: 'Tabla', qr: 'QR',
  dataField: 'Campo', frame: 'Área', flowable: 'Sub-área',
};

/**
 * Calcula un nombre único por tipo para un elemento nuevo: la primera pieza de
 * un tipo se llama p. ej. "Texto", la siguiente "Texto_1", "Texto_2", … Salta
 * los sufijos ya usados (por elementos renombrados o borrados) para no duplicar.
 */
function autoNameFor(doc: DocumentModel, type: string): string {
  const label = ELEMENT_TYPE_LABELS[type] ?? type;
  const used = new Set<string>();
  for (const p of doc.pages) {
    for (const e of p.elements) {
      if (e.type === type && e.name) used.add(e.name);
    }
  }
  if (!used.has(label)) return label;
  let i = 1;
  while (used.has(`${label}_${i}`)) i += 1;
  return `${label}_${i}`;
}

export type StyleKey = 'textStyles' | 'paragraphStyles' | 'borderStyles' | 'lineStyles' | 'fillStyles';
export type AnyStyleItem = TextStyle | ParagraphStyle | BorderStyle | LineStyle | FillStyle;

export function emptyDocument(): DocumentModel {
  const now = new Date().toISOString();
  const pageId = nextId('page');
  const defaultPage: Page = {
    id: pageId,
    name: 'Página 1',
    size: { width: 210, height: 297, unit: 'mm' },
    background: '#ffffff',
    margin: { top: 15, right: 15, bottom: 15, left: 15 },
    rotation: 0,
    visible: true,
    weight: 5,
    repeatedBy: 'Empty',
    addHeight: 5,
    elements: [],
  };
  return {
    id: nextId('doc'),
    name: 'Untitled',
    unit: 'mm',
    pages: [defaultPage],
    assets: {
      fonts: [],
      colors: [],
      textStyles: [],
      paragraphStyles: [],
      borderStyles: [],
      lineStyles: [],
      fillStyles: [],
      images: [],
      tables: [],
      rowSets: [],
      cells: [],
    },
    data: { variables: [], datasets: [] },
    dynamicComms: [],
    flows: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface DocumentState {
  doc: DocumentModel;
  currentPageId: string;
  dirty: boolean;
  lastSavedAt: string | null;

  /** JSON externo cargado como fuente de datos variable (fuera del historial undo). */
  jsonData: unknown | null;
  jsonFileName: string | null;
  setJsonData: (data: unknown | null, fileName?: string) => void;

  setDoc: (d: DocumentModel) => void;
  setCurrentPage: (pageId: string) => void;
  addPage: () => void;
  removePage: (pageId: string) => void;
  updatePage: (pageId: string, patch: Partial<Page>) => void;

  addElement: (pageId: string, el: ElementModel) => void;
  updateElement: (id: string, patch: Partial<ElementModel>) => void;
  /** Actualiza varios elementos en UNA sola operación (una entrada de historial).
   *  Se usa para mover una selección múltiple sin que cada elemento genere su
   *  propio paso de undo. */
  updateElements: (patches: { id: string; patch: Partial<ElementModel> }[]) => void;
  removeElement: (id: string) => void;
  removeElements: (ids: string[]) => void;

  addStyle: (key: StyleKey, item: AnyStyleItem) => void;
  updateStyle: (key: StyleKey, id: string, patch: Partial<AnyStyleItem>) => void;
  removeStyle: (key: StyleKey, id: string) => void;

  // Colores del documento (paleta reusable — sección Recursos)
  addColor: (name: string, rgb: string) => void;
  updateColor: (id: string, patch: Partial<{ name: string; rgb: string; alpha: number }>) => void;
  removeColor: (id: string) => void;

  // Imágenes registradas como recurso (Estilos → Imágenes). `imageLocation` = URL S3.
  addImageAsset: (name: string, imageLocation: string) => void;
  removeImageAsset: (id: string) => void;

  /** Renombra un item de cualquier lista de assets (colores, fuentes, imágenes,
   *  tablas, filas, celdas…) — para el renombrar por doble clic del árbol. */
  renameAssetItem: (
    listKey: 'colors' | 'fonts' | 'images' | 'tables' | 'rowSets' | 'cells',
    id: string,
    name: string,
  ) => void;

  markSaved: () => void;
}

export const useDocumentStore = create<DocumentState>()(
  temporal(
    (set) => ({
      doc: emptyDocument(),
      currentPageId: '',
      dirty: false,
      lastSavedAt: null,
      jsonData: null,
      jsonFileName: null,
      setJsonData: (data, fileName) => set({ jsonData: data, jsonFileName: fileName ?? null }),

      setDoc: (d) => set({ doc: d, currentPageId: d.pages[0]?.id ?? '', dirty: false }),
      setCurrentPage: (pageId) => set({ currentPageId: pageId }),

      addPage: () =>
        set((s) => {
          const id = nextId('page');
          const page: Page = {
            id,
            name: `Página ${s.doc.pages.length + 1}`,
            size: { width: 210, height: 297, unit: 'mm' },
            background: '#ffffff',
            margin: { top: 15, right: 15, bottom: 15, left: 15 },
            rotation: 0,
            visible: true,
            weight: 5,
            repeatedBy: 'Empty',
            addHeight: 5,
            elements: [],
          };
          return {
            doc: { ...s.doc, pages: [...s.doc.pages, page], updatedAt: new Date().toISOString() },
            currentPageId: id,
            dirty: true,
          };
        }),

      removePage: (pageId) =>
        set((s) => {
          if (s.doc.pages.length <= 1) return s;
          const pages = s.doc.pages.filter((p) => p.id !== pageId);
          const currentPageId =
            s.currentPageId === pageId ? pages[0].id : s.currentPageId;
          return {
            doc: { ...s.doc, pages, updatedAt: new Date().toISOString() },
            currentPageId,
            dirty: true,
          };
        }),

      updatePage: (pageId, patch) =>
        set((s) => ({
          doc: {
            ...s.doc,
            pages: s.doc.pages.map((p) =>
              p.id === pageId ? { ...p, ...patch } : p,
            ),
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      addElement: (pageId, el) =>
        set((s) => {
          // Cada elemento nuevo recibe un nombre propio (Texto, Texto_1, …) si no
          // trae uno; así aparece identificable en el árbol de capas.
          const named = el.name ? el : ({ ...el, name: autoNameFor(s.doc, el.type) } as ElementModel);
          return {
            doc: {
              ...s.doc,
              pages: s.doc.pages.map((p) =>
                p.id === pageId ? { ...p, elements: [...p.elements, named] } : p,
              ),
              updatedAt: new Date().toISOString(),
            },
            dirty: true,
          };
        }),

      updateElement: (id, patch) =>
        set((s) => ({
          doc: {
            ...s.doc,
            pages: s.doc.pages.map((p) => ({
              ...p,
              elements: p.elements.map((e) =>
                e.id === id ? ({ ...e, ...patch } as ElementModel) : e,
              ),
            })),
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      updateElements: (patches) =>
        set((s) => {
          if (!patches.length) return s;
          const byId = new Map(patches.map((p) => [p.id, p.patch]));
          return {
            doc: {
              ...s.doc,
              pages: s.doc.pages.map((p) => ({
                ...p,
                elements: p.elements.map((e) =>
                  byId.has(e.id) ? ({ ...e, ...byId.get(e.id) } as ElementModel) : e,
                ),
              })),
              updatedAt: new Date().toISOString(),
            },
            dirty: true,
          };
        }),

      removeElement: (id) =>
        set((s) => ({
          doc: {
            ...s.doc,
            pages: s.doc.pages.map((p) => ({
              ...p,
              elements: p.elements.filter((e) => e.id !== id),
            })),
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      removeElements: (ids) =>
        set((s) => {
          const drop = new Set(ids);
          return {
            doc: {
              ...s.doc,
              pages: s.doc.pages.map((p) => ({
                ...p,
                elements: p.elements.filter((e) => !drop.has(e.id)),
              })),
              updatedAt: new Date().toISOString(),
            },
            dirty: true,
          };
        }),

      addColor: (name, rgb) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: {
              ...s.doc.assets,
              colors: [...s.doc.assets.colors, { id: nextId('col'), name, rgb }],
            },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      updateColor: (id, patch) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: {
              ...s.doc.assets,
              colors: s.doc.assets.colors.map((c) => (c.id === id ? { ...c, ...patch } : c)),
            },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      removeColor: (id) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: { ...s.doc.assets, colors: s.doc.assets.colors.filter((c) => c.id !== id) },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      addImageAsset: (name, imageLocation) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: {
              ...s.doc.assets,
              images: [
                ...s.doc.assets.images,
                { id: nextId('img'), name, imageType: 'Simple', imageLocation },
              ],
            },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      removeImageAsset: (id) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: { ...s.doc.assets, images: s.doc.assets.images.filter((im) => im.id !== id) },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      renameAssetItem: (listKey, id, name) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: {
              ...s.doc.assets,
              [listKey]: (s.doc.assets[listKey] as { id: string; name: string }[]).map((it) =>
                it.id === id ? { ...it, name } : it,
              ),
            },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      addStyle: (key, item) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: { ...s.doc.assets, [key]: [...(s.doc.assets[key] as AnyStyleItem[]), item] },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      updateStyle: (key, id, patch) =>
        set((s) => {
          const updatedList = (s.doc.assets[key] as AnyStyleItem[]).map((it) =>
            it.id === id ? { ...it, ...patch } : it,
          );
          const updatedAssets = { ...s.doc.assets, [key]: updatedList };
          const fullStyle = updatedList.find((it) => it.id === id);

          let pages = s.doc.pages;
          if (fullStyle) {
            if (key === 'borderStyles') {
              pages = pages.map((p) => ({
                ...p,
                elements: p.elements.map((e) =>
                  'borderStyleId' in e && (e as { borderStyleId?: string }).borderStyleId === id
                    ? applyBorderStyleProps(e, fullStyle as BorderStyle)
                    : e,
                ),
              }));
            } else if (key === 'lineStyles') {
              pages = pages.map((p) => ({
                ...p,
                elements: p.elements.map((e) =>
                  'lineStyleId' in e && (e as { lineStyleId?: string }).lineStyleId === id
                    ? applyLineStyleProps(e, fullStyle as LineStyle)
                    : e,
                ),
              }));
            } else if (key === 'textStyles') {
              pages = pages.map((p) => ({
                ...p,
                elements: p.elements.map((e) =>
                  'textStyleId' in e && (e as { textStyleId?: string }).textStyleId === id
                    ? applyTextStyleProps(e, fullStyle as TextStyle)
                    : e,
                ),
              }));
            } else if (key === 'paragraphStyles') {
              pages = pages.map((p) => ({
                ...p,
                elements: p.elements.map((e) =>
                  'paragraphStyleId' in e && (e as { paragraphStyleId?: string }).paragraphStyleId === id
                    ? applyParagraphStyleProps(e, fullStyle as ParagraphStyle)
                    : e,
                ),
              }));
            } else if (key === 'fillStyles') {
              pages = pages.map((p) => ({
                ...p,
                elements: p.elements.map((e) =>
                  'fillStyleId' in e && (e as { fillStyleId?: string }).fillStyleId === id
                    ? applyFillStyleProps(e, fullStyle as FillStyle)
                    : e,
                ),
              }));
            }
          }

          return {
            doc: {
              ...s.doc,
              assets: updatedAssets,
              pages,
              updatedAt: new Date().toISOString(),
            },
            dirty: true,
          };
        }),

      removeStyle: (key, id) =>
        set((s) => ({
          doc: {
            ...s.doc,
            assets: {
              ...s.doc.assets,
              [key]: (s.doc.assets[key] as AnyStyleItem[]).filter((it) => it.id !== id),
            },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      markSaved: () => set({ dirty: false, lastSavedAt: new Date().toISOString() }),
    }),
    {
      limit: 100,
      // sólo guardar lo relevante para el historial
      partialize: (state) => ({ doc: state.doc, currentPageId: state.currentPageId }),
    },
  ),
);

/** Hook para acceder a las acciones de zundo. */
export const useDocumentHistory = () => useDocumentStore.temporal;

/** Inicializa currentPageId cuando la primera página existe. */
const firstPage = useDocumentStore.getState().doc.pages[0];
if (firstPage) useDocumentStore.setState({ currentPageId: firstPage.id });
