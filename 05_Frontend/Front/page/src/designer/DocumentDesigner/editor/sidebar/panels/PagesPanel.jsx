import { useState, useEffect, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, Plus, Settings2, FileText,
  GitBranch, RefreshCw, Braces, Shuffle, Workflow, BarChart3,
  Minus, Layers, Images, Box, AlignLeft, Hash, Type as TypeIcon,
  AlignJustify, LayoutList,
} from 'lucide-react';
import PageFlowMapModal from '../../pages/PageFlowMapModal.jsx';
import OverflowFlowMapModal from '../../pages/OverflowFlowMapModal.jsx';

// ── Auto-open helpers ──────────────────────────────────────────────────────
//
// When the user enters cell-edit mode (double-click on a table cell), the tree
// in this panel should expand the full path from page down to that cell. We
// compute the chain of ids that need to be visible from the global editing
// state (`areaEditCtx` + `tableRowSetCtx`) and pass it down so each row can
// open itself via a `useEffect`.

// Find the table referenced by `tableId` and its containment chain.
function findTableInTemplate(template, tableId) {
  if (!tableId) return null;
  for (const page of (template?.pages ?? [])) {
    for (const el of (page.elements ?? [])) {
      if (el.id === tableId && el.type === 'table') {
        return { pageId: page.id, table: el, contentAreaElId: null, areaId: null };
      }
      if (el.type === 'contentarea') {
        // Pool model: el.areaRef → look up template.contentAreas
        const poolArea = template.contentAreas?.find(a => a.id === el.areaRef);
        const candidates = poolArea
          ? collectAreasInTree(poolArea)
          : (el.areas ?? []);
        for (const area of candidates) {
          for (const sub of (area.elements ?? [])) {
            if (sub.id === tableId && sub.type === 'table') {
              return { pageId: page.id, table: sub, contentAreaElId: el.id, areaId: area.id };
            }
          }
        }
      }
    }
  }
  return null;
}

function collectAreasInTree(root) {
  const out = [root];
  for (const child of (root.children ?? [])) {
    out.push(...collectAreasInTree(child));
  }
  return out;
}

// Find the rowSet + colId of the cell whose `flow.id === flowId`.
function findCellInTable(table, flowId) {
  for (const rs of (table.rowSets ?? [])) {
    for (const cell of (rs.cells ?? [])) {
      if (cell?.flow?.id === flowId) return { rowSetId: rs.id, colId: cell.colId };
    }
  }
  return null;
}

// Walk up the rowSet hierarchy from `rsId` collecting every ancestor id.
function rowSetAncestors(rowSets, rsId) {
  const set = new Set();
  let current = rsId;
  for (let i = 0; i < 50 && current; i++) {
    set.add(current);
    const parent = (rowSets ?? []).find(r =>
      (r.childIds ?? []).includes(current) ||
      r.firstHeaderId === current || r.headerId === current ||
      r.bodyId === current ||
      r.footerId === current || r.lastFooterId === current
    );
    if (!parent) break;
    current = parent.id;
  }
  return set;
}

// Compute the full set of node ids that should be force-opened in the tree.
function computeForceOpenIds(template, areaEditCtx, tableRowSetCtx, tableCellSelection) {
  const set = new Set();
  // Case 1: cell editing (areaEditCtx points at a table cell flow).
  if (areaEditCtx?.caId && areaEditCtx?.areaId) {
    const loc = findTableInTemplate(template, areaEditCtx.caId);
    if (loc) {
      set.add(loc.pageId);
      if (loc.contentAreaElId) set.add(loc.contentAreaElId);
      if (loc.areaId)          set.add(loc.areaId);
      set.add(loc.table.id);
      const cellLoc = findCellInTable(loc.table, areaEditCtx.areaId);
      if (cellLoc) {
        for (const rsId of rowSetAncestors(loc.table.rowSets ?? [], cellLoc.rowSetId)) {
          set.add(rsId);
        }
        set.add(cellLoc.colId);
      }
    }
  }
  // Case 2: tableRowSetCtx (panel navigation from tree).
  if (tableRowSetCtx?.elId) {
    const loc = findTableInTemplate(template, tableRowSetCtx.elId);
    if (loc) {
      set.add(loc.pageId);
      if (loc.contentAreaElId) set.add(loc.contentAreaElId);
      if (loc.areaId)          set.add(loc.areaId);
      set.add(loc.table.id);
    }
    if (tableRowSetCtx.rowSetId) {
      // Also open ancestors of the selected rowSet
      if (loc?.table?.rowSets) {
        for (const rsId of rowSetAncestors(loc.table.rowSets, tableRowSetCtx.rowSetId)) {
          set.add(rsId);
        }
      } else {
        set.add(tableRowSetCtx.rowSetId);
      }
    }
    if (tableRowSetCtx.colId)      set.add(tableRowSetCtx.colId);
    if (tableRowSetCtx.areaColId)  set.add(tableRowSetCtx.areaColId);
    if (tableRowSetCtx.subAreaId)  set.add(tableRowSetCtx.subAreaId);
  }
  // Case 3: tableCellSelection (drag-selected cells on the canvas). Expand
  // only the ancestors — page, contentArea/area, table, rowSet(s) — so each
  // selected cell row becomes VISIBLE in the tree. We intentionally DON'T add
  // each cell's colId: that would also auto-expand the cell's inner "flow"
  // sub-area, and with multi-cell drag-select that gets noisy fast. The blue
  // highlight on the cell row itself is driven separately via
  // tableCellSelectionKeys → CellNode.isSelected.
  if (tableCellSelection?.tableElId && (tableCellSelection.cells ?? []).length) {
    const loc = findTableInTemplate(template, tableCellSelection.tableElId);
    if (loc) {
      set.add(loc.pageId);
      if (loc.contentAreaElId) set.add(loc.contentAreaElId);
      if (loc.areaId)          set.add(loc.areaId);
      set.add(loc.table.id);
      const rowSets = loc.table.rowSets ?? [];
      for (const cell of tableCellSelection.cells) {
        if (cell?.rowSetId) {
          for (const rsId of rowSetAncestors(rowSets, cell.rowSetId)) set.add(rsId);
        }
      }
    }
  }
  return set;
}

