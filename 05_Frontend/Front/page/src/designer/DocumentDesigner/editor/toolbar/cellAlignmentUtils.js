// cellAlignmentUtils.js — Helpers for the cell-alignment 3×3 grid.
// Kept separate from the .jsx component so Fast Refresh works correctly
// (the eslint rule only-export-components flags mixing components + utils).

/**
 * Derive `{ value, mixed }` from a list of cell objects (same shape used in
 * CellPropertiesPanel / Ribbon). Treats missing hAlign as `null` so the grid
 * shows no highlight when the cell is still inheriting from the paragraph
 * style — clicking a button always promotes it to an explicit cell override.
 */
export function deriveAlignmentValue(cells = []) {
  if (!cells.length) return { value: null, mixed: false };
  const first = cells[0];
  const v0 = first.vAlign ?? 'top';
  const h0 = first.hAlign ?? null;
  for (const c of cells) {
    if ((c.vAlign ?? 'top') !== v0) return { value: null, mixed: true };
    if ((c.hAlign ?? null) !== h0)  return { value: null, mixed: true };
  }
  return { value: { vAlign: v0, hAlign: h0 }, mixed: false };
}
