// colorRegistry.js — Find-or-create helpers for the color palette
//
// Pure functions that operate on a template object and return the next template
// (immutable) plus the resolved color id. Use these any time the user picks a
// color in a UI — instead of storing the hex inline on the style/element, the
// hex is registered in `template.colors` and the style/element stores a
// reference (e.g. `lineColorId: 'col_xxx'`). When the user later edits the
// color from the palette, every reference updates automatically.

import { hexToRgb, rgbToHex, inferColorName } from './colorUtils.js';
import { hexToCmyk } from '../editor/resources/colorUtils.jsx';

function normalizeHex(hex) {
  if (typeof hex !== 'string') return '#000000';
  const s = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ('#' + s.slice(1).split('').map(c => c + c).join('')).toLowerCase();
  }
  return '#000000';
}

// Generates a unique name based on the hex's inferred color name, appending
// " 2", " 3", … if the base name is already taken.
function generateColorName(hex, existing) {
  const base = inferColorName(hex) ?? 'Color';
  const usedNames = new Set((existing ?? []).map(col => col.name));
  if (!usedNames.has(base)) return base;
  let n = 2;
  while (usedNames.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function buildColorEntry(hex, existing) {
  const id = `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { r, g, b } = hexToRgb(hex);
  const { c, m, y, k } = hexToCmyk(hex);
  const now = new Date().toISOString();
  return {
    id,
    name: generateColorName(hex, existing),
    type: 'simple',
    colorSpace: 'rgb',
    hex, r, g, b, c, m, y, k,
    alpha: 255,
    spotColor: null,
    mixSpotColor: false,
    cases: [],
    defaultColorId: null,
    createdAt: now,
    updatedAt: now,
  };
}

// findOrCreateColor: returns { template, colorId }.
// If a color with the same hex already exists, returns its id without changing
// the template. Otherwise inserts a new color entry and returns the new id.
//
// Use the returned `template` value for any subsequent operations — the input
// template is NOT mutated.
export function findOrCreateColor(template, hex) {
  const normalized = normalizeHex(hex);
  const existing = template?.colors ?? [];
  const match = existing.find(c => normalizeHex(c.hex) === normalized);
  if (match) return { template, colorId: match.id };

  const entry = buildColorEntry(normalized, existing);
  const nextTemplate = {
    ...template,
    colors: [...existing, entry],
  };
  return { template: nextTemplate, colorId: entry.id };
}

// resolveColorHex: given a template and a colorId, returns the color's hex.
// Returns null if the id is missing or the color doesn't exist.
export function resolveColorHex(template, colorId) {
  if (!colorId) return null;
  const color = (template?.colors ?? []).find(c => c.id === colorId);
  return color?.hex ?? null;
}

// resolveLinkedColor: walks the priority chain to resolve a final hex string
// for a "color slot" on a border/style/element. Priority (most explicit
// user-intent first):
//   1. lineFillStyleId → template.styles.fill[id].color   (user picked a FillStyle)
//   2. lineColor (hex string)                              (explicit hex, also cached when linked)
//   3. lineColorId  → template.colors[id].hex              (palette linkage fallback)
//   4. fallback (default)
//
// The denormalized linkage (`lineColorId` + cached `lineColor`) works because
// `useColorResources.updateColor` propagates hex changes to the cached
// `lineColor` field whenever a palette color is edited. So reading `lineColor`
// gives the latest value for linked styles too.
export function resolveLinkedColor({ lineColorId, lineFillStyleId, lineColor }, colors, fillStyles, fallback = '#000000') {
  if (lineFillStyleId) {
    const fs = (fillStyles ?? []).find(s => s.id === lineFillStyleId);
    if (fs?.color) return fs.color;
  }
  if (lineColor) return lineColor;
  if (lineColorId) {
    const c = (colors ?? []).find(col => col.id === lineColorId);
    if (c?.hex) return c.hex;
  }
  return fallback;
}
