// editor/resources/BorderStyleEditor.jsx — Reusable 4-tab BorderStyle editor

import { useState, useRef, useEffect } from 'react';
import './BorderStyleEditor.css';
import { createDefaultBorderStyle } from './borderStyleDefaults.js';
import FillStyleSelector from '../fill/FillStyleSelector.jsx';
import { CmykInputs } from '../colorUtils.jsx';

// ── Option catalogs ───────────────────────────────────────────────────────────

const CAP_OPTIONS    = ['Butt', 'Round', 'Square'];
const LINE_OPTIONS   = ['None', 'Solid', 'Dashed', 'Dotted', 'Double'];
const CORNER_OPTIONS = ['Standard', 'Round', 'RoundOut', 'CutOut'];
const JOIN_OPTIONS   = ['Miter', 'Round', 'Bevel'];
const TABS           = ['Lines/Corners', 'Shading', 'Márgenes', 'Offsets'];

const SIDES   = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const DIAGS   = ['diagonal-lr', 'diagonal-rl'];

// ── Effective value helpers ───────────────────────────────────────────────────

function effectiveSide(s, side) {
  const sd = s.sides?.[side] ?? {};
  return {
    enabled:         sd.enabled   ?? true,
    lineWidth:       sd.lineWidth ?? s.lineWidth ?? 0.2,
    lineStyle:       sd.lineStyle ?? s.lineStyle ?? 'Solid',
    lineColor:       sd.lineColor ?? s.lineColor ?? '#000000',
    lineFillStyleId: sd.lineFillStyleId ?? s.lineFillStyleId ?? null,
  };
}

function effectiveCorner(s, corner) {
  const cd = s.corners?.[corner] ?? {};
  return {
    corner:  cd.corner  ?? s.corner  ?? 'Standard',
    radiusX: cd.radiusX ?? s.radiusX ?? 5,
    radiusY: cd.radiusY ?? s.radiusY ?? 5,
  };
}

// ── SVG Preview ───────────────────────────────────────────────────────────────

