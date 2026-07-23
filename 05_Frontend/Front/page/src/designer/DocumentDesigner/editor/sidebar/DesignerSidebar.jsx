// DesignerSidebar.jsx — Panel izquierdo: Datos | Recursos | Páginas
import { useState, useEffect } from 'react';
import ResourceBar from './ResourceBar.jsx';
import ElementBar from '../toolbar/ElementBar.jsx';
import { PagesPanel } from './panels/PagesPanel.jsx';
import { DataPanel } from './panels/DataPanel.jsx';
import { ResourcesPanel } from './panels/ResourcesPanel.jsx';
import './DesignerSidebar.css';

export { PagesPanel } from './panels/PagesPanel.jsx';
export { DataPanel }  from './panels/DataPanel.jsx';
export { ResourcesPanel } from './panels/ResourcesPanel.jsx';

export default function DesignerSidebar({ template, availableFields, onInsertVariable, state = {} }) {
  const [activeTab, setActiveTab] = useState('pages');
  const [expandedSection, setExpandedSection] = useState(null);
  const [expandTick, setExpandTick] = useState(0);

  // NOTE: this DesignerSidebar wrapper is NOT used by the current editor
  // layout (DocumentDesignerEditor uses TabbedColumn with PagesPanel /
  // DataPanel / ResourcesPanel directly). The equivalent auto-switch-to-
  // resources behavior lives in TabbedColumn + PanelContent over there.
  // Keeping a minimal effect here for the older imageAsset path (kept for
  // any callers still mounting <DesignerSidebar/> directly).
  useEffect(() => {
    const pc = state.panelContext;
    if (pc?.startsWith('borderStyle:') || pc?.startsWith('tableStyle:') || pc?.startsWith('textStyle:') || pc?.startsWith('paragraphStyle:') || pc?.startsWith('contentArea:') || pc?.startsWith('fillStyle:')) {
      setActiveTab('resources');
    }
    if (pc?.startsWith('imageAsset:')) {
      setActiveTab('resources');
      setExpandedSection('images');
      setExpandTick(t => t + 1);
    }
  }, [state.panelContext]);

  function handleResourceBarSelect(sectionId) {
    if (activeTab === 'resources' && expandedSection === sectionId) {
      setExpandedSection(null);
    } else {
      setActiveTab('resources');
      setExpandedSection(sectionId);
    }
    setExpandTick(t => t + 1);
  }

  return (
    <div className="dsb">
      <ElementBar state={state} />

      <div className="dsb-main">
        <div className="dsb-tabs">
          {[
            { id: 'pages',     label: 'Páginas'  },
            { id: 'data',      label: 'Datos'    },
            { id: 'resources', label: 'Recursos' },
          ].map(({ id, label }) => (
            <button
              key={id}
              className={`dsb-tab${activeTab === id ? ' dsb-tab--active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'pages' && (
          <PagesPanel template={template} state={state} />
        )}

        {activeTab === 'data' && (
          <DataPanel availableFields={availableFields} onInsertVariable={onInsertVariable} />
        )}

        {activeTab === 'resources' && (
          <ResourcesPanel
            template={template}
            state={state}
            expandedSection={expandedSection}
            expandTick={expandTick}
          />
        )}

        <div className="dsb-rbar-bottom">
          <ResourceBar
            activeSection={activeTab === 'resources' ? expandedSection : null}
            onSelect={handleResourceBarSelect}
            horizontal
          />
        </div>
      </div>
    </div>
  );
}
