// editor/resources/ParagraphStyleEditor.jsx — Multi-tab ParagraphStyle editor with live preview

import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { mmToUnit, unitToMm, UNIT_PROPS } from '../../../engine/units.js';
import { ColorPickerPopup } from '../color/ColorEditor.jsx';
import './ParagraphStyleEditor.css';

// ── Catalogs ────────────────────────────────────────────────────────────────

const TABS = ['General', 'Listas', 'Tabuladores', 'Flujo', 'Borde', 'Avanzado'];
const UNITS = ['mm', 'cm', 'pt', 'px', 'in'];

const ALIGNMENTS = [
  { value: 'left',    label: 'Izquierda' },
  { value: 'center',  label: 'Centrado' },
  { value: 'right',   label: 'Derecha' },
  { value: 'justify', label: 'Justificado' },
];

const V_ALIGNMENTS = [
  { value: 'top',    label: 'Arriba' },
  { value: 'middle', label: 'Centro' },
  { value: 'bottom', label: 'Abajo' },
];

const LIST_STYLES = [
  { value: 'none',     label: 'Ninguna' },
  { value: 'bullet',   label: 'Viñetas' },
  { value: 'numbered', label: 'Numerada' },
  { value: 'letter',   label: 'Letras' },
];

const WORD_BREAKS = [
  { value: 'normal',    label: 'Normal' },
  { value: 'break-all', label: 'Break all' },
  { value: 'keep-all',  label: 'Keep all' },
];

const LINE_SPACING_TYPES = [
  { value: 'additional', label: 'Adicional (pt sobre 1em)' },
  { value: 'atleast',    label: 'Mínimo' },
  { value: 'exact',      label: 'Exacto' },
  { value: 'multipleof', label: 'Múltiplo' },
];

const FLOW_BREAK_OPTIONS = [
  { value: 'none',     label: 'Ninguno' },
  { value: 'flowarea', label: 'Área de flujo' },
  { value: 'page',     label: 'Página' },
  { value: 'column',   label: 'Columna' },
];

const KEEP_LINES_OPTIONS = [
  { value: 'no',   label: 'No' },
  { value: 'hard', label: 'Duro' },
  { value: 'soft', label: 'Suave' },
];

const TAB_STOP_TYPES = [
  { value: 'left',        label: 'Izquierda' },
  { value: 'right',       label: 'Derecha' },
  { value: 'center',      label: 'Centro' },
  { value: 'decimal',     label: 'Decimal' },
  { value: 'decimalword', label: 'Decimal pal.' },
];

const TAB_LEADERS = [
  { value: '',  label: 'Ninguno' },
  { value: '.', label: 'Puntos (.)' },
  { value: '-', label: 'Guiones (-)' },
  { value: '_', label: 'Línea (_)' },
];

export const DEFAULT_PARAGRAPH_STYLE = {
  alignment: 'left',
  verticalAlign: 'top',
  lineHeight: 1.4,
  lineSpacingType: 'additional',
  lineSpacing: 0,
  spaceBeforeOnFirst: false,
  ignoreEmptyLines: false,
  letterSpacing: 0,
  firstLineIndent: 0,
  leftIndent: 0,
  rightIndent: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  wordWrap: true,
  wordBreak: 'normal',
  listStyle: 'none',
  listIndent: 5,
  listColor: '',
  defaultTextStyleId: null,
  defaultTab: 12.5,
  tabStops: [],
  flowBreakBefore: 'none',
  flowBreakAfter: 'none',
  keepLinesTogether: 'no',
  keepWithPreviousParagraph: false,
  keepWithNextParagraph: false,
  doNotWrap: false,
  paragraphBorderStyleId: null,
  connectBorders: false,
  borderWithLineGap: false,
  hyphenation: { enabled: false, minLeft: 2, minRight: 2, maxConsecutive: 2 },
};

// ── Preview ─────────────────────────────────────────────────────────────────

