// EmbeddedElementMenu.jsx — Context menu for inserting embedded elements into a flow area

import { useEffect, useRef } from 'react';
import { Table2, Image, Square, QrCode, Barcode } from 'lucide-react';
import './EmbeddedElementMenu.css';

const ELEMENT_TYPES = [
  { type: 'table',   Icon: Table2,  label: 'Tabla' },
  { type: 'image',   Icon: Image,   label: 'Imagen' },
  { type: 'shape',   Icon: Square,  label: 'Forma' },
  { type: 'qr',      Icon: QrCode,  label: 'Código QR' },
  { type: 'barcode', Icon: Barcode, label: 'Código de barras' },
];

export default function EmbeddedElementMenu({ position, onInsert, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [onClose]);

  return (
    <div ref={ref} className="eem" style={{ top: position.y, left: position.x }}>
      <div className="eem__header">Insertar elemento</div>

      {ELEMENT_TYPES.map(({ type, Icon, label }) => (
        <button
          key={type}
          className="eem__item"
          onMouseDown={e => { e.preventDefault(); onInsert(type); }}
        >
          <Icon size={12} className="eem__icon" />
          {label}
        </button>
      ))}
    </div>
  );
}