// ── Page config helpers ────────────────────────────────────────────────────

function pcModeIcon(pc) {
  if (!pc) return <FileText size={13} />;
  if (pc.pageSelection === 'simple') return <FileText size={13} />;
  const ts = pc.typeSelection?.type;
  if (ts === 'condition') return <GitBranch size={13} />;
  if (ts === 'script')    return <Braces size={13} />;
  if (pc.repeatedBy?.enabled) return <RefreshCw size={13} />;
  return <Shuffle size={13} />;
}

function pcModeLabel(pc) {
  if (!pc || pc.pageSelection === 'simple') return 'Simple';
  const ts  = pc.typeSelection?.type ?? 'simple';
  const rep = pc.repeatedBy?.enabled;
  const labels = { simple: 'Simple', text: 'Por texto', number: 'Por número',
                   bool: 'Bool', condition: 'Condición', script: 'Script' };
  return `${rep ? 'Repetir · ' : ''}${labels[ts] ?? ts}`;
}

function AreaFlowIcon({ flowType }) {
  if (flowType === 'repeated')         return <RefreshCw size={9} />;
  if (flowType === 'inline-condition') return <GitBranch size={9} />;
  return <Layers size={9} />;
}

// ── Element type metadata ──────────────────────────────────────────────────

const ELEMENT_TYPE_META = {
  text:      { label: 'Texto',            Icon: TypeIcon  },
  shape:     { label: 'Forma',            Icon: Box       },
  image:     { label: 'Imagen',           Icon: Images    },
  table:     { label: 'Tabla',            Icon: AlignLeft },
  qr:        { label: 'Código QR',        Icon: Hash      },
  barcode:   { label: 'Código de barras', Icon: Minus     },
  chart:     { label: 'Gráfico',          Icon: BarChart3 },
};

// ── RowSet tree constants ──────────────────────────────────────────────────

const RS_TYPE_LABELS = {
  'header-footer':       'cab./pie',
  'single-row':          'fila simple',
  'multiple-rows':       'múltiples filas',
  'repeated':            'repetición',
  'select-by-condition': 'condición',
  'select-by-integer':   'por entero',
  'select-by-interval':  'por intervalo',
  'select-by-text':      'por texto',
  'select-by-inline':    'inline',
};

const SLOT_COLORS = {
  firstHeader: '#1d4ed8',
  header:      '#0369a1',
  body:        '#6d28d9',
  footer:      '#15803d',
  lastFooter:  '#166534',
};

const SLOT_LABELS = {
  firstHeader: '1ª Cab.',
  header:      'Cabecera',
  body:        'Cuerpo',
  footer:      'Pie',
  lastFooter:  'Últ. Pie',
};

const RS_ICON_MAP = {
  'single-row':    { Icon: Minus,        color: '#3b82f6' },
  'multiple-rows': { Icon: AlignJustify, color: '#8b5cf6' },
  'repeated':      { Icon: RefreshCw,    color: '#0d9488' },
  'header-footer': { Icon: LayoutList,   color: '#d97706' },
};
function getRsIcon(type) {
  if (type?.startsWith('select-by')) return { Icon: GitBranch, color: '#b45309' };
  return RS_ICON_MAP[type] ?? { Icon: Minus, color: '#64748b' };
}

// ── EmbeddedElementRow ─────────────────────────────────────────────────────

function EmbeddedElementRow({ element, areaId, depth, shared }) {
  const { caId, pageIdx, selectEmbeddedElement, removeEmbeddedElement, embeddedElementCtx, setCurrentPageIndex } = shared;
  const isSelected = embeddedElementCtx?.elementId === element.id && embeddedElementCtx?.areaId === areaId;
  const meta = ELEMENT_TYPE_META[element.type] ?? { label: element.type ?? 'Elemento', Icon: Box };
  const { label, Icon } = meta;

  return (
    <div
      className={`dsb-tree-embedded${isSelected ? ' dsb-tree-embedded--selected' : ''}`}
      style={{ paddingLeft: 10 + depth * 12 }}
      onClick={e => { e.stopPropagation(); setCurrentPageIndex(pageIdx); selectEmbeddedElement?.(caId, areaId, element.id); }}
    >
      <span className="dsb-tree-area__spacer" />
      <Icon size={10} className="dsb-tree-embedded__icon" />
      <span className="dsb-tree-embedded__name">{label}</span>
      <span className="dsb-tree-area__actions">
        <button
          className="dsb-tree-area__btn dsb-tree-area__btn--del"
          title="Eliminar elemento"
          onClick={e => { e.stopPropagation(); setCurrentPageIndex(pageIdx); removeEmbeddedElement?.(caId, areaId, element.id); }}
        >
          <Minus size={10} />
        </button>
      </span>
    </div>
  );
}