function Preview({ style }) {
  const s = { ...DEFAULT_PARAGRAPH_STYLE, ...style };
  const listPrefix = s.listStyle === 'bullet' ? '• '
    : s.listStyle === 'numbered' ? '1. '
    : s.listStyle === 'letter' ? 'a) '
    : '';

  let lineHeightCSS = s.lineHeight;
  if (s.lineSpacingType === 'additional') lineHeightCSS = `calc(1em + ${s.lineSpacing ?? 0}pt)`;
  else if (s.lineSpacingType === 'atleast') lineHeightCSS = `max(${s.lineHeight}, ${s.lineSpacing ?? 0}pt)`;
  else if (s.lineSpacingType === 'exact') lineHeightCSS = `${s.lineSpacing ?? 0}pt`;
  else if (s.lineSpacingType === 'multipleof') lineHeightCSS = s.lineSpacing ?? s.lineHeight;

  const previewStyle = {
    textAlign: s.alignment,
    lineHeight: lineHeightCSS,
    paddingLeft: `${Math.min(s.leftIndent, 20)}px`,
    paddingRight: `${Math.min(s.rightIndent, 20)}px`,
    textIndent: `${Math.min(s.firstLineIndent, 20)}px`,
    fontSize: '11px',
    color: 'var(--color-text-primary, #111827)',
  };

  return (
    <div className="pse__preview">
      <div style={previewStyle}>
        {listPrefix && (
          <span style={s.listColor ? { color: s.listColor } : undefined}>{listPrefix}</span>
        )}
        Ejemplo de párrafo con texto de muestra para visualizar
        el estilo aplicado.
      </div>
    </div>
  );
}

// ── Editable number hook ────────────────────────────────────────────────────

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

// ── Unit badge ──────────────────────────────────────────────────────────────

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
    <span ref={ref} className="pse__ubadge-wrap">
      <button type="button" className="pse__ubadge" onClick={() => setOpen(v => !v)}>
        {unit}
      </button>
      {open && (
        <div className="pse__upicker">
          {UNITS.map(u => (
            <button key={u} type="button"
              className={`pse__uopt${u === unit ? ' pse__uopt--active' : ''}`}
              onClick={() => { onUnitChange(u); setOpen(false); }}
            >{u}</button>
          ))}
        </div>
      )}
    </span>
  );
}

// ── Table field helpers ─────────────────────────────────────────────────────

function Row({ label, children }) {
  return (
    <tr className="pse__tr">
      <td className="pse__td-label">{label}:</td>
      <td className="pse__td-value">{children}</td>
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
      <div className="pse__num-wrap">
        <input type="number" className="pse__input" min={min} max={max} step={step}
          value={ed.value}
          onChange={ed.onChange}
          onFocus={ed.onFocus}
          onBlur={() => ed.commit(commit)}
          onKeyDown={e => { if (e.key === 'Enter') ed.commit(commit); }}
        />
        {unit && <span className="pse__unit">{unit}</span>}
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
      <div className="pse__num-wrap pse__num-wrap--unit">
        <input type="number" className="pse__input" step={cfg.step}
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
      <select className="pse__select" value={value ? 'yes' : 'no'}
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
      <select className="pse__select" value={value ?? ''} onChange={e => onChange(field, e.target.value)}>
        {options.map(o => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
        )}
      </select>
    </Row>
  );
}

function RefRow({ label, value, field, onChange, items, emptyLabel = 'Vacío' }) {
  return (
    <Row label={label}>
      <select className="pse__select" value={value ?? ''} onChange={e => onChange(field, e.target.value || null)}>
        <option value="">{emptyLabel}</option>
        {(items ?? []).map(it => (
          <option key={it.id} value={it.id}>{it.name ?? it.id}</option>
        ))}
      </select>
    </Row>
  );
}

// ── Deferred color picker (commits only on close, not during drag) ──────────

