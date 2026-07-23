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
        <span className="dsb-resource__item-label">{col?.label ?? cell.colId}</span>
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

function RSNode({ rs, onSelect, onOpenMenu }) {
  const [open, setOpen] = useState(false);
  const cells = rs.cells ?? [];

  return (
    <>
      <div
        className="dsb-resource__item"
        onContextMenu={e => { e.preventDefault(); onOpenMenu(e.clientX, e.clientY); }}
      >
        <span className="dsb-resource__item-toggle" onClick={() => cells.length && setOpen(v => !v)}>
          {cells.length ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <span style={{ fontSize: 10, flexShrink: 0, marginRight: 4, color: 'var(--color-text-tertiary)' }}>≡</span>
        <span className="dsb-resource__item-label dsb-resource__item-label--btn" onClick={onSelect}>
          {rs.name ?? rs.id}
        </span>
        <span className="dsb-resource__item-badge">{rs.type} · {rs.tableLabel}</span>
        <button
          className="dsb-resource__item-more"
          onMouseDown={e => e.preventDefault()}
          onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onOpenMenu(r.right, r.bottom + 2); }}
        >
          <MoreVertical size={10} />
        </button>
      </div>
      {open && cells.map(cell => {
        const col = rs.columns.find(c => c.id === cell.colId);
        return <CellNode key={cell.colId} cell={cell} col={col} depth={1} />;
      })}
    </>
  );
}

export function RowSetsResourceSection({ state, forceOpen, expandTick }) {
  const [open, setOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState(null);

  const rowSets = [
    ...(state.template?.pages ?? []).flatMap((p, pageIdx) =>
      (p.elements ?? [])
        .filter(el => el.type === 'table')
        .flatMap(el =>
          (el.rowSets ?? []).map(rs => ({
            ...rs,
            tableId: el.id,
            tableLabel: el.label ?? 'Tabla',
            columns: el.columns ?? [],
            pageIdx,
            pageName: p.name ?? `Pág. ${pageIdx + 1}`,
          }))
        )
    ),
    ...collectEmbeddedTables(state.template).flatMap(tbl =>
      (tbl.rowSets ?? []).map(rs => ({
        ...rs,
        tableId: tbl.id,
        tableLabel: tbl.label ?? 'Tabla',
        columns: tbl.columns ?? [],
        pageIdx: tbl.pageIdx,
        pageName: tbl.pageName,
        caId: tbl.caId,
      }))
    ),
  ];

  useEffect(() => {
    if (expandTick > 0) setOpen(!!forceOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTick]);

  function handleSelect(rs) {
    state.setCurrentPageIndex?.(rs.pageIdx);
    state.selectElement?.(rs.tableId, false);
    state.setTableRowSetCtx?.({ elId: rs.tableId, rowSetId: rs.id });
    state.setPanelContext?.('element');
  }

  function getMenuActions(rs) {
    return [
      { label: 'Editar', Icon: Pencil, onClick: () => handleSelect(rs) },
    ];
  }

  return (
    <div className="dsb-resource">
      <button
        className="dsb-resource__header"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ fontSize: 12, marginRight: 2 }}>≡</span>
        <span>Row Sets</span>
        <span className="dsb-resource__count">{rowSets.length}</span>
      </button>

      {open && (
        <div className="dsb-resource__body">
          {rowSets.length > 0
            ? rowSets.map(rs => (
                <RSNode
                  key={rs.id}
                  rs={rs}
                  onSelect={() => handleSelect(rs)}
                  onOpenMenu={(x, y) => setItemMenu({ x, y, rs })}
                />
              ))
            : <p className="dsb-resource__empty">Sin row sets</p>
          }
        </div>
      )}

      {itemMenu && (
        <ResourceItemMenu
          x={itemMenu.x} y={itemMenu.y}
          actions={getMenuActions(itemMenu.rs)}
          onClose={() => setItemMenu(null)}
        />
      )}
    </div>
  );
}
