// OverflowFlowMapModal.jsx — Mapa del flujo de DESBORDAMIENTO entre áreas de
// contenido (cadenas previousAreaRef/nextAreaRef). Hermano del mapa de páginas:
// aquí los nodos son áreas de contenido (no páginas) y las aristas son la cadena
// de overflow. Cada nodo lleva un badge con la página donde vive.
//
// Por defecto solo se muestran las áreas ENCADENADAS; el buscador permite revelar
// (añadir al lienzo) áreas sueltas que no participan en ningún desbordamiento.

import { useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Workflow, Search } from 'lucide-react';
import './PageFlowMapModal.css';

const NODE_W  = 168;
const NODE_H  = 54;
const COL_GAP = 240;
const ROW_H   = 80;
const PAD     = 36;

const SAME  = '#2563eb';  // azul: enlace intra-página
const CROSS = '#db2777';  // rosa: enlace entre páginas
const SELF  = '#7c3aed';  // violeta: auto-desbordamiento (sobre sí misma)

function trunc(s, n) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// Etiqueta del área (label del pool, o del elemento, o el id).
function areaLabel(el, pool) {
  const a = (pool ?? []).find(p => p.id === el.areaRef);
  return a?.label || el.label || el.id;
}

// ── Construcción de nodos / aristas ──────────────────────────────────────────

function buildGraph(template) {
  const pages = template?.pages ?? [];
  const pool  = template?.contentAreas ?? [];
  const areas = [];
  pages.forEach((p, pi) => (p.elements ?? []).forEach(el => {
    if (el.type !== 'contentarea') return;
    areas.push({
      id: el.id,
      label: areaLabel(el, pool),
      pageIdx: pi,
      nextId: el.nextAreaRef ?? null,
      prevId: el.previousAreaRef ?? null,
      self: !!el.selfOverflow,
    });
  }));
  const byId = Object.fromEntries(areas.map(a => [a.id, a]));
  // "Encadenada" = participa en algún desbordamiento (a otra área o sobre sí misma).
  const chainedIds = new Set(areas.filter(a =>
    (a.nextId && byId[a.nextId]) || (a.prevId && byId[a.prevId]) || a.self
  ).map(a => a.id));
  return { areas, byId, chainedIds };
}

// Layout por columnas: cabeceras de cadena en col 0, se avanza siguiendo nextId.
function computeLayout(areas, byId, shown) {
  const shownArr = areas.filter(a => shown.has(a.id));
  const colOf = {};
  const starts = shownArr.filter(a => !a.prevId || !shown.has(a.prevId));
  const queue = [];
  const seen = new Set();
  starts.forEach(s => { colOf[s.id] = 0; seen.add(s.id); queue.push(s.id); });
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const cur = queue.shift();
    const nx = byId[cur]?.nextId;
    if (nx && shown.has(nx) && !seen.has(nx)) {
      colOf[nx] = (colOf[cur] ?? 0) + 1;
      seen.add(nx);
      queue.push(nx);
    }
  }
  shownArr.forEach(a => { if (colOf[a.id] == null) colOf[a.id] = 0; });

  const colRow = {};
  const pos = {};
  shownArr.forEach(a => {
    const c = colOf[a.id];
    const r = colRow[c] ?? 0;
    colRow[c] = r + 1;
    pos[a.id] = { x: PAD + c * COL_GAP, y: PAD + r * ROW_H };
  });
  return pos;
}

// ── SVG: arista ──────────────────────────────────────────────────────────────

