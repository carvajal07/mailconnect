// TableDesign.jsx — Word-like "Diseño de tabla" controls for the Tabla ribbon.
//   • TableStyleGallery: popover with CSS-drawn preset thumbnails.
//   • ColorMenu: small palette popover (document colors + defaults + clear).
// Both portal to <body> (the ribbon row is overflow-clipped at 44px).

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Pipette } from 'lucide-react';
import { TABLE_STYLE_PRESET_LIST } from '../../engine/tableStyleUtils.js';
import { CmykInputs } from '../resources/colorUtils.jsx';
import CellAlignmentGrid from './CellAlignmentGrid.jsx';

// EyeDropper API helper (Chromium). Returns null when unsupported / cancelled.
function useEyeDropper() {
  const supported = typeof window !== 'undefined' && 'EyeDropper' in window;
  async function pick() {
    if (!supported) return null;
    try { const { sRGBHex } = await new window.EyeDropper().open(); return sRGBHex; }
    catch { return null; }
  }
  return { supported, pick };
}

// Shared "custom color" editor block used inside the Pluma & Sombreado
// popovers: live preview + native (advanced) picker + hex input + eyedropper +
// CMYK inputs + an optional "create fill style" action. Picking a color emits
// the hex via onPickHex; the caller resolves it to a fill-style resource.
function InlineColorEditor({ value = '#000000', onPickHex, onCreateLabel, onCreate }) {
  const [hex, setHex] = useState(value);
  // Reset local editing state when the incoming value changes (active style
  // switched). Adjust-state-during-render pattern (React docs) — avoids an
  // effect that would lag a frame and trip set-state-in-effect lint.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setHex(value || '#000000');
  }
  const { supported, pick } = useEyeDropper();
  const validHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000';

  // Native <input type="color"> commits via the DOM 'change' event (fired once
  // when the OS picker closes). React's onChange maps to the continuous 'input'
  // event, and onBlur is unreliable here (the popover's capture-phase mousedown
  // can close + unmount the input before blur applies). So we attach a real
  // 'change' listener and apply there. Re-attaches when onPickHex changes.
  const nativeRef = useRef(null);
  useEffect(() => {
    const el = nativeRef.current;
    if (!el) return undefined;
    const onCommit = e => onPickHex?.(e.target.value);
    el.addEventListener('change', onCommit);
    return () => el.removeEventListener('change', onCommit);
  }, [onPickHex]);

  return (
    <>
      <div className="rb__pen-sec">Color personalizado</div>
      <div className="rb__cc-row">
        <span className="rb__cc-preview" style={{ background: validHex }} />
        <input
          ref={nativeRef}
          type="color" className="rb__cc-native" value={validHex}
          onChange={e => setHex(e.target.value)}
          title="Selector de color avanzado"
        />
        <input
          type="text" className="rb__cc-hex" value={hex} maxLength={7} placeholder="#000000"
          onChange={e => {
            const v = e.target.value;
            if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
              const nv = v.startsWith('#') ? v : `#${v}`;
              setHex(nv);
              if (/^#[0-9a-fA-F]{6}$/.test(nv)) onPickHex?.(nv);
            }
          }}
          onKeyDown={e => { if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(hex)) onPickHex?.(hex); }}
        />
        {supported && (
          <button className="rb__cc-eye" title="Cuentagotas"
            onClick={async () => { const h = await pick(); if (h) { setHex(h); onPickHex?.(h); } }}>
            <Pipette size={13} />
          </button>
        )}
      </div>
      <CmykInputs hex={validHex} onCommit={c => { setHex(c); onPickHex?.(c); }} />
      {onCreate && (
        <button className="rb__create-row" onClick={onCreate}>
          <Plus size={11} />
          <span>{onCreateLabel ?? 'Crear estilo de relleno…'}</span>
        </button>
      )}
    </>
  );
}

// Shared portal-popover anchored under a trigger button.
function Popover({ open, anchorRef, onClose, className, children }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function place() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 2 });
    }
    place();
    function onDown(e) {
      if (ref.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    }
    // Capture phase: table cells call stopPropagation() on mousedown, which
    // would prevent a bubble-phase listener from ever seeing the click — so
    // clicking a cell wouldn't close the popover. Capturing runs first.
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, onClose]);
  if (!open || !pos) return null;
  return createPortal(
    <div ref={ref} className={`rb__popover ${className || ''}`}
      style={{ position: 'fixed', left: pos.left, top: pos.top }}>
      {children}
    </div>,
    document.body,
  );
}

