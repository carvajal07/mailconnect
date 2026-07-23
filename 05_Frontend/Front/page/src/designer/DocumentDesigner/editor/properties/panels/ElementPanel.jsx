// editor/properties/ElementPanel.jsx — Element properties shown inside ContextPanel

import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import BasicTab   from '../tabs/BasicTab.jsx';
import TextTab    from '../tabs/TextTab.jsx';
import FillTab    from '../tabs/FillTab.jsx';
import BorderTab  from '../tabs/BorderTab.jsx';
import ContentAreaTab from '../tabs/ContentAreaTab.jsx';
import BarcodeContentTab   from '../tabs/BarcodeContentTab.jsx';
import BarcodeTypeTab      from '../tabs/BarcodeTypeTab.jsx';
import BarcodeAdvancedTab  from '../tabs/BarcodeAdvancedTab.jsx';
import BarcodeDirectMetricTab from '../tabs/BarcodeDirectMetricTab.jsx';
import BarcodeTextAlignTab from '../tabs/BarcodeTextAlignTab.jsx';
import ChartTab          from '../tabs/ChartTab.jsx';
import { getSymbology, supportsDirectMetric } from '../../../engine/barcodeSymbologies.js';
import TableTab   from '../tabs/TableTab.jsx';
import ColumnsTab from '../tabs/ColumnsTab.jsx';
import RowSetsTab from '../tabs/RowSetsTab.jsx';
import AreaPropertiesPanel, { FlujoTab } from './AreaPropertiesPanel.jsx';
import CellPropertiesPanel, { DEFAULT_CELL } from './CellPropertiesPanel.jsx';
import { createCell } from '../../../engine/elementFactory.js';
import ImageAssetEditor from '../../resources/image/ImageAssetEditor.jsx';
import '../../resources/image/ImageAssetEditor.css';
import InsertRowSetDialog from '../../canvas/elements/InsertRowSetDialog.jsx';

const TABS_BY_TYPE = {
  shape:       ['Básico', 'Borde'],
  image:       ['Imagen', 'Básico', 'Borde'],
  table:       ['Básico', 'Tabla', 'Columnas', 'Secciones', 'Borde'],
  contentarea: ['Básico', 'Áreas', 'Borde'],
  qr:          ['Básico'],
  barcode:     ['Básico', 'Contenido', 'Tipo', 'Etiqueta'],
  chart:       ['Básico', 'Gráfico', 'Borde'],
};

// Lista de tabs de un elemento. Para barcode es DINÁMICA: agrega "Avanzado" si el
// tipo tiene opciones avanzadas y "Métrica directa" si admite anchos explícitos.
function tabsForElement(el) {
  if (el?.type === 'barcode') {
    const sym = getSymbology(el.symbology);
    const t = ['Básico', 'Contenido', 'Tipo'];
    if ((sym.advancedFields ?? []).length > 0) t.push('Avanzado');
    if (supportsDirectMetric(el.symbology)) t.push('Métrica directa');
    t.push('Etiqueta');
    return t;
  }
  return TABS_BY_TYPE[el?.type] ?? ['Básico'];
}

function findAreaById(areas, id) {
  for (const a of areas) {
    if (a.id === id) return a;
    if (a.children?.length) { const f = findAreaById(a.children, id); if (f) return f; }
  }
  return null;
}

// ── TableRowSetPanel — shown when a RowSet is selected from the page tree ────

const EP_RS_TYPE_LABELS = {
  'single-row':           'fila simple',
  'multiple-rows':        'múltiples filas',
  'repeated':             'repetición',
  'header-footer':        'cab./pie',
  'select-by-condition':  'condición',
  'select-by-integer':    'por entero',
  'select-by-interval':   'por intervalo',
  'select-by-text':       'por texto',
  'select-by-inline':     'inline',
};

const RS_ALL_TYPES = [
  { value: 'single-row',          label: 'Single Row' },
  { value: 'multiple-rows',       label: 'Multiple Rows' },
  { value: 'repeated',            label: 'Repeated' },
  { value: 'header-footer',       label: 'Header/Footer' },
  { value: 'select-by-condition', label: 'Select by Condition' },
  { value: 'select-by-integer',   label: 'Select by Integer' },
  { value: 'select-by-interval',  label: 'Select by Interval' },
  { value: 'select-by-text',      label: 'Select by Text' },
  { value: 'select-by-inline',    label: 'Select by Inline' },
];

