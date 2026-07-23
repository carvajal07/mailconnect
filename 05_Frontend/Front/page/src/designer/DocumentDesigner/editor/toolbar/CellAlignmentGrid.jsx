// CellAlignmentGrid.jsx — Word-style 3×3 cell-alignment grid.
//
//   ┌─────────┬─────────┬─────────┐
//   │ TL      │ TC      │ TR      │   row = vAlign:  top
//   ├─────────┼─────────┼─────────┤
//   │ ML      │ MC      │ MR      │   row = vAlign:  center (Word: "middle")
//   ├─────────┼─────────┼─────────┤
//   │ BL      │ BC      │ BR      │   row = vAlign:  bottom
//   └─────────┴─────────┴─────────┘
//      col = hAlign:  left / center / right
//
// Used in:
//   • CellPropertiesPanel  (single-cell or bulk via the modal)
//   • Ribbon "Tabla" tab    (applies to drag-selected cells, multi at once)
//
// Shared so changes here propagate to both surfaces.

import './CellAlignmentGrid.css';

const V_VALUES = ['top', 'center', 'bottom'];
const H_VALUES = ['left', 'center', 'right'];

// Tiny inline SVG: three horizontal "text lines" positioned to indicate the
// 9 combos. The lines sit at the chosen vertical band and horizontal flank.
function AlignIcon({ v, h }) {
  // Vertical band (top|middle|bottom): pick line Y coords inside a 14×14 box.
  const bands = {
    top:    [2,  4,  6],
    center: [5,  7,  9],
    bottom: [8, 10, 12],
  };
  const ys = bands[v];
  // Horizontal flank: which line widths and X anchors per row.
  // (Mimics Word: text lines hug the corresponding side.)
  // Each row item: [x, width]
  const flanks = {
    left:   [[2, 10], [2,  7], [2,  9]],
    center: [[3,  8], [4,  6], [3,  8]],
    right:  [[2, 10], [5,  7], [3,  9]],
  };
  const xs = flanks[h];
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {ys.map((y, i) => (
        <rect key={i} x={xs[i][0]} y={y} width={xs[i][1]} height="1" rx="0.5" />
      ))}
    </svg>
  );
}

const LABELS = {
  'top-left':      'Alinear arriba a la izquierda',
  'top-center':    'Alinear arriba al centro',
  'top-right':     'Alinear arriba a la derecha',
  'center-left':   'Alinear al centro a la izquierda',
  'center-center': 'Alinear al centro',
  'center-right':  'Alinear al centro a la derecha',
  'bottom-left':   'Alinear abajo a la izquierda',
  'bottom-center': 'Alinear abajo al centro',
  'bottom-right':  'Alinear abajo a la derecha',
};

/**
 * @param {{ vAlign, hAlign }} value   Current alignment (use `null` when mixed)
 * @param {boolean} mixed              Selection has multiple alignments → no active highlight
 * @param {(next: { vAlign, hAlign }) => void} onChange
 * @param {boolean} [disabled]
 * @param {'sm'|'md'} [size]           Compact (ribbon) vs roomy (panel)
 */
export default function CellAlignmentGrid({ value, mixed, onChange, disabled, size = 'md' }) {
  const av = value?.vAlign ?? null;
  const ah = value?.hAlign ?? null;

  return (
    <div className={`cag cag--${size}${disabled ? ' cag--disabled' : ''}`} role="radiogroup" aria-label="Alineación de celda">
      {V_VALUES.map(v => (
        <div key={v} className="cag__row">
          {H_VALUES.map(h => {
            const active = !mixed && av === v && ah === h;
            const label = LABELS[`${v}-${h}`];
            return (
              <button
                key={`${v}-${h}`}
                type="button"
                className={`cag__btn${active ? ' cag__btn--active' : ''}`}
                title={label}
                aria-label={label}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onChange?.({ vAlign: v, hAlign: h })}
              >
                <AlignIcon v={v} h={h} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// `deriveAlignmentValue` lives in cellAlignmentUtils.js — keep helpers out of
// this .jsx file so React Fast Refresh works (only-export-components rule).
// Import that helper directly: `import { deriveAlignmentValue } from './cellAlignmentUtils.js'`.
