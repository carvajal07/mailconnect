// editor/properties/BorderTab.jsx — Border properties (named style only)

import { ExternalLink } from 'lucide-react';
import './BorderTab.css';

const AREA_TYPE_OPTIONS = [
  { value: 'full',             label: 'Área completa' },
  { value: 'content-only',     label: 'Solo contenido' },
  { value: 'content-with-gap', label: 'Contenido con espacio' },
];

function PaddingFields({ border, onUpdate }) {
  const pad = border?.contentPadding ?? {};

  function setP(field, raw) {
    const val = parseFloat(raw);
    onUpdate({
      border: {
        ...border,
        contentPadding: { ...pad, [field]: isNaN(val) ? 0 : val },
      },
    });
  }

  const fields = [
    { key: 'top',    label: 'Sup' },
    { key: 'bottom', label: 'Inf' },
    { key: 'left',   label: 'Izq' },
    { key: 'right',  label: 'Der' },
  ];

  return (
    <>
      <p className="pp-section-title" style={{ marginTop: 10 }}>Espacio interior</p>
      <div className="pp-row pp-row--mb">
        {fields.map(({ key, label }) => (
          <div key={key} className="pp-field">
            <label className="pp-field__label">{label}</label>
            <input
              type="number"
              className="pp-field__input"
              min="0"
              step="0.5"
              value={pad[key] ?? 0}
              onChange={e => setP(key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <p className="bt-unit-hint">mm</p>
    </>
  );
}

export default function BorderTab({ element, onUpdate, borderStyles = [], addBorderStyle, onNavigateToStyle, alwaysShowPadding = false }) {
  const styleRef = element.border?.styleRef ?? '';
  const areaType = element.border?.areaType ?? 'full';

  function handleSelect(e) {
    const val = e.target.value;
    const existing = element.border ?? {};
    if (val === '__create__') {
      const newId = addBorderStyle?.();
      if (newId) {
        onUpdate({ border: { ...existing, mode: 'unified', styleRef: newId } });
        onNavigateToStyle?.(newId);
      }
    } else if (val === '') {
      onUpdate({ border: { ...existing, mode: 'none', styleRef: undefined } });
    } else {
      onUpdate({ border: { ...existing, mode: 'unified', styleRef: val } });
    }
  }

  function handleAreaType(e) {
    onUpdate({ border: { ...(element.border ?? {}), areaType: e.target.value } });
  }

  const showPadding = alwaysShowPadding || areaType === 'content-with-gap';

  return (
    <div>
      <p className="pp-section-title">Estilo nombrado</p>
      <div className="bt-style-row">
        <select className="pp-field__select" value={styleRef} onChange={handleSelect}>
          <option value="">(Sin borde)</option>
          {borderStyles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          {addBorderStyle && <option value="__create__">+ Crear nuevo estilo...</option>}
        </select>
        {styleRef && (
          <button
            className="bt-edit-btn"
            title="Ir al estilo en Recursos"
            onClick={() => onNavigateToStyle?.(styleRef)}
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>

      {!alwaysShowPadding && (
        <>
          <p className="pp-section-title" style={{ marginTop: 10 }}>Tipo</p>
          <select className="pp-field__select" value={areaType} onChange={handleAreaType}>
            {AREA_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </>
      )}

      {showPadding && (
        <PaddingFields border={element.border} onUpdate={onUpdate} />
      )}
    </div>
  );
}
