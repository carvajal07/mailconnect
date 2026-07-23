// AreaTagMenu.jsx — Context menu for inserting area-tags into the editor

import { useEffect, useRef } from 'react';
import { Plus, BoxSelect } from 'lucide-react';
import './AreaTagMenu.css';

export default function AreaTagMenu({ position, childAreas, onInsert, onCreateAndInsert, onClose, onOpenEmbedMenu }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [onClose]);

  return (
    <div ref={ref} className="atm" style={{ top: position.y, left: position.x }}>
      <div className="atm__header">Insertar sub-área</div>

      {childAreas.length > 0 ? (
        childAreas.map(area => (
          <button
            key={area.id}
            className="atm__item"
            onMouseDown={e => { e.preventDefault(); onInsert(area); }}
          >
            <span className="atm__icon">⎇</span>
            {area.label || area.id}
          </button>
        ))
      ) : (
        <p className="atm__empty">Sin sub-áreas aún.</p>
      )}

      <div className="atm__sep" />

      <button
        className="atm__item atm__item--new"
        onMouseDown={e => { e.preventDefault(); onCreateAndInsert(); }}
      >
        <Plus size={11} />
        Nueva sub-área
      </button>

      {onOpenEmbedMenu && (
        <>
          <div className="atm__sep" />
          <button
            className="atm__item atm__item--embed"
            onMouseDown={e => { e.preventDefault(); onOpenEmbedMenu(); }}
          >
            <BoxSelect size={11} className="atm__icon--embed" />
            Insertar elemento...
          </button>
        </>
      )}
    </div>
  );
}
