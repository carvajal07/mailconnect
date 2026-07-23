// PageFlowMapModal.jsx — Mapa interactivo del flujo entre páginas
import { useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, GitBranch } from 'lucide-react';
import './PageFlowMapModal.css';

const NODE_W  = 164;
const NODE_H  = 58;
const COL_GAP = 250;
const ROW_H   = 84;
const PAD     = 36;

// ── Helpers ────────────────────────────────────────────────────────────────

function trunc(s, n) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function clauseSummary(rule) {
  if (!rule) return '';
  if (rule.conditionType === 'script') return '{ script }';
  const clauses = rule.expression?.clauses ?? [];
  if (!clauses.length) return '?';
  const c   = clauses[0];
  const lft = c.left?.path  || c.left?.value  || '?';
  const op  = (c.operator || '?').replace(/_/g, ' ');
  const rgt = String(c.right?.value ?? c.right?.path ?? '?');
  const extra = clauses.length > 1 ? ` +${clauses.length - 1}` : '';
  return trunc(`${lft} ${op} ${rgt}${extra}`, 26);
}

function clauseFull(rule) {
  if (!rule) return '';
  if (rule.conditionType === 'script') return 'Script personalizado';
  const clauses = rule.expression?.clauses ?? [];
  return clauses.map(c => {
    const lft = c.left?.path  || c.left?.value  || '?';
    const op  = (c.operator || '?').replace(/_/g, ' ');
    const rgt = String(c.right?.value ?? c.right?.path ?? '?');
    return `${lft} ${op} ${rgt}`;
  }).join(' AND ');
}

// ── Build edges ────────────────────────────────────────────────────────────

function buildEdges(template) {
  const pages  = template.pages ?? [];
  const pc     = template.pagesConfig ?? {};
  const ts     = pc.typeSelection ?? {};
  const tsType = ts.type ?? 'simple';
  const edges  = [];

  function addEdge(from, to, opts = {}) {
    edges.push({ from, to, label: '', tooltip: '', ...opts });
  }

  // pagesConfig → entry pages
  if (pc.pageSelection !== 'variable_data') {
    const entryId = pc.startPageId ?? pages[0]?.id;
    if (entryId) addEdge('__pc__', entryId);
  } else {
    if (tsType === 'simple') {
      const entryId = ts.pageId ?? pages[0]?.id;
      if (entryId) addEdge('__pc__', entryId);
    } else if (tsType === 'text' || tsType === 'number') {
      for (const m of ts.mappings ?? []) {
        if (m.pageId) addEdge('__pc__', m.pageId, {
          label:   trunc(String(m.value ?? '?'), 14),
          tooltip: `${ts.variable ?? '?'} = ${m.value ?? '?'}`,
        });
      }
      if (ts.defaultPageId) addEdge('__pc__', ts.defaultPageId, { label: 'default', isDefault: true });
    } else if (tsType === 'bool') {
      if (ts.truePageId)  addEdge('__pc__', ts.truePageId,  { label: 'true'  });
      if (ts.falsePageId) addEdge('__pc__', ts.falsePageId, { label: 'false' });
    } else if (tsType === 'condition') {
      for (const r of ts.rules ?? []) {
        if (r.pageId) addEdge('__pc__', r.pageId, {
          label:      clauseSummary(r),
          tooltip:    clauseFull(r),
          isCondition: true,
        });
      }
      if (ts.defaultPageId) addEdge('__pc__', ts.defaultPageId, { label: 'default', isDefault: true });
    } else if (tsType === 'script') {
      addEdge('__pc__', null, { label: 'script', dynamic: true });
    }
  }

  // page → pages via pageFlow
  for (const p of pages) {
    const pf     = p.pageFlow ?? {};
    const pfType = pf.type ?? 'none';

    if (pfType === 'simple' && pf.pageId) {
      addEdge(p.id, pf.pageId);
    } else if (pfType === 'text' || pfType === 'integer') {
      for (const m of pf.mappings ?? []) {
        if (m.pageId) addEdge(p.id, m.pageId, {
          label:   trunc(String(m.value ?? '?'), 14),
          tooltip: `${pf.variable ?? '?'} = ${m.value ?? '?'}`,
        });
      }
      if (pf.defaultPageId) addEdge(p.id, pf.defaultPageId, { label: 'default', isDefault: true });
    } else if (pfType === 'condition') {
      for (const r of pf.rules ?? []) {
        if (r.pageId) addEdge(p.id, r.pageId, {
          label:      clauseSummary(r),
          tooltip:    clauseFull(r),
          isCondition: true,
        });
      }
      if (pf.defaultPageId) addEdge(p.id, pf.defaultPageId, { label: 'default', isDefault: true });
    } else if (pfType === 'script') {
      addEdge(p.id, null, { label: 'script', dynamic: true });
    }
  }

  return edges;
}