const HF_SLOTS = [
  { key: 'firstHeaderId', label: '1ª Cabecera' },
  { key: 'headerId',      label: 'Cabecera' },
  { key: 'bodyId',        label: 'Cuerpo' },
  { key: 'footerId',      label: 'Pie' },
  { key: 'lastFooterId',  label: 'Último Pie' },
];

function TableRowSetPanel({ tableEl, rs, onUpdateRowSet, onUpdateTableEl, onUpdateBoth, onBack, state }) {
  const columns  = tableEl.columns ?? [];
  const allRowSets = tableEl.rowSets ?? [];
  // null = closed | '__append__' = add new slot | childId = replace that slot
  const [addDialogFor, setAddDialogFor] = useState(null);
  // null = closed | slotKey = which HF slot triggered "crear nuevo"
  const [hfDialogFor, setHfDialogFor] = useState(null);

  return (
    <div className="ep__rowset-panel">
      <div className="ep__rowset-header">
        <button className="ep__rowset-back" onClick={onBack} title="Volver">
          ← Tabla
        </button>
        <span className="ep__rowset-name" style={{ fontWeight: 700 }}>RowSet</span>
      </div>

      <div className="pp__body">
        {/* Name */}
        <div className="pp-field">
          <label className="pp-field__label">Nombre</label>
          <input
            className="pp-field__input"
            value={rs.name ?? ''}
            onChange={e => onUpdateRowSet({ name: e.target.value })}
          />
        </div>

        {/* Type */}
        <div className="pp-field">
          <label className="pp-field__label">Tipo</label>
          <select
            className="pp-field__select"
            value={rs.type ?? 'single-row'}
            onChange={e => {
              const newType = e.target.value;
              if (newType === rs.type) return;

              // Converting to header-footer: auto-creates header/body/footer RowSets
              if (newType === 'header-footer') {
                state?.convertRowSetToHeaderFooter?.(tableEl.id, rs.id);
                return;
              }

              const updates = { type: newType };
              if (newType === 'single-row') {
                const existingCells = rs.cells ?? [];
                updates.cells = (tableEl.columns ?? []).map(col => {
                  const found = existingCells.find(c => c.colId === col.id);
                  return found ?? {
                    colId: col.id, flow: { content: '' },
                    vAlign: 'top', spanLeft: false, spanUp: false,
                    heightType: 'custom', minHeight: 0, maxHeight: 300000,
                    htmlWidth: 'auto', flowToNextPage: false,
                    alwaysProcess: false, fillRelativeToCell: false,
                  };
                });
              }
              if (newType === 'multiple-rows' || newType === 'repeated') {
                updates.childIds = rs.childIds ?? [];
              }
              onUpdateRowSet(updates);
            }}
          >
            {RS_ALL_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* header-footer: slot assignment table */}
        {rs.type === 'header-footer' && (() => {
          const assignable = allRowSets.filter(r => r.id !== rs.id);
          return (
            <>
              <label className="ep__hf-check-row">
                <input
                  type="checkbox"
                  checked={!!rs.displayAllRows}
                  onChange={e => onUpdateRowSet({ displayAllRows: e.target.checked })}
                />
                <span>Mostrar todas las filas</span>
              </label>
              <div className="ep__hf-table">
                {HF_SLOTS.map(slot => (
                  <div key={slot.key} className="ep__hf-row">
                    <span className="ep__hf-label">{slot.label}</span>
                    <select
                      className="ep__hf-select"
                      value={rs[slot.key] ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '__new__') { setHfDialogFor(slot.key); }
                        else { onUpdateRowSet({ [slot.key]: val || null }); }
                      }}
                    >
                      <option value="">(ninguno)</option>
                      {assignable.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name ?? r.id}  —  {EP_RS_TYPE_LABELS[r.type] ?? r.type}
                        </option>
                      ))}
                      <option disabled>──────────────</option>
                      <option value="__new__">+ Crear nuevo RowSet...</option>
                    </select>
                  </div>
                ))}
              </div>
              {hfDialogFor !== null && (
                <InsertRowSetDialog
                  onConfirm={type => {
                    state?.createAndAssignHFSlot?.(tableEl.id, rs.id, hfDialogFor, type);
                    setHfDialogFor(null);
                  }}
                  onCancel={() => setHfDialogFor(null)}
                />
              )}
            </>
          );
        })()}

        {/* repeated: repeatVar */}
        {rs.type === 'repeated' && (
          <div className="pp-field">
            <label className="pp-field__label">Variable de repetición</label>
            <input
              className="pp-field__input"
              value={rs.repeatVar ?? ''}
              placeholder="ej. datos.items"
              onChange={e => onUpdateRowSet({ repeatVar: e.target.value })}
            />
          </div>
        )}

        {/* single-row: column list with dropdown selector + reorder */}
        {rs.type === 'single-row' && (() => {
          function countGlobalCells() {
            let count = 0;
            const tmpl = state?.template;
            function scanEl(el) {
              if (el?.type !== 'table') return;
              for (const r of (el.rowSets ?? [])) count += (r.cells ?? []).length;
            }
            for (const p of (tmpl?.pages ?? [])) for (const el of (p.elements ?? [])) scanEl(el);
            for (const ca of (tmpl?.contentAreas ?? [])) for (const el of (ca.elements ?? [])) scanEl(el);
            return count;
          }

          function appendNewColumn() {
            const globalN  = countGlobalCells() + 1;
            const colCount = columns.length + 1;
            const newColId = `col_${Date.now()}`;
            const newCol = { id: newColId, label: `Col. ${colCount}`, widthRatio: 1 / colCount, minWidth: 5, headerTag: false, enabledBy: null };
            const adjustedCols = columns.map(c => ({ ...c, widthRatio: 1 / colCount }));
            const newCell = createCell(newColId, '', { label: `Columna ${globalN}`, areaLabel: `Área Columna ${globalN}` });
            onUpdateBoth(
              { columns: [...adjustedCols, newCol] },
              { cells: [...(rs.cells ?? []), newCell] }
            );
          }

          function swapColPositions(idxA, colBId) {
            const idxB = columns.findIndex(c => c.id === colBId);
            if (idxB === -1 || idxA === idxB) return;
            const newCols = [...columns];
            [newCols[idxA], newCols[idxB]] = [newCols[idxB], newCols[idxA]];
            onUpdateTableEl({ columns: newCols });
          }

          return (
            <>
              <div className="pp-section-header">
                <span className="pp-section-title--inline">Columnas</span>
                <button className="pp-field__btn-inline" title="Agregar columna" onClick={appendNewColumn}>+</button>
              </div>
              {columns.map((col, idx) => (
                <div key={col.id} className="ep__col-reorder-row">
                  <select
                    className="ep__col-select"
                    value={col.id}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '__new__') appendNewColumn();
                      else swapColPositions(idx, val);
                    }}
                  >
                    {columns.map(c => (
                      <option key={c.id} value={c.id}>{c.label ?? c.id}</option>
                    ))}
                    <option disabled>──────────────</option>
                    <option value="__new__">+ Crear nueva Columna...</option>
                  </select>
                  <button
                    className="ep__col-reorder-btn"
                    disabled={idx === 0}
                    title="Mover arriba"
                    onClick={() => {
                      const newCols = [...columns];
                      [newCols[idx - 1], newCols[idx]] = [newCols[idx], newCols[idx - 1]];
                      onUpdateTableEl({ columns: newCols });
                    }}
                  >▲</button>
                  <button
                    className="ep__col-reorder-btn"
                    disabled={idx === columns.length - 1}
                    title="Mover abajo"
                    onClick={() => {
                      const newCols = [...columns];
                      [newCols[idx], newCols[idx + 1]] = [newCols[idx + 1], newCols[idx]];
                      onUpdateTableEl({ columns: newCols });
                    }}
                  >▼</button>
                  <button
                    className="ep__col-reorder-btn"
                    title="Eliminar columna"
                    disabled={columns.length <= 1}
                    onClick={() => {
                      const newCols = columns.filter(c => c.id !== col.id);
                      const ratio = 1 / newCols.length;
                      const adjustedCols = newCols.map(c => ({ ...c, widthRatio: ratio }));
                      const newCells = (rs.cells ?? []).filter(c => c.colId !== col.id);
                      onUpdateBoth({ columns: adjustedCols }, { cells: newCells });
                    }}
                  >×</button>
                </div>
              ))}
            </>
          );
        })()}

        {/* multiple-rows / repeated: child RowSet slots as dropdowns */}
        {(rs.type === 'multiple-rows' || rs.type === 'repeated') && (() => {
          const childIds = rs.childIds ?? [];
          // All rowsets except the container itself are valid assignment targets
          const assignable = allRowSets.filter(r => r.id !== rs.id);

          function handleSlotChange(slotChildId, newVal) {
            if (newVal === '__new__') {
              setAddDialogFor(slotChildId);
            } else {
              const newChildIds = childIds.map(id => id === slotChildId ? newVal : id);
              onUpdateRowSet({ childIds: newChildIds });
            }
          }

          function handleRemoveSlot(slotChildId) {
            if (childIds.length <= 1) return;
            onUpdateRowSet({ childIds: childIds.filter(id => id !== slotChildId) });
          }

          return (
            <>
              <div className="pp-section-title" style={{ marginTop: 8 }}>Filas contenidas</div>
              <div className="ep__mr-list">
                {childIds.map((childId, idx) => (
                  <div key={childId} className="ep__mr-item">
                    <select
                      className="ep__mr-select"
                      value={childId}
                      onChange={e => handleSlotChange(childId, e.target.value)}
                    >
                      {assignable.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name ?? r.id}  ({EP_RS_TYPE_LABELS[r.type] ?? r.type})
                        </option>
                      ))}
                      <option disabled>──────────────</option>
                      <option value="__new__">+ Crear nueva Fila...</option>
                    </select>
                    <button
                      className="ep__mr-navigate-sm"
                      onClick={() => state?.setTableRowSetCtx?.({ elId: tableEl.id, rowSetId: childId })}
                      title="Editar propiedades"
                    >›</button>
                    <button
                      className="ep__mr-delete"
                      onClick={() => handleRemoveSlot(childId)}
                      disabled={childIds.length <= 1}
                      title="Eliminar slot"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {childIds.length === 0 && <p className="ep__rowset-hint">Sin filas hijo.</p>}
              </div>
              <button className="ep__mr-add-btn" onClick={() => setAddDialogFor('__append__')}>
                <Plus size={11} /> Agregar Fila
              </button>
              {addDialogFor !== null && (
                <InsertRowSetDialog
                  onConfirm={type => {
                    if (addDialogFor === '__append__') {
                      state?.addChildRowSet?.(tableEl.id, rs.id, type);
                    } else {
                      state?.createAndReplaceChildRowSet?.(tableEl.id, rs.id, addDialogFor, type);
                    }
                    setAddDialogFor(null);
                  }}
                  onCancel={() => setAddDialogFor(null)}
                />
              )}
            </>
          );
        })()}

        {/* select-by-*: hint */}
        {rs.type?.startsWith('select-by') && (
          <p className="ep__rowset-hint" style={{ padding: '8px 0' }}>
            Selecciona un RowSet hijo del árbol para editarlo.
          </p>
        )}
      </div>
    </div>
  );
}

