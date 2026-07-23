// VariableAutocomplete.jsx — Floating autocomplete for inserting variables
// Triggered by Ctrl+Space or typing "{{" inside a contentEditable area.
// Renders as a portal above all elements, positioned near the caret.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Braces, Search } from 'lucide-react';
import './VariableAutocomplete.css';

// ── System fields (always available) ───────────────────────────────────────

const SYSTEM_FIELDS = [
  { path: '$pageNumber',   name: '$pageNumber',   type: 'number',  group: 'system' },
  { path: '$totalPages',   name: '$totalPages',   type: 'number',  group: 'system' },
  { path: '$date',         name: '$date',         type: 'string',  group: 'system' },
  { path: '$datetime',     name: '$datetime',     type: 'string',  group: 'system' },
  { path: '$documentName', name: '$documentName', type: 'string',  group: 'system' },
  { path: '$index',        name: '$index',        type: 'number',  group: 'system' },
  { path: '$item',         name: '$item',         type: 'object',  group: 'system' },
];

// ── Flatten a field tree into a flat list of leaf paths ────────────────────

function flattenFields(fields, prefix = '') {
  const result = [];
  for (const f of fields) {
    const path = f.path ?? (prefix ? `${prefix}.${f.name}` : f.name);
    if (f.children?.length) {
      result.push(...flattenFields(f.children, path));
    } else {
      result.push({ path, name: f.name, type: f.type ?? 'string', group: 'data' });
    }
  }
  return result;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function VariableAutocomplete({ availableFields, position, onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Build flat list: workflow fields + system fields
  const allFields = useMemo(() =>
    [...flattenFields(availableFields ?? []), ...SYSTEM_FIELDS],
    [availableFields]
  );

  // Filter by search
  const filtered = allFields.filter(f =>
    !search || f.path.toLowerCase().includes(search.toLowerCase())
      || f.name.toLowerCase().includes(search.toLowerCase())
  );

  // Reset active index when search changes
  useEffect(() => { setActiveIndex(0); }, [search]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIndex]) onSelect(filtered[activeIndex].path);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (filtered[activeIndex]) onSelect(filtered[activeIndex].path);
    }
  }, [filtered, activeIndex, onSelect, onClose]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.vac')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Type badge letter
  const typeBadge = (type) => (type ?? 'string')[0].toUpperCase();

  const style = {
    position: 'fixed',
    top: position?.top ?? 100,
    left: position?.left ?? 100,
  };

  return ReactDOM.createPortal(
    <div className="vac" style={style} onKeyDown={handleKeyDown}>
      <div className="vac__header">
        <Search size={12} />
        <input
          ref={inputRef}
          className="vac__search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar variable..."
          autoComplete="off"
          spellCheck="false"
        />
      </div>
      <div className="vac__list" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="vac__empty">Sin resultados</div>
        ) : (
          filtered.map((f, i) => (
            <button
              key={f.path}
              className={`vac__item${i === activeIndex ? ' vac__item--active' : ''}${f.group === 'system' ? ' vac__item--system' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onSelect(f.path)}
            >
              <span className={`vac__type vac__type--${f.type}`}>{typeBadge(f.type)}</span>
              <span className="vac__path">{f.path}</span>
              {f.group === 'system' && <span className="vac__badge">sys</span>}
            </button>
          ))
        )}
      </div>
      <div className="vac__footer">
        <span><kbd>↑↓</kbd> navegar</span>
        <span><kbd>Enter</kbd> insertar</span>
        <span><kbd>Esc</kbd> cerrar</span>
      </div>
    </div>,
    document.body
  );
}
