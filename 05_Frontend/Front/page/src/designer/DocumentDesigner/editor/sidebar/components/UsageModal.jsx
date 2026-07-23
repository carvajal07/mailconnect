import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';

export function UsageModal({ areaId, label, usages, onClose, onNavigate }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dsb-usage-modal__overlay" onClick={onClose}>
      <div className="dsb-usage-modal" onClick={e => e.stopPropagation()}>
        <div className="dsb-usage-modal__header">
          <FileText size={14} />
          <span className="dsb-usage-modal__title">Uso de "{label}"</span>
          <button className="dsb-usage-modal__close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="dsb-usage-modal__body">
          {usages.length > 0 ? (
            <table className="dsb-usage-modal__table">
              <thead>
                <tr>
                  <th>Página</th>
                  <th>Elemento</th>
                </tr>
              </thead>
              <tbody>
                {usages.map(u => (
                  <tr
                    key={u.elementId}
                    className="dsb-usage-modal__row"
                    onClick={() => { onNavigate?.(u); onClose(); }}
                  >
                    <td>{u.pageName || u.pageId}</td>
                    <td className="dsb-usage-modal__el-id">{u.elementId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dsb-usage-modal__empty">
              Esta Content Area no está siendo usada por ningún elemento.
            </p>
          )}
        </div>
        <div className="dsb-usage-modal__footer">
          <span className="dsb-usage-modal__count">{usages.length} referencia{usages.length !== 1 ? 's' : ''}</span>
          {usages.length === 0 && (
            <span className="dsb-usage-modal__hint">Puedes eliminarla de forma segura.</span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
