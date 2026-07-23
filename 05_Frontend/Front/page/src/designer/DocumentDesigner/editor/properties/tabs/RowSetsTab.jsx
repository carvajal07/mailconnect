// editor/properties/tabs/RowSetsTab.jsx — Secciones de tabla (modelo RowSet pool)
import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import InsertRowSetDialog from '../../canvas/elements/InsertRowSetDialog.jsx';
import './RowSetsTab.css';

let _rc = 1;
function newId(prefix = 'rs') { return `${prefix}_${Date.now()}_${_rc++}`; }

// ── Cell / Row factories ──────────────────────────────────────────────────

function blankCell(colId, content = '') {
  return {
    id: newId('cell'),
    colId,
    flow: { content },
    vAlign: 'top',
    spanLeft: false,
    spanUp: false,
    heightType: 'custom',
    fixedHeight: 8,
    minHeight: 4,
    maxHeight: null,
    htmlWidth: 'auto',
    htmlWidthValue: 0,
    flowToNextPage: false,
    alwaysProcess: false,
    fillRelativeToCell: false,
    border: null,
  };
}

function blankSingleRow(columns, name = 'Fila') {
  return { id: newId('rs'), name, type: 'single-row', cells: columns.map(col => blankCell(col.id)) };
}

function blankMultipleRows(columns, name, rowCount = 1) {
  const rows = Array.from({ length: rowCount }, (_, i) => blankSingleRow(columns, `Fila ${i + 1}`));
  return {
    container: { id: newId('rs'), name, type: 'multiple-rows', childIds: rows.map(r => r.id) },
    rows,
  };
}

const RS_TYPE_LABELS = {
  'single-row':          'single row',
  'multiple-rows':       'multiple rows',
  'repeated':            'repeated',
  'header-footer':       'header/footer',
  'select-by-condition': 'select by condition',
  'select-by-integer':   'select by integer',
  'select-by-interval':  'select by interval',
  'select-by-text':      'select by text',
  'select-by-inline':    'select by inline',
};

// ── Cell editor ───────────────────────────────────────────────────────────

function CellEditor({ cell, colLabel, onChange }) {
  return (
    <div className="rst__cell-editor">
      <span className="rst__cell-col-label">{colLabel}</span>
      <input
        className="rst__cell-input"
        value={cell.flow?.content ?? ''}
        placeholder="Contenido..."
        onChange={e => onChange({ flow: { ...cell.flow, content: e.target.value } })}
      />
      <div className="rst__cell-props">
        <select
          className="rst__cell-select"
          value={cell.vAlign ?? 'top'}
          onChange={e => onChange({ vAlign: e.target.value })}
          title="Alineación vertical"
        >
          <option value="top">↑ Sup</option>
          <option value="center">↕ Centro</option>
          <option value="bottom">↓ Inf</option>
        </select>
        <label className="rst__cell-check" title="Fusionar con celda izquierda">
          <input type="checkbox" checked={!!cell.spanLeft} onChange={e => onChange({ spanLeft: e.target.checked })} />
          <span>←Fus</span>
        </label>
        <label className="rst__cell-check" title="Fusionar con celda superior">
          <input type="checkbox" checked={!!cell.spanUp} onChange={e => onChange({ spanUp: e.target.checked })} />
          <span>↑Fus</span>
        </label>
      </div>
    </div>
  );
}

// ── Single-row editor ─────────────────────────────────────────────────────

function SingleRowEditor({ rs, columns, patchRS }) {
  return (
    <div className="rst__single-row-editor">
      {columns.map(col => {
        const cell = (rs.cells ?? []).find(c => c.colId === col.id) ?? blankCell(col.id);
        return (
          <CellEditor
            key={col.id}
            cell={cell}
            colLabel={col.label ?? col.id}
            onChange={changes => {
              const newCells = (rs.cells ?? []).map(c =>
                c.colId === col.id ? { ...c, ...changes } : c
              );
              patchRS({ cells: newCells });
            }}
          />
        );
      })}
    </div>
  );
}

