// Ribbon.jsx — Office-style tabbed ribbon (header + contextual icons row)
import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Save,
  Undo2, Redo2,
  Scissors, Copy, ClipboardPaste, Files, Trash2,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  MousePointer2, FileText, Image, Table2, Square,
  Barcode, Workflow, BarChart3,
  Grid3X3, Eye, Ruler, Magnet, Braces,
  ZoomIn, ZoomOut, Maximize2, Minimize2, Crop, LayoutDashboard,
  FlipHorizontal2, FlipVertical2,
  Settings, ChevronDown,
  Plus, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Combine, Split, AlignVerticalSpaceAround, AlignHorizontalSpaceAround,
  RowsIcon, Columns3, Paintbrush2,
} from 'lucide-react';
import TextFormatToolbar from './TextFormatToolbar.jsx';
import CellPropertiesModal from '../canvas/elements/CellPropertiesModal.jsx';
import { TableStyleGallery, ColorMenu, PenButton, CellAlignmentButton, ActiveStyleButton } from './TableDesign.jsx';
import { deriveAlignmentValue } from './cellAlignmentUtils.js';
import ShapesButton from './ShapesGallery.jsx';

// Resolve the active border style's line color for the Pluma preview, via the
// atado chain: lineFillStyleId → fill style → colorId → color; else lineColor.
function resolveActiveLineColor(bs, fillStyles, colors) {
  if (!bs) return '#000000';
  if (bs.lineFillStyleId) {
    const fs = (fillStyles ?? []).find(s => s.id === bs.lineFillStyleId);
    if (fs) {
      const col = fs.colorId ? (colors ?? []).find(c => c.id === fs.colorId) : null;
      return col?.hex || fs.color || bs.lineColor || '#000000';
    }
  }
  return bs.lineColor || '#000000';
}
import './Ribbon.css';

// ─────────────────────────────────────────────────────────────────────────────
// Tab registry
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_TABS = [
  { id: 'inicio',   label: 'Inicio' },
  { id: 'insertar', label: 'Insertar' },
  { id: 'diseno',   label: 'Diseño' },
  { id: 'vista',    label: 'Vista' },
];

const CONTEXTUAL_TABS = {
  tabla:  { label: 'Tabla',  color: 'amber'  },
  imagen: { label: 'Imagen', color: 'blue'   },
  forma:  { label: 'Forma',  color: 'violet' },
  texto:  { label: 'Texto',  color: 'pink'   },
};

// Returns { tabs: string[], primary: string|null } — `tabs` are all contextual
// tabs to render (multiple can coexist, e.g. editing a table cell shows
// Tabla + Texto). `primary` is which one auto-switches to on context change.
function getContextualTabs(selectedEl, isEditingText, tableRowSetCtx, editingOwner, tableCellSelection) {
  const tabs = [];
  // Table appears if any signal points at a table:
  //  - row set navigation (panel-tree selection)
  //  - selected element is a table
  //  - active edit context owner is a table (cell-edit mode)
  //  - canvas drag-select on table cells produced a tableCellSelection
  const hasTable = !!tableRowSetCtx
                || selectedEl?.type === 'table'
                || editingOwner?.type === 'table'
                || !!tableCellSelection?.tableElId;

  if (hasTable) tabs.push('tabla');
  if (selectedEl?.type === 'image') tabs.push('imagen');
  if (selectedEl?.type === 'shape') tabs.push('forma');
  if (isEditingText || selectedEl?.type === 'contentarea') tabs.push('texto');

  // Editing wins as primary (texto opens by default when typing in a cell);
  // otherwise auto-switch to the first applicable tab.
  const primary = isEditingText
    ? (tabs.includes('texto') ? 'texto' : tabs[0] ?? null)
    : (tabs[0] ?? null);

  return { tabs, primary };
}

// Find any element by id across page elements AND embedded elements in any area.
function findElementAnywhere(id, currentPage, contentAreas) {
  if (!id) return null;
  for (const el of currentPage?.elements ?? []) {
    if (el.id === id) return el;
  }
  function searchAreas(areas) {
    for (const a of areas ?? []) {
      for (const el of a.elements ?? []) {
        if (el.id === id) return el;
      }
      const f = searchAreas(a.children);
      if (f) return f;
    }
    return null;
  }
  const fromPool = searchAreas(contentAreas);
  if (fromPool) return fromPool;
  // Legacy: inline areas on page elements
  for (const el of currentPage?.elements ?? []) {
    if (el.areas?.length) {
      const f = searchAreas(el.areas);
      if (f) return f;
    }
  }
  return null;
}

