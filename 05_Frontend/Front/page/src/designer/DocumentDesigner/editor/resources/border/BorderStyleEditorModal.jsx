// editor/resources/BorderStyleEditorModal.jsx — Modal for creating/editing a BorderStyle

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Save } from 'lucide-react';
import BorderStyleEditor from './BorderStyleEditor.jsx';
import { createDefaultBorderStyle } from './borderStyleDefaults.js';
import './BorderStyleEditorModal.css';

export default function BorderStyleEditorModal({ styleId, borderStyles = [], onUpdate, onClose }) {
  const existing = borderStyles.find(s => s.id === styleId) ?? null;

  const [draft, setDraft] = useState(() =>
    existing ? { ...existing } : createDefaultBorderStyle()
  );

  function handleChange(changes) {
    setDraft(prev => ({ ...prev, ...changes }));
  }

  function handleSave() {
    onUpdate(styleId, draft);
    onClose();
  }

  return createPortal(
    <div className="bsem-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bsem-dialog">

        <div className="bsem-header">
          <div className="bsem-header__left">
            <span className="bsem-header__label">BorderStyle</span>
            <input
              className="bsem-header__name"
              value={draft.name ?? ''}
              onChange={e => handleChange({ name: e.target.value })}
              placeholder="Nombre del estilo"
            />
          </div>
          <div className="bsem-header__actions">
            <button className="bsem-btn bsem-btn--primary" onClick={handleSave}>
              <Save size={13} />
              Guardar
            </button>
            <button className="bsem-btn bsem-btn--ghost" onClick={onClose} title="Cancelar">
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="bsem-body">
          <BorderStyleEditor style={draft} onChange={handleChange} />
        </div>

      </div>
    </div>,
    document.body
  );
}
