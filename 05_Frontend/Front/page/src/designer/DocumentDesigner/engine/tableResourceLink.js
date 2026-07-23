// tableResourceLink.js — make table borders/fills "atados y reutilizables".
//
// Pure helpers `(template, …) → { t, id }` that FIND-OR-CREATE document
// resources so a cell stores a *reference* instead of inline values:
//
//   hex  → color   (template.colors, via findOrCreateColor — dedupes by hex)
//   color → fill style (template.styles.fill, type:'solid', .colorId link)
//   {width,style,fillStyleId} → border style (template.styles.border,
//        color via lineFillStyleId; deduped by signature)
//
// Generated resources carry `_auto:true` so dedupe only ever REUSES our own
// generated ones — it never edits/hijacks a user-made style. Editing the
// resulting color / fill style / border style updates every cell that
// references it (the whole point: reusable + centrally editable).

import { findOrCreateColor } from './colorRegistry.js';

let _seq = 0;
const uid = p => `${p}_${Date.now()}_${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 4)}`;
const normHex = h => (h || '#000000').trim().toLowerCase();
const round2 = n => Math.round((n ?? 0) * 100) / 100;

const STYLE_LABEL = { solid: 'sólido', dashed: 'discontinuo', dotted: 'punteado', double: 'doble' };

// hex → color resource id (reuses colorRegistry's dedupe).
export function ensureColorId(t, hex) {
  const { template, colorId } = findOrCreateColor(t, hex);
  return { t: template, colorId };
}

// hex → solid fill style id (linked to a color resource via .colorId).
export function ensureFillStyleId(t, hex) {
  const { template: t1, colorId } = findOrCreateColor(t, hex);
  const fills = t1.styles?.fill ?? [];
  const found = fills.find(s => s._auto && s.type === 'solid' && s.colorId === colorId);
  if (found) return { t: t1, fillStyleId: found.id, colorId };

  const id = uid('fs');
  const style = {
    id, name: `Relleno ${normHex(hex).toUpperCase()}`,
    type: 'solid', color: normHex(hex), opacity: 1, colorId,
    gradient: {
      type: 'linear', angle: 90, cx: 50, cy: 50,
      stops: [
        { color: '#000000', offset: 0,   opacity: 1 },
        { color: '#ffffff', offset: 100, opacity: 1 },
      ],
    },
    _auto: true,
  };
  return {
    t: { ...t1, styles: { ...t1.styles, fill: [...fills, style] } },
    fillStyleId: id, colorId,
  };
}

// {width,style,hex} → border style id (color resolved via lineFillStyleId →
// fill style → color). `sides` all enabled; the CELL's per-side `enabled`
// (cell.border.sides) decides which sides actually draw.
export function ensureBorderStyleId(t, { width = 0.5, style = 'solid', hex = '#000000' } = {}) {
  const { t: t1, fillStyleId } = ensureFillStyleId(t, hex);
  const borders = t1.styles?.border ?? [];
  const w = round2(width);
  const st = String(style || 'solid').toLowerCase();
  const found = borders.find(b => b._auto
    && round2(b.lineWidth) === w
    && String(b.lineStyle ?? 'solid').toLowerCase() === st
    && b.lineFillStyleId === fillStyleId);
  if (found) return { t: t1, borderStyleId: found.id };

  const id = uid('bs');
  const bs = {
    id, name: `Borde ${w} pt ${STYLE_LABEL[st] || st}`,
    lineWidth: w, lineCap: 'Butt', lineStyle: st, lineColor: normHex(hex),
    lineFillStyleId: fillStyleId,                       // ← color via fill style
    sides: {
      top:    { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
      right:  { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
      bottom: { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
      left:   { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
    },
    corner: 'Standard', radiusX: 5, radiusY: 5,
    corners: {
      topLeft:     { corner: null, radiusX: null, radiusY: null },
      topRight:    { corner: null, radiusX: null, radiusY: null },
      bottomRight: { corner: null, radiusX: null, radiusY: null },
      bottomLeft:  { corner: null, radiusX: null, radiusY: null },
    },
    join: 'Miter', joinColor: '#000000', miter: 10,
    fill: '', shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
    offsetLeft: 0, offsetRight: 0, offsetTop: 0, offsetBottom: 0,
    _auto: true,
  };
  return {
    t: { ...t1, styles: { ...t1.styles, border: [...borders, bs] } },
    borderStyleId: id,
  };
}

// Build a resourcified cell border directly from a pen ({width,style,color})
// + the per-side enabled map. Returns { t, border } or { t, border:null }.
export function borderFromPen(t, pen, sidesEnabled) {
  const anyOn = ['top', 'right', 'bottom', 'left'].some(s => sidesEnabled?.[s]);
  if (!anyOn) return { t, border: null };
  const { t: t1, borderStyleId } = ensureBorderStyleId(t, {
    width: pen?.width ?? 0.5,
    style: pen?.style ?? 'solid',
    hex:   pen?.color ?? '#000000',
  });
  return {
    t: t1,
    border: {
      styleRef: borderStyleId,
      sides: {
        top:    { enabled: !!sidesEnabled.top },
        right:  { enabled: !!sidesEnabled.right },
        bottom: { enabled: !!sidesEnabled.bottom },
        left:   { enabled: !!sidesEnabled.left },
      },
    },
  };
}

// Convert an inline cell.border → { styleRef, sides:{enabled} } (migration /
// lazy resourcify). Already-referenced borders pass through unchanged.
export function resourcifyInlineBorder(t, border) {
  if (!border) return { t, border: null };
  if (border.styleRef) return { t, border };
  if (!border.inline || !border.sides) return { t, border };
  const order = ['top', 'right', 'bottom', 'left'];
  // Positional model: one pen per cell; sides only differ by `enabled`.
  // Take the pen from the first enabled side (or top as fallback).
  const ref = order.map(s => border.sides[s]).find(sd => sd?.enabled)
           || border.sides.top || {};
  const sidesEnabled = {};
  for (const s of order) sidesEnabled[s] = !!border.sides[s]?.enabled;
  return borderFromPen(t, {
    width: ref.lineWidth ?? 0.5,
    style: ref.lineStyle ?? 'solid',
    color: ref.lineColor ?? '#000000',
  }, sidesEnabled);
}

// Convert an inline cell.fill {color} → { fillStyleId }. Refs pass through.
export function resourcifyInlineFill(t, fill) {
  if (!fill) return { t, fill: null };
  if (fill.fillStyleId) return { t, fill };
  if (!fill.color) return { t, fill };
  const { t: t1, fillStyleId } = ensureFillStyleId(t, fill.color);
  return { t: t1, fill: { fillStyleId } };
}
