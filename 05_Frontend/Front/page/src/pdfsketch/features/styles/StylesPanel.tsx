import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useUIStore } from '@/store/uiStore';
import {
  ChevronDown, ChevronRight, PaintBucket, Palette, Pencil, Pilcrow, Plus,
  Slash, Square, Trash2, Type,
} from 'lucide-react';
import { useDocumentStore, applyTextStyleProps, applyParagraphStyleProps, applyFillStyleProps, type StyleKey } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import type {
  TextStyle, ParagraphStyle, BorderStyle, LineStyle, FillStyle,
  ElementModel, RectEl, CircleEl, LineEl, PenEl, FlowableEl,
  LineDashStyle,
} from '@/types/document';
import StyleEditorModal, { type StyleEditorTarget } from './StyleEditorModal';
import { hexWithOpacity } from '@/utils/konvaFill';

function getDashPattern(lineDash: LineDashStyle): number[] | undefined {
  switch (lineDash) {
    case 'Dashed': return [8, 4];
    case 'Dotted': return [2, 4];
    case 'DashDot': return [8, 4, 2, 4];
    default: return undefined;
  }
}

/* ─── Qué estilos aplican a cada tipo de elemento ─── */

const APPLICABLE: Record<StyleKey, ElementModel['type'][]> = {
  textStyles:      ['text', 'dataField'],
  paragraphStyles: ['text'],
  borderStyles:    ['rect', 'circle', 'triangle', 'frame', 'flowable'],
  lineStyles:      ['line', 'pen'],
  fillStyles:      ['rect', 'circle', 'triangle', 'frame', 'flowable'],
};

const KEY_LABELS: Record<StyleKey, string> = {
  textStyles:      'Estilos de texto',
  paragraphStyles: 'Estilos de párrafo',
  borderStyles:    'Estilos de borde',
  lineStyles:      'Estilos de línea',
  fillStyles:      'Estilos de relleno',
};

/** Icono por sección — como el panel Recursos del Diseñador PDF. */
const KEY_ICONS: Record<StyleKey, ComponentType<{ size?: number | string }>> = {
  textStyles:      Type,
  paragraphStyles: Pilcrow,
  borderStyles:    Square,
  lineStyles:      Slash,
  fillStyles:      PaintBucket,
};

/** Cabecera de sección con el look del Diseñador: chevron · icono · label · count · + */
function SectionHeaderRow({
  icon: Icon, label, count, open, onToggle, onAdd, addTitle,
}: {
  icon: ComponentType<{ size?: number | string }>;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addTitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2 py-[5px] text-11 font-semibold text-left select-none hover:bg-bg-3"
      style={{ color: 'var(--ink-2)' }}
    >
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <Icon size={13} />
      <span style={{ color: 'var(--ink)' }}>{label}</span>
      <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--muted)' }}>{count}</span>
      <span
        role="button"
        tabIndex={0}
        title={addTitle}
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAdd(); } }}
        className="flex items-center px-0.5 py-0.5 rounded"
        style={{ color: 'var(--muted)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-soft)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent'; }}
      >
        <Plus size={11} />
      </span>
    </button>
  );
}

const STYLE_KEYS: StyleKey[] = [
  'textStyles', 'paragraphStyles', 'borderStyles', 'lineStyles', 'fillStyles',
];

/* ─── Aplicar estilo a un elemento ─── */

function applyStyle(el: ElementModel, key: StyleKey, style: unknown, update: (id: string, p: Partial<ElementModel>) => void) {
  switch (key) {
    case 'textStyles': {
      // Applier compartido con updateStyle (vinculación en vivo por textStyleId).
      const next = applyTextStyleProps(el, style as TextStyle);
      if (next !== el) update(el.id, next);
      break;
    }
    case 'paragraphStyles': {
      const next = applyParagraphStyleProps(el, style as ParagraphStyle);
      if (next !== el) update(el.id, next);
      break;
    }
    case 'borderStyles': {
      const s = style as BorderStyle;
      const dash = getDashPattern(s.lineDash ?? 'Solid');
      const cornerRadius = (s.corner ?? 'Standard') === 'Round' ? (s.radiusX ?? 0) : 0;
      const base = { stroke: s.colorId, strokeWidth: s.lineWidth, dash, borderStyleId: s.id };
      if (el.type === 'rect' || el.type === 'frame') {
        update(el.id, { ...base, cornerRadius } as Partial<RectEl>);
      } else if (el.type === 'circle' || el.type === 'triangle') {
        update(el.id, base as Partial<CircleEl>);
      } else if (el.type === 'flowable') {
        update(el.id, base as Partial<FlowableEl>);
      }
      break;
    }
    case 'lineStyles': {
      const s = style as LineStyle;
      if (el.type === 'line') {
        const patch: Partial<LineEl> = { strokeWidth: s.width, dash: s.dash, lineStyleId: s.id };
        if (s.colorId) patch.stroke = s.colorId;
        update(el.id, patch);
      } else if (el.type === 'pen') {
        const patch: Partial<PenEl> = { strokeWidth: s.width, lineStyleId: s.id };
        if (s.colorId) patch.stroke = s.colorId;
        update(el.id, patch);
      }
      break;
    }
    case 'fillStyles': {
      const next = applyFillStyleProps(el, style as FillStyle);
      if (next !== el) update(el.id, next);
      break;
    }
  }
}

