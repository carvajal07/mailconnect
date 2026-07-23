// editor/resources/BorderStylePanel.jsx — Inline panel for BorderStyle editing in ContextPanel

import BorderStyleEditor from './BorderStyleEditor.jsx';
import './BorderStylePanel.css';

export default function BorderStylePanel({ state }) {
  const { panelContext, template, updateBorderStyle, addFillStyle, setPanelContext } = state;
  const styleId = panelContext?.slice('borderStyle:'.length);
  const style   = template?.styles?.border?.find(s => s.id === styleId) ?? null;

  if (!style) {
    return <p className="bsp__empty">Estilo no encontrado.</p>;
  }

  function handleChange(changes) {
    updateBorderStyle(styleId, changes);
  }

  return (
    <div className="bsp">
      <div className="bsp__name-row">
        <label className="bsp__name-label">Nombre</label>
        <input
          className="bsp__name-input"
          value={style.name ?? ''}
          onChange={e => handleChange({ name: e.target.value })}
          placeholder="Nombre del estilo"
        />
      </div>
      <BorderStyleEditor
        style={style}
        onChange={handleChange}
        fillStyles={template?.styles?.fill ?? []}
        onAddFillStyle={addFillStyle}
        onNavigateFillStyle={id => setPanelContext?.('fillStyle:' + id)}
      />
    </div>
  );
}
