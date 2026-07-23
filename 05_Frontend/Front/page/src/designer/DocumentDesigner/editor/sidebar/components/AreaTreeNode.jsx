import { useState } from 'react';
import { ChevronRight, ChevronDown, Layers, Search, Trash2 } from 'lucide-react';

export function AreaTreeNode({ area, depth, selectedId, onSelect, onUsage, onRemove }) {
  const [expanded, setExpanded] = useState(true);
  const children   = area.children ?? [];
  const hasChildren = children.length > 0;
  return (
    <>
      <div
        className={`dsb-resource__item${selectedId === area.id ? ' dsb-resource__item--active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <span
          className="dsb-resource__item-toggle"
          onClick={() => hasChildren && setExpanded(v => !v)}
        >
          {hasChildren
            ? (expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)
            : <span className="dsb-resource__item-toggle-gap" />}
        </span>
        <Layers size={11} className="dsb-resource__item-icon" />
        <span
          className="dsb-resource__item-label dsb-resource__item-label--btn"
          onClick={() => onSelect(area.id)}
        >
          {area.label || area.id}
        </span>
        {depth === 0 && (
          <>
            <button className="dsb-resource__item-edit" title="Dónde se usa" onClick={() => onUsage(area.id)}>
              <Search size={10} />
            </button>
            <button className="dsb-resource__item-del" title="Eliminar" onClick={() => onRemove(area.id)}>
              <Trash2 size={10} />
            </button>
          </>
        )}
      </div>
      {hasChildren && expanded && children.map(child => (
        <AreaTreeNode
          key={child.id}
          area={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onUsage={onUsage}
          onRemove={onRemove}
        />
      ))}
    </>
  );
}
