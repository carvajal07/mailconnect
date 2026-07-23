import { useState, useEffect } from 'react';
import {
  ChevronRight, ChevronDown, Plus, AlignLeft, Layers,
  Pencil, Trash2, Copy, PenLine, MoreVertical,
  Minus, AlignJustify, RefreshCw, LayoutList, GitBranch,
} from 'lucide-react';
import { ResourceItemMenu } from '../components/ResourceItemMenu.jsx';

// ── Embedded-table helper ──────────────────────────────────────────────────

function collectEmbeddedTables(template) {
  const result = [];
  for (const [pageIdx, p] of (template?.pages ?? []).entries()) {
    const pageName = p.name ?? `Pág. ${pageIdx + 1}`;
    for (const caEl of (p.elements ?? [])) {
      if (caEl.type !== 'contentarea' || !caEl.areaRef) continue;
      const topArea = (template.contentAreas ?? []).find(a => a.id === caEl.areaRef);
      if (!topArea) continue;
      const scan = (area) => {
        for (const el of (area.elements ?? [])) {
          if (el.type === 'table') result.push({ ...el, pageIdx, pageName, caId: caEl.id, areaId: area.id });
        }
        for (const child of (area.children ?? [])) scan(child);
      };
      scan(topArea);
    }
  }
  return result;
}

// ── Type label translations ────────────────────────────────────────────────

