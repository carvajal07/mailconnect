// editor/resources/color/ColorEditor.jsx — Editor de una entidad Color

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Pipette, X } from 'lucide-react';
import { hexToCmyk, cmykToHex } from '../colorUtils.jsx';
import { hexToRgb, rgbToHex } from '../../../engine/colorUtils.js';
import './ColorEditor.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: 'simple',            label: 'Simple'                   },
  { value: 'select-by-content', label: 'Variable (por contenido)' },
];

const SEL_TYPES = [
  { v: 'condition', label: 'Condición', hint: 'Expresión JS'  },
  { v: 'text',      label: 'Texto',     hint: 'Valor texto'   },
  { v: 'number',    label: 'Número',    hint: 'Valor número'  },
  { v: 'bool',      label: 'Bool',      hint: 'Verdad/Falso'  },
  { v: 'script',    label: 'Script',    hint: 'JS avanzado'   },
];

const SYSTEM_FIELDS = [
  '$item', '$index', '$pageNumber', '$totalPages',
  '$date', '$datetime', '$documentName', '$overflow',
];

// ── Color math helpers ────────────────────────────────────────────────────────

function hsbToHex(h, s, b) {
  const sn = s / 100, bn = b / 100;
  const i  = Math.floor(h / 60) % 6;
  const f  = h / 60 - Math.floor(h / 60);
  const p  = bn * (1 - sn), q = bn * (1 - f * sn), t = bn * (1 - (1 - f) * sn);
  const [r, g, bv] = [[bn,t,p],[q,bn,p],[p,bn,t],[p,q,bn],[t,p,bn],[bn,p,q]][i];
  return rgbToHex(Math.round(r * 255), Math.round(g * 255), Math.round(bv * 255));
}

function hexToHsb(hex) {
  const { r, g, b } = hexToRgb(hex ?? '#000000');
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const brightness = max * 100;
  const saturation = max === 0 ? 0 : ((max - min) / max) * 100;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case rn: hue = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60; break;
      case gn: hue = ((bn - rn) / d + 2) * 60; break;
      default: hue = ((rn - gn) / d + 4) * 60;
    }
  }
  return { h: Math.round(hue), s: Math.round(saturation), b: Math.round(brightness) };
}

// ── EyeDropper hook ───────────────────────────────────────────────────────────

function useEyeDropper() {
  const supported = typeof window !== 'undefined' && 'EyeDropper' in window;
  async function pick() {
    if (!supported) return null;
    try {
      const dropper = new window.EyeDropper();
      const { sRGBHex } = await dropper.open();
      return sRGBHex;
    } catch { return null; }
  }
  return { supported, pick };
}

// ── ColorPickerCanvas ─────────────────────────────────────────────────────────

function ColorPickerCanvas({ hue, saturation, brightness, onChange }) {
  const canvasRef = useRef(null);
  const dragging  = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const hGrad = ctx.createLinearGradient(0, 0, width, 0);
    hGrad.addColorStop(0, `hsl(${hue},0%,100%)`);
    hGrad.addColorStop(1, `hsl(${hue},100%,50%)`);
    ctx.fillStyle = hGrad;
    ctx.fillRect(0, 0, width, height);
    const vGrad = ctx.createLinearGradient(0, 0, 0, height);
    vGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, width, height);
  }, [hue]);

  function getPos(e, rect) {
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      s: Math.max(0, Math.min(100, ((cx - rect.left)  / rect.width)  * 100)),
      b: Math.max(0, Math.min(100, 100 - ((cy - rect.top) / rect.height) * 100)),
    };
  }

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) { const { s, b } = getPos(e, rect); onChange(s, b); }
    }
    function onUp() { dragging.current = false; }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [onChange]);

  return (
    <div className="ce-picker__canvas-wrap"
      onMouseDown={e => { dragging.current = true; const { s, b } = getPos(e, canvasRef.current.getBoundingClientRect()); onChange(s, b); }}>
      <canvas ref={canvasRef} className="ce-picker__canvas" width={280} height={200} />
      <div className="ce-picker__cursor" style={{ left: `${saturation}%`, top: `${100 - brightness}%` }} />
    </div>
  );
}

