// editor/canvas/elements/ShapeElement.jsx — Renderiza cualquier forma del catálogo.
//
// Fill y borde se resuelven por el sistema de recursos (igual que el resto del
// editor):
//   fill  → element.fill.fillStyleId → fillStyle → color   (o fill inline)
//   borde → element.border.styleRef  → borderStyle → (línea + color vía fill)
//           (o border.unified / lineStyle inline, legacy)

import { getShape } from '../../../engine/shapeCatalog.js';
import { resolveFill } from '../../../engine/fillUtils.js';
import { resolveLineColor } from '../../../engine/borderUtils.js';
import ShapeGeom from './ShapeGeom.jsx';

const PT_TO_PX = 96 / 72;

function dashFor(style) {
  const s = String(style ?? 'solid').toLowerCase();
  if (s === 'dashed') return '8 4';
  if (s === 'dotted') return '2 4';
  return undefined;
}

// Resuelve el TRAZO (color, grosor px, patrón) por prioridad:
//   border.styleRef > lineStyle (legacy líneas) > border.unified inline > none
function resolveStroke(element, { borderStyles, fillStyles, colors, zoom }) {
  const b = element.border ?? {};
  if (b.styleRef) {
    const bs = (borderStyles ?? []).find(s => s.id === b.styleRef);
    if (bs) {
      const anyEnabled = !bs.sides || Object.values(bs.sides).some(s => s?.enabled);
      if (!anyEnabled) return null;
      return {
        color: resolveLineColor(bs, fillStyles, colors),
        width: (bs.lineWidth ?? 0.5) * PT_TO_PX * zoom,
        dash:  dashFor(bs.lineStyle),
      };
    }
  }
  if (element.lineStyle) {
    return {
      color: element.lineStyle.color ?? '#1f2937',
      width: (element.lineStyle.width ?? 1) * zoom,
      dash:  dashFor(element.lineStyle.style),
    };
  }
  if (b.mode === 'unified' && b.unified?.enabled) {
    return {
      color: b.unified.color ?? '#000000',
      width: (b.unified.width ?? 1) * zoom,
      dash:  dashFor(b.unified.style),
    };
  }
  return null;
}

function paintFromFillObj(f) {
  if (!f || f.type === 'none') return { paint: 'none', opacity: 1 };
  const opacity = f.opacity ?? 1;
  if (f.type === 'solid')    return { paint: f.color ?? '#000000', opacity };
  if (f.type === 'gradient') return { paint: f.gradient ?? null, opacity };
  if (f.type === 'image')    return { paint: '#e5e7eb', opacity };   // SVG no soporta bg-image: fallback neutro
  return { paint: 'none', opacity: 1 };
}

// Resuelve el RELLENO de la forma a un paint para SVG.
// Model B (relleno y borde son UN solo recurso): el relleno de la forma ES el
// "Relleno interior" (shading) de su border style → bs.fillFillStyleId → fill
// style → color (o bs.fill inline). Si la forma no tiene border style (legacy),
// cae al relleno inline del elemento.
function resolveFillPaint(element, bs, fillStyles) {
  if (bs) {
    if (bs.fillFillStyleId) {
      const fs = (fillStyles ?? []).find(s => s.id === bs.fillFillStyleId);
      if (fs) return paintFromFillObj(fs);
    }
    if (bs.fill) return { paint: bs.fill, opacity: 1 };
  }
  return paintFromFillObj(resolveFill(element.fill, fillStyles));
}

export default function ShapeElement({
  element,
  fillStyles = [],
  borderStyles = [],
  colors = [],
  zoom = 1,
}) {
  const def = getShape(element.shape ?? 'rectangle');
  const bs = element.border?.styleRef
    ? (borderStyles ?? []).find(s => s.id === element.border.styleRef)
    : null;
  const stroke = resolveStroke(element, { borderStyles, fillStyles, colors, zoom });
  const { paint, opacity } = def.kind === 'open'
    ? { paint: 'none', opacity: 1 }
    : resolveFillPaint(element, bs, fillStyles);

  return (
    <ShapeGeom
      geom={def.geom}
      kind={def.kind}
      fillPaint={paint}
      fillOpacity={opacity}
      stroke={stroke?.color ?? 'none'}
      strokeWidth={stroke?.width ?? 0}
      dash={stroke?.dash}
    />
  );
}
