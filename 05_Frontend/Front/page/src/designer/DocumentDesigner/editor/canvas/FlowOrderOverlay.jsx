// FlowOrderOverlay.jsx — Overlay del modo "Orden de desbordamiento" (Flow Order).
//
// Dibuja la cadena de desbordamiento entre áreas de contenido:
//  · Flecha azul punteada cuando origen y destino están en la MISMA página.
//  · Chip rosa "⇥ p.N" / "⇤ p.M" cuando el enlace cruza a OTRA página (no se
//    puede dibujar una flecha continua entre páginas distintas).
// Con la herramienta activa, además pinta zonas clicables sobre cada área para
// armar el origen, enlazar el destino (clic) o desvincular (clic derecho).

import { mmToPx } from '../../engine/units.js';
import './FlowOrderOverlay.css';

const SAME = '#2563eb';   // azul: enlace intra-página
const SELF = '#7c3aed';   // violeta: auto-desbordamiento (repite página, sigue aquí)

export default function FlowOrderOverlay({ state, elements, zoom }) {
  const toolActive = state.activeTool === 'floworder';
  const showArrows = toolActive || state.showFlowArrowsAlways;
  if (!showArrows) return null;

  const pages  = state.template?.pages ?? [];
  const curIdx = state.currentPageIndex ?? 0;

  // Mapa global de áreas de contenido → { el, pageIdx } (resuelve cross-page).
  const byId = {};
  pages.forEach((p, pi) => (p.elements ?? []).forEach(el => {
    if (el.type === 'contentarea') byId[el.id] = { el, pageIdx: pi };
  }));

  // Orden dentro de cada cadena (solo cadenas de longitud > 1).
  const orderOf = {};
  Object.values(byId).forEach(({ el }) => {
    if (el.previousAreaRef || !el.nextAreaRef) return; // solo cabezas con next
    let cur = el, n = 1, guard = 0;
    while (cur && guard++ < 1000) {
      orderOf[cur.id] = n++;
      cur = cur.nextAreaRef ? byId[cur.nextAreaRef]?.el : null;
    }
  });

  const caEls = (elements ?? []).filter(el => el.type === 'contentarea');
  const box = (el) => ({
    x: mmToPx(el.x, zoom), y: mmToPx(el.y, zoom),
    w: mmToPx(el.width, zoom), h: mmToPx(el.height, zoom),
  });

  const arrows = [];     // flechas intra-página
  const chips  = [];     // chips cross-page
  const selfLoops = [];  // auto-bucles (selfOverflow)
  caEls.forEach(el => {
    if (!el.selfOverflow) return;
    const b = box(el);
    // bucle en el borde derecho: sale por abajo-derecha y vuelve por arriba-derecha
    const x = b.x + b.w, y1 = b.y + b.h * 0.66, y2 = b.y + b.h * 0.34;
    selfLoops.push({ key: `${el.id}-self`, d: `M ${x} ${y1} C ${x + 38} ${y1 + 6}, ${x + 38} ${y2 - 6}, ${x} ${y2}` });
  });
  caEls.forEach(src => {
    if (!src.nextAreaRef) return;
    const tgt = byId[src.nextAreaRef];
    if (!tgt) return;
    const sb = box(src);
    if (tgt.pageIdx === curIdx) {
      const tb = box(tgt.el);
      const x1 = sb.x + sb.w / 2, y1 = sb.y + sb.h;
      const x2 = tb.x + tb.w / 2, y2 = tb.y;
      const dy = Math.max(24, Math.abs(y2 - y1) / 2);
      arrows.push({ key: src.id, d: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}` });
    } else {
      chips.push({ key: `${src.id}-out`, cx: sb.x + sb.w / 2, cy: sb.y + sb.h, place: 'below', label: `⇥ p.${tgt.pageIdx + 1}` });
    }
  });
  // chips entrantes: áreas de esta página cuyo "previous" vive en otra página
  caEls.forEach(dst => {
    if (!dst.previousAreaRef) return;
    const prev = byId[dst.previousAreaRef];
    if (!prev || prev.pageIdx === curIdx) return;
    const db = box(dst);
    chips.push({ key: `${dst.id}-in`, cx: db.x + db.w / 2, cy: db.y, place: 'above', label: `⇤ p.${prev.pageIdx + 1}` });
  });

  return (
    <div className="flo" style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
      <svg className="flo__svg" width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <marker id="flo-arrow" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={SAME} />
          </marker>
          <marker id="flo-arrow-self" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={SELF} />
          </marker>
        </defs>
        {arrows.map(a => (
          <path key={a.key} d={a.d} fill="none" stroke={SAME} strokeWidth="2"
            strokeDasharray="5 3" markerEnd="url(#flo-arrow)" />
        ))}
        {selfLoops.map(s => (
          <path key={s.key} d={s.d} fill="none" stroke={SELF} strokeWidth="2"
            strokeDasharray="5 3" markerEnd="url(#flo-arrow-self)" />
        ))}
      </svg>

      {chips.map(c => (
        <span
          key={c.key}
          className="flo__chip"
          style={{
            left: c.cx, top: c.cy,
            transform: c.place === 'below' ? 'translate(-50%, 4px)' : 'translate(-50%, calc(-100% - 4px))',
          }}
        >
          {c.label}
        </span>
      ))}

      {toolActive && caEls.map(el => {
        const b = box(el);
        const armed = state.floworderSource === el.id;
        const inChain = orderOf[el.id] != null || el.previousAreaRef || el.nextAreaRef;
        const self = !!el.selfOverflow;
        return (
          <div
            key={el.id}
            className={`flo__rect${armed ? ' flo__rect--armed' : ''}${inChain ? ' flo__rect--chain' : ''}${self ? ' flo__rect--self' : ''}`}
            style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, pointerEvents: 'auto' }}
            title={armed ? 'Origen — clic en otra área para enlazar' : 'Clic para encadenar · doble clic = desborda en sí misma · clic derecho para desvincular'}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onClick={(e) => { e.stopPropagation(); state.floworderClickArea?.(el.id); }}
            onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); state.toggleSelfOverflow?.(el.id); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); state.unlinkFlowArea?.(el.id); }}
          >
            {orderOf[el.id] != null && <span className="flo__order">{orderOf[el.id]}</span>}
            {/* Chip ↻: activa/desactiva el auto-desbordamiento (desborda aquí mismo) */}
            <button
              className={`flo__self-chip${self ? ' flo__self-chip--on' : ''}`}
              title={self ? 'Desborda en sí misma (activo) — clic para quitar' : 'Desbordar en esta misma área (repite la página)'}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onClick={(e) => { e.stopPropagation(); state.toggleSelfOverflow?.(el.id); }}
            >↻</button>
          </div>
        );
      })}
    </div>
  );
}