function Preview({ s, fillStyles = [] }) {
  const W = 200, H = 100, pad = 4;

  function resolveFSColor(id, fallback) {
    if (id) {
      const fs = fillStyles.find(f => f.id === id);
      if (fs?.color) return fs.color;
    }
    return fallback;
  }

  const tl = effectiveCorner(s, 'topLeft');
  const tr = effectiveCorner(s, 'topRight');
  const br = effectiveCorner(s, 'bottomRight');
  const bl = effectiveCorner(s, 'bottomLeft');

  function mmToPx(mm) { return mm * 3.7795; }
  function clampRx(c) {
    if (c.corner === 'Standard') return 0;
    return Math.min(mmToPx(c.radiusX ?? 0), (W - pad * 2) / 2);
  }
  function clampRy(c) {
    if (c.corner === 'Standard') return 0;
    return Math.min(mmToPx(c.radiusY ?? 0), (H - pad * 2) / 2);
  }

  function arcCmd(c, x, y, sweep) {
    const rx = clampRx(c), ry = clampRy(c);
    if (c.corner === 'Standard' || (rx <= 0 && ry <= 0)) return `L ${x} ${y}`;
    if (c.corner === 'Round')    return `A ${rx} ${ry} 0 0 1 ${x} ${y}`;
    if (c.corner === 'RoundOut') return `A ${rx} ${ry} 0 0 0 ${x} ${y}`;
    if (c.corner === 'CutOut')   return `L ${x} ${y}`; // straight cut handled by corner points
    return `L ${x} ${y}`;
  }

  const x0 = pad, y0 = pad, x1 = W - pad, y1 = H - pad;
  const tlRx = clampRx(tl), tlRy = clampRy(tl);
  const trRx = clampRx(tr), trRy = clampRy(tr);
  const brRx = clampRx(br), brRy = clampRy(br);
  const blRx = clampRx(bl), blRy = clampRy(bl);

  // CutOut corners need an intermediate point
  function cornerPoints(c, x, y, dxSign, dySign, rxv, ryv) {
    if (c.corner === 'CutOut' && (rxv > 0 || ryv > 0)) {
      return [`L ${x + dxSign * rxv} ${y}`, `L ${x} ${y + dySign * ryv}`].join(' ');
    }
    const moveX = dxSign > 0 ? x - rxv : x + rxv;
    const moveY = dySign > 0 ? y - ryv : y + ryv;
    return `${arcCmd(c, x + dxSign * rxv, y + dySign * ryv, 1)}`;
  }

  const path = [
    `M ${x0 + tlRx} ${y0}`,
    `L ${x1 - trRx} ${y0}`,
    tl.corner === 'CutOut' ? '' : '',
    tr.corner === 'CutOut' && (trRx || trRy)
      ? `L ${x1} ${y0 + trRy}`
      : arcCmd(tr, x1, y0 + trRy, 1),
    `L ${x1} ${y1 - brRy}`,
    br.corner === 'CutOut' && (brRx || brRy)
      ? `L ${x1 - brRx} ${y1}`
      : arcCmd(br, x1 - brRx, y1, 1),
    `L ${x0 + blRx} ${y1}`,
    bl.corner === 'CutOut' && (blRx || blRy)
      ? `L ${x0} ${y1 - blRy}`
      : arcCmd(bl, x0, y1 - blRy, 1),
    `L ${x0} ${y0 + tlRy}`,
    tl.corner === 'CutOut' && (tlRx || tlRy)
      ? `L ${x0 + tlRx} ${y0}`
      : arcCmd(tl, x0 + tlRx, y0, 1),
    'Z',
  ].filter(Boolean).join(' ');

  return (
    <div className="bse__preview">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="bse__preview-svg">
        {/* Interior fill */}
        {(s.fill || s.fillFillStyleId) && (
          <path d={path} fill={resolveFSColor(s.fillFillStyleId, s.fill)} />
        )}

        {/* Per-side borders via clip */}
        {SIDES.map((side, i) => {
          const sd = effectiveSide(s, side);
          if (!sd.enabled || sd.lineStyle === 'None') return null;
          const sw = Math.max(0.5, mmToPx(sd.lineWidth));
          const da = sd.lineStyle === 'Dashed' ? `${sw*4},${sw*2}`
                   : sd.lineStyle === 'Dotted' ? `${sw},${sw*2}`
                   : undefined;
          const cid = `bse-clip-${side}`;
          const clip = {
            top:    { x: 0,   y: 0,    w: W,   h: H/2 },
            bottom: { x: 0,   y: H/2,  w: W,   h: H/2 },
            left:   { x: 0,   y: 0,    w: W/2, h: H   },
            right:  { x: W/2, y: 0,    w: W/2, h: H   },
          }[side];
          return (
            <g key={side}>
              <defs>
                <clipPath id={cid}>
                  <rect x={clip.x} y={clip.y} width={clip.w} height={clip.h} />
                </clipPath>
              </defs>
              <path d={path} fill="none" stroke={resolveFSColor(sd.lineFillStyleId, sd.lineColor)} strokeWidth={sw}
                strokeDasharray={da} clipPath={`url(#${cid})`} />
            </g>
          );
        })}
        {/* Diagonal decoration in preview */}
        {s.diagonals?.lr?.enabled && (() => {
          const d = s.diagonals.lr;
          const sw = Math.max(0.5, mmToPx(d.lineWidth ?? s.lineWidth ?? 0.2));
          const da = (d.lineStyle ?? s.lineStyle ?? 'Solid') === 'Dashed' ? `${sw*4},${sw*2}` : (d.lineStyle ?? s.lineStyle ?? 'Solid') === 'Dotted' ? `${sw},${sw*2}` : undefined;
          return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={resolveFSColor(d.lineFillStyleId ?? s.lineFillStyleId, d.lineColor ?? s.lineColor ?? '#000000')} strokeWidth={sw} strokeDasharray={da} />;
        })()}
        {s.diagonals?.rl?.enabled && (() => {
          const d = s.diagonals.rl;
          const sw = Math.max(0.5, mmToPx(d.lineWidth ?? s.lineWidth ?? 0.2));
          const da = (d.lineStyle ?? s.lineStyle ?? 'Solid') === 'Dashed' ? `${sw*4},${sw*2}` : (d.lineStyle ?? s.lineStyle ?? 'Solid') === 'Dotted' ? `${sw},${sw*2}` : undefined;
          return <line x1={x1} y1={y0} x2={x0} y2={y1} stroke={resolveFSColor(d.lineFillStyleId ?? s.lineFillStyleId, d.lineColor ?? s.lineColor ?? '#000000')} strokeWidth={sw} strokeDasharray={da} />;
        })()}
      </svg>
    </div>
  );
}

