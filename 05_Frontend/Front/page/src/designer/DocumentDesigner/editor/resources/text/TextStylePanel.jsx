// editor/resources/TextStylePanel.jsx — Inline panel for TextStyle editing in ContextPanel

import TextStyleEditor from './TextStyleEditor.jsx';
import './TextStylePanel.css';

export default function TextStylePanel({ state }) {
  const { panelContext, template, updateTextStyle, addFillStyle, setPanelContext } = state;
  const styleId = panelContext?.slice('textStyle:'.length);
  const style   = template?.styles?.text?.find(s => s.id === styleId) ?? null;

  if (!style) {
    return <p className="tsp__empty">Estilo no encontrado.</p>;
  }

  const isDefault = !!style.isDefault;

  function handleChange(changes) {
    if (isDefault) return;
    updateTextStyle(styleId, changes);
  }

  function handleClone() {
    const newId = state.cloneTextStyle?.(styleId);
    if (newId) setPanelContext?.('textStyle:' + newId);
  }

  return (
    <div className="tsp">
      {isDefault && (
        <div className="tsp__lock-banner">
          <span>Recurso por defecto — solo lectura</span>
          <button className="tsp__clone-btn" onClick={handleClone}>Clonar para editar</button>
        </div>
      )}
      <div className="tsp__name-row">
        <label className="tsp__name-label">Nombre</label>
        <input
          className="tsp__name-input"
          value={style.name ?? ''}
          onChange={e => handleChange({ name: e.target.value })}
          placeholder="Nombre del estilo"
          disabled={isDefault}
        />
      </div>
      <TextStyleEditor
        style={style}
        onChange={handleChange}
        borderStyles={template?.styles?.border ?? []}
        lineStyles={template?.styles?.line ?? []}
        fillStyles={template?.styles?.fill ?? []}
        colors={template?.colors ?? []}
        onAddFillStyle={addFillStyle}
        onNavigateFillStyle={id => setPanelContext?.('fillStyle:' + id)}
        customFonts={(template?.fonts ?? []).map(f => f.family)}
        disabled={isDefault}
      />
    </div>
  );
}
