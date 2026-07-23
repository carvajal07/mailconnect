// AreaRuler.jsx — Horizontal ruler with draggable indent markers for area editing
// Renders above the content area band when in edit mode.
// Uses percentages for positioning so it scales with the container width (which is zoom-aware).
// Only commits indent changes on mouseup (not during drag) to avoid creating many styles.

import { useState, useRef, useCallback, useEffect } from 'react';
import './AreaRuler.css';

// ── Tick generation (returns positions as % of total width) ───────────────────

function generateTicks(widthMm) {
  const ticks = [];
  if (!widthMm || widthMm <= 0) return ticks;
  for (let mm = 0; mm <= widthMm; mm += 1) {
    const pct = (mm / widthMm) * 100;
    if (mm % 10 === 0) {
      ticks.push({ pct, type: 'major', label: mm });
    } else if (mm % 5 === 0) {
      ticks.push({ pct, type: 'mid' });
    } else {
      ticks.push({ pct, type: 'minor' });
    }
  }
  return ticks;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AreaRuler({ widthMm, paragraphStyle, onIndentChange }) {
  const ps = paragraphStyle ?? {};
  const baseFirst = ps.firstLineIndent ?? 0;
  const baseLeft  = ps.leftIndent ?? 0;
  const baseRight = ps.rightIndent ?? 0;

  const rulerRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'first' | 'left' | 'right' | null
  // Preview values during drag (local state, no style creation)
  const [preview, setPreview] = useState(null); // { firstLineIndent, leftIndent, rightIndent }
  const dragStartRef = useRef({ startX: 0, startVal: 0, rulerWidth: 0 });
  const previewRef = useRef(null);

  const ticks = generateTicks(widthMm);
  const W = widthMm || 1;

  // Use preview values during drag, otherwise use paragraph style values
  const firstLineIndent = preview?.firstLineIndent ?? baseFirst;
  const leftIndent      = preview?.leftIndent ?? baseLeft;
  const rightIndent     = preview?.rightIndent ?? baseRight;

  // Convert indent mm → % of total width
  const firstPct = ((leftIndent + firstLineIndent) / W) * 100;
  const leftPct  = (leftIndent / W) * 100;
  const rightPct = ((W - rightIndent) / W) * 100;

  // ── Drag handlers ──────────────────────────────────────────────────────

  const handleDragStart = useCallback((type, e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const currentVal = type === 'first' ? baseFirst
      : type === 'left' ? baseLeft : baseRight;

    dragStartRef.current = { startX: e.clientX, startVal: currentVal, rulerWidth: rect.width };
    setPreview({ firstLineIndent: baseFirst, leftIndent: baseLeft, rightIndent: baseRight });
    setDragging(type);
  }, [baseFirst, baseLeft, baseRight]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e) => {
      const { startX, startVal, rulerWidth } = dragStartRef.current;
      const dx = e.clientX - startX;
      const dMm = (dx / rulerWidth) * W;

      setPreview(prev => {
        const next = { ...prev };
        if (dragging === 'first') {
          next.firstLineIndent = Math.round((startVal + dMm) * 2) / 2;
        } else if (dragging === 'left') {
          next.leftIndent = Math.max(0, Math.round((startVal + dMm) * 2) / 2);
        } else if (dragging === 'right') {
          next.rightIndent = Math.max(0, Math.round((startVal - dMm) * 2) / 2);
        }
        previewRef.current = next;
        return next;
      });
    };

    const handleUp = () => {
      // Read final preview from ref (not from state updater to avoid side-effect errors)
      const final = previewRef.current;
      if (final) {
        const changes = {};
        if (final.firstLineIndent !== baseFirst) changes.firstLineIndent = final.firstLineIndent;
        if (final.leftIndent !== baseLeft)       changes.leftIndent = final.leftIndent;
        if (final.rightIndent !== baseRight)     changes.rightIndent = final.rightIndent;
        if (Object.keys(changes).length > 0) {
          onIndentChange?.(changes);
        }
      }
      previewRef.current = null;
      setPreview(null);
      setDragging(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, onIndentChange, W, baseFirst, baseLeft, baseRight]);

  return (
    <div className="arulr" ref={rulerRef}>
      {/* Tick marks */}
      <div className="arulr__ticks">
        {ticks.map((t, i) => (
          <div key={i}>
            <div
              className={`arulr__tick arulr__tick--${t.type}`}
              style={{ left: `${t.pct}%` }}
            />
            {t.type === 'major' && (
              <span className="arulr__tick-label" style={{ left: `${t.pct}%` }}>
                {t.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* First line indent marker (top triangle) */}
      <div
        className={`arulr__marker arulr__marker--first${dragging === 'first' ? ' arulr__marker--dragging' : ''}`}
        style={{ left: `${firstPct}%` }}
        onMouseDown={e => handleDragStart('first', e)}
        title="Sangría primera línea"
      >
        <span className="arulr__marker-tip">
          1ª línea: {(leftIndent + firstLineIndent).toFixed(1)}mm
        </span>
      </div>

      {/* Left indent marker (bottom triangle) */}
      <div
        className={`arulr__marker arulr__marker--left${dragging === 'left' ? ' arulr__marker--dragging' : ''}`}
        style={{ left: `${leftPct}%` }}
        onMouseDown={e => handleDragStart('left', e)}
        title="Sangría izquierda"
      >
        <span className="arulr__marker-tip">
          Izq: {leftIndent.toFixed(1)}mm
        </span>
      </div>

      {/* Right indent marker (bottom triangle, from right) */}
      <div
        className={`arulr__marker arulr__marker--right${dragging === 'right' ? ' arulr__marker--dragging' : ''}`}
        style={{ left: `${rightPct}%` }}
        onMouseDown={e => handleDragStart('right', e)}
        title="Sangría derecha"
      >
        <span className="arulr__marker-tip">
          Der: {rightIndent.toFixed(1)}mm
        </span>
      </div>
    </div>
  );
}
