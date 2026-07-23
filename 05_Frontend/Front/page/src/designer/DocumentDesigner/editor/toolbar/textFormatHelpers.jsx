// textFormatHelpers.jsx — constants and sub-components extracted from TextFormatToolbar.jsx
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom';
import { CmykInputs } from '../resources/colorUtils.jsx';
import {
  Link2, Unlink, X, Plus,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  CaseUpper, CaseLower, CaseSensitive,
  ChevronDown, ChevronUp,
} from 'lucide-react';

// ── Font catalog ────────────────────────────────────────────────────────────
export const FONT_FAMILIES = [
  'Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia',
  'Courier New', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Roboto',
  'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito',
];

export const FONT_WEIGHTS = [
  { value: 'Thin',       label: 'Thin' },
  { value: 'Light',      label: 'Light' },
  { value: 'Regular',    label: 'Regular' },
  { value: 'Medium',     label: 'Medium' },
  { value: 'SemiBold',   label: 'SemiBold' },
  { value: 'Bold',       label: 'Bold' },
  { value: 'ExtraBold',  label: 'ExtraBold' },
];

export const ALIGNMENTS = [
  { value: 'left',    Icon: AlignLeft,    label: 'Izquierda' },
  { value: 'center',  Icon: AlignCenter,  label: 'Centrar' },
  { value: 'right',   Icon: AlignRight,   label: 'Derecha' },
  { value: 'justify', Icon: AlignJustify, label: 'Justificar' },
];

export const V_ALIGNMENTS = [
  { value: 'top',    Icon: AlignStartVertical,  label: 'Arriba' },
  { value: 'middle', Icon: AlignCenterVertical,  label: 'Centro' },
  { value: 'bottom', Icon: AlignEndVertical,     label: 'Abajo' },
];

export const TEXT_TRANSFORMS = [
  { value: 'uppercase',  Icon: CaseUpper,     label: 'MAYÚSCULAS' },
  { value: 'lowercase',  Icon: CaseLower,     label: 'minúsculas' },
  { value: 'capitalize', Icon: CaseSensitive,  label: 'Capitalizar' },
];

// Element types that support text formatting
export const TEXT_TYPES = new Set(['contentarea']);

// Font size units — cycle through on click
export const SIZE_UNITS = ['pt', 'mm', 'cm', 'in', 'px'];
export const SIZE_CONVERSIONS = {
  pt: 1, mm: 2.8346, cm: 28.346, in: 72, px: 0.75,
};  // multiplier: pt = value * factor

// ── Helpers ─────────────────────────────────────────────────────────────────

export function findAreaInPool(pool, areaId) {
  for (const a of pool) {
    if (a.id === areaId) return a;
    if (a.children?.length) {
      const r = findAreaInPool(a.children, areaId);
      if (r) return r;
    }
  }
  return null;
}

// Resolve the textStyleId for an element:
// - contentarea → area.defaultTextStyleId (from template pool)
export function getTextStyleId(el, contentAreas) {
  if (el.type === 'contentarea' && el.areaRef) {
    const area = findAreaInPool(contentAreas, el.areaRef);
    return area?.defaultTextStyleId ?? null;
  }
  return null;
}

// ── DeferredColorInput ───────────────────────────────────────────────────────
// Buffers color changes and commits only once (on blur or unmount).
// React's onChange on <input type="color"> fires on every drag movement,
// so we buffer the last value and commit when the picker closes.
// Also sets a flag on the DOM element so the dropdown outside-click handler
// can avoid closing the dropdown while the native color picker dialog is open.

export function DeferredColorInput({ value, onCommit, className, title }) {
  const ref = useRef(null);
  const latestRef = useRef(value);
  const openRef = useRef(false);
  const committedRef = useRef(false);

  function commit() {
    if (!committedRef.current && latestRef.current !== value) {
      committedRef.current = true;
      onCommit(latestRef.current);
    }
    openRef.current = false;
  }

  // Sync external value
  useEffect(() => {
    latestRef.current = value;
    committedRef.current = false;
    if (ref.current) ref.current.value = value;
  }, [value]);

  // Commit on unmount if pending
  useEffect(() => () => {
    if (openRef.current && !committedRef.current && latestRef.current !== value) {
      onCommit(latestRef.current);
    }
  }, [value, onCommit]);

  return (
    <input
      ref={ref}
      type="color"
      className={className}
      defaultValue={value}
      title={title}
      data-color-picker-open=""
      onMouseDown={e => e.stopPropagation()}
      onFocus={() => { openRef.current = true; committedRef.current = false; }}
      onChange={e => { latestRef.current = e.target.value; }}
      onBlur={() => commit()}
    />
  );
}