/* ─── Componente principal ─── */

export default function StylesPanel() {
  const doc = useDocumentStore((s) => s.doc);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const addColor = useDocumentStore((s) => s.addColor);
  const updateColor = useDocumentStore((s) => s.updateColor);
  const removeColor = useDocumentStore((s) => s.removeColor);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const [editor, setEditor] = useState<StyleEditorTarget | null>(null);
  // Todas las secciones CONTRAÍDAS por defecto (como el panel Recursos del Diseñador).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const selectedElements = useMemo<ElementModel[]>(() => {
    if (selectedIds.length === 0) return [];
    const set = new Set(selectedIds);
    return doc.pages.flatMap((p) => p.elements).filter((e) => set.has(e.id));
  }, [doc.pages, selectedIds]);

  const allElements = useMemo(() => doc.pages.flatMap((p) => p.elements), [doc.pages]);

  const linkedCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const el of allElements) {
      const bid = (el as { borderStyleId?: string }).borderStyleId;
      const lid = (el as { lineStyleId?: string }).lineStyleId;
      if (bid) counts[bid] = (counts[bid] ?? 0) + 1;
      if (lid) counts[lid] = (counts[lid] ?? 0) + 1;
    }
    return counts;
  }, [allElements]);

  const selectedTypes = useMemo(
    () => new Set(selectedElements.map((e) => e.type)),
    [selectedElements],
  );

  function canApply(key: StyleKey) {
    if (selectedElements.length === 0) return false;
    return APPLICABLE[key].some((t) => selectedTypes.has(t));
  }

  function handleApply(key: StyleKey, style: unknown) {
    const applicableTypes = new Set(APPLICABLE[key]);
    for (const el of selectedElements) {
      if (applicableTypes.has(el.type)) {
        applyStyle(el, key, style, updateElement);
      }
    }
  }

  function applyColorToSelection(rgb: string) {
    for (const el of selectedElements) {
      if (el.type === 'rect' || el.type === 'circle' || el.type === 'triangle' || el.type === 'frame' || el.type === 'flowable') {
        updateElement(el.id, { fill: rgb } as Partial<ElementModel>);
      } else if (el.type === 'text' || el.type === 'dataField') {
        updateElement(el.id, { color: rgb } as Partial<ElementModel>);
      } else if (el.type === 'line' || el.type === 'pen') {
        updateElement(el.id, { stroke: rgb } as Partial<ElementModel>);
      }
    }
  }

  function toggleSection(key: string) {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  }

  function openNew(key: StyleKey) {
    setEditor({ key, item: null } as StyleEditorTarget);
  }

  function openEdit(key: StyleKey, id: string) {
    const items = doc.assets[key] as { id: string }[];
    const found = items.find((i) => i.id === id);
    if (found) setEditor({ key, item: found } as StyleEditorTarget);
  }

  return (
    <div className="h-full overflow-y-auto">
      {selectedElements.length > 0 && (
        <div
          className="mx-3 mt-3 mb-1 px-2 py-1.5 rounded text-[10px]"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}
        >
          {selectedElements.length === 1
            ? '1 elemento seleccionado — haz clic en un estilo para aplicarlo'
            : `${selectedElements.length} elementos — haz clic para aplicar`}
        </div>
      )}

      <div className="flex flex-col">
        {/* ── Colores del documento (paleta reusable, como en Recursos del Diseñador) ── */}
        <div style={{ borderBottom: '1px solid var(--line-2)' }}>
          <SectionHeaderRow
            icon={Palette}
            label="Colores"
            count={doc.assets.colors.length}
            open={!!openSections.colors}
            onToggle={() => toggleSection('colors')}
            onAdd={() => addColor(`Color ${doc.assets.colors.length + 1}`, '#3b82f6')}
            addTitle="Nuevo color"
          />
          {openSections.colors && (
            <div className="pb-1 pl-6 pr-1.5">
              {doc.assets.colors.length === 0 && (
                <div className="py-1.5 text-[10px] text-muted italic">
                  Sin colores — usa + para crear uno
                </div>
              )}
              {doc.assets.colors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center h-[28px] px-1 gap-2 select-none group hover:bg-bg-3 cursor-pointer"
                  style={{
                    borderBottom: '1px solid var(--line-2)',
                    ...(useUIStore.getState().styleTarget?.id === c.id
                      ? { background: 'var(--accent-soft)' } : {}),
                  }}
                  onClick={() => useUIStore.getState().setStyleTarget({ kind: 'color', id: c.id })}
                  title="Clic: editar abajo en Propiedades · doble clic: renombrar"
                >
                  <input
                    type="color"
                    value={c.rgb}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateColor(c.id, { rgb: e.target.value })}
                    className="w-4 h-4 shrink-0 cursor-pointer rounded border-0 p-0 bg-transparent"
                    title="Editar color"
                  />
                  <RenamableName
                    name={c.name}
                    onRename={(name) => updateColor(c.id, { name })}
                  />
                  <span className="font-mono text-[9px] text-muted">{c.rgb}</span>
                  {selectedElements.length > 0 && (
                    <button
                      type="button"
                      className="text-[9px] font-semibold px-1 rounded opacity-0 group-hover:opacity-100"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      title={`Aplicar "${c.name}" a la selección`}
                      onClick={(e) => { e.stopPropagation(); applyColorToSelection(hexWithOpacity(c.rgb, (c.alpha ?? 255) / 255)); }}
                    >
                      Aplicar
                    </button>
                  )}
                  <button
                    type="button"
                    title="Eliminar color"
                    onClick={(e) => { e.stopPropagation(); removeColor(c.id); }}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {STYLE_KEYS.map((key) => {
          const items = doc.assets[key] as { id: string; name: string }[];
          const isOpen = openSections[key];
          const applicable = canApply(key);

          return (
            <div key={key} style={{ borderBottom: '1px solid var(--line-2)' }}>
              <SectionHeaderRow
                icon={KEY_ICONS[key]}
                label={KEY_LABELS[key]}
                count={items.length}
                open={!!isOpen}
                onToggle={() => toggleSection(key)}
                onAdd={() => openNew(key)}
                addTitle={`Nuevo ${KEY_LABELS[key].toLowerCase()}`}
              />

              {/* Items */}
              {isOpen && (
                <div className="pb-1 pl-6 pr-1.5">
                  {items.length === 0 && (
                    <div className="py-1.5 text-[10px] text-muted italic">
                      Sin estilos — usa + para crear uno
                    </div>
                  )}
                  {items.map((item) => (
                    <StyleItem
                      key={item.id}
                      styleKey={key}
                      item={item}
                      applicable={applicable}
                      linkedCount={linkedCounts[item.id] ?? 0}
                      onApply={() => handleApply(key, item)}
                      onEdit={() => openEdit(key, item.id)}
                      onFocusStyle={() => useUIStore.getState().setStyleTarget({ kind: key, id: item.id })}
                      onRename={(name) => useDocumentStore.getState().updateStyle(key, item.id, { name })}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editor && (
        <StyleEditorModal target={editor} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}

/* ─── Fila de estilo individual ─── */

function StyleItem({
  styleKey, item, applicable, linkedCount, onApply, onEdit, onFocusStyle, onRename,
}: {
  styleKey: StyleKey;
  item: { id: string; name: string } & Record<string, unknown>;
  applicable: boolean;
  linkedCount: number;
  onApply: () => void;
  onEdit: () => void;
  onFocusStyle: () => void;
  onRename: (name: string) => void;
}) {
  const focused = useUIStore((s) => s.styleTarget?.id === item.id);
  return (
    <div
      className="flex items-center h-[28px] px-1 gap-2 cursor-pointer select-none group hover:bg-bg-3"
      style={{
        borderBottom: '1px solid var(--line-2)',
        ...(focused ? { background: 'var(--accent-soft)' } : {}),
      }}
      onClick={onFocusStyle}
      title="Clic: editar abajo en Propiedades · doble clic: renombrar"
    >
      {/* Miniatura visual */}
      <StylePreview styleKey={styleKey} item={item} />

      {/* Nombre (doble clic para renombrar) */}
      <RenamableName name={item.name} onRename={onRename} />

      {/* Elementos vinculados */}
      {linkedCount > 0 && (
        <span
          className="text-[9px] font-mono px-1 rounded shrink-0"
          style={{ background: 'var(--bg-3)', color: 'var(--ink-2)' }}
          title={`Vinculado en ${linkedCount} elemento${linkedCount !== 1 ? 's' : ''}`}
        >
          {linkedCount}
        </span>
      )}

      {/* Aplicar a la selección (botón explícito) */}
      {applicable && (
        <button
          type="button"
          className="text-[9px] font-semibold px-1 rounded opacity-0 group-hover:opacity-100"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          title={`Aplicar "${item.name}" a la selección`}
          onClick={(e) => { e.stopPropagation(); onApply(); }}
        >
          Aplicar
        </button>
      )}

      {/* Editor completo */}
      <button
        type="button"
        title="Editor completo"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        <Pencil size={11} />
      </button>
    </div>
  );
}

/** Nombre editable con doble clic (renombrar en línea). */
function RenamableName({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        defaultValue={name}
        className="flex-1 text-11 px-1 rounded outline-none"
        style={{ background: 'var(--bg-2)', color: 'var(--ink)', border: '1px solid var(--accent)' }}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v) onRename(v); setEditing(false); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) onRename(v); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <span
      className="flex-1 truncate text-11"
      style={{ color: 'var(--ink)' }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      {name}
    </span>
  );
}

/* ─── Miniatura visual por tipo ─── */

function StylePreview({ styleKey, item }: { styleKey: StyleKey; item: Record<string, unknown> }) {
  if (styleKey === 'fillStyles') {
    return (
      <div
        className="w-4 h-4 rounded shrink-0 border"
        style={{ background: (item.colorId as string) || '#ccc', borderColor: 'var(--line-2)' }}
      />
    );
  }
  if (styleKey === 'borderStyles') {
    const lineDash = item.lineDash as string | undefined;
    const dash = lineDash === 'Dashed' ? '4 2' : lineDash === 'Dotted' ? '1 2' : lineDash === 'DashDot' ? '4 2 1 2' : undefined;
    const sw = Math.min(Number(item.lineWidth) || 1, 3);
    const color = (item.colorId as string) || '#000';
    return (
      <svg width={16} height={16} style={{ flexShrink: 0 }}>
        <rect
          x={sw / 2} y={sw / 2}
          width={16 - sw} height={16 - sw}
          rx={item.corner === 'Round' ? Math.min(Number(item.radiusX) || 0, 4) : 0}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeDasharray={dash}
        />
      </svg>
    );
  }
  if (styleKey === 'lineStyles') {
    const dash = item.dash as number[] | undefined;
    const color = (item.colorId as string) || 'var(--ink)';
    return (
      <svg width={16} height={16} style={{ flexShrink: 0 }}>
        <line
          x1="1" y1="8" x2="15" y2="8"
          stroke={color}
          strokeWidth={Math.min(Number(item.width) || 1, 3)}
          strokeLinecap="round"
          strokeDasharray={dash?.join(' ')}
        />
      </svg>
    );
  }
  if (styleKey === 'textStyles') {
    return (
      <div
        className="w-4 h-4 flex items-center justify-center shrink-0 font-bold rounded text-[9px]"
        style={{ background: 'var(--bg-3)', color: (item.fillStyleId as string) || 'var(--ink)' }}
      >
        A
      </div>
    );
  }
  if (styleKey === 'paragraphStyles') {
    return (
      <div className="w-4 h-4 flex flex-col justify-center gap-0.5 shrink-0">
        <div className="w-full h-px" style={{ background: 'var(--ink-2)' }} />
        <div className="w-3/4 h-px" style={{ background: 'var(--ink-2)' }} />
        <div className="w-full h-px" style={{ background: 'var(--ink-2)' }} />
      </div>
    );
  }
  return <div className="w-4 h-4 shrink-0" />;
}
