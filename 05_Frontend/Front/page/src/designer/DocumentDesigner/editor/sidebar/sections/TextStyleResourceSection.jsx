import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Plus, Search, Pencil, PenLine, Copy, Trash2, MoreVertical, Type as TypeIcon, Lock } from 'lucide-react';
import { ResourceItemMenu } from '../components/ResourceItemMenu.jsx';
import { UsageModal } from '../components/UsageModal.jsx';

export function TextStyleResourceSection({ state, forceOpen, expandTick }) {
  const [open, setOpen] = useState(false);
  const [usageFor, setUsageFor] = useState(null);
  const [itemMenu, setItemMenu] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renamingName, setRenamingName] = useState('');
  const items = state.template?.styles?.text ?? [];

  useEffect(() => {
    if (state.panelContext?.startsWith('textStyle:')) setOpen(true);
  }, [state.panelContext]);

  useEffect(() => {
    if (expandTick > 0) setOpen(!!forceOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTick]);

  const selectedId = state.panelContext?.startsWith('textStyle:')
    ? state.panelContext.slice('textStyle:'.length)
    : null;

  function handleAdd() {
    const id = state.addTextStyle?.();
    if (id) state.setPanelContext?.('textStyle:' + id);
  }

  function handleSelect(id) { state.setPanelContext?.('textStyle:' + id); }

  function handleRemove(id) {
    const usages = state.getTextStyleUsage?.(id) ?? [];
    if (usages.length > 0) { setUsageFor(id); return; }
    state.removeTextStyle?.(id);
  }

  function getUsageCount(id) { return (state.getTextStyleUsage?.(id) ?? []).length; }

  const usageItem = usageFor ? items.find(s => s.id === usageFor) : null;
  const usages    = usageFor ? (state.getTextStyleUsage?.(usageFor) ?? []) : [];

  function handleNavigate(u) {
    if (u.pageId) {
      const pageIdx = (state.template?.pages ?? []).findIndex(p => p.id === u.pageId);
      if (pageIdx >= 0) state.setCurrentPageIndex?.(pageIdx);
      if (u.elementId) state.selectElement?.(u.elementId, false);
    } else if (u.areaId) {
      state.setPanelContext?.('contentArea:' + u.areaId);
    }
  }

  function handleClone(id) {
    const newId = state.cloneTextStyle?.(id);
    if (newId) state.setPanelContext?.('textStyle:' + newId);
  }

  function commitRename(id) {
    if (renamingName.trim()) state.updateTextStyle?.(id, { name: renamingName.trim() });
    setRenamingId(null);
  }

  function getMenuActions(id) {
    const isDefault = items.find(x => x.id === id)?.isDefault;
    const actions = [
      { label: 'Editar',  Icon: Pencil, onClick: () => handleSelect(id) },
      { label: 'Clonar',  Icon: Copy,   onClick: () => handleClone(id) },
    ];
    if (!isDefault) {
      actions.splice(1, 0, { label: 'Renombrar', Icon: PenLine, onClick: () => { const it = items.find(x => x.id === id); setRenamingId(id); setRenamingName(it?.name ?? ''); } });
      actions.push({ label: 'Eliminar', Icon: Trash2, danger: true, onClick: () => handleRemove(id) });
    }
    return actions;
  }

  return (
    <div className="dsb-resource">
      <button className="dsb-resource__header" onClick={() => setOpen(v => !v)}
        onContextMenu={e => { e.preventDefault(); setHeaderMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <TypeIcon size={13} />
        <span>Text Styles</span>
        <span className="dsb-resource__count">{items.length}</span>
        <span
          className="dsb-resource__add-btn"
          role="button"
          tabIndex={0}
          title="Agregar Text Style"
          onClick={e => { e.stopPropagation(); handleAdd(); }}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        >
          <Plus size={11} />
        </span>
      </button>
      {open && (
        <div className="dsb-resource__body">
          {items.length > 0
            ? items.map((item, i) => {
                const count = getUsageCount(item.id);
                return (
                  <div
                    key={item.id}
                    className={`dsb-resource__item${selectedId === item.id ? ' dsb-resource__item--active' : ''}`}
                    onContextMenu={e => { e.preventDefault(); setItemMenu({ id: item.id, x: e.clientX, y: e.clientY }); }}
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
                      : <span
                          className="dsb-resource__item-label dsb-resource__item-label--btn"
                          onClick={() => handleSelect(item.id)}
                        >
                          {item.isDefault && <Lock size={9} style={{ marginRight: 3, opacity: 0.5, flexShrink: 0 }} />}
                          {item.name ?? `Style ${i + 1}`}
                        </span>
                    }
                    <button
                      className={`dsb-resource__item-usage${count === 0 ? ' dsb-resource__item-usage--unused' : ''}`}
                      title={count > 0 ? `Usado en ${count} lugar${count !== 1 ? 'es' : ''}` : 'Sin usar'}
                      onClick={() => setUsageFor(item.id)}
                    >
                      <Search size={9} />
                      <span>{count}</span>
                    </button>
                    <button
                      className="dsb-resource__item-more"
                      title="Más opciones"
                      onMouseDown={e => e.preventDefault()}
                      onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setItemMenu({ id: item.id, x: r.right, y: r.bottom + 2 }); }}
                    >
                      <MoreVertical size={10} />
                    </button>
                  </div>
                );
              })
            : <p className="dsb-resource__empty">Sin text styles</p>
          }
        </div>
      )}
      {itemMenu && (
        <ResourceItemMenu x={itemMenu.x} y={itemMenu.y} actions={getMenuActions(itemMenu.id)} onClose={() => setItemMenu(null)} />
      )}
      {headerMenu && (
        <ResourceItemMenu
          x={headerMenu.x} y={headerMenu.y}
          actions={[{ label: 'Crear Text Style', Icon: Plus, onClick: handleAdd }]}
          onClose={() => setHeaderMenu(null)}
        />
      )}
      {usageFor && (
        <UsageModal
          areaId={usageFor}
          label={usageItem?.name || 'Text Style'}
          usages={usages.map(u => ({
            ...u,
            elementId: u.elementId || u.areaId,
            pageName: u.pageName || (u.type === 'area' ? 'Content Area' : u.type === 'element-in-area' ? 'En área' : ''),
          }))}
          onClose={() => setUsageFor(null)}
          onNavigate={handleNavigate}
        />
      )}
    </div>
  );
}
