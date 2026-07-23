// ObjectListPanel.jsx — Flat scrollable list of all document areas for insertion
import { useEffect, useRef } from 'react';
import './ObjectListPanel.css';

function flattenAreas(areas, depth = 0) {
  const result = [];
  for (const area of areas) {
    result.push({ ...area, depth });
    if (area.children?.length) {
      result.push(...flattenAreas(area.children, depth + 1));
    }
  }
  return result;
}

export default function ObjectListPanel({ position, allAreas = [], onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [onClose]);

  const items = flattenAreas(allAreas);

  // Clamp position so panel stays within viewport
  const style = { top: position.y, left: position.x };

  return (
    <div ref={ref} className="olp" style={style}>
      <div className="olp__header">Objetos del documento</div>
      <div className="olp__list">
        {items.length === 0 && (
          <div className="olp__empty">Sin objetos disponibles</div>
        )}
        {items.map(area => (
          <div
            key={area.id}
            className="olp__item"
            style={{ paddingLeft: `${8 + area.depth * 14}px` }}
            onMouseDown={e => { e.preventDefault(); onSelect(area); }}
          >
            <span className="olp__icon">{area.depth > 0 ? '↳' : '▤'}</span>
            <span className="olp__label">{area.label || area.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
