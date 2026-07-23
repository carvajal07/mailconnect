// editor/canvas/ElementWrapper.jsx — Drag, resize, select wrapper for canvas elements

import { useRef, useCallback, useState } from 'react';
import { mmToPx, pxToMm } from '../../engine/units.js';
import './ElementWrapper.css';

const HANDLE_SIZE = 7; // px
const MIN_SIZE_MM  = 3;
const DRAG_THRESHOLD = 4; // px — minimum movement before drag starts

const HANDLES = [
  { id: 'nw', cx: 0,   cy: 0,   cursor: 'nw-resize' },
  { id: 'n',  cx: 0.5, cy: 0,   cursor: 'n-resize'  },
  { id: 'ne', cx: 1,   cy: 0,   cursor: 'ne-resize' },
  { id: 'e',  cx: 1,   cy: 0.5, cursor: 'e-resize'  },
  { id: 'se', cx: 1,   cy: 1,   cursor: 'se-resize' },
  { id: 's',  cx: 0.5, cy: 1,   cursor: 's-resize'  },
  { id: 'sw', cx: 0,   cy: 1,   cursor: 'sw-resize' },
  { id: 'w',  cx: 0,   cy: 0.5, cursor: 'w-resize'  },
];

function buildTransform(el) {
  const parts = [];
  if (el.rotation) parts.push(`rotate(${el.rotation}deg)`);
  const sx = el.scaleX ?? 1;
  const sy = el.scaleY ?? 1;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.length ? parts.join(' ') : undefined;
}

