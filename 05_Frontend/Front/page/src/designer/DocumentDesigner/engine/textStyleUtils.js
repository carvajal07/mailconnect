// engine/textStyleUtils.js — Utilities for immutable text style management
// Text styles are snapshots: the toolbar never mutates an existing style,
// it clones + applies changes + finds or creates a matching style.

import { createDefaultTextStyle, DEFAULT_TEXT_STYLE_ID } from './elementFactory.js';

// ── Properties that define style identity (compared for matching) ─────────

const STYLE_PROPS = [
  'fontFamily', 'fontWeight', 'fontSize', 'color',
  'italic', 'smallCaps',
  'letterSpacing', 'lineHeight', 'textTransform',
  'kerning', 'horizontalScale', 'baselineShift',
  'superscript', 'subscript',
  'superscriptOffset', 'subscriptOffset', 'superSubSize', 'smallCapsSize',
  'underline', 'strikethrough',
  'underlineStyleId', 'strikethroughStyleId',
  'customUnderlineStrike',
  'underlineOffset', 'underlineWidth',
  'strikethroughOffset', 'strikethroughWidth',
  'borderStyleId', 'connectBorders',
  // ── Epic 1 additions ──────────────────────────────────────────────────────
  'borderWithLineGap',
  'fillStyleId',
  'outlineStyleId', 'outlineWidth',
  'cap', 'join', 'miter',
  'language',
  'urlTarget',
];

// ── Compare two style objects by their visual properties ──────────────────

export function stylePropsEqual(a, b) {
  for (const key of STYLE_PROPS) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return true;
}

// ── Find an existing style with identical properties ──────────────────────

export function findMatchingStyle(styles, props) {
  return styles.find(s => stylePropsEqual(s, props)) ?? null;
}

// ── Build a descriptive name from style properties ────────────────────────
// Pattern: [FontFamily?][Size?][Weight?][Italic?][Underline?][Strike?][Super?][Sub?][Caps?]

export function buildStyleName(style) {
  const def = createDefaultTextStyle();
  const parts = [];

  // Font family (only if different from default)
  if (style.fontFamily && style.fontFamily !== def.fontFamily) {
    parts.push(style.fontFamily);
  }

  // Font size (only if different from default)
  if (style.fontSize != null && style.fontSize !== def.fontSize) {
    parts.push(String(style.fontSize));
  }

  // Weight
  if (style.fontWeight === 'Bold' || style.fontWeight === 'ExtraBold') {
    parts.push('Bold');
  } else if (style.fontWeight && style.fontWeight !== 'Regular' && style.fontWeight !== def.fontWeight) {
    parts.push(style.fontWeight);
  }

  // Color (only if different from default)
  if (style.color && style.color !== def.color) {
    // Use common color names for readability, otherwise hex
    const COLOR_NAMES = {
      '#ff0000': 'Red', '#00ff00': 'Green', '#0000ff': 'Blue',
      '#ffffff': 'White', '#000000': 'Black', '#ffff00': 'Yellow',
      '#ff00ff': 'Magenta', '#00ffff': 'Cyan', '#ffa500': 'Orange',
      '#800080': 'Purple', '#808080': 'Gray',
    };
    parts.push(COLOR_NAMES[style.color.toLowerCase()] ?? style.color);
  }

  // Boolean flags
  if (style.italic) parts.push('Italic');
  if (style.underline) parts.push('Underline');
  if (style.strikethrough) parts.push('Strike');
  if (style.superscript) parts.push('Superscript');
  if (style.subscript) parts.push('Subscript');
  if (style.smallCaps) parts.push('Caps');

  // Text transform
  if (style.textTransform && style.textTransform !== 'none') {
    parts.push(style.textTransform.charAt(0).toUpperCase() + style.textTransform.slice(1));
  }

  return parts.length > 0 ? parts.join('') : 'Normal';
}

// ── Ensure name uniqueness by appending index if needed ───────────────────

export function uniqueStyleName(baseName, existingStyles) {
  const names = new Set(existingStyles.map(s => s.name));
  if (!names.has(baseName)) return baseName;

  let i = 1;
  while (names.has(`${baseName} ${i}`)) i++;
  return `${baseName} ${i}`;
}

// ── Extract only the visual properties from a style (strip id/name) ──────

export function extractStyleProps(style) {
  const props = {};
  for (const key of STYLE_PROPS) {
    if (style[key] !== undefined) props[key] = style[key];
  }
  return props;
}

// ── Resolve a textStyleId to its full properties ──────────────────────────
// Falls back to default text style if not found

export function resolveTextStyle(textStyleId, styles) {
  if (!textStyleId) return createDefaultTextStyle();
  return styles.find(s => s.id === textStyleId) ?? createDefaultTextStyle();
}
