// editor/canvas/elements/TableElement.jsx — Table preview on canvas

import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveTextStyle } from '../../../engine/textStyleUtils.js';
import { resolveParagraphStyle } from '../../../engine/paragraphStyleUtils.js';
import { resolveTableStyleBorderRef, regionForRow } from '../../../engine/tableStyleResolve.js';
import { mmToPx, PX_PER_MM } from '../../../engine/units.js';
import { resolveLinkedColor, resolveColorHex } from '../../../engine/colorRegistry.js';
import { textStyleToCSS, resolveForDisplay, collectAllAreaNums, splitHtmlAtElementTags, expandAreaTagsForEditor, collapseAreaTagsForEditor } from './contentAreaUtils.js';
import { sanitizeHtml } from './htmlSanitizer.js';
import ImageElement   from './ImageElement.jsx';
import ShapeElement   from './ShapeElement.jsx';
import QRElement      from './QRElement.jsx';
import BarcodeElement from './BarcodeElement.jsx';
import ContentAreaContextMenu from './ContentAreaContextMenu.jsx';
import { DEFAULT_BORDER_STYLE_ID } from '../../../engine/elementFactory.js';
import StyleEditModal from '../../properties/StyleEditModal.jsx';
import { applyParagraphBlockStyles, stripParagraphBlockStyles, resolveParagraphBlocks } from './selectionStyle.js';
import InsertTableDialog, { buildTableStructure } from './InsertTableDialog.jsx';
import { countTablesInTemplate, countRowSetsInTemplate, countCellsInTemplate } from '../../hooks/useTableRowSets.js';
import { patchTableInTemplate } from '../../hooks/useTableOperations.js';
import ObjectListPanel from './ObjectListPanel.jsx';
import TableContextMenu from './TableContextMenu.jsx';
import CellPropertiesModal from './CellPropertiesModal.jsx';
import { insertAreaTag, insertElementTag, buildElementTagLabel } from './variableUtils.js';
import './TableElement.css';

// Render an embedded element inside a table cell (image, shape, qr, barcode).
// Used for both view mode (segmented JSX) and edit mode (createRoot).
function renderCellEmbedded(el, images) {
  if (el.type === 'image')   return <ImageElement element={el} images={images ?? []} />;
  if (el.type === 'shape')   return <ShapeElement element={el} />;
  if (el.type === 'qr')      return <QRElement element={el} />;
  if (el.type === 'barcode') return <BarcodeElement element={el} />;
  return null;
}

// Convert `font-size: Xpt` in stored HTML to 144dpi-scaled px for correct canvas rendering.
// Mirrors ContentAreaElement.applyZoomToInlinePt.
function scaleInlinePt(html, z) {
  if (!html) return html;
  return html.replace(/font-size\s*:\s*([\d.]+)pt/gi, (_, pts) =>
    `font-size: ${(parseFloat(pts) * (144 / 72) * z).toFixed(2)}px`
  );
}

function normalizeRatios(columns) {
  const total = columns.reduce((s, c) => s + (c.widthRatio ?? 1), 0) || 1;
  return columns.map(c => (c.widthRatio ?? 1) / total);
}

const MM_TO_PX = PX_PER_MM; // 144dpi: 144/25.4 ≈ 5.6693

// Compute the style for the rounded outer table root.
// When the table has a named border style (`element.borderStyleId`), we resolve
// the style from `template.styles.border` and use its `corners` + `lineColor` +
// `lineWidth` fields. Otherwise we fall back to the legacy inline fields
// (`tableRadius` / `tableCorners` / `outerBorder`) for tables that haven't
// been migrated to use a named style.
//
// `cellCornersAll` mode is handled by per-cell borderRadius and skips the
// root-level radius entirely — return undefined so cells aren't clipped.
function buildRoundedTableRootStyle(element, borderStyles, colors, fillStyles) {
  if (element?.cellCornersAll) return undefined;

  // Named style path
  if (element?.borderStyleId) {
    const live = (borderStyles ?? []).find(s => s.id === element.borderStyleId);
    if (live) {
      const cn = live.corners ?? {};
      function radiusFor(corner) {
        const cd = cn[corner];
        if (!cd) return 0;
        if (cd.corner === 'Standard') return 0;
        return (cd.radiusX ?? 0) * MM_TO_PX;
      }
      const tlPx = radiusFor('topLeft');
      const trPx = radiusFor('topRight');
      const brPx = radiusFor('bottomRight');
      const blPx = radiusFor('bottomLeft');
      const hasRadius = tlPx > 0 || trPx > 0 || brPx > 0 || blPx > 0;
      // Outer perimeter border: any of the 4 sides enabled in the style
      const sd = live.sides ?? {};
      const anyEnabled = ['top', 'right', 'bottom', 'left'].some(s => sd[s]?.enabled !== false && sd[s]?.enabled !== undefined ? sd[s].enabled : false);
      const w = Math.max(0.5, (live.lineWidth ?? 0.25) * MM_TO_PX);
      const c = resolveLinkedColor(live, colors, fillStyles, '#000000');
      const border = anyEnabled ? `${w}px solid ${c}` : null;
      if (!hasRadius && !border) return undefined;
      return {
        ...(hasRadius ? { borderRadius: `${tlPx}px ${trPx}px ${brPx}px ${blPx}px`, overflow: 'hidden' } : {}),
        ...(border ? { border, boxSizing: 'border-box' } : {}),
      };
    }
  }

  // Legacy inline fallback (kept for backward compat with tables created
  // before the borderStyleId schema existed).
  const r = element?.tableRadius ?? 0;
  if (r <= 0) return undefined;
  const c = element.tableCorners ?? { tl: true, tr: true, br: true, bl: true };
  const px = r * MM_TO_PX;
  const radius = `${c.tl ? px : 0}px ${c.tr ? px : 0}px ${c.br ? px : 0}px ${c.bl ? px : 0}px`;
  const ob = element.outerBorder;
  const border = ob && ob.preset !== 'none'
    ? `${Math.max(0.5, (ob.width ?? 0.25) * MM_TO_PX)}px solid ${ob.color ?? '#000'}`
    : null;
  return {
    borderRadius: radius,
    overflow: 'hidden',
    ...(border ? { border, boxSizing: 'border-box' } : {}),
  };
}


function buildCellBorderCss(border, borderStyles, fillStyles, colors) {
  if (!border) return {};

  if (border.inline) {
    const css = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const sd = border.sides?.[side];
      const key = `border${side.charAt(0).toUpperCase() + side.slice(1)}`;
      if (!sd?.enabled) { css[key] = 'none'; continue; }
      const w = Math.max(0.5, (sd.lineWidth ?? 0.25) * MM_TO_PX);
      const st = (sd.lineStyle ?? 'Solid').toLowerCase();
      const color = resolveLinkedColor(sd, colors, fillStyles, '#000000');
      css[key] = `${w}px ${st} ${color}`;
    }
    return css;
  }

  // ── Whole-cell "default" border style (used by sides without a per-side
  // override). May be null if the cell only has per-side overrides without
  // a default pen — that's valid: the border-painter creates that shape when
  // painting one edge on a cell that had no border.
  const live = border.styleRef
    ? ((borderStyles ?? []).find(s => s.id === border.styleRef) ?? null)
    : null;

  const cellSidesOverride = border.sides ?? null;
  const hasAnyPerSideRef = !!cellSidesOverride
    && ['top','right','bottom','left'].some(s => cellSidesOverride[s]?.styleRef);
  if (!live && !hasAnyPerSideRef) return {};

  const globalWidth = live ? Math.max(0.5, live.lineWidth != null ? live.lineWidth * MM_TO_PX : 1) : 1;
  const globalStyle = live ? (live.lineStyle ?? 'Solid').toLowerCase() : 'solid';
  const globalColor = live ? resolveLinkedColor(live, colors, fillStyles, '#000000') : '#000000';

  const sidesCfg = live?.sides ?? {};
  const css = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const styleSide = sidesCfg[side];
    const cellSide  = cellSidesOverride?.[side];
    const key = `border${side.charAt(0).toUpperCase() + side.slice(1)}`;
    // Cell's per-side `enabled` (if defined) overrides the style's per-side
    // enabled. This lets the same named style drive multiple cells whose
    // visible sides differ by position.
    const enabled = cellSide?.enabled !== undefined
      ? cellSide.enabled
      : (styleSide?.enabled !== false);
    if (!enabled) { css[key] = 'none'; continue; }

    // ── Per-side styleRef override (Word-style "Pintar bordes"): if the cell
    // specifies its own styleRef for THIS side, resolve color/width/style from
    // that override style instead of the whole-cell `live`. The other sides
    // (no override) continue using `live` as before — so the "atado" property
    // of the global style stays intact for un-painted edges.
    const overrideStyle = cellSide?.styleRef
      ? (borderStyles ?? []).find(s => s.id === cellSide.styleRef)
      : null;
    if (overrideStyle) {
      const ovrSide = overrideStyle.sides?.[side];
      const ovrW = Math.max(0.5, overrideStyle.lineWidth != null ? overrideStyle.lineWidth * MM_TO_PX : 1);
      const ovrS = (overrideStyle.lineStyle ?? 'Solid').toLowerCase();
      const ovrC = resolveLinkedColor(overrideStyle, colors, fillStyles, '#000000');
      const w = ovrSide?.lineWidth != null ? Math.max(0.5, ovrSide.lineWidth * MM_TO_PX) : ovrW;
      const st = ovrSide?.lineStyle != null ? ovrSide.lineStyle.toLowerCase() : ovrS;
      const c = resolveLinkedColor(
        { lineColorId: ovrSide?.lineColorId, lineFillStyleId: ovrSide?.lineFillStyleId, lineColor: ovrSide?.lineColor },
        colors, fillStyles, ovrC
      );
      css[key] = `${w}px ${st} ${c}`;
      continue;
    }

    const w = styleSide?.lineWidth != null ? Math.max(0.5, styleSide.lineWidth * MM_TO_PX) : globalWidth;
    const st = styleSide?.lineStyle != null ? styleSide.lineStyle.toLowerCase() : globalStyle;
    const c = resolveLinkedColor(
      { lineColorId: styleSide?.lineColorId, lineFillStyleId: styleSide?.lineFillStyleId, lineColor: styleSide?.lineColor },
      colors, fillStyles, globalColor
    );
    css[key] = `${w}px ${st} ${c}`;
  }

  // ── Corner radius ────────────────────────────────────────────────────────
  // If the style defines corners (`live.corners.{topLeft,topRight,bottomRight,
  // bottomLeft}.{corner, radiusX, radiusY}`) with corner type != 'Standard',
  // apply borderRadius to the cell. Falls back to global corner type/radii on
  // the style root (`live.corner`, `live.radiusX/Y`) when a per-corner field is
  // null (the standard "inherit from global" convention used by addBorderStyle).
  // Skip when `live` is null (cell has only per-side overrides) — corners,
  // fill, and shadow are whole-cell concepts that need the global style.
  if (!live) return css;

  const cornersCfg = live.corners ?? {};
  const globalCornerType = live.corner ?? 'Standard';
  const globalRX = live.radiusX ?? 0;
  const globalRY = live.radiusY ?? 0;
  function cornerRadius(corner) {
    const cd = cornersCfg[corner] ?? {};
    const type = cd.corner ?? globalCornerType;
    if (type === 'Standard') return { x: 0, y: 0 };
    const rx = cd.radiusX != null ? cd.radiusX : globalRX;
    const ry = cd.radiusY != null ? cd.radiusY : globalRY;
    return { x: rx * MM_TO_PX, y: ry * MM_TO_PX };
  }
  const tl = cornerRadius('topLeft');
  const tr = cornerRadius('topRight');
  const br = cornerRadius('bottomRight');
  const bl = cornerRadius('bottomLeft');
  if (tl.x || tr.x || br.x || bl.x) {
    // Use the slash syntax so per-corner X/Y radii are honored independently.
    css.borderRadius = `${tl.x}px ${tr.x}px ${br.x}px ${bl.x}px / ${tl.y}px ${tr.y}px ${br.y}px ${bl.y}px`;
  }

  // ── Fill (inner background) — Model B: shading lives in the border style ──
  // Priority: fillFillStyleId (named FillStyle, resolved through its linked
  // color resource so editing the color propagates) > fill (hex literal).
  // Rendered as the cell's background-color; clipped to rounded corners.
  const fillHex = (() => {
    if (live.fillFillStyleId) {
      const fs = (fillStyles ?? []).find(s => s.id === live.fillFillStyleId);
      if (fs) {
        const col = fs.colorId ? (colors ?? []).find(c => c.id === fs.colorId) : null;
        return col?.hex || fs.color || null;
      }
    }
    if (live.fill) return live.fill;
    return null;
  })();
  if (fillHex) css.backgroundColor = fillHex;

  // ── Shadow ───────────────────────────────────────────────────────────────
  // Schema: shadowColor (hex), shadowOffsetX (mm), shadowOffsetY (mm). The
  // schema has no blur radius, so we use a hard shadow (`0` blur). Color via
  // shadowFillStyleId → shadowColorId → shadowColor (same priority pattern).
  const shadowHex = (() => {
    if (live.shadowFillStyleId) {
      const fs = (fillStyles ?? []).find(s => s.id === live.shadowFillStyleId);
      if (fs?.color) return fs.color;
    }
    if (live.shadowColor) return live.shadowColor;
    if (live.shadowColorId) {
      const c = (colors ?? []).find(col => col.id === live.shadowColorId);
      if (c?.hex) return c.hex;
    }
    return null;
  })();
  const sx = (live.shadowOffsetX ?? 0) * MM_TO_PX;
  const sy = (live.shadowOffsetY ?? 0) * MM_TO_PX;
  if (shadowHex && (sx !== 0 || sy !== 0)) {
    css.boxShadow = `${sx}px ${sy}px 0 ${shadowHex}`;
  }

  return css;
}

