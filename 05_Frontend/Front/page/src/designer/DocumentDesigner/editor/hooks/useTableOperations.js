// editor/hooks/useTableOperations.js — Table CRUD operations (rows, cols, merge, distribute)
//
// Works for both standalone (page elements) and embedded (inside content area)
// tables. All ops are a single setTemplate via patchTableInTemplate (pure),
// so resource-creating ops (table design) compose in one update.

import { useCallback } from 'react';
import { createCellFlow, DEFAULT_BORDER_STYLE_ID } from '../../engine/elementFactory.js';
import { applyTableStylePreset, flattenSingleRowIds, TABLE_STYLE_PRESETS } from '../../engine/tableStyleUtils.js';
import { ensureBorderStyleId, ensureFillStyleId } from '../../engine/tableResourceLink.js';
import { findOrCreateBorderStyle, gcOrphanBorderStyles } from '../../engine/borderStyleUtils.js';
import { buildTableStyleFromPreset } from '../../engine/tableStylePresetBuild.js';

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
}

// Walk an "area tree" (anything with .elements[] embedded items and .children[]
// sub-areas) applying `updater` to the element whose id is `tableId`.
// Used for BOTH the pool `template.contentAreas` and the legacy inline
// `element.areas[]` model. `ref.found` flips to true when the table is located,
// so the caller knows which storage model actually held it.
function patchAreaTree(areas, tableId, updater, ref) {
  return (areas ?? []).map(a => ({
    ...a,
    elements: (a.elements ?? []).map(el => {
      if (el.id !== tableId) return el;
      ref.found = true;
      return updater(el);
    }),
    children: a.children?.length
      ? patchAreaTree(a.children, tableId, updater, ref)
      : (a.children ?? []),
  }));
}

// PURE template transform: patch the table element `tableElId` wherever it
// lives (any page / pool contentAreas / legacy inline el.areas). Returns a
// new template (or the same ref if not found). Lets ops that ALSO create
// resources compose everything in a single setTemplate updater.
export function patchTableInTemplate(t, tableElId, updater) {
  if (!t || !tableElId) return t;
  const wrap = el => ({ ...updater(el), updatedAt: new Date().toISOString() });

  // 1. Standalone table on any page.
  let foundPage = false;
  const pages1 = (t.pages ?? []).map(p => {
    if (!(p.elements ?? []).some(el => el.id === tableElId)) return p;
    foundPage = true;
    return {
      ...p,
      elements: p.elements.map(el => (el.id === tableElId ? wrap(el) : el)),
      updatedAt: new Date().toISOString(),
    };
  });
  if (foundPage) return { ...t, pages: pages1 };

  // 2. Pool contentAreas (top-level + nested children).
  const poolRef = { found: false };
  const contentAreas = patchAreaTree(t.contentAreas ?? [], tableElId, wrap, poolRef);
  if (poolRef.found) return { ...t, contentAreas };

  // 3. Legacy inline model (content area's areas live on the page element).
  const inlineRef = { found: false };
  const pages3 = (t.pages ?? []).map(p => ({
    ...p,
    elements: (p.elements ?? []).map(el =>
      el.areas?.length
        ? { ...el, areas: patchAreaTree(el.areas, tableElId, wrap, inlineRef) }
        : el
    ),
  }));
  if (inlineRef.found) return { ...t, pages: pages3 };

  return t;
}

// Visual top-to-bottom order of single-row ids (walks the rowSet tree like the
// renderer does). el.rowSets ARRAY order is NOT visual order — using it to pick
// a merge anchor can place the anchor below a selected row, so a higher row
// gets spanUp and (if it's the first row) loses the table's top border.
function flattenRowIds(el) {
  const out = [];
  // Dedupe: a linked header-footer (firstHeaderId === headerId, footerId ===
  // lastFooterId — the default) references the same single-row from two slots.
  // Without this the row would appear twice, corrupting the merge anchor order
  // and the spanUp/spanLeft rectangle (the renderer hides the duplicate, so
  // the flat order must match it). Keep in sync with flattenSingleRowIds in
  // TableElement.jsx.
  const seen = new Set();
  const byId = new Map((el.rowSets ?? []).map(r => [r.id, r]));
  function walk(id) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const r = byId.get(id);
    if (!r) return;
    if (r.type === 'single-row') { out.push(r.id); return; }
    if (r.type === 'multiple-rows' || r.type === 'repeated') {
      (r.childIds ?? []).forEach(walk);
      return;
    }
    if (r.type === 'header-footer') {
      ['firstHeaderId', 'headerId', 'bodyId', 'footerId', 'lastFooterId']
        .forEach(k => { if (r[k]) walk(r[k]); });
    }
  }
  walk(el.rootRowSetId);
  return out;
}

