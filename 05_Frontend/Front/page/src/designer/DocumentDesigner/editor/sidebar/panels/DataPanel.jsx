import { useState } from 'react';
import { Search } from 'lucide-react';
import { FieldNode, SYSTEM_FIELDS, buildFieldTree } from '../components/FieldNode.jsx';

export function DataPanel({ availableFields, onInsertVariable }) {
  const [search, setSearch] = useState('');
  const allFlat = availableFields ?? [];
  const filteredFlat = search
    ? allFlat.filter(f =>
        (f.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (f.path ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : null;
  const workflowTree = filteredFlat ?? buildFieldTree(allFlat);

  return (
    <div className="dsb-section">
      <div className="dsb-search">
        <Search size={12} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar campo..." className="dsb-search__input" />
      </div>
      <div className="dsb-fields">
        {workflowTree.length > 0 ? (
          <>
            <p className="dsb-fields__label">Campos del workflow</p>
            {workflowTree.map(f => (
              <FieldNode key={f.path ?? f.name} field={f} onInsert={onInsertVariable} />
            ))}
          </>
        ) : !search ? (
          <p className="dsb-fields__empty">Sin campos. Conecta un nodo upstream.</p>
        ) : (
          <p className="dsb-fields__empty">Sin resultados para "{search}"</p>
        )}
        <p className="dsb-fields__label" style={{ marginTop: 8 }}>Variables del sistema</p>
        {SYSTEM_FIELDS.map(f => (
          <FieldNode key={f.path} field={f} onInsert={onInsertVariable} />
        ))}
      </div>
    </div>
  );
}
