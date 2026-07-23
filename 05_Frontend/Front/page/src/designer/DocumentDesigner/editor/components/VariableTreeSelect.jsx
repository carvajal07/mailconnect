// VariableTreeSelect.jsx — Selector de variable/campo en ÁRBOL (reutilizable).
//
// Reemplaza los dropdowns planos de paths (difíciles de leer) por un popup con:
//  · jerarquía visual (objeto → array → objeto → campo), expandible
//  · badge de tipo coloreado (Ar, Ob, St, Nm, In, Bo, Dt) a la izquierda
//  · buscador que filtra en plano
// Props: value (path|null), onChange(path|null), fields (lista plana {path,type,label}),
//   placeholder, clearLabel. Devuelve null si no hay campos (oculto).

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import './VariableTreeSelect.css';

// Construye el árbol fusionando el índice de array `[N]`: un array de objetos
// muestra los CAMPOS del item directamente dentro del nodo array (no como un
// hermano `embudo[0]`). El path seleccionable de cada campo conserva el `[0]`
// (convención del back: "para cada item de embudo, el campo etapa").
const stripIndex = (seg) => seg.replace(/\[\d+\]\s*$/, '');

function buildTree(fields) {
  const roots = [];
  const byKey = new Map();
  for (const f of (fields ?? [])) {
    const raw = f.path ?? f.name ?? '';
    if (!raw) continue;
    const parts = raw.split('.');
    let siblings = roots;
    let key = '';
    for (let i = 0; i < parts.length; i++) {
      const seg = stripIndex(parts[i]);
      key = i === 0 ? seg : `${key}.${seg}`;
      const isLeaf = i === parts.length - 1;
      let node = byKey.get(key);
      if (!node) {
        node = { name: seg, key, path: null, type: 'object', children: [] };
        byKey.set(key, node);
        siblings.push(node);
      }
      if (isLeaf) {
        const t = f.type ?? 'string';
        const rawHasIdx = /\[\d+\]/.test(raw);
        if (t === 'array') {                       // el array gana el nodo (tipo + path limpio)
          node.type = 'array';
          if (node.path == null || !rawHasIdx) node.path = raw;
        } else {
          if (node.path == null || !rawHasIdx) node.path = raw;
          if (node.type !== 'array' && node.children.length === 0) node.type = t;
        }
      }
      siblings = node.children;
    }
  }
  for (const node of byKey.values()) if (node.path == null) node.path = node.key;
  return roots;
}

const TYPE_META = {
  string:  { ab: 'St', cls: 'string' },
  number:  { ab: 'Nm', cls: 'number' },
  integer: { ab: 'In', cls: 'number' },
  boolean: { ab: 'Bo', cls: 'boolean' },
  object:  { ab: 'Ob', cls: 'object' },
  array:   { ab: 'Ar', cls: 'array' },
  date:    { ab: 'Dt', cls: 'date' },
  any:     { ab: '··', cls: 'any' },
};
const meta = (t) => TYPE_META[t] ?? TYPE_META.any;

function Badge({ type }) {
  const m = meta(type);
  return <span className={`vts-badge vts-badge--${m.cls}`}>{m.ab}</span>;
}