// Repoint the selected cells (or all single-row cells when sel is null) to a
// border style id, preserving each cell's existing per-side `enabled` flags.
// Used by the Model-B quick editors after findOrCreateBorderStyle forks a new
// style: the cells need to reference the fork. Cells without a prior border get
// all sides DISABLED (so a fill-only edit doesn't suddenly draw lines).
function repointCellsToStyle(t, tableElId, sel, newStyleId) {
  return patchTableInTemplate(t, tableElId, el => ({
    ...el,
    rowSets: (el.rowSets ?? []).map(rs => {
      if (rs.type !== 'single-row') return rs;
      return {
        ...rs,
        cells: (rs.cells ?? []).map(c => {
          if (sel && !sel.has(`${rs.id}:${c.colId}`)) return c;
          const sides = c.border?.sides ?? {
            top: { enabled: false }, right: { enabled: false },
            bottom: { enabled: false }, left: { enabled: false },
          };
          return { ...c, border: { ...(c.border ?? {}), styleRef: newStyleId, sides } };
        }),
      };
    }),
  }));
}

function makeBlankCell(colId, sourceCell) {
  const src = sourceCell ?? {};
  return {
    colId,
    flow: { ...createCellFlow(), defaultTextStyleId: src.flow?.defaultTextStyleId ?? null },
    vAlign:        src.vAlign        ?? 'top',
    spanLeft:      false,
    spanUp:        false,
    heightType:    src.heightType    ?? 'custom',
    minHeight:     src.minHeight     ?? 0,
    maxHeight:     src.maxHeight     ?? 300000,
    htmlWidth:     src.htmlWidth     ?? 'auto',
    flowToNextPage:    src.flowToNextPage    ?? false,
    alwaysProcess:     src.alwaysProcess     ?? false,
    fillRelativeToCell: src.fillRelativeToCell ?? false,
    paddingTop:    src.paddingTop    ?? 0,
    paddingRight:  src.paddingRight  ?? 0,
    paddingBottom: src.paddingBottom ?? 0,
    paddingLeft:   src.paddingLeft   ?? 0,
    border:        src.border ? { ...src.border } : undefined,
  };
}

function makeBlankSingleRow(columns, fromRowSet) {
  const cells = (columns ?? []).map(col => {
    const tplCell = (fromRowSet?.cells ?? []).find(c => c.colId === col.id);
    return makeBlankCell(col.id, tplCell);
  });
  // An empty inserted row whose cells all have minHeight 0 collapses to ~0px
  // (it has no content to give it height), so the user sees nothing happen.
  // Give it a small visible default — same idea as Word's "insert row".
  const maxMinH = cells.reduce((m, c) => Math.max(m, c.minHeight ?? 0), 0);
  if (maxMinH === 0) cells.forEach(c => { c.minHeight = 8; });
  return {
    id: genId('rs'),
    name: fromRowSet?.name ?? 'Row',
    type: 'single-row',
    cells,
  };
}

