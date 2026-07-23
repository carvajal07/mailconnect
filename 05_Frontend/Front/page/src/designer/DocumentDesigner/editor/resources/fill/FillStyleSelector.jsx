// editor/resources/FillStyleSelector.jsx
// Trigger compacto (swatch) + popup flotante con fill styles + color picker + eyedropper.

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Plus, X, Pipette } from 'lucide-react';
import { CmykInputs } from '../colorUtils.jsx';
import './FillStyleSelector.css';

// ── Swatch helper (reutilizable externamente) ─────────────────────────────────

export function FillSwatch({ style, size = 14, className = '' }) {
  const base = { width: size, height: size, display: 'inline-block', borderRadius: 3, flexShrink: 0 };
  if (!style || style.type === 'none') {
    return <span className={`fss-swatch--none ${className}`} style={base} />;
  }
  if (style.type === 'solid') {
    return <span className={className} style={{ ...base, background: style.color ?? '#000', opacity: style.opacity ?? 1, border: '1px solid rgba(0,0,0,0.15)' }} />;
  }
  if (style.type === 'gradient' && style.gradient?.stops?.length) {
    const sorted = [...style.gradient.stops].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
    const stops  = sorted.map(s => `${s.color ?? '#000'} ${s.offset ?? 0}%`).join(', ');
    const gt = style.gradient.type;
    const cx = style.gradient.cx ?? 50;
    const cy = style.gradient.cy ?? 50;
    const grad = gt === 'radial'
      ? `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`
      : gt === 'rectangle'
      ? `radial-gradient(farthest-corner at ${cx}% ${cy}%, ${stops})`
      : `linear-gradient(${style.gradient.angle ?? 0}deg, ${stops})`;
    return <span className={className} style={{ ...base, background: grad, border: '1px solid rgba(0,0,0,0.15)' }} />;
  }
  return <span className={`fss-swatch--none ${className}`} style={base} />;
}

// ── Eyedropper helper ─────────────────────────────────────────────────────────

