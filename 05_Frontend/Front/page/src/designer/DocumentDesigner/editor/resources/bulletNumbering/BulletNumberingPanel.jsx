// BulletNumberingPanel.jsx — Panel inline para editar un recurso de Viñetas y
// numeración en el ContextPanel (panelContext = 'bulletNumbering:ID').

import BulletNumberingEditor from './BulletNumberingEditor.jsx';
import '../text/TextStylePanel.css';

export default function BulletNumberingPanel({ state }) {
  const { panelContext, template, updateBulletNumbering, setPanelContext } = state;
  const id   = panelContext?.slice('bulletNumbering:'.length);
  const item = template?.styles?.bulletNumbering?.find(s => s.id === id) ?? null;

  if (!item) {
    return <p className="tsp__empty">Recurso de viñetas/numeración no encontrado.</p>;
  }

  const handleChange = (changes) => updateBulletNumbering?.(id, changes);

  return (
    <div className="tsp">
      <div className="tsp__name-row">
        <label className="tsp__name-label">Nombre</label>
        <input
          className="tsp__name-input"
          value={item.name ?? ''}
          onChange={e => handleChange({ name: e.target.value })}
          placeholder="Nombre del recurso"
        />
      </div>
      <BulletNumberingEditor
        item={item}
        onChange={handleChange}
        availableFields={state?.availableFields ?? []}
        colors={template?.colors ?? []}
      />
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button
          className="tsp__clone-btn"
          onClick={() => {
            const newId = state.cloneBulletNumbering?.(id);
            if (newId) setPanelContext?.('bulletNumbering:' + newId);
          }}
        >Clonar</button>
      </div>
    </div>
  );
}