// ── Layout (BFS) ───────────────────────────────────────────────────────────

function computeLayout(template) {
  const pages  = template.pages ?? [];
  const pc     = template.pagesConfig ?? {};
  const ts     = pc.typeSelection ?? {};
  const edges  = buildEdges(template);
  const allIds = ['__pc__', ...pages.map(p => p.id)];

  const adj = {};
  for (const id of allIds) adj[id] = [];
  for (const e of edges) {
    if (e.from && e.to && adj[e.from] && allIds.includes(e.to)) {
      if (!adj[e.from].includes(e.to)) adj[e.from].push(e.to);
    }
  }

  const colOf = { '__pc__': 0 };
  const queue = ['__pc__'];
  const seen  = new Set(['__pc__']);
  while (queue.length) {
    const cur = queue.shift();
    for (const nxt of adj[cur]) {
      if (!seen.has(nxt)) {
        seen.add(nxt);
        colOf[nxt] = (colOf[cur] ?? 0) + 1;
        queue.push(nxt);
      }
    }
  }

  const maxCol = Math.max(0, ...Object.values(colOf));
  for (const id of allIds) {
    if (colOf[id] === undefined) colOf[id] = maxCol + 1;
  }

  const colRowCount = {};
  const rowOf = {};
  for (const id of allIds) {
    const c = colOf[id];
    rowOf[id] = colRowCount[c] ?? 0;
    colRowCount[c] = (colRowCount[c] ?? 0) + 1;
  }

  const initPos = {};
  for (const id of allIds) {
    initPos[id] = { x: PAD + colOf[id] * COL_GAP, y: PAD + rowOf[id] * ROW_H };
  }

  // Node descriptors
  const nodeMap = {
    '__pc__': {
      id:       '__pc__',
      label:    'Pages Config',
      isRoot:   true,
      flowType: pc.pageSelection === 'variable_data' ? (ts.type ?? 'simple') : 'simple',
      isOrphan: false,
      repeat:   pc.repeatedBy?.enabled ? (pc.repeatedBy.variable ?? '↻') : null,
      variable: pc.pageSelection === 'variable_data' &&
                ['text','number','bool'].includes(ts.type)
                ? (ts.variable ?? '') : null,
    },
  };

  for (const p of pages) {
    const pf     = p.pageFlow ?? {};
    const pfType = pf.type ?? 'none';
    nodeMap[p.id] = {
      id:       p.id,
      label:    p.name,
      isRoot:   false,
      flowType: pfType,
      isOrphan: !seen.has(p.id),
      repeat:   null,
      variable: ['text','integer'].includes(pfType) ? (pf.variable ?? '') : null,
    };
  }

  const allPos  = Object.values(initPos);
  const canvasW = Math.max(640, Math.max(...allPos.map(p => p.x)) + NODE_W + PAD * 2);
  const canvasH = Math.max(300, Math.max(...allPos.map(p => p.y)) + NODE_H + PAD * 2);

  return { nodes: Object.values(nodeMap), edges, initPos, canvasW, canvasH };
}

// ── SVG: Edge ─────────────────────────────────────────────────────────────

