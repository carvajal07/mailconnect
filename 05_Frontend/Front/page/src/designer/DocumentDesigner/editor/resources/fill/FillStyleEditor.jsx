// editor/resources/FillStyleEditor.jsx — Edita el contenido de un Fill Style

import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import FillStyleSelector from './FillStyleSelector.jsx';
import { CmykInputs } from '../colorUtils.jsx';
import { hexToRgba, interpolateHex } from '../../../engine/colorUtils.js';
import { buildGradientCss } from '../../../engine/fillUtils.js';
import './FillStyleEditor.css';

// ── Color dropdown for solid fill ─────────────────────────────────────────────

function ColorDropdown({ colorId, colors = [], onSelect, onNavigate }) {
  const selectedColor = colorId ? colors.find(c => c.id === colorId) ?? null : null;

  return (
    <div className="fse-color-drop">
      {selectedColor && (
        <span className="fse-color-drop__swatch"
          style={{ background: selectedColor.hex ?? '#000000', opacity: (selectedColor.alpha ?? 255) / 255 }} />
      )}
      <select
        className="fse-color-drop__select"
        value={colorId ?? ''}
        onChange={e => onSelect(e.target.value || null)}
      >
        <option value="">(Sin color de biblioteca)</option>
        {colors.map(c => (
          <option key={c.id} value={c.id}>{c.name ?? c.id}</option>
        ))}
      </select>
      {selectedColor && onNavigate && (
        <button
          className="fse-color-drop__nav"
          title="Ir al Color"
          onClick={() => onNavigate(selectedColor.id)}
        >
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: 'none',                 label: 'Ninguno'              },
  { value: 'solid',                label: 'Sólido'               },
  { value: 'gradient',             label: 'Degradado'            },
  { value: 'image',                label: 'Imagen'               },
  { value: 'select-by-condition',  label: 'Variable (condición)' },
  { value: 'select-by-text',       label: 'Variable (texto)'     },
  { value: 'select-by-integer',    label: 'Variable (entero)'    },
  { value: 'select-by-interval',   label: 'Variable (intervalo)' },
];

const CONDITION_OPS = [
  { value: 'eq',       label: '= igual a'        },
  { value: 'neq',      label: '≠ distinto de'    },
  { value: 'gt',       label: '> mayor que'      },
  { value: 'gte',      label: '≥ mayor o igual'  },
  { value: 'lt',       label: '< menor que'      },
  { value: 'lte',      label: '≤ menor o igual'  },
  { value: 'contains', label: '∋ contiene'       },
];

// ── Direction presets (linear gradient) ──────────────────────────────────────

const DIR_PRESETS = [
  { label: '→', angle: 90,  title: 'Horizontal →' },
  { label: '↘', angle: 135, title: 'Diagonal ↘'  },
  { label: '↓', angle: 180, title: 'Vertical ↓'  },
  { label: '↙', angle: 225, title: 'Diagonal ↙'  },
  { label: '←', angle: 270, title: 'Horizontal ←' },
  { label: '↖', angle: 315, title: 'Diagonal ↖'  },
  { label: '↑', angle: 0,   title: 'Vertical ↑'  },
  { label: '↗', angle: 45,  title: 'Diagonal ↗'  },
];

// ── Interactive gradient bar ──────────────────────────────────────────────────

function GradientBar({ stops, onChangeStops, selectedIdx, onSelectIdx }) {
  const barRef = useRef(null);

  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const barCss = sorted.length >= 1
    ? `linear-gradient(to right, ${sorted.map(s => `${hexToRgba(s.color, s.opacity ?? 1)} ${s.offset}%`).join(', ')})`
    : '#cccccc';

  function getOffset(clientX) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }

  function interpolateAt(offset) {
    if (!sorted.length) return '#888888';
    if (offset <= sorted[0].offset) return sorted[0].color ?? '#000';
    if (offset >= sorted[sorted.length-1].offset) return sorted[sorted.length-1].color ?? '#fff';
    for (let i = 0; i < sorted.length - 1; i++) {
      if (offset >= sorted[i].offset && offset <= sorted[i+1].offset) {
        const t = (offset - sorted[i].offset) / (sorted[i+1].offset - sorted[i].offset);
        return interpolateHex(sorted[i].color ?? '#000', sorted[i+1].color ?? '#fff', t);
      }
    }
    return '#888888';
  }

  function handleBarClick(e) {
    if (e.target.closest('.gsb__handle')) return;
    const offset = getOffset(e.clientX);
    const color = interpolateAt(offset);
    const newStops = [...stops, { color, opacity: 1, offset }];
    onChangeStops(newStops);
    onSelectIdx(newStops.length - 1);
  }

  function startDrag(e, idx) {
    e.stopPropagation();
    e.preventDefault();
    onSelectIdx(idx);
    const move = ev => onChangeStops(stops.map((s, i) => i === idx ? { ...s, offset: getOffset(ev.clientX) } : s));
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  return (
    <div className="gsb">
      <div className="gsb__bar-area" ref={barRef} onClick={handleBarClick}>
        <div className="gsb__checker" />
        <div className="gsb__fill" style={{ background: barCss }} />
        {stops.map((stop, i) => (
          <div
            key={i}
            className={`gsb__handle${i === selectedIdx ? ' gsb__handle--sel' : ''}`}
            style={{ left: `${stop.offset}%`, backgroundColor: stop.color ?? '#000000' }}
            onMouseDown={e => startDrag(e, i)}
            onClick={e => { e.stopPropagation(); onSelectIdx(i); }}
            title={`${stop.color ?? '#000'} @ ${stop.offset}%`}
          />
        ))}
      </div>
      <div className="gsb__hint">Clic en la barra para añadir un stop · Arrastra un stop para moverlo</div>
    </div>
  );
}

// ── Deferred color input (avoids re-render on every drag tick) ───────────────

function DeferredColor({ value, onCommit, className }) {
  const ref = useRef(null);
  const latestRef = useRef(value);
  useEffect(() => {
    latestRef.current = value;
    if (ref.current) ref.current.value = value;
  }, [value]);
  return (
    <input
      ref={ref}
      type="color"
      className={className}
      defaultValue={value}
      onChange={e => { latestRef.current = e.target.value; }}
      onBlur={() => { if (latestRef.current !== value) onCommit(latestRef.current); }}
    />
  );
}

// ── Variable type case row ────────────────────────────────────────────────────

function CaseRow({ caseItem, type, onChange, onRemove, fillStyles, onAddFillStyle, onNavigateFillStyle }) {
  function set(changes) { onChange({ ...caseItem, ...changes }); }

  const isInterval  = type === 'select-by-interval';
  const isCondition = type === 'select-by-condition';
  const isText      = type === 'select-by-text';
  const isInteger   = type === 'select-by-integer';

  return (
    <div className="fse__case">
      <div className="fse__case-header">
        {isCondition && (
          <>
            <select className="fse__case-op" value={caseItem.condition ?? 'eq'} onChange={e => set({ condition: e.target.value })}>
              {CONDITION_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input className="fse__case-val" type="text" placeholder="valor"
              value={caseItem.value ?? ''} onChange={e => set({ value: e.target.value })} />
          </>
        )}
        {isText && (
          <input className="fse__case-val fse__case-val--full" type="text" placeholder="texto exacto"
            value={caseItem.value ?? ''} onChange={e => set({ value: e.target.value })} />
        )}
        {isInteger && (
          <input className="fse__case-val" type="number" placeholder="entero"
            value={caseItem.value ?? ''} onChange={e => set({ value: parseInt(e.target.value) || 0 })} />
        )}
        {isInterval && (
          <>
            <input className="fse__case-val" type="number" placeholder="inicio"
              value={caseItem.begin ?? ''} onChange={e => set({ begin: Number(e.target.value) })} />
            <span className="fse__case-sep">–</span>
            <input className="fse__case-val" type="number" placeholder="fin"
              value={caseItem.end ?? ''} onChange={e => set({ end: Number(e.target.value) })} />
          </>
        )}
        <button className="fse__case-del" onClick={onRemove} title="Eliminar caso"><Trash2 size={11} /></button>
      </div>
      <div className="fse__case-fill">
        <span className="fse__case-fill-label">→ Fill:</span>
        <FillStyleSelector
          fillStyleId={caseItem.fillStyleId ?? null}
          fillStyles={fillStyles}
          onSelect={id => set({ fillStyleId: id })}
          onNavigate={onNavigateFillStyle}
          onAddFillStyle={onAddFillStyle}
          allowNone={false}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FillStyleEditor({ style, onChange, fillStyles = [], onAddFillStyle, onNavigateFillStyle, images = [], onAddImageAsset, onNavigateImageAsset, colors = [], onNavigateColor }) {
  const [selectedStopIdx, setSelectedStopIdx] = useState(null);
  if (!style) return null;

  function set(changes) { onChange({ ...style, ...changes }); }
  function setGrad(changes) {
    onChange({ ...style, gradient: { ...(style.gradient ?? {}), ...changes } });
  }

  const stops = style.gradient?.stops ?? [];
  const selectedStop = selectedStopIdx !== null && selectedStopIdx < stops.length
    ? stops[selectedStopIdx] : null;
  const canRemoveStop = stops.length > 2;

  function updateStop(idx, changes) {
    setGrad({ stops: stops.map((s, i) => i === idx ? { ...s, ...changes } : s) });
  }

  function addStop() {
    const newStops = [...stops, { color: '#888888', opacity: 1, offset: 50 }];
    setGrad({ stops: newStops });
    setSelectedStopIdx(newStops.length - 1);
  }

  function removeStop(idx) {
    if (!canRemoveStop) return;
    const newStops = stops.filter((_, i) => i !== idx);
    setGrad({ stops: newStops });
    setSelectedStopIdx(prev => prev > 0 ? prev - 1 : 0);
  }

  function addCase() {
    const newCase = { id: `fscase_${Math.random().toString(36).slice(2,8)}`, fillStyleId: null };
    if (style.type === 'select-by-condition') newCase.condition = 'eq';
    if (style.type === 'select-by-interval') { newCase.begin = 0; newCase.end = 100; }
    set({ cases: [...(style.cases ?? []), newCase] });
  }

  function updateCase(i, updated) {
    set({ cases: (style.cases ?? []).map((c, idx) => idx === i ? updated : c) });
  }

  function removeCase(i) {
    set({ cases: (style.cases ?? []).filter((_, idx) => idx !== i) });
  }

  const isVariable = ['select-by-condition','select-by-text','select-by-integer','select-by-interval'].includes(style.type);
  const gradType = style.gradient?.type ?? 'linear';

  return (
    <div className="fse">
      {/* ── Type ── */}
      <div className="fse__row">
        <label className="fse__label">Tipo</label>
        <select className="fse__select" value={style.type ?? 'solid'}
          onChange={e => { set({ type: e.target.value }); setSelectedStopIdx(null); }}>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── None ── */}
      {style.type === 'none' && (
        <p className="fse__none-hint">Sin relleno (transparente)</p>
      )}

      {/* ── Solid ── */}
      {style.type === 'solid' && (
        <>
          {/* Color from library */}
          <div className="fse__row">
            <label className="fse__label">Color</label>
            <ColorDropdown
              colorId={style.colorId ?? null}
              colors={colors}
              onSelect={id => {
                if (!id) {
                  set({ colorId: null });
                } else {
                  const col = colors.find(c => c.id === id);
                  set({ colorId: id, color: col?.hex ?? style.color ?? '#000000' });
                }
              }}
              onNavigate={onNavigateColor}
            />
          </div>

          {/* Custom hex (shown only when no color linked, or always for reference) */}
          {!style.colorId && (
            <>
              <div className="fse__row">
                <label className="fse__label" style={{ fontSize: 10 }}>Personalizado</label>
                <DeferredColor className="fse__color"
                  value={style.color ?? '#000000'}
                  onCommit={c => set({ color: c })} />
                <input type="text" className="fse__hex"
                  value={style.color ?? '#000000'} maxLength={7}
                  onChange={e => set({ color: e.target.value })} />
              </div>
              <CmykInputs hex={style.color ?? '#000000'} onCommit={c => set({ color: c })} />
            </>
          )}

          <div className="fse__row">
            <label className="fse__label">Opacidad</label>
            <input type="range" className="fse__slider" min={0} max={1} step={0.01}
              value={style.opacity ?? 1}
              onChange={e => set({ opacity: Number(e.target.value) })} />
            <span className="fse__val">{Math.round((style.opacity ?? 1) * 100)}%</span>
          </div>
          <div className="fse__preview-row">
            <div className="fse__solid-preview"
              style={{ background: style.color ?? '#000000', opacity: style.opacity ?? 1 }} />
          </div>
        </>
      )}

      {/* ── Gradient ── */}
      {style.type === 'gradient' && (
        <>
          {/* Preview */}
          <div className="fse__grad-preview" style={{ background: buildGradientCss(style.gradient) }} />

          {/* Sub-type: Linear / Radial / Rectangle */}
          <div className="fse__row">
            <label className="fse__label">Forma</label>
            <div className="fse__grad-types">
              {[
                { key: 'linear',    label: 'Lineal'      },
                { key: 'radial',    label: 'Radial'      },
                { key: 'rectangle', label: 'Rectángulo'  },
              ].map(t => (
                <button
                  key={t.key}
                  className={`fse__gtbtn${gradType === t.key ? ' fse__gtbtn--active' : ''}`}
                  onClick={() => setGrad({ type: t.key })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Direction presets (linear only) */}
          {gradType === 'linear' && (
            <div className="fse__dir-row">
              <label className="fse__label">Ángulo</label>
              <div className="fse__dir-presets">
                {DIR_PRESETS.map(d => (
                  <button
                    key={d.angle}
                    className={`fse__dir-btn${(style.gradient?.angle ?? 0) === d.angle ? ' fse__dir-btn--on' : ''}`}
                    title={d.title}
                    onClick={() => setGrad({ angle: d.angle })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <input type="number" className="fse__num" min={0} max={359}
                value={style.gradient?.angle ?? 0}
                onChange={e => setGrad({ angle: ((Number(e.target.value) % 360) + 360) % 360 })} />
              <span className="fse__unit">°</span>
            </div>
          )}

          {/* Center point (radial + rectangle) */}
          {(gradType === 'radial' || gradType === 'rectangle') && (
            <div className="fse__row">
              <label className="fse__label">Centro</label>
              <span className="fse__axis-lbl">X</span>
              <input type="number" className="fse__num" min={0} max={100}
                value={style.gradient?.cx ?? 50}
                onChange={e => setGrad({ cx: Number(e.target.value) })} />
              <span className="fse__unit">%</span>
              <span className="fse__axis-lbl">Y</span>
              <input type="number" className="fse__num" min={0} max={100}
                value={style.gradient?.cy ?? 50}
                onChange={e => setGrad({ cy: Number(e.target.value) })} />
              <span className="fse__unit">%</span>
            </div>
          )}

          {/* Interactive gradient bar */}
          <GradientBar
            stops={stops}
            onChangeStops={newStops => setGrad({ stops: newStops })}
            selectedIdx={selectedStopIdx}
            onSelectIdx={setSelectedStopIdx}
          />

          {/* Selected stop editor */}
          {selectedStop ? (
            <div className="fse__stop-panel">
              <div className="fse__row">
                <label className="fse__label">Color</label>
                <DeferredColor className="fse__color"
                  value={selectedStop.color ?? '#000000'}
                  onCommit={c => updateStop(selectedStopIdx, { color: c })} />
                <input type="text" className="fse__hex"
                  value={selectedStop.color ?? '#000000'} maxLength={7}
                  onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) updateStop(selectedStopIdx, { color: e.target.value }); }} />
              </div>
              <CmykInputs
                hex={selectedStop.color ?? '#000000'}
                onCommit={c => updateStop(selectedStopIdx, { color: c })}
              />
              <div className="fse__row">
                <label className="fse__label">Posición</label>
                <input type="range" className="fse__slider" min={0} max={100}
                  value={selectedStop.offset ?? 0}
                  onChange={e => updateStop(selectedStopIdx, { offset: Number(e.target.value) })} />
                <input type="number" className="fse__num" min={0} max={100}
                  value={selectedStop.offset ?? 0}
                  onChange={e => updateStop(selectedStopIdx, { offset: Number(e.target.value) })} />
                <span className="fse__unit">%</span>
              </div>
              <div className="fse__row">
                <label className="fse__label">Opacidad</label>
                <input type="range" className="fse__slider" min={0} max={1} step={0.01}
                  value={selectedStop.opacity ?? 1}
                  onChange={e => updateStop(selectedStopIdx, { opacity: Number(e.target.value) })} />
                <span className="fse__val">{Math.round((selectedStop.opacity ?? 1) * 100)}%</span>
              </div>
              <div className="fse__stop-panel-footer">
                <button className="fse__add-stop" onClick={addStop}>
                  <Plus size={11} /> Añadir stop
                </button>
                <button className="fse__stop-del-btn" disabled={!canRemoveStop}
                  onClick={() => removeStop(selectedStopIdx)}>
                  <Trash2 size={11} /> Eliminar
                </button>
              </div>
            </div>
          ) : (
            <div className="fse__stop-hint-row">
              <span>Selecciona un stop para editarlo.</span>
              <button className="fse__add-stop" onClick={addStop}>
                <Plus size={11} /> Añadir stop
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Image ── */}
      {style.type === 'image' && (
        <>
          <div className="fse__row">
            <label className="fse__label">Imagen</label>
            <select
              className="fse__select"
              style={{ flex: 1 }}
              value={style.imageId ?? ''}
              onChange={e => set({ imageId: e.target.value || null })}
            >
              <option value="">(Seleccionar imagen…)</option>
              {images.map(img => (
                <option key={img.id} value={img.id}>{img.name ?? img.id}</option>
              ))}
            </select>
            {onAddImageAsset && (
              <button
                className="fse__add-stop"
                style={{ marginLeft: 4, flexShrink: 0 }}
                onClick={() => { const id = onAddImageAsset(); if (id && onNavigateImageAsset) onNavigateImageAsset(id); }}
                title="Nueva imagen"
              >
                <Plus size={11} />
              </button>
            )}
            {style.imageId && onNavigateImageAsset && (
              <button
                className="fse__add-stop"
                style={{ marginLeft: 2, flexShrink: 0 }}
                onClick={() => onNavigateImageAsset(style.imageId)}
                title="Editar imagen"
              >
                ✎
              </button>
            )}
          </div>

          {/* Image options */}
          <div className="fse__row">
            <label className="fse__label">Autoajuste</label>
            <select className="fse__select" style={{ flex: 1 }}
              value={style.autofit !== false ? 'yes' : 'no'}
              onChange={e => set({ autofit: e.target.value === 'yes' })}>
              <option value="yes">Sí (cover)</option>
              <option value="no">No</option>
            </select>
          </div>

          {style.autofit === false && (
            <>
              <div className="fse__row">
                <label className="fse__label">Mosaico</label>
                <select className="fse__select" style={{ flex: 1 }}
                  value={style.tile ? 'yes' : 'no'}
                  onChange={e => set({ tile: e.target.value === 'yes' })}>
                  <option value="no">No</option>
                  <option value="yes">Sí</option>
                </select>
              </div>
              {!style.tile && (
                <>
                  <div className="fse__row">
                    <label className="fse__label">Escala X</label>
                    <input type="number" className="fse__num" min={0.01} max={10} step={0.05}
                      value={style.scaleX ?? 1}
                      onChange={e => set({ scaleX: Number(e.target.value) })} />
                    <label className="fse__label" style={{ marginLeft: 8 }}>Y</label>
                    <input type="number" className="fse__num" min={0.01} max={10} step={0.05}
                      value={style.scaleY ?? 1}
                      onChange={e => set({ scaleY: Number(e.target.value) })} />
                  </div>
                  <div className="fse__row">
                    <label className="fse__label">Offset X</label>
                    <input type="number" className="fse__num" step={0.5}
                      value={style.offsetX ?? 0}
                      onChange={e => set({ offsetX: Number(e.target.value) })} />
                    <span className="fse__unit">mm</span>
                    <label className="fse__label" style={{ marginLeft: 8 }}>Y</label>
                    <input type="number" className="fse__num" step={0.5}
                      value={style.offsetY ?? 0}
                      onChange={e => set({ offsetY: Number(e.target.value) })} />
                    <span className="fse__unit">mm</span>
                  </div>
                </>
              )}
            </>
          )}

          <div className="fse__row">
            <label className="fse__label">Rotación</label>
            <input type="number" className="fse__num" min={0} max={360} step={1}
              value={style.rotation ?? 0}
              onChange={e => set({ rotation: Number(e.target.value) })} />
            <span className="fse__unit">°</span>
          </div>
          <div className="fse__row">
            <label className="fse__label">Voltear</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input type="checkbox" checked={style.flipX ?? false}
                onChange={e => set({ flipX: e.target.checked })} /> Horizontal
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginLeft: 10 }}>
              <input type="checkbox" checked={style.flipY ?? false}
                onChange={e => set({ flipY: e.target.checked })} /> Vertical
            </label>
          </div>
        </>
      )}

      {/* ── Variable types ── */}
      {isVariable && (
        <>
          <div className="fse__row">
            <label className="fse__label">Variable</label>
            <input type="text" className="fse__hex" placeholder="campo.ruta"
              value={style.variable ?? ''} onChange={e => set({ variable: e.target.value })} />
          </div>

          <div className="fse__stops-header">
            <span className="fse__label">Casos</span>
            <button className="fse__add-stop" onClick={addCase} title="Agregar caso">
              <Plus size={11} /> Añadir
            </button>
          </div>

          <div className="fse__cases">
            {(style.cases ?? []).length === 0 && (
              <p className="fse__none-hint">Sin casos. Pulsa "Añadir" para agregar uno.</p>
            )}
            {(style.cases ?? []).map((c, i) => (
              <CaseRow key={c.id ?? i} caseItem={c} type={style.type}
                onChange={upd => updateCase(i, upd)} onRemove={() => removeCase(i)}
                fillStyles={fillStyles} onAddFillStyle={onAddFillStyle}
                onNavigateFillStyle={onNavigateFillStyle} />
            ))}
          </div>

          <div className="fse__row" style={{ marginTop: 8 }}>
            <label className="fse__label">Por defecto</label>
          </div>
          <div className="fse__default-fill">
            <FillStyleSelector
              fillStyleId={style.defaultFillStyleId ?? null}
              fillStyles={fillStyles}
              onSelect={id => set({ defaultFillStyleId: id })}
              onNavigate={onNavigateFillStyle}
              onAddFillStyle={onAddFillStyle}
            />
          </div>
        </>
      )}
    </div>
  );
}