// ── EmbeddedTableRow ────────────────────────────────────────────────────────

function EmbeddedTableRow({ element, areaId, depth, shared }) {
  const [open, setOpen] = useState(false);
  const {
    caId, pageIdx,
    selectEmbeddedElement, embeddedElementCtx,
    setCurrentPageIndex, setTableRowSetCtx, setPanelContext,
    enterAreaEdit,
    forceOpenIds,
    tableCellSelection, tableCellSelectionKeys,
  } = shared;
  // Scope drag-select keys to THIS table only. If the canvas selection points
  // at a different table, this row shouldn't show any cell highlights.
  const selKeysForThisTable = (tableCellSelection?.tableElId === element.id)
    ? tableCellSelectionKeys
    : null;
  // Auto-open this embedded table when it's on the editing path.
  useEffect(() => {
    if (forceOpenIds?.has(element.id)) setOpen(true);
  }, [forceOpenIds, element.id]);

  const tableRowSetCtx = shared.tableRowSetCtx;
  const isSelected = embeddedElementCtx?.elementId === element.id && embeddedElementCtx?.areaId === areaId;
  const selectedRowSetId  = (isSelected && tableRowSetCtx?.elId === element.id) ? tableRowSetCtx.rowSetId  : null;
  const selectedColId     = (isSelected && tableRowSetCtx?.elId === element.id) ? tableRowSetCtx.colId     : null;
  const selectedAreaColId = (isSelected && tableRowSetCtx?.elId === element.id) ? tableRowSetCtx.areaColId : null;

  const rowSets = element.rowSets ?? [];
  const root = rowSets.find(r => r.id === element.rootRowSetId);

  function activateEmbedded(e) {
    e?.stopPropagation();
    setCurrentPageIndex(pageIdx);
    selectEmbeddedElement?.(caId, areaId, element.id);
  }

  function selectRowSet(rowSetId) {
    setCurrentPageIndex(pageIdx);
    selectEmbeddedElement?.(caId, areaId, element.id);
    setTableRowSetCtx?.({ elId: element.id, rowSetId });
    setPanelContext?.('element');
  }

  function selectCell(rowSetId, colId) {
    setCurrentPageIndex(pageIdx);
    selectEmbeddedElement?.(caId, areaId, element.id);
    setTableRowSetCtx?.({ elId: element.id, rowSetId, colId });
    setPanelContext?.('element');
  }

  function selectArea(rowSetId, colId) {
    setCurrentPageIndex(pageIdx);
    selectEmbeddedElement?.(caId, areaId, element.id);
    setTableRowSetCtx?.({ elId: element.id, rowSetId, areaColId: colId });
    setPanelContext?.('element');
  }

  function selectSubArea(rowSetId, colId, subAreaId) {
    setCurrentPageIndex(pageIdx);
    selectEmbeddedElement?.(caId, areaId, element.id);
    setTableRowSetCtx?.({ elId: element.id, rowSetId, areaColId: colId, subAreaId });
    setPanelContext?.('element');
  }

  // enterTableCellEdit must NOT be used here — it sets areaEditCtxRef to the embedded table ID
  // (not a page element), which corrupts addElement / removeElements routing for all subsequent ops.
  function enterMiniCanvas(rowSetId, colId, subAreaId) {
    setCurrentPageIndex(pageIdx);
    if (subAreaId) {
      enterAreaEdit?.(caId, subAreaId, { miniCanvas: true });
    } else if (colId) {
      const rs = (element.rowSets ?? []).find(r => r.id === rowSetId);
      const cell = (rs?.cells ?? []).find(c => c.colId === colId);
      const flowId = cell?.flow?.id;
      enterAreaEdit?.(caId, flowId ?? areaId, { miniCanvas: true });
    } else {
      enterAreaEdit?.(caId, areaId, { miniCanvas: true });
    }
  }

  return (
    <div>
      <div
        className={`dsb-tree-el${isSelected && !selectedRowSetId ? ' dsb-tree-el--selected' : ''}`}
        style={{ paddingLeft: 10 + depth * 12 }}
        onClick={activateEmbedded}
      >
        {root
          ? <button className="dsb-tree-area__caret" onClick={e => { e.stopPropagation(); setOpen(v => !v); }}>
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          : <span className="dsb-tree-el__spacer" />
        }
        <AlignLeft size={10} className="dsb-tree-el__icon" />
        <span className="dsb-tree-el__name">{element.label ?? 'Tabla'}</span>
      </div>
      {open && root && (
        <RowSetNode
          rs={root}
          rowSets={rowSets}
          columns={element.columns ?? []}
          depth={depth + 1}
          selectedId={selectedRowSetId}
          selectedColId={selectedColId}
          selectedAreaColId={selectedAreaColId}
          onSelect={selectRowSet}
          onSelectCell={selectCell}
          onSelectArea={selectArea}
          onSelectSubArea={selectSubArea}
          onEnterMiniCanvas={enterMiniCanvas}
          slotKey={null}
          forceOpenIds={forceOpenIds}
          selectedCellKeys={selKeysForThisTable}
        />
      )}
    </div>
  );
}

