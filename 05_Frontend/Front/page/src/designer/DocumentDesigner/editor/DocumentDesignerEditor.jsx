// DocumentDesignerEditor.jsx — Layout principal del editor full-screen
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDesignerState } from './hooks/useDesignerState.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { useLayoutConfig } from './layout/useLayoutConfig.js';
import { PANELS } from './layout/layoutConfig.js';
import Ribbon from './toolbar/Ribbon.jsx';
import TextFormatToolbar from './toolbar/TextFormatToolbar.jsx';
import ElementBar from './toolbar/ElementBar.jsx';
import DesignCanvas from './canvas/DesignCanvas.jsx';
import { PagesPanel, DataPanel, ResourcesPanel } from './sidebar/DesignerSidebar.jsx';
import ContextPanel from './sidebar/ContextPanel.jsx';
import LayoutEditor from './layout/LayoutEditor.jsx';
import { insertVariableTag } from './canvas/elements/variableUtils.js';
import { gcOrphanCopyStyles } from '../engine/styleGc.js';
import { DesignerAssetsContext } from './DesignerUploadContext.js';
import './DocumentDesignerEditor.css';

// ── Resize constants ─────────────────────────────────────────────────────────
const MIN_COL_WIDTH = 160;
const MAX_COL_WIDTH = 600;
const DEFAULT_COL_WIDTH = { left: 210, left2: 250, right2: 280, right: 240 };

// ── Panel renderer ────────────────────────────────────────────────────────────

// Map a panelContext prefix → resource section key. Shared by the tab-switch
// effect (TabbedColumn) and the section-expansion logic (PanelContent below)
// so a single source decides "this context belongs to that section".
const PANEL_CONTEXT_SECTION = {
  'borderStyle:':    'borderStyles',
  'tableStyle:':     'tableStyles',
  'fillStyle:':      'fillStyles',
  'textStyle:':      'textStyles',
  'paragraphStyle:': 'paragraphStyles',
  'bulletNumbering:': 'bulletNumbering',
  'color:':          'colors',
  'imageAsset:':     'images',
  'contentArea:':    'contentAreas',
};

function sectionForPanelContext(pc) {
  if (!pc) return null;
  for (const [prefix, key] of Object.entries(PANEL_CONTEXT_SECTION)) {
    if (pc.startsWith(prefix)) return key;
  }
  return null;
}

function PanelContent({ panelId, state, template, availableFields, showInvisibles, onToggleInvisibles, onInsertVariable }) {
  switch (panelId) {
    case 'text-toolbar':
      return <TextFormatToolbar state={state} showInvisibles={showInvisibles} onToggleInvisibles={onToggleInvisibles} />;
    case 'pages':
      return <PagesPanel template={template} state={state} />;
    case 'data':
      return <DataPanel availableFields={availableFields} onInsertVariable={onInsertVariable} />;
    case 'resources': {
      // When `panelContext` is set to a resource (e.g. `borderStyle:bs_123`),
      // expand the corresponding section so the newly-created / navigated item
      // is visible. expandTick keys off the panelContext so re-creating the
      // same prefix forces a re-mount of `forceOpen` even if the section was
      // collapsed manually after the first time.
      const sec = sectionForPanelContext(state?.panelContext);
      return (
        <ResourcesPanel
          template={template}
          state={state}
          expandedSection={sec}
          expandTick={sec ? (state?.panelContext?.length ?? 0) : 0}
        />
      );
    }
    case 'properties':
      return <ContextPanel state={state} availableFields={availableFields} />;
    default:
      return null;
  }
}

// ── Tabbed column — múltiples paneles con tabs ────────────────────────────────

