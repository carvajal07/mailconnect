// editor/resources/FillStylePanel.jsx — Panel de Fill Style en ContextPanel

import FillStyleEditor from './FillStyleEditor.jsx';
import './FillStylePanel.css';

export default function FillStylePanel({ state }) {
  const { panelContext, template, updateFillStyle, addFillStyle, addImageAsset, setPanelContext } = state;
  const styleId    = panelContext?.slice('fillStyle:'.length);
  const style      = (template?.styles?.fill ?? []).find(s => s.id === styleId) ?? null;
  const fillStyles = (template?.styles?.fill ?? []).filter(s => s.id !== styleId);
  const images     = template?.images ?? [];
  const colors     = template?.colors ?? [];

  if (!style) {
    return <p className="fsp__empty">Fill Style no encontrado.</p>;
  }

  const isDefault = !!style.isDefault;

  function handleChange(changes) {
    if (isDefault) return;
    updateFillStyle(styleId, changes);
  }

  function handleClone() {
    const newId = state.cloneFillStyle?.(styleId);
    if (newId) setPanelContext?.('fillStyle:' + newId);
  }

  return (
    <div className="fsp">
      {isDefault && (
        <div className="fsp__lock-banner">
          <span>Recurso por defecto — solo lectura</span>
          <button className="fsp__clone-btn" onClick={handleClone}>Clonar para editar</button>
        </div>
      )}
      <div className="fsp__name-row">
        <label className="fsp__name-label">Nombre</label>
        <input
          className="fsp__name-input"
          value={style.name ?? ''}
          onChange={e => handleChange({ name: e.target.value })}
          placeholder="Nombre del fill style"
          disabled={isDefault}
        />
      </div>
      <FillStyleEditor
        style={style}
        onChange={handleChange}
        fillStyles={fillStyles}
        onAddFillStyle={addFillStyle}
        onNavigateFillStyle={id => setPanelContext?.('fillStyle:' + id)}
        images={images}
        onAddImageAsset={addImageAsset}
        onNavigateImageAsset={id => setPanelContext?.('imageAsset:' + id)}
        colors={colors}
        onNavigateColor={id => setPanelContext?.('color:' + id)}
        disabled={isDefault}
      />
    </div>
  );
}