// ── Side/Corner/Diagonal selector ────────────────────────────────────────────

function SideCornerSelector({ selected, onSelectionChange }) {
  function toggle(id, e) {
    e.stopPropagation();
    const next = new Set(selected);
    if (e.ctrlKey || e.metaKey) {
      if (next.has(id)) next.delete(id); else next.add(id);
    } else {
      if (next.size === 1 && next.has(id)) next.clear();
      else { next.clear(); next.add(id); }
    }
    onSelectionChange(next);
  }

  const on = (id) => selected.has(id);
  // Box dimensions (must match CSS)
  const W = 80, H = 50;

  return (
    <div className="bse__selector">
      <div className="bse__sel-quick">
        {[
          { label: 'Todos',      ids: [...SIDES, ...CORNERS, ...DIAGS] },
          { label: 'Lados',      ids: SIDES },
          { label: 'Esquinas',   ids: CORNERS },
          { label: 'Diagonales', ids: DIAGS },
          { label: '✕',          ids: [] },
        ].map(({ label, ids }) => (
          <button key={label} className="bse__sel-qbtn"
            onClick={() => onSelectionChange(new Set(ids))}>
            {label}
          </button>
        ))}
      </div>

      <div className="bse__sel-box">
        <div className={`bse__sel-side bse__sel-side--top${on('top') ? ' bse__sel--on' : ''}`}
          onClick={e => toggle('top', e)} title="Superior" />
        <div className={`bse__sel-side bse__sel-side--right${on('right') ? ' bse__sel--on' : ''}`}
          onClick={e => toggle('right', e)} title="Derecho" />
        <div className={`bse__sel-side bse__sel-side--bottom${on('bottom') ? ' bse__sel--on' : ''}`}
          onClick={e => toggle('bottom', e)} title="Inferior" />
        <div className={`bse__sel-side bse__sel-side--left${on('left') ? ' bse__sel--on' : ''}`}
          onClick={e => toggle('left', e)} title="Izquierdo" />

        {[
          { id: 'topLeft',     cls: 'tl' },
          { id: 'topRight',    cls: 'tr' },
          { id: 'bottomRight', cls: 'br' },
          { id: 'bottomLeft',  cls: 'bl' },
        ].map(({ id, cls }) => (
          <div key={id}
            className={`bse__sel-corner bse__sel-corner--${cls}${on(id) ? ' bse__sel--on' : ''}`}
            onClick={e => toggle(id, e)} />
        ))}

        {/* Diagonal hit areas as SVG lines */}
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {[
            { id: 'diagonal-lr', x1: 10, y1: 10, x2: W - 10, y2: H - 10, label: '↘' },
            { id: 'diagonal-rl', x1: W - 10, y1: 10, x2: 10, y2: H - 10, label: '↙' },
          ].map(({ id, x1, y1, x2, y2 }) => (
            <g key={id} style={{ pointerEvents: 'all', cursor: 'pointer' }} onClick={e => toggle(id, e)}>
              {/* Transparent fat hit area */}
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
              {/* Visual line */}
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={on(id) ? '#2563eb' : '#d1d5db'} strokeWidth={2}
                style={{ transition: 'stroke 0.1s' }}
              />
            </g>
          ))}
        </svg>

        <div className="bse__sel-center">
          {selected.size === 0
            ? <span className="bse__sel-hint">clic</span>
            : <span className="bse__sel-count">{selected.size}</span>
          }
        </div>
      </div>
    </div>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function NumRow({ label, value, field, unit, onChange, step = '0.01', min = '0', mixed }) {
  return (
    <tr>
      <td className="bse__td-label">{label}:</td>
      <td className="bse__td-value">
        <div className="bse__num-row">
          <input type="number" className="bse__num-input" min={min} step={step}
            value={mixed ? '' : (value ?? 0)}
            placeholder={mixed ? '—' : undefined}
            onChange={e => onChange(field, parseFloat(e.target.value) || 0)} />
          {unit && <span className="bse__unit">{unit}</span>}
        </div>
      </td>
    </tr>
  );
}

function SelectRow({ label, value, field, options, onChange, mixed }) {
  return (
    <tr>
      <td className="bse__td-label">{label}:</td>
      <td className="bse__td-value">
        <select className={`bse__select${mixed ? ' bse__select--mixed' : ''}`}
          value={mixed ? '' : (value ?? options[0])}
          onChange={e => onChange(field, e.target.value)}>
          {mixed && <option value="">—</option>}
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
    </tr>
  );
}

function ColorRow({ label, colorField, value, onChange, mixed, onClear, placeholder = '#000000',
                    fillStyleId, fillStyles, onAddFillStyle, onNavigateFillStyle, onSelectFillStyle }) {
  const [local, setLocal] = useState(undefined);
  const timerRef = useRef(null);

  useEffect(() => {
    clearTimeout(timerRef.current);
    setLocal(undefined);
  }, [value]);

  const pickerVal = local !== undefined ? local : (mixed ? '#808080' : (value || '#000000'));
  const textVal   = local !== undefined ? local : (mixed ? '' : (value ?? ''));
  const hasValue  = local !== undefined ? !!local : !!value;

  function handleChange(newColor) {
    setLocal(newColor);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(colorField, newColor);
      setLocal(undefined);
    }, 120);
  }

  function handleClear() {
    clearTimeout(timerRef.current);
    setLocal(undefined);
    onClear?.();
  }

  const hasFillStyleSupport = !!(fillStyles && onSelectFillStyle);
  const currentFillStyle    = hasFillStyleSupport && fillStyleId
    ? fillStyles.find(s => s.id === fillStyleId) ?? null
    : null;

  return (
    <tr>
      <td className="bse__td-label">{label}:</td>
      <td className="bse__td-value">
        <div className="bse__color-row">
          {/* Compact FillStyleSelector swatch (si hay soporte para fill styles) */}
          {hasFillStyleSupport ? (
            <FillStyleSelector
              compact
              fillStyleId={fillStyleId ?? null}
              fillStyles={fillStyles}
              onSelect={id => onSelectFillStyle(id)}
              onNavigate={onNavigateFillStyle}
              onAddFillStyle={onAddFillStyle}
              fallbackColor={pickerVal}
              fallbackOpacity={1}
              showOpacity={false}
            />
          ) : (
            <input type="color" className="bse__color-pick"
              value={pickerVal}
              onChange={e => handleChange(e.target.value)} />
          )}
          {/* Hex text input (solo visible si no hay fill style asignado) */}
          {!currentFillStyle && (
            <input type="text" className="bse__text-input bse__text-input--hex"
              value={textVal}
              placeholder={mixed ? '—' : placeholder}
              onChange={e => handleChange(e.target.value)} />
          )}
          {currentFillStyle && (
            <span className="bse__fill-name">{currentFillStyle.name}</span>
          )}
          {onClear && (hasValue || fillStyleId) && (
            <button className="bse__clear-btn" onClick={handleClear} title="Quitar">✕</button>
          )}
        </div>
        {!hasFillStyleSupport && (
          <CmykInputs hex={pickerVal} onCommit={c => handleChange(c)} />
        )}
      </td>
    </tr>
  );
}

