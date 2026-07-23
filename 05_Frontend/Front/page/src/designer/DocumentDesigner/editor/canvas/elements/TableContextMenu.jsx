// TableContextMenu.jsx — Right-click menu over a table cell. Word-style submenus
// for Insert / Delete / Distribute. Opens via portal at the click position.

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight, RowsIcon, Columns3, Trash2, Combine, Split,
  AlignVerticalSpaceAround, AlignHorizontalSpaceAround, Settings,
  Plus, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
} from 'lucide-react';
import './TableContextMenu.css';

function MenuItem({ icon: Icon, label, onClick, disabled, danger, hasSubmenu, onMouseEnter }) {
  return (
    <button
      className={`tcm__item${disabled ? ' tcm__item--disabled' : ''}${danger ? ' tcm__item--danger' : ''}`}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={onMouseEnter}
      disabled={disabled}
    >
      {Icon ? <Icon size={13} className="tcm__item-icon" /> : <span className="tcm__item-icon" />}
      <span className="tcm__item-label">{label}</span>
      {hasSubmenu && <ChevronRight size={12} className="tcm__item-arrow" />}
    </button>
  );
}

function Sep() { return <div className="tcm__sep" />; }

export default function TableContextMenu({
  position, tableEl, selection, onClose,
  onInsertRowAbove, onInsertRowBelow,
  onInsertColLeft, onInsertColRight,
  onDeleteRows, onDeleteColumns, onDeleteTable,
  onMergeCells, onUnmergeCells,
  onDistributeRows, onDistributeColumns,
  onCellProperties,
}) {
  const ref = useRef(null);
  const [openSubmenu, setOpenSubmenu] = useState(null); // 'insert' | 'delete' | 'distribute' | null
  const [submenuPos, setSubmenuPos] = useState(null);

  // Close on click outside / escape
  useEffect(() => {
    function onDown(e) {
      if (!ref.current?.contains(e.target)) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const cells = selection ?? [];
  const hasSel = cells.length > 0;
  const multiSel = cells.length >= 2;

  // "Descombinar" must be reachable from the merged block's visible anchor:
  // spanned cells render display:none and can't be selected, and the anchor
  // itself carries no span. So gate on the table having ANY merged cell
  // (+ a selection), not on the selected cell carrying the span.
  const tableHasSpan = (tableEl?.rowSets ?? []).some(rs =>
    (rs.cells ?? []).some(c => c.spanLeft || c.spanUp)
  );

  // Unique rowSets / cols in selection
  const selRowSetIds = [...new Set(cells.map(c => c.rowSetId))];
  const selColIds    = [...new Set(cells.map(c => c.colId))];

  // Word-like multi-insert: N selected rows/cols → insert N. `cells` is in
  // visual order (top-left → bottom-right): edge is cells[0] for above/left,
  // last cell for below/right.
  const rowN = Math.max(1, selRowSetIds.length);
  const colN = Math.max(1, selColIds.length);
  const firstCell = cells[0];
  const lastCell  = cells[cells.length - 1];
  const rowLbl = rowN > 1 ? `${rowN} filas` : 'Fila';
  const colLbl = colN > 1 ? `${colN} columnas` : 'Columna';

  function openSubAt(name, e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setSubmenuPos({ x: rect.right - 4, y: rect.top });
    setOpenSubmenu(name);
  }

  function fire(fn, ...args) { fn?.(...args); onClose(); }

  return createPortal(
    <div
      ref={ref}
      className="tcm"
      style={{ top: position.y, left: position.x }}
      onContextMenu={e => e.preventDefault()}
    >
      <MenuItem icon={Plus} label="Insertar" hasSubmenu disabled={!hasSel}
        onMouseEnter={hasSel ? (e => openSubAt('insert', e)) : undefined} />
      <MenuItem icon={Trash2} label="Eliminar" hasSubmenu danger
        onMouseEnter={(e => openSubAt('delete', e))} />
      <Sep />
      <MenuItem icon={Combine} label="Combinar celdas" disabled={!multiSel}
        onClick={() => fire(onMergeCells, cells)} />
      <MenuItem icon={Split} label="Descombinar celdas" disabled={!hasSel || !tableHasSpan}
        onClick={() => fire(onUnmergeCells, cells)} />
      <Sep />
      <MenuItem icon={AlignVerticalSpaceAround} label="Distribuir" hasSubmenu
        onMouseEnter={(e => openSubAt('distribute', e))} />
      <Sep />
      <MenuItem icon={Settings} label="Propiedades de celda..." disabled={!hasSel}
        onClick={() => fire(onCellProperties, cells)} />

      {/* ── Submenu: Insert ── */}
      {openSubmenu === 'insert' && submenuPos && hasSel && (
        <div className="tcm tcm--sub" style={{ top: submenuPos.y, left: submenuPos.x }}>
          <MenuItem icon={ArrowUp}    label={`${rowLbl} arriba`}     onClick={() => fire(onInsertRowAbove, firstCell, rowN)} />
          <MenuItem icon={ArrowDown}  label={`${rowLbl} debajo`}     onClick={() => fire(onInsertRowBelow, lastCell,  rowN)} />
          <Sep />
          <MenuItem icon={ArrowLeft}  label={`${colLbl} izquierda`} onClick={() => fire(onInsertColLeft,  firstCell, colN)} />
          <MenuItem icon={ArrowRight} label={`${colLbl} derecha`}   onClick={() => fire(onInsertColRight, lastCell,  colN)} />
        </div>
      )}

      {/* ── Submenu: Delete ── */}
      {openSubmenu === 'delete' && submenuPos && (
        <div className="tcm tcm--sub" style={{ top: submenuPos.y, left: submenuPos.x }}>
          <MenuItem icon={RowsIcon}  label={`Fila${selRowSetIds.length > 1 ? 's' : ''}`}
            disabled={!hasSel} onClick={() => fire(onDeleteRows, selRowSetIds)} />
          <MenuItem icon={Columns3}  label={`Columna${selColIds.length > 1 ? 's' : ''}`}
            disabled={!hasSel} onClick={() => fire(onDeleteColumns, selColIds)} />
          <Sep />
          <MenuItem icon={Trash2} label="Tabla completa" danger onClick={() => fire(onDeleteTable)} />
        </div>
      )}

      {/* ── Submenu: Distribute ── */}
      {openSubmenu === 'distribute' && submenuPos && (
        <div className="tcm tcm--sub" style={{ top: submenuPos.y, left: submenuPos.x }}>
          <MenuItem icon={AlignVerticalSpaceAround}   label={multiSel ? 'Filas seleccionadas' : 'Todas las filas'}
            onClick={() => fire(onDistributeRows, multiSel ? selRowSetIds : null)} />
          <MenuItem icon={AlignHorizontalSpaceAround} label={multiSel ? 'Columnas seleccionadas' : 'Todas las columnas'}
            onClick={() => fire(onDistributeColumns, multiSel ? selColIds : null)} />
        </div>
      )}
    </div>,
    document.body,
  );
}