export function useTableOperations({ setTemplate }) {

  const patchTable = useCallback((tableElId, updater) => {
    if (!tableElId) return;
    setTemplate(t => patchTableInTemplate(t, tableElId, updater));
  }, [setTemplate]);

  // ── Insert row above/below an existing single-row ──────────────────────
  // Insert ONE blank row above/below `rowSetId`. Pure (el → el'); safe to call
  // repeatedly with the same rowSetId for multi-insert (it's never removed,
  // and after the first call it always has a parent container).
  function insertOneRow(el, rowSetId, position) {
      const target = (el.rowSets ?? []).find(r => r.id === rowSetId);
      if (!target) return el;
      const newRs = makeBlankSingleRow(el.columns ?? [], target.type === 'single-row' ? target : null);

      // Find the parent rowSet whose childIds includes rowSetId
      const parent = (el.rowSets ?? []).find(r => (r.childIds ?? []).includes(rowSetId));
      if (parent) {
        const idx = parent.childIds.indexOf(rowSetId);
        const insertIdx = position === 'above' ? idx : idx + 1;
        return {
          ...el,
          rowSets: [
            ...el.rowSets.map(r => r.id === parent.id ? {
              ...r,
              childIds: [
                ...r.childIds.slice(0, insertIdx),
                newRs.id,
                ...r.childIds.slice(insertIdx),
              ],
            } : r),
            newRs,
          ],
        };
      }

      // No parent: rowSetId might be the root single-row → wrap in multiple-rows
      if (el.rootRowSetId === rowSetId && target.type === 'single-row') {
        const wrapper = {
          id: genId('rs'),
          name: 'Filas',
          type: 'multiple-rows',
          childIds: position === 'above' ? [newRs.id, rowSetId] : [rowSetId, newRs.id],
        };
        return {
          ...el,
          rootRowSetId: wrapper.id,
          rowSets: [...el.rowSets, newRs, wrapper],
        };
      }

      // rowSetId is referenced DIRECTLY by a header-footer slot (a table built
      // with header/body/footer where that section is a single row, not yet a
      // multiple-rows container). Wrap that slot's row in a new multiple-rows
      // container and repoint the slot, so the new row becomes a sibling.
      const HF_SLOTS = ['firstHeaderId', 'headerId', 'bodyId', 'footerId', 'lastFooterId'];
      const hf = (el.rowSets ?? []).find(r =>
        r.type === 'header-footer' && HF_SLOTS.some(k => r[k] === rowSetId)
      );
      if (hf && target.type === 'single-row') {
        const wrapper = {
          id: genId('rs'),
          name: 'Filas',
          type: 'multiple-rows',
          childIds: position === 'above' ? [newRs.id, rowSetId] : [rowSetId, newRs.id],
        };
        const newHf = { ...hf };
        for (const k of HF_SLOTS) if (newHf[k] === rowSetId) newHf[k] = wrapper.id;
        return {
          ...el,
          rowSets: [
            ...el.rowSets.map(r => r.id === hf.id ? newHf : r),
            newRs,
            wrapper,
          ],
        };
      }
      return el;
  }

  // Word-like multi-insert: inserts `count` blank rows (1 by default; N when
  // N rows are selected). Single state update — loops the pure insertOneRow.
  const tableInsertRow = useCallback((tableElId, rowSetId, position, count = 1) => {
    const n = Math.max(1, count | 0);
    patchTable(tableElId, el => {
      let cur = el;
      for (let i = 0; i < n; i++) cur = insertOneRow(cur, rowSetId, position);
      return cur;
    });
  }, [patchTable]);

  // ── Remove one or more rows ────────────────────────────────────────────
  const tableRemoveRows = useCallback((tableElId, rowSetIds) => {
    if (!rowSetIds?.length) return;
    const removeSet = new Set(rowSetIds);
    patchTable(tableElId, el => {
      // Keep at least one single-row in the table
      const remainingSingleRows = (el.rowSets ?? []).filter(r =>
        r.type === 'single-row' && !removeSet.has(r.id)
      );
      if (remainingSingleRows.length === 0) return el;

      const filteredRowSets = (el.rowSets ?? [])
        .filter(r => !removeSet.has(r.id))
        .map(r => r.childIds
          ? { ...r, childIds: r.childIds.filter(id => !removeSet.has(id)) }
          : r
        );

      // Clear header/footer slot references that pointed at removed rows
      const cleaned = filteredRowSets.map(r => {
        if (r.type !== 'header-footer') return r;
        const slots = ['headerId', 'firstHeaderId', 'bodyId', 'footerId', 'lastFooterId'];
        const next = { ...r };
        for (const k of slots) {
          if (removeSet.has(next[k])) next[k] = null;
        }
        return next;
      });

      return { ...el, rowSets: cleaned };
    });
  }, [patchTable]);

  // ── Insert column left/right of an existing column ─────────────────────
  // Insert ONE blank column left/right of `refColId`. Pure (el → el').
  function insertOneCol(el, refColId, position) {
      const refIdx = (el.columns ?? []).findIndex(c => c.id === refColId);
      if (refIdx === -1) return el;
      const insertIdx = position === 'left' ? refIdx : refIdx + 1;
      const newColId = genId('col');
      const newColCount = el.columns.length + 1;
      const ratio = 1 / newColCount;
      const newCol = {
        id: newColId,
        label: `Col. ${newColCount}`,
        widthRatio: ratio,
        minWidth: 5,
      };
      const newColumns = [
        ...el.columns.slice(0, insertIdx),
        newCol,
        ...el.columns.slice(insertIdx),
      ].map(c => ({ ...c, widthRatio: ratio }));

      const newRowSets = (el.rowSets ?? []).map(rs => {
        if (rs.type !== 'single-row') return rs;
        // Word-like: the new column's cell inherits the border + formatting of
        // its sibling — the cell of the reference column in the SAME row.
        const siblingCell = (rs.cells ?? []).find(c => c.colId === refColId);
        const newCell = makeBlankCell(newColId, siblingCell);
        return {
          ...rs,
          cells: [
            ...(rs.cells ?? []).slice(0, insertIdx),
            newCell,
            ...(rs.cells ?? []).slice(insertIdx),
          ],
        };
      });

      return { ...el, columns: newColumns, rowSets: newRowSets };
  }

  // Word-like multi-insert: inserts `count` blank columns (N when N columns
  // are selected). Single state update — loops the pure insertOneCol.
  const tableInsertColumn = useCallback((tableElId, refColId, position, count = 1) => {
    const n = Math.max(1, count | 0);
    patchTable(tableElId, el => {
      let cur = el;
      for (let i = 0; i < n; i++) cur = insertOneCol(cur, refColId, position);
      return cur;
    });
  }, [patchTable]);

  // ── Remove one or more columns ─────────────────────────────────────────
  const tableRemoveColumns = useCallback((tableElId, colIds) => {
    if (!colIds?.length) return;
    const removeSet = new Set(colIds);
    patchTable(tableElId, el => {
      const newColumns = (el.columns ?? []).filter(c => !removeSet.has(c.id));
      if (newColumns.length === 0) return el; // Don't remove the last column
      const ratio = 1 / newColumns.length;
      const equalized = newColumns.map(c => ({ ...c, widthRatio: ratio }));
      const newRowSets = (el.rowSets ?? []).map(rs => {
        if (rs.type !== 'single-row') return rs;
        return { ...rs, cells: (rs.cells ?? []).filter(c => !removeSet.has(c.colId)) };
      });
      return { ...el, columns: equalized, rowSets: newRowSets };
    });
  }, [patchTable]);

  // ── Distribute columns equally ─────────────────────────────────────────
  // colIds=null → all; colIds=[a,b,c] → only those (preserving the rest's combined ratio)
  const tableDistributeColumns = useCallback((tableElId, colIds) => {
    patchTable(tableElId, el => {
      const cols = el.columns ?? [];
      if (cols.length === 0) return el;
      if (!colIds || colIds.length < 2) {
        const ratio = 1 / cols.length;
        return { ...el, columns: cols.map(c => ({ ...c, widthRatio: ratio })) };
      }
      const sel = new Set(colIds);
      const selRatio = cols.filter(c => sel.has(c.id)).reduce((s, c) => s + (c.widthRatio ?? 0), 0);
      const each = selRatio / colIds.length;
      return { ...el, columns: cols.map(c => sel.has(c.id) ? { ...c, widthRatio: each } : c) };
    });
  }, [patchTable]);

  // ── Distribute rows equally (sets the same minHeight on each cell) ─────
  const tableDistributeRows = useCallback((tableElId, rowSetIds) => {
    patchTable(tableElId, el => {
      const allSingleRows = (el.rowSets ?? []).filter(r => r.type === 'single-row');
      const targets = rowSetIds && rowSetIds.length >= 2
        ? allSingleRows.filter(r => rowSetIds.includes(r.id))
        : allSingleRows;
      if (targets.length < 2) return el;
      const totalH = targets.reduce((sum, r) => {
        const max = (r.cells ?? []).reduce((m, c) => Math.max(m, c.minHeight ?? 0), 0);
        return sum + max;
      }, 0);
      if (totalH === 0) return el;
      const eachH = totalH / targets.length;
      const targetIds = new Set(targets.map(r => r.id));
      return {
        ...el,
        rowSets: el.rowSets.map(r => targetIds.has(r.id) ? {
          ...r,
          cells: (r.cells ?? []).map(c => ({ ...c, minHeight: eachH })),
        } : r),
      };
    });
  }, [patchTable]);

  // ── Table design: apply a whole-table style preset ─────────────────────
  // Resource-backed: find-or-creates the border style (color via fill style)
  // and the header fill style, then writes styleRef/fillStyleId refs on the
  // cells. Only touches border/fill (preserves spanLeft/spanUp/flow), so it
  // never breaks merges or the vertical-merge anchor overlay.
  const tableApplyStyle = useCallback((tableElId, presetKey) => {
    setTemplate(t => {
      const p = TABLE_STYLE_PRESETS[presetKey];
      if (!p) return t;
      let tt = t, borderStyleId = null, headerFillStyleId = null;
      if (p.border !== 'none') {
        const r = ensureBorderStyleId(tt, { width: 0.25, style: 'solid', hex: '#000000' });
        tt = r.t; borderStyleId = r.borderStyleId;
      }
      if (p.header) {
        const r = ensureFillStyleId(tt, p.header);
        tt = r.t; headerFillStyleId = r.fillStyleId;
      }
      return patchTableInTemplate(tt, tableElId, el =>
        applyTableStylePreset(el, presetKey, { borderStyleId, headerFillStyleId }));
    });
  }, [setTemplate]);

  // ── Apply a Table Style (resource) to the whole table ─────────────────
  // Works for standalone AND embedded tables (patchTableInTemplate locates it).
  // Applying a Table Style makes it GOVERN the table's look, so we clear the
  // per-cell border overrides — otherwise the manual cell borders (e.g. those
  // baked by InsertTableDialog) would win and the Table Style would be
  // invisible. This keeps it ATADO: the table reads from the Table Style →
  // editing the style propagates. Manual painting afterwards re-adds per-cell
  // overrides on specific cells.
  const tableSetTableStyle = useCallback((tableElId, tableStyleId) => {
    setTemplate(t => patchTableInTemplate(t, tableElId, el => ({
      ...el,
      tableStyleRef: tableStyleId ?? null,
      rowSets: tableStyleId
        ? (el.rowSets ?? []).map(rs => rs.type !== 'single-row' ? rs : {
            ...rs,
            cells: (rs.cells ?? []).map(c => c.border ? { ...c, border: null } : c),
          })
        : (el.rowSets ?? []),
    })));
  }, [setTemplate]);

  // Create (or reuse) a Table Style from a quick-template preset and apply it.
  // The new style + its border/fill/color resources appear in Recursos.
  const tableCreateStyleFromPreset = useCallback((tableElId, presetKey) => {
    setTemplate(t => {
      const { t: t1, tableStyleId } = buildTableStyleFromPreset(t, presetKey);
      if (!tableStyleId) return t;
      return patchTableInTemplate(t1, tableElId, el => ({
        ...el,
        tableStyleRef: tableStyleId,
        rowSets: (el.rowSets ?? []).map(rs => rs.type !== 'single-row' ? rs : {
          ...rs,
          cells: (rs.cells ?? []).map(c => c.border ? { ...c, border: null } : c),
        }),
      }));
    });
  }, [setTemplate]);

  // ── Model B: edit a property of the ACTIVE border style ────────────────
  // The borderStyle is the cell's COMPLETE box style (lines + fill + corners).
  // `changes` is a partial border-style props object (e.g. { lineColor } from
  // Pluma or { fillFillStyleId } from Sombreado). findOrCreateBorderStyle forks
  // the default (never mutates it) or edits a named style in place; if it
  // forked, we repoint the selected cells to the new style.
  const tableEditActiveStyle = useCallback((tableElId, cells, activeStyleId, changes, opts) => {
    const sel = (cells ?? []).length
      ? new Set(cells.map(c => `${c.rowSetId}:${c.colId}`))
      : null;                       // null = whole table
    setTemplate(t => {
      let t1 = t;
      const finalChanges = { ...changes };
      // A line color given as hex needs a fill-style resource (atado chain:
      // lineFillStyleId → fill style → color). Set both so the renderer's
      // resolveLinkedColor (lineFillStyleId wins) shows the right color.
      if (finalChanges.lineColorHex) {
        const r = ensureFillStyleId(t1, finalChanges.lineColorHex);
        t1 = r.t;
        finalChanges.lineFillStyleId = r.fillStyleId;
        finalChanges.lineColor = finalChanges.lineColorHex;
        delete finalChanges.lineColorHex;
      }
      const baseId = activeStyleId ?? DEFAULT_BORDER_STYLE_ID;
      const { t: t2, id: newId } = findOrCreateBorderStyle(t1, baseId, finalChanges, opts);
      // Always forks: repoint the selected cells to the new style, then GC any
      // now-orphaned auto style the selection moved away from.
      if (newId === baseId) return t2;
      return gcOrphanBorderStyles(repointCellsToStyle(t2, tableElId, sel, newId));
    });
  }, [setTemplate]);

  // ── Table design: cell shading (Word "Sombreado") — Model B ────────────
  // The fill lives INSIDE the cell's border style (borderStyle.fillFillStyleId).
  // So shading edits the active style's fill (fork from default / edit named).
  //
  // `value` can be:
  //   • null / ''            → clear the fill (fillFillStyleId = null).
  //   • '#rrggbb' (string)   → ensure a fill-style resource for that hex,
  //                            then set it as the active border style's fill.
  //   • { fillStyleId }      → use the given fill-style resource directly.
  const tableSetCellFill = useCallback((tableElId, cells, value, activeStyleId) => {
    const sel = (cells ?? []).length
      ? new Set(cells.map(c => `${c.rowSetId}:${c.colId}`))
      : null;
    setTemplate(t => {
      let t1 = t;
      let fillFillStyleId = null;
      if (value && typeof value === 'object' && value.fillStyleId) {
        fillFillStyleId = value.fillStyleId;
      } else if (value) {
        const r = ensureFillStyleId(t, value);
        t1 = r.t; fillFillStyleId = r.fillStyleId;
      }
      const baseId = activeStyleId ?? DEFAULT_BORDER_STYLE_ID;
      const { t: t2, id: newId } = findOrCreateBorderStyle(t1, baseId, { fillFillStyleId, fill: '' });
      if (newId === baseId) return t2;
      return gcOrphanBorderStyles(repointCellsToStyle(t2, tableElId, sel, newId));
    });
  }, [setTemplate]);

  // ── Table design: apply borders to a selection (Word "Bordes") ────────
  // side ∈ all | outer | inner | none | top | bottom | left | right.
  // Resource-backed: one border style (pen) is find-or-created and the cell
  // references it via styleRef.
  //
  // TWO MODES (Word-style):
  //
  //   1. Whole-cell (all/outer/inner/none): the cell's `border.styleRef`
  //      becomes the new pen; per-side styleRef overrides are CLEARED.
  //      This is the "apply uniform style" operation.
  //
  //   2. Individual side (top/bottom/left/right): the cell's whole-cell
  //      `border.styleRef` is left UNTOUCHED. Only the painted side gets
  //      a per-side `styleRef` override → `border.sides[side].styleRef = newPen`.
  //      This is what enables per-edge painting (the border painter): you can
  //      have a cell with 4 sides each carrying a different pen.
  //
  // Why it matters: without #2, a 4-bordered cell with a shared `styleRef`
  // would see ALL 4 visible sides flip to the new pen whenever the painter
  // touched one of them — because they all read from the same global ref.
  const tableApplyBorders = useCallback((tableElId, cells, side, pen = {}) => {
    const sel = (cells ?? []).length ? cells : null;
    const indivSide = side === 'top' || side === 'bottom' || side === 'left' || side === 'right';

    const applyBorders = (t, borderStyleId) => patchTableInTemplate(t, tableElId, el => {
      const colIds = (el.columns ?? []).map(c => c.id);
      const flat   = flattenSingleRowIds(el.rowSets ?? [], el.rootRowSetId);
      const selRows = sel ? flat.filter(rid => sel.some(c => c.rowSetId === rid)) : flat;
      const selCols = sel ? colIds.filter(cid => sel.some(c => c.colId === cid)) : colIds;
      if (!selRows.length || !selCols.length) return el;
      const rowSet = new Set(selRows), colSet = new Set(selCols);
      const firstR = selRows[0], lastR = selRows[selRows.length - 1];
      const firstC = selCols[0], lastC = selCols[selCols.length - 1];
      // Previously-enabled sides (from a styleRef ref OR a legacy inline border).
      const prevEnabled = c => {
        const s = c.border?.sides;
        return {
          top: !!s?.top?.enabled, right: !!s?.right?.enabled,
          bottom: !!s?.bottom?.enabled, left: !!s?.left?.enabled,
        };
      };
      return {
        ...el,
        rowSets: (el.rowSets ?? []).map(rs => {
          if (rs.type !== 'single-row' || !rowSet.has(rs.id)) return rs;
          const isTop = rs.id === firstR, isBot = rs.id === lastR;
          return {
            ...rs,
            cells: (rs.cells ?? []).map(c => {
              if (!colSet.has(c.colId)) return c;
              if (side === 'none') return { ...c, border: null };
              const isLeft = c.colId === firstC, isRight = c.colId === lastC;

              // ── Individual-side painting: per-side styleRef override.
              // Whole-cell styleRef and the OTHER sides stay as they were.
              if (indivSide) {
                const sideMatches = (side === 'top' && isTop)
                  || (side === 'bottom' && isBot)
                  || (side === 'left'  && isLeft)
                  || (side === 'right' && isRight);
                if (!sideMatches) return c;

                const hadStyleRefBorder = !!c.border && !c.border.inline;
                const prevSides = hadStyleRefBorder ? (c.border.sides ?? {}) : {};
                const prevStyleRef = hadStyleRefBorder ? (c.border.styleRef ?? null) : null;

                // When the cell had NO styleRef border before, the renderer
                // would default the non-painted sides to "enabled" (because
                // the global style enables them). Pin them explicitly to
                // `enabled: false` so only the painted side draws.
                const defaultEnabledFor = (s) => hadStyleRefBorder
                  ? (prevSides[s]?.enabled !== undefined ? prevSides[s].enabled : true)
                  : false;

                const sideObjFor = (s) => s === side
                  ? { enabled: true, styleRef: borderStyleId }
                  : { ...(prevSides[s] ?? {}), enabled: defaultEnabledFor(s) };

                return {
                  ...c,
                  border: {
                    styleRef: prevStyleRef ?? borderStyleId,
                    sides: {
                      top:    sideObjFor('top'),
                      right:  sideObjFor('right'),
                      bottom: sideObjFor('bottom'),
                      left:   sideObjFor('left'),
                    },
                  },
                };
              }

              // ── Whole-cell modes (all / outer / inner): replace whole-cell
              // styleRef and rebuild side flags. Per-side styleRef overrides
              // are intentionally CLEARED (these are "apply uniform" ops).
              const e = prevEnabled(c);
              if (side === 'all') { e.top = e.right = e.bottom = e.left = true; }
              else if (side === 'outer') {
                if (isTop) e.top = true; if (isBot) e.bottom = true;
                if (isLeft) e.left = true; if (isRight) e.right = true;
              } else if (side === 'inner') {
                if (!isBot) e.bottom = true; if (!isRight) e.right = true;
              }
              return {
                ...c,
                border: { styleRef: borderStyleId, sides: {
                  top: { enabled: e.top }, right: { enabled: e.right },
                  bottom: { enabled: e.bottom }, left: { enabled: e.left },
                } },
              };
            }),
          };
        }),
      };
    });

    setTemplate(t => {
      if (side === 'none') return gcOrphanBorderStyles(applyBorders(t, null));
      // Direct borderStyleId in the pen → skip the find-or-create and use the
      // resource as-is (the active style from the ribbon, or a picked/created
      // one). Verifies it still exists; otherwise falls through to the auto
      // path so we don't write a dangling reference.
      if (pen.borderStyleId) {
        const exists = (t.styles?.border ?? []).some(s => s.id === pen.borderStyleId);
        if (exists) return gcOrphanBorderStyles(applyBorders(t, pen.borderStyleId));
      }
      const { t: t1, borderStyleId } = ensureBorderStyleId(t, {
        width: pen.width ?? 0.5, style: pen.style ?? 'solid', hex: pen.color ?? '#000000',
      });
      return gcOrphanBorderStyles(applyBorders(t1, borderStyleId));
    });
  }, [setTemplate]);

  // ── Merge cells using the rectangular hull of selection ────────────────
  // cells: [{ rowSetId, colId }]. Top-left of the rectangle is the anchor;
  // others get spanLeft (cells right of anchor in same row) or spanUp
  // (anchor column, rows below the anchor row) or both.
  const tableMergeCells = useCallback((tableElId, cells) => {
    if (!cells || cells.length < 2) return;
    patchTable(tableElId, el => {
      const rowSetIds = [...new Set(cells.map(c => c.rowSetId))];
      const colIds = [...new Set(cells.map(c => c.colId))];

      // Order rows by VISUAL position so the anchor is the truly top-left
      // selected cell — otherwise spanUp can land on a higher (e.g. first)
      // row and erase the table's top border there.
      const selRows = new Set(rowSetIds);
      const rowOrder = flattenRowIds(el).filter(id => selRows.has(id));
      const colOrder = (el.columns ?? [])
        .filter(c => colIds.includes(c.id))
        .map(c => c.id);
      if (rowOrder.length === 0 || colOrder.length === 0) return el;

      const anchorRowId = rowOrder[0];
      const anchorColId = colOrder[0];
      const rowSet = new Set(rowOrder);
      const colSet = new Set(colOrder);

      return {
        ...el,
        rowSets: (el.rowSets ?? []).map(rs => {
          if (!rowSet.has(rs.id)) return rs;
          const isAnchorRow = rs.id === anchorRowId;
          return {
            ...rs,
            cells: (rs.cells ?? []).map(c => {
              if (!colSet.has(c.colId)) return c;
              const isAnchorCol = c.colId === anchorColId;
              if (isAnchorRow && isAnchorCol) {
                return { ...c, spanLeft: false, spanUp: false };
              }
              return {
                ...c,
                spanLeft: !isAnchorCol,
                spanUp:   !isAnchorRow && isAnchorCol,
              };
            }),
          };
        }),
      };
    });
  }, [patchTable]);

  // Unmerge: from ANY cell of a merged block (the visible anchor — which is
  // what the user can actually click — or a spanned cell), find the whole
  // rectangle and clear spanLeft/spanUp across all of it. The anchor itself
  // has no span, and spanned cells render display:none and can't be selected,
  // so clearing only the literally-selected cells never worked.
  const tableUnmergeCells = useCallback((tableElId, cells) => {
    if (!cells?.length) return;
    patchTable(tableElId, el => {
      const colOrder   = (el.columns ?? []).map(c => c.id);
      const singleRows = (el.rowSets ?? []).filter(r => r.type === 'single-row');
      const rowOrder   = singleRows.map(r => r.id);
      const cellOf = (rsId, colId) =>
        (singleRows.find(r => r.id === rsId)?.cells ?? []).find(c => c.colId === colId);

      const clear = {}; // rowSetId -> Set(colId)
      const add = (rsId, colId) => { (clear[rsId] ??= new Set()).add(colId); };

      for (const sel of cells) {
        let ci = colOrder.indexOf(sel.colId);
        let ri = rowOrder.indexOf(sel.rowSetId);
        if (ci < 0 || ri < 0) continue;
        // Walk back to the block anchor (left while spanLeft, up while spanUp).
        while (ci > 0 && cellOf(rowOrder[ri], colOrder[ci])?.spanLeft) ci--;
        while (ri > 0 && cellOf(rowOrder[ri], colOrder[ci])?.spanUp)   ri--;
        // Rectangle extent from the anchor.
        let maxC = ci;
        for (let j = ci + 1; j < colOrder.length; j++) {
          if (cellOf(rowOrder[ri], colOrder[j])?.spanLeft) maxC = j; else break;
        }
        let maxR = ri;
        for (let k = ri + 1; k < rowOrder.length; k++) {
          if (cellOf(rowOrder[k], colOrder[ci])?.spanUp) maxR = k; else break;
        }
        for (let r = ri; r <= maxR; r++)
          for (let c2 = ci; c2 <= maxC; c2++)
            add(rowOrder[r], colOrder[c2]);
      }

      return {
        ...el,
        rowSets: (el.rowSets ?? []).map(rs => {
          const set = clear[rs.id];
          if (!set) return rs;
          return {
            ...rs,
            cells: (rs.cells ?? []).map(c =>
              set.has(c.colId) ? { ...c, spanLeft: false, spanUp: false } : c
            ),
          };
        }),
      };
    });
  }, [patchTable]);

  // ── Update cell(s) ─────────────────────────────────────────────────────
  const tableUpdateCell = useCallback((tableElId, rowSetId, colId, changes) => {
    patchTable(tableElId, el => ({
      ...el,
      rowSets: (el.rowSets ?? []).map(rs =>
        rs.id !== rowSetId ? rs : {
          ...rs,
          cells: (rs.cells ?? []).map(c =>
            c.colId !== colId ? c : { ...c, ...changes }
          ),
        }
      ),
    }));
  }, [patchTable]);

  const tableUpdateCells = useCallback((tableElId, cells, changes) => {
    if (!cells?.length) return;
    const lookup = {};
    for (const c of cells) {
      if (!lookup[c.rowSetId]) lookup[c.rowSetId] = new Set();
      lookup[c.rowSetId].add(c.colId);
    }
    patchTable(tableElId, el => ({
      ...el,
      rowSets: (el.rowSets ?? []).map(rs => {
        const set = lookup[rs.id];
        if (!set) return rs;
        return {
          ...rs,
          cells: (rs.cells ?? []).map(c =>
            set.has(c.colId) ? { ...c, ...changes } : c
          ),
        };
      }),
    }));
  }, [patchTable]);

  return {
    tableInsertRow,
    tableRemoveRows,
    tableInsertColumn,
    tableRemoveColumns,
    tableDistributeColumns,
    tableDistributeRows,
    tableMergeCells,
    tableUnmergeCells,
    tableUpdateCell,
    tableUpdateCells,
    tableApplyStyle,
    tableSetCellFill,
    tableApplyBorders,
    tableEditActiveStyle,
    tableSetTableStyle,
    tableCreateStyleFromPreset,
  };
}