function CheckRow({ label, value, onChange, mixed }) {
  return (
    <tr>
      <td className="bse__td-label">{label}:</td>
      <td className="bse__td-value">
        <input type="checkbox"
          checked={mixed ? false : (value ?? true)}
          ref={el => { if (el) el.indeterminate = !!mixed; }}
          onChange={e => onChange(e.target.checked)} />
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BorderStyleEditor({ style = {}, onChange, fillStyles = [], onAddFillStyle, onNavigateFillStyle }) {
  const [activeTab, setActiveTab] = useState('Lines/Corners');
  const [selected, setSelected]   = useState(new Set([...SIDES, ...CORNERS]));

  // Merge with defaults ensuring nested objects exist
  const defaults = createDefaultBorderStyle();
  const s = {
    ...defaults,
    ...style,
    sides:     { ...defaults.sides,     ...(style.sides     ?? {}) },
    corners:   { ...defaults.corners,   ...(style.corners   ?? {}) },
    diagonals: {
      ...defaults.diagonals,
      ...(style.diagonals ?? {}),
      lr: { ...defaults.diagonals.lr, ...(style.diagonals?.lr ?? {}) },
      rl: { ...defaults.diagonals.rl, ...(style.diagonals?.rl ?? {}) },
    },
  };

  const selectedSides   = [...selected].filter(id => SIDES.includes(id));
  const selectedCorners = [...selected].filter(id => CORNERS.includes(id));
  const selectedDiags   = [...selected].filter(id => DIAGS.includes(id));
  const hasSides        = selectedSides.length > 0;
  const hasCorners      = selectedCorners.length > 0;
  const hasDiagonals    = selectedDiags.length > 0;

  // ── Mixed-value readers ───────────────────────────────────────────────────

  function getSideMixed(field, globalFallback) {
    const vals = selectedSides.map(id => s.sides[id]?.[field] ?? globalFallback);
    const same = vals.every(v => v === vals[0]);
    return { value: same ? vals[0] : null, mixed: !same };
  }

  function getCornerMixed(field, globalFallback) {
    const vals = selectedCorners.map(id => s.corners[id]?.[field] ?? globalFallback);
    const same = vals.every(v => v === vals[0]);
    return { value: same ? vals[0] : null, mixed: !same };
  }

  // ── Writers ───────────────────────────────────────────────────────────────

  function setSideProp(field, value) {
    const next = { ...s.sides };
    for (const id of selectedSides) next[id] = { ...(next[id] ?? {}), [field]: value };
    onChange({ sides: next });
  }

  function setCornerProp(field, value) {
    const next = { ...s.corners };
    for (const id of selectedCorners) next[id] = { ...(next[id] ?? {}), [field]: value };
    onChange({ corners: next });
  }

  function getDiagMixed(field, globalFallback) {
    const vals = selectedDiags.map(id => {
      const dk = id === 'diagonal-lr' ? 'lr' : 'rl';
      return s.diagonals[dk]?.[field] ?? globalFallback;
    });
    const same = vals.every(v => v === vals[0]);
    return { value: same ? vals[0] : null, mixed: !same };
  }

  function setDiagProp(field, value) {
    const next = { lr: { ...s.diagonals.lr }, rl: { ...s.diagonals.rl } };
    for (const id of selectedDiags) {
      const dk = id === 'diagonal-lr' ? 'lr' : 'rl';
      next[dk] = { ...next[dk], [field]: value };
    }
    onChange({ diagonals: next });
  }

  function set(field, value) { onChange({ [field]: value }); }

  // ── Derived values for the tab ────────────────────────────────────────────

  const enab  = getSideMixed('enabled',   true);
  const sCol  = getSideMixed('lineColor', s.lineColor);
  const sWid  = getSideMixed('lineWidth', s.lineWidth);
  const sSty  = getSideMixed('lineStyle', s.lineStyle);
  const cTyp  = getCornerMixed('corner',  s.corner);
  const cRx   = getCornerMixed('radiusX', s.radiusX);
  const cRy   = getCornerMixed('radiusY', s.radiusY);

  const CORNER_ABBR = { topLeft: 'TL', topRight: 'TR', bottomRight: 'BR', bottomLeft: 'BL' };

  return (
    <div className="bse">
      <Preview s={s} fillStyles={fillStyles} />
      <SideCornerSelector selected={selected} onSelectionChange={setSelected} />

      <div className="bse__tabs">
        {TABS.map(t => (
          <button key={t} className={`bse__tab${activeTab === t ? ' bse__tab--active' : ''}`}
            onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="bse__body">

        {/* ── Lines/Corners ── */}
        {activeTab === 'Lines/Corners' && (
          <>
            {hasSides && (
              <>
                <p className="bse__section-title">
                  Línea
                  {selectedSides.length < 4 &&
                    <span className="bse__section-hint"> · {selectedSides.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}</span>
                  }
                </p>
                <table className="bse__fields"><tbody>
                  <CheckRow label="Habilitado" value={enab.value} mixed={enab.mixed}
                    onChange={v => setSideProp('enabled', v)} />
                  <ColorRow label="Color" colorField="lineColor" value={sCol.value} mixed={sCol.mixed}
                    onChange={(_, v) => setSideProp('lineColor', v)}
                    fillStyleId={s.lineFillStyleId ?? null}
                    fillStyles={fillStyles}
                    onAddFillStyle={onAddFillStyle}
                    onNavigateFillStyle={onNavigateFillStyle}
                    onSelectFillStyle={id => set('lineFillStyleId', id ?? null)}
                  />
                  <NumRow label="Grosor" field="lineWidth" value={sWid.value} mixed={sWid.mixed}
                    unit="mm" min="0" onChange={(_, v) => setSideProp('lineWidth', v)} />
                  <SelectRow label="Estilo" field="lineStyle" value={sSty.value} mixed={sSty.mixed}
                    options={LINE_OPTIONS} onChange={(_, v) => setSideProp('lineStyle', v)} />
                </tbody></table>
              </>
            )}

            {hasCorners && (
              <>
                <p className="bse__section-title">
                  Esquinas
                  {selectedCorners.length < 4 &&
                    <span className="bse__section-hint"> · {selectedCorners.map(c => CORNER_ABBR[c]).join(', ')}</span>
                  }
                </p>
                <table className="bse__fields"><tbody>
                  <SelectRow label="Tipo" field="corner" value={cTyp.value} mixed={cTyp.mixed}
                    options={CORNER_OPTIONS} onChange={(_, v) => setCornerProp('corner', v)} />
                  <NumRow label="Radio X" field="radiusX" value={cRx.value} mixed={cRx.mixed}
                    unit="mm" onChange={(_, v) => setCornerProp('radiusX', v)} />
                  <NumRow label="Radio Y" field="radiusY" value={cRy.value} mixed={cRy.mixed}
                    unit="mm" onChange={(_, v) => setCornerProp('radiusY', v)} />
                </tbody></table>
              </>
            )}

            {hasDiagonals && (() => {
              const dEnab = getDiagMixed('enabled', false);
              const dCol  = getDiagMixed('lineColor', s.lineColor);
              const dWid  = getDiagMixed('lineWidth', s.lineWidth);
              const dSty  = getDiagMixed('lineStyle', s.lineStyle);
              const dFill = getDiagMixed('lineFillStyleId', s.lineFillStyleId);
              return (
                <>
                  <p className="bse__section-title">
                    Diagonales
                    {selectedDiags.length < 2 &&
                      <span className="bse__section-hint"> · {selectedDiags.map(d => d === 'diagonal-lr' ? '↘' : '↙').join(', ')}</span>
                    }
                  </p>
                  <table className="bse__fields"><tbody>
                    <CheckRow label="Habilitado" value={dEnab.value} mixed={dEnab.mixed}
                      onChange={v => setDiagProp('enabled', v)} />
                    <ColorRow label="Color" colorField="lineColor" value={dCol.value} mixed={dCol.mixed}
                      onChange={(_, v) => setDiagProp('lineColor', v)}
                      fillStyleId={dFill.mixed ? null : (dFill.value ?? null)}
                      fillStyles={fillStyles}
                      onAddFillStyle={onAddFillStyle}
                      onNavigateFillStyle={onNavigateFillStyle}
                      onSelectFillStyle={id => setDiagProp('lineFillStyleId', id ?? null)}
                    />
                    <NumRow label="Grosor" field="lineWidth" value={dWid.value} mixed={dWid.mixed}
                      unit="mm" min="0" onChange={(_, v) => setDiagProp('lineWidth', v)} />
                    <SelectRow label="Estilo" field="lineStyle" value={dSty.value} mixed={dSty.mixed}
                      options={LINE_OPTIONS} onChange={(_, v) => setDiagProp('lineStyle', v)} />
                  </tbody></table>
                </>
              );
            })()}

            {!hasSides && !hasCorners && !hasDiagonals && (
              <p className="bse__no-selection">Selecciona uno o más lados / esquinas / diagonales arriba.</p>
            )}
          </>
        )}

        {/* ── Shading ── */}
        {activeTab === 'Shading' && (
          <>
            <p className="bse__section-title">Relleno interior</p>
            <table className="bse__fields"><tbody>
              <ColorRow label="Color" colorField="fill" value={s.fill ?? ''}
                onChange={(_, v) => set('fill', v)} placeholder="Vacío"
                onClear={() => set('fill', '')}
                fillStyleId={s.fillFillStyleId ?? null}
                fillStyles={fillStyles}
                onAddFillStyle={onAddFillStyle}
                onNavigateFillStyle={onNavigateFillStyle}
                onSelectFillStyle={id => set('fillFillStyleId', id ?? null)}
              />
              <SelectRow label="Esquina" field="fillCorner" value={s.fillCorner ?? 'Standard'}
                options={CORNER_OPTIONS} onChange={(_, v) => set('fillCorner', v)} />
              <NumRow label="Radio X" field="fillRadiusX" value={s.fillRadiusX ?? 0} unit="mm"
                onChange={(f, v) => set(f, v)} />
              <NumRow label="Radio Y" field="fillRadiusY" value={s.fillRadiusY ?? 0} unit="mm"
                onChange={(f, v) => set(f, v)} />
              <NumRow label="Margen L" field="fillPaddingLeft"   value={s.fillPaddingLeft   ?? 0} unit="mm" onChange={(f,v)=>set(f,v)} />
              <NumRow label="Margen R" field="fillPaddingRight"  value={s.fillPaddingRight  ?? 0} unit="mm" onChange={(f,v)=>set(f,v)} />
              <NumRow label="Margen T" field="fillPaddingTop"    value={s.fillPaddingTop    ?? 0} unit="mm" onChange={(f,v)=>set(f,v)} />
              <NumRow label="Margen B" field="fillPaddingBottom" value={s.fillPaddingBottom ?? 0} unit="mm" onChange={(f,v)=>set(f,v)} />
            </tbody></table>

            <p className="bse__section-title">Sombra</p>
            <table className="bse__fields"><tbody>
              <ColorRow label="Color" colorField="shadowColor" value={s.shadowColor ?? ''}
                onChange={(_, v) => set('shadowColor', v)} placeholder="Vacío"
                onClear={() => set('shadowColor', '')}
                fillStyleId={s.shadowFillStyleId ?? null}
                fillStyles={fillStyles}
                onAddFillStyle={onAddFillStyle}
                onNavigateFillStyle={onNavigateFillStyle}
                onSelectFillStyle={id => set('shadowFillStyleId', id ?? null)}
              />
              <NumRow label="Offset X" field="shadowOffsetX" value={s.shadowOffsetX} unit="mm"
                onChange={(f, v) => set(f, v)} />
              <NumRow label="Offset Y" field="shadowOffsetY" value={s.shadowOffsetY} unit="mm"
                onChange={(f, v) => set(f, v)} />
            </tbody></table>
          </>
        )}

        {/* ── Margins ── */}
        {activeTab === 'Márgenes' && (
          <table className="bse__fields"><tbody>
            <tr><td colSpan={2}><p className="bse__section-title">Tamaño</p></td></tr>
            <NumRow label="Izq"  field="marginLeft"   value={s.marginLeft}   unit="mm" onChange={(f,v)=>set(f,v)} />
            <NumRow label="Der"  field="marginRight"  value={s.marginRight}  unit="mm" onChange={(f,v)=>set(f,v)} />
            <NumRow label="Sup"  field="marginTop"    value={s.marginTop}    unit="mm" onChange={(f,v)=>set(f,v)} />
            <NumRow label="Inf"  field="marginBottom" value={s.marginBottom} unit="mm" onChange={(f,v)=>set(f,v)} />
            <tr><td colSpan={2}><p className="bse__section-title">Línea interior</p></td></tr>
            <SelectRow label="Estilo" field="marginLineStyle" value={s.marginLineStyle ?? 'None'}
              options={LINE_OPTIONS} onChange={(_, v) => set('marginLineStyle', v)} />
            <ColorRow  label="Color"  colorField="marginColor" value={s.marginColor ?? '#000000'}
              onChange={(_, v) => set('marginColor', v)} />
            <NumRow    label="Grosor" field="marginLineWidth" value={s.marginLineWidth ?? 0.2}
              unit="mm" min="0" onChange={(f,v)=>set(f,v)} />
          </tbody></table>
        )}

        {/* ── Offsets ── */}
        {activeTab === 'Offsets' && (
          <table className="bse__fields"><tbody>
            <NumRow label="Left"   field="offsetLeft"   value={s.offsetLeft}   unit="mm" onChange={(f,v)=>set(f,v)} />
            <NumRow label="Right"  field="offsetRight"  value={s.offsetRight}  unit="mm" onChange={(f,v)=>set(f,v)} />
            <NumRow label="Top"    field="offsetTop"    value={s.offsetTop}    unit="mm" onChange={(f,v)=>set(f,v)} />
            <NumRow label="Bottom" field="offsetBottom" value={s.offsetBottom} unit="mm" onChange={(f,v)=>set(f,v)} />
          </tbody></table>
        )}

      </div>
    </div>
  );
}
