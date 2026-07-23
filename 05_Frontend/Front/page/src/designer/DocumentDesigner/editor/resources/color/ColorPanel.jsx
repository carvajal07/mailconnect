// editor/resources/color/ColorPanel.jsx — Panel de Color en ContextPanel

import ColorEditor from './ColorEditor.jsx';
import './ColorPanel.css';

export default function ColorPanel({ state, availableFields = [] }) {
  const { panelContext, template, updateColor, setPanelContext } = state;
  const colorId = panelContext?.slice('color:'.length);
  const color   = (template?.colors ?? []).find(c => c.id === colorId) ?? null;

  if (!color) {
    return <p className="cp__empty">Color no encontrado.</p>;
  }

  const isDefault = !!color.isDefault;

  function handleChange(changes) {
    if (isDefault) return;
    updateColor(colorId, changes);
  }

  function handleClone() {
    const newId = state.cloneColor?.(colorId);
    if (newId) setPanelContext?.('color:' + newId);
  }

  return (
    <div className="cp">
      {isDefault && (
        <div className="cp__lock-banner">
          <span>Recurso por defecto — solo lectura</span>
          <button className="cp__clone-btn" onClick={handleClone}>Clonar para editar</button>
        </div>
      )}
      <div className="cp__name-row">
        <label className="cp__name-label">Nombre</label>
        <input
          className="cp__name-input"
          value={color.name ?? ''}
          onChange={e => handleChange({ name: e.target.value })}
          placeholder="Nombre del color"
          disabled={isDefault}
        />
      </div>
      <ColorEditor
        color={color}
        onChange={handleChange}
        availableFields={availableFields}
        disabled={isDefault}
      />
    </div>
  );
}
