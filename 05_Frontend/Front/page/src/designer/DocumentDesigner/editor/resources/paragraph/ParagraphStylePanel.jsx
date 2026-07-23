// editor/resources/ParagraphStylePanel.jsx — Inline panel for ParagraphStyle editing in ContextPanel

import ParagraphStyleEditor from './ParagraphStyleEditor.jsx';
import './ParagraphStylePanel.css';

export default function ParagraphStylePanel({ state }) {
  const { panelContext, template, updateParagraphStyle, addFillStyle, setPanelContext } = state;
  const styleId = panelContext?.slice('paragraphStyle:'.length);
  const style   = template?.styles?.paragraph?.find(s => s.id === styleId) ?? null;

  if (!style) {
    return <p className="psp__empty">Estilo no encontrado.</p>;
  }

  const isDefault = !!style.isDefault;

  function handleChange(changes) {
    if (isDefault) return;
    updateParagraphStyle(styleId, changes);
  }

  function handleClone() {
    const newId = state.cloneParagraphStyle?.(styleId);
    if (newId) setPanelContext?.('paragraphStyle:' + newId);
  }

  return (
    <div className="psp">
      {isDefault && (
        <div className="psp__lock-banner">
          <span>Recurso por defecto — solo lectura</span>
          <button className="psp__clone-btn" onClick={handleClone}>Clonar para editar</button>
        </div>
      )}
      <div className="psp__name-row">
        <label className="psp__name-label">Nombre</label>
        <input
          className="psp__name-input"
          value={style.name ?? ''}
          onChange={e => handleChange({ name: e.target.value })}
          placeholder="Nombre del estilo"
          disabled={isDefault}
        />
      </div>
      <ParagraphStyleEditor
        style={style}
        onChange={handleChange}
        textStyles={template?.styles?.text ?? []}
        fillStyles={template?.styles?.fill ?? []}
        borderStyles={template?.styles?.border ?? []}
        onAddFillStyle={addFillStyle}
        onNavigateFillStyle={id => setPanelContext?.('fillStyle:' + id)}
        onNavigateBorderStyle={id => setPanelContext?.('borderStyle:' + id)}
        disabled={isDefault}
      />
    </div>
  );
}
