// engine/paragraphStyleUtils.js — Utilities for immutable paragraph style management
// Same pattern as textStyleUtils.js: clone + apply changes + find or create matching style.

import { createDefaultParagraphStyle, DEFAULT_PARAGRAPH_STYLE_ID } from './elementFactory.js';

// ── Properties that define paragraph style identity (compared for matching) ──

const PARAGRAPH_STYLE_PROPS = [
  'alignment', 'verticalAlign',
  'lineHeight', 'letterSpacing',
  'firstLineIndent', 'leftIndent', 'rightIndent',
  'spaceBefore', 'spaceAfter',
  'wordWrap', 'wordBreak',
  'listStyle', 'listIndent', 'listColor',
  'defaultTextStyleId',
  // ── Epic 1 additions ──────────────────────────────────────────────────────
  'lineSpacingType', 'lineSpacing',
  'spaceBeforeOnFirst', 'ignoreEmptyLines',
  'defaultTab',
  'flowBreakBefore', 'flowBreakAfter',
  'keepLinesTogether', 'keepWithPreviousParagraph', 'keepWithNextParagraph',
  'doNotWrap',
  'paragraphBorderStyleId', 'connectBorders', 'borderWithLineGap',
  'hyphenation',
];

// ── Compare two paragraph style objects by their visual properties ───────────

export function paragraphStylePropsEqual(a, b) {
  for (const key of PARAGRAPH_STYLE_PROPS) {
    const av = a[key] ?? null;
    const bv = b[key] ?? null;
    // hyphenation is an object — compare by serialization
    if (key === 'hyphenation') {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

// ── Find an existing paragraph style with identical properties ───────────────

export function findMatchingParagraphStyle(styles, props) {
  return styles.find(s => paragraphStylePropsEqual(s, props)) ?? null;
}

// ── Build a descriptive name from paragraph style properties ─────────────────

export function buildParagraphStyleName(style) {
  const def = createDefaultParagraphStyle();
  const parts = [];

  // Alignment
  const alignLabels = { left: 'Izquierda', center: 'Centrado', right: 'Derecha', justify: 'Justificado' };
  if (style.alignment && style.alignment !== def.alignment) {
    parts.push(alignLabels[style.alignment] ?? style.alignment);
  }

  // List style
  const listLabels = { bullet: 'Viñetas', numbered: 'Numerado', letter: 'Letras' };
  if (style.listStyle && style.listStyle !== 'none') {
    parts.push(listLabels[style.listStyle] ?? style.listStyle);
  }

  // Indent
  if (style.leftIndent && style.leftIndent !== def.leftIndent) {
    parts.push(`Sangría ${style.leftIndent}`);
  }

  // First line indent
  if (style.firstLineIndent && style.firstLineIndent !== def.firstLineIndent) {
    parts.push(`1raLínea ${style.firstLineIndent}`);
  }

  // Line height
  if (style.lineHeight != null && style.lineHeight !== def.lineHeight) {
    parts.push(`LH ${style.lineHeight}`);
  }

  // Space before/after
  if (style.spaceBefore && style.spaceBefore !== def.spaceBefore) {
    parts.push(`Antes ${style.spaceBefore}`);
  }
  if (style.spaceAfter && style.spaceAfter !== def.spaceAfter) {
    parts.push(`Después ${style.spaceAfter}`);
  }

  // Line spacing type
  const lstLabels = { atleast: 'Mínimo', exact: 'Exacto', multipleof: 'Múltiplo' };
  if (style.lineSpacingType && style.lineSpacingType !== 'additional' && style.lineSpacing) {
    parts.push(`${lstLabels[style.lineSpacingType] ?? style.lineSpacingType} ${style.lineSpacing}`);
  }

  // Flow break
  if (style.flowBreakBefore && style.flowBreakBefore !== 'none') {
    parts.push(`SaltoBefore:${style.flowBreakBefore}`);
  }

  // Hyphenation
  if (style.hyphenation?.enabled) parts.push('Silabeo');

  return parts.length > 0 ? parts.join(' ') : 'Párrafo';
}

// ── Ensure name uniqueness by appending index if needed ──────────────────────

export function uniqueParagraphStyleName(baseName, existingStyles) {
  const names = new Set(existingStyles.map(s => s.name));
  if (!names.has(baseName)) return baseName;

  let i = 1;
  while (names.has(`${baseName} ${i}`)) i++;
  return `${baseName} ${i}`;
}

// ── Extract only the visual properties from a paragraph style (strip id/name) ─

export function extractParagraphStyleProps(style) {
  const props = {};
  for (const key of PARAGRAPH_STYLE_PROPS) {
    if (style[key] !== undefined) props[key] = style[key];
  }
  return props;
}

// ── Resolve a paragraphStyleId to its full properties ────────────────────────
// Falls back to default paragraph style if not found

export function resolveParagraphStyle(paragraphStyleId, styles) {
  if (!paragraphStyleId) return createDefaultParagraphStyle();
  return styles.find(s => s.id === paragraphStyleId) ?? createDefaultParagraphStyle();
}
