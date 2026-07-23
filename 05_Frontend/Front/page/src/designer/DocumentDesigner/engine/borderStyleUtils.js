// engine/borderStyleUtils.js — find-or-create for border styles (Model B).
//
// A borderStyle is the COMPLETE cell box style: lines + fill + corners +
// shadow. Quick ribbon actions (Pluma = lines, Sombreado = fill) edit the
// "active" border style through findOrCreateBorderStyle.
//
// MODEL (Opción 1, the user's choice): quick actions ALWAYS FORK — a change
// applies only to the SELECTED cells, never to the others sharing the style.
//   • Build the new look = current props + the change.
//   • Dedupe: if an identical look already exists, reuse it (no new style).
//   • Else create a new style, marked `system: true` (auto-generated). The GC
//     removes such styles when they fall to 0 references (see gcOrphanBorderStyles).
//   • The `system` flag is cleared the moment the user renames / edits the
//     style in the Resources panel — then it's "owned" and never auto-removed.
//
// To change a style for ALL the cells using it, edit the resource in the
// Resources panel (updateBorderStyle mutates in place + propagates).
//
// Pure: returns { t: nextTemplate, id }. Caller repoints the selected cells to
// `id` (when it differs from the current id) and runs the GC.

import { createDefaultBorderStyle, genId } from './elementFactory.js';

// ── Identity props (the visual "look"; positional `sides.enabled` excluded) ──
const LINE_PROPS = ['lineWidth', 'lineStyle', 'lineColor', 'lineFillStyleId', 'lineCap'];
const FILL_PROPS = ['fill', 'fillFillStyleId'];
const CORNER_PROPS = ['corner', 'radiusX', 'radiusY'];
const IDENTITY_PROPS = [...LINE_PROPS, ...FILL_PROPS, ...CORNER_PROPS];

function looksEqual(a, b) {
  for (const k of IDENTITY_PROPS) {
    if ((a?.[k] ?? null) !== (b?.[k] ?? null)) return false;
  }
  return true;
}

const STYLE_LABEL = { solid: 'sólido', dashed: 'discontinuo', dotted: 'punteado', double: 'doble' };

// Human-ish name from the look. The fill suffix uses the hint (resolved hex)
// when provided so the auto name reads like "Borde 0.5 pt sólido + fondo".
function buildBorderStyleName(style, fillHint) {
  const w = Math.round((style.lineWidth ?? 0.2) * 100) / 100;
  const st = String(style.lineStyle ?? 'solid').toLowerCase();
  let name = `Borde ${w} pt ${STYLE_LABEL[st] ?? st}`;
  if (style.fillFillStyleId || (style.fill && style.fill !== '')) {
    name += ' + fondo';
  }
  if (fillHint) name += ` ${fillHint}`;
  return name;
}

function uniqueName(base, styles) {
  const names = new Set((styles ?? []).map(s => s.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/**
 * Apply `changes` to the active border style, forking the default or mutating
 * a named style.
 *
 * @param {object} t              template
 * @param {string} currentId      the active borderStyle id (or null → default)
 * @param {object} changes        partial border-style props (line/fill/corner)
 * @param {object} [opts]
 * @param {string} [opts.nameHint]   optional suffix for an auto-generated name
 * @returns {{ t: object, id: string }}
 */
export function findOrCreateBorderStyle(t, currentId, changes = {}, opts = {}) {
  const styles = t.styles?.border ?? [];
  const current = styles.find(s => s.id === currentId)
    ?? styles.find(s => s.isDefault)
    ?? createDefaultBorderStyle();

  // ── Always fork: build the new look by layering changes over a clean copy ──
  const { id: _id, name: _name, isDefault: _def, system: _sys, createdAt: _ca, updatedAt: _ua, ...base } = current;
  const merged = { ...base, ...changes };

  // Dedupe: if any existing style (incl. the current one when changes are a
  // no-op) has the exact look, reuse it instead of creating a duplicate.
  const match = styles.find(s => !s.isDefault && looksEqual(s, merged));
  if (match) return { t, id: match.id };

  const id = genId('bs');
  const name = uniqueName(buildBorderStyleName(merged, opts.nameHint), styles);
  const now = new Date().toISOString();
  return {
    t: { ...t, styles: { ...t.styles, border: [...styles, { id, name, ...merged, system: true, createdAt: now, updatedAt: now }] } },
    id,
  };
}

// ── GC: remove auto-generated (system) border styles with 0 references ───────
// Keeps the document clean as the user experiments: forking on every tweak
// would otherwise leave orphans behind. Never touches the default or any style
// the user has named/edited (those have system cleared).
function _collectUsedBorderStyleIds(t) {
  const used = new Set();
  const scanCell = c => {
    const b = c?.border;
    if (!b) return;
    if (b.styleRef) used.add(b.styleRef);
    const sd = b.sides;
    if (sd) for (const s of ['top', 'right', 'bottom', 'left']) {
      if (sd[s]?.styleRef) used.add(sd[s].styleRef);
    }
  };
  const scanTable = el => {
    if (el?.type !== 'table') return;
    for (const rs of el.rowSets ?? []) for (const c of rs.cells ?? []) scanCell(c);
  };
  const walkAreas = areas => {
    for (const a of areas ?? []) {
      for (const el of a.elements ?? []) scanTable(el);
      if (a.children?.length) walkAreas(a.children);
    }
  };
  for (const p of t.pages ?? []) {
    for (const el of p.elements ?? []) {
      scanTable(el);
      if (el.areas?.length) walkAreas(el.areas);
    }
  }
  walkAreas(t.contentAreas ?? []);
  return used;
}

export function gcOrphanBorderStyles(t) {
  const styles = t.styles?.border ?? [];
  if (!styles.some(s => s.system)) return t;     // nothing auto-generated → skip
  const used = _collectUsedBorderStyleIds(t);
  const kept = styles.filter(s => !s.system || s.isDefault || used.has(s.id));
  if (kept.length === styles.length) return t;
  return { ...t, styles: { ...t.styles, border: kept } };
}
