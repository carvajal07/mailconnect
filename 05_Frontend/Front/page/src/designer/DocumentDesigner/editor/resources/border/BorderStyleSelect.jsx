// editor/resources/border/BorderStyleSelect.jsx
// Compact picker for a single borderStyle slot (used by the Table Style editor).
// Shows a mini preview (line + fill) + name; the dropdown lists "Empty", all
// border styles, and "Create new border style" (→ onCreateNew). Portaled so it
// isn't clipped by the scrolling properties panel.

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus } from 'lucide-react';
import './BorderStyleSelect.css';

// Resolve a border style's preview line color via the atado chain
// (lineFillStyleId → fillStyle → colorId → color) and its fill background.
function previewOf(bs, fillStyles, colors) {
  if (!bs) return null;
  const colorFromFill = (fsId) => {
    const fs = (fillStyles ?? []).find(s => s.id === fsId);
    if (!fs) return null;
    const col = fs.colorId ? (colors ?? []).find(c => c.id === fs.colorId) : null;
    return col?.hex || fs.color || null;
  };
  const line = (bs.lineFillStyleId && colorFromFill(bs.lineFillStyleId)) || bs.lineColor || '#000000';
  const fill = (bs.fillFillStyleId && colorFromFill(bs.fillFillStyleId)) || bs.fill || 'transparent';
  const style = (bs.lineStyle ?? 'solid').toLowerCase();
  const w = Math.max(1, Math.round((bs.lineWidth ?? 0.5) * 1.6));
  return { line, fill, style, w };
}

function BsBox({ bs, fillStyles, colors }) {
  const p = previewOf(bs, fillStyles, colors);
  if (!p) {
    return <span className="bss__box bss__box--empty" />;
  }
  return (
    <span className="bss__box" style={{ background: p.fill, border: `${p.w}px ${p.style} ${p.line}` }} />
  );
}

export default function BorderStyleSelect({
  value, borderStyles = [], fillStyles = [], colors = [],
  onChange, onCreateNew, placeholder = 'Empty', disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const current = borderStyles.find(s => s.id === value) ?? null;

  const close = useCallback(() => { setOpen(false); setPos(null); }, []);

  useEffect(() => {
    if (!open) return undefined;
    function place() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 2, width: r.width });
    }
    place();
    function onDown(e) {
      if (menuRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      close();
    }
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close]);

  return (
    <div className="bss">
      <button
        ref={btnRef}
        className={`bss__btn${open ? ' bss__btn--open' : ''}`}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        title={current?.name ?? placeholder}
      >
        <BsBox bs={current} fillStyles={fillStyles} colors={colors} />
        <span className="bss__name">{current?.name ?? placeholder}</span>
        <ChevronDown size={12} className="bss__caret" />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} className="bss__menu" style={{ left: pos.left, top: pos.top, minWidth: pos.width }}>
          <button className={`bss__opt${!value ? ' bss__opt--on' : ''}`}
            onClick={() => { onChange?.(null); close(); }}>
            <span className="bss__box bss__box--empty" />
            <span className="bss__opt-name">Empty</span>
          </button>
          {borderStyles.map(bs => (
            <button key={bs.id}
              className={`bss__opt${value === bs.id ? ' bss__opt--on' : ''}`}
              onClick={() => { onChange?.(bs.id); close(); }}>
              <BsBox bs={bs} fillStyles={fillStyles} colors={colors} />
              <span className="bss__opt-name">{bs.name ?? 'Sin nombre'}</span>
            </button>
          ))}
          {onCreateNew && (
            <button className="bss__create" onClick={() => { close(); onCreateNew(); }}>
              <Plus size={11} />
              <span>Crear nuevo border style…</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