function HueSlider({ hue, onChange }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);
  function getH(x) {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? Math.max(0, Math.min(360, ((x - rect.left) / rect.width) * 360)) : 0;
  }
  useEffect(() => {
    function onMove(e) { if (dragging.current) onChange(getH(e.clientX)); }
    function onUp()   { dragging.current = false; }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [onChange]);
  return (
    <div className="ce-picker__hue" ref={trackRef}
      onMouseDown={e => { dragging.current = true; onChange(getH(e.clientX)); }}>
      <div className="ce-picker__hue-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
    </div>
  );
}

// ── ColorPickerBody — full picker UI (reusable) ───────────────────────────────

export function ColorPickerBody({ hex: hexProp, alpha: alphaProp = 255, onChangeHex, onChangeAlpha }) {
  const [hexInput, setHexInput] = useState(hexProp ?? '#000000');
  const [hsb,      setHsb]      = useState(() => hexToHsb(hexProp ?? '#000000'));
  const suppress = useRef(false);
  const { supported: edSupported, pick: edPick } = useEyeDropper();

  useEffect(() => {
    if (suppress.current) return;
    setHexInput(hexProp ?? '#000000');
    setHsb(hexToHsb(hexProp ?? '#000000'));
  }, [hexProp]);

  function emitHex(hex) {
    suppress.current = true;
    onChangeHex(hex);
    setTimeout(() => { suppress.current = false; }, 50);
  }

  const handleCanvas = useCallback((s, b) => {
    const newHex = hsbToHex(hsb.h, s, b);
    setHsb(prev => ({ ...prev, s: Math.round(s), b: Math.round(b) }));
    setHexInput(newHex);
    emitHex(newHex);
  }, [hsb.h]);

  const handleHue = useCallback((h) => {
    const newHex = hsbToHex(h, hsb.s, hsb.b);
    setHsb(prev => ({ ...prev, h: Math.round(h) }));
    setHexInput(newHex);
    emitHex(newHex);
  }, [hsb.s, hsb.b]);

  function handleHexInput(val) {
    setHexInput(val);
    const clean = val.startsWith('#') ? val : `#${val}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) { setHsb(hexToHsb(clean)); emitHex(clean); }
  }

  function handleRgbChange(key, val) {
    const cur  = hexToRgb(hexProp ?? '#000000');
    const next = { ...cur, [key]: Math.max(0, Math.min(255, parseInt(val) || 0)) };
    const hex  = rgbToHex(next.r, next.g, next.b);
    setHexInput(hex); setHsb(hexToHsb(hex)); emitHex(hex);
  }

  function handleCmykChange(key, val) {
    const cur  = hexToCmyk(hexProp ?? '#000000');
    const next = { ...cur, [key]: Math.max(0, Math.min(100, parseInt(val) || 0)) };
    const hex  = cmykToHex(next.c, next.m, next.y, next.k);
    setHexInput(hex); setHsb(hexToHsb(hex)); emitHex(hex);
  }

  async function handleEyeDropper() {
    const picked = await edPick();
    if (picked) {
      setHexInput(picked);
      setHsb(hexToHsb(picked));
      emitHex(picked);
    }
  }

  const rgb   = hexToRgb(hexProp ?? '#000000');
  const cmyk  = hexToCmyk(hexProp ?? '#000000');
  const alpha = alphaProp ?? 255;
  const opPct = Math.round((alpha / 255) * 100);

  return (
    <div className="ce-body">
      {/* Canvas picker */}
      <div className="ce-picker">
        <ColorPickerCanvas hue={hsb.h} saturation={hsb.s} brightness={hsb.b} onChange={handleCanvas} />
        <HueSlider hue={hsb.h} onChange={handleHue} />
      </div>

      {/* Preview swatch */}
      <div className="ce-preview-row">
        <div className="ce-swatch-old" style={{ background: hexProp ?? '#000000' }} />
        <div className="ce-swatch-new" style={{ background: hexProp ?? '#000000', opacity: alpha / 255 }} />
        <span className="ce-swatch-label">Nuevo</span>
      </div>

      {/* Hex + EyeDropper */}
      <div className="ce-row">
        <label className="ce-label">HTML</label>
        <input className="ce-input ce-input--hex" value={hexInput} spellCheck={false} maxLength={7}
          onChange={e => handleHexInput(e.target.value)} />
        {edSupported && (
          <button className="ce-eyedropper" onClick={handleEyeDropper} title="Extraer color de la pantalla">
            <Pipette size={12} />
          </button>
        )}
      </div>

      {/* RGB */}
      <div className="ce-row ce-row--channels">
        <label className="ce-label">RGB</label>
        <div className="ce-channels">
          {[['r','R'],['g','G'],['b','B']].map(([k,lbl]) => (
            <div key={k} className="ce-channel">
              <input className="ce-channel__input" type="number" min={0} max={255}
                value={rgb[k]} onChange={e => handleRgbChange(k, e.target.value)} />
              <span className="ce-channel__label">{lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CMYK */}
      <div className="ce-row ce-row--channels">
        <label className="ce-label">CMYK</label>
        <div className="ce-channels">
          {[['c','C'],['m','M'],['y','Y'],['k','K']].map(([k,lbl]) => (
            <div key={k} className="ce-channel">
              <input className="ce-channel__input" type="number" min={0} max={100}
                value={cmyk[k]} onChange={e => handleCmykChange(k, e.target.value)} />
              <span className="ce-channel__label">{lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Opacity */}
      {onChangeAlpha && (
        <div className="ce-row">
          <label className="ce-label">Opacidad</label>
          <input type="range" className="ce-slider" min={0} max={255} step={1}
            value={alpha} onChange={e => onChangeAlpha(Number(e.target.value))} />
          <span className="ce-opacity-val">{opPct}%</span>
        </div>
      )}
    </div>
  );
}

// ── ColorPickerModal — centered modal overlay with full picker ────────────────

export function ColorPickerPopup({ hex, alpha = 255, onChange, showAlpha = false }) {
  const [open, setOpen] = useState(false);

  const modal = open && createPortal(
    <div className="ce-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="ce-modal">
        <div className="ce-modal__header">
          <span className="ce-modal__title">Seleccionar color</span>
          <button className="ce-modal__close" onClick={() => setOpen(false)} title="Cerrar">
            <X size={14} />
          </button>
        </div>
        <ColorPickerBody
          hex={hex}
          alpha={alpha}
          onChangeHex={newHex => onChange({ hex: newHex })}
          onChangeAlpha={showAlpha ? n => onChange({ alpha: n }) : null}
        />
        <div className="ce-modal__footer">
          <div className="ce-modal__result-swatch" style={{ background: hex ?? '#000000' }} />
          <span className="ce-modal__result-hex">{hex ?? '#000000'}</span>
          <button className="ce-modal__ok" onClick={() => setOpen(false)}>Aceptar</button>
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <span className="ce-popup-trigger">
      <button
        className={`ce-popup-swatch${open ? ' ce-popup-swatch--open' : ''}`}
        style={{ background: hex ?? '#000000', opacity: alpha / 255 }}
        onClick={() => setOpen(o => !o)}
        title={hex ?? '#000000'}
      />
      <span className="ce-popup-hex" onClick={() => setOpen(o => !o)}>
        {hex ?? '#000000'}
      </span>
      {modal}
    </span>
  );
}

// ── Variable field dropdown ───────────────────────────────────────────────────

function flattenFields(fields, result = []) {
  for (const f of fields ?? []) {
    result.push(f);
    if (f.children?.length) flattenFields(f.children, result);
  }
  return result;
}

function VariableSelect({ value, onChange, availableFields }) {
  const workflowFields = flattenFields(availableFields);
  return (
    <select className="ce-select" value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">— seleccionar variable —</option>
      {workflowFields.length > 0 && (
        <optgroup label="Campos del workflow">
          {workflowFields.map(f => (
            <option key={f.path ?? f.name} value={f.path ?? f.name}>{f.name ?? f.path}</option>
          ))}
        </optgroup>
      )}
      <optgroup label="Campos del sistema">
        {SYSTEM_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
      </optgroup>
    </select>
  );
}

// ── Case row ─────────────────────────────────────────────────────────────────

function CaseRow({ caseItem, subType, onChange, onRemove }) {
  function set(ch) { onChange({ ...caseItem, ...ch }); }
  return (
    <div className="ce-case">
      <div className="ce-case__condition">
        {subType === 'condition' && (
          <input className="ce-case__input" type="text" placeholder="expresión JS"
            value={caseItem.expr ?? ''} onChange={e => set({ expr: e.target.value })} />
        )}
        {subType === 'text' && (
          <input className="ce-case__input" type="text" placeholder="texto exacto"
            value={caseItem.value ?? ''} onChange={e => set({ value: e.target.value })} />
        )}
        {subType === 'number' && (
          <input className="ce-case__input" type="number" placeholder="número"
            value={caseItem.value ?? ''} onChange={e => set({ value: Number(e.target.value) })} />
        )}
        {subType === 'bool' && (
          <select className="ce-case__select"
            value={String(caseItem.value ?? 'true')} onChange={e => set({ value: e.target.value === 'true' })}>
            <option value="true">Verdadero</option>
            <option value="false">Falso</option>
          </select>
        )}
      </div>
      <span className="ce-case__arrow">→</span>
      <ColorPickerPopup
        hex={caseItem.hex ?? '#ffffff'}
        onChange={({ hex }) => set({ hex })}
      />
      <button className="ce-case__del" onClick={onRemove} title="Eliminar"><Trash2 size={10} /></button>
    </div>
  );
}

// ── Main ColorEditor ──────────────────────────────────────────────────────────

export default function ColorEditor({ color, onChange, availableFields = [] }) {
  const subType = color.subType ?? 'condition';

  function addCase() {
    const newCase = { id: `cc_${Math.random().toString(36).slice(2,7)}`, hex: '#ffffff' };
    if (subType === 'condition') newCase.expr = '';
    else if (subType === 'number') newCase.value = 0;
    else if (subType === 'bool')   newCase.value = true;
    else newCase.value = '';
    onChange({ cases: [...(color.cases ?? []), newCase] });
  }

  function updateCase(i, upd) {
    onChange({ cases: (color.cases ?? []).map((c, idx) => idx === i ? upd : c) });
  }

  function removeCase(i) {
    onChange({ cases: (color.cases ?? []).filter((_, idx) => idx !== i) });
  }

  return (
    <div className="ce">

      {/* Type selector */}
      <div className="ce-row">
        <label className="ce-label">Tipo</label>
        <select className="ce-select" value={color.type ?? 'simple'}
          onChange={e => onChange({ type: e.target.value })}>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── SIMPLE: inline full picker ─────────────────────────────────────── */}
      {(color.type === 'simple' || !color.type) && (
        <ColorPickerBody
          hex={color.hex ?? '#000000'}
          alpha={color.alpha ?? 255}
          onChangeHex={hex => onChange({ hex })}
          onChangeAlpha={alpha => onChange({ alpha })}
        />
      )}

      {/* ── VARIABLE / SELECT-BY-CONTENT ─────────────────────────────────── */}
      {color.type === 'select-by-content' && (
        <>
          {/* Sub-type buttons */}
          <div className="ce-section-label">TIPO DE SELECCIÓN</div>
          <div className="ce-sel-types">
            {SEL_TYPES.map(st => (
              <button key={st.v}
                className={`ce-sel-type-btn${subType === st.v ? ' ce-sel-type-btn--active' : ''}`}
                onClick={() => onChange({ subType: st.v, cases: [] })}>
                <span className="ce-sel-type-btn__label">{st.label}</span>
                <span className="ce-sel-type-btn__hint">{st.hint}</span>
              </button>
            ))}
          </div>

          {/* Script */}
          {subType === 'script' && (
            <div style={{ marginTop: 8 }}>
              <div className="ce-section-label">SCRIPT (retorna hex)</div>
              <textarea className="ce-script" rows={6}
                placeholder={'// Retorna un color hex\n// Ej: return data.active ? "#00ff00" : "#ff0000";'}
                value={color.script ?? ''} onChange={e => onChange({ script: e.target.value })} />
            </div>
          )}

          {/* Condition / Text / Number / Bool */}
          {subType !== 'script' && (
            <>
              <div className="ce-row" style={{ marginTop: 8 }}>
                <label className="ce-label">Variable</label>
                <VariableSelect value={color.variable ?? ''} onChange={v => onChange({ variable: v })} availableFields={availableFields} />
              </div>

              <div className="ce-section-label" style={{ marginTop: 8 }}>REGLAS DE CONDICIÓN</div>

              {/* Default */}
              <div className="ce-default-row">
                <span className="ce-default-label">Default</span>
                <ColorPickerPopup
                  hex={color.defaultHex ?? '#000000'}
                  onChange={({ hex }) => onChange({ defaultHex: hex })}
                />
              </div>

              {/* Cases */}
              {(color.cases ?? []).map((c, i) => (
                <CaseRow key={c.id ?? i} caseItem={c} subType={subType}
                  onChange={upd => updateCase(i, upd)} onRemove={() => removeCase(i)} />
              ))}

              <button className="ce-add-rule" onClick={addCase}>
                <Plus size={11} /> Añadir regla
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