function SvgEdge({ edge, pos }) {
  const fp = pos[edge.from];
  const tp = edge.to ? pos[edge.to] : null;
  if (!fp) return null;

  const x1 = fp.x + NODE_W;
  const y1 = fp.y + NODE_H / 2;

  // Script / dynamic: dashed stub
  if (edge.dynamic || !tp) {
    return (
      <g>
        <line x1={x1} y1={y1} x2={x1 + 48} y2={y1}
          stroke="#d1d5db" strokeWidth={1.5} strokeDasharray="4 3"
          markerEnd="url(#pfm-arrow)" />
        <text x={x1 + 52} y={y1 + 4} fontSize={9} fill="#9ca3af" fontFamily="system-ui">script</text>
      </g>
    );
  }

  const x2 = tp.x;
  const y2 = tp.y + NODE_H / 2;
  const isBack = tp.x <= fp.x;

  let d;
  if (isBack) {
    const arcY = Math.min(fp.y, tp.y) - 40;
    d = `M ${x1} ${y1} C ${x1 + 55} ${arcY}, ${x2 - 55} ${arcY}, ${x2} ${y2}`;
  } else {
    const mx = (x1 + x2) / 2;
    d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }

  const lx = (x1 + x2) / 2;
  const ly = isBack ? Math.min(fp.y, tp.y) - 46 : (y1 + y2) / 2 - 8;

  const color = edge.isDefault   ? '#d97706'
              : edge.isCondition ? '#7c3aed'
              : '#64748b';

  const lbl  = edge.label;
  const lblW = lbl ? Math.min(lbl.length * 6.2 + 12, 160) : 0;

  return (
    <g>
      {edge.tooltip && <title>{edge.tooltip}</title>}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} markerEnd="url(#pfm-arrow)" />
      {lbl && (
        <>
          <rect x={lx - lblW / 2} y={ly - 10} width={lblW} height={14}
            rx={3} fill="white" stroke={color} strokeWidth={0.5} opacity={0.92} />
          <text x={lx} y={ly} textAnchor="middle" fontSize={9} fill={color}
            fontFamily="system-ui" fontWeight={500}>
            {lbl}
          </text>
        </>
      )}
    </g>
  );
}

// ── SVG: Node ─────────────────────────────────────────────────────────────

const FLOW_FILL = {
  none:      '#f8fafc',
  simple:    '#f0f9ff',
  text:      '#f0fdf4',
  integer:   '#fffbeb',
  condition: '#faf5ff',
  script:    '#fdf4ff',
  bool:      '#fefce8',
};
const FLOW_STROKE = {
  none:      '#e2e8f0',
  simple:    '#7dd3fc',
  text:      '#86efac',
  integer:   '#fcd34d',
  condition: '#c4b5fd',
  script:    '#e879f9',
  bool:      '#fde047',
};

