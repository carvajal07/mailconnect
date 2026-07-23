import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Plus, Layers, Pencil, Trash2, Copy, PenLine, MoreVertical } from 'lucide-react';
import { ResourceItemMenu } from '../components/ResourceItemMenu.jsx';

function AreaNode({ area, depth, badge, renamingId, renamingName, onRenamingChange, onCommitRename, onOpenMenu, onSelect }) {
  const [open, setOpen] = useState(true);
  const children = area.children ?? [];
  const isRenaming = renamingId === area.id;

  return (
    <>
      <div
        className="dsb-resource__item"
        style={{ paddingLeft: 6 + depth * 14 }}
        onContextMenu={e => { e.preventDefault(); onOpenMenu(area.id, e.clientX, e.clientY); }}
      >
        <span className="dsb-resource__item-toggle" onClick={() => children.length && setOpen(v => !v)}>
          {children.length
            ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />)
            : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <Layers size={10} className="dsb-resource__item-icon" />
        {isRenaming
          ? <input
              className="dsb-resource__item-name"
              autoFocus
              value={renamingName}
              onChange={e => onRenamingChange(e.target.value)}
              onBlur={() => onCommitRename(area.id)}
              onKeyDown={e => { if (e.key === 'Enter') onCommitRename(area.id); if (e.key === 'Escape') onCommitRename(null); e.stopPropagation(); }}
              onClick={e => e.stopPropagation()}
            />
          : <span className="dsb-resource__item-label dsb-resource__item-label--btn" onClick={() => onSelect?.(area.id)}>
              {area.label ?? area.id}
            </span>
        }
        {badge && <span className="dsb-resource__item-badge">{badge}</span>}
        {depth === 0 && (
          <button
            className="dsb-resource__item-more"
            onMouseDown={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onOpenMenu(area.id, r.right, r.bottom + 2); }}
          >
            <MoreVertical size={10} />
          </button>
        )}
      </div>
      {open && children.map(c => (
        <AreaNode
          key={c.id} area={c} depth={depth + 1}
          renamingId={renamingId} renamingName={renamingName}
          onRenamingChange={onRenamingChange} onCommitRename={onCommitRename}
          onOpenMenu={onOpenMenu} onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function AreasResourceSection({ state, forceOpen, expandTick }) {
  const [open, setOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renamingName, setRenamingName] = useState('');

  // Pool areas (top-level, with children)
  const poolAreas = state.template?.contentAreas ?? [];

  // Cell flow sub-areas from all tables
  const cellAreas = (state.template?.pages ?? []).flatMap(p =>
    (p.elements ?? []).flatMap(el =>
      el.type === 'table'
        ? (el.rowSets ?? []).flatMap(rs =>
            (rs.cells ?? []).flatMap(c => {
              const col = (el.columns ?? []).find(col => col.id === c.colId);
              return (c.flow?.children ?? []).map(a => ({ ...a, _source: col?.label ?? c.colId }));
            })
          )
        : []
    )
  );

  const totalCount = poolAreas.length + cellAreas.length;

  useEffect(() => {
    if (expandTick > 0) setOpen(!!forceOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTick]);

  function handleAdd() {
    state.addContentArea?.();
  }

  function handleSelect(areaId) {
    state.setPanelContext?.('contentArea:' + areaId);
  }

  function handleRemove(areaId) {
    state.removeArea?.(null, areaId);
  }

  function handleClone(areaId) {
    state.cloneArea?.(areaId);
  }

  function startRename(areaId) {
    const allAreas = [...poolAreas, ...cellAreas];
    const area = allAreas.find(a => a.id === areaId);
    setRenamingId(areaId);
    setRenamingName(area?.label ?? '');
  }

  function commitRename(id) {
    if (id && renamingName.trim()) state.updateArea?.(null, id, { label: renamingName.trim() });
    setRenamingId(null);
  }

  function getMenuActions(areaId) {
    return [
      { label: 'Editar', Icon: Pencil, onClick: () => handleSelect(areaId) },
      { label: 'Renombrar', Icon: PenLine, onClick: () => startRename(areaId) },
      { label: 'Clonar', Icon: Copy, onClick: () => handleClone(areaId) },
      { label: 'Eliminar', Icon: Trash2, danger: true, onClick: () => handleRemove(areaId) },
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
        <Layers size={13} />
        <span>Áreas</span>
        <span className="dsb-resource__count">{totalCount}</span>
        <span
          className="dsb-resource__add-btn"
          role="button" tabIndex={0}
          title="Agregar área"
          onClick={e => { e.stopPropagation(); handleAdd(); }}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        >
          <Plus size={11} />
        </span>
      </button>

      {open && (
        <div className="dsb-resource__body">
          {totalCount === 0
            ? <p className="dsb-resource__empty">Sin áreas</p>
            : (
              <>
                {poolAreas.map(area => (
                  <AreaNode
                    key={area.id} area={area} depth={0}
                    renamingId={renamingId} renamingName={renamingName}
                    onRenamingChange={setRenamingName} onCommitRename={commitRename}
                    onOpenMenu={(id, x, y) => setItemMenu({ id, x, y })}
                    onSelect={handleSelect}
                  />
                ))}
                {cellAreas.length > 0 && (
                  <>
                    {poolAreas.length > 0 && <div style={{ borderTop: '1px dashed #e5e7eb', margin: '2px 0' }} />}
                    {cellAreas.map(area => (
                      <AreaNode
                        key={area.id} area={area} depth={0}
                        badge={area._source}
                        renamingId={renamingId} renamingName={renamingName}
                        onRenamingChange={setRenamingName} onCommitRename={commitRename}
                        onOpenMenu={(id, x, y) => setItemMenu({ id, x, y })}
                        onSelect={handleSelect}
                      />
                    ))}
                  </>
                )}
              </>
            )
          }
        </div>
      )}

      {itemMenu && (
        <ResourceItemMenu
          x={itemMenu.x} y={itemMenu.y}
          actions={getMenuActions(itemMenu.id)}
          onClose={() => setItemMenu(null)}
        />
      )}
      {headerMenu && (
        <ResourceItemMenu
          x={headerMenu.x} y={headerMenu.y}
          actions={[{ label: 'Agregar área', Icon: Plus, onClick: handleAdd }]}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </div>
  );
}
