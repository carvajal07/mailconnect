import { useMemo, useState } from 'react';
import { Database, RefreshCw, ChevronDown, ChevronRight, Link, MousePointerClick } from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { useDataSourceStore, type SketchDataSource } from '@/store/dataSourceStore';
import { useActiveEditorStore } from '@/store/activeEditorStore';
import { nextId } from '@/utils/id';
import { spansToPlainText } from '@/utils/richText';
import type { TextEl } from '@/types/document';

/* ─── Tipos de valor (para el árbol recursivo — admite JSON anidado a futuro) ─── */

type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

function jsonType(v: unknown): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonType;
}

const TYPE_COLOR: Record<JsonType, { bg: string; text: string; label: string }> = {
  string:  { bg: 'rgba(59,130,246,.16)',  text: '#3b82f6', label: 'txt' },
  number:  { bg: 'rgba(34,197,94,.16)',   text: '#16a34a', label: 'num' },
  boolean: { bg: 'rgba(249,115,22,.16)',  text: '#ea580c', label: 'bool' },
  null:    { bg: 'rgba(148,163,184,.18)', text: '#64748b', label: 'null' },
  object:  { bg: 'rgba(168,85,247,.16)',  text: '#9333ea', label: 'obj' },
  array:   { bg: 'rgba(99,102,241,.16)',  text: '#4f46e5', label: 'lista' },
};

/* ─── Nodo recursivo del árbol de variables ─── */

interface NodeProps {
  keyName: string;
  value: unknown;
  path: string;
  depth: number;
  usedPaths: Set<string>;
  onInsert: (path: string) => void;
}