// ── Column resize handles overlay ─────────────────────────────────────────────

function ColResizeHandles({ ratios, onStartDrag, activeIdx }) {
  let cum = 0;
  const handles = [];
  for (let i = 0; i < ratios.length - 1; i++) {
    cum += ratios[i];
    handles.push({ pct: cum, colIdx: i });
  }
  return (
    <div className="tele__col-resize-overlay">
      {handles.map(({ pct, colIdx }) => (
        <div
          key={colIdx}
          className={`tele__col-resize-handle${activeIdx === colIdx ? ' tele__col-resize-handle--active' : ''}`}
          style={{ left: `${pct * 100}%` }}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onStartDrag(colIdx, e); }}
        />
      ))}
    </div>
  );
}

// ── Single-row renderer with inline cell editing ──────────────────────────

function SingleRow({ rs, columns, ratios, rowBg, borderStyles, fillStyles, tableStyle, regionKey, bodyRowOffset = 0, editingColId, onStartEdit, onCommit, onVMergeGrow, onEscape, onAutoHeight, state, elementId, onStartRowResize, draftMinHeight, isRowActive, cellCornersAll = false, tableRadius = 0, onCellMouseDown, onCellMouseEnter, onCellContextMenu, isCellSelected, vMergeNoBottom, vMergeRuns, vMergePx, tableInEditMode = false }) {
  // Table Style region for this row (firstHeader/header/oddBody/evenBody/...).
  const tsRegion = tableStyle ? regionForRow(regionKey, bodyRowOffset) : null;
  const cellMap = {};
  (rs.cells ?? []).forEach(c => { cellMap[c.colId] = c; });
  const maxMinH = (rs.cells ?? []).reduce((m, c) => Math.max(m, c.minHeight ?? 0), 0);
  const textStyles = state?.template?.styles?.text ?? [];
  const paragraphStyles = state?.template?.styles?.paragraph ?? [];
  const zoom = state?.zoom ?? 1;
  const cellRadiusPx = cellCornersAll && tableRadius > 0 ? tableRadius * MM_TO_PX * zoom : 0;

  // Inline editing — same DOM node toggled to contentEditable (like ContentAreaElement)
  const rowRef = useRef(null);
  const editingCellRef = useRef(null);
  const escapedRef = useRef(false);
  const savedRangeRef = useRef(null);
  const editEmbeddedRootsRef = useRef(new Map());
  const vmGrowRafRef = useRef(0);   // rAF throttle for live vMerge grow on typing

  const [contextMenu, setContextMenu] = useState(null);
  const [tableDialog, setTableDialog] = useState(false);
  const [objectPanel, setObjectPanel] = useState(null);
  const [styleModal, setStyleModal] = useState(null); // { kind, flow, rowSetId, colId } | null

  useEffect(() => {
    const editor = editingCellRef.current;
    if (!editingColId || !editor) return;

    const cell = cellMap[editingColId];
    const rawCellContent = cell?.flow?.content ?? '';
    const cellEditZoom = state?.zoom ?? 1;
    editor.innerHTML = sanitizeHtml(rawCellContent.replace(
      /font-size\s*:\s*([\d.]+)pt/gi,
      (_, pts) => `font-size: ${(parseFloat(pts) * (144 / 72) * cellEditZoom).toFixed(2)}px`
    ));
    // Expand area-tag chips inline (same pattern as ContentAreaElement).
    // child areas live in cell.flow.children; also search the global pool.
    const allCellChildAreas = [
      ...(cell?.flow?.children ?? []),
      ...(state?.template?.contentAreas ?? []),
    ];
    expandAreaTagsForEditor(editor, allCellChildAreas, cellEditZoom);
    applyParagraphBlockStyles(editor, paragraphStyles, cellEditZoom);

    // Register BEFORE focus so selectionchange fires with ref already set
    if (state?.activeEditorRef) state.activeEditorRef.current = editor;
    if (state?.activeEditorMetaRef) {
      state.activeEditorMetaRef.current = {
        areaId: cell?.flow?.id ?? null,
        defaultTextStyleId: cell?.flow?.defaultTextStyleId ?? null,
      };
    }

    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    escapedRef.current = false;

    // Remove embedded elements from cell when their tag span is deleted
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.removedNodes) {
          if (node.nodeType === 1 && node.classList.contains('element-tag')) {
            const removedId = node.getAttribute('data-element');
            if (removedId && elementId) {
              state?.removeEmbeddedElement?.(elementId, cell?.flow?.id ?? null, removedId);
              const r = editEmbeddedRootsRef.current.get(removedId);
              if (r) { try { r.unmount(); } catch {} editEmbeddedRootsRef.current.delete(removedId); }
            }
          }
        }
      }
    });
    observer.observe(editor, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (state?.activeEditorRef && state.activeEditorRef.current === editor) {
        state.activeEditorRef.current = null;
      }
      if (state?.activeEditorMetaRef) state.activeEditorMetaRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingColId]);

  // Re-apply per-block paragraph CSS when the paragraph styles change while editing
  // a cell (immediate feedback for fork-on-apply + live propagation).
  useEffect(() => {
    if (editingColId && editingCellRef.current) {
      applyParagraphBlockStyles(editingCellRef.current, paragraphStyles, state?.zoom ?? 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphStyles, editingColId]);

  // Render embedded elements visually inside the cell editor (like ContentAreaElement does)
  useEffect(() => {
    if (!editingColId || !editingCellRef.current) return;
    const cell = cellMap[editingColId];
    const embeddedEls = (cell?.flow?.elements ?? []).filter(e => e.embedded);
    if (!embeddedEls.length) return;
    const images = state?.template?.images ?? [];

    editingCellRef.current.querySelectorAll('span.element-tag[data-element]').forEach(span => {
      const elId = span.getAttribute('data-element');
      const el = embeddedEls.find(e => e.id === elId);
      if (!el || !renderCellEmbedded(el, images)) return;

      const existing = editEmbeddedRootsRef.current.get(elId);
      if (existing) {
        existing.render(
          <div style={{ position: 'relative' }}>
            {renderCellEmbedded(el, images)}
            <div style={{ position: 'absolute', inset: 0 }} />
          </div>
        );
        return;
      }

      if (!span.hasAttribute('data-orig-label')) {
        span.setAttribute('data-orig-label', span.textContent);
        span.textContent = '';
        span.setAttribute('contenteditable', 'false');
      }
      span.classList.add('element-tag--rendered');
      const root = createRoot(span);
      root.render(
        <div style={{ position: 'relative' }}>
          {renderCellEmbedded(el, images)}
          <div style={{ position: 'absolute', inset: 0 }} />
        </div>
      );
      editEmbeddedRootsRef.current.set(elId, root);
    });

    return () => {
      editEmbeddedRootsRef.current.forEach(r => { try { r.unmount(); } catch {} });
      editEmbeddedRootsRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingColId]);

  // Auto-height: after any render where row content grew beyond stored minHeight
  // (e.g., sub-area edited via mini-canvas), persist the new height without requiring
  // the user to manually double-click the cell.
  const allPoolAreas = state?.template?.contentAreas;
  useEffect(() => {
    if (editingColId || !rowRef.current || !onAutoHeight) return;
    const hPx = rowRef.current.getBoundingClientRect().height;
    const z   = state?.zoom ?? 1;
    const hMm = hPx / (MM_TO_PX * z);
    if (hMm > maxMinH + 0.2) onAutoHeight(rs.id, hMm);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs, editingColId, allPoolAreas]);

  function restoreCellElementTagSpans() {
    if (!editingCellRef.current) return;
    editingCellRef.current.querySelectorAll('span.element-tag--rendered[data-orig-label]').forEach(span => {
      const elId = span.getAttribute('data-element');
      const root = editEmbeddedRootsRef.current.get(elId);
      if (root) { try { root.unmount(); } catch {} editEmbeddedRootsRef.current.delete(elId); }
      span.removeAttribute('contenteditable');
      span.textContent = span.getAttribute('data-orig-label');
      span.removeAttribute('data-orig-label');
      span.classList.remove('element-tag--rendered');
    });
    editEmbeddedRootsRef.current.forEach(r => { try { r.unmount(); } catch {} });
    editEmbeddedRootsRef.current.clear();
  }

  function commitCurrentCell() {
    if (escapedRef.current) return;
    // Measure height FIRST — before any DOM mutation — to capture the full rendered height,
    // including contenteditable=false area-tag preview spans whose content may wrap.
    // getBoundingClientRect().height gives the true visual height (Chrome's scrollHeight
    // under-counts for contenteditable=false inline children); use the max of all three.
    const cellBCR     = editingCellRef.current?.getBoundingClientRect();
    const cellBCRH    = cellBCR ? cellBCR.height : 0;
    const cellScrollH = editingCellRef.current?.scrollHeight ?? 0;
    // If this row contains a vertical-merge ANCHOR, that anchor is rendered
    // position:absolute and DELIBERATELY overflows the row downward (it spans
    // into the rows below). `rowRef.scrollHeight` then includes the anchor's
    // full combined height — feeding it into the auto-grow would inflate THIS
    // row's minHeight to the combined height on every commit of ANY cell in
    // the row (anchor or not) → runaway growth ("a line keeps getting
    // inserted"). Exclude rowRef in that case; the edited cell's own size is
    // the correct content signal, and the merged block's own growth is
    // handled by growVMergeBlockLive / commitCell's anchor branch.
    const rowHasVMAnchor = (rs.cells ?? []).some(c => vMergeRuns?.has(`${rs.id}:${c.colId}`));
    const rowScrollH  = rowHasVMAnchor
      ? Math.max(cellBCRH, cellScrollH)
      : Math.max(cellBCRH, cellScrollH, rowRef.current?.scrollHeight ?? 0);
    restoreCellElementTagSpans();
    // Collapse area-tag preview spans back to compact references before reading innerHTML
    // (same pattern as ContentAreaElement.commitEdit).
    collapseAreaTagsForEditor(editingCellRef.current);
    stripParagraphBlockStyles(editingCellRef.current);
    const rawCellHtml = editingCellRef.current?.innerHTML ?? '';
    // Clear DOM before React reconciles view mode: contentEditable content isn't tracked by React's VDOM.
    if (editingCellRef.current) editingCellRef.current.innerHTML = '';
    const commitZoom = state?.zoom ?? 1;
    const ptCellHtml = rawCellHtml.replace(
      /font-size\s*:\s*([\d.]+)px/gi,
      (_, pxs) => `font-size: ${(parseFloat(pxs) / ((144 / 72) * commitZoom)).toFixed(4)}pt`
    );
    if (state?.activeEditorRef) state.activeEditorRef.current = null;
    if (state?.activeEditorMetaRef) state.activeEditorMetaRef.current = null;
    setContextMenu(null);
    setTableDialog(false);
    setObjectPanel(null);
    // Pass the real content height. commitCell routes it correctly: for a
    // vertical-merge anchor it grows the LAST member row (never the anchor's
    // own row → no feedback loop), so the merged block expands to fit.
    onCommit(rs.id, editingColId, ptCellHtml, rowScrollH);
  }

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!editingColId) return;
    editingCellRef.current?.focus();
    const sel = window.getSelection();
    if (sel?.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function handleInsertEmbeddedElement(type, overrides = {}) {
    const editingCell = editingColId ? cellMap[editingColId] : null;
    const flowId = editingCell?.flow?.id;
    if (!flowId || !elementId) return;
    const embeddedEl = state?.addEmbeddedElement?.(elementId, flowId, type, overrides);
    if (!embeddedEl?.id) return;
    const label = buildElementTagLabel(type, embeddedEl);
    insertElementTag(editingCellRef.current, embeddedEl.id, type, label, savedRangeRef.current);
    savedRangeRef.current = null;

    // Immediately render visually (same pattern as ContentAreaElement) so the
    // chip text is never visible to the user after insertion.
    const images = state?.template?.images ?? [];
    const rendered = renderCellEmbedded(embeddedEl, images);
    if (rendered && !editEmbeddedRootsRef.current.has(embeddedEl.id)) {
      const newSpan = editingCellRef.current?.querySelector(`span.element-tag[data-element="${embeddedEl.id}"]`);
      if (newSpan) {
        newSpan.setAttribute('data-orig-label', label);
        newSpan.textContent = '';
        newSpan.setAttribute('contenteditable', 'false');
        newSpan.classList.add('element-tag--rendered');
        const root = createRoot(newSpan);
        root.render(
          <div style={{ position: 'relative' }}>
            {rendered}
            <div style={{ position: 'absolute', inset: 0 }} />
          </div>
        );
        editEmbeddedRootsRef.current.set(embeddedEl.id, root);
      }
    }

    editingCellRef.current?.focus();
  }

  function handleCreateAndInsertAreaTag() {
    const editingCell = editingColId ? cellMap[editingColId] : null;
    const flowId = editingCell?.flow?.id;
    if (!flowId) { editingCellRef.current?.focus(); return; }
    const usedNums = collectAllAreaNums(state?.template);
    const nextLabel = `Área ${usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1}`;
    const newId = state?.addArea?.(elementId, flowId, { label: nextLabel });
    if (newId) {
      insertAreaTag(editingCellRef.current, newId, nextLabel, savedRangeRef.current);
      savedRangeRef.current = null;
      // Immediately expand the new chip (state update is async, pass synthetic pool)
      const syntheticPool = [
        ...(editingCell?.flow?.children ?? []),
        ...(state?.template?.contentAreas ?? []),
        { id: newId, content: '', children: [] },
      ];
      expandAreaTagsForEditor(editingCellRef.current, syntheticPool, state?.zoom ?? 1);
    }
    editingCellRef.current?.focus();
  }

  function handleContextMenuAction(action, item) {
    const menuPos = contextMenu;
    setContextMenu(null);
    const typeMap = { 'insert-image': 'image', 'insert-shape': 'shape', 'insert-qr': 'qr', 'insert-barcode': 'barcode' };
    switch (action) {
      case 'insert-area-tag': {
        insertAreaTag(editingCellRef.current, item.area.id, item.area.label ?? 'Área', savedRangeRef.current);
        savedRangeRef.current = null;
        const insertCell = editingColId ? cellMap[editingColId] : null;
        const insertChildAreas = [
          ...(insertCell?.flow?.children ?? []),
          ...(state?.template?.contentAreas ?? []),
        ];
        expandAreaTagsForEditor(editingCellRef.current, insertChildAreas, state?.zoom ?? 1);
        editingCellRef.current?.focus();
        break;
      }
      case 'create-area-tag':
      case 'insert-area':
        handleCreateAndInsertAreaTag();
        break;
      case 'open-table-dialog':
        setTableDialog(true);
        break;
      case 'open-object-panel':
        setObjectPanel(menuPos);
        break;
      case 'insert-image':
      case 'insert-shape':
      case 'insert-qr':
      case 'insert-barcode':
        handleInsertEmbeddedElement(typeMap[action]);
        break;
      case 'text-style':
      case 'paragraph-style':
      case 'bullets-numbering': {
        const flow = (editingColId ? cellMap[editingColId] : null)?.flow;
        const kindMap = { 'text-style': 'text', 'paragraph-style': 'paragraph', 'bullets-numbering': 'bullets' };
        if (flow) setStyleModal({ kind: kindMap[action], flow, rowSetId: rs.id, colId: editingColId });
        break;
      }
      case 'cell-properties':
        state?.setTableRowSetCtx?.({ elId: elementId, rowSetId: rs.id, colId: editingColId });
        state?.setPanelContext?.('element');
        break;
      case 'cell-border-style': {
        const cell = editingColId ? cellMap[editingColId] : null;
        const styleRef = cell?.border?.styleRef || DEFAULT_BORDER_STYLE_ID;
        // Diferido: el clic burbujea al canvas y el `click` posterior re-selecciona
        // la celda (panelContext='element'); diferir hace que la navegación gane.
        setTimeout(() => state?.setPanelContext?.('borderStyle:' + styleRef), 0);
        break;
      }
      default:
        break;
    }
  }

  function handleTableDialogConfirm(options) {
    setTableDialog(false);
    const t = state?.template;
    const startTableNum = countTablesInTemplate(t) + 1;
    const startRowNum   = countRowSetsInTemplate(t) + 1;
    const startCellNum  = countCellsInTemplate(t) + 1;
    const structure = buildTableStructure({ ...options, startTableNum, startRowNum, startCellNum });
    handleInsertEmbeddedElement('table', { ...structure, tableNum: startTableNum });
  }

  function handleObjectPanelSelect(area) {
    setObjectPanel(null);
    insertAreaTag(editingCellRef.current, area.id, area.label ?? 'Área', savedRangeRef.current);
    savedRangeRef.current = null;
    editingCellRef.current?.focus();
  }

  // Row height: use draft (fixed during resize drag) or stored minHeight (auto-grows in all modes)
  const effectiveMinH = draftMinHeight != null ? draftMinHeight : maxMinH;
  const rowHeightStyle = effectiveMinH > 0
    ? (draftMinHeight != null
        ? { height: `${mmToPx(effectiveMinH, zoom)}px`, overflow: 'hidden' }
        : { minHeight: `${mmToPx(effectiveMinH, zoom)}px` })
    : {};

  const hasCellBorders = (rs.cells ?? []).some(c => c.border?.inline);

  return (
    <>
    <div
      ref={rowRef}
      className="tele__row"
      style={{ ...(rowBg ? { background: rowBg } : {}), ...rowHeightStyle, ...(hasCellBorders ? { borderBottom: 'none' } : {}) }}
    >
      {columns.map((col, i) => {
        const cell = cellMap[col.id];
        if (!cell) return <div key={col.id} className="tele__cell" style={{ width: `${ratios[i] * 100}%` }} />;
        const isEditing = editingColId === col.id;
        const cellMinHPx = mmToPx(cell.minHeight ?? 0, zoom);
        const cellMinH = cellMinHPx > 0
          ? { minHeight: `${cellMinHPx}px` }
          : {};
        // Effective border: a manual per-cell border (painted/sombreado) wins;
        // otherwise the Table Style resolves one by role (region) + column
        // position. Keeps it atado — editing the Table Style restyles the table.
        let effBorder = cell.border;
        if (!effBorder && tableStyle && tsRegion) {
          const tsRef = resolveTableStyleBorderRef(tableStyle, tsRegion, i, columns.length);
          if (tsRef) effBorder = { styleRef: tsRef };
        }
        let cellBorder = buildCellBorderCss(effBorder, borderStyles, fillStyles, state?.template?.colors);
        // Vertical merge: a spanUp cell keeps its OWN side + bottom borders
        // (position-based config already matches the anchor's column, so the
        // column reads as one continuous cell) and only drops its TOP border
        // so it fuses with the cell above. The internal divider below the
        // anchor / interior cells is removed via vMergeNoBottom; the run's
        // LAST spanUp cell is NOT in that set, so its own bottom border
        // survives and closes the merged block.
        if (cell.spanUp) {
          cellBorder = { ...cellBorder, borderTop: 'none' };
        }
        const cellTs = resolveTextStyle(cell.flow?.defaultTextStyleId, textStyles);
        // Paragraph style: cell flow → ref or inline → default. Applied AFTER
        // textStyle so paragraph alignment/letter-spacing/line-height override
        // the text style equivalents (matches ContentAreaElement behavior).
        const cellPs = cell.flow?.paragraphStyleId
          ? resolveParagraphStyle(cell.flow.paragraphStyleId, paragraphStyles)
          : (cell.flow?.paragraphStyle ?? {});
        const cellTextCss = textStyleToCSS(cellTs, fillStyles, zoom);
        if (cellPs.alignment)         cellTextCss.textAlign     = cellPs.alignment;
        if (cellPs.letterSpacing)     cellTextCss.letterSpacing = `${cellPs.letterSpacing * zoom}px`;
        if (cellPs.lineHeight != null) cellTextCss.lineHeight   = cellPs.lineHeight;
        // Per-cell horizontal alignment (Word's 3×3 grid). Overrides the
        // paragraph style alignment when set. Vertical lives on cell.vAlign
        // (rendered via the tele__cell--valign-* class).
        if (cell.hAlign)              cellTextCss.textAlign     = cell.hAlign;
        const cellPadding = {
          paddingTop:    `${mmToPx(cell.paddingTop    ?? 0, zoom)}px`,
          paddingRight:  `${mmToPx(cell.paddingRight  ?? 0, zoom)}px`,
          paddingBottom: `${mmToPx(cell.paddingBottom ?? 0, zoom)}px`,
          paddingLeft:   `${mmToPx(cell.paddingLeft   ?? 0, zoom)}px`,
        };
        // Horizontal merge: a non-spanned (anchor) cell absorbs the width of
        // the consecutive spanLeft cells to its right — those render
        // display:none (tele__cell--hidden), so without this the row would
        // just lose a cell instead of showing one wide merged cell.
        let widthRatio = ratios[i];
        if (!cell.spanLeft) {
          for (let j = i + 1; j < columns.length; j++) {
            const nextCell = cellMap[columns[j].id];
            if (nextCell?.spanLeft) widthRatio += ratios[j];
            else break;
          }
        }
        const vmKey = `${rs.id}:${col.id}`;
        // Word-like cell shading. Resource-backed: cell.fill = { fillStyleId }
        // → resolve via the fill style (preferring its linked color resource
        // so editing the color updates every cell). Legacy { color } still
        // works (pre-resourcify data / migration not yet run).
        let cellFillBg = null;
        if (cell.fill?.fillStyleId) {
          const tpl = state?.template;
          const fs = (tpl?.styles?.fill ?? []).find(s => s.id === cell.fill.fillStyleId);
          cellFillBg = (fs && (resolveColorHex(tpl, fs.colorId) || fs.color)) || null;
        } else if (cell.fill?.color) {
          cellFillBg = cell.fill.color;
        }
        const cellStyle = {
          width: `${widthRatio * 100}%`,
          ...cellMinH, ...cellBorder, ...cellTextCss, ...cellPadding,
          // Own fill wins over border-style fill and over the row's banded
          // background (placed after ...cellBorder).
          ...(cellFillBg ? { backgroundColor: cellFillBg } : {}),
          ...(cellRadiusPx > 0 ? { borderRadius: `${cellRadiusPx}px`, overflow: 'hidden' } : {}),
          // Vertical merge: remove the divider below any cell whose cell-below
          // is spanUp (the anchor + interior cells of the run). The run's LAST
          // spanUp cell is NOT in this set, so its own position border (bottom
          // enabled for "all"-border tables) survives and closes the block.
          // Placed last so it overrides any inline border-bottom.
          ...(vMergeNoBottom?.has(vmKey) ? { borderBottom: 'none' } : {}),
        };
        // The drag-select highlight must not show while inline-editing — the
        // cell that was clicked to start editing would otherwise stay blue.
        const cellSelected = !tableInEditMode && (isCellSelected?.(rs.id, col.id) ?? false);
        // spanUp = vertical merge: the cell stays in the layout (so the row
        // keeps its height) but drops its top border and shows no content,
        // so it visually fuses with the anchor cell above it.
        const cellClass = `tele__cell tele__cell--valign-${cell.vAlign ?? 'top'}${cell.spanLeft ? ' tele__cell--hidden' : ''}${cell.spanUp ? ' tele__cell--span-up' : ''}${cellSelected ? ' tele__cell--selected' : ''}`;
        const allPoolAreas = state?.template?.contentAreas ?? [];
        const images = state?.template?.images ?? [];
        const isSpanned = cell.spanLeft || cell.spanUp;
        const viewHtml = isSpanned ? '' : resolveParagraphBlocks(
          scaleInlinePt(
            resolveForDisplay(cell.flow?.content || '', cell.flow?.children ?? [], null, allPoolAreas),
            zoom
          ),
          paragraphStyles, zoom
        );
        const cellEmbeddedEls = !isEditing && !isSpanned
          ? (cell.flow?.elements ?? []).filter(e => e.embedded)
          : [];
        const cellParts = cellEmbeddedEls.length
          ? splitHtmlAtElementTags(viewHtml, cellEmbeddedEls)
          : null;

        // ── True vertical merge ──────────────────────────────────────────
        // A spanUp cell (not also spanLeft → that's a 2-D merge handled by
        // the normal `tele__cell--hidden` path) becomes an invisible spacer:
        // keeps the column width + its row height (so OTHER columns stay
        // aligned) but draws nothing — the anchor's absolute box covers it.
        if (cell.spanUp && !cell.spanLeft) {
          return (
            <div
              key={col.id}
              data-trs={rs.id}
              data-tcol={col.id}
              className="tele__cell tele__cell--vmerged-spacer"
              style={{ width: `${widthRatio * 100}%`, ...cellMinH }}
            />
          );
        }
        // An anchor (cell-below is spanUp) is rendered ABSOLUTE inside a
        // relative in-flow slot. The slot reserves the column width + the
        // anchor row's own height; the absolute cell spans the measured
        // combined height over the spacers. It must KEEP its own bottom
        // border (to close the merged block) — so re-assert the real border
        // over any vMergeNoBottom 'none', and DON'T touch top/left/right.
        const isVMAnchor = !!vMergeRuns?.has(vmKey);
        const vmRunPx = isVMAnchor ? (vMergePx?.[vmKey] ?? null) : null;
        if (isVMAnchor) {
          delete cellStyle.width;                         // slot carries width
          cellStyle.borderBottom = cellBorder.borderBottom; // restore real bottom
          cellStyle.position = 'absolute';
          cellStyle.left = 0;
          cellStyle.right = 0;
          cellStyle.top = 0;
          cellStyle.zIndex = 2;
          if (vmRunPx) {
            // While editing: min-height (no fixed height) so the box GROWS
            // with the text as you type (.tele__cell--editing is overflow
            // visible). Idle: fixed height = combined. On blur, commitCell
            // grows the LAST member row by the overflow, so when we return
            // to idle the combined height already equals the content.
            if (isEditing) cellStyle.minHeight = `${vmRunPx}px`;
            else           cellStyle.height    = `${vmRunPx}px`;
          }
        }

        const cellEl = (
          <div
            key={col.id}
            ref={isEditing ? editingCellRef : null}
            data-trs={rs.id}
            data-tcol={col.id}
            className={`${cellClass}${isEditing ? ' cae__editor tele__cell--editing' : ''}`}
            style={cellStyle}
            // ONLY the actively-edited cell is contentEditable. Making every
            // sibling cell editable while one is active (the former "Option A"
            // cross-cell selection) was a data-loss regression: sibling cells
            // render their content via React (dangerouslySetInnerHTML) and have
            // NO commit path (onBlur is wired only when isEditing), so any text
            // typed/changed in them lived only in the DOM and vanished when the
            // cell was re-opened (the edit effect re-inits innerHTML from the
            // now-stale empty model). Restores prior, correct single-cell edit.
            contentEditable={isEditing || undefined}
            suppressContentEditableWarning={isEditing}
            onMouseDown={
              isEditing
                ? (e => e.stopPropagation())                 // active editor: caret/selection within
                : tableInEditMode
                  // In edit-mode, a single click on another cell switches the
                  // editor to it. Sibling cells are NOT contentEditable, so a
                  // plain mousedown does NOT move focus → the cell we were
                  // editing never fires onBlur → its edits are never committed
                  // (data loss). Blur the active editor explicitly first so its
                  // onBlur → commitCurrentCell runs BEFORE we switch.
                  ? (e => {
                      e.stopPropagation();
                      const active = document.activeElement;
                      if (active && active !== e.currentTarget
                          && active.classList?.contains('tele__cell--editing')) {
                        active.blur();
                      }
                      onStartEdit?.(rs.id, col.id);
                    })
                  : (e => onCellMouseDown?.(e, rs.id, col.id)) // outside edit mode: cell drag-select
            }
            onMouseEnter={
              (!isEditing && !tableInEditMode)
                ? (() => onCellMouseEnter?.(rs.id, col.id))
                : undefined
            }
            onBlur={isEditing ? (e => {
              if (e.relatedTarget?.closest('.tft, .tft-link-modal, .dde-header, .tcb-popup, .tft__list-dropdown, .tft__style-dropdown, .cacm, .itd__backdrop, .olp')) return;
              if (tableDialog || objectPanel) return;
              commitCurrentCell();
            }) : undefined}
            // Vertical-merge anchor: grow the block LIVE while typing so the
            // in-flow rows below get pushed down in real time (the anchor is
            // absolute → it can't push them itself). rAF-throttled.
            onInput={(isEditing && isVMAnchor) ? (() => {
              if (vmGrowRafRef.current) return;
              vmGrowRafRef.current = requestAnimationFrame(() => {
                vmGrowRafRef.current = 0;
                const h = editingCellRef.current?.scrollHeight ?? 0;
                if (h > 0) onVMergeGrow?.(rs.id, col.id, h);
              });
            }) : undefined}
            onKeyDown={isEditing ? (e => {
              if (e.key === 'Escape') {
                if (contextMenu) { setContextMenu(null); return; }
                if (tableDialog) { setTableDialog(false); return; }
                if (objectPanel) { setObjectPanel(null); return; }
                e.preventDefault();
                escapedRef.current = true;
                if (state?.activeEditorRef) state.activeEditorRef.current = null;
                if (state?.activeEditorMetaRef) state.activeEditorMetaRef.current = null;
                onEscape();
              }
              e.stopPropagation();
            }) : undefined}
            onClick={isEditing ? (e => e.stopPropagation()) : undefined}
            onDoubleClick={!isEditing ? (e => { e.stopPropagation(); onStartEdit?.(rs.id, col.id); }) : undefined}
            onContextMenu={
              isEditing
                ? handleContextMenu
                : (e => onCellContextMenu?.(e, rs.id, col.id))
            }
          >
            {!isEditing && !cellParts && (
              <div dangerouslySetInnerHTML={{ __html: viewHtml }} />
            )}
            {(!isEditing && cellParts) ? cellParts.map((part, i) =>
              part.type === 'html'
                ? <div key={i} dangerouslySetInnerHTML={{ __html: part.content }} />
                : (
                  <div key={part.key} style={{ position: 'relative', margin: '2px 0' }}>
                    {renderCellEmbedded(part.el, images)}
                  </div>
                )
            ) : undefined}
          </div>
        );

        // Anchor of a vertical merge: wrap the absolute cell in an in-flow
        // relative slot that reserves the column width + the anchor row's
        // own height (sibling alignment). The absolute cellEl then spans the
        // measured combined height over the spacer cells.
        if (isVMAnchor) {
          return (
            <div
              key={col.id}
              data-vmrun={vmKey}
              className="tele__vmerge-slot"
              style={{ width: `${widthRatio * 100}%`, ...cellMinH, position: 'relative' }}
            >
              {cellEl}
            </div>
          );
        }
        return cellEl;
      })}
      {/* Row resize handle — span (not div) so .tele__cell:last-of-type still targets last cell */}
      {!editingColId && onStartRowResize && (
        <span
          className={`tele__row-resize-handle${isRowActive ? ' tele__row-resize-handle--active' : ''}`}
          onMouseDown={e => {
            e.preventDefault();
            e.stopPropagation();
            onStartRowResize(rs.id, e.currentTarget.parentElement, e);
          }}
        />
      )}
    </div>
    {contextMenu && (
      <ContentAreaContextMenu
        position={contextMenu}
        availableFields={state?.availableFields ?? []}
        onAction={handleContextMenuAction}
        onClose={() => setContextMenu(null)}
        cellContext
      />
    )}
    {styleModal && (
      <StyleEditModal
        kind={styleModal.kind}
        state={state}
        area={styleModal.flow}
        persist={ch => state?.setTemplate?.(t => patchTableInTemplate(t, elementId, el => ({
          ...el,
          rowSets: (el.rowSets ?? []).map(rsX => ({
            ...rsX,
            cells: (rsX.cells ?? []).map(c =>
              (rsX.id === styleModal.rowSetId && c.colId === styleModal.colId && c.flow)
                ? { ...c, flow: { ...c.flow, ...ch } }
                : c
            ),
          })),
        })))}
        onClose={() => setStyleModal(null)}
      />
    )}
    {tableDialog && (
      <InsertTableDialog
        availableFields={state?.availableFields ?? []}
        onConfirm={handleTableDialogConfirm}
        onCancel={() => { setTableDialog(false); editingCellRef.current?.focus(); }}
      />
    )}
    {objectPanel && (
      <ObjectListPanel
        position={objectPanel}
        allAreas={state?.template?.contentAreas ?? []}
        onSelect={handleObjectPanelSelect}
        onClose={() => { setObjectPanel(null); editingCellRef.current?.focus(); }}
      />
    )}
  </>
  );
}

// ── Recursive RowSet resolver ─────────────────────────────────────────────

function RowSetTree({ rowSetId, allRowSets, columns, ratios, oddRowColor, evenRowColor, bodyRowOffset = 0, borderStyles, fillStyles, tableStyle, regionKey, editingCtx, onStartEdit, onCommit, onVMergeGrow, onEscape, onAutoHeight, state, elementId, onStartRowResize, draftRowHeights, activeRowId, cellCornersAll = false, tableRadius = 0, onCellMouseDown, onCellMouseEnter, onCellContextMenu, isCellSelected, vMergeNoBottom, vMergeRuns, vMergePx, tableInEditMode = false }) {
  const rs = allRowSets.find(r => r.id === rowSetId);
  if (!rs) return null;

  if (rs.type === 'single-row') {
    const isOdd = bodyRowOffset % 2 === 0;
    const rowBg = oddRowColor !== undefined ? (isOdd ? oddRowColor : evenRowColor) : undefined;
    const editingColId = editingCtx?.rowSetId === rs.id ? editingCtx.colId : null;
    return (
      <SingleRow
        rs={rs} columns={columns} ratios={ratios} rowBg={rowBg}
        borderStyles={borderStyles} fillStyles={fillStyles}
        tableStyle={tableStyle} regionKey={regionKey} bodyRowOffset={bodyRowOffset}
        editingColId={editingColId}
        onStartEdit={onStartEdit} onCommit={onCommit} onVMergeGrow={onVMergeGrow} onEscape={onEscape}
        onAutoHeight={onAutoHeight}
        state={state} elementId={elementId}
        onStartRowResize={onStartRowResize}
        draftMinHeight={draftRowHeights?.[rs.id]}
        isRowActive={activeRowId === rs.id}
        cellCornersAll={cellCornersAll}
        tableRadius={tableRadius}
        onCellMouseDown={onCellMouseDown}
        onCellMouseEnter={onCellMouseEnter}
        onCellContextMenu={onCellContextMenu}
        isCellSelected={isCellSelected}
        vMergeNoBottom={vMergeNoBottom}
        vMergeRuns={vMergeRuns}
        vMergePx={vMergePx}
        tableInEditMode={tableInEditMode}
      />
    );
  }

  if (rs.type === 'multiple-rows') {
    return (
      <>
        {(rs.childIds ?? []).map((id, idx) => (
          <RowSetTree
            key={id} rowSetId={id} allRowSets={allRowSets} columns={columns} ratios={ratios}
            oddRowColor={oddRowColor} evenRowColor={evenRowColor} bodyRowOffset={idx}
            borderStyles={borderStyles} fillStyles={fillStyles}
            tableStyle={tableStyle} regionKey={regionKey}
            editingCtx={editingCtx} onStartEdit={onStartEdit} onCommit={onCommit} onVMergeGrow={onVMergeGrow} onEscape={onEscape}
            onAutoHeight={onAutoHeight}
            state={state} elementId={elementId}
            onStartRowResize={onStartRowResize} draftRowHeights={draftRowHeights} activeRowId={activeRowId}
            cellCornersAll={cellCornersAll} tableRadius={tableRadius}
            onCellMouseDown={onCellMouseDown} onCellMouseEnter={onCellMouseEnter} onCellContextMenu={onCellContextMenu} isCellSelected={isCellSelected} vMergeNoBottom={vMergeNoBottom} vMergeRuns={vMergeRuns} vMergePx={vMergePx}
            tableInEditMode={tableInEditMode}
          />
        ))}
      </>
    );
  }

  if (rs.type === 'repeated') {
    return (
      <>
        <div className="tele__repeat-badge">
          ↻ {rs.repeatVar ? `[${rs.repeatVar}]` : 'Repetido'}
        </div>
        {(rs.childIds ?? []).map((id, idx) => (
          <RowSetTree
            key={id} rowSetId={id} allRowSets={allRowSets} columns={columns} ratios={ratios}
            bodyRowOffset={idx} borderStyles={borderStyles} fillStyles={fillStyles}
            tableStyle={tableStyle} regionKey={regionKey}
            editingCtx={editingCtx} onStartEdit={onStartEdit} onCommit={onCommit} onVMergeGrow={onVMergeGrow} onEscape={onEscape}
            onAutoHeight={onAutoHeight}
            state={state} elementId={elementId}
            onStartRowResize={onStartRowResize} draftRowHeights={draftRowHeights} activeRowId={activeRowId}
            cellCornersAll={cellCornersAll} tableRadius={tableRadius}
            onCellMouseDown={onCellMouseDown} onCellMouseEnter={onCellMouseEnter} onCellContextMenu={onCellContextMenu} isCellSelected={isCellSelected} vMergeNoBottom={vMergeNoBottom} vMergeRuns={vMergeRuns} vMergePx={vMergePx}
            tableInEditMode={tableInEditMode}
          />
        ))}
      </>
    );
  }

  if (rs.type?.startsWith('select-by')) {
    return (
      <div className="tele__conditional-badge">
        ? Condicional — {rs.cases?.length ?? 0} caso{rs.cases?.length !== 1 ? 's' : ''}
      </div>
    );
  }

  return null;
}

// ── Main component ────────────────────────────────────────────────────────

// Flatten a table's rowSets into the list of visible single-row rowSet ids,
// in display order. Used to compute the row-index of any cell for drag-select.
function flattenSingleRowIds(rowSets, rootRowSetId) {
  const out = [];
  // A linked header-footer (firstHeaderId === headerId, footerId ===
  // lastFooterId — the default when there's no separate first-header /
  // last-footer) would walk the SAME single-row twice and emit a duplicate
  // consecutive id. That breaks vMergeNoBottom (it would compare the merged
  // run's last row against itself and wrongly strip its bottom border) and
  // skews drag-select rectangles. Dedupe so the flat list matches what the
  // renderer actually shows (it hides the linked duplicate sections).
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
      return;
    }
  }
  walk(rootRowSetId);
  return out;
}

