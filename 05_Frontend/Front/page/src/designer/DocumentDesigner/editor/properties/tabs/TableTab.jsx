// editor/properties/tabs/TableTab.jsx — General table settings

import './TableTab.css';

const TABLE_TYPES = [
  { value: 'general',      label: 'General' },
  { value: 'fixed-height', label: 'Altura fija (más rápido)' },
  { value: 'simple',       label: 'Simple (más rápido)' },
];

const ALIGNMENTS = [
  { value: 'left',   label: 'Izquierda' },
  { value: 'center', label: 'Centro' },
  { value: 'right',  label: 'Derecha' },
];

const BORDER_TYPES = [
  { value: 'simple',       label: 'Simple' },
  { value: 'mergeborders', label: 'Fusionar bordes' },
];

const OVERFLOW_MODES = [
  // 'paginate' = la tabla FLUYE: llena el alto disponible en la hoja y CONTINÚA (en la misma hoja si
  //   queda espacio, luego en una página nueva), repitiendo encabezado/pie según las 4 posiciones
  //   (First Header / Header / Footer / Last Footer). Es lo que se espera de una tabla que se repite.
  // 'shrink' = encoge el contenido para caber en el alto del rectángulo (comportamiento actual del render).
  // 'clip'   = recorta lo que no cabe.
  { value: 'paginate', label: 'Paginar — fluye y continúa (repite encabezado/pie)' },
  { value: 'shrink',   label: 'Encoger para caber' },
  { value: 'clip',     label: 'Recortar' },
];

function NumField({ label, value, min = 0, max, step = 1, unit, onChange }) {
  return (
    <div className="pp-field">
      <label className="pp-field__label">{label}{unit ? ` (${unit})` : ''}</label>
      <input
        type="number"
        className="pp-field__input"
        min={min}
        max={max}
        step={step}
        value={value ?? 0}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
      />
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div className="tt-color-row">
      <label className="pp-field__label">{label}</label>
      <div className="tt-color-controls">
        <input
          type="color"
          className="tt-color-input"
          value={value ?? '#ffffff'}
          onChange={e => onChange(e.target.value)}
        />
        {value && (
          <button
            className="tt-color-clear"
            title="Sin color"
            onClick={() => onChange(null)}
          >
            ✕
          </button>
        )}
        {!value && (
          <span className="tt-color-none">Sin relleno</span>
        )}
      </div>
    </div>
  );
}

export default function TableTab({ element, onUpdate }) {
  const {
    tableType    = 'general',
    alignment    = 'left',
    percentWidth = 100,
    hSpacing     = 0,
    vSpacing     = 0,
    borderType   = 'simple',
    overflow     = 'paginate',
    oddRowColor  = null,
    evenRowColor = null,
  } = element;

  function upd(key, val) {
    onUpdate({ [key]: val });
  }

  return (
    <div className="tbtab">
      {/* ── Tipo de tabla ─────────────────────────────────────────── */}
      <p className="pp-section-title">Tipo de tabla</p>
      <div className="pp-field">
        <label className="pp-field__label">Tipo</label>
        <select
          className="pp-field__select"
          value={tableType}
          onChange={e => upd('tableType', e.target.value)}
        >
          {TABLE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── Diseño ───────────────────────────────────────────────── */}
      <p className="pp-section-title">Diseño</p>
      <div className="pp-field">
        <label className="pp-field__label">Alineación</label>
        <select
          className="pp-field__select"
          value={alignment}
          onChange={e => upd('alignment', e.target.value)}
        >
          {ALIGNMENTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <NumField
        label="Ancho %"
        value={percentWidth}
        min={10}
        max={100}
        step={5}
        onChange={v => upd('percentWidth', v)}
      />

      {/* ── Espaciado ────────────────────────────────────────────── */}
      <p className="pp-section-title">Espaciado</p>
      <div className="pp-row pp-row--mb">
        <NumField
          label="Horizontal"
          value={hSpacing}
          step={0.5}
          unit="mm"
          onChange={v => upd('hSpacing', v)}
        />
        <NumField
          label="Vertical"
          value={vSpacing}
          step={0.5}
          unit="mm"
          onChange={v => upd('vSpacing', v)}
        />
      </div>

      {/* ── Bordes ───────────────────────────────────────────────── */}
      <p className="pp-section-title">Bordes</p>
      <div className="pp-field">
        <label className="pp-field__label">Tipo de borde</label>
        <select
          className="pp-field__select"
          value={borderType}
          onChange={e => upd('borderType', e.target.value)}
        >
          {BORDER_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── Filas alternas ───────────────────────────────────────── */}
      <p className="pp-section-title">Filas alternas (cuerpo)</p>
      <ColorField
        label="Fila impar"
        value={oddRowColor}
        onChange={v => upd('oddRowColor', v)}
      />
      <ColorField
        label="Fila par"
        value={evenRowColor}
        onChange={v => upd('evenRowColor', v)}
      />

      {/* ── Desbordamiento ───────────────────────────────────────── */}
      <p className="pp-section-title">Desbordamiento</p>
      <div className="pp-field">
        <label className="pp-field__label">Modo</label>
        <select
          className="pp-field__select"
          value={overflow}
          onChange={e => upd('overflow', e.target.value)}
        >
          {OVERFLOW_MODES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="pp-field__hint" style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-tertiary, #94a3b8)', lineHeight: 1.45 }}>
          {overflow === 'paginate' && 'Cuando la tabla (con datos repetidos) no cabe, llena la hoja y continúa en la siguiente, repitiendo el encabezado/pie. Define las secciones First Header / Header / Footer / Last Footer en la pestaña Secciones.'}
          {overflow === 'shrink' && 'El contenido se reduce de tamaño para caber en el alto de la tabla. Útil para evitar páginas extra, pero con muchos datos el texto puede quedar pequeño.'}
          {overflow === 'clip' && 'Lo que no cabe en el alto de la tabla se recorta (no se muestra).'}
        </p>
      </div>
    </div>
  );
}
