// engine/tableStyleResolve.js — pure resolver for Table Styles.
//
// Given a Table Style resource and a cell's ROLE (region) + column position,
// returns the borderStyle id that should style that cell. This is the single
// source of truth for "how a Table Style maps to each cell" — used by the
// designer preview AND meant as the contract the Python/ReportLab engine must
// mirror so the look replicates across repeated rows.
//
// Region (by role, not row instance):
//   'firstHeader' | 'header' | 'oddBody' | 'evenBody' | 'footer' | 'lastFooter'
// Column position is derived from colIndex (0-based) + colCount, gated by the
// Table Style's General-tab flags (useDifferentFirst/Last/OddEvenColumns).
//
// Precedence: first/last column overrides win, then odd/even,
// then the region's default `columns` slot. Returns null when nothing applies.

// Sibling regions: when a region's slot is Empty, fall back to its sibling so
// that defining only "First header" (or only "Header") styles both — i.e. when
// the user doesn't distinguish them. Same for footer/lastFooter and the two
// body parities (set odd only → even uses it too).
const SIBLING_REGION = {
  firstHeader: 'header',
  header:      'firstHeader',
  footer:      'lastFooter',
  lastFooter:  'footer',
  oddBody:     'evenBody',
  evenBody:    'oddBody',
};

export function resolveTableStyleBorderRef(tableStyle, region, colIndex, colCount) {
  const direct = resolveInRegion(tableStyle, region, colIndex, colCount);
  if (direct) return direct;
  const sib = SIBLING_REGION[region];
  return sib ? resolveInRegion(tableStyle, sib, colIndex, colCount) : null;
}

function resolveInRegion(tableStyle, region, colIndex, colCount) {
  if (!tableStyle) return null;
  const reg = tableStyle.regions?.[region];
  if (!reg) return null;

  const isFirst = colIndex === 0;
  const isLast  = colIndex === colCount - 1;
  // 1-based "odd" → the 1st, 3rd, … columns (colIndex 0, 2, …).
  const isOddCol = (colIndex % 2) === 0;

  // Last column (with odd/even split when that flag is on).
  if (tableStyle.useDifferentLastColumns && isLast && colCount > 1) {
    if (tableStyle.useDifferentOddEvenColumns) {
      const ref = isOddCol ? reg.lastOddColumn : reg.lastEvenColumn;
      if (ref) return ref;
    } else if (reg.lastColumn) {
      return reg.lastColumn;
    }
  }
  // First column.
  if (tableStyle.useDifferentFirstColumns && isFirst && reg.firstColumn) {
    return reg.firstColumn;
  }
  // Odd / even columns (excludes first/last when those flags handled above).
  if (tableStyle.useDifferentOddEvenColumns) {
    const ref = isOddCol ? reg.oddColumn : reg.evenColumn;
    if (ref) return ref;
  }
  // Region default.
  return reg.columns ?? null;
}

// Map a rendered single-row to its Table Style region.
//   slotKey: which header-footer slot the row belongs to (or null for plain body)
//   bodyRowIndex: 0-based index of the row within the repeating body (parity)
export function regionForRow(slotKey, bodyRowIndex = 0) {
  switch (slotKey) {
    case 'firstHeader': return 'firstHeader';
    case 'header':      return 'header';
    case 'footer':      return 'footer';
    case 'lastFooter':  return 'lastFooter';
    case 'body':
    default:
      // Body rows alternate odd/even by visual order (1st row = odd).
      return (bodyRowIndex % 2) === 0 ? 'oddBody' : 'evenBody';
  }
}