function useEyeDropper() {
  const supported = typeof window !== 'undefined' && 'EyeDropper' in window;
  async function pick() {
    if (!supported) return null;
    try {
      const dropper = new window.EyeDropper();
      const { sRGBHex } = await dropper.open();
      return sRGBHex;
    } catch {
      return null;
    }
  }
  return { supported, pick };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FillStyleSelector({
  fillStyleId,          // id asignado actualmente (o null)
  fillStyles = [],      // todos los fill styles del template
  onSelect,             // (id | null) → void
  onNavigate,           // (id) → void — ir al panel
  onAddFillStyle,       // (initialProps?) → id
  allowNone = true,
  // Modo de visualización del trigger
  compact = false,      // true = solo swatch sin texto
  label,                // texto junto al swatch (cuando compact=false)
  // Color inline actual (para pre-poblar el picker si no hay fill style)
  fallbackColor = '#000000',
  fallbackOpacity = 1,
  showOpacity = true,
}) {
  const currentStyle = fillStyleId ? (fillStyles.find(s => s.id === fillStyleId) ?? null) : null;

  const [open, setOpen]         = useState(false);
  const [pos, setPos]           = useState(null);
  const [pickColor, setPickColor] = useState(currentStyle?.color ?? fallbackColor ?? '#000000');
  const [pickOpacity, setPickOpacity] = useState(currentStyle?.opacity ?? fallbackOpacity ?? 1);
  const triggerRef = useRef(null);
  const popupRef   = useRef(null);
  const { supported: eyeDropperSupported, pick: pickFromScreen } = useEyeDropper();

  // Sync picker with current style when it changes
  useEffect(() => {
    if (currentStyle?.type === 'solid') {
      setPickColor(currentStyle.color ?? '#000000');
      setPickOpacity(currentStyle.opacity ?? 1);
    }
  }, [currentStyle]);

  const openPopup = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vpW  = window.innerWidth;
    const vpH  = window.innerHeight;
    const popW = 260;
    const popH = 340; // estimate
    let left = rect.left;
    let top  = rect.bottom + 6;
    if (left + popW > vpW - 8) left = vpW - popW - 8;
    if (top  + popH > vpH - 8) top  = rect.top - popH - 6;
    setPos({ top, left });
    setOpen(true);
  }, []);

  const closePopup = useCallback(() => { setOpen(false); setPos(null); }, []);

  // Valores vivos para el handler de clic-afuera (evita closures stale sin tener
  // que re-registrar el listener en cada cambio de color).
  const liveRef = useRef({});
  useEffect(() => {
    liveRef.current = { pickColor, pickOpacity, currentStyle, fillStyles, onAddFillStyle, onSelect };
  });

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (popupRef.current?.contains(e.target)) return;
      // Commitear el color personalizado pendiente ANTES de cerrar: si no, el
      // closePopup desmonta el popup antes de que el onBlur del input aplique y
      // el color elegido se pierde (quedaba aplicado el anterior).
      const { pickColor: c, pickOpacity: op, currentStyle: cs, fillStyles: fs, onAddFillStyle: add, onSelect: sel } = liveRef.current;
      const cur = cs?.type === 'solid' ? cs.color : null;
      if (add && /^#[0-9a-fA-F]{6}$/.test(c) && (c !== cur || Math.abs(op - (cs?.opacity ?? 1)) > 0.01)) {
        const existing = (fs ?? []).find(s => s.type === 'solid' && s.color === c && Math.abs((s.opacity ?? 1) - op) < 0.01);
        const id = existing ? existing.id : add({ type: 'solid', color: c, opacity: op });
        if (id) sel?.(id);
      }
      closePopup();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, closePopup]);

  useEffect(() => {
    if (!open) return;
    function onScroll() { closePopup(); }
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open, closePopup]);

  function applyColor(color) {
    if (!onAddFillStyle) return;
    const opacity = pickOpacity;
    const existing = fillStyles.find(s => s.type === 'solid' && s.color === color && Math.abs((s.opacity ?? 1) - opacity) < 0.01);
    const id = existing ? existing.id : onAddFillStyle({ type: 'solid', color, opacity });
    if (id) onSelect(id);
  }

  function toggle() { open ? closePopup() : openPopup(); }

  function handleSelectExisting(id) {
    onSelect(id);
    closePopup();
  }

  function handleCreateNew() {
    if (!onAddFillStyle) return;
    const id = onAddFillStyle();
    if (id) { onSelect(id); onNavigate?.(id); }
    closePopup();
  }

  function handleClear() { onSelect(null); closePopup(); }

  async function handleEyeDropper() {
    const hex = await pickFromScreen();
    if (hex) setPickColor(hex);
  }

  // ── Trigger appearance ──────────────────────────────────────────────────────
  // Swatch color: current fill style → its color; or fallback inline color
  const swatchStyle = currentStyle ?? (fallbackColor ? { type: 'solid', color: fallbackColor, opacity: fallbackOpacity } : null);

  // ── Popup ───────────────────────────────────────────────────────────────────
  const popup = open && pos && createPortal(
    <div ref={popupRef} className="fss-popup" style={{ top: pos.top, left: pos.left }}>

      {/* ── Fill Styles grid ── */}
      {fillStyles.length > 0 && (
        <>
          <div className="fss-popup__section-label">
            Fill Styles
            <span className="fss-popup__count">{fillStyles.length}</span>
          </div>
          <div className="fss-popup__swatches">
            {fillStyles.map(fs => (
              <button
                key={fs.id}
                className={`fss-popup__swatch-btn${fs.id === fillStyleId ? ' fss-popup__swatch-btn--active' : ''}`}
                title={fs.name}
                onClick={() => handleSelectExisting(fs.id)}
              >
                <FillSwatch style={fs} size={20} />
                {fs.id === fillStyleId && onNavigate && (
                  <span
                    className="fss-popup__swatch-nav"
                    onClick={e => { e.stopPropagation(); onNavigate(fs.id); closePopup(); }}
                    title="Ir al Fill Style"
                  >
                    <ExternalLink size={8} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="fss-popup__sep" />
        </>
      )}

      {fillStyles.length === 0 && (
        <p className="fss-popup__empty-hint">Sin fill styles creados aún.</p>
      )}

      {/* ── Color picker ── */}
      {onAddFillStyle && (
        <>
          <div className="fss-popup__section-label">Color personalizado</div>
          <div className="fss-popup__color-row">
            <div className="fss-popup__color-preview" style={{ background: pickColor, opacity: pickOpacity }} />
            <input
              type="color"
              className="fss-popup__color-native"
              value={pickColor}
              onChange={e => setPickColor(e.target.value)}
              onBlur={e => { applyColor(e.target.value); closePopup(); }}
              title="Abrir selector de color"
            />
            <input
              type="text"
              className="fss-popup__color-hex"
              value={pickColor}
              maxLength={7}
              onChange={e => {
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
                  setPickColor(v);
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) applyColor(v);
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(pickColor)) { applyColor(pickColor); closePopup(); } }}
              placeholder="#000000"
            />
            {eyeDropperSupported && (
              <button className="fss-popup__eyedropper" onClick={handleEyeDropper} title="Seleccionar color de la pantalla">
                <Pipette size={13} />
              </button>
            )}
          </div>
          <CmykInputs hex={pickColor} onCommit={c => { setPickColor(c); applyColor(c); }} />

          {showOpacity && (
            <div className="fss-popup__opacity-row">
              <span className="fss-popup__opacity-label">Opacidad</span>
              <input
                type="range"
                className="fss-popup__opacity-slider"
                min={0} max={1} step={0.01}
                value={pickOpacity}
                onChange={e => setPickOpacity(Number(e.target.value))}
              />
              <span className="fss-popup__opacity-val">{Math.round(pickOpacity * 100)}%</span>
            </div>
          )}

          <div className="fss-popup__sep" />
        </>
      )}

      {/* ── Footer actions ── */}
      <div className="fss-popup__footer">
        {onAddFillStyle && (
          <button className="fss-popup__btn fss-popup__btn--secondary" onClick={handleCreateNew}>
            <Plus size={10} /> Nuevo FS
          </button>
        )}
        {allowNone && currentStyle && (
          <button className="fss-popup__btn fss-popup__btn--danger" onClick={handleClear}>
            <X size={10} />
          </button>
        )}
      </div>
    </div>,
    document.body
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (compact) {
    // Compact mode: just the swatch button
    return (
      <span className="fss-compact" ref={triggerRef}>
        <button
          className={`fss-compact__btn${open ? ' fss-compact__btn--open' : ''}`}
          onClick={toggle}
          title={currentStyle?.name ?? (fallbackColor ?? 'Sin color')}
        >
          <FillSwatch style={swatchStyle} size={18} />
        </button>
        {popup}
      </span>
    );
  }

  // Expanded mode: swatch + name/label + nav button
  const displayLabel = label ?? currentStyle?.name ?? null;
  return (
    <span className="fss-expanded" ref={triggerRef}>
      <button
        className={`fss-expanded__trigger${open ? ' fss-expanded__trigger--open' : ''}`}
        onClick={toggle}
      >
        <FillSwatch style={swatchStyle} size={16} />
        <span className="fss-expanded__label">{displayLabel ?? <em className="fss-expanded__placeholder">Sin fill style</em>}</span>
      </button>
      {currentStyle && onNavigate && (
        <button className="fss-expanded__nav" title="Ir al Fill Style" onClick={() => onNavigate(fillStyleId)}>
          <ExternalLink size={11} />
        </button>
      )}
      {currentStyle && allowNone && (
        <button className="fss-expanded__clear" title="Quitar" onClick={handleClear}>
          <X size={11} />
        </button>
      )}
      {popup}
    </span>
  );
}
