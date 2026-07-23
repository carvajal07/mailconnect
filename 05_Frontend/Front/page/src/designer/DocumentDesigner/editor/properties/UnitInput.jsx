// editor/properties/UnitInput.jsx — Input numérico con badge de unidad por campo

import { useState, useRef, useEffect } from 'react';
import { mmToUnit, unitToMm, UNIT_PROPS } from '../../engine/units.js';
import './UnitInput.css';

const UNITS = ['mm', 'cm', 'pt', 'px', 'in'];

/**
 * Input numérico que muestra el valor en la unidad elegida por campo.
 * Cada instancia mantiene su propia unidad (independiente de otras).
 * El dato subyacente siempre se almacena en mm.
 *
 * Props:
 *   valueMm  — valor actual en mm
 *   onChange — (newMm: number) => void
 *   min      — mínimo en mm (default 0)
 */
export function UnitInput({ valueMm, onChange, min = 0 }) {
  const [unit, setUnit]   = useState('mm');
  const [open, setOpen]   = useState(false);
  const wrapRef           = useRef(null);

  const cfg       = UNIT_PROPS[unit] ?? UNIT_PROPS.mm;
  const displayed = parseFloat(mmToUnit(valueMm, unit).toFixed(cfg.decimals));

  // Cerrar picker al hacer click fuera
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="ui">
      <input
        className="ui__input"
        type="number"
        step={cfg.step}
        value={displayed}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.max(min, unitToMm(v, unit)));
        }}
      />
      <button
        className="ui__badge"
        type="button"
        title="Cambiar unidad"
        onClick={() => setOpen(v => !v)}
      >
        {unit}
      </button>

      {open && (
        <div className="ui__picker">
          {UNITS.map(u => (
            <button
              key={u}
              type="button"
              className={`ui__opt${u === unit ? ' ui__opt--active' : ''}`}
              onClick={() => { setUnit(u); setOpen(false); }}
            >
              {u}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
