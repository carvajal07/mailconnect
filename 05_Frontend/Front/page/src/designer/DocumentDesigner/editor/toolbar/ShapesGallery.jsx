// editor/toolbar/ShapesGallery.jsx — Botón único "Formas" con galería estilo Word.
//
// Reemplaza los botones sueltos de forma del ribbon: un solo botón que abre un
// popover con categorías + grid de formas. Al elegir una, fija la herramienta de
// forma (onPick) y se dibuja en el canvas.

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Shapes, ChevronDown } from 'lucide-react';
import { shapesByCategory } from '../../engine/shapeCatalog.js';
import ShapeGeom from '../canvas/elements/ShapeGeom.jsx';
import './ShapesGallery.css';

export default function ShapesButton({ activeShape, isShapeTool, onPick, hint, variant = 'ribbon' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const cats = shapesByCategory();
  const isBar = variant === 'bar';

  // Portalizamos a <body> con posición fija para que el popover no se recorte.
  // 'ribbon' → debajo del botón; 'bar' (barra vertical izquierda) → a la derecha.
  useEffect(() => {
    if (!open) return;
    function reposition() {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos(isBar ? { left: r.right + 6, top: r.top } : { left: r.left, top: r.bottom + 2 });
    }
    reposition();
    function onDown(e) {
      if (btnRef.current?.contains(e.target)) return;
      if (e.target.closest?.('.shapes-gallery')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, isBar]);

  const trigger = isBar ? (
    <button
      ref={btnRef}
      className={`ebar__btn${isShapeTool ? ' ebar__btn--active' : ''}`}
      onClick={() => setOpen(o => !o)}
      title={hint || 'Formas'}
    >
      <Shapes size={16} />
    </button>
  ) : (
    <div className="rb__dropdown">
      <button
        ref={btnRef}
        className={`rb__btn${isShapeTool ? ' rb__btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={hint || 'Formas'}
      >
        <Shapes size={15} />
        <span className="rb__btn-label">Formas</span>
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
    </div>
  );

  return (
    <>
      {trigger}
      {open && pos && createPortal(
        <div
          className="rb__popover shapes-gallery"
          style={{ position: 'fixed', left: pos.left, top: pos.top }}
        >
          {cats.map(cat => (
            <div key={cat.id} className="shapes-gallery__cat">
              <div className="shapes-gallery__cat-label">{cat.label}</div>
              <div className="shapes-gallery__grid">
                {cat.shapes.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`shapes-gallery__item${activeShape === s.id ? ' is-active' : ''}`}
                    title={s.label}
                    onClick={() => { onPick(s.id); setOpen(false); }}
                  >
                    <span className="shapes-gallery__glyph">
                      <ShapeGeom
                        geom={s.geom}
                        kind={s.kind}
                        fillPaint={s.kind === 'open' ? 'none' : '#e8edf5'}
                        stroke="#4b5563"
                        strokeWidth={s.kind === 'open' ? 2 : 1.4}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