// Given a start cell and an end cell, compute the rectangle of cells (rowSetId
// + colId pairs) between them. Returns an array of cells covering the inclusive
// rectangular range.
function cellsInRect(start, end, flatRowIds, colIds) {
  if (!start || !end) return [];
  const sR = flatRowIds.indexOf(start.rowSetId);
  const eR = flatRowIds.indexOf(end.rowSetId);
  const sC = colIds.indexOf(start.colId);
  const eC = colIds.indexOf(end.colId);
  if (sR < 0 || eR < 0 || sC < 0 || eC < 0) return [];
  const minR = Math.min(sR, eR), maxR = Math.max(sR, eR);
  const minC = Math.min(sC, eC), maxC = Math.max(sC, eC);
  const cells = [];
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      cells.push({ rowSetId: flatRowIds[r], colId: colIds[c] });
    }
  }
  return cells;
}

export default function TableElement({ element, state, caId, areaId }) {
  const { columns = [], rowSets = [], rootRowSetId, oddRowColor, evenRowColor } = element;
  const borderStyles = state?.template?.styles?.border ?? [];
  const fillStyles   = state?.template?.styles?.fill   ?? [];

  // ── Inline cell editing ────────────────────────────────────────────────
  const [editingCtx, setEditingCtx] = useState(null); // { rowSetId, colId }

  // ── Multi-cell selection (click + drag, or shift+click later) ─────────
  // Drag state lives in refs so mousemove doesn't trigger re-renders. The
  // computed selection is committed to global `tableCellSelection` only on
  // change so the visual update happens via normal React render.
  const dragStartRef   = useRef(null);   // { rowSetId, colId } | null
  const isDraggingRef  = useRef(false);
  const flatRowIds = useMemo(
    () => flattenSingleRowIds(rowSets, rootRowSetId),
    [rowSets, rootRowSetId]
  );
  const colIds = useMemo(() => columns.map(c => c.id), [columns]);

  // Vertical merge: a cell whose bottom edge must NOT draw a divider because
  // the cell directly below it (same column, next visual row) is spanUp and
  // therefore merged into it. Covers the anchor AND interior cells of a
  // 3+-row merge; the LAST cell of the run keeps its bottom border to close
  // the merged block. Needed because user-configured inline cell borders
  // (tele--has-borders) aren't removed by the .tele__cell--span-up CSS rule.
  const vMergeNoBottom = useMemo(() => {
    const keys = new Set();
    const rsById = new Map((rowSets ?? []).map(r => [r.id, r]));
    for (let k = 0; k < flatRowIds.length - 1; k++) {
      const belowRs = rsById.get(flatRowIds[k + 1]);
      if (!belowRs) continue;
      for (const colId of colIds) {
        const belowCell = (belowRs.cells ?? []).find(c => c.colId === colId);
        if (belowCell?.spanUp) keys.add(`${flatRowIds[k]}:${colId}`);
      }
    }
    return keys;
  }, [rowSets, flatRowIds, colIds]);

  // ── True vertical merge (rowspan) ─────────────────────────────────────────
  // Flex rows can't rowspan natively (one tall cell stretches its whole row,
  // misaligning the OTHER columns). So the anchor cell is rendered as a
  // `position:absolute` box spanning the MEASURED combined height of its run,
  // over transparent spacer spanUp cells that keep the column width + row
  // heights. vMergeRuns: Map<"anchorRsId:colId", memberRowIds[]>.
  const vMergeRuns = useMemo(() => {
    const m = new Map();
    const rsById = new Map((rowSets ?? []).map(r => [r.id, r]));
    for (const colId of colIds) {
      for (let k = 0; k < flatRowIds.length; k++) {
        const c = rsById.get(flatRowIds[k])?.cells?.find(x => x.colId === colId);
        if (!c || c.spanUp) continue;                  // not an anchor
        const members = [flatRowIds[k]];
        let j = k + 1;
        while (j < flatRowIds.length) {
          const below = rsById.get(flatRowIds[j])?.cells?.find(x => x.colId === colId);
          if (below?.spanUp) { members.push(flatRowIds[j]); j++; } else break;
        }
        if (members.length > 1) m.set(`${flatRowIds[k]}:${colId}`, members);
      }
    }
    return m;
  }, [rowSets, flatRowIds, colIds]);

  // Set of "rowSetId:colId" strings for O(1) cell-selected lookups.
  const selectedCellKeys = useMemo(() => {
    const sel = state?.tableCellSelection;
    if (!sel || sel.tableElId !== element.id) return new Set();
    return new Set((sel.cells ?? []).map(c => `${c.rowSetId}:${c.colId}`));
  }, [state?.tableCellSelection, element.id]);

  function isCellSelected(rowSetId, colId) {
    return selectedCellKeys.has(`${rowSetId}:${colId}`);
  }

  function commitDragSelection(endCell, additive = false) {
    if (!dragStartRef.current) return;
    const cells = cellsInRect(dragStartRef.current, endCell, flatRowIds, colIds);
    let finalCells;
    if (additive && state?.tableCellSelection?.tableElId === element.id) {
      const existing = state.tableCellSelection.cells ?? [];
      const merged = [...existing];
      for (const c of cells) {
        if (!merged.some(m => m.rowSetId === c.rowSetId && m.colId === c.colId)) merged.push(c);
      }
      state.setTableCellSelection?.({ tableElId: element.id, cells: merged });
      finalCells = merged;
    } else {
      state.setTableCellSelection?.({ tableElId: element.id, cells });
      finalCells = cells;
    }

    // Sync the right-side properties panel with the selection so the user
    // actually sees the cell's properties when picking one cell from the canvas:
    //
    //   1 cell    → tableRowSetCtx points at it  → CellPropertiesPanel shows.
    //   N cells   → clear tableRowSetCtx (if it was on THIS table) so the
    //               panel doesn't keep showing a stale single-cell view; the
    //               Ribbon Tabla group still operates on the multi-selection.
    //
    // Also make sure the table itself (or its embedded wrapper) is the
    // "selected element" so the panel-context is `'element'` and the
    // ElementPanel takes the tableRowSetCtx priority branch.
    if (finalCells.length === 1) {
      const [only] = finalCells;
      if (element.embedded && caId && areaId) {
        state?.selectEmbeddedElement?.(caId, areaId, element.id);
      } else {
        state?.selectElement?.(element.id, false);
      }
      state?.setTableRowSetCtx?.({ elId: element.id, rowSetId: only.rowSetId, colId: only.colId });
      state?.setPanelContext?.('element');
    } else if (state?.tableRowSetCtx?.elId === element.id) {
      state?.setTableRowSetCtx?.(null);
    }
  }

  function handleCellMouseDown(e, rowSetId, colId) {
    // Don't interfere with editing or with right-click context menus.
    if (e.button !== 0) return;
    if (editingCtx) return;
    e.stopPropagation();
    // "Pintar bordes" (border painter): paint the pen onto the SPECIFIC edge
    // nearest the click (Word-like), never the whole cell — UNLESS the user
    // holds Shift or Ctrl, which is the explicit shortcut for "all 4 sides".
    // Stays active across clicks. No drag-select.
    //
    // Previously we had a 30% "center band" that fell back to all 4 sides for
    // central clicks, but in practice the band was too narrow to feel reliable
    // (a 40px-tall cell only had ~12px of edge zone before the center swallowed
    // the click). Word-style: always pick the nearest edge by distance, no
    // center fallback. Predictable, no surprises.
    const bp = state?.borderPainter;
    if (bp?.active) {
      const r = e.currentTarget?.getBoundingClientRect?.();
      let side = 'all';
      const allModifier = e.shiftKey || e.ctrlKey || e.metaKey;
      if (r && r.width > 0 && r.height > 0 && !allModifier) {
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const d = { top: y, bottom: r.height - y, left: x, right: r.width - x };
        const min = Math.min(d.top, d.bottom, d.left, d.right);
        side = Object.keys(d).find(k => d[k] === min) || 'all';
      }
      // Model B: the painter paints the ACTIVE border style onto the edge.
      state?.tableApplyBorders?.(element.id, [{ rowSetId, colId }], side,
        bp.borderStyleId ? { borderStyleId: bp.borderStyleId } : { width: bp.width, color: bp.color, style: bp.style });
      return;
    }
    dragStartRef.current = { rowSetId, colId };
    isDraggingRef.current = true;
    commitDragSelection({ rowSetId, colId }, e.shiftKey);
  }

  function handleCellMouseEnter(rowSetId, colId) {
    if (!isDraggingRef.current || !dragStartRef.current) return;
    commitDragSelection({ rowSetId, colId }, false);
  }

  // ── Structural right-click menu (Word style) ──────────────────────────
  // Separate from SingleRow's own in-edit insert menu so neither breaks the
  // other. Only opens when NOT inline-editing a cell.
  const [cellCtxMenu, setCellCtxMenu]       = useState(null); // { x, y } | null
  const [cellPropsCells, setCellPropsCells] = useState(null); // cells[]  | null

  function handleCellContextMenu(e, rowSetId, colId) {
    if (editingCtx) return;
    e.preventDefault();
    e.stopPropagation();
    // Word-like: right-clicking a cell outside the current selection selects
    // it alone; right-clicking inside the selection keeps the multi-selection.
    const sel = state?.tableCellSelection;
    const inSel = sel?.tableElId === element.id
      && (sel.cells ?? []).some(c => c.rowSetId === rowSetId && c.colId === colId);
    if (!inSel) {
      state?.setTableCellSelection?.({ tableElId: element.id, cells: [{ rowSetId, colId }] });
    }
    setCellCtxMenu({ x: e.clientX, y: e.clientY });
  }

  // End drag on any global mouseup. Clear selection on outside-click.
  useEffect(() => {
    function onUp() { isDraggingRef.current = false; dragStartRef.current = null; }
    function onDown(e) {
      // Clicks on UI that ACTS ON the current cell selection must NOT clear it
      // (all are portaled/rendered outside tableRef):
      //   .tcm                  structural right-click context menu
      //   .rb                   the ribbon ("Tabla" tab operates on the sel.)
      //   .rb__dropdown-menu    ribbon dropdowns portaled to <body> (outside .rb)
      //   .rb__popover          table-design gallery / color popovers (portaled)
      //   .cpm-backdrop         the cell-properties modal
      //   .cag                  cell-alignment 3×3 grid (panel + ribbon + future)
      // Without this, clicking a ribbon "Tabla" button fires this mousedown
      // FIRST, clears tableCellSelection, the Tabla tab unmounts, and the
      // button's onClick never applies → "the option vanishes / does nothing".
      if (e.target.closest?.('.tcm, .rb, .rb__dropdown-menu, .rb__popover, .cpm-backdrop, .cag')) return;
      // If the click is outside this table, clear the cell selection.
      if (state?.tableCellSelection?.tableElId !== element.id) return;
      if (tableRef.current && !tableRef.current.contains(e.target)) {
        state?.clearTableCellSelection?.();
      }
    }
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousedown', onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.tableCellSelection?.tableElId, element.id]);

  // ── Resize state ───────────────────────────────────────────────────────
  const tableRef = useRef(null);
  const [draftRatios, setDraftRatios] = useState(null);
  const [draftRowHeights, setDraftRowHeights] = useState({});
  const [activeColIdx, setActiveColIdx] = useState(null);
  const [activeRowId, setActiveRowId] = useState(null);

  // Measured combined pixel height of each vertical-merge run (anchor slot
  // top → last member cell bottom). The anchor is `position:absolute`, so it
  // does NOT affect the in-flow slot/spacer heights it's measured from →
  // measurement is stable (no feedback loop) AS LONG AS the anchor's commit
  // never writes its (combined) height back as a row minHeight — see the
  // vMerge guard in commitCurrentCell.
  const [vMergePx, setVMergePx] = useState({});
  useLayoutEffect(() => {
    const root = tableRef.current;
    if (!root || vMergeRuns.size === 0) {
      setVMergePx(prev => (Object.keys(prev).length ? {} : prev));
      return;
    }
    function measure() {
      const next = {};
      for (const [key, members] of vMergeRuns) {
        const colId  = key.slice(key.indexOf(':') + 1);
        const slot   = root.querySelector(`[data-vmrun="${key}"]`);
        const lastRs = members[members.length - 1];
        const lastEl = root.querySelector(`[data-trs="${lastRs}"][data-tcol="${colId}"]`);
        if (!slot || !lastEl) continue;
        const a = slot.getBoundingClientRect();
        const b = lastEl.getBoundingClientRect();
        const px = Math.round(b.bottom - a.top);
        if (px > 0) next[key] = px;
      }
      setVMergePx(prev => {
        const ks = Object.keys(next);
        const same = ks.length === Object.keys(prev).length
          && ks.every(k => prev[k] === next[k]);
        return same ? prev : next;
      });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [vMergeRuns, state?.zoom, draftRowHeights, editingCtx, rowSets]);

  // Clean up body cursor on unmount
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  // Border painter exits on: Escape, ribbon re-toggle, OR a click anywhere
  // that is NOT a table or the ribbon/popovers. Without the outside-click
  // exit it stayed "stuck" and blocked normal cell selection.
  const painterActive = !!state?.borderPainter?.active;
  useEffect(() => {
    if (!painterActive) return;
    function onKey(e) { if (e.key === 'Escape') state?.setBorderPainter?.(null); }
    function onDownDoc(e) {
      const t = e.target;
      if (t?.closest?.('.tele')) return;                           // painting a cell
      if (t?.closest?.('.rb, .rb__popover, .rb__dropdown-menu, .tcm, .cpm-backdrop')) return; // ribbon/menus
      state?.setBorderPainter?.(null);                             // clicked elsewhere → exit
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDownDoc, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDownDoc, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painterActive]);

  // Patch the table element wherever it lives (pool ContentArea or page).
  // Mirrors the commitCell strategy: embedded → setTemplate; standalone → updateCurrentPage.
  function patchTableElement(changes) {
    if (element.embedded && areaId) {
      state?.setTemplate?.(t => ({
        ...t,
        contentAreas: (t.contentAreas ?? []).map(ca =>
          ca.id !== areaId ? ca : {
            ...ca,
            elements: (ca.elements ?? []).map(el =>
              el.id !== element.id ? el
                : { ...el, ...changes, updatedAt: new Date().toISOString() }
            ),
          }
        ),
      }));
    } else {
      state?.updateCurrentPage?.(p => ({
        ...p,
        elements: (p.elements ?? []).map(el =>
          el.id !== element.id ? el
            : { ...el, ...changes, updatedAt: new Date().toISOString() }
        ),
      }));
    }
  }

  // ── Column drag ────────────────────────────────────────────────────────
  function startColDrag(colIdx, mouseEvent) {
    const startX = mouseEvent.clientX;
    const baseRatios = normalizeRatios(columns);
    const tableWidth = tableRef.current?.getBoundingClientRect()?.width
      ?? (element.width * MM_TO_PX * (state?.zoom ?? 1));

    setActiveColIdx(colIdx);
    document.body.style.cursor = 'col-resize';
    setDraftRatios([...baseRatios]);

    function computeRatios(clientX) {
      const delta = (clientX - startX) / tableWidth;
      const minFrac = 0.04;
      const newRatios = [...baseRatios];
      newRatios[colIdx]     = Math.max(minFrac, baseRatios[colIdx] + delta);
      newRatios[colIdx + 1] = Math.max(minFrac, baseRatios[colIdx + 1] - delta);
      const total = newRatios.reduce((s, r) => s + r, 0);
      return newRatios.map(r => r / total);
    }

    function onMove(e) { setDraftRatios(computeRatios(e.clientX)); }

    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      setActiveColIdx(null);
      const finalRatios = computeRatios(e.clientX);
      const newColumns = columns.map((col, i) => ({ ...col, widthRatio: finalRatios[i] }));
      patchTableElement({ columns: newColumns });
      setDraftRatios(null);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Row drag ───────────────────────────────────────────────────────────
  function startRowDrag(rsId, rowEl, mouseEvent) {
    const startY = mouseEvent.clientY;
    const zoom = state?.zoom ?? 1;
    const rs = rowSets.find(r => r.id === rsId);
    const storedMinH = (rs?.cells ?? []).reduce((m, c) => Math.max(m, c.minHeight ?? 0), 0);
    const renderedH = rowEl?.getBoundingClientRect()?.height ?? 0;
    const baseH = storedMinH > 0 ? storedMinH : (renderedH / (MM_TO_PX * zoom));

    setActiveRowId(rsId);
    document.body.style.cursor = 'row-resize';
    setDraftRowHeights(prev => ({ ...prev, [rsId]: baseH }));

    function computeH(clientY) {
      return Math.max(3, baseH + (clientY - startY) / (MM_TO_PX * zoom));
    }

    function onMove(e) {
      setDraftRowHeights(prev => ({ ...prev, [rsId]: computeH(e.clientY) }));
    }

    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      setActiveRowId(null);
      const finalH = computeH(e.clientY);
      const newRowSets = rowSets.map(r =>
        r.id !== rsId ? r : { ...r, cells: (r.cells ?? []).map(c => ({ ...c, minHeight: finalH })) }
      );
      patchTableElement({ rowSets: newRowSets });
      setDraftRowHeights(prev => { const n = { ...prev }; delete n[rsId]; return n; });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startEdit(rowSetId, colId) {
    // While the border painter is active, clicks paint borders — never edit.
    if (state?.borderPainter?.active) return;
    const rs = rowSets.find(r => r.id === rowSetId);
    const cell = (rs?.cells ?? []).find(c => c.colId === colId);
    const flowId = cell?.flow?.id ?? null;
    state?.selectElement?.(element.id, false);
    setEditingCtx({ rowSetId, colId });
    if (flowId) state?.enterTableCellEdit?.(element.id, flowId);
  }

  function commitCell(rowSetId, colId, html, rowScrollH, dirty = true) {
    state?.exitTableCellEdit?.();
    // Clear edit-mode ONLY if it still points at the cell we're committing.
    // When the user clicks another cell, that cell's onMouseDown calls
    // startEdit (setting editingCtx to the NEW cell) BEFORE this commit fires
    // from the old cell's onBlur — a blind setEditingCtx(null) would cancel
    // the new edit, forcing a double-click. The new cell's edit effect
    // re-asserts enterTableCellEdit, so exiting areaEditCtx above is safe.
    setEditingCtx(prev =>
      (prev?.rowSetId === rowSetId && prev?.colId === colId) ? null : prev
    );

    // Re-opening a cell and leaving without typing must NOT overwrite saved
    // content — just exit edit-mode (handled above).
    if (!dirty) return;

    // Compute the auto-grow. `rowScrollH` is the editor's content height.
    const zoom = state?.zoom ?? 1;
    const vmKey      = `${rowSetId}:${colId}`;
    const vmMembers  = vMergeRuns?.get?.(vmKey) ?? null;  // [anchorRs, ...spanUps]
    const isVMAnchor = !!vmMembers;

    // `growRsId` = the row whose minHeight absorbs the growth.
    //  - Normal cell: its own row.
    //  - Vertical-merge anchor: the LAST member row (NEVER the anchor's own
    //    row — that would feed back into the measured combined height and
    //    grow unbounded on every edit). Growing the last member row makes
    //    the combined height converge to the content height in one step.
    const growRsId = isVMAnchor ? vmMembers[vmMembers.length - 1] : rowSetId;
    const growRs   = rowSets.find(r => r.id === growRsId);
    const currentMinH = growRs ? (growRs.cells ?? []).reduce((m, c) => Math.max(m, c.minHeight ?? 0), 0) : 0;

    let newMinH = 0; // 0 = no change
    if (isVMAnchor) {
      const combinedPx = vMergePx?.[vmKey] ?? 0;
      const contentPx  = rowScrollH ?? 0;
      if (combinedPx > 0 && contentPx > combinedPx + 1) {
        newMinH = currentMinH + (contentPx - combinedPx) / (MM_TO_PX * zoom);
      }
    } else {
      const measuredHMm = (rowScrollH ?? 0) > 0 ? rowScrollH / (MM_TO_PX * zoom) : 0;
      newMinH = measuredHMm > currentMinH ? measuredHMm : 0;
    }
    const heightDelta = newMinH > 0 ? newMinH - currentMinH : 0;

    // Patch function applied to the table element — handles HTML + minHeight + element.height
    // in a single state update to avoid overwrite races. The edited cell's
    // content goes on `rowSetId`; the minHeight growth goes on `growRsId`
    // (same row for normal cells, last member row for vMerge anchors).
    function applyToCells(el) {
      if (el.id !== element.id) return el;
      const updatedRowSets = (el.rowSets ?? []).map(r => {
        const isContentRow = r.id === rowSetId;
        const isGrowRow    = r.id === growRsId;
        if (!isContentRow && !isGrowRow) return r;
        return {
          ...r,
          cells: (r.cells ?? []).map(c => ({
            ...c,
            ...(isContentRow && c.colId === colId
              ? { flow: { ...c.flow, content: html, updatedAt: new Date().toISOString() } }
              : {}),
            ...(isGrowRow && newMinH > 0 ? { minHeight: newMinH } : {}),
          })),
        };
      });
      return {
        ...el,
        rowSets: updatedRowSets,
        ...(heightDelta > 0 ? { height: el.height + heightDelta } : {}),
        updatedAt: new Date().toISOString(),
      };
    }

    if (element.embedded) {
      // The embedded table can live in the pool (top-level OR nested child
      // areas) or in the legacy inline element.areas model. Walk them all so
      // the cell edit ALWAYS persists. The old code only patched a top-level
      // pool area whose id === areaId; for any other model the content was
      // silently dropped, so re-opening the cell showed it empty ("erased").
      // applyToCells is a no-op on non-matching elements, so this is safe.
      const walkAreas = (areas) => (areas ?? []).map(a => ({
        ...a,
        elements: (a.elements ?? []).map(applyToCells),
        children: a.children?.length ? walkAreas(a.children) : (a.children ?? []),
      }));
      state?.setTemplate?.(t => ({
        ...t,
        contentAreas: walkAreas(t.contentAreas ?? []),
        pages: (t.pages ?? []).map(p => ({
          ...p,
          elements: (p.elements ?? []).map(pel =>
            pel.areas?.length ? { ...pel, areas: walkAreas(pel.areas) } : pel
          ),
        })),
      }));
    } else {
      state?.updateCurrentPage?.(p => ({
        ...p,
        elements: (p.elements ?? []).map(applyToCells),
      }));
    }
  }

  // Live grow of a vertical-merge block WHILE typing (called from the editing
  // anchor's onInput). The anchor is position:absolute, so growing it does NOT
  // push the in-flow rows below — they'd be overlapped during edit. Growing
  // the LAST member row's minHeight live makes those in-flow rows move down in
  // real time. Safe (no loop): never touches the anchor's own row; the anchor
  // is out of flow so it doesn't feed the measured combined height; each step
  // absorbs exactly the current deficit so it converges (next input with the
  // same text is a no-op).
  function growVMergeBlockLive(rowSetId, colId, contentPx) {
    const vmKey   = `${rowSetId}:${colId}`;
    const members = vMergeRuns?.get?.(vmKey);
    if (!members) return;
    const combinedPx = vMergePx?.[vmKey] ?? 0;
    if (!(combinedPx > 0) || contentPx <= combinedPx + 2) return;  // threshold
    const zoom   = state?.zoom ?? 1;
    const lastId = members[members.length - 1];
    const lastRs = (rowSets ?? []).find(r => r.id === lastId);
    if (!lastRs) return;
    const curMm = (lastRs.cells ?? []).reduce((m, c) => Math.max(m, c.minHeight ?? 0), 0);
    const addMm = (contentPx - combinedPx) / (MM_TO_PX * zoom);
    if (addMm <= 0) return;
    const newRowSets = (rowSets ?? []).map(r =>
      r.id !== lastId ? r
        : { ...r, cells: (r.cells ?? []).map(c => ({ ...c, minHeight: curMm + addMm })) }
    );
    patchTableElement({ rowSets: newRowSets, height: (element.height ?? 0) + addMm });
  }

  // Auto-height: called by SingleRow when the row's rendered height exceeds stored minHeight
  // (e.g., after a sub-area is edited via mini-canvas without going through commitCell).
  function autoHeight(rsId, newMinHMm) {
    const rs = rowSets.find(r => r.id === rsId);
    if (!rs) return;
    const currentMinH = (rs.cells ?? []).reduce((m, c) => Math.max(m, c.minHeight ?? 0), 0);
    if (newMinHMm <= currentMinH + 0.1) return;
    const heightDelta = newMinHMm - currentMinH;
    function apply(el) {
      if (el.id !== element.id) return el;
      return {
        ...el,
        rowSets: (el.rowSets ?? []).map(r =>
          r.id !== rsId ? r : {
            ...r,
            cells: (r.cells ?? []).map(c => ({ ...c, minHeight: newMinHMm })),
          }
        ),
        height: el.height + heightDelta,
        updatedAt: new Date().toISOString(),
      };
    }
    if (element.embedded && areaId) {
      state?.setTemplate?.(t => ({
        ...t,
        contentAreas: (t.contentAreas ?? []).map(ca =>
          ca.id !== areaId ? ca : { ...ca, elements: (ca.elements ?? []).map(apply) }
        ),
      }));
    } else {
      state?.updateCurrentPage?.(p => ({
        ...p,
        elements: (p.elements ?? []).map(apply),
      }));
    }
  }

  if (!rootRowSetId && element.sections) {
    return <LegacyTableElement element={element} />;
  }

  // Use draft ratios during column drag for live preview
  const baseRatios = normalizeRatios(columns);
  const effectiveRatios = draftRatios ?? baseRatios;
  const root = rowSets.find(r => r.id === rootRowSetId);

  if (!root) {
    return <div className="tele tele--empty">Sin estructura de tabla</div>;
  }

  function escapeEdit() {
    state?.exitTableCellEdit?.();
    setEditingCtx(null);
  }

  // Shared props for resize handlers
  const resizeProps = {
    onStartRowResize: startRowDrag,
    draftRowHeights,
    activeRowId,
  };

  const cellEditingClass = editingCtx ? ' tele--cell-editing' : '';
  // When any cell has user-configured inline borders, hide the editor's dashed
  // grid guides — otherwise they double up with the real borders and look like
  // a "double line" between rows / columns.
  // Table Style applied to this whole table (role-based borders/fill). Computed
  // once so every render branch can resolve per-cell + draw the outer border.
  const tableStyle = (state?.template?.styles?.table ?? []).find(s => s.id === element.tableStyleRef) ?? null;

  const hasUserBorders = !!tableStyle || (rowSets ?? []).some(rs =>
    (rs.cells ?? []).some(c => c.border?.inline || c.border?.styleRef)
  );
  const borderedClass = hasUserBorders ? ' tele--has-borders' : '';
  const painterClass  = painterActive ? ' tele--painter' : '';

  // Outer perimeter border from the Table Style's `tableBorderStyleRef`,
  // merged onto the .tele root style. Reuses the named-style border resolution.
  const tableStyleOuterCss = (() => {
    const refId = tableStyle?.tableBorderStyleRef;
    if (!refId) return null;
    const css = buildCellBorderCss({ styleRef: refId }, borderStyles, fillStyles, state?.template?.colors);
    const out = {};
    if (css.borderTop)    out.borderTop = css.borderTop;
    if (css.borderRight)  out.borderRight = css.borderRight;
    if (css.borderBottom) out.borderBottom = css.borderBottom;
    if (css.borderLeft)   out.borderLeft = css.borderLeft;
    if (css.borderRadius) { out.borderRadius = css.borderRadius; out.overflow = 'hidden'; }
    return Object.keys(out).length ? { ...out, boxSizing: 'border-box' } : null;
  })();

  // Structural context menu + cell-properties modal. Both portal to <body>,
  // so where this lives in the table's JSX tree is irrelevant — it just needs
  // to be mounted. Rendered in every render branch below.
  const selCells = (state?.tableCellSelection?.tableElId === element.id)
    ? (state.tableCellSelection.cells ?? [])
    : [];
  const cellMenuOverlay = (
    <>
      {cellCtxMenu && (
        <TableContextMenu
          position={cellCtxMenu}
          tableEl={element}
          selection={selCells}
          onClose={() => setCellCtxMenu(null)}
          onInsertRowAbove={(cell, n = 1) => state?.tableInsertRow?.(element.id, cell.rowSetId, 'above', n)}
          onInsertRowBelow={(cell, n = 1) => state?.tableInsertRow?.(element.id, cell.rowSetId, 'below', n)}
          onInsertColLeft={(cell, n = 1) => state?.tableInsertColumn?.(element.id, cell.colId, 'left', n)}
          onInsertColRight={(cell, n = 1) => state?.tableInsertColumn?.(element.id, cell.colId, 'right', n)}
          onDeleteRows={rowSetIds => state?.tableRemoveRows?.(element.id, rowSetIds)}
          onDeleteColumns={colIds => state?.tableRemoveColumns?.(element.id, colIds)}
          onDeleteTable={() => state?.removeElements?.([element.id])}
          onMergeCells={cells => state?.tableMergeCells?.(element.id, cells)}
          onUnmergeCells={cells => state?.tableUnmergeCells?.(element.id, cells)}
          onDistributeRows={rowSetIds => state?.tableDistributeRows?.(element.id, rowSetIds)}
          onDistributeColumns={colIds => state?.tableDistributeColumns?.(element.id, colIds)}
          onCellProperties={cells => setCellPropsCells(cells?.length ? cells : selCells)}
        />
      )}
      {cellPropsCells && (
        <CellPropertiesModal
          tableEl={element}
          cells={cellPropsCells}
          state={state}
          onClose={() => setCellPropsCells(null)}
        />
      )}
    </>
  );

  // single-row root: just one row, no header bar, no sections
  if (root.type === 'single-row') {
    return (
      <div
        className={`tele${cellEditingClass}${borderedClass}${painterClass}`}
        ref={tableRef}
        style={{ ...buildRoundedTableRootStyle(element, borderStyles, state?.template?.colors, fillStyles), ...(tableStyleOuterCss || {}) }}
      >
        <SingleRow
          rs={root} columns={columns} ratios={effectiveRatios}
          borderStyles={borderStyles} fillStyles={fillStyles}
          tableStyle={tableStyle} regionKey="body" bodyRowOffset={0}
          editingColId={editingCtx?.rowSetId === root.id ? editingCtx.colId : null}
          onStartEdit={startEdit} onCommit={commitCell} onVMergeGrow={growVMergeBlockLive} onEscape={escapeEdit}
          onAutoHeight={autoHeight}
          state={state} elementId={element.id}
          cellCornersAll={element.cellCornersAll ?? false}
          tableRadius={element.tableRadius ?? 0}
          onCellMouseDown={handleCellMouseDown}
          onCellMouseEnter={handleCellMouseEnter}
          onCellContextMenu={handleCellContextMenu}
          isCellSelected={isCellSelected}
          vMergeNoBottom={vMergeNoBottom}
          vMergeRuns={vMergeRuns}
          vMergePx={vMergePx}
          tableInEditMode={!!editingCtx}
          {...resizeProps}
        />
        {!editingCtx && (
          <ColResizeHandles ratios={effectiveRatios} onStartDrag={startColDrag} activeIdx={activeColIdx} />
        )}
        {cellMenuOverlay}
      </div>
    );
  }

  if (root.type === 'multiple-rows' || root.type === 'repeated') {
    return (
      <div
        className={`tele${cellEditingClass}${borderedClass}${painterClass}`}
        ref={tableRef}
        style={{ ...buildRoundedTableRootStyle(element, borderStyles, state?.template?.colors, fillStyles), ...(tableStyleOuterCss || {}) }}
      >
        <RowSetTree
          rowSetId={root.id}
          allRowSets={rowSets}
          columns={columns}
          ratios={effectiveRatios}
          borderStyles={borderStyles}
          fillStyles={fillStyles}
          tableStyle={tableStyle}
          regionKey="body"
          editingCtx={editingCtx}
          onStartEdit={startEdit}
          onCommit={commitCell}
          onVMergeGrow={growVMergeBlockLive}
          onEscape={escapeEdit}
          onAutoHeight={autoHeight}
          cellCornersAll={element.cellCornersAll ?? false}
          tableRadius={element.tableRadius ?? 0}
          state={state}
          elementId={element.id}
          onCellMouseDown={handleCellMouseDown}
          onCellMouseEnter={handleCellMouseEnter}
          onCellContextMenu={handleCellContextMenu}
          isCellSelected={isCellSelected}
          vMergeNoBottom={vMergeNoBottom}
          vMergeRuns={vMergeRuns}
          vMergePx={vMergePx}
          tableInEditMode={!!editingCtx}
          {...resizeProps}
        />
        {!editingCtx && (
          <ColResizeHandles ratios={effectiveRatios} onStartDrag={startColDrag} activeIdx={activeColIdx} />
        )}
        {cellMenuOverlay}
      </div>
    );
  }

  const linked = (a, b) => a && b && a === b;

  const sections = [
    {
      key: 'firstHeader',
      id: root.firstHeaderId,
      label: '1ª Cabecera',
      cls: 'tele__section--first-header',
      show: !!root.firstHeaderId && !linked(root.firstHeaderId, root.headerId),
    },
    {
      key: 'header',
      id: root.headerId,
      label: linked(root.firstHeaderId, root.headerId) ? null : 'Cabecera',
      cls: 'tele__section--header',
      show: !!root.headerId,
      applyBodyColors: false,
    },
    {
      key: 'body',
      id: root.bodyId,
      label: null,
      cls: 'tele__section--body',
      show: !!root.bodyId,
      applyBodyColors: true,
    },
    {
      key: 'footer',
      id: root.footerId,
      label: !linked(root.footerId, root.lastFooterId) ? 'Pie' : null,
      cls: 'tele__section--footer',
      show: !!root.footerId && !linked(root.footerId, root.lastFooterId),
    },
    {
      key: 'lastFooter',
      id: root.lastFooterId,
      label: 'Último Pie',
      cls: 'tele__section--last-footer',
      show: !!root.lastFooterId,
    },
  ];

  return (
    <div
      className={`tele${cellEditingClass}${borderedClass}${painterClass}`}
      ref={tableRef}
      style={{ ...buildRoundedTableRootStyle(element, borderStyles, state?.template?.colors, fillStyles), ...(tableStyleOuterCss || {}) }}
    >
      {sections.map(sec => {
        if (!sec.show || !sec.id) return null;
        return (
          <div key={sec.key} className={`tele__section ${sec.cls}`}>
            <RowSetTree
              rowSetId={sec.id}
              allRowSets={rowSets}
              columns={columns}
              ratios={effectiveRatios}
              oddRowColor={sec.applyBodyColors ? oddRowColor : undefined}
              evenRowColor={sec.applyBodyColors ? evenRowColor : undefined}
              borderStyles={borderStyles}
              fillStyles={fillStyles}
              tableStyle={tableStyle}
              regionKey={sec.key}
              editingCtx={editingCtx}
              onStartEdit={startEdit}
              onCommit={commitCell}
              onVMergeGrow={growVMergeBlockLive}
              onEscape={escapeEdit}
              onAutoHeight={autoHeight}
              state={state}
              elementId={element.id}
              cellCornersAll={element.cellCornersAll ?? false}
              tableRadius={element.tableRadius ?? 0}
              onCellMouseDown={handleCellMouseDown}
              onCellMouseEnter={handleCellMouseEnter}
              onCellContextMenu={handleCellContextMenu}
              isCellSelected={isCellSelected}
              vMergeNoBottom={vMergeNoBottom}
              vMergeRuns={vMergeRuns}
              vMergePx={vMergePx}
              tableInEditMode={!!editingCtx}
              {...resizeProps}
            />
          </div>
        );
      })}
      {!editingCtx && (
        <ColResizeHandles ratios={effectiveRatios} onStartDrag={startColDrag} activeIdx={activeColIdx} />
      )}
      {cellMenuOverlay}
    </div>
  );
}

// ── Backward-compat: old flat sections model ──────────────────────────────

function LegacyTableElement({ element }) {
  const { columns = [], sections = {}, oddRowColor, evenRowColor } = element;
  const ratios = normalizeRatios(columns);
  const { firstHeader, header, body, footer, lastFooter } = sections;

  function LegacyRow({ row }) {
    if (!row?.cells?.length) return null;
    const cellMap = {};
    row.cells.forEach(c => { cellMap[c.colId] = c; });
    return (
      <div className="tele__row">
        {columns.map((col, i) => {
          const cell = cellMap[col.id];
          if (!cell) return null;
          return (
            <div
              key={col.id}
              className={`tele__cell tele__cell--valign-${cell.vAlign ?? 'top'}${cell.spanLeft ? ' tele__cell--hidden' : ''}`}
              style={{ width: `${ratios[i] * 100}%` }}
            >
              {cell.spanLeft ? null : (cell.content || '')}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="tele">
      <div className="tele__col-bar">
        {columns.map((col, i) => (
          <div key={col.id} className="tele__col-label" style={{ width: `${ratios[i] * 100}%` }}>
            {col.label}
          </div>
        ))}
      </div>
      {firstHeader?.enabled && (firstHeader.rows ?? []).map(r => (
        <div key={r.id} className="tele__section tele__section--first-header">
          <div className="tele__section-label">1ª Cabecera</div>
          <LegacyRow row={r} />
        </div>
      ))}
      {(header?.rows ?? []).map(r => <LegacyRow key={r.id} row={r} />)}
      <div className="tele__body">
        {body?.type === 'repeated' && (
          <div className="tele__repeat-badge">↻ {body.repeatVar || 'Repetido'}</div>
        )}
        {(body?.rows ?? []).map((row, idx) => {
          const bg = idx % 2 === 0 ? oddRowColor : evenRowColor;
          return (
            <div key={row.id} style={bg ? { background: bg } : undefined}>
              <LegacyRow row={row} />
            </div>
          );
        })}
      </div>
      {footer?.enabled && (footer.rows ?? []).map(r => <LegacyRow key={r.id} row={r} />)}
      {lastFooter?.enabled && (lastFooter.rows ?? []).map(r => <LegacyRow key={r.id} row={r} />)}
    </div>
  );
}
