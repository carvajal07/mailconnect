// editor/resources/ContentAreaPanel.jsx — Reuses FlujoTab/AreasTab from AreaPropertiesPanel

import { useState, useCallback } from 'react';
import { FlujoTab, AreasTab } from '../../properties/panels/AreaPropertiesPanel.jsx';
import '../../properties/panels/AreaPropertiesPanel.css';

export default function ContentAreaPanel({ state, availableFields }) {
  const { panelContext, template, updateContentArea, getContentAreaUsage, addArea, removeArea, enterAreaEdit } = state;
  const areaId = panelContext?.slice('contentArea:'.length);
  const area   = (template?.contentAreas ?? []).find(a => a.id === areaId) ?? null;

  const [activeTab, setActiveTab] = useState('Flujo');

  // Adapter: FlujoTab calls updateArea(caId, areaId, changes) — we ignore caId
  const updateAreaAdapter = useCallback((_caId, aid, changes) => {
    updateContentArea(aid, changes);
  }, [updateContentArea]);

  // Adapter: addArea(caId, parentAreaId) — pass null as caId
  const addAreaAdapter = useCallback((_caId, parentAreaId) => {
    return state.addArea?.(null, parentAreaId);
  }, [state]);

  if (!area) {
    return <p style={{ padding: 12, color: '#9ca3af', fontSize: 11, fontStyle: 'italic' }}>Área no encontrada.</p>;
  }

  const tabs = ['Flujo', 'Áreas'];
  const tab = tabs.includes(activeTab) ? activeTab : 'Flujo';

  return (
    <div>
      <div className="pp__tabs">
        {tabs.map(t => (
          <button key={t} className={`pp__tab${tab === t ? ' pp__tab--active' : ''}`} onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding: '0 2px' }}>
        {tab === 'Flujo' && (
          <FlujoTab
            area={area}
            caId={null}
            updateArea={updateAreaAdapter}
            addArea={addAreaAdapter}
            availableFields={availableFields ?? []}
            getContentAreaUsage={getContentAreaUsage}
          />
        )}
        {tab === 'Áreas' && (
          <AreasTab
            area={area}
            caId={null}
            addArea={addAreaAdapter}
            removeArea={(_caId, aid) => removeArea?.(null, aid)}
            updateArea={updateAreaAdapter}
            enterAreaEdit={enterAreaEdit}
          />
        )}
      </div>
    </div>
  );
}