function VarNode({ keyName, value, path, depth, usedPaths, onInsert }: NodeProps) {
  const type = jsonType(value);
  const isExpandable = type === 'object' || type === 'array';
  const [open, setOpen] = useState(depth < 2);
  const isUsed = usedPaths.has(path);

  // Para arrays, usa el primer elemento como muestra de esquema.
  const entries: [string, unknown][] = (() => {
    if (!isExpandable) return [];
    if (type === 'array') {
      const arr = value as unknown[];
      const first = arr[0];
      if (first != null && typeof first === 'object' && !Array.isArray(first))
        return Object.entries(first as Record<string, unknown>);
      if (first !== undefined) return [['item', first]];
      return [];
    }
    return Object.entries(value as Record<string, unknown>);
  })();

  const sample = !isExpandable && value !== '' && value != null ? String(value) : '';
  const { bg, text, label } = TYPE_COLOR[type];

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      <div
        draggable
        className="flex items-center h-[26px] gap-1 px-1 rounded group cursor-default select-none hover:bg-bg-3"
        style={{ minWidth: 0 }}
        title={isExpandable ? path : `Doble clic para insertar {{${keyName}}} · o arrastra`}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/x-binding-path', path);
          // text/plain hace que el navegador trate el arrastre como TEXTO →
          // sobre el editor (contentEditable) pinta el caret | letra a letra.
          // El drop real lo intercepta el editor e inserta la ficha {{campo}}.
          e.dataTransfer.setData('text/plain', `{{${path}}}`);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => { if (isExpandable) setOpen((o) => !o); }}
        onDoubleClick={(e) => { e.stopPropagation(); onInsert(path); }}
      >
        <span className="w-3 shrink-0 flex items-center justify-center text-muted">
          {isExpandable ? (open ? <ChevronDown size={9} /> : <ChevronRight size={9} />) : null}
        </span>

        <span className="shrink-0 rounded px-1 font-mono text-[9px] leading-none py-0.5" style={{ background: bg, color: text }}>
          {label}
        </span>

        <span className="text-11 text-ink shrink-0 font-mono">{keyName}</span>

        {sample && (
          <span className="text-[10px] text-muted truncate ml-1" style={{ minWidth: 0 }}>
            {sample}
          </span>
        )}

        <span className="flex-1" />

        {isUsed && (
          <span title={`En uso en el lienzo (${path})`} className="shrink-0">
            <Link size={10} style={{ color: 'var(--accent)' }} />
          </span>
        )}
      </div>

      {isExpandable && open && (
        <div style={{ borderLeft: '1px solid var(--line-2)', marginLeft: 6 }}>
          {entries.map(([k, v]) => (
            <VarNode
              key={k}
              keyName={k}
              value={v}
              path={path ? `${path}.${k}` : k}
              depth={depth + 1}
              usedPaths={usedPaths}
              onInsert={onInsert}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Esquema de muestra desde una base ─── */

function coerceSample(raw: string): unknown {
  const t = (raw ?? '').trim();
  // Admite celdas que contengan JSON (fuente no plana) — a futuro CSV/JSON con arrays.
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t); } catch { /* se deja como texto */ }
  }
  return raw ?? '';
}

function buildSchema(src: SketchDataSource): Record<string, unknown> {
  const sampleRow = src.previewRows?.[0] ?? [];
  const obj: Record<string, unknown> = {};
  src.columns.forEach((col, i) => { obj[col] = coerceSample(sampleRow[i] ?? ''); });
  return obj;
}

/* ─── Panel principal ─── */

export default function DataPanel() {
  const sources = useDataSourceStore((s) => s.sources);
  const selectedId = useDataSourceStore((s) => s.selectedId);
  const setSelected = useDataSourceStore((s) => s.setSelected);
  const loading = useDataSourceStore((s) => s.loading);
  const reload = useDataSourceStore((s) => s.reload);

  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const addElement = useDocumentStore((s) => s.addElement);

  const api = useActiveEditorStore((s) => s.api);
  const editingActive = !!api;

  const page = pages.find((p) => p.id === currentPageId) ?? pages[0];
  const selected = sources.find((s) => s.id === selectedId) ?? null;

  const schema = useMemo(() => (selected ? buildSchema(selected) : {}), [selected]);
  const rootEntries = Object.entries(schema);

  /* Rutas ya usadas en el lienzo (spans de TextEl con binding) */
  const usedPaths = useMemo(
    () => new Set(
      pages.flatMap((p) =>
        p.elements
          .filter((e) => e.type === 'text')
          .flatMap((e) => (e as TextEl).spans ?? [])
          .map((s) => s.binding)
          .filter((b): b is string => !!b),
      ),
    ),
    [pages],
  );

  /* Inserta la variable: en el cursor del texto en edición, o crea un texto nuevo. */
  function handleInsert(path: string) {
    const active = useActiveEditorStore.getState().api;
    if (active) { active.insertBinding(path); return; }
    if (!page) return;
    const nextZ = page.elements.length > 0 ? Math.max(...page.elements.map((e) => e.zIndex)) + 1 : 1;
    const name = path.split('.').pop() ?? path;
    const spans = [{ binding: path, color: '#902774' }];
    const el: TextEl = {
      id: nextId('el'),
      type: 'text',
      name,
      x: 20, y: 20, width: 60, height: 8,
      rotation: 0, visible: true, locked: false, zIndex: nextZ,
      text: spansToPlainText(spans),
      spans,
      fontFamily: 'Helvetica', fontSize: 12, fontStyle: 'normal', fontWeight: 400,
      align: 'left', lineHeight: 1.2, color: '#000000',
    };
    addElement(page.id, el);
  }

  return (
    <div className="h-full flex flex-col">

      {/* ── Selector de base ── */}
      <div className="shrink-0 px-3 py-2 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--line-2)' }}>
        <div className="flex items-center gap-2">
          <Database size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="text-11 font-semibold text-ink flex-1">Base de datos</span>
          <button
            type="button"
            title="Recargar bases de datos"
            onClick={() => reload?.()}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg-3 text-muted shrink-0"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>

        {sources.length > 0 ? (
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelected(e.target.value || null)}
            className="field"
            style={{ height: 30 }}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.columns.length ? ` · ${s.columns.length} campos` : ' · sin columnas'}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[10px] text-muted">
            {loading ? 'Cargando bases…' : 'No hay bases de datos cargadas. Súbelas en la pestaña «Bases de datos» del portal.'}
          </span>
        )}
      </div>

      {/* ── Hint ── */}
      {selected && rootEntries.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 text-[10px] flex items-center gap-1"
          style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
          <MousePointerClick size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="text-muted">
            {editingActive
              ? 'Doble clic → inserta en el cursor · o arrástrala al texto'
              : 'Doble clic → crea un texto con la variable · o arrástrala sobre un texto'}
          </span>
        </div>
      )}

      {/* ── Árbol de variables ── */}
      {selected && (
        <div data-var-source className="flex-1 overflow-y-auto px-2 py-2">
          {rootEntries.length > 0 ? (
            rootEntries.map(([k, v]) => (
              <VarNode
                key={k}
                keyName={k}
                value={v}
                path={k}
                depth={0}
                usedPaths={usedPaths}
                onInsert={handleInsert}
              />
            ))
          ) : (
            <div className="text-[10px] text-muted px-2 py-4 text-center">
              Esta base no tiene columnas registradas. Vuelve a subirla en «Bases de datos»
              para poder usar sus campos como variables.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