function SvgEdge({ from, to, cross, pos }) {
  const fp = pos[from], tp = pos[to];
  if (!fp || !tp) return null;
  const x1 = fp.x + NODE_W, y1 = fp.y + NODE_H / 2;
  const x2 = tp.x,          y2 = tp.y + NODE_H / 2;
  const back = tp.x <= fp.x;
  let d;
  if (back) {
    const arcY = Math.min(fp.y, tp.y) - 38;
    d = `M ${x1} ${y1} C ${x1 + 50} ${arcY}, ${x2 - 50} ${arcY}, ${x2} ${y2}`;
  } else {
    const mx = (x1 + x2) / 2;
    d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  const color = cross ? CROSS : SAME;
  return (
    <path d={d} fill="none" stroke={color} strokeWidth={1.8}
      strokeDasharray="5 3" markerEnd={`url(#ofm-arrow-${cross ? 'cross' : 'same'})`} />
  );
}

// ── SVG: nodo ────────────────────────────────────────────────────────────────

function SvgNode({ node, pos, chained, onDragStart }) {
  const p = pos[node.id];
  if (!p) return null;
  const fill   = chained ? '#eff6ff' : '#f8fafc';
  const stroke = chained ? '#93c5fd' : '#cbd5e1';
  return (
    <g transform={`translate(${p.x}, ${p.y})`} style={{ cursor: 'grab' }}
       onMouseDown={e => onDragStart(e, node.id)}>
      <title>{node.label} · página {node.pageIdx + 1}{chained ? '' : ' (sin desbordamiento)'}</title>
      <rect width={NODE_W} height={NODE_H} rx={7} fill={fill} stroke={stroke}
        strokeWidth={1.5} strokeDasharray={chained ? undefined : '4 3'} />
      <text x={12} y={chained ? 22 : NODE_H / 2 + 4} fontSize={11} fontWeight={600}
        fill="#1e293b" fontFamily="system-ui">{trunc(node.label, 20)}</text>
      {chained && (
        <text x={12} y={38} fontSize={9} fill={node.self ? '#7c3aed' : '#64748b'} fontFamily="system-ui">
          {node.self
            ? '↻ desborda aquí mismo'
            : `${node.prevId ? 'continúa…' : 'inicio'}${node.nextId ? ' →' : ''}`}
        </text>
      )}
      {/* Badge de página (esquina sup. derecha) */}
      <g>
        <rect x={NODE_W - 34} y={5} width={29} height={15} rx={3} fill="#1e293b" />
        <text x={NODE_W - 19.5} y={15.5} textAnchor="middle" fontSize={9} fill="#fff"
          fontFamily="system-ui" fontWeight={600}>p.{node.pageIdx + 1}</text>
      </g>
    </g>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

export default function OverflowFlowMapModal({ template, onClose }) {
  const { areas, byId, chainedIds } = useMemo(() => buildGraph(template), [template]);

  // Áreas reveladas a mano vía el buscador (no encadenadas).
  const [extraIds, setExtraIds] = useState(() => new Set());
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const s = new Set(chainedIds);
    extraIds.forEach(id => s.add(id));
    return s;
  }, [chainedIds, extraIds]);

  const initPos = useMemo(() => computeLayout(areas, byId, shown), [areas, byId, shown]);
  // Solo guardamos las posiciones ARRASTRADAS; las demás salen de initPos. Así
  // añadir áreas desde el buscador no requiere re-sincronizar estado en render.
  const [overrides, setOverrides] = useState({});
  const pos = useMemo(() => {
    const m = { ...initPos };
    for (const id of Object.keys(overrides)) if (m[id]) m[id] = overrides[id];
    return m;
  }, [initPos, overrides]);

  const drag = useRef(null);
  const svgRef = useRef(null);
  const toSvgPt = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: e.clientX, y: e.clientY };
  }, []);
  const handleDragStart = useCallback((e, nodeId) => {
    e.stopPropagation(); e.preventDefault();
    const { x, y } = toSvgPt(e);
    drag.current = { nodeId, sx: x, sy: y, ox: pos[nodeId]?.x ?? 0, oy: pos[nodeId]?.y ?? 0 };
  }, [pos, toSvgPt]);
  const handleMouseMove = useCallback((e) => {
    if (!drag.current) return;
    const { x, y } = toSvgPt(e);
    const { nodeId, sx, sy, ox, oy } = drag.current;
    setOverrides(prev => ({ ...prev, [nodeId]: { x: ox + (x - sx), y: oy + (y - sy) } }));
  }, [toSvgPt]);
  const stopDrag = useCallback(() => { drag.current = null; }, []);

  // Resultados del buscador: áreas NO mostradas que casan con la query.
  const q = query.trim().toLowerCase();
  const results = q
    ? areas.filter(a => !shown.has(a.id) &&
        (a.label.toLowerCase().includes(q) || `p.${a.pageIdx + 1}`.includes(q)))
        .slice(0, 12)
    : [];

  const edges = areas
    .filter(a => a.nextId && byId[a.nextId] && shown.has(a.id) && shown.has(a.nextId))
    .map(a => ({ from: a.id, to: a.nextId, cross: a.pageIdx !== byId[a.nextId].pageIdx }));
  const selfLoops = areas.filter(a => a.self && shown.has(a.id));

  const posVals = Object.values(pos);
  const dynW = Math.max(640, ...posVals.map(p => p.x + NODE_W + PAD));
  const dynH = Math.max(300, ...posVals.map(p => p.y + NODE_H + PAD));

  const shownCount = shown.size;
  const totalCount = areas.length;

  return createPortal(
    <div className="pfm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pfm-modal">
        <div className="pfm-header">
          <Workflow size={14} className="pfm-header__icon" />
          <span className="pfm-header__title">Mapa de flujo de desbordamiento</span>

          {/* Buscador para revelar áreas sueltas */}
          <div className="pfm-search">
            <Search size={12} className="pfm-search__icon" />
            <input
              className="pfm-search__input"
              placeholder="Buscar área (incluye sueltas)…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {results.length > 0 && (
              <div className="pfm-search__results">
                {results.map(a => (
                  <button key={a.id} className="pfm-search__item"
                    onClick={() => { setExtraIds(prev => new Set(prev).add(a.id)); setQuery(''); }}>
                    <span>{trunc(a.label, 24)}</span>
                    <span className="pfm-search__badge">p.{a.pageIdx + 1}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="pfm-hint">{shownCount}/{totalCount} áreas · arrastra para reorganizar</span>
          <button className="pfm-close" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="pfm-body">
          {shownCount === 0 ? (
            <div className="pfm-empty">
              No hay áreas encadenadas. Usa la herramienta «Orden de desbordamiento»
              en el canvas para encadenar áreas, o búscalas arriba para verlas aquí.
            </div>
          ) : (
            <svg ref={svgRef} width={dynW} height={dynH}
              style={{ display: 'block', userSelect: 'none' }}
              onMouseMove={handleMouseMove} onMouseUp={stopDrag} onMouseLeave={stopDrag}>
              <defs>
                <marker id="ofm-arrow-same" markerWidth={8} markerHeight={8} refX={7} refY={3} orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill={SAME} />
                </marker>
                <marker id="ofm-arrow-cross" markerWidth={8} markerHeight={8} refX={7} refY={3} orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill={CROSS} />
                </marker>
                <marker id="ofm-arrow-self" markerWidth={8} markerHeight={8} refX={7} refY={3} orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill={SELF} />
                </marker>
              </defs>
              {edges.map((e, i) => <SvgEdge key={i} {...e} pos={pos} />)}
              {selfLoops.map(a => {
                const p = pos[a.id];
                if (!p) return null;
                const x1 = p.x + NODE_W * 0.66, x2 = p.x + NODE_W * 0.34, y = p.y;
                return (
                  <path key={`${a.id}-self`}
                    d={`M ${x1} ${y} C ${x1} ${y - 32}, ${x2} ${y - 32}, ${x2} ${y}`}
                    fill="none" stroke={SELF} strokeWidth={1.8} strokeDasharray="5 3"
                    markerEnd="url(#ofm-arrow-self)" />
                );
              })}
              {areas.filter(a => shown.has(a.id)).map(a => (
                <SvgNode key={a.id} node={a} pos={pos} chained={chainedIds.has(a.id)} onDragStart={handleDragStart} />
              ))}
            </svg>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
