// editor/resources/TextStyleEditor.jsx — Reusable multi-tab TextStyle editor with live preview

import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { ExternalLink } from 'lucide-react';
import { mmToUnit, unitToMm, UNIT_PROPS } from '../../../engine/units.js';
import { fillToBg } from '../../../engine/fillUtils.js';
import { CmykInputs } from '../colorUtils.jsx';
import './TextStyleEditor.css';

// ── Catalogs ────────────────────────────────────────────────────────────────

const FONTS = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Roboto', 'Open Sans'];
const WEIGHTS = ['Thin', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'];
const TRANSFORMS = [
  { value: 'none',       label: 'Ninguna' },
  { value: 'uppercase',  label: 'MAYÚSCULAS' },
  { value: 'lowercase',  label: 'minúsculas' },
  { value: 'capitalize', label: 'Capitalizar' },
];

const CAP_STYLES = [
  { value: 'butt',   label: 'Recto' },
  { value: 'round',  label: 'Redondo' },
  { value: 'square', label: 'Cuadrado' },
];

const JOIN_STYLES = [
  { value: 'miter', label: 'Inglete' },
  { value: 'round', label: 'Redondo' },
  { value: 'bevel', label: 'Bisel' },
];

const TABS = ['Fuente', 'Reglas', 'Super/Sub', 'Líneas', 'Relleno', 'Contorno', 'Borde'];
const UNITS = ['mm', 'cm', 'pt', 'px', 'in'];

const WEIGHT_MAP = {
  Thin: 100, Light: 300, Regular: 400, Medium: 500,
  SemiBold: 600, Bold: 700, ExtraBold: 800,
};

// pt ↔ mm conversion factors
const PT_TO_MM = 25.4 / 72;
const MM_TO_PT = 72 / 25.4;

export const DEFAULT_TEXT_STYLE = {
  // Font
  fontFamily: 'Inter',
  fontWeight: 'Regular',
  fontSize: 11,         // stored in pt
  color: '#1f2937',
  italic: false,
  smallCaps: false,
  // Rules
  letterSpacing: 0,     // stored in mm
  lineHeight: 1.4,
  textTransform: 'none',
  kerning: true,
  horizontalScale: 100,
  baselineShift: 0,     // stored in mm
  // Super/Sub
  superscript: false,
  subscript: false,
  superscriptOffset: 33,
  subscriptOffset: 33,
  superSubSize: 58,
  smallCapsSize: 70,
  // Lines
  underline: false,
  strikethrough: false,
  underlineStyleId: null,
  strikethroughStyleId: null,
  customUnderlineStrike: false,
  underlineOffset: 10.6,
  underlineWidth: 7.3,
  strikethroughOffset: 23.6,
  strikethroughWidth: 7.3,
  // Fill (glyph fill override)
  fillStyleId: null,
  // Outline / stroke
  outlineStyleId: null,
  outlineWidth: 0.1,    // mm
  cap: 'butt',
  join: 'miter',
  miter: 10,
  // Border
  borderStyleId: null,
  connectBorders: false,
  borderWithLineGap: false,
  // Link / language
  urlTarget: '',
  language: '',
};

// ── Fill style mini-preview ───────────────────────────────────────────────────

function FillSwatch({ fillStyle }) {
  const bg = fillToBg(fillStyle);
  if (!bg) return <span style={{ fontSize: 10, color: '#9ca3af' }}>(ninguno)</span>;
  return (
    <span style={{
      display: 'inline-block', width: 18, height: 13,
      background: bg, border: '1px solid #e5e7eb',
      borderRadius: 2, verticalAlign: 'middle',
    }} />
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

function Preview({ style, fillStyles }) {
  const s = { ...DEFAULT_TEXT_STYLE, ...style };
  const dec = [
    s.underline && 'underline',
    s.strikethrough && 'line-through',
  ].filter(Boolean).join(' ') || 'none';

  // Resolve fill override for preview
  let textColor = s.color;
  let extraStyle = {};
  if (s.fillStyleId) {
    const fs = (fillStyles ?? []).find(f => f.id === s.fillStyleId);
    const bg = fillToBg(fs);
    if (bg && fs?.type === 'solid') textColor = bg;
    else if (bg && fs?.type === 'gradient') {
      extraStyle = {
        background: bg,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      };
    }
  }

  const previewStyle = {
    fontFamily: s.fontFamily,
    fontWeight: WEIGHT_MAP[s.fontWeight] ?? 400,
    fontSize: `${Math.min(s.fontSize, 28)}px`,
    color: textColor,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: dec,
    letterSpacing: `${s.letterSpacing * (96 / 25.4)}px`,
    lineHeight: s.lineHeight,
    textTransform: s.textTransform,
    fontVariant: s.smallCaps ? 'small-caps' : 'normal',
    transform: s.horizontalScale !== 100 ? `scaleX(${s.horizontalScale / 100})` : undefined,
    transformOrigin: 'left center',
    verticalAlign: s.superscript ? 'super' : s.subscript ? 'sub' : undefined,
    ...extraStyle,
  };

  // Outline preview via -webkit-text-stroke
  if (s.outlineStyleId && s.outlineWidth > 0) {
    const ofs = (fillStyles ?? []).find(f => f.id === s.outlineStyleId);
    const oc = ofs?.color ?? '#000000';
    const opx = Math.round(s.outlineWidth * 3.7795 * 10) / 10;
    previewStyle.WebkitTextStroke = `${opx}px ${oc}`;
  }

  return (
    <div className="tse__preview">
      <span style={previewStyle}>
        Ejemplo de texto — AaBbCc 123
      </span>
    </div>
  );
}

// ── Unit badge (inline in table cell) ───────────────────────────────────────

function UnitBadge({ unit, onUnitChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span ref={ref} className="tse__ubadge-wrap">
      <button type="button" className="tse__ubadge" onClick={() => setOpen(v => !v)}>
        {unit}
      </button>
      {open && (
        <div className="tse__upicker">
          {UNITS.map(u => (
            <button key={u} type="button"
              className={`tse__uopt${u === unit ? ' tse__uopt--active' : ''}`}
              onClick={() => { onUnitChange(u); setOpen(false); }}
            >{u}</button>
          ))}
        </div>
      )}
    </span>
  );
}

// ── Editable number hook (allows free typing, commits on blur/Enter) ────────

function useEditableNum(externalValue) {
  const [local, setLocal] = useState(String(externalValue ?? ''));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setLocal(String(externalValue ?? ''));
  }, [externalValue, editing]);

  return {
    value: editing ? local : String(externalValue ?? ''),
    onChange: (e) => { setEditing(true); setLocal(e.target.value); },
    onFocus: () => setEditing(true),
    commit: (commitFn) => {
      setEditing(false);
      const v = parseFloat(local);
      if (!isNaN(v)) commitFn(v);
    },
  };
}

// ── Table field helpers (label left, value right) ───────────────────────────

function Row({ label, children }) {
  return (
    <tr className="tse__tr">
      <td className="tse__td-label">{label}:</td>
      <td className="tse__td-value">{children}</td>
    </tr>
  );
}

function NumRow({ label, value, field, onChange, unit, min, max, step = '0.1' }) {
  const ed = useEditableNum(value ?? 0);
  function commit(v) {
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange(field, v);
  }
  return (
    <Row label={label}>
      <div className="tse__num-wrap">
        <input type="number" className="tse__input" min={min} max={max} step={step}
          value={ed.value}
          onChange={ed.onChange}
          onFocus={ed.onFocus}
          onBlur={() => ed.commit(commit)}
          onKeyDown={e => { if (e.key === 'Enter') ed.commit(commit); }}
        />
        {unit && <span className="tse__unit">{unit}</span>}
      </div>
    </Row>
  );
}

function UnitRow({ label, valueMm, field, onChange, min }) {
  const [unit, setUnit] = useState('mm');
  const cfg = UNIT_PROPS[unit] ?? UNIT_PROPS.mm;
  const displayed = parseFloat(mmToUnit(valueMm ?? 0, unit).toFixed(cfg.decimals));
  const ed = useEditableNum(displayed);

  function commit(v) {
    const mm = unitToMm(v, unit);
    onChange(field, min != null ? Math.max(min, mm) : mm);
  }

  return (
    <Row label={label}>
      <div className="tse__num-wrap tse__num-wrap--unit">
        <input type="number" className="tse__input" step={cfg.step}
          value={ed.value}
          onChange={ed.onChange}
          onFocus={ed.onFocus}
          onBlur={() => ed.commit(commit)}
          onKeyDown={e => { if (e.key === 'Enter') ed.commit(commit); }}
        />
        <UnitBadge unit={unit} onUnitChange={setUnit} />
      </div>
    </Row>
  );
}

function UnitRowPt({ label, valuePt, field, onChange, min = 0 }) {
  const [unit, setUnit] = useState('pt');
  const cfg = UNIT_PROPS[unit] ?? UNIT_PROPS.pt;
  const valueMm = (valuePt ?? 0) * PT_TO_MM;
  const displayed = parseFloat(mmToUnit(valueMm, unit).toFixed(cfg.decimals));
  const ed = useEditableNum(displayed);

  function commit(v) {
    const mm = unitToMm(v, unit);
    const pt = mm * MM_TO_PT;
    onChange(field, Math.max(min, pt));
  }

  return (
    <Row label={label}>
      <div className="tse__num-wrap tse__num-wrap--unit">
        <input type="number" className="tse__input" step={cfg.step}
          value={ed.value}
          onChange={ed.onChange}
          onFocus={ed.onFocus}
          onBlur={() => ed.commit(commit)}
          onKeyDown={e => { if (e.key === 'Enter') ed.commit(commit); }}
        />
        <UnitBadge unit={unit} onUnitChange={setUnit} />
      </div>
    </Row>
  );
}

function BoolRow({ label, value, field, onChange }) {
  return (
    <Row label={label}>
      <select className="tse__select" value={value ? 'yes' : 'no'}
        onChange={e => onChange(field, e.target.value === 'yes')}>
        <option value="no">No</option>
        <option value="yes">Sí</option>
      </select>
    </Row>
  );
}

function SelectRow({ label, value, field, onChange, options }) {
  return (
    <Row label={label}>
      <select className="tse__select" value={value ?? ''} onChange={e => onChange(field, e.target.value)}>
        {options.map(o => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
        )}
      </select>
    </Row>
  );
}

function RefRow({ label, value, field, onChange, items, emptyLabel = 'Vacío', renderExtra }) {
  return (
    <Row label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {renderExtra}
        <select className="tse__select" style={{ flex: 1 }} value={value ?? ''} onChange={e => onChange(field, e.target.value || null)}>
          <option value="">{emptyLabel}</option>
          {(items ?? []).map(it => (
            <option key={it.id} value={it.id}>{it.name ?? it.id}</option>
          ))}
        </select>
      </div>
    </Row>
  );
}

// ColorFillSection — two rows: fill selector + color picker popup with fill list
function ColorFillSection({ fillStyleId, fillStyles = [], onAddFillStyle, onNavigateFillStyle, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [pickHex, setPickHex] = useState('#000000');
  const triggerRef = useRef(null);
  const popupRef = useRef(null);

  const fill = (fillStyles ?? []).find(f => f.id === fillStyleId) ?? null;
  const hex = fill?.color ?? '#000000';

  useEffect(() => { setPickHex(hex); }, [hex]);

  function openPopup() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vpW = window.innerWidth;
    const popW = 220;
    let left = rect.left;
    if (left + popW > vpW - 8) left = vpW - popW - 8;
    setPos({ top: rect.bottom + 4, left });
    setOpen(true);
  }

  function closePopup() { setOpen(false); setPos(null); }

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (popupRef.current?.contains(e.target)) return;
      closePopup();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function handleSelectFill(id) {
    onChange('fillStyleId', id);
    closePopup();
  }

  function handleCustomColor(newHex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(newHex)) return;
    const existing = (fillStyles ?? []).find(f => f.type === 'solid' && f.color === newHex);
    if (existing) {
      onChange('fillStyleId', existing.id);
    } else {
      const newId = onAddFillStyle?.({ type: 'solid', color: newHex });
      if (newId) onChange('fillStyleId', newId);
    }
    closePopup();
  }

  const solidFills = (fillStyles ?? []).filter(f => f.type === 'solid' && f.color);

  const popup = open && pos && ReactDOM.createPortal(
    <div
      ref={popupRef}
      className="tse-cfp"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="tse-cfp__label">
        Fill Styles <span className="tse-cfp__count">{solidFills.length}</span>
      </div>
      {solidFills.length > 0 ? (
        <div className="tse-cfp__fills">
          {solidFills.map(fs => (
            <button
              key={fs.id}
              className={`tse-cfp__swatch-btn${fs.id === fillStyleId ? ' tse-cfp__swatch-btn--active' : ''}`}
              title={fs.name}
              onClick={() => handleSelectFill(fs.id)}
            >
              <span className="tse-cfp__swatch" style={{ background: fs.color }} />
            </button>
          ))}
        </div>
      ) : (
        <p className="tse-cfp__empty">Sin fill styles sólidos.</p>
      )}
      <div className="tse-cfp__sep" />
      <div className="tse-cfp__label">Color personalizado</div>
      <div className="tse-cfp__color-row">
        <input
          type="color"
          className="tse-cfp__color-native"
          value={pickHex}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => setPickHex(e.target.value)}
          onBlur={e => handleCustomColor(e.target.value)}
        />
        <input
          type="text"
          className="tse-cfp__hex"
          value={pickHex}
          maxLength={7}
          placeholder="#000000"
          onChange={e => {
            if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setPickHex(e.target.value);
          }}
          onBlur={e => {
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) handleCustomColor(e.target.value);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(pickHex)) handleCustomColor(pickHex);
            if (e.key === 'Escape') closePopup();
          }}
        />
      </div>
      <CmykInputs hex={pickHex} onCommit={c => { setPickHex(c); handleCustomColor(c); }} />
    </div>,
    document.body
  );

  return (
    <>
      <Row label="Fill">
        <div className="tse__fill-selector">
          <FillSwatch fillStyle={fill} />
          <select
            className="tse__select"
            style={{ flex: 1 }}
            value={fillStyleId ?? ''}
            disabled={disabled}
            onChange={e => onChange('fillStyleId', e.target.value || null)}
          >
            <option value="">(Sin fill)</option>
            {(fillStyles ?? []).map(fs => (
              <option key={fs.id} value={fs.id}>{fs.name ?? fs.id}</option>
            ))}
          </select>
          {fillStyleId && onNavigateFillStyle && (
            <button
              className="tse__color-nav"
              title="Ir al Fill Style"
              disabled={disabled}
              onClick={() => onNavigateFillStyle(fillStyleId)}
            >
              <ExternalLink size={11} />
            </button>
          )}
        </div>
      </Row>
      <Row label="Color">
        <div className="tse__color-row">
          <button
            ref={triggerRef}
            className="tse__color-swatch-btn"
            style={{ background: hex }}
            disabled={disabled}
            title={hex}
            onClick={() => open ? closePopup() : openPopup()}
          />
          <span className="tse__color-hex-label">{hex}</span>
          {popup}
        </div>
      </Row>
    </>
  );
}

