// CellPropertiesModal.jsx — Modal wrapper around CellPropertiesPanel.
// Opens from the table context menu. Applies edits to one or many cells.

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import CellPropertiesPanel, { DEFAULT_CELL } from '../../properties/panels/CellPropertiesPanel.jsx';
import './CellPropertiesModal.css';

export default function CellPropertiesModal({ tableEl, cells, state, onClose }) {
  // Close on Esc
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Resolve actual cell objects + a representative one to display
  const resolved = useMemo(() => {
    return (cells ?? []).map(({ rowSetId, colId }) => {
      const rs = (tableEl?.rowSets ?? []).find(r => r.id === rowSetId);
      const cell = (rs?.cells ?? []).find(c => c.colId === colId) ?? { ...DEFAULT_CELL, colId };
      return { rowSetId, colId, cell };
    });
  }, [cells, tableEl]);

  if (!resolved.length) return null;

  // Show first cell's values as the editable source
  const first = resolved[0].cell;
  const colLabel = (() => {
    const col = (tableEl?.columns ?? []).find(c => c.id === resolved[0].colId);
    return col?.label ?? col?.id ?? 'Cell';
  })();

  function handleUpdate(changes) {
    state?.tableUpdateCells?.(tableEl.id, cells, changes);
  }

  const title = resolved.length === 1
    ? `Propiedades — ${colLabel}`
    : `Propiedades — ${resolved.length} celdas`;

  return createPortal(
    <div className="cpm-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cpm">
        <div className="cpm__header">
          <span className="cpm__title">{title}</span>
          <button className="cpm__close" onClick={onClose} title="Cerrar"><X size={16} /></button>
        </div>
        <div className="cpm__body">
          <CellPropertiesPanel
            cell={first}
            onUpdate={handleUpdate}
            state={state}
            showHeader={false}
          />
        </div>
        <div className="cpm__footer">
          <button className="cpm__btn cpm__btn--primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
