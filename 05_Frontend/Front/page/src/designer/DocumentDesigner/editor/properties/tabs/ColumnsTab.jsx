// editor/properties/tabs/ColumnsTab.jsx — Column management for table element

import { useState } from 'react';
import { GripVertical, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import './ColumnsTab.css';

let _colCounter = 1;
function newColId() { return `col_${Date.now()}_${_colCounter++}`; }

// ── Normalise so ratios always sum to 1 ──────────────────────────────────

function normaliseRatios(cols) {
  const total = cols.reduce((s, c) => s + (c.widthRatio ?? 1), 0) || 1;
  return cols.map(c => ({ ...c, widthRatio: (c.widthRatio ?? 1) / total }));
}

// ── Single column row ─────────────────────────────────────────────────────

function ColumnRow({ col, index, total, onChange, onDelete, onMove }) {
  const [expanded, setExpanded] = useState(false);

  const widthPct = Math.round((col.widthRatio ?? 1/3) * 1000) / 10; // 1 decimal

  function handleWidthPctChange(e) {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0 && v <= 100) {
      onChange({ widthRatio: v / 100 });
    }
  }

  function handleMinWidthChange(e) {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) onChange({ minWidth: v });
  }

  return (
    <div className="coltab__col">
      {/* ── Header row ───────────────────────────────────────────── */}
      <div className="coltab__col-header">
        <button
          className="coltab__expand-btn"
          onClick={() => setExpanded(x => !x)}
          title={expanded ? 'Colapsar' : 'Expandir'}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        <GripVertical size={12} className="coltab__grip" />

        <input
          className="coltab__label-input"
          value={col.label ?? ''}
          placeholder={`Columna ${index + 1}`}
          onChange={e => onChange({ label: e.target.value })}
        />

        <span className="coltab__pct-badge">{widthPct}%</span>

        <button
          className="coltab__delete-btn"
          onClick={onDelete}
          disabled={total <= 1}
          title="Eliminar columna"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* ── Expanded detail ──────────────────────────────────────── */}
      {expanded && (
        <div className="coltab__col-detail">
          <div className="pp-row pp-row--mb">
            <div className="pp-field">
              <label className="pp-field__label">Ancho relativo (%)</label>
              <input
                type="number"
                className="pp-field__input"
                min="1"
                max="100"
                step="1"
                value={widthPct}
                onChange={handleWidthPctChange}
              />
              <span className="coltab__hint">Los anchos se normalizan automáticamente.</span>
            </div>
            <div className="pp-field">
              <label className="pp-field__label">Ancho mín. (mm)</label>
              <input
                type="number"
                className="pp-field__input"
                min="0"
                step="0.5"
                value={col.minWidth ?? 5}
                onChange={handleMinWidthChange}
              />
            </div>
          </div>

          <div className="coltab__toggles">
            <label className="coltab__toggle">
              <input
                type="checkbox"
                checked={col.headerTag ?? false}
                onChange={e => onChange({ headerTag: e.target.checked })}
              />
              <span>Marcar como encabezado (accesibilidad)</span>
            </label>
          </div>

          <div className="coltab__move-row">
            <button
              className="coltab__move-btn"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              ← Izquierda
            </button>
            <button
              className="coltab__move-btn"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              Derecha →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ColumnsTab({ element, onUpdate }) {
  const columns  = element.columns ?? [];
  const rowSets  = element.rowSets ?? [];

  function updateColumns(newCols) {
    const normalised = normaliseRatios(newCols);
    const updatedRowSets = syncRowSetsToColumns(rowSets, normalised);
    onUpdate({ columns: normalised, rowSets: updatedRowSets });
  }

  function updateColumn(index, changes) {
    const newCols = columns.map((c, i) => i === index ? { ...c, ...changes } : c);
    updateColumns(newCols);
  }

  function deleteColumn(index) {
    if (columns.length <= 1) return;
    const removedId = columns[index].id;
    const newCols = normaliseRatios(columns.filter((_, i) => i !== index));
    const updatedRowSets = removeCellFromRowSets(rowSets, removedId);
    onUpdate({ columns: newCols, rowSets: updatedRowSets });
  }

  function moveColumn(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= columns.length) return;
    const newCols = [...columns];
    [newCols[index], newCols[target]] = [newCols[target], newCols[index]];
    updateColumns(newCols);
  }

  function addColumn() {
    const label  = `Columna ${columns.length + 1}`;
    const newCol = { id: newColId(), label, widthRatio: 1 / (columns.length + 1), minWidth: 5, headerTag: false, enabledBy: null };
    const normalised = normaliseRatios([...columns, newCol]);
    const updatedRowSets = addCellToRowSets(rowSets, newCol);
    onUpdate({ columns: normalised, rowSets: updatedRowSets });
  }

  function distributeEvenly() {
    const ratio = 1 / columns.length;
    const newCols = columns.map(c => ({ ...c, widthRatio: ratio }));
    onUpdate({ columns: newCols });
  }

  return (
    <div className="coltab">
      <div className="coltab__header">
        <span className="coltab__count">{columns.length} columna{columns.length !== 1 ? 's' : ''}</span>
        <button className="coltab__distribute-btn" onClick={distributeEvenly} title="Distribuir uniformemente">
          Distribuir
        </button>
      </div>

      <div className="coltab__list">
        {columns.map((col, i) => (
          <ColumnRow
            key={col.id}
            col={col}
            index={i}
            total={columns.length}
            onChange={changes => updateColumn(i, changes)}
            onDelete={() => deleteColumn(i)}
            onMove={dir => moveColumn(i, dir)}
          />
        ))}
      </div>

      <button className="coltab__add-btn" onClick={addColumn}>
        <Plus size={13} /> Agregar columna
      </button>
    </div>
  );
}

// ── RowSet pool synchronization helpers ──────────────────────────────────

function blankCell(colId) {
  return {
    id: `cell_${Date.now()}_${Math.random()}`,
    colId,
    flow: { content: '' },
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

function syncRowSetsToColumns(rowSets, newCols) {
  return rowSets.map(rs => {
    if (rs.type !== 'single-row') return rs;
    return {
      ...rs,
      cells: newCols.map(col => {
        const existing = (rs.cells ?? []).find(c => c.colId === col.id);
        return existing ?? blankCell(col.id);
      }),
    };
  });
}

function removeCellFromRowSets(rowSets, colId) {
  return rowSets.map(rs => {
    if (rs.type !== 'single-row') return rs;
    return { ...rs, cells: (rs.cells ?? []).filter(c => c.colId !== colId) };
  });
}

function addCellToRowSets(rowSets, newCol) {
  return rowSets.map(rs => {
    if (rs.type !== 'single-row') return rs;
    return { ...rs, cells: [...(rs.cells ?? []), blankCell(newCol.id)] };
  });
}