function SvgNode({ node, pos, onDragStart }) {
  const p = pos[node.id];
  if (!p) return null;

  const fill   = node.isRoot   ? '#dbeafe'
               : node.isOrphan ? '#fee2e2'
               : (FLOW_FILL[node.flowType] ?? '#f8fafc');
  const stroke = node.isRoot   ? '#3b82f6'
               : node.isOrphan ? '#fca5a5'
               : (FLOW_STROKE[node.flowType] ?? '#e2e8f0');
  const sw     = node.isRoot ? 2 : 1.5;
  const tc     = node.isRoot ? '#1d4ed8' : '#1e293b';

  const lbl = trunc(node.label, 18);

  // Subtitle line
  let sub = '';
  if (node.isOrphan)   sub = 'sin conexión';
  else if (node.variable) sub = `→ ${trunc(node.variable, 18)}`;
  else if (!node.isRoot && node.flowType && !['none','simple'].includes(node.flowType))
    sub = node.flowType;

  const titleY = sub ? 21 : NODE_H / 2 + 4;

  return (
    <g
      transform={`translate(${p.x}, ${p.y})`}
      style={{ cursor: 'grab' }}
      onMouseDown={e => onDragStart(e, node.id)}
    >
      <title>{node.label}{node.variable ? `\nVariable: ${node.variable}` : ''}{node.repeat ? `\nRepite: ${node.repeat}` : ''}</title>

      <rect width={NODE_W} height={NODE_H} rx={7}
        fill={fill} stroke={stroke} strokeWidth={sw} />

      {/* Label */}
      <text x={NODE_W / 2} y={titleY} textAnchor="middle"
        fontSize={11} fontWeight={node.isRoot ? 700 : 600} fill={tc} fontFamily="system-ui">
        {lbl}
      </text>

      {/* Subtitle */}
      {sub && (
        <text x={NODE_W / 2} y={38} textAnchor="middle" fontSize={9}
          fill={node.isOrphan ? '#ef4444' : '#64748b'} fontFamily="system-ui">
          {sub}
        </text>
      )}

      {/* Repeat badge (top-right) */}
      {node.repeat && (
        <g>
          <rect x={NODE_W - 22} y={3} width={19} height={14} rx={3} fill="#059669" />
          <text x={NODE_W - 12.5} y={13} textAnchor="middle" fontSize={9}
            fill="white" fontFamily="system-ui" fontWeight={600}>↻</text>
          <title>Repite por: {node.repeat}</title>
        </g>
      )}
    </g>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

const LEGEND = [
  { label: 'Entry',        fill: '#dbeafe', border: '#3b82f6' },
  { label: 'Condición',    fill: '#faf5ff', border: '#c4b5fd' },
  { label: 'Script',       fill: '#fdf4ff', border: '#e879f9' },
  { label: '↻ Repeat',     fill: '#d1fae5', border: '#6ee7b7' },
  { label: 'Sin conexión', fill: '#fee2e2', border: '#fca5a5' },
];

export default function PageFlowMapModal({ template, onClose }) {
  const { nodes, edges, initPos, canvasW, canvasH } = useMemo(
    () => computeLayout(template),
    [template]
  );

  // Draggable positions
  const [pos, setPos] = useState(() => ({ ...initPos }));
  const drag  = useRef(null);
  const svgRef = useRef(null);

  const toSvgPt = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: e.clientX, y: e.clientY };
  }, []);

  const handleDragStart = useCallback((e, nodeId) => {
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = toSvgPt(e);
    drag.current = {
      nodeId,
      sx: x, sy: y,
      ox: pos[nodeId]?.x ?? 0,
      oy: pos[nodeId]?.y ?? 0,
    };
  }, [pos, toSvgPt]);

  const handleMouseMove = useCallback((e) => {
    if (!drag.current) return;
    const { x, y } = toSvgPt(e);
    const { nodeId, sx, sy, ox, oy } = drag.current;
    setPos(prev => ({
      ...prev,
      [nodeId]: { x: ox + (x - sx), y: oy + (y - sy) },
    }));
  }, [toSvgPt]);

  const stopDrag = useCallback(() => { drag.current = null; }, []);

  // Recalc canvas size from current positions
  const posVals = Object.values(pos);
  const dynW = Math.max(canvasW, ...posVals.map(p => p.x + NODE_W + PAD));
  const dynH = Math.max(canvasH, ...posVals.map(p => p.y + NODE_H + PAD));

  return createPortal(
    <div
      className="pfm-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="pfm-modal">
        {/* Header */}
        <div className="pfm-header">
          <GitBranch size={14} className="pfm-header__icon" />
          <span className="pfm-header__title">Mapa de flujo de páginas</span>
          <div className="pfm-legend">
            {LEGEND.map(({ label, fill, border }) => (
              <span key={label} className="pfm-legend__item">
                <span className="pfm-legend__dot" style={{ background: fill, border: `1.5px solid ${border}` }} />
                {label}
              </span>
            ))}
          </div>
          <span className="pfm-hint">Arrastra nodos para reorganizar</span>
          <button className="pfm-close" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Canvas */}
        <div className="pfm-body">
          <svg
            ref={svgRef}
            width={dynW}
            height={dynH}
            style={{ display: 'block', userSelect: 'none' }}
            onMouseMove={handleMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={stopDrag}
          >
            <defs>
              <marker id="pfm-arrow" markerWidth={8} markerHeight={8}
                refX={7} refY={3} orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
              </marker>
            </defs>

            {/* Edges first */}
            {edges.map((e, i) => <SvgEdge key={i} edge={e} pos={pos} />)}
            {/* Nodes on top */}
            {nodes.map(n => (
              <SvgNode key={n.id} node={n} pos={pos} onDragStart={handleDragStart} />
            ))}
          </svg>
        </div>
      </div>
    </div>,
    document.body
  );
}
