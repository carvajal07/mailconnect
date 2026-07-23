import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Layers, MoreVertical, Pencil } from 'lucide-react';
import { ResourceItemMenu } from '../components/ResourceItemMenu.jsx';

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

function AreaNode({ area, depth }) {
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
      {open && children.map(c => <AreaNode key={c.id} area={c} depth={depth + 1} />)}
    </>
  );
}

function CellNode({ cell, onSelect, onOpenMenu }) {
  const [open, setOpen] = useState(false);
  const flowChildren = cell.flow?.children ?? [];
  const hasFlow = !!cell.flow;

  return (
    <>
      <div
        className="dsb-resource__item"
        onContextMenu={e => { e.preventDefault(); onOpenMenu(e.clientX, e.clientY); }}
      >
        <span className="dsb-resource__item-toggle" onClick={() => hasFlow && setOpen(v => !v)}>
          {hasFlow ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <span style={{ fontSize: 10, flexShrink: 0, marginRight: 4, color: 'var(--color-text-tertiary)' }}>▣</span>
        <span className="dsb-resource__item-label dsb-resource__item-label--btn" onClick={onSelect}>
          {cell.colLabel ?? cell.colId}
        </span>
        <span className="dsb-resource__item-badge">{cell.rowSetName} · {cell.tableLabel}</span>
        <button
          className="dsb-resource__item-more"
          onMouseDown={e => e.preventDefault()}
          onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onOpenMenu(r.right, r.bottom + 2); }}
        >
          <MoreVertical size={10} />
        </button>
      </div>
      {open && hasFlow && (
        <>
          {flowChildren.length === 0
            ? <div className="dsb-resource__item" style={{ paddingLeft: 20 }}>
                <span className="dsb-resource__item-toggle"><span className="dsb-resource__item-toggle-gap" /></span>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Sin sub-áreas</span>
              </div>
            : flowChildren.map(a => <AreaNode key={a.id} area={a} depth={1} />)
          }
        </>
      )}
    </>
  );
}

export function CeldasResourceSection({ state, forceOpen, expandTick }) {
  const [open, setOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState(null);

  const cells = [
    ...(state.template?.pages ?? []).flatMap((p, pageIdx) =>
      (p.elements ?? [])
        .filter(el => el.type === 'table')
        .flatMap(el =>
          (el.rowSets ?? []).flatMap(rs =>
            (rs.cells ?? []).map(c => {
              const col = (el.columns ?? []).find(col => col.id === c.colId);
              return {
                ...c,
                colLabel: col?.label ?? c.colId,
                rowSetId: rs.id,
                rowSetName: rs.name ?? rs.id,
                tableId: el.id,
                tableLabel: el.label ?? 'Tabla',
                pageIdx,
              };
            })
          )
        )
    ),
    ...collectEmbeddedTables(state.template).flatMap(tbl =>
      (tbl.rowSets ?? []).flatMap(rs =>
        (rs.cells ?? []).map(c => {
          const col = (tbl.columns ?? []).find(col => col.id === c.colId);
          return {
            ...c,
            colLabel: col?.label ?? c.colId,
            rowSetId: rs.id,
            rowSetName: rs.name ?? rs.id,
            tableId: tbl.id,
            tableLabel: tbl.label ?? 'Tabla',
            pageIdx: tbl.pageIdx,
            caId: tbl.caId,
          };
        })
      )
    ),
  ];

  useEffect(() => {
    if (expandTick > 0) setOpen(!!forceOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTick]);

  function handleSelect(cell) {
    state.setCurrentPageIndex?.(cell.pageIdx);
    state.selectElement?.(cell.tableId, false);
    state.setTableRowSetCtx?.({ elId: cell.tableId, rowSetId: cell.rowSetId, colId: cell.colId });
    state.setPanelContext?.('element');
  }

  function getMenuActions(cell) {
    return [
      { label: 'Editar', Icon: Pencil, onClick: () => handleSelect(cell) },
    ];
  }

  return (
    <div className="dsb-resource">
      <button
        className="dsb-resource__header"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ fontSize: 10, marginRight: 2 }}>▣</span>
        <span>Celdas</span>
        <span className="dsb-resource__count">{cells.length}</span>
      </button>

      {open && (
        <div className="dsb-resource__body">
          {cells.length > 0
            ? cells.map((cell, i) => (
                <CellNode
                  key={`${cell.rowSetId}:${cell.colId}:${i}`}
                  cell={cell}
                  onSelect={() => handleSelect(cell)}
                  onOpenMenu={(x, y) => setItemMenu({ x, y, cell })}
                />
              ))
            : <p className="dsb-resource__empty">Sin celdas</p>
          }
        </div>
      )}

      {itemMenu && (
        <ResourceItemMenu
          x={itemMenu.x} y={itemMenu.y}
          actions={getMenuActions(itemMenu.cell)}
          onClose={() => setItemMenu(null)}
        />
      )}
    </div>
  );
}
