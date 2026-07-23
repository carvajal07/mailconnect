import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function ResourceItemMenu({ x, y, actions, onClose }) {
  useEffect(() => {
    const handler = e => { if (!e.target.closest('.dsb-item-menu')) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="dsb-item-menu" style={{ position: 'fixed', top: y, left: x }}>
      {actions.map((a, i) => (
        <button
          key={i}
          className={`dsb-item-menu__action${a.danger ? ' dsb-item-menu__action--danger' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { a.onClick(); onClose(); }}
        >
          {a.Icon && <a.Icon size={11} />}
          <span>{a.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
