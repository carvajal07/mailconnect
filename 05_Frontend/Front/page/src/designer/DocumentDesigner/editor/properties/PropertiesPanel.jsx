// editor/properties/PropertiesPanel.jsx — Right panel: element properties

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import BasicTab             from './tabs/BasicTab.jsx';
import TextTab              from './tabs/TextTab.jsx';
import FillTab              from './tabs/FillTab.jsx';
import BorderTab            from './tabs/BorderTab.jsx';
import ContentAreaTab       from './tabs/ContentAreaTab.jsx';
import AreaPropertiesPanel  from './panels/AreaPropertiesPanel.jsx';
import './PropertiesPanel.css';

const TABS_BY_TYPE = {
  text:        ['Básico', 'Texto', 'Relleno', 'Borde'],
  shape:       ['Básico', 'Relleno', 'Borde'],
  image:       ['Básico', 'Borde'],
  table:       ['Básico', 'Borde'],
  contentarea: ['Básico', 'Áreas', 'Borde'],
  qr:          ['Básico'],
  barcode:     ['Básico'],
};

export default function PropertiesPanel({ state, availableFields }) {
  const { template, currentPageIndex, selectedIds, updateCurrentPage, areaEditCtx, focusedAreaCtx, setFocusedAreaCtx } = state;
  const [activeTab, setActiveTab] = useState('Básico');
  const [collapsed, setCollapsed] = useState(false);

  const currentPage = template?.pages?.[currentPageIndex] ?? null;
  const elements    = currentPage?.elements ?? [];

  // ── Collapsed strip ────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="pp pp--collapsed">
        <button className="pp__collapse-btn" onClick={() => setCollapsed(false)} title="Expandir propiedades">
          <ChevronLeft size={14} />
        </button>
      </div>
    );
  }

  // ── Area properties: mini-canvas mode OR area focused via click ────────
  function _findArea(areas, id) {
    for (const a of areas) {
      if (a.id === id) return a;
      if (a.children?.length) { const f = _findArea(a.children, id); if (f) return f; }
    }
    return null;
  }

  const areaCtx = areaEditCtx ?? focusedAreaCtx;   // areaEditCtx has priority
  if (areaCtx) {
    const caEl = elements.find(el => el.id === areaCtx.caId);
    const resolvedAreas = state.resolveAreas?.(caEl) ?? caEl?.areas ?? [];
    const area = _findArea(resolvedAreas, areaCtx.areaId);
    if (area && caEl) {
      return (
        <AreaPropertiesPanel
          area={area}
          caId={caEl.id}
          state={state}
          availableFields={availableFields}
          onCollapse={() => setCollapsed(true)}
          onBack={areaEditCtx ? undefined : () => setFocusedAreaCtx(null)}
        />
      );
    }
  }

  // ── No selection / multi-selection ────────────────────────────────────
  if (selectedIds.length !== 1) {
    return (
      <div className="pp">
        <div className="pp__empty-header">
          <button className="pp__collapse-btn pp__collapse-btn--inline" onClick={() => setCollapsed(true)} title="Colapsar">
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="pp__empty">
          <p>
            {selectedIds.length > 1
              ? `${selectedIds.length} elementos seleccionados`
              : 'Selecciona un elemento'}
          </p>
        </div>
      </div>
    );
  }

  // ── Element properties ─────────────────────────────────────────────────
  // In area edit mode, selected element may be inside the area's elements
  function findAreaById(areas, id) {
    for (const a of areas) {
      if (a.id === id) return a;
      if (a.children?.length) { const f = findAreaById(a.children, id); if (f) return f; }
    }
    return null;
  }
  let element = elements.find(el => el.id === selectedIds[0]);
  if (!element && areaEditCtx) {
    const caEl = elements.find(el => el.id === areaEditCtx.caId);
    const resolvedAreas2 = state.resolveAreas?.(caEl) ?? caEl?.areas ?? [];
    const area = findAreaById(resolvedAreas2, areaEditCtx.areaId);
    element = area?.elements?.find(el => el.id === selectedIds[0]) ?? null;
  }
  if (!element) return null;

  const tabs = TABS_BY_TYPE[element.type] ?? ['Básico'];
  const tab  = tabs.includes(activeTab) ? activeTab : tabs[0];

  function updateElement(changes) {
    const updated = elements.map(el =>
      el.id === element.id ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
    );
    updateCurrentPage({ elements: updated });
  }

  return (
    <div className="pp">
      <div className="pp__header">
        <span className="pp__type">{element.type}</span>
        <span className="pp__id">{element.id}</span>
        <button className="pp__collapse-btn pp__collapse-btn--inline" onClick={() => setCollapsed(true)} title="Colapsar">
          <ChevronRight size={14} />
        </button>
      </div>

      {tabs.length > 1 && (
        <div className="pp__tabs">
          {tabs.map(t => (
            <button
              key={t}
              className={`pp__tab${tab === t ? ' pp__tab--active' : ''}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="pp__body">
        {tab === 'Básico'  && <BasicTab       element={element} onUpdate={updateElement} state={element.type === 'contentarea' ? state : undefined} />}
        {tab === 'Áreas'   && element.type === 'contentarea' && <ContentAreaTab element={element} state={state} availableFields={availableFields} />}
        {tab === 'Texto'   && <TextTab        element={element} onUpdate={updateElement} />}
        {tab === 'Relleno' && <FillTab        element={element} onUpdate={updateElement} />}
        {tab === 'Borde'   && <BorderTab      element={element} onUpdate={updateElement} borderStyles={state.template?.styles?.border ?? []} addBorderStyle={state.addBorderStyle} onNavigateToStyle={id => state.setPanelContext?.('borderStyle:' + id)} />}
      </div>
    </div>
  );
}
