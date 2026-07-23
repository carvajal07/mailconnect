// engine/fillUtils.js — Pure fill resolution and CSS generation utilities

import { hexToRgba } from './colorUtils.js';

export function resolveFill(fill, fillStyles) {
  if (!fill) return null;
  if (fill.fillStyleId) {
    const s = (fillStyles ?? []).find(fs => fs.id === fill.fillStyleId);
    if (s) return s;
  }
  return fill;
}

export function buildGradientCss(gradient) {
  if (!gradient?.stops?.length) return 'transparent';
  const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
  const stops = sorted.map(s => `${hexToRgba(s.color, s.opacity ?? 1)} ${s.offset}%`).join(', ');
  if (gradient.type === 'radial') {
    const cx = gradient.cx ?? 50;
    const cy = gradient.cy ?? 50;
    return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
  }
  if (gradient.type === 'rectangle') {
    const cx = gradient.cx ?? 50;
    const cy = gradient.cy ?? 50;
    return `radial-gradient(farthest-corner at ${cx}% ${cy}%, ${stops})`;
  }
  return `linear-gradient(${gradient.angle ?? 0}deg, ${stops})`;
}

// Returns a CSS background value for a fill style, or null if none/unsupported.
export function fillToBg(fs) {
  if (!fs || fs.type === 'none') return null;
  if (fs.type === 'solid') {
    const op = fs.opacity ?? 1;
    if (op < 1) return hexToRgba(fs.color ?? '#000000', op);
    return fs.color ?? '#000000';
  }
  if (fs.type === 'gradient') {
    return buildGradientCss(fs.gradient);
  }
  return null;
}