function DeferredColorRow({ value, onChange }) {
  const colorRef = useRef(null);

  useEffect(() => {
    const el = colorRef.current;
    if (!el) return;
    const handleChange = (e) => onChange(e.target.value);
    el.addEventListener('change', handleChange);
    return () => el.removeEventListener('change', handleChange);
  }, [onChange]);

  useEffect(() => {
    if (colorRef.current) colorRef.current.value = value || '#000000';
  }, [value]);

  return (
    <>
      <div className="pse__color-wrap">
        <input
          ref={colorRef}
          type="color"
          className="pse__color-swatch"
          defaultValue={value || '#000000'}
          onChange={() => {}}
        />
        <input
          type="text"
          className="pse__input pse__input--color"
          value={value || ''}
          placeholder="heredar"
          onChange={e => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            className="pse__color-clear"
            title="Heredar color del texto"
            onClick={() => onChange('')}
          >×</button>
        )}
      </div>
      {value && <CmykInputs hex={value} onCommit={onChange} />}
    </>
  );
}

// ── Tab stops editor ─────────────────────────────────────────────────────────

let _tabStopCounter = 0;
function genTabStopId() { return `ts_${Date.now()}_${++_tabStopCounter}`; }

function TabStopsEditor({ stops = [], defaultTab, onChange, onChangeDefaultTab }) {
  const [unit, setUnit] = useState('mm');
  const cfg = UNIT_PROPS[unit] ?? UNIT_PROPS.mm;

  function addStop() {
    const newStop = { id: genTabStopId(), position: defaultTab ?? 12.5, type: 'left', leader: '' };
    onChange([...stops, newStop]);
  }

  function removeStop(id) {
    onChange(stops.filter(s => s.id !== id));
  }

  function updateStop(id, field, value) {
    onChange(stops.map(s => s.id === id ? { ...s, [field]: value } : s));
  }

  const sortedStops = [...stops].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const dtDisplayed = parseFloat(mmToUnit(defaultTab ?? 12.5, unit).toFixed(cfg.decimals));
  const dtEd = useEditableNum(dtDisplayed);

  function commitDefaultTab(v) {
    onChangeDefaultTab(unitToMm(v, unit));
  }

  return (
    <div className="pse__tabstops">
      {/* Default tab */}
      <div className="pse__tabstop-default">
        <span className="pse__td-label">Tab por defecto:</span>
        <div className="pse__num-wrap pse__num-wrap--unit" style={{ flex: 1 }}>
          <input type="number" className="pse__input" step={cfg.step}
            value={dtEd.value}
            onChange={dtEd.onChange}
            onFocus={dtEd.onFocus}
            onBlur={() => dtEd.commit(commitDefaultTab)}
            onKeyDown={e => { if (e.key === 'Enter') dtEd.commit(commitDefaultTab); }}
          />
          <UnitBadge unit={unit} onUnitChange={setUnit} />
        </div>
      </div>

      {/* Stop list header */}
      <div className="pse__tabstop-header">
        <span style={{ flex: '0 0 56px' }}>Posición</span>
        <span style={{ flex: '0 0 82px' }}>Tipo</span>
        <span style={{ flex: '0 0 72px' }}>Líder</span>
        <span style={{ width: 20 }} />
      </div>

      {sortedStops.map(stop => {
        const posDisplayed = parseFloat(mmToUnit(stop.position ?? 0, unit).toFixed(cfg.decimals));
        return (
          <div key={stop.id} className="pse__tabstop-row">
            <input
              type="number"
              className="pse__input pse__tabstop-pos"
              step={cfg.step}
              defaultValue={posDisplayed}
              onBlur={e => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) updateStop(stop.id, 'position', unitToMm(v, unit));
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) updateStop(stop.id, 'position', unitToMm(v, unit));
                }
              }}
            />
            <select
              className="pse__select pse__tabstop-type"
              value={stop.type ?? 'left'}
              onChange={e => updateStop(stop.id, 'type', e.target.value)}
            >
              {TAB_STOP_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <select
              className="pse__select pse__tabstop-leader"
              value={stop.leader ?? ''}
              onChange={e => updateStop(stop.id, 'leader', e.target.value)}
            >
              {TAB_LEADERS.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="pse__tabstop-del"
              onClick={() => removeStop(stop.id)}
              title="Eliminar stop"
            >
              <Trash2 size={11} />
            </button>
          </div>
        );
      })}

      <button type="button" className="pse__tabstop-add" onClick={addStop}>
        <Plus size={11} /> Añadir tabulador
      </button>
    </div>
  );
}

// ── Section header (for Avanzado grouping) ──────────────────────────────────

