// InsertRowSetDialog.jsx — Dialog to choose the type of a new RowSet to insert
import { useState, useEffect, useRef } from 'react';
import './InsertRowSetDialog.css';

const ROW_SET_TYPES = [
  { value: 'single-row',          label: 'Single row' },
  { value: 'multiple-rows',       label: 'Multiple rows' },
  { value: 'repeated',            label: 'Repeated' },
  { value: 'select-by-integer',   label: 'Select by integer' },
  { value: 'select-by-interval',  label: 'Select by interval' },
  { value: 'select-by-condition', label: 'Select by condition' },
  { value: 'header-footer',       label: 'Header and footer' },
  { value: 'select-by-text',      label: 'Select by text' },
  { value: 'select-by-inline',    label: 'Select by inline condition' },
];

export default function InsertRowSetDialog({ onConfirm, onCancel }) {
  const [selectedType, setSelectedType] = useState('single-row');
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter') onConfirm(selectedType);
  }

  return (
    <div className="irsd__backdrop" onClick={onCancel}>
      <div
        className="irsd__dialog"
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="irsd__header">
          <span className="irsd__title">Insertar RowSet</span>
          <button className="irsd__close" onClick={onCancel}>×</button>
        </div>

        <div className="irsd__body">
          <label className="irsd__label">Tipo</label>
          <div className="irsd__type-list">
            {ROW_SET_TYPES.map(t => (
              <button
                key={t.value}
                className={`irsd__type-item${selectedType === t.value ? ' irsd__type-item--selected' : ''}`}
                onClick={() => setSelectedType(t.value)}
                onDoubleClick={() => onConfirm(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="irsd__footer">
          <button className="irsd__btn irsd__btn--cancel" onClick={onCancel}>Cancelar</button>
          <button className="irsd__btn irsd__btn--ok" onClick={() => onConfirm(selectedType)}>Insertar</button>
        </div>
      </div>
    </div>
  );
}