// ── SizeInput: number input with unit toggle + up/down arrows ────────────────

export function SizeInput({ valuePt, unit, disabled, onChangeUnit, onChange }) {
  const factor = SIZE_CONVERSIONS[unit] || 1;
  // Convert pt → display unit (round to 2 decimals)
  const displayVal = Math.round((valuePt / factor) * 100) / 100;
  const step = unit === 'pt' || unit === 'px' ? 1 : 0.1;

  function handleChange(newDisplay) {
    const v = parseFloat(newDisplay);
    if (!isNaN(v) && v > 0) onChange(v * factor); // convert back to pt
  }

  return (
    <div className="tft__size-wrap">
      <div className="tft__size-arrows">
        <button
          className="tft__size-arrow"
          disabled={disabled}
          tabIndex={-1}
          onClick={() => handleChange(displayVal + step)}
        >
          <ChevronUp size={8} />
        </button>
        <button
          className="tft__size-arrow"
          disabled={disabled}
          tabIndex={-1}
          onClick={() => handleChange(Math.max(step, displayVal - step))}
        >
          <ChevronDown size={8} />
        </button>
      </div>
      <input
        className="tft__size-input"
        type="number"
        min={0.1}
        max={999}
        step={step}
        value={displayVal}
        disabled={disabled}
        onChange={e => handleChange(e.target.value)}
      />
      <button
        className="tft__size-unit"
        disabled={disabled}
        tabIndex={-1}
        title="Cambiar unidad"
        onClick={onChangeUnit}
      >
        {unit}
      </button>
    </div>
  );
}

// ── TextColorButton: "A" + colored bar + portal popup (fill styles + color picker) ──

