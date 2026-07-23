import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Plus, Pencil, PenLine, Trash2, MoreVertical, Copy } from 'lucide-react';
import { ResourceItemMenu } from './ResourceItemMenu.jsx';

export function ResourceSection({ icon: Icon, label, createLabel, items, empty, onAdd, onRemove, onRename, onEdit, onSelect, onClone, onRenameItem, onDragStart, headerActions, getItemBadge, selectedId, forceOpen, expandTick }) {
  const [open, setOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renamingName, setRenamingName] = useState('');
  // Ref to the currently-selected row → scrollIntoView when selection arrives
  // from outside (e.g. user clicked "+ Crear estilo de borde…" in the ribbon).
  // Without this, a long list buries the new item below the fold.
  const selectedRowRef = useRef(null);

  const openMenu = useCallback((id, x, y) => setItemMenu({ id, x, y }), []);

  const commitRename = useCallback((id) => {
    if (onRenameItem && renamingName.trim()) onRenameItem(id, renamingName.trim());
    setRenamingId(null);
  }, [onRenameItem, renamingName]);

  const getMenuActions = useCallback((id) => {
    const actions = [];
    if (onSelect)     actions.push({ label: 'Editar',    Icon: Pencil,  onClick: () => onSelect(id) });
    if (onRenameItem) actions.push({ label: 'Renombrar', Icon: PenLine, onClick: () => { const it = items?.find(x => x.id === id); setRenamingId(id); setRenamingName(it?.name ?? ''); } });
    if (onClone)      actions.push({ label: 'Clonar',    Icon: Copy,    onClick: () => onClone(id) });
    if (onRemove)     actions.push({ label: 'Eliminar',  Icon: Trash2,  danger: true, onClick: () => onRemove(id) });
    return actions;
  }, [items, onSelect, onRenameItem, onClone, onRemove]);

  useEffect(() => {
    if (selectedId && items?.some(it => it.id === selectedId)) setOpen(true);
  }, [selectedId, items]);

  // Scroll the selected row into view after it mounts (or when selectedId
  // changes). `block: 'nearest'` avoids jumping the sidebar around if the row
  // is already visible; only scrolls when it actually needs to.
  useEffect(() => {
    if (!selectedId) return;
    // Defer one frame so the open + render happens before measuring.
    const id = requestAnimationFrame(() => {
      selectedRowRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedId]);

  useEffect(() => {
    if (expandTick > 0) setOpen(!!forceOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTick]);

  return (
    <div className="dsb-resource">
      <button
        className="dsb-resource__header"
        onClick={() => setOpen(v => !v)}
        onContextMenu={e => { e.preventDefault(); if (onAdd) setHeaderMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={13} />
        <span>{label}</span>
        <span className="dsb-resource__count">{items?.length ?? 0}</span>
        {onAdd && (
          <span
            className="dsb-resource__add-btn"
            role="button"
            tabIndex={0}
            title={`Agregar ${label}`}
            onClick={e => { e.stopPropagation(); onAdd(); }}
            onKeyDown={e => e.key === 'Enter' && onAdd()}
          >
            <Plus size={11} />
          </span>
        )}
      </button>
      {open && (
        <div className="dsb-resource__body">
          {items?.length > 0
            ? items.map((item, i) => (
                <div
                  key={item.id ?? i}
                  ref={selectedId === item.id ? selectedRowRef : undefined}
                  className={`dsb-resource__item${onSelect && selectedId === item.id ? ' dsb-resource__item--active' : ''}`}
                  draggable={!!onDragStart}
                  onDragStart={onDragStart ? e => onDragStart(item, e) : undefined}
                  onContextMenu={e => { e.preventDefault(); openMenu(item.id ?? i, e.clientX, e.clientY); }}
                >
                  {renamingId === item.id
                    ? <input
                        className="dsb-resource__item-name"
                        autoFocus
                        value={renamingName}
                        onChange={e => setRenamingName(e.target.value)}
                        onBlur={() => commitRename(item.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(item.id); if (e.key === 'Escape') setRenamingId(null); e.stopPropagation(); }}
                        onClick={e => e.stopPropagation()}
                      />
                    : onRename
                      ? <input
                          className="dsb-resource__item-name"
                          value={item.name ?? ''}
                          onChange={e => onRename(item.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                        />
                      : <span
                          className={`dsb-resource__item-label${onSelect ? ' dsb-resource__item-label--btn' : ''}`}
                          onClick={onSelect ? () => onSelect(item.id) : undefined}
                        >
                          {item.name ?? item.id ?? `Item ${i + 1}`}
                          {getItemBadge?.(item)}
                        </span>
                  }
                  {onEdit && (
                    <button className="dsb-resource__item-edit" title="Editar" onClick={() => onEdit(item.id)}>
                      <Pencil size={10} />
                    </button>
                  )}
                  {onRemove && (
                    <button className="dsb-resource__item-del" title="Eliminar" onClick={() => onRemove(item.id)}>
                      <Trash2 size={10} />
                    </button>
                  )}
                  {(onSelect || onClone || onRemove || onRenameItem) && (
                    <button
                      className="dsb-resource__item-more"
                      title="Más opciones"
                      onMouseDown={e => e.preventDefault()}
                      onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(item.id ?? i, r.right, r.bottom + 2); }}
                    >
                      <MoreVertical size={10} />
                    </button>
                  )}
                </div>
              ))
            : <p className="dsb-resource__empty">{empty ?? 'Sin elementos'}</p>
          }
        </div>
      )}
      {itemMenu && (
        <ResourceItemMenu x={itemMenu.x} y={itemMenu.y} actions={getMenuActions(itemMenu.id)} onClose={() => setItemMenu(null)} />
      )}
      {headerMenu && (onAdd || headerActions) && (
        <ResourceItemMenu
          x={headerMenu.x} y={headerMenu.y}
          actions={headerActions ?? [{ label: createLabel ?? `Crear ${label}`, Icon: Plus, onClick: onAdd }]}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </div>
  );
}