// ── Child row item ────────────────────────────────────────────────────────

function ChildRowItem({ rs, index, columns, onUpdateRS, onDelete, canDelete }) {
  const [open, setOpen] = useState(false);
  const preview = (rs.cells ?? [])
    .filter(c => !c.spanLeft && c.flow?.content)
    .map(c => c.flow.content)
    .join(' · ')
    .slice(0, 40) || '—';

  return (
    <div className="rst__row">
      <div className="rst__row-header">
        <button className="rst__expand-btn" onClick={() => setOpen(x => !x)}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <span className="rst__row-label">{rs.name ?? `Fila ${index + 1}`}</span>
        <span className="rst__row-preview">{preview}</span>
        <button className="rst__row-delete" onClick={onDelete} disabled={!canDelete} title="Eliminar fila">
          <Trash2 size={11} />
        </button>
      </div>
      {open && (
        <div className="rst__row-detail">
          <SingleRowEditor rs={rs} columns={columns} patchRS={ch => onUpdateRS({ ...rs, ...ch })} />
        </div>
      )}
    </div>
  );
}

// ── Row list (for multiple-rows / repeated container) ─────────────────────

function RowList({ containerRS, allRowSets, columns, setAllRowSets }) {
  const childIds = containerRS.childIds ?? [];

  function addRow() {
    const newRow = blankSingleRow(columns, `Fila ${childIds.length + 1}`);
    setAllRowSets([
      ...allRowSets.map(r => r.id === containerRS.id ? { ...r, childIds: [...childIds, newRow.id] } : r),
      newRow,
    ]);
  }

  function deleteRow(rowId) {
    setAllRowSets(
      allRowSets
        .map(r => r.id === containerRS.id ? { ...r, childIds: childIds.filter(id => id !== rowId) } : r)
        .filter(r => r.id !== rowId)
    );
  }

  function updateChildRS(updated) {
    setAllRowSets(allRowSets.map(r => r.id === updated.id ? updated : r));
  }

  return (
    <div className="rst__row-list">
      {childIds.map((id, i) => {
        const child = allRowSets.find(r => r.id === id);
        if (!child) return null;
        return (
          <ChildRowItem
            key={id}
            rs={child}
            index={i}
            columns={columns}
            onUpdateRS={updateChildRS}
            onDelete={() => deleteRow(id)}
            canDelete={childIds.length > 1}
          />
        );
      })}
      {childIds.length === 0 && <p className="rst__empty-rows">Sin filas.</p>}
      <button className="rst__add-row-btn" onClick={addRow}>
        <Plus size={11} /> Agregar fila
      </button>
    </div>
  );
}

// ── Section block for header/footer sections ──────────────────────────────