function TabbedColumn({ panels, panelProps, width }) {
  const [active, setActive] = useState(panels[0] ?? null);
  const resolvedActive = panels.includes(active) ? active : panels[0];
  const colStyle = width ? { width, minWidth: width } : undefined;

  // Keep a ref so effects can read the current active tab without stale closure
  const activeRef = useRef(resolvedActive);
  activeRef.current = resolvedActive;

  // Auto-switch to 'pages' when a canvas element is selected / added
  const selectedIds = panelProps?.state?.selectedIds;
  const template    = panelProps?.state?.template;
  useEffect(() => {
    if (activeRef.current === 'pages' || !panels.includes('pages')) return;
    const ids = selectedIds ?? [];
    if (ids.length === 0) return;
    const pages = template?.pages ?? [];
    const hit = ids.some(id => pages.some(p => (p.elements ?? []).some(el => el.id === id)));
    if (hit) setActive('pages');
  }, [selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to 'resources' when panelContext points at a resource (e.g.
  // user clicked "+ Crear estilo de relleno…" in the ribbon → panelContext
  // becomes `fillStyle:<id>`). Without this, the new style is rendered in the
  // right panel but the sidebar tab stays on Páginas/Datos, so the user can't
  // see where the new resource lives.
  const panelContext = panelProps?.state?.panelContext;
  useEffect(() => {
    if (!panels.includes('resources')) return;
    if (activeRef.current === 'resources') return;
    if (sectionForPanelContext(panelContext)) setActive('resources');
  }, [panelContext]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dde-zone-col dde-zone-col--tabbed" style={colStyle}>
      <div className="dde-zone-tabs">
        {panels.map(id => (
          <button
            key={id}
            className={`dde-zone-tab${resolvedActive === id ? ' dde-zone-tab--active' : ''}`}
            onClick={() => setActive(id)}
          >
            {PANELS[id]?.shortLabel ?? id}
          </button>
        ))}
      </div>
      <div className="dde-zone-tab-content">
        <PanelContent panelId={resolvedActive} {...panelProps} />
      </div>
    </div>
  );
}

// ── Split column — múltiples paneles siempre visibles, apilados ───────────────

function SplitColumn({ panels, panelProps, width }) {
  const colStyle = width ? { width, minWidth: width } : undefined;
  return (
    <div className="dde-zone-col dde-zone-col--split" style={colStyle}>
      {panels.map(id => (
        <div key={id} className="dde-zone-split-section">
          <div className="dde-zone-split-header">{PANELS[id]?.shortLabel ?? id}</div>
          <div className="dde-zone-split-content">
            <PanelContent panelId={id} {...panelProps} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Zone column (left/right) ──────────────────────────────────────────────────

function ZoneColumn({ panels, side, elementBarZone, splitZones, panelProps }) {
  const contentPanels = (panels ?? []).filter(id => id !== 'element-bar');
  const hasElementBar = (panels ?? []).includes('element-bar');
  const showElementBar = (hasElementBar || elementBarZone === side) && (side === 'left' || side === 'right');
  const isSplit = (splitZones ?? []).includes(side);

  const [colWidth, setColWidth] = useState(() => {
    const saved = localStorage.getItem(`dde-col-width-${side}`);
    return saved
      ? Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, parseInt(saved, 10)))
      : (DEFAULT_COL_WIDTH[side] ?? 240);
  });
  const colWidthRef = useRef(colWidth);
  colWidthRef.current = colWidth;

  if (!contentPanels.length && !showElementBar) return null;

  const isLeft = side === 'left' || side === 'left2';
  const strip = showElementBar && <ElementBar state={panelProps.state} />;

  const col = contentPanels.length === 0 ? null
    : contentPanels.length === 1
      ? (
        <div className="dde-zone-col" style={{ width: colWidth, minWidth: colWidth }}>
          <PanelContent panelId={contentPanels[0]} {...panelProps} />
        </div>
      )
      : isSplit
        ? <SplitColumn panels={contentPanels} panelProps={panelProps} width={colWidth} />
        : <TabbedColumn panels={contentPanels} panelProps={panelProps} width={colWidth} />;

  function handleResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const delta = isLeft ? ev.clientX - startX : startX - ev.clientX;
      setColWidth(Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, startW + delta)));
    }
    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem(`dde-col-width-${side}`, String(colWidthRef.current));
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const handle = col && (
    <div
      className={`dde-resize-handle dde-resize-handle--${side}`}
      onMouseDown={handleResizeStart}
      title="Arrastrar para redimensionar"
    />
  );

  return (
    <div className={`dde-zone-side dde-zone-side--${side}`}>
      {isLeft  && strip}
      {isLeft  && col}
      {isLeft  && handle}
      {!isLeft && handle}
      {!isLeft && col}
      {!isLeft && strip}
    </div>
  );
}

// ── Zone bar (top/bottom) ─────────────────────────────────────────────────────

function ZoneBar({ panels, side, panelProps }) {
  const contentPanels = (panels ?? []).filter(id => id !== 'element-bar');
  const hasElementBar = (panels ?? []).includes('element-bar');

  if (!contentPanels.length && !hasElementBar) return null;

  return (
    <div className={`dde-zone-bar dde-zone-bar--${side}`}>
      {hasElementBar && <ElementBar state={panelProps.state} horizontal />}
      {contentPanels.map(id => (
        <div key={id} className="dde-zone-bar-panel">
          <PanelContent panelId={id} {...panelProps} />
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DocumentDesignerEditor({ templateJson, availableFields, onSave, onClose, onTemplateChange, headerActions, assets }) {
  const state = useDesignerState(templateJson);

  // Notifica al contenedor cada vez que el template cambia (para autosave del
  // draft contra el backend en la integración de templates · S4). Opcional.
  useEffect(() => {
    onTemplateChange?.(state.template);
  }, [state.template]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showInvisibles, setShowInvisibles] = useState(false);
  const [showVarPreview, setShowVarPreview] = useState(false);
  const [showLayoutEditor, setShowLayoutEditor] = useState(false);
  const { layout, setLayout, resetLayout } = useLayoutConfig();

  const onInsertVariable = useCallback((path) => {
    const editor = state.activeEditorRef?.current;
    if (editor) insertVariableTag(editor, path);
    else navigator.clipboard?.writeText(`{{ ${path} }}`).catch(() => {});
  }, [state.activeEditorRef]);

  const handleSave = useCallback(() => {
    onSave(state.template, null);
  }, [state.template, onSave]);

  useKeyboardShortcuts(state, handleSave, onClose);

  // Limpieza única al abrir: elimina estilos "(copia)" huérfanos que dejó el
  // modelo viejo de fork-on-open. Idempotente (no toca nada si no hay huérfanos).
  useEffect(() => {
    state.setTemplate?.(t => gcOrphanCopyStyles(t));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Inject @font-face rules for custom fonts stored in the template
  useEffect(() => {
    const fonts = state.template?.fonts ?? [];
    let el = document.getElementById('dde-custom-fonts');
    if (!el) {
      el = document.createElement('style');
      el.id = 'dde-custom-fonts';
      document.head.appendChild(el);
    }
    el.textContent = fonts.flatMap(font =>
      (font.variants ?? []).map(v =>
        `@font-face { font-family: '${font.family}'; font-weight: ${v.weight ?? 400}; font-style: ${v.style ?? 'normal'}; src: url('${v.data}') format('${v.format ?? 'truetype'}'); }`
      )
    ).join('\n');
    return () => { if (el) el.textContent = ''; };
  }, [state.template?.fonts]);

  const panelProps = {
    state,
    template: state.template,
    availableFields,
    showInvisibles,
    onToggleInvisibles: () => setShowInvisibles(v => !v),
    onInsertVariable,
  };

  // Find where element-bar lives (for the side columns)
  const allZones = ['top', 'left', 'right', 'bottom'];
  const elementBarZone = allZones.find(z => (layout[z] ?? []).includes('element-bar')) ?? 'left';

  return (
    <DesignerAssetsContext.Provider value={assets}>
    <div className="dde-overlay">
      <div className="dde-container">

        {/* ── Ribbon (header + icons) ── */}
        <Ribbon
          templateName={state.template.meta?.name ?? 'Editor de Documentos'}
          onSave={handleSave}
          onClose={onClose}
          extraActions={headerActions}
          state={state}
          showVarPreview={showVarPreview}
          onToggleVarPreview={() => setShowVarPreview(v => !v)}
          onOpenLayoutEditor={() => setShowLayoutEditor(true)}
          showInvisibles={showInvisibles}
          onToggleInvisibles={() => setShowInvisibles(v => !v)}
        />

        {/* ── Top zone ── */}
        <ZoneBar panels={layout.top} side="top" panelProps={panelProps} />

        {/* ── Body ── */}
        <div className="dde-body">
          <ZoneColumn panels={layout.left}  side="left"  elementBarZone={elementBarZone} splitZones={layout.splitZones} panelProps={panelProps} />
          <ZoneColumn panels={layout.left2} side="left2" elementBarZone={elementBarZone} splitZones={layout.splitZones} panelProps={panelProps} />

          <div className="dde-canvas-area">
            <DesignCanvas state={{ ...state, showInvisibles, showVarPreview, availableFields }} />
          </div>

          <ZoneColumn panels={layout.right2} side="right2" elementBarZone={elementBarZone} splitZones={layout.splitZones} panelProps={panelProps} />
          <ZoneColumn panels={layout.right} side="right"  elementBarZone={elementBarZone} splitZones={layout.splitZones} panelProps={panelProps} />
        </div>

        {/* ── Bottom zone ── */}
        <ZoneBar panels={layout.bottom} side="bottom" panelProps={panelProps} />

      </div>

      {showLayoutEditor && (
        <LayoutEditor
          current={layout}
          onApply={setLayout}
          onClose={() => setShowLayoutEditor(false)}
          onReset={() => { resetLayout(); setShowLayoutEditor(false); }}
        />
      )}
    </div>
    </DesignerAssetsContext.Provider>
  );
}
