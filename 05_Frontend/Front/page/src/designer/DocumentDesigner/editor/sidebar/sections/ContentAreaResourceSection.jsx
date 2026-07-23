import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Plus, FileText, Layers, Pencil, Trash2, Copy, PenLine, MoreVertical } from 'lucide-react';
import { ResourceItemMenu } from '../components/ResourceItemMenu.jsx';

function AreaSubNode({ area, depth }) {
  const [open, setOpen] = useState(true);
  const children = area.children ?? [];
  return (
    <>
      <div className="dsb-resource__item" style={{ paddingLeft: 6 + depth * 14 }}>
        <span className="dsb-resource__item-toggle" onClick={() => children.length && setOpen(v => !v)}>
          {children.length
            ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />)
            : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <Layers size={10} className="dsb-resource__item-icon" />
        <span className="dsb-resource__item-label">{area.label ?? area.id}</span>
      </div>
      {open && children.map(c => <AreaSubNode key={c.id} area={c} depth={depth + 1} />)}
    </>
  );
}

function CAElementNode({ el, renamingId, renamingName, onRenamingChange, onCommitRename, onSelect, onOpenMenu, resolvedArea }) {
  const [open, setOpen] = useState(false);
  const isRenaming = renamingId === el.id;
  const children = resolvedArea?.children ?? [];

  return (
    <>
      <div
        className="dsb-resource__item"
        onContextMenu={e => { e.preventDefault(); onOpenMenu(e.clientX, e.clientY); }}
      >
        <span className="dsb-resource__item-toggle" onClick={() => resolvedArea && setOpen(v => !v)}>
          {resolvedArea
            ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />)
            : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <FileText size={10} className="dsb-resource__item-icon" />
        {isRenaming
          ? <input
              className="dsb-resource__item-name"
              autoFocus
              value={renamingName}
              onChange={e => onRenamingChange(e.target.value)}
              onBlur={() => onCommitRename(el.id)}
              onKeyDown={e => { if (e.key === 'Enter') onCommitRename(el.id); if (e.key === 'Escape') onCommitRename(null); e.stopPropagation(); }}
              onClick={e => e.stopPropagation()}
            />
          : <span className="dsb-resource__item-label dsb-resource__item-label--btn" onClick={onSelect}>
              {el.label ?? el.id}
            </span>
        }
        <span className="dsb-resource__item-badge">{el.pageName}</span>
        <button
          className="dsb-resource__item-more"
          onMouseDown={e => e.preventDefault()}
          onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onOpenMenu(r.right, r.bottom + 2); }}
        >
          <MoreVertical size={10} />
        </button>
      </div>
      {open && resolvedArea && (
        <>
          <AreaSubNode area={resolvedArea} depth={1} />
          {children.map(c => <AreaSubNode key={c.id} area={c} depth={1} />)}
        </>
      )}
    </>
  );
}

export function ContentAreaResourceSection({ state, forceOpen, expandTick }) {
  const [open, setOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renamingName, setRenamingName] = useState('');

  const elements = (state.template?.pages ?? []).flatMap((p, pageIdx) =>
    (p.elements ?? [])
      .filter(el => el.type === 'contentarea')
      .map(el => ({ ...el, pageIdx, pageName: p.name ?? `Pág. ${pageIdx + 1}` }))
  );

  useEffect(() => {
    if (expandTick > 0) setOpen(!!forceOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTick]);

  function handleAdd() {
    state.addElement?.('contentarea', { x: 20, y: 20, width: 120, height: 30 });
  }

  function handleSelect(el) {
    state.setCurrentPageIndex?.(el.pageIdx);
    state.selectElement?.(el.id, false);
    state.setPanelContext?.('element');
  }

  function handleRemove(el) {
    state.removeAnyElement?.(el.id);
  }

  function handleClone(el) {
    state.clonePageElement?.(el.id);
  }

  function startRename(el) {
    setRenamingId(el.id);
    setRenamingName(el.label ?? '');
  }

  function commitRename(id) {
    if (id && renamingName.trim()) state.updateAnyElement?.(id, { label: renamingName.trim() });
    setRenamingId(null);
  }

  function getMenuActions(el) {
    return [
      { label: 'Editar', Icon: Pencil, onClick: () => handleSelect(el) },
      { label: 'Renombrar', Icon: PenLine, onClick: () => startRename(el) },
      { label: 'Clonar', Icon: Copy, onClick: () => handleClone(el) },
      { label: 'Eliminar', Icon: Trash2, danger: true, onClick: () => handleRemove(el) },
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
        <FileText size={13} />
        <span>Content Areas</span>
        <span className="dsb-resource__count">{elements.length}</span>
        <span
          className="dsb-resource__add-btn"
          role="button" tabIndex={0}
          title="Agregar Content Area"
          onClick={e => { e.stopPropagation(); handleAdd(); }}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        >
          <Plus size={11} />
        </span>
      </button>

      {open && (
        <div className="dsb-resource__body">
          {elements.length > 0
            ? elements.map(el => {
                const resolvedArea = (state.template?.contentAreas ?? []).find(a => a.id === el.areaRef) ?? null;
                return (
                  <CAElementNode
                    key={el.id}
                    el={el}
                    resolvedArea={resolvedArea}
                    renamingId={renamingId}
                    renamingName={renamingName}
                    onRenamingChange={setRenamingName}
                    onCommitRename={commitRename}
                    onSelect={() => handleSelect(el)}
                    onOpenMenu={(x, y) => setItemMenu({ x, y, el })}
                  />
                );
              })
            : <p className="dsb-resource__empty">Sin content areas en el canvas</p>
          }
        </div>
      )}

      {itemMenu && (
        <ResourceItemMenu
          x={itemMenu.x} y={itemMenu.y}
          actions={getMenuActions(itemMenu.el)}
          onClose={() => setItemMenu(null)}
        />
      )}
      {headerMenu && (
        <ResourceItemMenu
          x={headerMenu.x} y={headerMenu.y}
          actions={[{ label: 'Agregar Content Area', Icon: Plus, onClick: handleAdd }]}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </div>
  );
}