function SectionBlock({
  title, badge, badgeColor,
  rsId, linkedBadge,
  enabled, canDisable,
  allRowSets, columns, setAllRowSets,
  onEnable, onDisable, onSetRsId,
}) {
  const rs = rsId ? allRowSets.find(r => r.id === rsId) : null;
  const isLinked = !!linkedBadge;

  function handleEnable(checked) {
    if (checked) onEnable?.();
    else onDisable?.();
  }

  function createSingleRow() {
    const newRS = blankSingleRow(columns, title);
    setAllRowSets([...allRowSets, newRS]);
    onSetRsId(newRS.id);
  }

  function createIndependent() {
    const newRS = blankSingleRow(columns, title);
    setAllRowSets([...allRowSets, newRS]);
    onSetRsId(newRS.id);
  }

  function patchRS(changes) {
    setAllRowSets(allRowSets.map(r => r.id === rs?.id ? { ...r, ...changes } : r));
  }

  return (
    <div className={`rst__section${!enabled ? ' rst__section--disabled' : ''}`}>
      <div className="rst__section-header">
        <span className="rst__section-badge" style={{ background: badgeColor }}>{badge}</span>
        <span className="rst__section-title">{title}</span>
        {isLinked && <span className="rst__linked-badge">{linkedBadge}</span>}
        {canDisable && (
          <label className="rst__toggle" title={enabled ? 'Deshabilitar' : 'Habilitar'}>
            <input type="checkbox" checked={!!enabled} onChange={e => handleEnable(e.target.checked)} />
          </label>
        )}
      </div>

      {enabled && isLinked && (
        <div className="rst__section-body">
          <div className="rst__linked-info">
            <span>Usa el mismo contenido que {linkedBadge.replace('= ', '')}.</span>
            <button className="rst__unlink-btn" onClick={createIndependent}>Crear independiente</button>
          </div>
        </div>
      )}

      {enabled && !isLinked && !rs && (
        <div className="rst__section-body rst__no-rs">
          <button className="rst__add-row-btn" onClick={createSingleRow}>
            <Plus size={11} /> Crear fila
          </button>
        </div>
      )}

      {enabled && !isLinked && rs?.type === 'single-row' && (
        <div className="rst__section-body">
          <SingleRowEditor rs={rs} columns={columns} patchRS={patchRS} />
        </div>
      )}

      {enabled && !isLinked && rs && (rs.type === 'multiple-rows' || rs.type === 'repeated') && (
        <div className="rst__section-body">
          <RowList containerRS={rs} allRowSets={allRowSets} columns={columns} setAllRowSets={setAllRowSets} />
        </div>
      )}
    </div>
  );
}

// ── Body section ──────────────────────────────────────────────────────────

function BodySection({ root, allRowSets, columns, setAllRowSets, onSetBodyId }) {
  const rs = root.bodyId ? allRowSets.find(r => r.id === root.bodyId) : null;

  function createBody(type) {
    const { container, rows } = blankMultipleRows(columns, 'Cuerpo', 2);
    const body = { ...container, type, ...(type === 'repeated' ? { repeatVar: null } : {}) };
    setAllRowSets([...allRowSets, body, ...rows]);
    onSetBodyId(body.id);
  }

  function changeBodyType(newType) {
    if (!rs) return;
    setAllRowSets(allRowSets.map(r =>
      r.id === rs.id ? { ...r, type: newType, repeatVar: newType === 'repeated' ? (r.repeatVar ?? null) : r.repeatVar } : r
    ));
  }

  function patchBody(changes) {
    setAllRowSets(allRowSets.map(r => r.id === rs?.id ? { ...r, ...changes } : r));
  }

  return (
    <div className="rst__section">
      <div className="rst__section-header">
        <span className="rst__section-badge" style={{ background: '#6d28d9' }}>CUERPO</span>
        <span className="rst__section-title">Cuerpo de la tabla</span>
        {rs && (
          <div className="rst__body-type-tabs">
            <button
              className={`rst__body-type-btn${rs.type === 'multiple-rows' ? ' rst__body-type-btn--active' : ''}`}
              onClick={() => changeBodyType('multiple-rows')}
            >
              Estático
            </button>
            <button
              className={`rst__body-type-btn${rs.type === 'repeated' ? ' rst__body-type-btn--active' : ''}`}
              onClick={() => changeBodyType('repeated')}
            >
              <RefreshCw size={9} /> Repetido
            </button>
          </div>
        )}
      </div>

      {!rs && (
        <div className="rst__section-body rst__no-rs">
          <button className="rst__add-row-btn" onClick={() => createBody('multiple-rows')}>
            <Plus size={11} /> Filas estáticas
          </button>
          <button className="rst__add-row-btn" onClick={() => createBody('repeated')}>
            <RefreshCw size={11} /> Filas repetidas
          </button>
        </div>
      )}

      {rs && (
        <div className="rst__section-body">
          {rs.type === 'repeated' && (
            <div className="pp-field" style={{ padding: '4px 8px 2px' }}>
              <label className="pp-field__label">Variable de repetición</label>
              <input
                className="pp-field__input"
                value={rs.repeatVar ?? ''}
                placeholder="ej. datos.transacciones"
                onChange={e => patchBody({ repeatVar: e.target.value })}
              />
            </div>
          )}
          <RowList containerRS={rs} allRowSets={allRowSets} columns={columns} setAllRowSets={setAllRowSets} />
        </div>
      )}
    </div>
  );
}

