// engine/borderUtils.js — Pure border resolution and CSS generation utilities

// Resuelve el COLOR de línea de un border style por la cadena canónica
// lineFillStyleId → fillStyle → colorId → color. Cae a su lineColor inline
// (legacy) y finalmente a negro. (Misma lógica que TableDesign usa para celdas.)
export function resolveLineColor(bs, fillStyles, colors) {
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

export function resolveBorder(border, borderStyles) {
  if (!border) return null;
  if (border.styleRef) {
    const s = (borderStyles ?? []).find(bs => bs.id === border.styleRef);
    if (s) return { ...s, contentPadding: border.contentPadding };
  }
  return border;
}

export function buildBorderCss(border) {
  if (!border) return {};
  const css = {};
  if (border.mode === 'unified' && border.unified?.enabled) {
    const { width = 1, style = 'solid', color = '#000' } = border.unified;
    css.border = `${width}px ${style} ${color}`;
  } else if (border.mode === 'sides') {
    const sides = border.sides ?? {};
    const makeSide = s => s?.enabled
      ? `${s.width ?? 1}px ${s.style ?? 'solid'} ${s.color ?? '#000'}`
      : 'none';
    css.borderTop    = makeSide(sides.top);
    css.borderRight  = makeSide(sides.right);
    css.borderBottom = makeSide(sides.bottom);
    css.borderLeft   = makeSide(sides.left);
  }
  if (border.radius) {
    const r = border.radius;
    css.borderRadius = r.mode === 'unified'
      ? `${r.unified ?? 0}px`
      : `${r.topLeft ?? 0}px ${r.topRight ?? 0}px ${r.bottomRight ?? 0}px ${r.bottomLeft ?? 0}px`;
  }
  return css;
}
