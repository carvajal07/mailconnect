// engine/units.js — Conversiones de unidades para el canvas del designer
// Base DPI: 144 → zoom=1.0 visualmente equivale a 150% del tamaño real (96dpi)
// El canvas trabaja internamente en px pero el template JSON usa mm

const BASE_DPI = 144;
export const PX_PER_MM = BASE_DPI / 25.4; // ≈ 5.6693

// ── Conversión básica ──────────────────────────────────────────────────────

export function mmToPx(mm, zoom = 1) {
  return mm * PX_PER_MM * zoom;
}

export function pxToMm(px, zoom = 1) {
  return px / PX_PER_MM / zoom;
}

export function cmToPx(cm, zoom = 1) {
  return mmToPx(cm * 10, zoom);
}

export function inToPx(inches, zoom = 1) {
  return inches * BASE_DPI * zoom;
}

export function ptToPx(pt, zoom = 1) {
  return (pt * BASE_DPI) / 72 * zoom;
}

export function pxToPt(px, zoom = 1) {
  return (px / zoom * 72) / BASE_DPI;
}

// ── Objeto de conversión por unidad ───────────────────────────────────────

const CONVERTERS = {
  mm: { toPx: mmToPx,  fromPx: pxToMm  },
  cm: { toPx: cmToPx,  fromPx: (px, z) => pxToMm(px, z) / 10 },
  in: { toPx: inToPx,  fromPx: (px, z) => px / BASE_DPI / z },
  pt: { toPx: ptToPx,  fromPx: pxToPt  },
  px: { toPx: (v, z) => v * z, fromPx: (px, z) => px / z },
};

export function toPx(value, unit = 'mm', zoom = 1) {
  const conv = CONVERTERS[unit] ?? CONVERTERS.mm;
  return conv.toPx(value, zoom);
}

export function fromPx(px, unit = 'mm', zoom = 1) {
  const conv = CONVERTERS[unit] ?? CONVERTERS.mm;
  return conv.fromPx(px, zoom);
}

// ── Tamaños de página predefinidos (en mm) ────────────────────────────────

export const PAGE_PRESETS = {
  A4:        { width: 210,   height: 297   },
  A3:        { width: 297,   height: 420   },
  A5:        { width: 148,   height: 210   },
  Letter:    { width: 215.9, height: 279.4 },
  Legal:     { width: 215.9, height: 355.6 },
  Executive: { width: 184.1, height: 266.7 },
};

export function getPageSizePx(preset, orientation = 'portrait', zoom = 1) {
  const size = PAGE_PRESETS[preset] ?? PAGE_PRESETS.A4;
  let { width, height } = size;
  if (orientation === 'landscape') { [width, height] = [height, width]; }
  return {
    width:  mmToPx(width,  zoom),
    height: mmToPx(height, zoom),
    widthMm:  width,
    heightMm: height,
  };
}

// ── Conversión de propiedades (mm ↔ unidad de display) ───────────────────
// fromMm: factor para pasar de mm a la unidad mostrada
// toMm:   factor para pasar de unidad mostrada a mm

export const UNIT_PROPS = {
  mm: { fromMm: 1,         toMm: 1,          decimals: 1, step: 0.5  },
  cm: { fromMm: 0.1,       toMm: 10,         decimals: 2, step: 0.05 },
  pt: { fromMm: 72 / 25.4, toMm: 25.4 / 72,  decimals: 1, step: 0.5  },
  px: { fromMm: BASE_DPI / 25.4, toMm: 25.4 / BASE_DPI, decimals: 0, step: 1    },
  in: { fromMm: 1 / 25.4,  toMm: 25.4,       decimals: 3, step: 0.01 },
};

/** Convierte mm al valor en la unidad de display */
export function mmToUnit(mm, unit = 'mm') {
  return mm * (UNIT_PROPS[unit]?.fromMm ?? 1);
}

/** Convierte valor en unidad de display a mm */
export function unitToMm(val, unit = 'mm') {
  return val * (UNIT_PROPS[unit]?.toMm ?? 1);
}

// ── Snap a grid ───────────────────────────────────────────────────────────

export function snapToGrid(valueMm, gridMm = 1) {
  if (!gridMm || gridMm <= 0) return valueMm;
  return Math.round(valueMm / gridMm) * gridMm;
}

// ── Formateo de valor para display en regla ───────────────────────────────

export function formatRulerValue(mm) {
  if (mm < 10) return mm.toFixed(1);
  return Math.round(mm).toString();
}
