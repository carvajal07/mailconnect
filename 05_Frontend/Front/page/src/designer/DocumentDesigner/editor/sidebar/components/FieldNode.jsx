import { useState } from 'react';
import { ChevronRight, ChevronDown, Braces } from 'lucide-react';

export const SYSTEM_FIELDS = [
  { path: '$pageNumber',   name: '$pageNumber',   type: 'number'  },
  { path: '$totalPages',   name: '$totalPages',   type: 'number'  },
  { path: '$date',         name: '$date',         type: 'string'  },
  { path: '$datetime',     name: '$datetime',     type: 'string'  },
  { path: '$documentName', name: '$documentName', type: 'string'  },
  { path: '$overflow',     name: '$overflow',     type: 'boolean' },
  { path: '$index',        name: '$index',        type: 'number'  },
  { path: '$item',         name: '$item',         type: 'object'  },
];

export function buildFieldTree(fields) {
  const root = {};

  for (const field of fields) {
    const groupPath  = field.displayPath ?? field.path ?? field.name ?? '';
    const insertPath = field.path ?? groupPath;
    const parts = groupPath.split('.');
    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const key    = parts[i];
      const isLeaf = i === parts.length - 1;
      if (!node[key]) {
        node[key] = {
          name: key,
          path: isLeaf ? insertPath : parts.slice(0, i + 1).join('.'),
          type: isLeaf ? (field.type ?? 'string') : 'object',
          _ch: {},
        };
      } else if (isLeaf) {
        node[key].type = field.type ?? node[key].type;
        node[key].path = insertPath;
      }
      node = node[key]._ch;
    }
  }

  function toArray(obj) {
    return Object.values(obj).map(({ _ch, ...node }) => {
      const children = toArray(_ch);
      return children.length > 0 ? { ...node, type: 'object', children } : node;
    });
  }

  return toArray(root);
}

export function FieldNode({ field, onInsert, depth = 0 }) {
  const [open, setOpen] = useState(true);
  const hasChildren = Array.isArray(field.children) && field.children.length > 0;
  return (
    <div className="dsb-field">
      <div
        className="dsb-field__row"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => hasChildren ? setOpen(v => !v) : onInsert(field.path ?? field.name)}
        title={field.path ?? field.name}
        draggable={!hasChildren}
        onDragStart={e => {
          if (hasChildren) return;
          const path = field.path ?? field.name;
          e.dataTransfer.setData('text/x-variable-path', path);
          e.dataTransfer.setData('text/plain', `{{ ${path} }}`);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        {hasChildren
          ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
          : <span className="dsb-field__spacer" />}
        <span className={`dsb-field__type dsb-field__type--${field.type ?? 'string'}`}>
          {(field.type ?? 's')[0].toUpperCase()}
        </span>
        <span className="dsb-field__name">{field.name ?? field.path}</span>
        {!hasChildren && (
          <button
            className="dsb-field__insert"
            onClick={e => { e.stopPropagation(); onInsert(field.path ?? field.name); }}
            title={`Insertar {{ ${field.path ?? field.name} }}`}
          >
            <Braces size={11} />
          </button>
        )}
      </div>
      {open && hasChildren && (
        <div className="dsb-field__children">
          {field.children.map(ch => (
            <FieldNode key={ch.path ?? ch.name} field={ch} onInsert={onInsert} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