function TreeRow({ node, depth, onPick, expanded, toggle, selected, ok }) {
  const hasCh = Array.isArray(node.children) && node.children.length > 0;
  const isOpen = expanded.has(node.path);
  const selectable = ok(node.type);
  const onRowClick = () => {
    if (selectable) onPick(node.path);
    else if (hasCh) toggle(node.path);    // contenedor no seleccionable → navegar
  };
  return (
    <>
      <div
        className={`vts-row${selected === node.path ? ' vts-row--sel' : ''}${!selectable && !hasCh ? ' vts-row--disabled' : ''}${!selectable && hasCh ? ' vts-row--nav' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={onRowClick}
        title={selectable ? node.path : `${node.path} (tipo no compatible)`}
      >
        {hasCh
          ? <button className="vts-chev" onClick={(e) => { e.stopPropagation(); toggle(node.path); }}>
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          : <span className="vts-chev vts-chev--spacer" />}
        <Badge type={node.type} />
        <span className="vts-name">{node.name}</span>
      </div>
      {hasCh && isOpen && node.children.map((ch) => (
        <TreeRow key={ch.path} node={ch} depth={depth + 1} onPick={onPick} expanded={expanded} toggle={toggle} selected={selected} ok={ok} />
      ))}
    </>
  );
}

// Etiqueta legible de los tipos aceptados (para el hint del popup).
const TYPE_LABEL = { string: 'texto', date: 'fecha', number: 'número', integer: 'número', array: 'lista', object: 'objeto', boolean: 'sí/no' };
function acceptHint(accept) {
  if (!accept?.length) return null;
  const labels = [...new Set(accept.map((t) => TYPE_LABEL[t] ?? t))];
  return labels.join(' / ');
}

export default function VariableTreeSelect({ value, onChange, fields = [], placeholder = '— fijo —', clearLabel = 'ƒx — fijo —', disabled = false, accept = null }) {
  // accept: array de tipos permitidos (null = todos). Las hojas de otro tipo se
  // muestran deshabilitadas; los contenedores (objeto/array) siguen navegables.
  const ok = useCallback((type) => !accept || accept.includes(type) || type === 'any', [accept]);
  const hint = useMemo(() => acceptHint(accept), [accept]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const triggerRef = useRef(null);
  const popupRef = useRef(null);

  const tree = useMemo(() => buildTree(fields), [fields]);

  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);
  const openPopup = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      // Usa el espacio disponible debajo del trigger (cap 520px); si abajo hay
      // poco y arriba mucho, despliega hacia arriba.
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const flip = below < 240 && above > below;
      const maxH = Math.max(200, Math.min(520, flip ? above : below));
      setPos({
        top: flip ? undefined : Math.round(r.bottom + 4),
        bottom: flip ? Math.round(window.innerHeight - r.top + 4) : undefined,
        left: Math.round(r.left),
        width: Math.max(r.width, 260),
        maxH,
      });
    }
    setExpanded(new Set(tree.map((n) => n.path)));  // expande el primer nivel
    setOpen(true);
  }, [tree]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popupRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      close();
    };
    // Cierra al hacer scroll FUERA del popup (el popup es position:fixed y se
    // desalinearía); el scroll DENTRO del árbol no debe cerrarlo.
    const onScroll = (e) => { if (popupRef.current?.contains(e.target)) return; close(); };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  const toggle = (p) => setExpanded((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const pick = (p) => { onChange(p); close(); };

  const q = query.trim().toLowerCase();
  const flat = useMemo(() => {
    if (!q) return null;
    return fields
      .filter((f) => ok(f.type) && ((f.path || '').toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q)))
      .slice(0, 50);
  }, [q, fields, ok]);

  if (!fields.length) return null;
  const sel = fields.find((f) => f.path === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={`vts-trigger${value ? ' vts-trigger--set' : ''}${disabled ? ' vts-trigger--disabled' : ''}`}
        onClick={() => { if (!disabled) (open ? close() : openPopup()); }}
      >
        <span className="vts-fx">ƒx</span>
        {value
          ? <><Badge type={sel?.type} /><span className="vts-trigger__val">{value}</span></>
          : <span className="vts-trigger__ph">{placeholder}</span>}
        <ChevronDown size={12} className="vts-trigger__arrow" />
      </button>

      {open && pos && createPortal(
        <div ref={popupRef} className="vts-popup" style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxH }}>
          <div className="vts-search">
            <Search size={12} className="vts-search__icon" />
            <input autoFocus placeholder="Buscar campo…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {hint && <span className="vts-search__hint" title="Tipos aceptados">{hint}</span>}
            {value && <button className="vts-search__clear" title="Quitar variable" onClick={() => pick(null)}><X size={12} /></button>}
          </div>
          <button className="vts-row vts-row--clear" onClick={() => pick(null)}>{clearLabel}</button>
          <div className="vts-tree">
            {flat
              ? (flat.length
                  ? flat.map((f) => (
                      <div key={f.path} className={`vts-row${value === f.path ? ' vts-row--sel' : ''}`} onClick={() => pick(f.path)} title={f.path}>
                        <span className="vts-chev vts-chev--spacer" />
                        <Badge type={f.type} />
                        <span className="vts-name">{f.path}</span>
                      </div>
                    ))
                  : <div className="vts-empty">Sin campos compatibles</div>)
              : tree.map((n) => <TreeRow key={n.path} node={n} depth={0} onPick={pick} expanded={expanded} toggle={toggle} selected={value} ok={ok} />)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