// ── AreaRow ────────────────────────────────────────────────────────────────

function AreaRow({ area, isTopLevel, depth, shared }) {
  const [open, setOpen] = useState(true);
  const { caId, pageIdx, areaEditCtx, focusedAreaCtx, enterAreaEdit, setFocusedAreaCtx, clearSelection, removeArea, setCurrentPageIndex, setPanelContext, forceOpenIds } = shared;
  // Auto-open this area when it's on the current editing path.
  useEffect(() => {
    if (forceOpenIds?.has(area.id)) setOpen(true);
  }, [forceOpenIds, area.id]);
  const children    = area.children ?? [];
  const embeddedEls = (area.elements ?? []).filter(e => e.embedded);
  const hasChildren = children.length > 0 || embeddedEls.length > 0;
  const isActive  = areaEditCtx?.areaId === area.id;
  const isFocused = !isActive && focusedAreaCtx?.caId === caId && focusedAreaCtx?.areaId === area.id;

  function handleClick() {
    setCurrentPageIndex(pageIdx);
    clearSelection();
    setFocusedAreaCtx({ caId, areaId: area.id });
    setPanelContext('element');
  }

  function handleDoubleClick() {
    setCurrentPageIndex(pageIdx);
    enterAreaEdit(caId, area.id, { miniCanvas: true });
  }

  return (
    <>
      <div
        className={`dsb-tree-area${isActive ? ' dsb-tree-area--active' : ''}${isFocused ? ' dsb-tree-area--focused' : ''}`}
        style={{ paddingLeft: 10 + depth * 12 }}
        title={area.label || 'Área'}
      >
        {hasChildren
          ? <button className="dsb-tree-area__caret" onClick={e => { e.stopPropagation(); setOpen(v => !v); }}>
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          : <span className="dsb-tree-area__spacer" />
        }
        <span className="dsb-tree-area__badge" onClick={handleClick} onDoubleClick={handleDoubleClick} style={{ cursor: 'pointer' }} title={area.flowType ?? 'simple'}>
          <AreaFlowIcon flowType={area.flowType} />
        </span>
        <span
          className="dsb-tree-area__name"
          style={{ cursor: 'pointer' }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          {area.label || 'Área'}
        </span>
        <span className="dsb-tree-area__actions">
          {!isTopLevel && (
            <button className="dsb-tree-area__btn dsb-tree-area__btn--del" title="Eliminar área" onClick={e => { e.stopPropagation(); setCurrentPageIndex(pageIdx); removeArea(caId, area.id); }}>
              <Minus size={10} />
            </button>
          )}
        </span>
      </div>
      {open && embeddedEls.map(emEl => (
        emEl.type === 'table'
          ? <EmbeddedTableRow key={emEl.id} element={emEl} areaId={area.id} depth={depth + 1} shared={shared} />
          : <EmbeddedElementRow key={emEl.id} element={emEl} areaId={area.id} depth={depth + 1} shared={shared} />
      ))}
      {open && children.map(child => (
        <AreaRow key={child.id} area={child} isTopLevel={false} depth={depth + 1} shared={shared} />
      ))}
    </>
  );
}

// ── ContentAreaRow ─────────────────────────────────────────────────────────

function ContentAreaRow({ el, pageIdx, state, depth, forceOpenIds, tableCellSelectionKeys }) {
  const [open, setOpen] = useState(true);
  const { selectedIds, selectElement, clearSelection, setCurrentPageIndex, areaEditCtx, focusedAreaCtx, enterAreaEdit, exitAreaEdit, setFocusedAreaCtx, addArea, removeArea, resolveAreas, selectEmbeddedElement, removeEmbeddedElement, embeddedElementCtx, tableRowSetCtx, enterTableCellEdit, tableCellSelection } = state;
  const isSelected = selectedIds.includes(el.id);
  const areas = resolveAreas?.(el) ?? el.areas ?? [];

  // Auto-open this row when it's on the current editing path.
  useEffect(() => {
    if (forceOpenIds?.has(el.id)) setOpen(true);
  }, [forceOpenIds, el.id]);

  const shared = {
    caId: el.id, pageIdx, areaEditCtx, focusedAreaCtx,
    enterAreaEdit, exitAreaEdit, setFocusedAreaCtx, clearSelection,
    addArea, removeArea, setCurrentPageIndex,
    setPanelContext: state.setPanelContext,
    selectEmbeddedElement, removeEmbeddedElement,
    embeddedElementCtx, tableRowSetCtx,
    setTableRowSetCtx: state.setTableRowSetCtx,
    enterTableCellEdit,
    forceOpenIds, // propagated to descendants so they can auto-open too
    tableCellSelection,           // raw selection state, so embedded tables can scope by tableElId
    tableCellSelectionKeys,       // precomputed "rowSetId:colId" set (whole sel, not yet scoped)
  };

  function handleClick(e) {
    e.stopPropagation();
    setCurrentPageIndex(pageIdx);
    if (areaEditCtx) exitAreaEdit?.();
    selectElement(el.id, false);
  }

  function countAreas(arr) { return arr.reduce((s, a) => s + 1 + countAreas(a.children ?? []), 0); }

  return (
    <div className="dsb-tree-ca">
      <div
        className={`dsb-tree-ca__row${isSelected ? ' dsb-tree-ca__row--selected' : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={handleClick}
      >
        <button
          className="dsb-tree-ca__caret"
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        >
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <FileText size={11} className="dsb-tree-ca__icon" />
        <span className="dsb-tree-ca__name">{el.label ?? 'CA'}</span>
        <span className="dsb-tree-ca__count">{countAreas(areas)}</span>
      </div>
      {open && areas.map(area => (
        <AreaRow key={area.id} area={area} isTopLevel={true} depth={depth + 1} shared={shared} />
      ))}
    </div>
  );
}

// ── ElementRow ─────────────────────────────────────────────────────────────

function ElementRow({ el, pageIdx, state, depth = 1 }) {
  const { selectedIds, selectElement, setCurrentPageIndex } = state;
  const isSelected = (selectedIds ?? []).includes(el.id);
  const meta = ELEMENT_TYPE_META[el.type] ?? { label: el.type ?? 'Elemento', Icon: Box };
  const { label, Icon } = meta;

  // Nombre distinto por elemento: label propio → título (gráficos) → "Tipo N"
  // numerado entre hermanos del mismo tipo (evita "chart, chart, chart").
  const pageEls = state.template?.pages?.[pageIdx]?.elements ?? [];
  const sameType = pageEls.filter(e => e.type === el.type);
  const idx = sameType.findIndex(e => e.id === el.id);
  const numbered = sameType.length > 1 ? `${label} ${idx + 1}` : label;
  const displayName = el.label
    || (el.type === 'chart' && el.title?.trim() ? el.title : null)
    || numbered;

  return (
    <div
      className={`dsb-tree-el${isSelected ? ' dsb-tree-el--selected' : ''}`}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={e => { e.stopPropagation(); setCurrentPageIndex(pageIdx); selectElement(el.id, false); }}
      title={displayName}
    >
      <span className="dsb-tree-el__spacer" />
      <Icon size={11} className="dsb-tree-el__icon" />
      <span className="dsb-tree-el__name">{displayName}</span>
    </div>
  );
}

// ── CellFlowChildRow ───────────────────────────────────────────────────────

function CellFlowChildRow({ area, depth, onSelect, onEnterMiniCanvas }) {
  const [open, setOpen] = useState(true);
  const children = area.children ?? [];
  const hasChildren = children.length > 0;

  return (
    <>
      <div
        className="dsb-tree-flow"
        style={{ paddingLeft: 4 + depth * 12, cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); onSelect?.(area.id); }}
        onDoubleClick={e => { e.stopPropagation(); onEnterMiniCanvas?.(area.id); }}
      >
        {hasChildren
          ? <button className="dsb-tree-area__caret" onClick={e => { e.stopPropagation(); setOpen(v => !v); }}>
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          : <span className="dsb-tree-el__spacer" />
        }
        <Layers size={10} className="dsb-tree-flow__icon" />
        <span className="dsb-tree-flow__label">{area.label ?? area.id}</span>
      </div>
      {open && children.map(child => (
        <CellFlowChildRow key={child.id} area={child} depth={depth + 1} onSelect={onSelect} onEnterMiniCanvas={onEnterMiniCanvas} />
      ))}
    </>
  );
}

// ── CellNode ───────────────────────────────────────────────────────────────

function CellNode({ col, rs, depth, isSelected, isAreaSelected, onSelect, onSelectArea, onSelectSubArea, onEnterMiniCanvas, forceOpenIds }) {
  const [open, setOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(true);

  const cell = (rs.cells ?? []).find(c => c.colId === col.id);
  const flowChildren = cell?.flow?.children ?? [];
  const hasFlowChildren = flowChildren.length > 0;

  // Auto-open this cell when it's on the editing path. The cell is identified
  // by its col.id; we also open the inner "flow" area when the cell is targeted.
  useEffect(() => {
    if (!forceOpenIds) return;
    if (forceOpenIds.has(col.id)) {
      setOpen(true);
      setFlowOpen(true);
    }
    if (cell?.flow?.id && forceOpenIds.has(cell.flow.id)) {
      setOpen(true);
      setFlowOpen(true);
    }
  }, [forceOpenIds, col.id, cell?.flow?.id]);

  return (
    <>
      <div
        className={`dsb-tree-cell${isSelected ? ' dsb-tree-cell--selected' : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => onSelect(col.id)}
      >
        <button className="dsb-tree-area__caret" onClick={e => { e.stopPropagation(); setOpen(v => !v); }}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <span className="dsb-tree-cell__icon">▣</span>
        <span className="dsb-tree-cell__label">{cell?.label ?? col.label ?? col.id}</span>
        <span className="dsb-tree-cell__type">cell</span>
      </div>
      {open && (
        <>
          <div
            className={`dsb-tree-flow${isAreaSelected ? ' dsb-tree-flow--selected' : ''}`}
            style={{ paddingLeft: 4 + (depth + 1) * 12 }}
            onClick={e => { e.stopPropagation(); onSelectArea?.(col.id); }}
            onDoubleClick={e => { e.stopPropagation(); onEnterMiniCanvas?.(col.id, null); }}
          >
            {hasFlowChildren
              ? <button className="dsb-tree-area__caret" onClick={e => { e.stopPropagation(); setFlowOpen(v => !v); }}>
                  {flowOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
              : <span className="dsb-tree-el__spacer" />
            }
            <Layers size={10} className="dsb-tree-flow__icon" />
            <span className="dsb-tree-flow__label">{cell?.flow?.label ?? ('Área ' + (cell?.label ?? col.label ?? col.id))}</span>
          </div>
          {hasFlowChildren && flowOpen && flowChildren.map(child => (
            <CellFlowChildRow
              key={child.id}
              area={child}
              depth={depth + 2}
              onSelect={subAreaId => onSelectSubArea?.(col.id, subAreaId)}
              onEnterMiniCanvas={subAreaId => onEnterMiniCanvas?.(col.id, subAreaId)}
            />
          ))}
        </>
      )}
    </>
  );
}

// ── RowSetNode ─────────────────────────────────────────────────────────────

function RowSetNode({ rs, rowSets, columns, depth, selectedId, selectedColId, selectedAreaColId, onSelect, onSelectCell, onSelectArea, onSelectSubArea, onEnterMiniCanvas, slotKey, forceOpenIds, selectedCellKeys }) {
  const [open, setOpen] = useState(depth < 2);
  // Auto-open this rowSet when it's on the editing path.
  useEffect(() => {
    if (forceOpenIds?.has(rs.id)) setOpen(true);
  }, [forceOpenIds, rs.id]);
  const isSelected = selectedId === rs.id && !selectedColId;
  const dotColor = slotKey ? (SLOT_COLORS[slotKey] ?? '#6b7280') : '#6b7280';

  let childEntries = [];
  if (rs.type === 'header-footer') {
    childEntries = [
      rs.firstHeaderId ? { slotKey: 'firstHeader', id: rs.firstHeaderId } : null,
      rs.headerId      ? { slotKey: 'header',      id: rs.headerId }      : null,
      rs.bodyId        ? { slotKey: 'body',        id: rs.bodyId }        : null,
      rs.footerId      ? { slotKey: 'footer',      id: rs.footerId }      : null,
      rs.lastFooterId  ? { slotKey: 'lastFooter',  id: rs.lastFooterId }  : null,
    ].filter(Boolean);
  } else if (rs.type === 'multiple-rows' || rs.type === 'repeated') {
    childEntries = (rs.childIds ?? []).map(id => ({ slotKey: null, id }));
  }

  const hasCells    = rs.type === 'single-row' && (columns ?? []).length > 0;
  const hasChildren = childEntries.length > 0 || hasCells;

  return (
    <>
      <div
        className={`dsb-tree-rs${isSelected ? ' dsb-tree-rs--selected' : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => onSelect(rs.id)}
      >
        {hasChildren
          ? <button className="dsb-tree-area__caret" onClick={e => { e.stopPropagation(); setOpen(v => !v); }}>
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          : <span className="dsb-tree-el__spacer" />
        }
        {(() => { const { Icon: RsIcon, color: rsColor } = getRsIcon(rs.type); return <RsIcon size={9} style={{ flexShrink: 0, marginRight: 3, color: slotKey ? dotColor : rsColor }} />; })()}
        <span className="dsb-tree-rs__name">{rs.name ?? rs.id}</span>
        <span className="dsb-tree-rs__type">({RS_TYPE_LABELS[rs.type] ?? rs.type})</span>
      </div>
      {open && hasCells && (columns ?? []).map(col => (
        <CellNode
          key={col.id}
          col={col}
          rs={rs}
          depth={depth + 1}
          isSelected={
            (selectedId === rs.id && selectedColId === col.id && !selectedAreaColId)
            || !!selectedCellKeys?.has(`${rs.id}:${col.id}`)
          }
          isAreaSelected={selectedId === rs.id && selectedAreaColId === col.id}
          onSelect={colId => onSelectCell?.(rs.id, colId)}
          onSelectArea={colId => onSelectArea?.(rs.id, colId)}
          onSelectSubArea={(colId, subAreaId) => onSelectSubArea?.(rs.id, colId, subAreaId)}
          onEnterMiniCanvas={(colId, subAreaId) => onEnterMiniCanvas?.(rs.id, colId, subAreaId)}
          forceOpenIds={forceOpenIds}
        />
      ))}
      {open && childEntries.map((entry, i) => {
        const childRS = rowSets.find(r => r.id === entry.id);
        if (!childRS) return null;
        return (
          <RowSetNode
            key={`${entry.slotKey ?? entry.id}:${i}`}
            rs={childRS}
            rowSets={rowSets}
            columns={columns}
            depth={depth + 1}
            selectedId={selectedId}
            selectedColId={selectedColId}
            selectedAreaColId={selectedAreaColId}
            onSelect={onSelect}
            onSelectCell={onSelectCell}
            onSelectArea={onSelectArea}
            onSelectSubArea={onSelectSubArea}
            onEnterMiniCanvas={onEnterMiniCanvas}
            slotKey={entry.slotKey}
            forceOpenIds={forceOpenIds}
            selectedCellKeys={selectedCellKeys}
          />
        );
      })}
    </>
  );
}

// ── TableElementRow ────────────────────────────────────────────────────────

function TableElementRow({ el, pageIdx, state, depth = 1, forceOpenIds, tableCellSelectionKeys }) {
  const [open, setOpen] = useState(false);
  const { selectedIds, selectElement, setCurrentPageIndex, tableRowSetCtx, setTableRowSetCtx, setPanelContext, tableCellSelection } = state;
  // Scope drag-select keys to THIS table.
  const selKeysForThisTable = (tableCellSelection?.tableElId === el.id)
    ? tableCellSelectionKeys
    : null;
  const isSelected = (selectedIds ?? []).includes(el.id);
  // Auto-open this table when it's on the editing path.
  useEffect(() => {
    if (forceOpenIds?.has(el.id)) setOpen(true);
  }, [forceOpenIds, el.id]);

  const rowSets = el.rowSets ?? [];
  const root = rowSets.find(r => r.id === el.rootRowSetId);
  const selectedRowSetId  = (tableRowSetCtx?.elId === el.id) ? tableRowSetCtx.rowSetId : null;
  const selectedColId     = (tableRowSetCtx?.elId === el.id) ? tableRowSetCtx.colId : null;
  const selectedAreaColId = (tableRowSetCtx?.elId === el.id) ? tableRowSetCtx.areaColId : null;

  function handleClick(e) {
    e.stopPropagation();
    setCurrentPageIndex(pageIdx);
    selectElement(el.id, false);
    setTableRowSetCtx?.(null);
    setPanelContext?.('element');
  }

  function selectRowSet(rowSetId) {
    setCurrentPageIndex(pageIdx);
    selectElement(el.id, false);
    setTableRowSetCtx?.({ elId: el.id, rowSetId });
    setPanelContext?.('element');
  }

  function selectCell(rowSetId, colId) {
    setCurrentPageIndex(pageIdx);
    selectElement(el.id, false);
    setTableRowSetCtx?.({ elId: el.id, rowSetId, colId });
    setPanelContext?.('element');
  }

  function selectArea(rowSetId, colId) {
    setCurrentPageIndex(pageIdx);
    selectElement(el.id, false);
    setTableRowSetCtx?.({ elId: el.id, rowSetId, areaColId: colId });
    setPanelContext?.('element');
  }

  function selectSubArea(rowSetId, colId, subAreaId) {
    setCurrentPageIndex(pageIdx);
    selectElement(el.id, false);
    setTableRowSetCtx?.({ elId: el.id, rowSetId, areaColId: colId, subAreaId });
    setPanelContext?.('element');
  }

  function enterSubAreaMiniCanvas(rowSetId, colId, subAreaId) {
    setCurrentPageIndex(pageIdx);
    selectElement(el.id, false);
    state.enterAreaEdit?.(el.id, subAreaId, { miniCanvas: true });
  }

  if (!root) {
    return <ElementRow el={el} pageIdx={pageIdx} state={state} depth={depth} />;
  }

  return (
    <div>
      <div
        className={`dsb-tree-el${isSelected && !selectedRowSetId ? ' dsb-tree-el--selected' : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={handleClick}
      >
        <button
          className="dsb-tree-area__caret"
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        >
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <AlignLeft size={11} className="dsb-tree-el__icon" />
        <span className="dsb-tree-el__name">{el.label ?? 'Tabla'}</span>
      </div>

      {open && (
        <RowSetNode
          rs={root}
          rowSets={rowSets}
          columns={el.columns ?? []}
          depth={depth + 1}
          selectedId={selectedRowSetId}
          selectedColId={selectedColId}
          selectedAreaColId={selectedAreaColId}
          onSelect={selectRowSet}
          onSelectCell={selectCell}
          onSelectArea={selectArea}
          onSelectSubArea={selectSubArea}
          onEnterMiniCanvas={enterSubAreaMiniCanvas}
          slotKey={null}
          forceOpenIds={forceOpenIds}
          selectedCellKeys={selKeysForThisTable}
        />
      )}
    </div>
  );
}

// ── PagesPanel ─────────────────────────────────────────────────────────────

export function PagesPanel({ template, state }) {
  const { pages, currentPageIndex, setCurrentPageIndex, addPage, panelContext, setPanelContext, selectedIds, areaEditCtx, exitAreaEdit, tableRowSetCtx, tableCellSelection } = state;
  const pc = template?.pagesConfig;
  const pcSelected = panelContext === 'pagesConfig';
  const [showMapModal, setShowMapModal] = useState(false);
  const [showOverflowMapModal, setShowOverflowMapModal] = useState(false);
  const [expandedPages, setExpandedPages] = useState(() => new Set());

  // Ids that must be force-opened in the tree because they're on the current
  // editing path (cell being edited, rowSet/cell selected via the panel, or
  // cells drag-selected on the canvas). Each row component reads this set and
  // auto-opens itself via useEffect.
  const forceOpenIds = useMemo(
    () => computeForceOpenIds(template, areaEditCtx, tableRowSetCtx, tableCellSelection),
    [template, areaEditCtx, tableRowSetCtx, tableCellSelection]
  );

  // Set of "rowSetId:colId" keys for the drag-selected cells on the canvas.
  // Passed down to CellNode so each selected cell gets the blue highlight in
  // the tree — solves "I selected cells but can't find them in the tree".
  // Scoped to a SINGLE table (tableElId): only that table's CellNodes use it.
  const tableCellSelectionKeys = useMemo(() => {
    const cells = tableCellSelection?.cells ?? [];
    if (!cells.length) return null;
    return new Set(cells.map(c => `${c.rowSetId}:${c.colId}`));
  }, [tableCellSelection]);

  useEffect(() => {
    if (!selectedIds?.length) return;
    const page = pages[currentPageIndex];
    if (!page) return;
    const hasSelected = (page.elements ?? []).some(el => selectedIds.includes(el.id));
    if (hasSelected) {
      setExpandedPages(prev => {
        if (prev.has(page.id)) return prev;
        const next = new Set(prev);
        next.add(page.id);
        return next;
      });
    }
  }, [selectedIds, currentPageIndex, pages]);

  // Auto-add to expandedPages any page that's on the editing path. Also
  // switches the current page so the tree-active page matches the one with
  // the selection — otherwise drag-selecting cells in an embedded table on
  // page 2 wouldn't expand page 2's branch.
  useEffect(() => {
    if (!forceOpenIds.size) return;
    for (let idx = 0; idx < (pages?.length ?? 0); idx++) {
      const page = pages[idx];
      if (forceOpenIds.has(page.id)) {
        setExpandedPages(prev => {
          if (prev.has(page.id)) return prev;
          const next = new Set(prev);
          next.add(page.id);
          return next;
        });
        if (tableCellSelection?.tableElId && idx !== currentPageIndex) {
          setCurrentPageIndex(idx);
        }
      }
    }
  // currentPageIndex/setCurrentPageIndex intentionally NOT in deps to avoid
  // a loop: this effect *sets* the page index when needed; the change in
  // forceOpenIds drives it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpenIds, pages, tableCellSelection]);

  function togglePage(pageId) {
    setExpandedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  return (
    <div className="dsb-pages-tab">
      <div className="dsb-section dsb-section--pages">
      <div className="dsb-pc-root">

        <div
          className={`dsb-pc-root__row${pcSelected ? ' dsb-pc-root__row--active' : ''}`}
          onClick={() => setPanelContext(pcSelected ? null : 'pagesConfig')}
          title="Propiedades de Pages Config"
        >
          <ChevronDown size={12} className="dsb-pc-root__caret" />
          {pcModeIcon(pc)}
          <span className="dsb-pc-root__label">Pages Config</span>
          <span className="dsb-pc-root__mode">{pcModeLabel(pc)}</span>
          <Settings2
            size={13}
            className={`dsb-pc-root__cfg-icon${pcSelected ? ' dsb-pc-root__cfg-icon--active' : ''}`}
            title="Abrir propiedades"
          />
          <button
            className="dsb-pc-root__add"
            onClick={e => { e.stopPropagation(); addPage(); }}
            title="Nueva página"
          >
            <Plus size={11} />
          </button>
        </div>

        <div className="dsb-pc-pages" style={{ paddingBottom: 0 }}>
          {pages.map((page, idx) => {
            const pageCtx   = `page:${page.id}`;
            const pageProps = panelContext === pageCtx;
            const isActive  = idx === currentPageIndex;
            const allEls    = page.elements ?? [];
            const hasEls    = allEls.length > 0;
            const expanded  = expandedPages.has(page.id);

            return (
              <div key={page.id}>
                <div
                  className={`dsb-pc-page${isActive ? ' dsb-pc-page--active' : ''}${!page.visible ? ' dsb-pc-page--hidden' : ''}`}
                  onClick={() => { setCurrentPageIndex(idx); setPanelContext(pageCtx); }}
                  onDoubleClick={() => { if (areaEditCtx) exitAreaEdit?.(); }}
                  title={page.name}
                >
                  {hasEls ? (
                    <button
                      className="dsb-pc-page__caret"
                      onClick={e => { e.stopPropagation(); togglePage(page.id); }}
                    >
                      {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    </button>
                  ) : (
                    <span className="dsb-pc-page__caret dsb-pc-page__caret--spacer" />
                  )}
                  <FileText size={11} />
                  <span className="dsb-pc-page__name">{page.name}</span>
                  <span className="dsb-pc-page__num">{idx + 1}</span>
                  <Settings2
                    size={12}
                    className={`dsb-pc-page__cfg${pageProps ? ' dsb-pc-page__cfg--active' : ''}`}
                    title="Propiedades de página"
                    onClick={e => { e.stopPropagation(); setPanelContext(panelContext === pageCtx ? null : pageCtx); }}
                  />
                </div>

                {expanded && allEls.map(el => (
                  el.type === 'contentarea'
                    ? <ContentAreaRow    key={el.id} el={el} pageIdx={idx} state={state} depth={1} forceOpenIds={forceOpenIds} tableCellSelectionKeys={tableCellSelectionKeys} />
                    : el.type === 'table'
                      ? <TableElementRow key={el.id} el={el} pageIdx={idx} state={state} depth={1} forceOpenIds={forceOpenIds} tableCellSelectionKeys={tableCellSelectionKeys} />
                      : <ElementRow      key={el.id} el={el} pageIdx={idx} state={state} depth={1} />
                ))}
              </div>
            );
          })}
        </div>

      </div>
      </div>

      <div className="dsb-map-trigger">
        <button
          className="dsb-map-btn"
          title="Ver mapa de flujo de páginas"
          onClick={() => setShowMapModal(true)}
        >
          <GitBranch size={14} />
        </button>
        <button
          className="dsb-map-btn"
          title="Ver mapa de flujo de desbordamiento"
          onClick={() => setShowOverflowMapModal(true)}
        >
          <Workflow size={14} />
        </button>
      </div>

      {showMapModal && (
        <PageFlowMapModal
          template={template}
          onClose={() => setShowMapModal(false)}
        />
      )}

      {showOverflowMapModal && (
        <OverflowFlowMapModal
          template={template}
          onClose={() => setShowOverflowMapModal(false)}
        />
      )}
    </div>
  );
}