export function TextColorButton({
  color = '#1f2937',
  fillStyleId = null,   // id del fill style actualmente activo
  fillStyles = [],
  disabled,
  onApplyColor,
  onApplyFillStyle,     // (fillStyleId, color) → void — aplica fill+color juntos
  onAddFillStyle,       // (initialProps?) → id — create a fill style
  onNavigate,           // (id) → void — go to fill style panel
  onOpen,               // () → void — called before popup opens (use to save text selection)
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [pickColor, setPickColor] = useState(color);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const committedColorRef = useRef(color);
  // Tracks the latest picker value synchronously (avoids stale closure in onBlur)
  const latestPickRef = useRef(color);

  // Always-current refs for props used inside the outside-click native handler
  // (the useEffect closure would otherwise capture stale values)
  const onApplyColorRef = useRef(onApplyColor);
  const onApplyFillStyleRef = useRef(onApplyFillStyle);
  const onAddFillStyleRef = useRef(onAddFillStyle);
  const fillStylesRef = useRef(fillStyles);
  onApplyColorRef.current = onApplyColor;
  onApplyFillStyleRef.current = onApplyFillStyle;
  onAddFillStyleRef.current = onAddFillStyle;
  fillStylesRef.current = fillStyles;

  useEffect(() => {
    setPickColor(color);
    committedColorRef.current = color;
    latestPickRef.current = color;
  }, [color]);

  // Native mousedown handler on the popup — two jobs:
  // 1. stopPropagation → the editor's "click-outside → close editor" handler at document
  //    level never sees clicks inside this popup, so activeEditorRef stays set.
  // 2. preventDefault for non-inputs → focus stays in the contenteditable so
  //    hasInlineSelection() returns true when the swatch onClick fires.
  // For inputs (native color picker / hex field): we let them get focus normally
  // (preventDefault would break them), but we call onOpen() right here — before focus
  // shifts — so the text selection is captured in savedRangeRef while it's still active.
  useLayoutEffect(() => {
    if (!open) return;
    const el = popupRef.current;
    if (!el) return;
    function handler(e) {
      e.stopPropagation();
      if (e.target.tagName !== 'INPUT') {
        e.preventDefault();
      } else {
        // Input is about to steal focus — save the editor selection right now
        onOpen?.();
      }
    }
    el.addEventListener('mousedown', handler);
    return () => el.removeEventListener('mousedown', handler);
  }, [open, onOpen]);

  function openPopup() {
    // Save the editor text selection BEFORE the popup opens (onOpen = saveSelection in toolbar)
    onOpen?.();
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
  function toggle() { open ? closePopup() : openPopup(); }

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (popupRef.current?.contains(e.target)) return;
      // The popup is about to unmount. If the user changed the custom color but
      // onBlur on the color input hasn't fired yet (e.g. they clicked on a
      // non-canvas element where the focus change happens as a deferred browser
      // default action AFTER React flushes), commit the color now while
      // activeEditorRef / savedRangeRef are still valid.
      const latest = latestPickRef.current;
      if (latest !== committedColorRef.current) {
        committedColorRef.current = latest;
        commitCustomColor(latest);
      }
      closePopup();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function applyAndClose(hex) {
    onApplyColor(hex);
    closePopup();
  }

  // Unified commit: find-or-create fill → onApplyFillStyle if available, else onApplyColor
  function commitCustomColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    if (onApplyFillStyleRef.current) {
      const existing = fillStylesRef.current.find(s => s.type === 'solid' && s.color === hex);
      if (existing) {
        onApplyFillStyleRef.current(existing.id, hex);
        return;
      }
      const newId = onAddFillStyleRef.current?.({ type: 'solid', color: hex });
      if (newId) { onApplyFillStyleRef.current(newId, hex); return; }
    }
    // Fallback: legacy behavior (color only)
    onApplyColorRef.current?.(hex);
    if (onAddFillStyleRef.current) {
      const existing = fillStylesRef.current.find(s => s.type === 'solid' && s.color === hex);
      if (!existing) onAddFillStyleRef.current({ type: 'solid', color: hex });
    }
  }

  function handleApplyCustomColor(hex) {
    commitCustomColor(hex);
    closePopup();
  }

  function applyColorOnly(hex) {
    commitCustomColor(hex);
  }

  function handleCreateNew() {
    if (!onAddFillStyle) return;
    const id = onAddFillStyle();
    if (id) onNavigate?.(id);
    closePopup();
  }

  const solidStyles = fillStyles.filter(s => s.type === 'solid' && s.color);

  const popup = open && pos && ReactDOM.createPortal(
    <div
      ref={popupRef}
      className="tcb-popup"
      style={{ top: pos.top, left: pos.left }}
    >
      {solidStyles.length > 0 && (
        <>
          <div className="tcb-popup__section-label">
            Fill Styles
            <span className="tcb-popup__count">{solidStyles.length}</span>
          </div>
          <div className="tcb-popup__swatches">
            {solidStyles.map(fs => {
              const isActive = fillStyleId ? fs.id === fillStyleId : fs.color === color;
              return (
                <button
                  key={fs.id}
                  className={`tcb-popup__swatch-btn${isActive ? ' tcb-popup__swatch-btn--active' : ''}`}
                  title={fs.name}
                  onClick={() => {
                    if (onApplyFillStyle) {
                      onApplyFillStyle(fs.id, fs.color);
                      closePopup();
                    } else {
                      applyAndClose(fs.color);
                    }
                  }}
                >
                  <span className="tcb-popup__swatch" style={{ background: fs.color }} />
                </button>
              );
            })}
          </div>
          <div className="tcb-popup__sep" />
        </>
      )}
      {solidStyles.length === 0 && (
        <p className="tcb-popup__hint">Sin fill styles sólidos aún.</p>
      )}
      <div className="tcb-popup__section-label">Color personalizado</div>
      <div className="tcb-popup__color-row">
        <input
          type="color"
          className="tcb-popup__color-native"
          value={pickColor}
          onChange={e => {
            setPickColor(e.target.value);
            latestPickRef.current = e.target.value;
          }}
          onBlur={() => {
            const latest = latestPickRef.current;
            if (latest !== committedColorRef.current) {
              committedColorRef.current = latest;
              handleApplyCustomColor(latest);
            } else {
              closePopup();
            }
          }}
        />
        <input
          type="text"
          className="tcb-popup__hex"
          value={pickColor}
          maxLength={7}
          onChange={e => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
              setPickColor(v);
              latestPickRef.current = v;
            }
          }}
          onBlur={() => {
            const latest = latestPickRef.current;
            if (/^#[0-9a-fA-F]{6}$/.test(latest) && latest !== committedColorRef.current) {
              committedColorRef.current = latest;
              handleApplyCustomColor(latest);
            } else {
              closePopup();
            }
          }}
          onKeyDown={e => {
            const latest = latestPickRef.current;
            if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(latest)) {
              e.preventDefault();
              committedColorRef.current = latest;
              handleApplyCustomColor(latest);
            }
            if (e.key === 'Escape') closePopup();
          }}
          placeholder="#000000"
        />
      </div>
      <CmykInputs
        hex={pickColor}
        onCommit={c => {
          setPickColor(c);
          latestPickRef.current = c;
          committedColorRef.current = c;
          applyColorOnly(c);
        }}
      />
      {onAddFillStyle && (
        <div className="tcb-popup__footer">
          <button className="tcb-popup__create-btn" onClick={handleCreateNew}>
            <Plus size={10} /> Nuevo FS
          </button>
        </div>
      )}
    </div>,
    document.body
  );

  return (
    <div
      ref={triggerRef}
      className={`tft__color-wrap${disabled ? ' tft__color-wrap--disabled' : ''}`}
      title="Color de texto"
    >
      <button
        className="tft__color-trigger"
        onMouseDown={e => e.preventDefault()}
        onClick={toggle}
        disabled={disabled}
        tabIndex={-1}
      />
      <span className="tft__color-bar" style={{ background: color }} />
      {popup}
    </div>
  );
}

