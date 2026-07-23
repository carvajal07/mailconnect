import { useRef, useState } from 'react';
import { Database, RefreshCw, Upload, ChevronDown, ChevronRight, Link } from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { nextId } from '@/utils/id';
import { spansToPlainText } from '@/utils/richText';
import type { TextEl } from '@/types/document';

/* ─── Tipos de valor JSON ─── */

type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

function jsonType(v: unknown): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonType;
}

const TYPE_COLOR: Record<JsonType, { bg: string; text: string; label: string }> = {
  string:  { bg: '#1e3a5f', text: '#60a5fa', label: 'str' },
  number:  { bg: '#14402a', text: '#4ade80', label: 'num' },
  boolean: { bg: '#3b2000', text: '#fb923c', label: 'bool' },
  null:    { bg: '#2a2a2a', text: '#9ca3af', label: 'null' },
  object:  { bg: '#2d1f4e', text: '#c084fc', label: 'obj' },
  array:   { bg: '#1e2a4a', text: '#818cf8', label: 'arr' },
};

/* ─── Nodo recursivo del árbol (schema-only) ─── */

interface NodeProps {
  keyName: string;
  value: unknown;
  path: string;
  depth: number;
  usedPaths: Set<string>;
  onCreate: (path: string) => void;
}

function JsonNode({ keyName, value, path, depth, usedPaths, onCreate }: NodeProps) {
  const type = jsonType(value);
  const isExpandable = type === 'object' || type === 'array';
  const [open, setOpen] = useState(depth < 2);

  const isUsed = usedPaths.has(path);

  /* Schema children — for arrays, use first element as schema sample */
  const entries: [string, unknown][] = (() => {
    if (!isExpandable) return [];
    if (type === 'array') {
      const arr = value as unknown[];
      const first = arr[0];
      if (first !== undefined && typeof first === 'object' && first !== null && !Array.isArray(first))
        return Object.entries(first as Record<string, unknown>);
      if (first !== undefined) return [['item', first]];
      return [];
    }
    return Object.entries(value as Record<string, unknown>);
  })();

  const { bg, text, label } = TYPE_COLOR[type];

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      <div
        draggable
        className="flex items-center h-[24px] gap-1 px-1 rounded group cursor-default select-none hover:bg-bg-3"
        style={{ minWidth: 0 }}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/x-binding-path', path);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => { if (isExpandable) setOpen((o) => !o); }}
        onDoubleClick={(e) => { e.stopPropagation(); onCreate(path); }}
      >
        {/* Expand chevron */}
        <span className="w-3 shrink-0 flex items-center justify-center text-muted">
          {isExpandable
            ? open ? <ChevronDown size={9} /> : <ChevronRight size={9} />
            : null}
        </span>

        {/* Tipo badge */}
        <span
          className="shrink-0 rounded px-1 font-mono text-[9px] leading-none py-0.5"
          style={{ background: bg, color: text }}
        >
          {label}
        </span>

        {/* Key name */}
        <span className="text-11 text-ink-2 shrink-0 font-mono">{keyName}</span>

        <span className="flex-1" />

        {/* Indicador: en uso */}
        {isUsed && (
          <span title={`Variable usada en canvas (${path})`} className="shrink-0">
            <Link size={10} style={{ color: 'var(--accent)' }} />
          </span>
        )}
      </div>

      {/* Hijos */}
      {isExpandable && open && (
        <div style={{ borderLeft: '1px solid var(--line-2)', marginLeft: 6 }}>
          {entries.map(([k, v]) => (
            <JsonNode
              key={k}
              keyName={k}
              value={v}
              path={path ? `${path}.${k}` : k}
              depth={depth + 1}
              usedPaths={usedPaths}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Panel principal ─── */

export default function DataPanel() {
  const jsonData      = useDocumentStore((s) => s.jsonData);
  const jsonFileName  = useDocumentStore((s) => s.jsonFileName);
  const setJsonData   = useDocumentStore((s) => s.setJsonData);
  const pages         = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const addElement = useDocumentStore((s) => s.addElement);
  const fileRef    = useRef<HTMLInputElement>(null);

  const page = pages.find((p) => p.id === currentPageId) ?? pages[0];

  /* Rutas usadas en el canvas (via spans de TextEl) */
  const usedPaths = new Set(
    pages.flatMap((p) =>
      p.elements
        .filter((e) => e.type === 'text')
        .flatMap((e) => (e as TextEl).spans ?? [])
        .map((s) => s.binding)
        .filter((b): b is string => !!b),
    ),
  );

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        setJsonData(parsed, file.name);
      } catch {
        alert('El archivo no es un JSON válido.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleCreate(path: string) {
    if (!page) return;
    const nextZ = page.elements.length > 0
      ? Math.max(...page.elements.map((e) => e.zIndex)) + 1
      : 1;
    const name = path.split('.').pop() ?? path;
    const spans = [{ binding: path, color: '#902774' }];
    const el: TextEl = {
      id: nextId('el'),
      type: 'text',
      name,
      x: 20,
      y: 20,
      width: 60,
      height: 8,
      rotation: 0,
      visible: true,
      locked: false,
      zIndex: nextZ,
      text: spansToPlainText(spans),
      spans,
      fontFamily: 'Helvetica',
      fontSize: 12,
      fontStyle: 'normal',
      fontWeight: 400,
      align: 'left',
      lineHeight: 1.2,
      color: '#000000',
    };
    addElement(page.id, el);
  }

  /* Normaliza: si el JSON es un array toma el primer elemento como muestra de schema */
  const rootEntries: [string, unknown][] = (() => {
    if (jsonData === null) return [];
    if (Array.isArray(jsonData)) {
      const first = (jsonData as unknown[])[0];
      if (first && typeof first === 'object' && !Array.isArray(first))
        return Object.entries(first as Record<string, unknown>);
      return (jsonData as unknown[]).slice(0, 1).map((v, i) => [String(i), v]);
    }
    if (typeof jsonData === 'object')
      return Object.entries(jsonData as Record<string, unknown>);
    return [];
  })();

  const isArray = Array.isArray(jsonData);
  const totalRows = isArray ? (jsonData as unknown[]).length : null;

  return (
    <div className="h-full flex flex-col">

      {/* ── Cabecera de fuente ── */}
      <div
        className="shrink-0 px-3 py-2 flex flex-col gap-2"
        style={{ borderBottom: '1px solid var(--line-2)' }}
      >
        {jsonData ? (
          <>
            <div className="flex items-center gap-2">
              <Database size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="text-11 font-semibold text-ink truncate flex-1" title={jsonFileName ?? ''}>
                {jsonFileName ?? 'datos.json'}
              </span>
              <button
                type="button"
                title="Cargar otro JSON"
                onClick={() => fileRef.current?.click()}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg-3 text-muted shrink-0"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {totalRows !== null && (
              <span className="text-[10px] text-muted">
                Array · {totalRows} {totalRows === 1 ? 'registro' : 'registros'} · mostrando schema del primero
              </span>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-4">
            <Database size={24} className="text-muted" />
            <span className="text-11 text-muted text-center">
              Carga un archivo JSON para<br />mapear datos variables
            </span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-1 h-7 px-3 rounded text-11 font-semibold flex items-center gap-1.5"
              style={{ background: 'var(--accent)', color: '#0b1a10' }}
            >
              <Upload size={12} />
              Cargar JSON
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* ── Hint contextual ── */}
      {jsonData != null && (
        <div
          className="shrink-0 px-3 py-1.5 text-[10px]"
          style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-2)' }}
        >
          <span className="text-muted">
            Doble clic → crea texto con variable · Arrastra sobre un texto del lienzo
          </span>
        </div>
      )}

      {/* ── Árbol JSON (schema) ── */}
      {jsonData != null && (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {rootEntries.map(([k, v]) => (
            <JsonNode
              key={k}
              keyName={k}
              value={v}
              path={k}
              depth={0}
              usedPaths={usedPaths}
              onCreate={handleCreate}
            />
          ))}
        </div>
      )}

    </div>
  );
}