// ── One preset thumbnail (CSS-drawn 3×3 mini table) ───────────────────────
function PresetThumb({ preset }) {
  const line = preset.border === 'none' ? 'transparent' : '#475569';
  const cell = (r, c) => {
    const isHeader = r === 0 && preset.header;
    const bg = isHeader
      ? preset.header
      : (preset.odd != null ? (r % 2 === 1 ? preset.odd : preset.even) : 'transparent');
    return {
      borderRight:  c < 2 && preset.border === 'all' ? `1px solid ${line}` : '1px solid transparent',
      borderBottom: r < 2 && preset.border === 'all' ? `1px solid ${line}` : '1px solid transparent',
      background: bg || 'transparent',
    };
  };
  const outline = preset.border === 'none' ? '1px dashed #cbd5e1' : `1px solid ${line}`;
  return (
    <div className="rb__thumb-grid" style={{ outline }}>
      {[0, 1, 2].map(r => (
        <div key={r} className="rb__thumb-row">
          {[0, 1, 2].map(c => <div key={c} className="rb__thumb-cell" style={cell(r, c)} />)}
        </div>
      ))}
    </div>
  );
}

export function TableStyleGallery({
  activeKey, onPick,
  tableStyles = [], activeTableStyleId, onApplyTableStyle, onCreateTableStyle,
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  return (
    <>
      <button ref={btnRef} className={`rb__btn${open ? ' rb__btn--active' : ''}`}
        title="Estilo de tabla" onClick={() => setOpen(o => !o)}>
        <span className="rb__btn-label">Estilo de Tabla</span>
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)}
        className="rb__popover--gallery">
        {/* Table Styles del documento (recurso reutilizable, aplica por ref) */}
        {(tableStyles ?? []).length > 0 && (
          <>
            <div className="rb__pen-sec rb__gallery-sec">Estilos de tabla</div>
            <div className="rb__fillstyle-list rb__gallery-list">
              {tableStyles.map(ts => (
                <button key={ts.id}
                  className={`rb__fillstyle-row${activeTableStyleId === ts.id ? ' rb__fillstyle-row--on' : ''}`}
                  title={ts.name}
                  onClick={() => { onApplyTableStyle?.(ts.id); setOpen(false); }}>
                  <span className="rb__fillstyle-swatch" style={{ background: '#fff', border: '1px solid #cbd5e1' }} />
                  <span className="rb__fillstyle-name">{ts.name ?? 'Sin nombre'}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Plantillas rápidas (aplican formato directo a las celdas) */}
        <div className="rb__pen-sec rb__gallery-sec">Plantillas rápidas</div>
        <div className="rb__gallery-grid">
          {TABLE_STYLE_PRESET_LIST.map(p => (
            <button key={p.key}
              className={`rb__thumb${activeKey === p.key ? ' rb__thumb--active' : ''}`}
              title={p.label}
              onClick={() => { onPick(p.key); setOpen(false); }}>
              <PresetThumb preset={p} />
              <span className="rb__thumb-label">{p.label}</span>
            </button>
          ))}
        </div>

        {onCreateTableStyle && (
          <button className="rb__create-row" onClick={() => { setOpen(false); onCreateTableStyle(); }}>
            <Plus size={11} />
            <span>Crear nuevo Table Style…</span>
          </button>
        )}
      </Popover>
    </>
  );
}

export function ColorMenu({ label, colors = [], fillStyles = [], currentHex, onPick, onPickFillStyle, onCreateFillStyle, allowClear = true }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const swatches = [
    '#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff',
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899',
    '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#f3e8ff', '#f1f5f9',
  ];
  const docHex = [...new Set((colors ?? []).map(c => c?.hex).filter(Boolean))];
  // Solid fill styles from the document — named (or _auto-named) reusable
  // resources. Picking one applies its fillStyleId directly so editing the
  // resource later updates every cell that references it.
  const solidFills = (fillStyles ?? []).filter(s => s?.type === 'solid');
  // Resolve a fill style's preview color via its linked color resource first
  // (the canonical source) and fall back to the inline color.
  const fillBg = fs => {
    if (fs?.colorId) {
      const c = (colors ?? []).find(col => col.id === fs.colorId);
      if (c?.hex) return c.hex;
    }
    return fs?.color ?? '#ffffff';
  };
  return (
    <>
      <button ref={btnRef} className={`rb__btn${open ? ' rb__btn--active' : ''}`}
        title={label} onClick={() => setOpen(o => !o)}>
        <span className="rb__btn-label">{label}</span>
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)}
        className="rb__popover--colors">
        {allowClear && (
          <button className="rb__color-clear"
            onClick={() => { onPick(null); setOpen(false); }}>Sin relleno</button>
        )}
        {solidFills.length > 0 && (
          <>
            <div className="rb__pen-sec">Estilos de relleno</div>
            <div className="rb__fillstyle-list">
              {solidFills.map(fs => (
                <button key={fs.id} className="rb__fillstyle-row"
                  title={fs.name ?? fs.id}
                  onClick={() => { onPickFillStyle?.(fs.id); setOpen(false); }}>
                  <span className="rb__fillstyle-swatch" style={{ background: fillBg(fs) }} />
                  <span className="rb__fillstyle-name">{fs.name ?? 'Sin nombre'}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {docHex.length > 0 && (
          <>
            <div className="rb__pen-sec">Colores del documento</div>
            <div className="rb__color-grid">
              {docHex.map(h => (
                <button key={'d' + h} className="rb__swatch" title={h}
                  style={{ background: h }}
                  onClick={() => { onPick(h); setOpen(false); }} />
              ))}
            </div>
          </>
        )}
        <div className="rb__pen-sec">Paleta</div>
        <div className="rb__color-grid">
          {swatches.map(h => (
            <button key={h} className="rb__swatch" title={h}
              style={{ background: h }}
              onClick={() => { onPick(h); setOpen(false); }} />
          ))}
        </div>
        <div className="rb__pen-sep" />
        <InlineColorEditor
          value={currentHex}
          onPickHex={hex => onPick(hex)}
          onCreate={onCreateFillStyle ? () => { setOpen(false); onCreateFillStyle(); } : null}
        />
      </Popover>
    </>
  );
}

// ── Pen: combined line-style + weight + color, with live preview ──────────
const PEN_STYLES = [
  { key: 'solid',  label: 'Sólido' },
  { key: 'dashed', label: 'Discontinuo' },
  { key: 'dotted', label: 'Punteado' },
  { key: 'double', label: 'Doble' },
];
const PEN_WIDTHS = [0.25, 0.5, 1, 1.5, 2.25, 3];

// Visible thickness for a preview line of a given pt weight + style.
function previewPx(w, style) {
  const px = Math.max(1, Math.round(w * 1.6));
  return style === 'double' ? Math.max(3, px) : px;   // 'double' needs ≥3px
}
function SampleLine({ style, width, color, w = 64 }) {
  return (
    <span style={{
      display: 'inline-block', width: w, height: 0,
      borderTop: `${previewPx(width, style)}px ${style} ${color}`,
      verticalAlign: 'middle',
    }} />
  );
}

// Resolve a border style's preview color via its lineFillStyleId → fillStyle
// → colorId → color resource (the canonical "atado" chain). Falls back to the
// style's inline lineColor (legacy) and finally to black.
function resolveBorderStyleColor(bs, fillStyles, colors) {
  if (bs?.lineFillStyleId) {
    const fs = (fillStyles ?? []).find(s => s.id === bs.lineFillStyleId);
    if (fs?.colorId) {
      const c = (colors ?? []).find(col => col.id === fs.colorId);
      if (c?.hex) return c.hex;
    }
    if (fs?.color) return fs.color;
  }
  return bs?.lineColor ?? '#000000';
}

// Pluma — Model B: a pure EDITOR of the ACTIVE border style's lines. Picking a
// style/width/color emits a semantic patch via onEdit; the ribbon routes it to
// findOrCreateBorderStyle (fork the default / edit a named style). It no longer
// holds local pen state nor a style list (that lives in ActiveStyleButton).
//   onEdit({ lineStyle })     — 'solid' | 'dashed' | 'dotted' | 'double'
//   onEdit({ lineWidth })     — pt number
//   onEdit({ lineColorHex })  — hex string (op ensures the fill-style chain)
export function PenButton({ style = 'solid', width = 0.5, color = '#000000', colors = [], onEdit, onCreateLineFillStyle, disabled }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const st = String(style || 'solid').toLowerCase();
  const swatches = [
    '#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff',
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899',
    '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#f3e8ff', '#f1f5f9',
  ];
  const docHex = [...new Set((colors ?? []).map(c => c?.hex).filter(Boolean))];
  return (
    <>
      <button ref={btnRef} className={`rb__btn rb__pen-btn${open ? ' rb__btn--active' : ''}`}
        title="Pluma: estilo, grosor y color de las líneas del estilo activo"
        disabled={disabled} onClick={() => setOpen(o => !o)}>
        <span className="rb__pen-preview">
          <SampleLine style={st} width={width} color={color} w={40} />
          <span className="rb__pen-meta">{width} pt</span>
        </span>
        <span className="rb__btn-label">Pluma</span>
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)}
        className="rb__popover--pen">
        <div className="rb__pen-live">
          <SampleLine style={st} width={width} color={color} w={150} />
        </div>
        <div className="rb__pen-sec">Estilo</div>
        {PEN_STYLES.map(s => (
          <button key={s.key}
            className={`rb__pen-row${st === s.key ? ' rb__pen-row--on' : ''}`}
            onClick={() => onEdit?.({ lineStyle: s.key })}>
            <SampleLine style={s.key} width={Math.max(width, 1.5)} color={color} w={70} />
            <span>{s.label}</span>
          </button>
        ))}
        <div className="rb__pen-sec">Grosor</div>
        {PEN_WIDTHS.map(w => (
          <button key={w}
            className={`rb__pen-row${width === w ? ' rb__pen-row--on' : ''}`}
            onClick={() => onEdit?.({ lineWidth: w })}>
            <SampleLine style={st} width={w} color={color} w={70} />
            <span>{w} pt</span>
          </button>
        ))}
        <div className="rb__pen-sec">Color</div>
        {docHex.length > 0 && (
          <div className="rb__color-grid">
            {docHex.map(h => (
              <button key={'d' + h}
                className={`rb__swatch${color === h ? ' rb__swatch--on' : ''}`}
                title={h} style={{ background: h }} onClick={() => onEdit?.({ lineColorHex: h })} />
            ))}
          </div>
        )}
        <div className="rb__color-grid">
          {swatches.map(h => (
            <button key={h}
              className={`rb__swatch${color === h ? ' rb__swatch--on' : ''}`}
              title={h} style={{ background: h }} onClick={() => onEdit?.({ lineColorHex: h })} />
          ))}
        </div>
        <div className="rb__pen-sep" />
        <InlineColorEditor
          value={color}
          onPickHex={hex => onEdit?.({ lineColorHex: hex })}
          onCreateLabel="Crear estilo de relleno para la línea…"
          onCreate={onCreateLineFillStyle ? () => { setOpen(false); onCreateLineFillStyle(); } : null}
        />
      </Popover>
    </>
  );
}

// ── Active cell-box style (Model B) — the MANDATORY anchor of the cell-style
//    group. Shows the active borderStyle (mini line+fill preview, name, usage
//    count) and a dropdown to pick a different one or create a new one. Picking
//    makes it active AND applies it to the current selection. Creating forks a
//    new style and opens its editor. Fuses the old "Estilos" picker.
// ─────────────────────────────────────────────────────────────────────────
function ActiveStylePreview({ bs, fillStyles, colors }) {
  // Tiny box: top border line + a fill swatch strip, conveying "lines + fill".
  const lineColor = resolveBorderStyleColor(bs, fillStyles, colors);
  let bg = 'transparent';
  if (bs?.fillFillStyleId) {
    const fs = (fillStyles ?? []).find(s => s.id === bs.fillFillStyleId);
    if (fs) {
      const col = fs.colorId ? (colors ?? []).find(c => c.id === fs.colorId) : null;
      bg = col?.hex || fs.color || 'transparent';
    }
  } else if (bs?.fill) bg = bs.fill;
  const st = (bs?.lineStyle ?? 'solid').toLowerCase();
  const w = Math.max(1, Math.round((bs?.lineWidth ?? 0.5) * 1.6));
  return (
    <span style={{
      display: 'inline-block', width: 20, height: 14, borderRadius: 2,
      background: bg, border: `${w}px ${st} ${lineColor}`, boxSizing: 'border-box',
    }} />
  );
}

export function ActiveStyleButton({ borderStyles = [], fillStyles = [], colors = [], activeId, mixed, usageCount, disabled, onPick, onCreate }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const active = (borderStyles ?? []).find(s => s.id === activeId) ?? null;
  const label = mixed ? 'Varios estilos de celda' : (active?.name ?? 'Estilo de celda');
  return (
    <>
      <button
        ref={btnRef}
        className={`rb__btn rb__activestyle-btn${open ? ' rb__btn--active' : ''}`}
        title="Estilo de celda activo — clic para elegir o crear"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        {active && !mixed
          ? <ActiveStylePreview bs={active} fillStyles={fillStyles} colors={colors} />
          : <span style={{ display: 'inline-block', width: 20, height: 14, borderRadius: 2, border: '1px dashed currentColor', opacity: 0.5 }} />}
        <span className="rb__activestyle-name">{label}</span>
        {!mixed && usageCount > 0 && <span className="rb__activestyle-count">· {usageCount}</span>}
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)}
        className="rb__popover--pen">
        {(borderStyles ?? []).length === 0 ? (
          <div className="rb__hint" style={{ padding: '6px 4px' }}>Sin estilos de celda todavía.</div>
        ) : (
          <div className="rb__fillstyle-list">
            {borderStyles.map(bs => (
              <button key={bs.id}
                className={`rb__fillstyle-row${!mixed && activeId === bs.id ? ' rb__fillstyle-row--on' : ''}`}
                title={bs.name ?? bs.id}
                onClick={() => { onPick?.(bs.id); setOpen(false); }}>
                <ActiveStylePreview bs={bs} fillStyles={fillStyles} colors={colors} />
                <span className="rb__fillstyle-name">{bs.name ?? 'Sin nombre'}{bs.isDefault ? ' (base)' : ''}</span>
              </button>
            ))}
          </div>
        )}
        {onCreate && (
          <button className="rb__create-row" onClick={() => { setOpen(false); onCreate(); }}>
            <Plus size={11} />
            <span>Crear nuevo estilo de celda…</span>
          </button>
        )}
      </Popover>
    </>
  );
}

// ── Cell alignment: 3×3 Word-style grid as a popover ─────────────────────
// The ribbon row is overflow-clipped at 44px (only 2 button rows fit), so the
// 9-button grid lives in a portaled popover triggered from a single button —
// same pattern as TableStyleGallery / ColorMenu. The trigger button shows the
// current selection's alignment icon (or a neutral dot when mixed/disabled).
function MiniAlignIcon({ v, h }) {
  // Reuse the same SVG language as CellAlignmentGrid but at 12×12 for the btn.
  const bands = { top: [2, 4, 6], center: [5, 7, 9], bottom: [8, 10, 12] };
  const flanks = {
    left:   [[2, 8], [2, 5], [2, 7]],
    center: [[2, 8], [3, 6], [2, 8]],
    right:  [[2, 8], [5, 5], [3, 7]],
  };
  const ys = bands[v]; const xs = flanks[h];
  return (
    <svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true">
      {ys.map((y, i) => (
        <rect key={i} x={xs[i][0]} y={y} width={xs[i][1]} height="1" rx="0.5" fill="currentColor" />
      ))}
    </svg>
  );
}

export function CellAlignmentButton({ value, mixed, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const v = value?.vAlign ?? 'top';
  const h = value?.hAlign ?? 'left';
  return (
    <>
      <button
        ref={btnRef}
        className={`rb__btn${open ? ' rb__btn--active' : ''}`}
        title="Alineación de celda"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        {mixed || !value ? (
          <span style={{ display: 'inline-block', width: 12, height: 14, lineHeight: '14px', textAlign: 'center', opacity: 0.55 }}>·</span>
        ) : (
          <MiniAlignIcon v={v} h={h} />
        )}
        <span className="rb__btn-label">Alinear</span>
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)}
        className="rb__popover--align">
        <CellAlignmentGrid
          value={value}
          mixed={mixed}
          size="md"
          onChange={next => { onChange?.(next); setOpen(false); }}
        />
      </Popover>
    </>
  );
}
