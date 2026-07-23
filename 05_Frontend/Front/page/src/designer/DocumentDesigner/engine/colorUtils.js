// engine/colorUtils.js — Pure color math utilities (no React, no CSS side effects)

export function hexToRgb(hex) {
  if (!hex?.startsWith('#')) return { r: 0, g: 0, b: 0 };
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgba(hex, alpha = 1) {
  if (!hex?.startsWith('#')) return hex ?? 'transparent';
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function interpolateHex(hex1, hex2, t) {
  if (!hex1 || !hex2) return hex1 ?? hex2 ?? '#888888';
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = p(hex1), [r2, g2, b2] = p(hex2);
  return '#' + [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]
    .map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function inferColorName(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const { h, s, l } = hexToHsl(hex);
  if (s < 8) {
    if (l < 12) return 'BlackFill';
    if (l > 88) return 'WhiteFill';
    if (l < 38) return 'DarkGrayFill';
    if (l > 62) return 'LightGrayFill';
    return 'GrayFill';
  }
  let hue;
  if (h < 15 || h >= 345) hue = 'Red';
  else if (h < 45) hue = 'Orange';
  else if (h < 65) hue = 'Yellow';
  else if (h < 150) hue = 'Green';
  else if (h < 195) hue = 'Cyan';
  else if (h < 255) hue = 'Blue';
  else if (h < 285) hue = 'Violet';
  else if (h < 315) hue = 'Purple';
  else hue = 'Pink';
  const prefix = l < 28 ? 'Dark' : l > 72 ? 'Light' : '';
  return `${prefix}${hue}Fill`;
}