function SectionHead({ label }) {
  return (
    <tr>
      <td colSpan={2} className="pse__section-head">{label}</td>
    </tr>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ParagraphStyleEditor({ style = {}, onChange, textStyles = [], borderStyles = [], fillStyles = [], onAddFillStyle, onNavigateFillStyle, onNavigateBorderStyle, disabled = false }) {
  const [activeTab, setActiveTab] = useState('General');
  const s = { ...DEFAULT_PARAGRAPH_STYLE, ...style };
  const hyph = { ...(DEFAULT_PARAGRAPH_STYLE.hyphenation), ...(s.hyphenation ?? {}) };

  function set(field, value) { onChange({ [field]: value }); }

  function setHyph(field, value) {
    onChange({ hyphenation: { ...hyph, [field]: value } });
  }

  return (
    <div className="pse">
      <Preview style={s} />

      {/* ── Tabs ── */}
      <div className="pse__tabs">
        {TABS.map(t => (
          <button key={t} className={`pse__tab${activeTab === t ? ' pse__tab--active' : ''}`} onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="pse__body">

        {/* ── Tab: General ── */}
        {activeTab === 'General' && (
          <table className="pse__table"><tbody>
            <SelectRow label="Alineación" value={s.alignment} field="alignment" onChange={set} options={ALIGNMENTS} />
            <SelectRow label="V. Alineación" value={s.verticalAlign} field="verticalAlign" onChange={set} options={V_ALIGNMENTS} />
            <UnitRow label="Sangría izquierda" valueMm={s.leftIndent} field="leftIndent" onChange={set} min={0} />
            <UnitRow label="Sangría derecha" valueMm={s.rightIndent} field="rightIndent" onChange={set} min={0} />
            <UnitRow label="Sangría 1ra línea" valueMm={s.firstLineIndent} field="firstLineIndent" onChange={set} />
            <UnitRow label="Espacio antes" valueMm={s.spaceBefore} field="spaceBefore" onChange={set} min={0} />
            {(s.spaceBefore ?? 0) > 0 && (
              <BoolRow label="↳ Aplicar en 1ro" value={s.spaceBeforeOnFirst} field="spaceBeforeOnFirst" onChange={set} />
            )}
            <UnitRow label="Espacio después" valueMm={s.spaceAfter} field="spaceAfter" onChange={set} min={0} />
            <SelectRow label="Tipo interlineado" value={s.lineSpacingType ?? 'additional'} field="lineSpacingType" onChange={set} options={LINE_SPACING_TYPES} />
            {(s.lineSpacingType === 'additional' || s.lineSpacingType === 'atleast' || s.lineSpacingType === 'exact') && (
              <NumRow label="Interlineado (pt)" value={s.lineSpacing ?? 0} field="lineSpacing" onChange={set} min={0} step="0.5" unit="pt" />
            )}
            {s.lineSpacingType === 'multipleof' && (
              <NumRow label="Interlineado (×)" value={s.lineSpacing ?? 1.4} field="lineSpacing" onChange={set} min={0.5} step="0.1" />
            )}
            {s.lineSpacingType === 'additional' && (
              <NumRow label="Line-height base" value={s.lineHeight} field="lineHeight" onChange={set} min={0.5} max={5} step="0.1" />
            )}
            <BoolRow label="Ignorar líneas vacías" value={s.ignoreEmptyLines} field="ignoreEmptyLines" onChange={set} />
          </tbody></table>
        )}

        {/* ── Tab: Listas ── */}
        {activeTab === 'Listas' && (
          <table className="pse__table"><tbody>
            <SelectRow label="Estilo lista" value={s.listStyle} field="listStyle" onChange={set} options={LIST_STYLES} />
            <UnitRow label="Sangría lista" valueMm={s.listIndent} field="listIndent" onChange={set} min={0} />
            <Row label="Color marcador">
              <div className="pse__color-row">
                <ColorPickerPopup
                  hex={(fillStyles.find(f => f.id === s.listFillStyleId)?.color) ?? s.listColor ?? '#000000'}
                  onChange={({ hex }) => {
                    if (!onAddFillStyle) return;
                    const newId = onAddFillStyle({ type: 'solid', color: hex });
                    set('listFillStyleId', newId);
                  }}
                />
                {s.listFillStyleId && onNavigateFillStyle && (
                  <button className="pse__color-nav" title="Ir al Fill Style"
                    onClick={() => onNavigateFillStyle(s.listFillStyleId)}>
                    <ExternalLink size={11} />
                  </button>
                )}
              </div>
            </Row>
          </tbody></table>
        )}

        {/* ── Tab: Tabuladores ── */}
        {activeTab === 'Tabuladores' && (
          <TabStopsEditor
            stops={s.tabStops ?? []}
            defaultTab={s.defaultTab ?? 12.5}
            onChange={stops => set('tabStops', stops)}
            onChangeDefaultTab={v => set('defaultTab', v)}
          />
        )}

        {/* ── Tab: Flujo ── */}
        {activeTab === 'Flujo' && (
          <table className="pse__table"><tbody>
            <SelectRow label="Salto antes" value={s.flowBreakBefore ?? 'none'} field="flowBreakBefore" onChange={set} options={FLOW_BREAK_OPTIONS} />
            <SelectRow label="Salto después" value={s.flowBreakAfter ?? 'none'} field="flowBreakAfter" onChange={set} options={FLOW_BREAK_OPTIONS} />
            <SelectRow label="Mantener líneas" value={s.keepLinesTogether ?? 'no'} field="keepLinesTogether" onChange={set} options={KEEP_LINES_OPTIONS} />
            <BoolRow label="Con párrafo anterior" value={s.keepWithPreviousParagraph ?? false} field="keepWithPreviousParagraph" onChange={set} />
            <BoolRow label="Con párrafo siguiente" value={s.keepWithNextParagraph ?? false} field="keepWithNextParagraph" onChange={set} />
            <BoolRow label="Sin ajuste de texto" value={s.doNotWrap ?? false} field="doNotWrap" onChange={set} />
          </tbody></table>
        )}

        {/* ── Tab: Borde ── */}
        {activeTab === 'Borde' && (
          <table className="pse__table"><tbody>
            <RefRow
              label="Estilo de borde"
              value={s.paragraphBorderStyleId}
              field="paragraphBorderStyleId"
              onChange={set}
              items={borderStyles}
              emptyLabel="(Sin borde)"
            />
            {s.paragraphBorderStyleId && (
              <>
                <BoolRow label="Conectar bordes" value={s.connectBorders ?? false} field="connectBorders" onChange={set} />
                <BoolRow label="Espacio con línea" value={s.borderWithLineGap ?? false} field="borderWithLineGap" onChange={set} />
              </>
            )}
          </tbody></table>
        )}

        {/* ── Tab: Avanzado ── */}
        {activeTab === 'Avanzado' && (
          <table className="pse__table"><tbody>
            <UnitRow label="Espaciado letras" valueMm={s.letterSpacing} field="letterSpacing" onChange={set} />
            <BoolRow label="Ajuste palabras" value={s.wordWrap} field="wordWrap" onChange={set} />
            <SelectRow label="Salto de palabra" value={s.wordBreak} field="wordBreak" onChange={set} options={WORD_BREAKS} />
            <RefRow label="Estilo texto base" value={s.defaultTextStyleId} field="defaultTextStyleId" onChange={set} items={textStyles} />
            <SectionHead label="Separación silábica" />
            <BoolRow label="Activar" value={hyph.enabled} field="enabled" onChange={setHyph} />
            {hyph.enabled && (
              <>
                <NumRow label="Mín. izquierda" value={hyph.minLeft ?? 2} field="minLeft" onChange={setHyph} min={1} max={10} step="1" />
                <NumRow label="Mín. derecha" value={hyph.minRight ?? 2} field="minRight" onChange={setHyph} min={1} max={10} step="1" />
                <NumRow label="Máx. consecutivos" value={hyph.maxConsecutive ?? 2} field="maxConsecutive" onChange={setHyph} min={1} max={10} step="1" />
              </>
            )}
          </tbody></table>
        )}

      </div>
    </div>
  );
}