// ── CellAreaPanel — full area panel for cell flow ──────────────────────────

function normalizeCellFlow(flow) {
  const base = {
    id: `area_${Date.now()}`, label: 'Area', flowType: 'simple', height: 0,
    content: '', elements: [], children: [], visible: true, condition: null,
    dataPath: '', selectionType: 'condition', selectionVariable: '',
    selectionMappings: [], selectionScript: '', conditions: [],
    defaultAreaId: '', trueAreaId: '', falseAreaId: '',
    defaultTextStyleId: null, isSectionFlow: false,
    fittingMode: 'none', fittingFlows: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (!flow) return base;
  return { ...base, ...flow, flowType: flow.flowType ?? 'simple' };
}

function CellAreaPanel({ col, cell, onUpdateCell, onBack, state, availableFields }) {
  const colLabel = col?.label ?? col?.id ?? 'Cell';
  const area = normalizeCellFlow(cell.flow);

  function updateArea(_caId, areaId, changes) {
    if (!areaId || areaId === area.id) {
      onUpdateCell({ flow: { ...area, ...changes, updatedAt: new Date().toISOString() } });
    } else {
      function patch(children) {
        return children.map(ch =>
          ch.id === areaId ? { ...ch, ...changes } :
          ch.children?.length ? { ...ch, children: patch(ch.children) } : ch
        );
      }
      onUpdateCell({ flow: { ...area, children: patch(area.children ?? []) } });
    }
  }

  function addArea(_caId, parentAreaId) {
    const newId = `area_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const newArea = {
      id: newId, label: 'Sub-area', flowType: 'simple', height: 20,
      content: '', elements: [], children: [], visible: true, condition: null,
      dataPath: '', selectionType: 'condition', selectionVariable: '',
      selectionMappings: [], selectionScript: '', conditions: [],
      defaultAreaId: '', trueAreaId: '', falseAreaId: '',
      defaultTextStyleId: null, isSectionFlow: false,
      fittingMode: 'none', fittingFlows: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    onUpdateCell({ flow: { ...area, children: [...(area.children ?? []), newArea] } });
    return newId;
  }

  function removeArea(_caId, areaId) {
    function drop(children) {
      return children
        .filter(ch => ch.id !== areaId)
        .map(ch => ch.children?.length ? { ...ch, children: drop(ch.children) } : ch);
    }
    onUpdateCell({ flow: { ...area, children: drop(area.children ?? []) } });
  }

  function migrateToCondition() {
    onUpdateCell({ flow: { ...area, flowType: 'inline-condition', selectionType: 'condition', conditions: [] } });
  }

  function migrateFromCondition(_caId, _areaId, newType) {
    onUpdateCell({ flow: { ...area, flowType: newType } });
  }

  return (
    <div className="ep__rowset-panel">
      <div className="ep__rowset-header">
        <button className="ep__rowset-back" onClick={onBack}>← Cell</button>
        <span className="ep__rowset-name" style={{ fontWeight: 700 }}>Area — {colLabel}</span>
      </div>
      <div className="pp__body">
        <FlujoTab
          area={area}
          caId={`__cell__${col?.id ?? 'x'}`}
          updateArea={updateArea}
          addArea={addArea}
          removeArea={removeArea}
          enterAreaEdit={null}
          migrateAreaToCondition={migrateToCondition}
          migrateAreaFromCondition={migrateFromCondition}
          previewAreaCtx={null}
          setPreviewAreaCtx={null}
          availableFields={availableFields ?? []}
          getContentAreaUsage={null}
          textStyles={state?.template?.styles?.text ?? []}
          addTextStyle={state?.addTextStyle}
          onNavigateToStyle={id => state?.setPanelContext?.('textStyle:' + id)}
          allAreas={[area, ...(area.children ?? [])]}
        />
      </div>
    </div>
  );
}

function ImageElementTab({ element, state, availableFields }) {
  const { template, updateImageAsset, addImageAsset, setPanelContext } = state;
  const assetId = element.source?.assetId;
  const asset   = (template?.images ?? []).find(a => a.id === assetId) ?? null;

  if (!asset) {
    return (
      <div style={{ padding: 12, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
        Imagen no vinculada. Elimina y vuelve a insertar el elemento.
      </div>
    );
  }

  function handlePromoteToVariable() {
    const newId = addImageAsset?.({ kind: 'variable', defaultImageId: assetId });
    if (newId) setPanelContext?.('imageAsset:' + newId);
  }

  return (
    <ImageAssetEditor
      asset={asset}
      onChange={changes => updateImageAsset(assetId, changes)}
      availableFields={availableFields ?? []}
      allAssets={template?.images ?? []}
      onPromoteToVariable={handlePromoteToVariable}
    />
  );
}

export default function ElementPanel({ state, availableFields }) {
  const { template, currentPageIndex, selectedIds, updateCurrentPage, areaEditCtx, focusedAreaCtx, setFocusedAreaCtx, embeddedElementCtx, tableRowSetCtx } = state;
  const [activeTab, setActiveTab] = useState('Básico');
  const lastElementId = useRef(null);

  const currentPage = template?.pages?.[currentPageIndex] ?? null;
  const elements    = currentPage?.elements ?? [];

  // ── Table RowSet / Cell selection — handles standalone and embedded tables ──
  if (tableRowSetCtx) {
    // Resolve the table element: first as a standalone page element, then as embedded
    let tableEl = null;
    let isEmbeddedTable = false;
    if (selectedIds.length === 1 && tableRowSetCtx.elId === selectedIds[0]) {
      tableEl = elements.find(el => el.id === tableRowSetCtx.elId) ?? null;
    }
    if (!tableEl && embeddedElementCtx?.elementId === tableRowSetCtx.elId) {
      const caEl = elements.find(el => el.id === embeddedElementCtx.caId);
      const resolvedAreas = state.resolveAreas?.(caEl) ?? [];
      const embArea = findAreaById(resolvedAreas, embeddedElementCtx.areaId);
      tableEl = (embArea?.elements ?? []).find(e => e.embedded && e.id === tableRowSetCtx.elId) ?? null;
      if (tableEl) isEmbeddedTable = true;
    }

    const rs = (tableEl?.rowSets ?? []).find(r => r.id === tableRowSetCtx.rowSetId);
    if (tableEl && rs) {
      function applyTableUpdate(changes) {
        if (isEmbeddedTable) {
          state.updateEmbeddedElement?.(embeddedElementCtx.caId, embeddedElementCtx.areaId, tableEl.id, changes);
        } else {
          updateCurrentPage({
            elements: elements.map(el =>
              el.id === tableEl.id ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
            ),
          });
        }
      }
      function updateTableRowSet(changes) {
        const newRowSets = tableEl.rowSets.map(r => r.id === rs.id ? { ...r, ...changes } : r);
        applyTableUpdate({ rowSets: newRowSets });
      }
      function updateTableEl(changes) {
        applyTableUpdate(changes);
      }
      function updateTableElAndRowSet(tableElChanges, rowSetChanges) {
        const newRowSets = tableEl.rowSets.map(r =>
          r.id === rs.id ? { ...r, ...rowSetChanges } : r
        );
        applyTableUpdate({ ...tableElChanges, rowSets: newRowSets });
      }
      function updateCell(colId, changes) {
        const existing = rs.cells ?? [];
        const found = existing.find(c => c.colId === colId);
        const newCells = found
          ? existing.map(c => c.colId === colId ? { ...c, ...changes } : c)
          : [...existing, { ...DEFAULT_CELL, colId, ...changes }];
        updateTableRowSet({ cells: newCells });
      }
      // Sub-area of cell flow selected
      if (tableRowSetCtx.areaColId && tableRowSetCtx.subAreaId) {
        const col  = (tableEl.columns ?? []).find(c => c.id === tableRowSetCtx.areaColId);
        const cell = (rs.cells ?? []).find(c => c.colId === tableRowSetCtx.areaColId) ?? { ...DEFAULT_CELL, colId: tableRowSetCtx.areaColId };
        const flow = normalizeCellFlow(cell.flow);
        function findSubArea(areas, id) {
          for (const a of areas) {
            if (a.id === id) return a;
            const found = findSubArea(a.children ?? [], id);
            if (found) return found;
          }
          return null;
        }
        const subArea = findSubArea(flow.children ?? [], tableRowSetCtx.subAreaId);
        if (subArea) {
          const colLabel = col?.label ?? col?.id ?? 'Cell';
          function patchSubArea(areas, id, changes) {
            return areas.map(a =>
              a.id === id ? { ...a, ...changes, updatedAt: new Date().toISOString() } :
              a.children?.length ? { ...a, children: patchSubArea(a.children, id, changes) } : a
            );
          }
          function updateSubArea(_caId, _aId, changes) {
            updateCell(tableRowSetCtx.areaColId, {
              flow: { ...flow, children: patchSubArea(flow.children ?? [], tableRowSetCtx.subAreaId, changes) },
            });
          }
          return (
            <div className="ep__rowset-panel">
              <div className="ep__rowset-header">
                <button className="ep__rowset-back" onClick={() => state.setTableRowSetCtx?.({ elId: tableRowSetCtx.elId, rowSetId: tableRowSetCtx.rowSetId, areaColId: tableRowSetCtx.areaColId })}>
                  ← Area — {colLabel}
                </button>
                <span className="ep__rowset-name" style={{ fontWeight: 700 }}>{subArea.label ?? 'Sub-área'}</span>
              </div>
              <div className="pp__body">
                <FlujoTab
                  area={subArea}
                  caId={`__cell_sub__${col?.id ?? 'x'}`}
                  updateArea={updateSubArea}
                  addArea={() => null}
                  removeArea={() => null}
                  enterAreaEdit={null}
                  migrateAreaToCondition={() => null}
                  migrateAreaFromCondition={() => null}
                  previewAreaCtx={null}
                  setPreviewAreaCtx={null}
                  availableFields={availableFields ?? []}
                  getContentAreaUsage={null}
                  textStyles={state?.template?.styles?.text ?? []}
                  addTextStyle={state?.addTextStyle}
                  onNavigateToStyle={id => state?.setPanelContext?.('textStyle:' + id)}
                  allAreas={[subArea]}
                />
              </div>
            </div>
          );
        }
      }
      // Area inside cell selected
      if (tableRowSetCtx.areaColId) {
        const col  = (tableEl.columns ?? []).find(c => c.id === tableRowSetCtx.areaColId);
        const cell = (rs.cells ?? []).find(c => c.colId === tableRowSetCtx.areaColId) ?? { ...DEFAULT_CELL, colId: tableRowSetCtx.areaColId };
        return (
          <CellAreaPanel
            col={col}
            cell={cell}
            onUpdateCell={changes => updateCell(tableRowSetCtx.areaColId, changes)}
            onBack={() => state.setTableRowSetCtx?.({ elId: tableRowSetCtx.elId, rowSetId: tableRowSetCtx.rowSetId, colId: tableRowSetCtx.areaColId })}
            state={state}
            availableFields={availableFields}
          />
        );
      }
      // Cell selected
      if (tableRowSetCtx.colId) {
        const col = (tableEl.columns ?? []).find(c => c.id === tableRowSetCtx.colId);
        const cell = (rs.cells ?? []).find(c => c.colId === tableRowSetCtx.colId)
          ?? { ...DEFAULT_CELL, colId: tableRowSetCtx.colId };
        return (
          <CellPropertiesPanel
            cell={cell}
            colLabel={col?.label ?? col?.id ?? 'Cell'}
            onUpdate={changes => updateCell(tableRowSetCtx.colId, { ...cell, ...changes })}
            onBack={() => state.setTableRowSetCtx?.({ elId: tableRowSetCtx.elId, rowSetId: tableRowSetCtx.rowSetId })}
            state={state}
          />
        );
      }
      // RowSet selected
      return (
        <TableRowSetPanel
          tableEl={tableEl}
          rs={rs}
          onUpdateRowSet={updateTableRowSet}
          onUpdateTableEl={updateTableEl}
          onUpdateBoth={updateTableElAndRowSet}
          onBack={() => state.setTableRowSetCtx?.(null)}
          state={state}
        />
      );
    }
  }

  // ── Embedded element selection — highest priority ───────────────────
  if (embeddedElementCtx) {
    const caEl = elements.find(el => el.id === embeddedElementCtx.caId);
    const resolvedAreas = state.resolveAreas?.(caEl) ?? [];
    const area = findAreaById(resolvedAreas, embeddedElementCtx.areaId);
    const embeddedEl = (area?.elements ?? []).find(e => e.embedded && e.id === embeddedElementCtx.elementId);

    if (embeddedEl) {
      const tabs = tabsForElement(embeddedEl);
      const tab  = tabs.includes(activeTab) ? activeTab : tabs[0];
      if (embeddedEl.id !== lastElementId.current) {
        lastElementId.current = embeddedEl.id;
        // eslint-disable-next-line react-hooks/rules-of-hooks -- called inline, safe since same condition each render
      }

      function updateEmbedded(changes) {
        state.updateEmbeddedElement?.(embeddedElementCtx.caId, embeddedElementCtx.areaId, embeddedElementCtx.elementId, changes);
      }

      return (
        <div>
          <div className="ep__embedded-badge">◆ Elemento embebido</div>
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
            {tab === 'Imagen'   && embeddedEl.type === 'image'   && <ImageElementTab element={embeddedEl} state={state} availableFields={availableFields} />}
            {tab === 'Básico'   && <BasicTab  element={embeddedEl} onUpdate={updateEmbedded} />}
            {tab === 'Tabla'    && embeddedEl.type === 'table'   && <TableTab   element={embeddedEl} onUpdate={updateEmbedded} />}
            {tab === 'Columnas' && embeddedEl.type === 'table'   && <ColumnsTab element={embeddedEl} onUpdate={updateEmbedded} />}
            {tab === 'Secciones' && embeddedEl.type === 'table'   && <RowSetsTab element={embeddedEl} onUpdate={updateEmbedded} state={state} />}
            {tab === 'Relleno'  && <FillTab   element={embeddedEl} onUpdate={updateEmbedded} fillStyles={state.template?.styles?.fill ?? []} addFillStyle={state.addFillStyle} onNavigateToStyle={id => state.setPanelContext?.('fillStyle:' + id)} />}
            {tab === 'Borde'    && <BorderTab element={embeddedEl} onUpdate={updateEmbedded} borderStyles={state.template?.styles?.border ?? []} addBorderStyle={state.addBorderStyle} onNavigateToStyle={id => state.setPanelContext?.('borderStyle:' + id)} />}
            {tab === 'Contenido' && embeddedEl.type === 'barcode' && <BarcodeContentTab element={embeddedEl} onUpdate={updateEmbedded} state={state} availableFields={availableFields} />}
            {tab === 'Tipo'      && embeddedEl.type === 'barcode' && <BarcodeTypeTab element={embeddedEl} onUpdate={updateEmbedded} />}
            {tab === 'Avanzado'  && embeddedEl.type === 'barcode' && <BarcodeAdvancedTab element={embeddedEl} onUpdate={updateEmbedded} />}
            {tab === 'Métrica directa' && embeddedEl.type === 'barcode' && <BarcodeDirectMetricTab element={embeddedEl} onUpdate={updateEmbedded} />}
            {tab === 'Etiqueta'  && embeddedEl.type === 'barcode' && <BarcodeTextAlignTab element={embeddedEl} onUpdate={updateEmbedded} state={state} />}
            {tab === 'Gráfico'   && embeddedEl.type === 'chart'   && <ChartTab element={embeddedEl} onUpdate={updateEmbedded} state={state} />}
          </div>
        </div>
      );
    }
  }

  // ── Area properties: area-edit mode or area focused via click ──────
  const areaCtx = focusedAreaCtx ?? areaEditCtx;
  if (areaCtx) {
    const caEl = elements.find(el => el.id === areaCtx.caId);
    const resolvedAreas = state.resolveAreas?.(caEl) ?? caEl?.areas ?? [];
    const area = findAreaById(resolvedAreas, areaCtx.areaId);
    if (area && caEl) {
      return (
        <AreaPropertiesPanel
          area={area}
          caId={caEl.id}
          state={state}
          availableFields={availableFields}
          onBack={areaEditCtx ? undefined : () => setFocusedAreaCtx(null)}
          inline
        />
      );
    }
  }

  // ── No selection / multi-selection ──────────────────────────────────
  if (selectedIds.length !== 1) {
    return (
      <div className="ep__empty">
        <p>
          {selectedIds.length > 1
            ? `${selectedIds.length} elementos seleccionados`
            : 'Selecciona un elemento'}
        </p>
      </div>
    );
  }

  // ── Element properties ─────────────────────────────────────────────
  let element = elements.find(el => el.id === selectedIds[0]);
  if (!element && areaEditCtx) {
    const caEl = elements.find(el => el.id === areaEditCtx.caId);
    const resolvedAreas2 = state.resolveAreas?.(caEl) ?? caEl?.areas ?? [];
    const area = findAreaById(resolvedAreas2, areaEditCtx.areaId);
    element = area?.elements?.find(el => el.id === selectedIds[0]) ?? null;
  }
  if (!element) return null;

  const tabs = tabsForElement(element);

  // When the selected element changes, reset to its first tab
  if (element.id !== lastElementId.current) {
    lastElementId.current = element.id;
    setActiveTab(tabs[0]);
  }

  const tab  = tabs.includes(activeTab) ? activeTab : tabs[0];

  function updateElement(changes) {
    const updated = elements.map(el =>
      el.id === element.id ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
    );
    updateCurrentPage({ elements: updated });
  }

  return (
    <div>
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
        {tab === 'Imagen'   && element.type === 'image' && <ImageElementTab element={element} state={state} availableFields={availableFields} />}
        {tab === 'Básico'   && <BasicTab  element={element} onUpdate={updateElement} state={element.type === 'contentarea' ? state : undefined} />}
        {tab === 'Áreas'    && element.type === 'contentarea' && <ContentAreaTab element={element} state={state} availableFields={availableFields} />}
        {tab === 'Tabla'    && element.type === 'table' && <TableTab   element={element} onUpdate={updateElement} />}
        {tab === 'Columnas' && element.type === 'table' && <ColumnsTab element={element} onUpdate={updateElement} />}
        {tab === 'Secciones' && element.type === 'table' && <RowSetsTab element={element} onUpdate={updateElement} state={state} />}
        {tab === 'Texto'    && <TextTab   element={element} onUpdate={updateElement} textStyles={state.template?.styles?.text ?? []} addTextStyle={state.addTextStyle} onNavigateToStyle={id => state.setPanelContext?.('textStyle:' + id)} />}
        {tab === 'Relleno'  && <FillTab   element={element} onUpdate={updateElement} fillStyles={state.template?.styles?.fill ?? []} addFillStyle={state.addFillStyle} onNavigateToStyle={id => state.setPanelContext?.('fillStyle:' + id)} />}
        {tab === 'Borde'    && <BorderTab element={element} onUpdate={updateElement} borderStyles={state.template?.styles?.border ?? []} addBorderStyle={state.addBorderStyle} onNavigateToStyle={id => state.setPanelContext?.('borderStyle:' + id)} />}
        {tab === 'Contenido' && element.type === 'barcode' && <BarcodeContentTab element={element} onUpdate={updateElement} state={state} availableFields={availableFields} />}
        {tab === 'Tipo'      && element.type === 'barcode' && <BarcodeTypeTab element={element} onUpdate={updateElement} />}
        {tab === 'Avanzado'  && element.type === 'barcode' && <BarcodeAdvancedTab element={element} onUpdate={updateElement} />}
        {tab === 'Métrica directa' && element.type === 'barcode' && <BarcodeDirectMetricTab element={element} onUpdate={updateElement} />}
        {tab === 'Etiqueta'  && element.type === 'barcode' && <BarcodeTextAlignTab element={element} onUpdate={updateElement} state={state} />}
        {tab === 'Gráfico'   && element.type === 'chart'   && <ChartTab element={element} onUpdate={updateElement} state={state} />}
      </div>
    </div>
  );
}
