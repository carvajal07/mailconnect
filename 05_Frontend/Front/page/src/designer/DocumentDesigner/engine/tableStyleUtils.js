// tableStyleUtils.js — shared table-design helpers (Word-like "Diseño de tabla").
//
// Single source of truth for the POSITIONAL cell-border builder (shared by
// InsertTableDialog when creating a table and by tableApplyStyle when applying
// a preset to an existing table) and for the table-style presets gallery.

// ── Positional cell border ────────────────────────────────────────────────
// Builds the `cell.border` payload for ONE cell based on its position.
//   - null / { preset:'none' } → undefined (no border)
//   - { styleId, preset }      → styleRef + per-side enabled flags
//   - { preset, color, width } → inline sides with embedded color/width
export function makeCellBorder(borderRef, colIdx, colCount, isFirstRow, isLastRow) {
  if (!borderRef || borderRef.preset === 'none') return undefined;
  const isFirstCol = colIdx === 0;
  const isLastCol  = colIdx === colCount - 1;
  const all = borderRef.preset === 'all';

  if (borderRef.styleId) {
    return {
      styleRef: borderRef.styleId,
      sides: {
        top:    { enabled: isFirstRow },
        bottom: { enabled: isLastRow || all },
        left:   { enabled: isFirstCol },
        right:  { enabled: isLastCol || all },
      },
    };
  }

  const side = on => ({
    enabled: on,
    lineWidth: borderRef.width ?? 0.25,
    lineStyle: 'Solid',
    lineColor: borderRef.color ?? '#000000',
  });
  return {
    inline: true,
    sides: {
      top:    side(isFirstRow),
      bottom: side(isLastRow || all),
      left:   side(isFirstCol),
      right:  side(isLastCol || all),
    },
  };
}

// ── Visual row order ──────────────────────────────────────────────────────
// Flatten rowSets into the visible single-row ids, deduped (a linked
// header-footer references the same single-row from two slots — keep in sync
// with flattenSingleRowIds in TableElement.jsx).
export function flattenSingleRowIds(rowSets, rootRowSetId) {
  const out = [];
  const seen = new Set();
  const byId = new Map((rowSets ?? []).map(r => [r.id, r]));
  function walk(id) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const rs = byId.get(id);
    if (!rs) return;
    if (rs.type === 'single-row') { out.push(rs.id); return; }
    if (rs.type === 'multiple-rows' || rs.type === 'repeated') {
      for (const cid of (rs.childIds ?? [])) walk(cid);
      return;
    }
    if (rs.type === 'header-footer') {
      for (const slot of ['firstHeaderId', 'headerId', 'bodyId', 'footerId', 'lastFooterId']) {
        if (rs[slot]) walk(rs[slot]);
      }
    }
  }
  walk(rootRowSetId);
  return out;
}

// Set of single-row ids that belong to a HEADER section (for header shading).
function headerRowIdSet(el) {
  const root = (el.rowSets ?? []).find(r => r.id === el.rootRowSetId);
  if (!root || root.type !== 'header-footer') return new Set();
  const slots = [root.firstHeaderId, root.headerId].filter(Boolean);
  const ids = new Set();
  for (const slot of slots) {
    for (const id of flattenSingleRowIds(el.rowSets ?? [], slot)) ids.add(id);
  }
  return ids;
}

// ── Presets gallery ───────────────────────────────────────────────────────
// border: 'none' | 'exterior' | 'all'  (positional, via makeCellBorder)
// odd/even: body banded-row colors (null = clear)
// header: header-section cell fill color (null = none)
export const TABLE_STYLE_PRESETS = {
  none:         { label: 'Sin bordes',          border: 'none',     odd: null,      even: null,      header: null },
  grid:         { label: 'Cuadrícula',          border: 'all',      odd: null,      even: null,      header: null },
  outline:      { label: 'Solo contorno',       border: 'exterior', odd: null,      even: null,      header: null },
  header:       { label: 'Cabecera',            border: 'all',      odd: null,      even: null,      header: '#dbeafe' },
  banded:       { label: 'Filas alternas',      border: 'exterior', odd: '#f1f5f9', even: '#ffffff', header: null },
  headerBanded: { label: 'Cabecera + alternas', border: 'all',      odd: '#eff6ff', even: '#ffffff', header: '#bfdbfe' },
  accentBlue:   { label: 'Acento azul',         border: 'all',      odd: '#eff6ff', even: '#ffffff', header: '#3b82f6' },
  accentGray:   { label: 'Acento gris',         border: 'all',      odd: '#f3f4f6', even: '#ffffff', header: '#374151' },
};

export const TABLE_STYLE_PRESET_LIST = Object.entries(TABLE_STYLE_PRESETS)
  .map(([key, p]) => ({ key, ...p }));

// Returns a NEW table element with the preset applied. ONLY touches
// `cell.border` / `cell.fill` and `element.oddRowColor`/`evenRowColor`.
// Preserves `spanLeft`/`spanUp`/`flow` and all other cell fields (… spread).
// `opts.borderStyleId` / `opts.headerFillStyleId`: when provided, borders use
// the styleRef path (resource-backed, reusable) and the header shading uses a
// fill-style ref instead of an inline hex. The caller (tableApplyStyle) is
// responsible for find-or-creating those resources in the template first.
export function applyTableStylePreset(el, presetKey, {
  color = '#000000', width = 0.25, borderStyleId = null, headerFillStyleId = null,
} = {}) {
  const p = TABLE_STYLE_PRESETS[presetKey];
  if (!p || !el) return el;
  const cols = el.columns ?? [];
  const flat = flattenSingleRowIds(el.rowSets ?? [], el.rootRowSetId);
  const firstRowId = flat[0];
  const lastRowId  = flat[flat.length - 1];
  const hdr = headerRowIdSet(el);
  const borderRef = p.border === 'none'
    ? { preset: 'none' }
    : (borderStyleId
        ? { preset: p.border, styleId: borderStyleId }   // resource-backed
        : { preset: p.border, color, width });            // inline fallback

  const rowSets = (el.rowSets ?? []).map(rs => {
    if (rs.type !== 'single-row') return rs;
    const isFirst  = rs.id === firstRowId;
    const isLast   = rs.id === lastRowId;
    const isHeader = hdr.has(rs.id);
    return {
      ...rs,
      cells: (rs.cells ?? []).map(c => {
        const colIdx = cols.findIndex(col => col.id === c.colId);
        const b = makeCellBorder(borderRef, colIdx < 0 ? 0 : colIdx, cols.length, isFirst, isLast);
        const fill = (isHeader && p.header)
          ? (headerFillStyleId ? { fillStyleId: headerFillStyleId } : { color: p.header })
          : null;
        return {
          ...c,                                   // keeps spanLeft/spanUp/flow/etc.
          border: b ?? null,
          fill,
        };
      }),
    };
  });

  return {
    ...el,
    rowSets,
    oddRowColor:  p.odd  ?? undefined,
    evenRowColor: p.even ?? undefined,
    tableStyleKey: presetKey,                     // remembered for gallery highlight
    updatedAt: new Date().toISOString(),
  };
}