// ── Multiple-rows root view ───────────────────────────────────────────────

function MultipleRowsView({ root, allRowSets, columns, element, state, onUpdate }) {
  const [showDialog, setShowDialog] = useState(false);
  const childIds = root.childIds ?? [];

  function handleAddChild(type) {
    setShowDialog(false);
    if (state?.addChildRowSet) {
      state.addChildRowSet(element.id, root.id, type);
    }
  }

  function handleRemoveChild(childId) {
    if (childIds.length <= 1) return;
    if (state?.removeChildRowSet) {
      state.removeChildRowSet(element.id, root.id, childId);
    }
  }

  function navigateTo(childId) {
    state?.setTableRowSetCtx?.({ elId: element.id, rowSetId: childId });
  }

  return (
    <div className="rst">
      <div className="rst__mr-header">
        <span className="rst__intro">RowSet contenedor — {childIds.length} fila{childIds.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="rst__mr-list">
        {childIds.map((id, i) => {
          const child = allRowSets.find(r => r.id === id);
          if (!child) return null;
          const typeLabel = RS_TYPE_LABELS[child.type] ?? child.type;
          return (
            <div key={id} className="rst__mr-item">
              <button className="rst__mr-navigate" onClick={() => navigateTo(id)} title="Ver propiedades">
                <span className="rst__mr-name">{child.name ?? `Fila ${i + 1}`}</span>
                <span className="rst__mr-type">({typeLabel})</span>
                <span className="rst__mr-arrow">›</span>
              </button>
              <button
                className="rst__mr-delete"
                onClick={() => handleRemoveChild(id)}
                disabled={childIds.length <= 1}
                title="Eliminar"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
        {childIds.length === 0 && (
          <p className="rst__empty-rows">Sin filas hijo.</p>
        )}
      </div>

      <button className="rst__add-row-btn rst__add-row-btn--full" onClick={() => setShowDialog(true)}>
        <Plus size={11} /> Agregar RowSet
      </button>

      {showDialog && (
        <InsertRowSetDialog
          onConfirm={handleAddChild}
          onCancel={() => setShowDialog(false)}
        />
      )}
    </div>
  );
}

// ── Single-row root view ──────────────────────────────────────────────────

function SingleRowRootView({ root, columns, onUpdate, allRowSets }) {
  function patchRoot(changes) {
    onUpdate({ rowSets: allRowSets.map(r => r.id === root.id ? { ...r, ...changes } : r) });
  }
  return (
    <div className="rst">
      <p className="rst__intro">Fila única — edita el contenido de cada celda.</p>
      <SingleRowEditor rs={root} columns={columns} patchRS={patchRoot} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function RowSetsTab({ element, onUpdate, state }) {
  const columns    = element.columns ?? [];
  const allRowSets = element.rowSets ?? [];
  const rootId     = element.rootRowSetId;
  const root       = allRowSets.find(r => r.id === rootId);

  if (!root) {
    return (
      <div className="rst">
        <p className="rst__intro" style={{ color: '#ef4444', fontStyle: 'italic' }}>
          Sin RowSet raíz. Recrea la tabla.
        </p>
      </div>
    );
  }

  // multiple-rows root → child list with navigation
  if (root.type === 'multiple-rows') {
    return (
      <MultipleRowsView
        root={root}
        allRowSets={allRowSets}
        columns={columns}
        element={element}
        state={state}
        onUpdate={onUpdate}
      />
    );
  }

  // single-row root → inline cell editor
  if (root.type === 'single-row') {
    return (
      <SingleRowRootView
        root={root}
        columns={columns}
        onUpdate={onUpdate}
        allRowSets={allRowSets}
      />
    );
  }

  // header-footer root → full section editor
  if (root.type === 'header-footer') {
    function setAllRowSets(newRowSets) {
      onUpdate({ rowSets: newRowSets });
    }

    function updateRoot(changes) {
      setAllRowSets(allRowSets.map(r => r.id === rootId ? { ...root, ...changes } : r));
    }

    const linkedHeader = root.firstHeaderId && root.firstHeaderId === root.headerId;
    const linkedFooter = root.lastFooterId  && root.lastFooterId  === root.footerId;

    function enableFirstHeader() {
      if (root.headerId) {
        updateRoot({ firstHeaderId: root.headerId });
      } else {
        const newRS = blankSingleRow(columns, '1ª Cabecera');
        setAllRowSets([...allRowSets, newRS].map(r => r.id === rootId ? { ...root, firstHeaderId: newRS.id } : r));
      }
    }

    function enableFooter() {
      const newRS = blankSingleRow(columns, 'Pie');
      setAllRowSets([...allRowSets, newRS].map(r => r.id === rootId ? { ...root, footerId: newRS.id } : r));
    }

    function enableLastFooter() {
      if (root.footerId) {
        updateRoot({ lastFooterId: root.footerId });
      } else {
        const newRS = blankSingleRow(columns, 'Último Pie');
        setAllRowSets([...allRowSets, newRS].map(r => r.id === rootId ? { ...root, lastFooterId: newRS.id } : r));
      }
    }

    return (
      <div className="rst">
        <p className="rst__intro">
          Define las secciones: cabeceras (se repiten al paginar), cuerpo y pies.
        </p>
        <SectionBlock
          title="1ª Cabecera" badge="1ª CAB" badgeColor="#1d4ed8"
          rsId={root.firstHeaderId} linkedBadge={linkedHeader ? '= Cabecera' : null}
          enabled={!!root.firstHeaderId} canDisable
          allRowSets={allRowSets} columns={columns} setAllRowSets={setAllRowSets}
          onEnable={enableFirstHeader} onDisable={() => updateRoot({ firstHeaderId: null })}
          onSetRsId={id => updateRoot({ firstHeaderId: id })}
        />
        <SectionBlock
          title="Cabecera" badge="CAB" badgeColor="#0369a1"
          rsId={root.headerId} linkedBadge={null}
          enabled canDisable={false}
          allRowSets={allRowSets} columns={columns} setAllRowSets={setAllRowSets}
          onSetRsId={id => {
            const changes = { headerId: id };
            if (linkedHeader) changes.firstHeaderId = id;
            updateRoot(changes);
          }}
        />
        <BodySection
          root={root} allRowSets={allRowSets} columns={columns}
          setAllRowSets={setAllRowSets}
          onSetBodyId={id => updateRoot({ bodyId: id })}
        />
        <SectionBlock
          title="Pie" badge="PIE" badgeColor="#15803d"
          rsId={root.footerId} linkedBadge={null}
          enabled={!!root.footerId} canDisable
          allRowSets={allRowSets} columns={columns} setAllRowSets={setAllRowSets}
          onEnable={enableFooter}
          onDisable={() => {
            const changes = { footerId: null };
            if (linkedFooter) changes.lastFooterId = null;
            updateRoot(changes);
          }}
          onSetRsId={id => {
            const changes = { footerId: id };
            if (linkedFooter) changes.lastFooterId = id;
            updateRoot(changes);
          }}
        />
        <SectionBlock
          title="Último Pie" badge="ÚLT" badgeColor="#166534"
          rsId={root.lastFooterId} linkedBadge={linkedFooter ? '= Pie' : null}
          enabled={!!root.lastFooterId} canDisable
          allRowSets={allRowSets} columns={columns} setAllRowSets={setAllRowSets}
          onEnable={enableLastFooter} onDisable={() => updateRoot({ lastFooterId: null })}
          onSetRsId={id => updateRoot({ lastFooterId: id })}
        />
      </div>
    );
  }

  return (
    <div className="rst">
      <p className="rst__intro" style={{ color: '#6b7280', fontStyle: 'italic' }}>
        Tipo de RowSet raíz ({root.type}) no editable en este panel.
      </p>
    </div>
  );
}
