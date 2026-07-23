// barcodeFields.jsx — Campos de formulario compartidos por los tabs del código de
// barras (Tipo, Avanzado, Métrica directa). Cada campo muestra opcionalmente un
// `hint` debajo del control para explicar para qué sirve la opción.

import { OPTION_DEFS } from '../../../engine/barcodeSymbologies.js';

function Hint({ text }) {
  if (!text) return null;
  return <p className="pp-field__hint">{text}</p>;
}

export function NumberField({ label, value, unit, min, max, step = 1, hint, onChange }) {
  return (
    <div className="pp-field">
      <label className="pp-field__label">{label}{unit ? ` (${unit})` : ''}</label>
      <input
        type="number"
        className="pp-field__input"
        value={value ?? 0}
        min={min} max={max} step={step}
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
      />
      <Hint text={hint} />
    </div>
  );
}

export function SelectField({ label, value, options, hint, onChange }) {
  return (
    <div className="pp-field">
      <label className="pp-field__label">{label}</label>
      <select className="pp-field__select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Hint text={hint} />
    </div>
  );
}

export function BoolField({ label, checked, hint, onChange }) {
  return (
    <div className="pp-field">
      <label className="pp-toggle-row">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      <Hint text={hint} />
    </div>
  );
}

// Renderiza una lista de claves de OPTION_DEFS leyendo/escribiendo en `options`.
// Usado por el tab Tipo (optionFields) y el tab Avanzado (advancedFields).
export function OptionFields({ keys, options, onSetOptions }) {
  return (keys ?? []).map(key => {
    const def = OPTION_DEFS[key];
    if (!def) return null;
    const optKey = def.optionKey ?? key;
    const val = options[optKey];
    const set = (v) => onSetOptions({ [optKey]: v });
    if (def.kind === 'bool')
      return <BoolField key={key} label={def.label} hint={def.hint} checked={!!val} onChange={set} />;
    if (def.kind === 'select')
      return <SelectField key={key} label={def.label} hint={def.hint} value={val ?? def.default} options={def.options} onChange={set} />;
    if (def.kind === 'number')
      return <NumberField key={key} label={def.label} hint={def.hint} unit={def.unit} value={val ?? def.default} min={def.min} max={def.max} step={def.step} onChange={set} />;
    return null;
  });
}