const RS_TYPE_LABELS = {
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

// ── Inner tree nodes ───────────────────────────────────────────────────────

function CellAreaNode({ area, depth }) {
  const [open, setOpen] = useState(true);
  const children = area.children ?? [];
  return (
    <>
      <div className="dsb-resource__item" style={{ paddingLeft: 6 + depth * 14 }}>
        <span className="dsb-resource__item-toggle" onClick={() => children.length && setOpen(v => !v)}>
          {children.length ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <Layers size={10} className="dsb-resource__item-icon" />
        <span className="dsb-resource__item-label">{area.label ?? area.id}</span>
      </div>
      {open && children.map(c => <CellAreaNode key={c.id} area={c} depth={depth + 1} />)}
    </>
  );
}

function CellNode({ cell, col, depth }) {
  const [open, setOpen] = useState(false);
  const hasFlow = !!cell.flow;
  const flowChildren = cell?.flow?.children ?? [];
  return (
    <>
      <div className="dsb-resource__item" style={{ paddingLeft: 6 + depth * 14 }}>
        <span className="dsb-resource__item-toggle" onClick={() => hasFlow && setOpen(v => !v)}>
          {hasFlow ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <span style={{ fontSize: 10, flexShrink: 0, marginRight: 4, color: 'var(--color-text-tertiary)' }}>▣</span>
        <span className="dsb-resource__item-label">{cell.label ?? col?.label ?? cell.colId}</span>
        <span className="dsb-resource__item-badge">celda</span>
      </div>
      {open && hasFlow && (
        <CellAreaNode
          area={{ ...cell.flow, label: cell.flow.label ?? 'Área', children: flowChildren }}
          depth={depth + 1}
        />
      )}
    </>
  );
}

const CONTAINER_TYPES = new Set(['multiple-rows', 'repeated', 'header-footer', 'select-by-condition', 'select-by-integer', 'select-by-interval', 'select-by-text', 'select-by-inline']);

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

function RSNode({ rs, allRowSets, columns, depth, tableId, state }) {
  const [open, setOpen] = useState(false);
  const isContainer = CONTAINER_TYPES.has(rs.type);
  const children = isContainer
    ? (rs.childIds ?? []).map(id => allRowSets.find(r => r.id === id)).filter(Boolean)
    : [];
  const cells = rs.cells ?? [];
  const hasChildren = isContainer ? children.length > 0 : cells.length > 0;

  function handleClick() {
    if (tableId && state) {
      state.setTableRowSetCtx?.({ elId: tableId, rowSetId: rs.id });
      state.setPanelContext?.('element');
    }
  }

  const { Icon: RsIcon, color: rsColor } = getRsIcon(rs.type);

  return (
    <>
      <div className="dsb-resource__item" style={{ paddingLeft: 6 + depth * 14 }}>
        <span className="dsb-resource__item-toggle" onClick={() => hasChildren && setOpen(v => !v)}>
          {hasChildren ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <RsIcon size={10} style={{ flexShrink: 0, marginRight: 4, color: rsColor }} />
        <span
          className="dsb-resource__item-label dsb-resource__item-label--btn"
          onClick={handleClick}
        >
          {rs.name ?? rs.id}
        </span>
        <span className="dsb-resource__item-badge">{RS_TYPE_LABELS[rs.type] ?? rs.type}</span>
      </div>
      {open && isContainer && children.map(child => (
        <RSNode key={child.id} rs={child} allRowSets={allRowSets} columns={columns} depth={depth + 1} tableId={tableId} state={state} />
      ))}
      {open && !isContainer && cells.map(cell => {
        const col = columns.find(c => c.id === cell.colId);
        return <CellNode key={cell.colId} cell={cell} col={col} depth={depth + 1} />;
      })}
    </>
  );
}

function TableNode({ table, renamingId, renamingName, onRenamingChange, onCommitRename, onSelect, onOpenMenu, state }) {
  const [open, setOpen] = useState(false);
  const rowSets = table.rowSets ?? [];
  const columns = table.columns ?? [];
  const rootId  = table.rootRowSetId;
  const rootRs  = rowSets.find(r => r.id === rootId);

  return (
    <>
      <div
        className="dsb-resource__item"
        onContextMenu={e => { e.preventDefault(); onOpenMenu(e.clientX, e.clientY); }}
      >
        <span className="dsb-resource__item-toggle" onClick={() => rootRs && setOpen(v => !v)}>
          {rootRs ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <AlignLeft size={10} className="dsb-resource__item-icon" />
        {renamingId === table.id
          ? <input
              className="dsb-resource__item-name"
              autoFocus
              value={renamingName}
              onChange={e => onRenamingChange(e.target.value)}
              onBlur={() => onCommitRename(table.id)}
              onKeyDown={e => { if (e.key === 'Enter') onCommitRename(table.id); if (e.key === 'Escape') onCommitRename(null); e.stopPropagation(); }}
              onClick={e => e.stopPropagation()}
            />
          : <span className="dsb-resource__item-label dsb-resource__item-label--btn" onClick={onSelect}>
              {table.label ?? 'Tabla'}
            </span>
        }
        <span className="dsb-resource__item-badge">{table.pageName}</span>
        <button
          className="dsb-resource__item-more"
          onMouseDown={e => e.preventDefault()}
          onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onOpenMenu(r.right, r.bottom + 2); }}
        >
          <MoreVertical size={10} />
        </button>
      </div>
      {open && rootRs && (
        <RSNode
          rs={rootRs}
          allRowSets={rowSets}
          columns={columns}
          depth={1}
          tableId={table.id}
          state={state}
        />
      )}
    </>
  );
}

// ── Section ────────────────────────────────────────────────────────────────

export function TablasResourceSection({ state, forceOpen, expandTick }) {
  const [open, setOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renamingName, setRenamingName] = useState('');

  const tables = [
    ...(state.template?.pages ?? []).flatMap((p, pageIdx) =>
      (p.elements ?? [])
        .filter(el => el.type === 'table')
        .map(el => ({ ...el, pageIdx, pageName: p.name ?? `Pág. ${pageIdx + 1}` }))
    ),
    ...collectEmbeddedTables(state.template),
  ];

  useEffect(() => {
    if (expandTick > 0) setOpen(!!forceOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTick]);

  function handleAdd() {
    state.addElement?.('table', { x: 20, y: 20, width: 140, height: 60 });
  }

  function handleSelect(table) {
    state.setCurrentPageIndex?.(table.pageIdx);
    // Embedded tables: select the parent ContentArea element
    state.selectElement?.(table.caId ?? table.id, false);
    state.setPanelContext?.('element');
  }

  function startRename(table) {
    setRenamingId(table.id);
    setRenamingName(table.label ?? '');
  }

  function commitRename(id) {
    if (id && renamingName.trim()) state.updateAnyElement?.(id, { label: renamingName.trim() });
    setRenamingId(null);
  }

  function getMenuActions(table) {
    return [
      { label: 'Editar', Icon: Pencil, onClick: () => handleSelect(table) },
      { label: 'Renombrar', Icon: PenLine, onClick: () => startRename(table) },
      { label: 'Clonar', Icon: Copy, onClick: () => state.clonePageElement?.(table.id) },
      { label: 'Eliminar', Icon: Trash2, danger: true, onClick: () => state.removeAnyElement?.(table.id) },
    ];
  }

  return (
    <div className="dsb-resource">
      <button
        className="dsb-resource__header"
        onClick={() => setOpen(v => !v)}
        onContextMenu={e => { e.preventDefault(); setHeaderMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <AlignLeft size={13} />
        <span>Tablas</span>
        <span className="dsb-resource__count">{tables.length}</span>
        <span
          className="dsb-resource__add-btn"
          role="button" tabIndex={0}
          title="Agregar tabla"
          onClick={e => { e.stopPropagation(); handleAdd(); }}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        >
          <Plus size={11} />
        </span>
      </button>

      {open && (
        <div className="dsb-resource__body">
          {tables.length > 0
            ? tables.map(table => (
                <TableNode
                  key={table.id}
                  table={table}
                  renamingId={renamingId}
                  renamingName={renamingName}
                  onRenamingChange={setRenamingName}
                  onCommitRename={commitRename}
                  onSelect={() => handleSelect(table)}
                  onOpenMenu={(x, y) => setItemMenu({ x, y, table })}
                  state={state}
                />
              ))
            : <p className="dsb-resource__empty">Sin tablas en el template</p>
          }
        </div>
      )}

      {itemMenu && (
        <ResourceItemMenu
          x={itemMenu.x} y={itemMenu.y}
          actions={getMenuActions(itemMenu.table)}
          onClose={() => setItemMenu(null)}
        />
      )}
      {headerMenu && (
        <ResourceItemMenu
          x={headerMenu.x} y={headerMenu.y}
          actions={[{ label: 'Agregar tabla', Icon: Plus, onClick: handleAdd }]}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </div>
  );
}