export default function ElementWrapper({
  element,
  zoom,
  selected,
  selectedCount = 1,
  dragOffset = null,        // { dx, dy } en mm: preview en vivo del drag de grupo
  onSelect,
  onUpdate,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  onContextMenu,
  onDoubleClick,
  children,
}) {
  const elRef   = useRef(null);
  const dragRef = useRef(null);  // { startX, startY, origX, origY, dragging }
  const resRef  = useRef(null);  // { handle, startX, startY, orig{x,y,w,h} }

  // liveEl holds the in-progress position/size during drag or resize.
  // Only this wrapper re-renders on every frame instead of the whole canvas.
  const [liveEl, setLiveEl] = useState(null);

  // Hover-to-resize: content areas show resize handles on hover (even when not
  // selected) because their inner content (e.g. a table) swallows clicks via
  // stopPropagation, which otherwise prevents the area from ever being selected.
  // Scoped to 'contentarea' only — every other element type keeps prior behavior.
  const [hovered, setHovered] = useState(false);
  const isContentArea = element.type === 'contentarea';
  const hoverHandles  = hovered && isContentArea && !element.locked;

  // Durante un drag de grupo este wrapper no usa liveEl local: se desplaza por
  // el `dragOffset` (mm) que comparte DesignCanvas con todos los seleccionados.
  const eff = liveEl ?? (dragOffset
    ? { ...element, x: element.x + dragOffset.dx, y: element.y + dragOffset.dy }
    : element);
  const xPx = mmToPx(eff.x, zoom);
  const yPx = mmToPx(eff.y, zoom);
  const wPx = mmToPx(eff.width,  zoom);
  const hPx = mmToPx(eff.height, zoom);

  // ── Move (with drag threshold so double-click works reliably) ───────────
  const onMoveMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (element.locked) return;
    e.stopPropagation();

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    // Es un movimiento de GRUPO (mover todos los seleccionados juntos) cuando el
    // elemento ya está seleccionado dentro de una multiselección y no hay
    // modificador. Importante: en ese caso NO tocamos la selección en mousedown
    // (si la colapsáramos a este elemento, se "deseleccionarían" los demás y solo
    // se movería uno — que era justo el bug).
    const isGroup = !additive && selected && selectedCount > 1;
    if (additive) {
      onSelect(element.id, true);             // toggle dentro de la selección
    } else if (!selected) {
      onSelect(element.id, false);            // seleccionar solo este
    }
    // (selected && !additive: dejamos la selección intacta para conservar el grupo)

    // ── Drag de GRUPO: el preview en vivo lo coordina DesignCanvas ──
    if (isGroup) {
      onGroupDragStart?.();
      const g = { startX: e.clientX, startY: e.clientY, dragging: false };

      function onMouseMove(me) {
        const dxPx = me.clientX - g.startX;
        const dyPx = me.clientY - g.startY;
        if (!g.dragging) {
          if (Math.abs(dxPx) < DRAG_THRESHOLD && Math.abs(dyPx) < DRAG_THRESHOLD) return;
          g.dragging = true;
        }
        onGroupDragMove?.(pxToMm(dxPx, zoom), pxToMm(dyPx, zoom));
      }
      function onMouseUp(me) {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup',   onMouseUp);
        if (g.dragging) {
          onGroupDragEnd?.(pxToMm(me.clientX - g.startX, zoom), pxToMm(me.clientY - g.startY, zoom));
        } else {
          // Click sin arrastrar sobre un miembro del grupo → colapsa a solo este.
          onSelect(element.id, false);
        }
      }
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup',   onMouseUp);
      return;
    }

    // ── Drag de UN solo elemento (preview local con liveEl) ──
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX:  element.x,
      origY:  element.y,
      dragging: false, // becomes true after threshold is exceeded
    };

    function onMouseMove(me) {
      if (!dragRef.current) return;
      const { startX, startY, origX, origY, dragging } = dragRef.current;
      const dxPx = me.clientX - startX;
      const dyPx = me.clientY - startY;

      // Don't start moving until the mouse has moved beyond the threshold
      if (!dragging) {
        if (Math.abs(dxPx) < DRAG_THRESHOLD && Math.abs(dyPx) < DRAG_THRESHOLD) return;
        dragRef.current.dragging = true;
      }

      const dx = pxToMm(dxPx, zoom);
      const dy = pxToMm(dyPx, zoom);
      const newX = Math.max(0, origX + dx);
      const newY = Math.max(0, origY + dy);
      dragRef.current.final = { x: newX, y: newY };
      setLiveEl({ ...element, x: newX, y: newY });
    }

    function onMouseUp() {
      if (dragRef.current?.dragging && dragRef.current.final) {
        onUpdate(dragRef.current.final);
      }
      setLiveEl(null);
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
  }, [element, zoom, selected, selectedCount, onSelect, onUpdate,
      onGroupDragStart, onGroupDragMove, onGroupDragEnd]);

  // ── Resize ──────────────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e, handle) => {
    if (e.button !== 0) return;
    if (element.locked) return;
    e.stopPropagation();
    e.preventDefault();

    // Resizing via a hover handle on an unselected element (content area):
    // select it too so the right-hand properties panel reflects it.
    if (!selected) onSelect(element.id, false);

    resRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: element.x, y: element.y, w: element.width, h: element.height },
    };

    function onMouseMove(me) {
      if (!resRef.current) return;
      const { handle: h, startX, startY, orig } = resRef.current;
      const dxMm = pxToMm(me.clientX - startX, zoom);
      const dyMm = pxToMm(me.clientY - startY, zoom);

      let { x, y, w, h: ht } = { x: orig.x, y: orig.y, w: orig.w, h: orig.h };

      if (h.includes('e')) w = Math.max(MIN_SIZE_MM, orig.w + dxMm);
      if (h.includes('w')) { w = Math.max(MIN_SIZE_MM, orig.w - dxMm); x = orig.x + orig.w - w; }
      if (h.includes('s')) ht = Math.max(MIN_SIZE_MM, orig.h + dyMm);
      if (h.includes('n')) { ht = Math.max(MIN_SIZE_MM, orig.h - dyMm); y = orig.y + orig.h - ht; }

      resRef.current.final = { x, y, width: w, height: ht };
      setLiveEl({ ...element, x, y, width: w, height: ht });
    }

    function onMouseUp() {
      if (resRef.current?.final) {
        onUpdate(resRef.current.final);
      }
      setLiveEl(null);
      resRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
  }, [element, zoom, onUpdate, onSelect, selected]);

  // ── Context menu ────────────────────────────────────────────────────────
  const onRightClick = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(element.id, false);
    onContextMenu?.(e, element.id);
  }, [element, onSelect, onContextMenu]);

  const shearAngle = eff.shearX ?? 0;
  let shearSelectionSvg = null;
  if (selected && shearAngle !== 0) {
    const rawDx = Math.abs(Math.tan((shearAngle * Math.PI) / 180) * hPx);
    const dx    = Math.min(rawDx, wPx * 0.92);
    // Top edge fixed (both corners stay). Bottom shifts: positive→left, negative→right.
    const pts   = shearAngle > 0
      ? `0,0 ${wPx.toFixed(1)},0 ${(wPx - dx).toFixed(1)},${hPx.toFixed(1)} ${(-dx).toFixed(1)},${hPx.toFixed(1)}`
      : `0,0 ${wPx.toFixed(1)},0 ${(wPx + dx).toFixed(1)},${hPx.toFixed(1)} ${dx.toFixed(1)},${hPx.toFixed(1)}`;
    shearSelectionSvg = (
      <svg
        viewBox={`0 0 ${wPx.toFixed(0)} ${hPx.toFixed(0)}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                 overflow: 'visible', pointerEvents: 'none', zIndex: 5 }}
      >
        <polygon
          points={pts}
          fill="none"
          stroke="var(--color-node-design, #3b82f6)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const style = {
    position: 'absolute',
    left:   xPx,
    top:    yPx,
    width:  wPx,
    height: hPx,
    transform: buildTransform(element),
    cursor: element.locked ? 'default' : 'move',
    outline: selected && shearAngle === 0 ? '2px solid var(--color-node-design, #3b82f6)' : undefined,
    boxSizing: 'border-box',
    userSelect: 'none',
  };

  // Allow variable drag-and-drop to pass through to children (ContentAreaElement)
  const onWrapperDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('text/x-variable-path')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  return (
    <div
      ref={elRef}
      className={`ew${selected ? ' ew--selected' : ''}${!selected && hoverHandles ? ' ew--hover-resizable' : ''}${element.locked ? ' ew--locked' : ''}`}
      style={style}
      onMouseDown={onMoveMouseDown}
      onMouseEnter={isContentArea ? () => setHovered(true)  : undefined}
      onMouseLeave={isContentArea ? () => setHovered(false) : undefined}
      onContextMenu={onRightClick}
      onDoubleClick={onDoubleClick ? (e) => { e.stopPropagation(); onDoubleClick(e); } : undefined}
      onDragOver={onWrapperDragOver}
    >
      {/* element content */}
      {children}

      {/* shear selection indicator — parallelogram outline when shear is active */}
      {shearSelectionSvg}

      {/* resize handles — when selected, or on hover for content areas */}
      {(selected || hoverHandles) && !element.locked && HANDLES.map(handle => (
        <div
          key={handle.id}
          className="ew__handle"
          style={{
            position: 'absolute',
            left:   handle.cx * wPx - HANDLE_SIZE / 2,
            top:    handle.cy * hPx - HANDLE_SIZE / 2,
            width:  HANDLE_SIZE,
            height: HANDLE_SIZE,
            cursor: handle.cursor,
          }}
          onMouseDown={(e) => onResizeMouseDown(e, handle.id)}
        />
      ))}
    </div>
  );
}