// ── ColorPicker: only commits on picker close, not on every hover ───────────

export function ColorPicker({ value, disabled, onCommit }) {
  const ref = useRef(null);
  const [preview, setPreview] = useState(value);
  const committedRef = useRef(value);

  // Sync preview when the committed value changes externally
  useEffect(() => { setPreview(value); committedRef.current = value; }, [value]);

  return (
    <div
      className="tft__color-wrap"
      title="Color de texto"
      // Allow color input to receive focus (override parent's preventDefault)
      onMouseDown={e => e.stopPropagation()}
    >
      <input
        ref={ref}
        type="color"
        className="tft__color-input"
        value={preview}
        disabled={disabled}
        // React onChange fires on every color hover → only update preview bar
        onChange={e => setPreview(e.target.value)}
        // onBlur fires when picker closes → commit the final color
        onBlur={() => {
          if (preview !== committedRef.current) {
            committedRef.current = preview;
            onCommit(preview);
          }
        }}
      />
      <span className="tft__color-bar" style={{ background: preview }} />
    </div>
  );
}

// ── LinkModal: small popover for inserting/editing a hyperlink ───────────────
// Rendered via portal to escape overflow:hidden on parent containers.

export function LinkModal({ anchorRef, initialUrl, onConfirm, onRemove, onClose }) {
  const [url, setUrl] = useState(initialUrl || '');
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    // Position below the anchor button
    if (anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    }
    requestAnimationFrame(() => inputRef.current?.select());
  }, [anchorRef]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (e.target.closest('.tft-link-modal, .tft__link-wrap')) return;
      onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) onConfirm(trimmed);
    else onClose();
  }

  if (!pos) return null;

  return ReactDOM.createPortal(
    <div
      className="tft-link-modal"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={e => e.stopPropagation()}
    >
      <form className="tft-link-modal__form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="tft-link-modal__input"
          type="text"
          placeholder="https://ejemplo.com"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        />
        <button className="tft-link-modal__ok" type="submit" title="Aplicar">
          <Link2 size={13} />
        </button>
        {initialUrl && (
          <button
            className="tft-link-modal__rm"
            type="button"
            title="Quitar enlace"
            onClick={onRemove}
          >
            <Unlink size={13} />
          </button>
        )}
        <button
          className="tft-link-modal__close"
          type="button"
          title="Cancelar"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </form>
    </div>,
    document.body
  );
}
