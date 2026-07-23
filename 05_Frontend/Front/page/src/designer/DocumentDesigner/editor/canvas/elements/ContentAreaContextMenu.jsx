// ContentAreaContextMenu.jsx — Right-click menu for content areas
import { useEffect, useRef, useState } from 'react';
import './ContentAreaContextMenu.css';

const SEP = '---';

function MenuItem({ item, onAction }) {
  const [subOpen, setSubOpen] = useState(false);
  const ref = useRef(null);

  if (item === SEP) return <div className="cacm__sep" />;

  const hasChildren = item.children?.length > 0;

  function handleMouseDown(e) {
    e.preventDefault(); // keep editor focused
    if (hasChildren) { setSubOpen(v => !v); return; }
    if (item.action) onAction(item.action, item);
  }

  return (
    <div
      ref={ref}
      className={`cacm__item${item.disabled ? ' cacm__item--disabled' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => hasChildren && setSubOpen(true)}
      onMouseLeave={() => hasChildren && setSubOpen(false)}
    >
      <span className="cacm__item-label">{item.label}</span>
      {item.shortcut && <span className="cacm__shortcut">{item.shortcut}</span>}
      {hasChildren && <span className="cacm__arrow">›</span>}

      {hasChildren && subOpen && (
        <div className="cacm__submenu">
          {item.children.map((child, i) =>
            child === SEP
              ? <div key={i} className="cacm__sep" />
              : <MenuItem key={i} item={child} onAction={onAction} />
          )}
        </div>
      )}
    </div>
  );
}

export default function ContentAreaContextMenu({ position, onAction, onClose, cellContext = false }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [onClose]);

  const menu = [
    { label: 'Insertar área',         action: 'insert-area' },
    { label: 'Insertar tabla…',       action: 'open-table-dialog' },
    { label: 'Insertar objeto…',      action: 'open-object-panel' },
    { label: 'Insertar sección',      action: 'insert-section',  disabled: true },
    { label: 'Insertar ancla',        action: 'insert-anchor',   disabled: true },
    SEP,
    { label: 'Insertar carácter especial…', action: 'insert-special-char', disabled: true },
    { label: 'Insertar imagen',       action: 'insert-image' },
    { label: 'Insertar forma',        action: 'insert-shape' },
    { label: 'Insertar QR',           action: 'insert-qr' },
    { label: 'Insertar código de barras', action: 'insert-barcode' },
    SEP,
    { label: 'Hacer flow condicional', action: 'make-conditional' },
    SEP,
    { label: 'Viñetas y numeración…', action: 'bullets-numbering' },
    { label: 'Estilo de texto…',      action: 'text-style' },
    { label: 'Estilo de párrafo…',    action: 'paragraph-style' },
    // Solo cuando el clic derecho es sobre el área de una celda de tabla.
    ...(cellContext ? [
      SEP,
      { label: 'Propiedades de celda', action: 'cell-properties' },
      { label: 'Table border style',   action: 'cell-border-style' },
    ] : []),
  ];

  const style = { top: position.y, left: position.x };

  return (
    <div ref={ref} className="cacm" style={style}>
      {menu.map((item, i) =>
        item === SEP
          ? <div key={i} className="cacm__sep" />
          : <MenuItem key={i} item={item} onAction={onAction} />
      )}
    </div>
  );
}