// Walk an areas tree (top-level + children) looking for the area with the given id
function findAreaById(areas, id) {
  for (const a of areas ?? []) {
    if (a.id === id) return a;
    if (a.children?.length) {
      const f = findAreaById(a.children, id);
      if (f) return f;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

function IconBtn({ icon: Icon, label, onClick, active, disabled, danger, hint }) {
  return (
    <button
      className={`rb__btn${active ? ' rb__btn--active' : ''}${danger ? ' rb__btn--danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={hint || label}
    >
      <Icon size={15} />
      {label && <span className="rb__btn-label">{label}</span>}
    </button>
  );
}

function MiniBtn({ icon: Icon, onClick, active, disabled, hint, danger }) {
  return (
    <button
      className={`rb__mini${active ? ' rb__mini--active' : ''}${danger ? ' rb__mini--danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={hint}
    >
      <Icon size={15} />
    </button>
  );
}

function Sep() { return <div className="rb__sep" />; }

// Button with a dropdown menu (Word-style: insert above/below, etc)
function DropdownBtn({ icon: Icon, label, items, hint, disabled }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // { left, top } in viewport px
  const ref = useRef(null);
  const btnRef = useRef(null);

  // The ribbon row (.rb__content) is `overflow-x: auto`, which the CSS spec
  // forces `overflow-y` to `auto` too — so an absolutely-positioned dropdown
  // inside it gets CLIPPED to the 44px row (appears "behind" the panels
  // below). Portal the menu to <body> with fixed positioning instead.
  useEffect(() => {
    if (!open) return;
    function reposition() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setMenuPos({ left: r.left, top: r.bottom + 2 });
    }
    reposition();
    function onDown(e) {
      if (ref.current?.contains(e.target)) return;
      if (e.target.closest?.('.rb__dropdown-menu')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  return (
    <div className="rb__dropdown" ref={ref}>
      <button
        ref={btnRef}
        className={`rb__btn${open ? ' rb__btn--active' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={hint || label}
      >
        <Icon size={15} />
        {label && <span className="rb__btn-label">{label}</span>}
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      {open && menuPos && createPortal(
        <div
          className="rb__dropdown-menu rb__dropdown-menu--portal"
          style={{ position: 'fixed', left: menuPos.left, top: menuPos.top }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              className="rb__dropdown-item"
              onClick={() => { it.onClick(); setOpen(false); }}
            >
              {it.icon && <it.icon size={13} />}
              <span>{it.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Group({ label, children }) {
  return (
    <div className="rb__group">
      <div className="rb__group-content">{children}</div>
      {label && <div className="rb__group-label">{label}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tab content
// ─────────────────────────────────────────────────────────────────────────────

function InicioTab({ state }) {
  const {
    undo, redo, canUndo, canRedo,
    copySelected, paste, duplicateElements, removeElements,
    selectedIds, alignElements,
  } = state;
  const has   = selectedIds.length > 0;
  const multi = selectedIds.length >= 2;
  const triple = selectedIds.length >= 3;

  function cut() { copySelected(); removeElements(selectedIds); }

  return (
    <>
      <Group label="Histórico">
        <MiniBtn icon={Undo2} onClick={undo} disabled={!canUndo()} hint="Deshacer (Ctrl+Z)" />
        <MiniBtn icon={Redo2} onClick={redo} disabled={!canRedo()} hint="Rehacer (Ctrl+Y)" />
      </Group>
      <Sep />
      <Group label="Portapapeles">
        <MiniBtn icon={Scissors}        onClick={cut}                                 disabled={!has} hint="Cortar (Ctrl+X)" />
        <MiniBtn icon={Copy}            onClick={copySelected}                        disabled={!has} hint="Copiar (Ctrl+C)" />
        <MiniBtn icon={ClipboardPaste}  onClick={paste}                                                hint="Pegar (Ctrl+V)" />
        <MiniBtn icon={Files}           onClick={() => duplicateElements(selectedIds)} disabled={!has} hint="Duplicar (Ctrl+D)" />
      </Group>
      <Sep />
      <Group label="Edición">
        <MiniBtn icon={Trash2} onClick={() => removeElements(selectedIds)} disabled={!has} danger hint="Eliminar (Del)" />
      </Group>
      {multi && (
        <>
          <Sep />
          <Group label="Alinear">
            <MiniBtn icon={AlignStartVertical}    onClick={() => alignElements('left')}    hint="Izquierda" />
            <MiniBtn icon={AlignCenterVertical}   onClick={() => alignElements('centerH')} hint="Centrar horizontal" />
            <MiniBtn icon={AlignEndVertical}      onClick={() => alignElements('right')}   hint="Derecha" />
            <MiniBtn icon={AlignStartHorizontal}  onClick={() => alignElements('top')}     hint="Arriba" />
            <MiniBtn icon={AlignCenterHorizontal} onClick={() => alignElements('middleV')} hint="Centrar vertical" />
            <MiniBtn icon={AlignEndHorizontal}    onClick={() => alignElements('bottom')}  hint="Abajo" />
          </Group>
          {triple && (
            <Group label="Distribuir">
              <MiniBtn icon={AlignHorizontalDistributeCenter} onClick={() => alignElements('distributeH')} hint="Distribuir horizontal" />
              <MiniBtn icon={AlignVerticalDistributeCenter}   onClick={() => alignElements('distributeV')} hint="Distribuir vertical" />
            </Group>
          )}
        </>
      )}
    </>
  );
}

function InsertarTab({ state }) {
  const { activeTool, activeShape, setActiveTool, setActiveShape, setTableGridDims, setFloworderSource } = state;
  function pick(toolId) { setActiveTool(toolId); }
  function pickFloworder() { setFloworderSource?.(null); setActiveTool('floworder'); }
  function pickShape(s) { setActiveTool('shape'); setActiveShape(s); }

  return (
    <>
      <Group label="Selección">
        <MiniBtn icon={MousePointer2} onClick={() => pick('select')} active={activeTool === 'select'} hint="Seleccionar (V)" />
      </Group>
      <Sep />
      <Group label="Contenido">
        <IconBtn icon={FileText} label="Área"   onClick={() => pick('contentarea')} active={activeTool === 'contentarea'} hint="Content Area" />
        <IconBtn icon={Image}    label="Imagen" onClick={() => pick('image')}       active={activeTool === 'image'} />
        <IconBtn icon={Table2}   label="Tabla"  onClick={() => { setTableGridDims?.({ cols: 3, rows: 2 }); pick('table'); }} active={activeTool === 'table'} />
      </Group>
      <Sep />
      <Group label="Formas">
        <ShapesButton
          activeShape={activeShape}
          isShapeTool={activeTool === 'shape'}
          onPick={pickShape}
          hint="Formas"
        />
      </Group>
      <Sep />
      <Group label="Códigos">
        <IconBtn icon={Barcode} label="Barra" onClick={() => pick('barcode')} active={activeTool === 'barcode'} />
      </Group>
      <Sep />
      <Group label="Datos">
        <IconBtn icon={BarChart3} label="Gráfico" onClick={() => pick('chart')} active={activeTool === 'chart'} />
      </Group>
      <Sep />
      <Group label="Avanzado">
        <MiniBtn icon={Workflow} onClick={pickFloworder} active={activeTool === 'floworder'} hint="Orden de desbordamiento" />
      </Group>
    </>
  );
}

function DisenoTab({ state, showVarPreview, onToggleVarPreview }) {
  const {
    showGrid, setShowGrid,
    showGuides, setShowGuides,
    showRulers, setShowRulers,
    snapEnabled, setSnapEnabled,
    showFlowArrowsAlways, setShowFlowArrowsAlways,
  } = state;
  return (
    <>
      <Group label="Mostrar">
        <MiniBtn icon={Grid3X3} onClick={() => setShowGrid(v => !v)}     active={showGrid}   hint="Cuadrícula" />
        <MiniBtn icon={Eye}     onClick={() => setShowGuides(v => !v)}   active={showGuides} hint="Guías" />
        <MiniBtn icon={Ruler}   onClick={() => setShowRulers(v => !v)}   active={showRulers} hint="Reglas" />
        <MiniBtn icon={Workflow} onClick={() => setShowFlowArrowsAlways(v => !v)} active={showFlowArrowsAlways} hint="Flechas de desbordamiento (siempre visibles)" />
      </Group>
      <Sep />
      <Group label="Alineación">
        <MiniBtn icon={Magnet} onClick={() => setSnapEnabled(v => !v)} active={snapEnabled} hint="Snap a grilla" />
      </Group>
      <Sep />
      <Group label="Datos">
        <IconBtn icon={Braces} label="Variables" onClick={onToggleVarPreview} active={showVarPreview} hint="Vista previa de variables" />
      </Group>
    </>
  );
}

function VistaTab({ state, onOpenLayoutEditor }) {
  const { zoom, zoomIn, zoomOut, zoomFit } = state;
  return (
    <>
      <Group label="Zoom">
        <MiniBtn icon={ZoomOut} onClick={zoomOut} hint="Alejar (-)" />
        <button className="rb__zoom-display" onClick={zoomFit} title="Click: 100%">{Math.round(zoom * 100)}%</button>
        <MiniBtn icon={ZoomIn}     onClick={zoomIn}  hint="Acercar (+)" />
        <MiniBtn icon={Maximize2}  onClick={zoomFit} hint="Ajustar a pantalla" />
      </Group>
      <Sep />
      <Group label="Espacio de trabajo">
        <IconBtn icon={LayoutDashboard} label="Disposición" onClick={onOpenLayoutEditor} hint="Configurar layout del editor" />
      </Group>
    </>
  );
}

function TablaTab({ state, selectedEl }) {
  // The active table comes from any of these (in order):
  //   1. selectedEl directly (selected on the page)
  //   2. tableCellSelection.tableElId (user drag-selected cells in canvas)
  //   3. tableRowSetCtx.elId (selected via the panel tree)
  //   4. embeddedElementCtx.elementId (table embedded in a content area)
  // We search currentPage + all contentAreas to find the table object.
  const tableEl = (() => {
    if (selectedEl?.type === 'table') return selectedEl;
    const targetId = state?.tableCellSelection?.tableElId
                  ?? state?.tableRowSetCtx?.elId
                  ?? state?.embeddedElementCtx?.elementId;
    if (!targetId) return null;
    const currentPage = state?.currentPage;
    const contentAreas = state?.template?.contentAreas ?? [];
    const found = findElementAnywhere(targetId, currentPage, contentAreas);
    return found?.type === 'table' ? found : null;
  })();
  const [showCellModal, setShowCellModal] = useState(false);

  if (!tableEl) {
    return (
      <Group label="Tabla">
        <span className="rb__hint">Selecciona una tabla para ver opciones</span>
      </Group>
    );
  }

  const cells = state?.tableCellSelection?.tableElId === tableEl.id
    ? (state.tableCellSelection.cells ?? [])
    : [];
  const hasSel  = cells.length > 0;
  const multiSel = cells.length >= 2;

  // "Descombinar" must be reachable from a merged block's visible anchor.
  // Spanned cells render display:none and CAN'T be selected, and the anchor
  // itself carries no span — so gating on the SELECTED cells having a span
  // (the old `cells.some(...spanLeft||spanUp)`) left the button permanently
  // disabled. Match TableContextMenu: enable when the table has ANY merged
  // cell and there is a selection.
  const tableHasSpan = (tableEl.rowSets ?? []).some(rs =>
    (rs.cells ?? []).some(c => c.spanLeft || c.spanUp)
  );

  // Reference cell for insert-row/col when no selection: first single-row cell
  function refCell() {
    if (cells.length > 0) return cells[0];
    const firstRs = (tableEl.rowSets ?? []).find(r => r.type === 'single-row');
    const firstCol = (tableEl.columns ?? [])[0];
    if (firstRs && firstCol) return { rowSetId: firstRs.id, colId: firstCol.id };
    return null;
  }

  const selRowSetIds = [...new Set(cells.map(c => c.rowSetId))];
  const selColIds    = [...new Set(cells.map(c => c.colId))];

  // Resolve selected cell refs → real cell objects (for alignment grid value).
  // tableCellSelection.cells holds only {rowSetId,colId}; we read the live cell
  // from the table to compute current vAlign/hAlign and detect mixed states.
  const selCellObjs = cells.map(ref => {
    const rs = (tableEl.rowSets ?? []).find(r => r.id === ref.rowSetId);
    return (rs?.cells ?? []).find(c => c.colId === ref.colId);
  }).filter(Boolean);
  const alignDerived = deriveAlignmentValue(selCellObjs);
  const applyAlign = ({ vAlign, hAlign }) => {
    if (!hasSel) return;
    state.tableUpdateCells?.(tableEl.id, cells, { vAlign, hAlign });
  };

  // ── Active cell-box style (Model B) ──────────────────────────────────────
  // The scope is the selection (or every single-row cell when nothing is
  // selected). Active = the styleRef shared by all cells in scope; if they
  // differ it's "mixed". Falls back to the default style id so the quick
  // editors always have a base to fork from.
  const borderStyles = state?.template?.styles?.border ?? [];
  const fillStylesAll = state?.template?.styles?.fill ?? [];
  const colorsAll = state?.template?.colors ?? [];
  const scopeCells = selCellObjs.length
    ? selCellObjs
    : (tableEl.rowSets ?? []).filter(rs => rs.type === 'single-row').flatMap(rs => rs.cells ?? []);
  const sharedStyleRef = (() => {
    if (!scopeCells.length) return null;
    const first = scopeCells[0]?.border?.styleRef ?? null;
    if (!first) return null;
    return scopeCells.every(c => (c?.border?.styleRef ?? null) === first) ? first : null;
  })();
  const styleMixed = scopeCells.length > 1 && !sharedStyleRef
    && new Set(scopeCells.map(c => c?.border?.styleRef ?? null)).size > 1;
  const DEFAULT_BS_ID = 'bs_default';
  const activeStyleId = sharedStyleRef ?? DEFAULT_BS_ID;
  const activeStyle = borderStyles.find(s => s.id === activeStyleId)
    ?? borderStyles.find(s => s.isDefault) ?? null;
  // Usage count: how many single-row cells across the table reference it.
  const styleUsageCount = activeStyleId
    ? (tableEl.rowSets ?? []).filter(rs => rs.type === 'single-row')
        .reduce((n, rs) => n + (rs.cells ?? []).filter(c => c?.border?.styleRef === activeStyleId).length, 0)
    : 0;
  // Pen display values resolved from the active style.
  const penView = {
    style: (activeStyle?.lineStyle ?? 'Solid'),
    width: activeStyle?.lineWidth ?? 0.2,
    color: resolveActiveLineColor(activeStyle, fillStylesAll, colorsAll),
  };
  // Active style's current FILL color (for the Sombreado custom-color preview).
  const activeFillHex = (() => {
    const fsId = activeStyle?.fillFillStyleId;
    if (!fsId) return activeStyle?.fill || '#ffffff';
    const fs = fillStylesAll.find(s => s.id === fsId);
    if (!fs) return '#ffffff';
    const col = fs.colorId ? colorsAll.find(c => c.id === fs.colorId) : null;
    return col?.hex || fs.color || '#ffffff';
  })();
  // Apply a line edit (Pluma) to the active style.
  const editActiveLine = patch =>
    state.tableEditActiveStyle?.(tableEl.id, cells, sharedStyleRef ?? DEFAULT_BS_ID, patch);

  // Word-like multi-insert: N rows/cols selected → insert N. The drag-select
  // `cells` array is in visual order (top-left → bottom-right), so the edge
  // reference is cells[0] for above/left and the last cell for below/right.
  const rowN = Math.max(1, selRowSetIds.length);
  const colN = Math.max(1, selColIds.length);
  const fireInsertRow = pos => {
    const edge = cells.length
      ? (pos === 'above' ? cells[0] : cells[cells.length - 1])
      : refCell();
    if (edge) state.tableInsertRow(tableEl.id, edge.rowSetId, pos, rowN);
  };
  const fireInsertCol = pos => {
    const edge = cells.length
      ? (pos === 'left' ? cells[0] : cells[cells.length - 1])
      : refCell();
    if (edge) state.tableInsertColumn(tableEl.id, edge.colId, pos, colN);
  };
  const rowWord = rowN > 1 ? `${rowN} filas` : 'fila';
  const colWord = colN > 1 ? `${colN} columnas` : 'columna';

  const totalCols = tableEl.columns?.length ?? 0;
  const totalRows = (tableEl.rowSets ?? []).filter(r => r.type === 'single-row').length;

  return (
    <>
      <Group label="Estructura">
        <span className="rb__info">
          <strong>{totalCols}</strong>×<strong>{totalRows}</strong>
          &nbsp;·&nbsp;{hasSel ? `${cells.length} celda${cells.length>1?'s':''} sel.` : 'sin sel.'}
        </span>
      </Group>
      <Sep />
      <Group label="Diseño">
        <TableStyleGallery
          activeKey={tableEl.tableStyleKey}
          onPick={key => state.tableCreateStyleFromPreset?.(tableEl.id, key)}
          tableStyles={state?.template?.styles?.table ?? []}
          activeTableStyleId={tableEl.tableStyleRef ?? null}
          onApplyTableStyle={id => state.tableSetTableStyle?.(tableEl.id, id)}
          onCreateTableStyle={() => {
            // Blank Table Style → apply to this table → open its editor in the
            // new Recursos "Table Styles" section + properties panel.
            const newId = state.addTableStyle?.();
            if (newId) {
              state.tableSetTableStyle?.(tableEl.id, newId);
              state.setPanelContext?.(`tableStyle:${newId}`);
            }
          }}
        />
      </Group>
      <Sep />
      <Group label="Alineación">
        <CellAlignmentButton
          value={alignDerived.value}
          mixed={alignDerived.mixed}
          disabled={!hasSel}
          onChange={applyAlign}
        />
      </Group>
      <Sep />
      <Group label="Filas">
        <DropdownBtn
          icon={RowsIcon}
          label={rowN > 1 ? `Insertar ${rowN}` : 'Insertar'}
          hint={`Insertar ${rowWord}`}
          items={[
            { icon: ArrowUp,   label: `${rowN > 1 ? rowWord + ' arriba' : 'Fila arriba'}`,  onClick: () => fireInsertRow('above') },
            { icon: ArrowDown, label: `${rowN > 1 ? rowWord + ' debajo' : 'Fila debajo'}`,  onClick: () => fireInsertRow('below') },
          ]}
        />
        <MiniBtn icon={Trash2} danger
          disabled={!hasSel}
          onClick={() => state.tableRemoveRows(tableEl.id, selRowSetIds)}
          hint={`Eliminar ${selRowSetIds.length || 0} fila(s)`}
        />
        <MiniBtn icon={AlignVerticalSpaceAround}
          onClick={() => state.tableDistributeRows(tableEl.id, multiSel ? selRowSetIds : null)}
          hint={multiSel ? 'Distribuir filas seleccionadas' : 'Distribuir todas las filas'}
        />
      </Group>
      <Sep />
      <Group label="Columnas">
        <DropdownBtn
          icon={Columns3}
          label={colN > 1 ? `Insertar ${colN}` : 'Insertar'}
          hint={`Insertar ${colWord}`}
          items={[
            { icon: ArrowLeft,  label: `${colN > 1 ? colWord + ' izquierda' : 'Columna izquierda'}`, onClick: () => fireInsertCol('left') },
            { icon: ArrowRight, label: `${colN > 1 ? colWord + ' derecha'   : 'Columna derecha'}`,   onClick: () => fireInsertCol('right') },
          ]}
        />
        <MiniBtn icon={Trash2} danger
          disabled={!hasSel}
          onClick={() => state.tableRemoveColumns(tableEl.id, selColIds)}
          hint={`Eliminar ${selColIds.length || 0} columna(s)`}
        />
        <MiniBtn icon={AlignHorizontalSpaceAround}
          onClick={() => state.tableDistributeColumns(tableEl.id, multiSel ? selColIds : null)}
          hint={multiSel ? 'Distribuir columnas seleccionadas' : 'Distribuir todas las columnas'}
        />
      </Group>
      <Sep />
      <Group label="Celdas">
        <IconBtn icon={Combine} label="Combinar"
          disabled={!multiSel}
          onClick={() => state.tableMergeCells(tableEl.id, cells)}
          hint="Combinar celdas seleccionadas"
        />
        <IconBtn icon={Split} label="Descombinar"
          disabled={!hasSel || !tableHasSpan}
          onClick={() => state.tableUnmergeCells(tableEl.id, cells)}
          hint="Descombinar celdas combinadas"
        />
        <MiniBtn icon={Settings}
          disabled={!hasSel}
          onClick={() => setShowCellModal(true)}
          hint="Propiedades de celda..."
        />
      </Group>
      <Sep />
      <Group label="Estilo de celda">
        <ActiveStyleButton
          borderStyles={borderStyles}
          fillStyles={fillStylesAll}
          colors={colorsAll}
          activeId={sharedStyleRef}
          mixed={styleMixed}
          usageCount={styleUsageCount}
          onPick={id => state.tableApplyBorders?.(tableEl.id, cells, 'all', { borderStyleId: id })}
          onCreate={() => {
            // Fork a new cell-box style off the active one, apply it to the
            // selection, and open it in the sidebar + properties editor.
            const newId = state.addBorderStyle?.();
            if (newId) {
              state.tableApplyBorders?.(tableEl.id, cells, 'all', { borderStyleId: newId });
              state.setPanelContext?.(`borderStyle:${newId}`);
            }
          }}
        />
        <PenButton
          style={penView.style}
          width={penView.width}
          color={penView.color}
          colors={colorsAll}
          onEdit={editActiveLine}
          onCreateLineFillStyle={() => {
            // Create a fill style for the LINE color and link the active style
            // to it; open it in the resources editor to name/tweak.
            const newId = state.addFillStyle?.({ type: 'solid', color: penView.color });
            if (newId) {
              editActiveLine({ lineFillStyleId: newId, lineColor: penView.color });
              state.setPanelContext?.(`fillStyle:${newId}`);
            }
          }}
        />
        <ColorMenu
          label="Sombreado"
          colors={colorsAll}
          fillStyles={fillStylesAll}
          currentHex={activeFillHex}
          onPick={color => state.tableSetCellFill?.(tableEl.id, cells, color, sharedStyleRef ?? DEFAULT_BS_ID)}
          onPickFillStyle={fillStyleId => state.tableSetCellFill?.(tableEl.id, cells, { fillStyleId }, sharedStyleRef ?? DEFAULT_BS_ID)}
          onCreateFillStyle={() => {
            // Create a fill style, set it as the active cell-box style's fill,
            // and open it in the resources editor.
            const newId = state.addFillStyle?.({ type: 'solid', color: activeFillHex });
            if (newId) {
              state.tableSetCellFill?.(tableEl.id, cells, { fillStyleId: newId }, sharedStyleRef ?? DEFAULT_BS_ID);
              state.setPanelContext?.(`fillStyle:${newId}`);
            }
          }}
        />
        <DropdownBtn
          icon={Square}
          label="Bordes"
          hint={hasSel ? 'Aplicar a la selección' : 'Aplicar a toda la tabla'}
          items={[
            { icon: Grid3X3, label: 'Todos',       onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'all',    { borderStyleId: activeStyleId }) },
            { icon: Square,  label: 'Contorno',    onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'outer',  { borderStyleId: activeStyleId }) },
            { icon: Grid3X3, label: 'Interiores',  onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'inner',  { borderStyleId: activeStyleId }) },
            { icon: Trash2,  label: 'Sin borde',   onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'none') },
            { icon: ArrowUp,    label: 'Arriba',    onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'top',    { borderStyleId: activeStyleId }) },
            { icon: ArrowDown,  label: 'Abajo',     onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'bottom', { borderStyleId: activeStyleId }) },
            { icon: ArrowLeft,  label: 'Izquierda', onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'left',   { borderStyleId: activeStyleId }) },
            { icon: ArrowRight, label: 'Derecha',   onClick: () => state.tableApplyBorders?.(tableEl.id, cells, 'right',  { borderStyleId: activeStyleId }) },
          ]}
        />
        <IconBtn icon={Paintbrush2} label="Pintar bordes"
          active={!!state?.borderPainter?.active}
          hint="Pinta el borde más cercano al clic con el estilo activo. Shift o Ctrl + clic pinta los 4 bordes. Esc para salir."
          onClick={() => state.setBorderPainter?.(
            state?.borderPainter?.active ? null : { active: true, borderStyleId: activeStyleId }
          )}
        />
      </Group>
      <Sep />
      <Group label="Tabla">
        <MiniBtn icon={Trash2} danger
          onClick={() => state.removeElements?.([tableEl.id])}
          hint="Eliminar tabla"
        />
      </Group>
      {showCellModal && (
        <CellPropertiesModal
          tableEl={tableEl}
          cells={cells.length ? cells : (refCell() ? [refCell()] : [])}
          state={state}
          onClose={() => setShowCellModal(false)}
        />
      )}
    </>
  );
}

function ImagenTab({ state, selectedEl }) {
  const fit = selectedEl?.fit ?? 'contain';
  function setFit(v) { state.updateElement(selectedEl.id, { fit: v }); }
  return (
    <>
      <Group label="Ajuste">
        <IconBtn icon={Maximize2} label="Llenar"   onClick={() => setFit('fill')}    active={fit === 'fill'}    hint="fill — estira al contenedor" />
        <IconBtn icon={Image}     label="Contener" onClick={() => setFit('contain')} active={fit === 'contain'} hint="contain — entra completo" />
        <IconBtn icon={Crop}      label="Cubrir"   onClick={() => setFit('cover')}   active={fit === 'cover'}   hint="cover — cubre recortando" />
        <IconBtn icon={Minimize2} label="Original" onClick={() => setFit('none')}    active={fit === 'none'}    hint="none — tamaño original" />
      </Group>
      <Sep />
      <Group label="Acciones">
        <MiniBtn icon={Trash2} onClick={() => state.removeElements(state.selectedIds)} danger hint="Eliminar" />
      </Group>
    </>
  );
}

function FormaTab({ state, selectedEl }) {
  const sx = selectedEl?.scaleX ?? 1;
  const sy = selectedEl?.scaleY ?? 1;
  function flipH() { state.updateElement(selectedEl.id, { scaleX: -sx }); }
  function flipV() { state.updateElement(selectedEl.id, { scaleY: -sy }); }
  return (
    <>
      <Group label="Forma">
        <span className="rb__info" style={{ textTransform: 'capitalize' }}>{selectedEl?.shape ?? 'rectangle'}</span>
      </Group>
      <Sep />
      <Group label="Voltear">
        <IconBtn icon={FlipHorizontal2} label="Flip X" onClick={flipH} active={sx < 0} hint="Voltear horizontalmente" />
        <IconBtn icon={FlipVertical2}   label="Flip Y" onClick={flipV} active={sy < 0} hint="Voltear verticalmente" />
      </Group>
      <Sep />
      <Group label="Acciones">
        <MiniBtn icon={Trash2} onClick={() => state.removeElements(state.selectedIds)} danger hint="Eliminar" />
      </Group>
    </>
  );
}

function TextoTab({ state, showInvisibles, onToggleInvisibles }) {
  return (
    <div className="rb__textfmt-wrap">
      <TextFormatToolbar
        state={state}
        showInvisibles={showInvisibles}
        onToggleInvisibles={onToggleInvisibles}
      />
    </div>
  );
}

const TAB_CONTENT = {
  inicio:   InicioTab,
  insertar: InsertarTab,
  diseno:   DisenoTab,
  vista:    VistaTab,
  tabla:    TablaTab,
  imagen:   ImagenTab,
  forma:    FormaTab,
  texto:    TextoTab,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Ribbon
// ─────────────────────────────────────────────────────────────────────────────

export default function Ribbon({
  templateName,
  onSave,
  onClose,
  extraActions,
  state,
  showVarPreview,
  onToggleVarPreview,
  onOpenLayoutEditor,
  showInvisibles,
  onToggleInvisibles,
}) {
  const { selectedIds, currentPage, areaEditCtx, embeddedElementCtx, tableRowSetCtx, tableCellSelection, template } = state;
  const contentAreas = template?.contentAreas ?? [];

  // Resolve the active element. Lookup order:
  //   1. embeddedElementCtx → embedded element in the area pool
  //   2. selectedIds[0] → page element
  //   3. selectedIds[0] → embedded element anywhere (cell-edit on embedded table)
  const selectedEl = useMemo(() => {
    if (embeddedElementCtx?.elementId) {
      const caEl = (currentPage?.elements ?? []).find(el => el.id === embeddedElementCtx.caId);
      const resolvedAreas = state.resolveAreas?.(caEl) ?? caEl?.areas ?? [];
      const area = findAreaById(resolvedAreas, embeddedElementCtx.areaId);
      const found = (area?.elements ?? []).find(e => e.id === embeddedElementCtx.elementId);
      if (found) return found;
    }
    if (selectedIds.length === 1) {
      const id = selectedIds[0];
      const inPage = (currentPage?.elements ?? []).find(el => el.id === id);
      if (inPage) return inPage;
      const anywhere = findElementAnywhere(id, currentPage, contentAreas);
      if (anywhere) return anywhere;
    }
    return null;
  }, [selectedIds, currentPage, embeddedElementCtx, contentAreas, state]);

  // Owner of the active edit context (areaEditCtx.caId points at the element
  // that owns the area being edited — table id for cell edits, content area id
  // for inline area edits).
  const editingOwner = useMemo(
    () => findElementAnywhere(areaEditCtx?.caId, currentPage, contentAreas),
    [areaEditCtx, currentPage, contentAreas],
  );

  const isEditingText = !!areaEditCtx;
  const { tabs: contextualTabs, primary: primaryCtx } = getContextualTabs(selectedEl, isEditingText, tableRowSetCtx, editingOwner, tableCellSelection);

  const [manualTab, setManualTab] = useState('inicio');
  const [activeTab, setActiveTab] = useState('inicio');
  const lastPrimaryRef = useRef(null);

  // Auto-switch when the primary contextual tab changes (selection or edit-mode change)
  useEffect(() => {
    if (primaryCtx !== lastPrimaryRef.current) {
      lastPrimaryRef.current = primaryCtx;
      if (primaryCtx) setActiveTab(primaryCtx);
      else            setActiveTab(manualTab);
    }
  }, [primaryCtx, manualTab]);

  // If the active tab disappears (no longer applies), fall back gracefully
  useEffect(() => {
    const isFixed = FIXED_TABS.some(t => t.id === activeTab);
    if (!isFixed && !contextualTabs.includes(activeTab)) {
      setActiveTab(primaryCtx ?? manualTab);
    }
  }, [activeTab, contextualTabs, primaryCtx, manualTab]);

  function handleTabClick(id) {
    setActiveTab(id);
    if (FIXED_TABS.some(t => t.id === id)) setManualTab(id);
  }

  const TabContent = TAB_CONTENT[activeTab] ?? InicioTab;
  const activeIsCtx = contextualTabs.includes(activeTab);
  const activeCtxColor = activeIsCtx ? CONTEXTUAL_TABS[activeTab]?.color : null;

  return (
    <div className="rb">
      {/* Row 1 — header: name | tabs | save */}
      <div className="rb__header">
        <div className="rb__name" title={templateName}>{templateName}</div>

        <div className="rb__tabs">
          {FIXED_TABS.map(t => (
            <button
              key={t.id}
              className={`rb__tab${activeTab === t.id ? ' rb__tab--active' : ''}`}
              onClick={() => handleTabClick(t.id)}
            >
              {t.label}
            </button>
          ))}
          {contextualTabs.length > 0 && (
            <>
              <div className="rb__tabs-divider" />
              {contextualTabs.map(tabId => {
                const meta = CONTEXTUAL_TABS[tabId];
                return (
                  <button
                    key={tabId}
                    className={`rb__tab rb__tab--ctx rb__tab--ctx-${meta.color}${activeTab === tabId ? ' rb__tab--active' : ''}`}
                    onClick={() => handleTabClick(tabId)}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="rb__actions">
          {extraActions}
          <button className="rb__save" onClick={onSave}>
            <Save size={14} /> <span>Guardar</span>
          </button>
          <button className="rb__close" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Row 2 — icons of active tab */}
      <div className={`rb__content${activeCtxColor ? ` rb__content--ctx-${activeCtxColor}` : ''}`}>
        <TabContent
          state={state}
          selectedEl={selectedEl}
          showVarPreview={showVarPreview}
          onToggleVarPreview={onToggleVarPreview}
          onOpenLayoutEditor={onOpenLayoutEditor}
          showInvisibles={showInvisibles}
          onToggleInvisibles={onToggleInvisibles}
        />
      </div>
    </div>
  );
}