function TextRow({ label, value, field, onChange, placeholder }) {
  return (
    <Row label={label}>
      <input
        type="text"
        className="tse__input"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(field, e.target.value)}
      />
    </Row>
  );
}

function SectionHead({ label }) {
  return (
    <tr>
      <td colSpan={2} className="tse__section-head">{label}</td>
    </tr>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function TextStyleEditor({ style = {}, onChange, borderStyles = [], lineStyles = [], fillStyles = [], colors = [], onAddFillStyle, onNavigateFillStyle, customFonts = [], disabled = false }) {
  const [activeTab, setActiveTab] = useState('Fuente');
  const s = { ...DEFAULT_TEXT_STYLE, ...style };

  const allFonts = [...FONTS, ...customFonts.filter(f => !FONTS.includes(f))];

  function set(field, value) { onChange({ [field]: value }); }

  const activeFillStyle = s.fillStyleId ? (fillStyles.find(f => f.id === s.fillStyleId) ?? null) : null;
  const activeOutlineStyle = s.outlineStyleId ? (fillStyles.find(f => f.id === s.outlineStyleId) ?? null) : null;

  return (
    <div className="tse">
      <Preview style={s} fillStyles={fillStyles} />

      {/* ── Tabs ── */}
      <div className="tse__tabs">
        {TABS.map(t => (
          <button key={t} className={`tse__tab${activeTab === t ? ' tse__tab--active' : ''}`} onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="tse__body">

        {/* ── Tab: Fuente ── */}
        {activeTab === 'Fuente' && (
          <table className="tse__table"><tbody>
            <SelectRow label="Familia" value={s.fontFamily} field="fontFamily" onChange={set} options={allFonts} />
            <SelectRow label="Peso" value={s.fontWeight} field="fontWeight" onChange={set} options={WEIGHTS} />
            <UnitRowPt label="Tamaño" valuePt={s.fontSize} field="fontSize" onChange={set} min={1} />
            <ColorFillSection
              fillStyleId={s.fillStyleId}
              fillStyles={fillStyles}
              onAddFillStyle={onAddFillStyle}
              onNavigateFillStyle={onNavigateFillStyle}
              onChange={set}
              disabled={disabled}
            />
            <BoolRow label="Bold" value={WEIGHT_MAP[s.fontWeight] >= 700} field="_bold" onChange={(_, v) => set('fontWeight', v ? 'Bold' : 'Regular')} />
            <BoolRow label="Italic" value={s.italic} field="italic" onChange={set} />
            <BoolRow label="Small caps" value={s.smallCaps} field="smallCaps" onChange={set} />
          </tbody></table>
        )}

        {/* ── Tab: Reglas ── */}
        {activeTab === 'Reglas' && (
          <table className="tse__table"><tbody>
            <UnitRow label="Baseline shift" valueMm={s.baselineShift} field="baselineShift" onChange={set} />
            <UnitRow label="Espaciado letras" valueMm={s.letterSpacing} field="letterSpacing" onChange={set} />
            <BoolRow label="Kerning" value={s.kerning} field="kerning" onChange={set} />
            <NumRow label="Escala horizontal" value={s.horizontalScale} field="horizontalScale" onChange={set} unit="%" min={10} max={400} step="1" />
            <NumRow label="Interlineado" value={s.lineHeight} field="lineHeight" onChange={set} min={0.5} max={5} step="0.1" />
            <SelectRow label="Transformación" value={s.textTransform} field="textTransform" onChange={set} options={TRANSFORMS} />
          </tbody></table>
        )}

        {/* ── Tab: Super/Sub ── */}
        {activeTab === 'Super/Sub' && (
          <table className="tse__table"><tbody>
            <NumRow label="Superscript offset" value={s.superscriptOffset} field="superscriptOffset" onChange={set} unit="%" min={0} max={100} step="0.5" />
            <NumRow label="Subscript offset" value={s.subscriptOffset} field="subscriptOffset" onChange={set} unit="%" min={0} max={100} step="0.5" />
            <NumRow label="Super/Sub tamaño" value={s.superSubSize} field="superSubSize" onChange={set} unit="%" min={10} max={100} step="1" />
            <BoolRow label="Superscript" value={s.superscript} field="superscript" onChange={set} />
            <BoolRow label="Subscript" value={s.subscript} field="subscript" onChange={set} />
            <NumRow label="Small caps tamaño" value={s.smallCapsSize} field="smallCapsSize" onChange={set} unit="%" min={10} max={100} step="1" />
          </tbody></table>
        )}

        {/* ── Tab: Líneas ── */}
        {activeTab === 'Líneas' && (
          <>
            <table className="tse__table"><tbody>
              <BoolRow label="Underline" value={s.underline} field="underline" onChange={set} />
              <RefRow label="Underline style" value={s.underlineStyleId} field="underlineStyleId" onChange={set} items={lineStyles} />
              <BoolRow label="Strikethrough" value={s.strikethrough} field="strikethrough" onChange={set} />
              <RefRow label="Strikethrough style" value={s.strikethroughStyleId} field="strikethroughStyleId" onChange={set} items={lineStyles} />
              <BoolRow label="Custom under/strike" value={s.customUnderlineStrike} field="customUnderlineStrike" onChange={set} />
            </tbody></table>

            {s.customUnderlineStrike && (
              <>
                <p className="tse__section-title">Underline</p>
                <table className="tse__table"><tbody>
                  <NumRow label="Offset" value={s.underlineOffset} field="underlineOffset" onChange={set} unit="%" min={0} max={50} step="0.1" />
                  <NumRow label="Grosor" value={s.underlineWidth} field="underlineWidth" onChange={set} unit="%" min={0.5} max={30} step="0.1" />
                </tbody></table>
                <p className="tse__section-title">Strikethrough</p>
                <table className="tse__table"><tbody>
                  <NumRow label="Offset" value={s.strikethroughOffset} field="strikethroughOffset" onChange={set} unit="%" min={0} max={50} step="0.1" />
                  <NumRow label="Grosor" value={s.strikethroughWidth} field="strikethroughWidth" onChange={set} unit="%" min={0.5} max={30} step="0.1" />
                </tbody></table>
              </>
            )}
          </>
        )}

        {/* ── Tab: Relleno ── */}
        {activeTab === 'Relleno' && (
          <>
            <table className="tse__table"><tbody>
              <RefRow
                label="Estilo de relleno"
                value={s.fillStyleId}
                field="fillStyleId"
                onChange={set}
                items={fillStyles}
                emptyLabel="(Usar color simple)"
                renderExtra={activeFillStyle && <FillSwatch fillStyle={activeFillStyle} />}
              />
            </tbody></table>
            <p className="tse__hint">
              {s.fillStyleId
                ? 'El estilo de relleno reemplaza el color del texto. En gradientes se usa clip de fondo.'
                : 'Sin estilo de relleno: se usa el campo «Color» de la pestaña Fuente.'}
            </p>
            {!s.fillStyleId && (
              <p className="tse__hint">
                Selecciona un estilo de relleno para aplicar sólidos, gradientes o imágenes al texto.
              </p>
            )}
          </>
        )}

        {/* ── Tab: Contorno ── */}
        {activeTab === 'Contorno' && (
          <table className="tse__table"><tbody>
            <RefRow
              label="Estilo contorno"
              value={s.outlineStyleId}
              field="outlineStyleId"
              onChange={set}
              items={fillStyles}
              emptyLabel="(Sin contorno)"
              renderExtra={activeOutlineStyle && <FillSwatch fillStyle={activeOutlineStyle} />}
            />
            {s.outlineStyleId && (
              <>
                <UnitRow label="Grosor" valueMm={s.outlineWidth ?? 0.1} field="outlineWidth" onChange={set} min={0} />
                <SelectRow label="Cap" value={s.cap ?? 'butt'} field="cap" onChange={set} options={CAP_STYLES} />
                <SelectRow label="Join" value={s.join ?? 'miter'} field="join" onChange={set} options={JOIN_STYLES} />
                {(s.join ?? 'miter') === 'miter' && (
                  <NumRow label="Miter" value={s.miter ?? 10} field="miter" onChange={set} min={1} max={20} step="0.5" />
                )}
              </>
            )}
          </tbody></table>
        )}

        {/* ── Tab: Borde ── */}
        {activeTab === 'Borde' && (
          <table className="tse__table"><tbody>
            <RefRow label="Border style" value={s.borderStyleId} field="borderStyleId" onChange={set} items={borderStyles} />
            <BoolRow label="Conectar bordes" value={s.connectBorders} field="connectBorders" onChange={set} />
            <BoolRow label="Espacio con línea" value={s.borderWithLineGap} field="borderWithLineGap" onChange={set} />
            <SectionHead label="Enlace" />
            <TextRow label="URL destino" value={s.urlTarget} field="urlTarget" onChange={set} placeholder="https://…" />
            <SectionHead label="Idioma" />
            <TextRow label="Código ISO" value={s.language} field="language" onChange={set} placeholder="es-ES, en-US, ar-SA…" />
          </tbody></table>
        )}

      </div>
    </div>
  );
}
