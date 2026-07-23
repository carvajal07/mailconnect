// editor/canvas/elements/ContentAreaElement.jsx — ContentArea with inline area-tags

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import TableElement   from './TableElement.jsx';
import ImageElement   from './ImageElement.jsx';
import ShapeElement   from './ShapeElement.jsx';
import QRElement      from './QRElement.jsx';
import BarcodeElement from './BarcodeElement.jsx';
import ChartElement   from './ChartElement.jsx';
import { Lock } from 'lucide-react';
import { resolveTextStyle } from '../../../engine/textStyleUtils.js';
import { resolveParagraphStyle } from '../../../engine/paragraphStyleUtils.js';
import { mmToPx as mmToPxDesign } from '../../../engine/units.js';
import AreaRuler from './AreaRuler.jsx';
import VariableAutocomplete from './VariableAutocomplete.jsx';
import ContentAreaContextMenu from './ContentAreaContextMenu.jsx';
import InsertTableDialog from './InsertTableDialog.jsx';
import { buildTableFromDialogOptions } from './advancedTableBuild.js';
import StyleEditModal from '../../properties/StyleEditModal.jsx';
import { applyParagraphBlockStyles, stripParagraphBlockStyles, resolveParagraphBlocks } from './selectionStyle.js';
import ObjectListPanel from './ObjectListPanel.jsx';
import {
  insertVariableTag, detectDoubleBrace, removeDoubleBrace,
  getCaretPosition, guardInlineTags, insertAreaTag,
  insertElementTag, buildElementTagLabel,
} from './variableUtils.js';
import {
  mmToPx,
  buildSampleValues,
  textStyleToCSS,
  computeBorderData,
  computeFillStyle,
  resolveFillToCSS,
  buildRectPath,
  findChildAreaById,
  resolveForDisplay,
  expandAreaTagsForEditor,
  collapseAreaTagsForEditor,
  applyAreaLayoutCSS,
  applyContentLayoutCSS,
  FLOW_TYPE_LABELS,
  collectAllAreaNums,
  splitHtmlAtElementTags,
} from './contentAreaUtils.js';
import { sanitizeHtml } from './htmlSanitizer.js';
import './ContentAreaElement.css';
import './VariableTag.css';

// Converts inline `font-size: Xpt` CSS in stored HTML to zoom-scaled px.
// Stored HTML may contain pt values from patchFontElements (inline editing).
// Without this, inline-formatted text doesn't scale with canvas zoom.
function applyZoomToInlinePt(html, z) {
  if (!html) return html;
  return html.replace(/font-size\s*:\s*([\d.]+)pt/gi, (_, pts) =>
    `font-size: ${(parseFloat(pts) * (144 / 72) * z).toFixed(2)}px`
  );
}

// Encuentra la CABECERA de la cadena de desbordamiento (el área sin
// previousAreaRef) recorriendo hacia atrás desde `prevId`, y la página donde
// vive. Devuelve { head, pageIdx } | null.
function findChainHead(pages, prevId) {
  if (!prevId) return null;
  const all = (pages ?? []).flatMap(p => p.elements ?? []);
  const byId = Object.fromEntries(all.map(e => [e.id, e]));
  let cur = byId[prevId], head = cur, guard = 0;
  while (cur && guard++ < 1000) { head = cur; cur = cur.previousAreaRef ? byId[cur.previousAreaRef] : null; }
  if (!head) return null;
  let pageIdx = -1;
  (pages ?? []).forEach((p, i) => { if ((p.elements ?? []).some(e => e.id === head.id)) pageIdx = i; });
  return { head, pageIdx };
}

// ── SVG Border overlay ────────────────────────────────────────────────────────

function SvgBorderOverlay({ sideStyles, corners, fillStyle, margins, marginLine, diagonal, lineColor, lineWidth, lineStyle, fillConfig, shearAngle, shearTopOffset = 0 }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { w, h } = size;

  // Compute shear dx from the angle and the MEASURED height of this container.
  // This automatically adapts to content-only wrappers (shorter than the element)
  // vs full-area wrappers, always producing the correct parallelogram slope.
  const sdx = (shearAngle && h > 0)
    ? Math.min(Math.abs(Math.tan((shearAngle * Math.PI) / 180) * h), w * 0.92)
    : 0;

  // For sheared areas, parallelogram corner x-offsets.
  // shearTopOffset > 0 shifts left-side corners right (positive shear) or right-side corners left
  // (negative shear) so the border aligns with the top-portion of the full-element parallelogram.
  // positive shear: tl=(dx+off,0), tr=(w,0), br=(w-dx,h), bl=(off,h)
  // negative shear: tl=(0,0), tr=(w-dx-off,0), br=(w-off,h), bl=(dx,h)
  const ptl = sdx > 0 ? (shearAngle > 0 ? 0                        : sdx + shearTopOffset) : 0;
  const ptr = sdx > 0 ? (shearAngle > 0 ? w - sdx - shearTopOffset : w                    ) : w;
  const pbr = sdx > 0 ? (shearAngle > 0 ? w - shearTopOffset       : w - sdx              ) : w;
  const pbl = sdx > 0 ? (shearAngle > 0 ? sdx                      : shearTopOffset        ) : 0;

  function buildPath() {
    if (!w || !h) return '';
    if (sdx > 0) {
      // Parallelogram — no corner rounding on diagonal sides
      return `M ${ptl},0 L ${ptr},0 L ${pbr},${h} L ${pbl},${h} Z`;
    }
    const [tl, tr, br, bl] = corners.map(c => ({
      corner: c.corner,
      rx: Math.min(c.rx, w / 2),
      ry: Math.min(c.ry, h / 2),
    }));
    function cornerCmd(c, ex, ey) {
      if ((!c.rx && !c.ry) || c.corner === 'Standard') return `L ${ex},${ey}`;
      if (c.corner === 'Round')    return `A ${c.rx} ${c.ry} 0 0 1 ${ex},${ey}`;
      if (c.corner === 'RoundOut') return `A ${c.rx} ${c.ry} 0 0 0 ${ex},${ey}`;
      return `L ${ex},${ey}`;
    }
    return [
      `M ${tl.rx},0`,
      `H ${w - tr.rx}`,
      cornerCmd(tr, w, tr.ry),
      `V ${h - br.ry}`,
      cornerCmd(br, w - br.rx, h),
      `H ${bl.rx}`,
      cornerCmd(bl, 0, h - bl.ry),
      `V ${tl.ry}`,
      cornerCmd(tl, tl.rx, 0),
      'Z',
    ].join(' ');
  }

  const path = buildPath();
  const topS = sideStyles.top; const rightS = sideStyles.right;
  const bottomS = sideStyles.bottom; const leftS = sideStyles.left;
  const allSameStroke = topS && rightS && bottomS && leftS &&
    topS.color === rightS.color && topS.color === bottomS.color && topS.color === leftS.color &&
    topS.width === rightS.width && topS.style === rightS.style;
  const fillColor = fillStyle?.background;

  const mmToPxLocal = (mm) => parseFloat((mm * 3.7795).toFixed(2));
  const inset = margins
    ? { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left }
    : { inset: 0 };
  const diagSW    = lineWidth ?? 1;
  const diagColor = lineColor ?? '#000000';
  function dashArray(style, sw) {
    if (style === 'dashed') return `${sw * 4},${sw * 2}`;
    if (style === 'dotted') return `${sw},${sw * 2}`;
    return undefined;
  }
  const diagDA = dashArray(lineStyle ?? 'solid', diagSW);

  // Fill path: use fillConfig if defined, otherwise fall back to border path
  let fillPath = path;
  if (fillConfig && w > 0 && h > 0) {
    const fl = fillConfig.left, fr = fillConfig.right, ft = fillConfig.top, fb = fillConfig.bottom;
    fillPath = buildRectPath(
      fl, ft, w - fr, h - fb,
      fillConfig.corner,
      Math.min(fillConfig.rx, (w - fl - fr) / 2),
      Math.min(fillConfig.ry, (h - ft - fb) / 2),
    );
  }

  // Margin inner border path (inset rect from element edges)
  const marginPath = (marginLine && w > 0 && h > 0)
    ? `M 0,0 H ${w} V ${h} H 0 Z`
    : null;

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', ...inset, pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}
    >
      {w > 0 && h > 0 && (
        <svg
          width={w} height={h}
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          {/* Fill (independent shape or same as border path) */}
          {fillColor && <path d={fillPath} fill={fillColor} />}
          {/* Diagonal lines — per-diagonal style with global fallback */}
          {diagonal?.lr && (() => {
            const d = diagonal.lr;
            const sw = d.lineWidth != null ? Math.max(0.5, mmToPxLocal(d.lineWidth)) : diagSW;
            const sc = d.lineColor ?? diagColor;
            const ss = (d.lineStyle ?? lineStyle ?? 'solid').toLowerCase();
            return <line x1={0} y1={0} x2={w} y2={h} stroke={sc} strokeWidth={sw} strokeDasharray={dashArray(ss, sw)} />;
          })()}
          {diagonal?.rl && (() => {
            const d = diagonal.rl;
            const sw = d.lineWidth != null ? Math.max(0.5, mmToPxLocal(d.lineWidth)) : diagSW;
            const sc = d.lineColor ?? diagColor;
            const ss = (d.lineStyle ?? lineStyle ?? 'solid').toLowerCase();
            return <line x1={w} y1={0} x2={0} y2={h} stroke={sc} strokeWidth={sw} strokeDasharray={dashArray(ss, sw)} />;
          })()}
          {/* Border */}
          {allSameStroke && topS && (
            <path d={path} fill="none" stroke={topS.color} strokeWidth={topS.width}
              strokeDasharray={dashArray(topS.style, topS.width)}
            />
          )}
          {!allSameStroke && [
            {
              s: topS,
              d: sdx > 0
                ? `M ${ptl},0 L ${ptr},0`
                : `M ${corners[0]?.rx ?? 0},0 H ${w - (corners[1]?.rx ?? 0)}`,
            },
            {
              s: rightS,
              d: sdx > 0
                ? `M ${ptr},0 L ${pbr},${h}`
                : `M ${w},${corners[1]?.ry ?? 0} V ${h - (corners[2]?.ry ?? 0)}`,
            },
            {
              s: bottomS,
              d: sdx > 0
                ? `M ${pbr},${h} L ${pbl},${h}`
                : `M ${w - (corners[2]?.rx ?? 0)},${h} H ${corners[3]?.rx ?? 0}`,
            },
            {
              s: leftS,
              d: sdx > 0
                ? `M ${pbl},${h} L ${ptl},0`
                : `M 0,${h - (corners[3]?.ry ?? 0)} V ${corners[0]?.ry ?? 0}`,
            },
          ].map(({ s, d }, i) => s && (
            <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={s.width}
              strokeDasharray={dashArray(s.style, s.width)}
            />
          ))}
          {/* Margin inner border line */}
          {marginLine && marginPath && (
            <path d={marginPath} fill="none"
              stroke={marginLine.color} strokeWidth={marginLine.width}
              strokeDasharray={dashArray(marginLine.style, marginLine.width)}
            />
          )}
        </svg>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContentAreaElement({ element, state }) {
  const areas = state?.resolveAreas?.(element) ?? element.areas ?? [];
  const { updateArea, enterAreaEdit, addArea } = state ?? {};

  // In the inline model, areas[0] is the area we edit/display
  const rootArea     = areas[0] ?? null;
  const childAreas   = rootArea?.children ?? [];
  const rootFlowType = rootArea?.flowType ?? 'simple';
  // Full pool: lets area-tag references resolve even if the referenced area
  // is a sibling in the pool rather than a descendant of the root area.
  const allPoolAreas = state?.template?.contentAreas ?? childAreas;

  // Condition branch preview — set by eye button in properties panel
  const previewAreaCtx = state?.previewAreaCtx;
  const previewAreaId  = previewAreaCtx?.caId === element.id ? previewAreaCtx?.areaId : null;
  const previewArea    = previewAreaId ? findChildAreaById(childAreas, previewAreaId) : null;

  const [editingAreaId, setEditingAreaId] = useState(null);
  const [styleModal, setStyleModal] = useState(null); // { kind: 'text'|'paragraph'|'bullets' } | null
  const [contentOverflow, setContentOverflow] = useState(false);
  const [contentOnlyHeight, setContentOnlyHeight] = useState(null);
  const editRef          = useRef(null);
  const contentRef       = useRef(null);
  const clickPosRef      = useRef(null);
  const [autocomplete,    setAutocomplete]   = useState(null);  // { position }
  const [contextMenu,     setContextMenu]    = useState(null);  // { x, y }
  const [tableDialog,     setTableDialog]    = useState(false);
  // Synchronous guard for handleBlur: setTableDialog is async, so a blur firing
  // between the menu click and the next render would see tableDialog=false in
  // closure and run commitEdit, which clears editingAreaId and unmounts the
  // entire isEditing branch (including the dialog portal). This ref is updated
  // synchronously before setTableDialog(true) so the blur guard always sees it.
  const tableDialogOpenRef = useRef(false);
  const [objectPanel,     setObjectPanel]    = useState(null);  // { x, y }
  const braceInfoRef      = useRef(null);
  const savedRangeRef     = useRef(null);
  const pendingVarRef     = useRef(null);
  const isDraggingVarRef  = useRef(false);
  const editEmbeddedRootsRef = useRef(new Map()); // elementId → createRoot instance (edit mode)

  // ── Enter edit mode ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editingAreaId || !editRef.current) return;
    const editor = editRef.current;
    // Unmount embedded roots from a PREVIOUS edit session before replacing innerHTML.
    // The innerHTML assignment below destroys the host spans those roots are attached
    // to; reusing them would render the table into a detached node (invisible) while
    // the new span shows the raw "◆ Tabla" label → the "table disappears/reappears"
    // glitch. Clearing forces a fresh createRoot on the new, visible span.
    editEmbeddedRootsRef.current.forEach(r => { try { r.unmount(); } catch { /* noop */ } });
    editEmbeddedRootsRef.current.clear();
    // Use the content of the specific area being edited, which may be a sub-area
    const editingArea = editingAreaId === rootArea?.id
      ? rootArea
      : findChildAreaById(rootArea?.children ?? [], editingAreaId);
    const rawContent = (editingArea ?? rootArea)?.content ?? '';
    const editZoom = state?.zoom ?? 1;
    editor.innerHTML = sanitizeHtml(rawContent.replace(
      /font-size\s*:\s*([\d.]+)pt/gi,
      (_, pts) => `font-size: ${(parseFloat(pts) * (144 / 72) * editZoom).toFixed(2)}px`
    ));
    // Expand area-tag spans inline — search full pool so sibling/cousin area refs resolve
    expandAreaTagsForEditor(editor, allPoolAreas, editZoom);
    // Per-block paragraph styles: inject the resolved CSS into [data-pstyle] blocks
    // so the editor shows each paragraph's own style. Stripped again in commitEdit.
    applyParagraphBlockStyles(editor, paragraphStyles, editZoom);
    // Inject shear float divs so each line respects the inclined edge.
    // In content-only mode the floats use full-element height — this is intentional: the shape-outside
    // taper then matches the top-portion slice of the full parallelogram exactly.
    if (shearFloatHtmlForEditor) editor.insertAdjacentHTML('afterbegin', shearFloatHtmlForEditor);
    editor.focus();

    // Place caret at click position if available
    const pos = clickPosRef.current;
    clickPosRef.current = null;
    let placed = false;
    if (pos) {
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(pos.x, pos.y);
        if (r && editor.contains(r.startContainer)) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          placed = true;
        }
      } else if (document.caretPositionFromPoint) {
        const cp = document.caretPositionFromPoint(pos.x, pos.y);
        if (cp && editor.contains(cp.offsetNode)) {
          const sel = window.getSelection();
          const r = document.createRange();
          r.setStart(cp.offsetNode, cp.offset);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          placed = true;
        }
      }
    }
    if (!placed) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(editor.textContent ? false : true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // If cursor landed inside a contenteditable="false" span (e.g. embedded table tag),
    // move it to just after that span so the user can type immediately.
    {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        const node = r.startContainer;
        const nonEditable = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
          ?.closest?.('[contenteditable="false"]');
        if (nonEditable && editor.contains(nonEditable)) {
          const fixRange = document.createRange();
          fixRange.setStartAfter(nonEditable);
          fixRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(fixRange);
        }
      }
    }

    if (state?.activeEditorRef) state.activeEditorRef.current = editor;
    if (state?.activeEditorMetaRef) {
      state.activeEditorMetaRef.current = {
        areaId: editingAreaId,
        defaultTextStyleId: rootArea?.defaultTextStyleId ?? null,
      };
    }

    // Insert queued variable (from drag-drop before edit mode)
    if (pendingVarRef.current) {
      const varPath = pendingVarRef.current;
      pendingVarRef.current = null;
      const sel2 = window.getSelection();
      const r2 = document.createRange();
      r2.selectNodeContents(editor);
      r2.collapse(false);
      sel2.removeAllRanges();
      sel2.addRange(r2);
      insertVariableTag(editor, varPath);
    }

    // MutationObserver: detect true deletion of element-tags → clean up embedded element data.
    // We MUST defer the check with queueMicrotask because the browser's Enter handler first
    // REMOVES the element-tag span from its parent (triggering this observer) and then
    // RE-INSERTS it inside a newly created <div>. Without the defer, we'd mistake every
    // "Enter after table" for a deletion. The microtask runs after the browser finishes
    // its synchronous DOM rewrap, so `editor.contains(node)` correctly tells us whether
    // the span was truly deleted vs. just moved to a new container.
    const observer = new MutationObserver(mutations => {
      const candidates = new Map(); // elementId → span node
      for (const m of mutations) {
        for (const node of m.removedNodes) {
          if (node.nodeType === 1 && node.classList.contains('element-tag')) {
            const removedId = node.getAttribute('data-element');
            if (removedId) candidates.set(removedId, node);
          }
        }
      }
      if (!candidates.size) return;

      queueMicrotask(() => {
        for (const [removedId, node] of candidates) {
          if (editor.contains(node)) continue; // moved, not deleted — leave it
          state?.removeEmbeddedElement?.(element.id, editingAreaId, removedId);
          const editRoot = editEmbeddedRootsRef.current.get(removedId);
          if (editRoot) { try { editRoot.unmount(); } catch {} editEmbeddedRootsRef.current.delete(removedId); }
        }
      });
    });
    observer.observe(editor, { childList: true, subtree: true });

    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAreaId]);

  // ── Render embedded elements visually in edit mode ────────────────────────────

  useEffect(() => {
    if (!editingAreaId || !editRef.current) return;
    const editingArea = editingAreaId === rootArea?.id
      ? rootArea
      : findChildAreaById(rootArea?.children ?? [], editingAreaId);
    const embeddedEls = (editingArea?.elements ?? []).filter(e => e.embedded);
    if (!embeddedEls.length) return;

    editRef.current.querySelectorAll('span.element-tag[data-element]').forEach(span => {
      const elementId = span.getAttribute('data-element');
      const el = embeddedEls.find(e => e.id === elementId);
      if (!el || !EMBEDDED_RENDERERS[el.type]) return;

      // Pixel width is required (the wrap lives inside an inline <span>, so
      // width:100% would resolve to 0). Use the current CONTENT AREA width
      // (not el.width which can be stale if the area was resized after insert).
      const z = state?.zoom ?? 1;
      const wrapStyle = el.type === 'table'
        ? { position: 'relative', display: 'block', width: `${mmToPxDesign(element.width ?? el.width ?? 120, z)}px` }
        : { position: 'relative' };

      const existingRoot = editEmbeddedRootsRef.current.get(elementId);
      if (existingRoot) {
        existingRoot.render(
          <div style={wrapStyle}>
            {renderEmbeddedInArea(el, editingAreaId)}
            <div style={{ position: 'absolute', inset: 0 }} />
          </div>
        );
        return;
      }

      if (!span.hasAttribute('data-orig-label')) {
        span.setAttribute('data-orig-label', span.textContent);
        span.textContent = '';
        // Prevent the browser from placing the cursor inside this inline span.
        // Without this, clicking visually "below" a block-sized embedded element
        // (e.g. a table rendered inside an inline span) lands the caret inside the
        // span. Text typed there is wiped when restoreElementTagSpans() sets
        // span.textContent = label. The attribute is removed before reading innerHTML.
        span.setAttribute('contenteditable', 'false');
      }
      span.classList.add('element-tag--rendered');
      const root = createRoot(span);
      // flushSync → mount the table synchronously (within this effect, before the
      // next paint) so there's no empty-span frame between clearing the "◆ Tabla"
      // label and the table appearing (no flicker / layout jump on re-entry).
      flushSync(() => {
        root.render(
          <div style={wrapStyle}>
            {renderEmbeddedInArea(el, editingAreaId)}
            <div style={{ position: 'absolute', inset: 0 }} />
          </div>
        );
      });
      editEmbeddedRootsRef.current.set(elementId, root);
    });
    // No cleanup here: roots are cleaned by restoreElementTagSpans() in commitEdit/cancelEdit
    // and by the MutationObserver when element-tag spans are removed from the DOM.
    // Returning a cleanup would unmount live table roots on every template update (e.g.
    // when addArea patches rootArea.elements), resetting in-progress cell edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAreaId, rootArea?.elements]);

  // ── Embedded element renderers ────────────────────────────────────────────────
  // For tables: pass state + caId/areaId so commitCell and other state calls work
  // when the table is embedded (element.embedded === true).

  function renderEmbeddedInArea(el, currentAreaId) {
    if (el.type === 'table') {
      return (
        <TableElement
          element={el}
          state={state}
          caId={element.id}
          areaId={currentAreaId}
        />
      );
    }
    return EMBEDDED_RENDERERS[el.type]?.(el) ?? null;
  }

  const EMBEDDED_RENDERERS = {
    table:   (el) => renderEmbeddedInArea(el, editingAreaId),
    image:   (el) => <ImageElement element={el} images={state?.template?.images ?? []} />,
    shape:   (el) => <ShapeElement element={el} />,
    qr:      (el) => <QRElement element={el} />,
    barcode: (el) => <BarcodeElement element={el} />,
    chart:   (el) => <ChartElement element={el} state={state} />,
  };

  // ── Highlight selected embedded element in edit mode ─────────────────────────

  useEffect(() => {
    if (!editRef.current) return;
    editRef.current.querySelectorAll('.element-tag--selected')
      .forEach(el => el.classList.remove('element-tag--selected'));
    const ctx = state?.embeddedElementCtx;
    if (ctx?.caId === element.id && ctx?.areaId === editingAreaId && ctx?.elementId) {
      editRef.current
        .querySelector(`.element-tag[data-element="${ctx.elementId}"]`)
        ?.classList.add('element-tag--selected');
    }
  }, [state?.embeddedElementCtx, editingAreaId, element.id]);

  // ── Track cursor position in the editor for the status bar ───────────────────

  useEffect(() => {
    if (!editingAreaId) {
      state?.setEditorCursorPath?.(null);
      return;
    }

    function computePath() {
      const sel = window.getSelection();
      const editor = editRef.current;
      if (!sel || sel.rangeCount === 0 || !editor) return null;
      const anchorNode = sel.anchorNode;
      if (!anchorNode || !editor.contains(anchorNode)) return null;

      const path = [];

      // Level 1: Content Area element label (e.g. "Content Area 1")
      if (element.label) path.push(element.label);

      // Level 2: current editing area label; if cursor is inside a sub-area
      // preview span, show that sub-area label instead.
      const areaTagPreview = (anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode)
        ?.closest?.('.area-tag--preview[data-area]');

      const editingArea = editingAreaId === rootArea?.id
        ? rootArea
        : findChildAreaById(rootArea?.children ?? [], editingAreaId);

      if (areaTagPreview) {
        const subAreaId = areaTagPreview.dataset.area;
        if (editingArea?.label) path.push(editingArea.label);
        const subArea = allPoolAreas.find(a => a.id === subAreaId)
                     ?? findChildAreaById(rootArea?.children ?? [], subAreaId);
        if (subArea?.label) path.push(subArea.label);
      } else {
        if (editingArea?.label) path.push(editingArea.label);
      }

      // Level 3 (optional): cursor right after an element-tag (e.g. a table)
      const anchorOffset = sel.anchorOffset;
      let nearTag = null;
      if (anchorNode.nodeType === 3) {
        if (anchorOffset === 0 && anchorNode.previousSibling?.classList?.contains('element-tag')) {
          nearTag = anchorNode.previousSibling;
        } else if (anchorOffset > 0 && anchorNode.textContent[anchorOffset - 1] === '​') {
          const prev = anchorOffset === 1 ? anchorNode.previousSibling : null;
          if (prev?.classList?.contains('element-tag')) nearTag = prev;
        }
      } else if (anchorNode.nodeType === 1 && anchorOffset > 0) {
        const prev = anchorNode.childNodes[anchorOffset - 1];
        if (prev?.classList?.contains('element-tag')) nearTag = prev;
      }

      if (nearTag) {
        const elId = nearTag.dataset.element;
        const embEl = (editingArea?.elements ?? []).find(e => e.id === elId);
        const tagLabel = embEl?.label
          ?? nearTag.getAttribute('data-orig-label')
          ?? nearTag.dataset.type;
        if (tagLabel) path.push(tagLabel);
      }

      return path.length > 0 ? path : null;
    }

    function handleSelectionChange() {
      const path = computePath();
      // Only update when cursor is actually inside this editor (not toolbar clicks)
      if (path !== null) state?.setEditorCursorPath?.(path);
    }

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      state?.setEditorCursorPath?.(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAreaId]);

  // ── Edit mode controls ───────────────────────────────────────────────────────

  // Lleva al usuario a la CABECERA de la cadena (donde se edita el flujo).
  function goToHead() {
    const r = findChainHead(state?.template?.pages, element.previousAreaRef);
    if (!r) return;
    if (r.pageIdx >= 0) state?.setCurrentPageIndex?.(r.pageIdx);
    state?.selectElement?.(r.head.id);
  }

  function startEdit(e) {
    if (!rootArea || element.locked || element.visible === false) return;
    // Área de continuación: no se edita aquí, el flujo se edita en la cabecera.
    if (element.previousAreaRef && !state?.areaEditCtx?.miniCanvas) {
      e?.stopPropagation();
      goToHead();
      return;
    }
    e?.stopPropagation();
    if (e) clickPosRef.current = { x: e.clientX, y: e.clientY };

    // Determine which area to open the editor for:
    // 1. Active preview branch, 2. Default branch for conditional areas, 3. Root area
    let targetArea = rootArea;
    if (rootFlowType === 'inline-condition') {
      if (previewArea) {
        targetArea = previewArea;
      } else {
        const defaultChild =
          childAreas.find(c => c.id === rootArea.defaultAreaId) ?? childAreas[0] ?? null;
        if (defaultChild) targetArea = defaultChild;
      }
    }

    state?.selectElement?.(element.id);
    setEditingAreaId(targetArea.id);
  }

  function handleBlur(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (e.relatedTarget?.closest('.tft, .tft-link-modal, .dde-header, .vac, .cacm, .itd__backdrop, .olp, .tcb-popup, .sem-backdrop')) return;
    if (autocomplete) return;
    if (tableDialogOpenRef.current) return; // ref, not state — see comment near declaration
    if (objectPanel) return;
    if (isDraggingVarRef.current) return;
    setContextMenu(null);
    commitEdit();
  }

  function restoreElementTagSpans() {
    if (!editRef.current) return;
    editRef.current.querySelectorAll('span.element-tag--rendered[data-orig-label]').forEach(span => {
      const elementId = span.getAttribute('data-element');
      const root = editEmbeddedRootsRef.current.get(elementId);
      if (root) { try { root.unmount(); } catch {} editEmbeddedRootsRef.current.delete(elementId); }
      // Remove contenteditable before reading innerHTML so the attribute is not persisted.
      span.removeAttribute('contenteditable');
      span.textContent = span.getAttribute('data-orig-label');
      span.removeAttribute('data-orig-label');
      span.classList.remove('element-tag--rendered');
    });
    editEmbeddedRootsRef.current.forEach(r => { try { r.unmount(); } catch {} });
    editEmbeddedRootsRef.current.clear();
  }

  function commitEdit() {
    if (!editRef.current || !editingAreaId) return;
    restoreElementTagSpans();
    const commitZoom = state?.zoom ?? 1;
    const toPt = html => html.replace(
      /font-size\s*:\s*([\d.]+)px/gi,
      (_, pxs) => `font-size: ${(parseFloat(pxs) / ((144 / 72) * commitZoom)).toFixed(4)}pt`
    );
    // Save any sub-area content that was edited inline (spans are now editable).
    // Must happen BEFORE collapseAreaTagsForEditor overwrites their innerHTML.
    editRef.current.querySelectorAll('.area-tag.area-tag--preview[data-area]').forEach(span => {
      const subAreaId = span.getAttribute('data-area');
      if (!subAreaId || !updateArea) return;
      const ptContent = toPt(span.innerHTML ?? '');
      updateArea(element.id, subAreaId, { content: ptContent });
    });
    // Collapse inline previews back to tag references before reading innerHTML.
    collapseAreaTagsForEditor(editRef.current);
    // Strip shear float divs — they must not be persisted in the saved HTML.
    editRef.current.querySelectorAll('.cae__shear-float').forEach(el => el.remove());
    // Strip the per-block paragraph CSS we injected — only data-pstyle (the ref) persists.
    stripParagraphBlockStyles(editRef.current);
    const ptHtml = toPt(editRef.current.innerHTML ?? '');
    updateArea?.(element.id, editingAreaId, { content: ptHtml });
    if (state?.activeEditorRef) state.activeEditorRef.current = null;
    if (state?.activeEditorMetaRef) state.activeEditorMetaRef.current = null;
    setEditingAreaId(null);
  }

  function cancelEdit(e) {
    e?.stopPropagation();
    editEmbeddedRootsRef.current.forEach(r => { try { r.unmount(); } catch {} });
    editEmbeddedRootsRef.current.clear();
    if (state?.activeEditorRef) state.activeEditorRef.current = null;
    if (state?.activeEditorMetaRef) state.activeEditorMetaRef.current = null;
    setContextMenu(null);
    tableDialogOpenRef.current = false;
    setTableDialog(false);
    setObjectPanel(null);
    setEditingAreaId(null);
  }

  // ── Global state ─────────────────────────────────────────────────────────────

  const showVarPreview  = state?.showVarPreview ?? false;
  const showInv         = state?.showInvisibles ?? false;
  const availableFields = state?.availableFields ?? [];

  useEffect(() => {
    if (showVarPreview && editingAreaId) commitEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVarPreview]);

  // Detect when rendered text exceeds the area's height
  useEffect(() => {
    if (editingAreaId) { setContentOverflow(false); return; }
    const el = contentRef.current;
    if (!el) { setContentOverflow(false); return; }
    const check = () => setContentOverflow(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAreaId, rootArea?.content, previewAreaId, previewArea?.content]);

  // Computed early so hooks below can reference it (hooks must run unconditionally before non-hook code).
  const _earlyBorderAreaType = element.border?.areaType ?? 'full';
  const isContentOnly = _earlyBorderAreaType === 'content-only' || _earlyBorderAreaType === 'content-with-gap';

  // Measure text content height for content-only border mode (view mode only).
  // Without shear floats, contentRef.current.offsetHeight == pure text height.
  useLayoutEffect(() => {
    if (!isContentOnly || editingAreaId || !contentRef.current) {
      setContentOnlyHeight(null);
      return;
    }
    const el = contentRef.current;
    const update = () => setContentOnlyHeight(el.offsetHeight || null);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContentOnly, editingAreaId, rootArea?.content]);

  const sampleValues = useMemo(
    () => showVarPreview ? buildSampleValues(availableFields) : null,
    [showVarPreview, availableFields]
  );

  // ── Border / fill ────────────────────────────────────────────────────────────

  const zoom            = state?.zoom ?? 1;
  const mmToPxZ         = mm => mm * (144 / 25.4) * zoom;

  // ── Shear ────────────────────────────────────────────────────────────────────
  const shearAngle = element.shearX ?? 0;
  let shearStyle = {};
  let shearDxPx = 0;
  let _shearWPx  = 0;
  let _shearHPx  = 0;
  let signedEffAngle = 0;
  let shearFloatHtml = '';
  let shearFloatHtmlForEditor = '';
  let shearFloatDivs = null;
  if (shearAngle !== 0) {
    _shearHPx = mmToPxZ(element.height ?? 30);
    _shearWPx = mmToPxZ(element.width  ?? 120);
    const rawDx = Math.abs(Math.tan((shearAngle * Math.PI) / 180) * _shearHPx);
    shearDxPx = Math.min(rawDx, _shearWPx * 0.92);
    const absEffAngle = _shearHPx > 0 ? Math.atan(shearDxPx / _shearHPx) * 180 / Math.PI : 0;
    signedEffAngle = shearAngle > 0 ? absEffAngle : -absEffAngle;
    // Outer div uses skewX so CSS border/fill naturally follow the parallelogram shape.
    // overflow:visible lets the inner text layer extend beyond the div's own box edge.
    shearStyle = {
      outline: 'none',
      overflow: 'visible',
      transform: `skewX(${-signedEffAngle}deg)`,
      transformOrigin: '0px 0px',
    };
    // ── Text layer floats ──────────────────────────────────────────────────────
    // The inner text layer is counter-skewed so characters are upright, and shifted left
    // by dx so line start positions still follow the diagonal (see shearPaddedContentEl).
    // These two floats align the start and end of every line to the parallelogram edges.
    // For BOTH shear directions the same float shapes apply (the text layer's coordinate
    // system after marginLeft:-dx shifts always gives the same triangle geometry).
    const dx  = shearDxPx;
    const hPx = _shearHPx;
    const lfs = `float:left;width:${dx}px;height:${hPx}px;shape-outside:polygon(0px 0px,${dx}px 0px,0px ${hPx}px);pointer-events:none;flex-shrink:0;`;
    const rfs = `float:right;width:${dx}px;height:${hPx}px;shape-outside:polygon(0px 0px,0px ${hPx}px,${dx}px ${hPx}px);pointer-events:none;flex-shrink:0;`;
    shearFloatHtml = `<div class="cae__shear-float" style="${lfs}" contenteditable="false"></div><div class="cae__shear-float" style="${rfs}" contenteditable="false"></div>`;
    shearFloatHtmlForEditor = shearFloatHtml;
    shearFloatDivs = (
      <>
        <div className="cae__shear-float" style={{ float: 'left',  width: dx, height: hPx, shapeOutside: `polygon(0px 0px,${dx}px 0px,0px ${hPx}px)`,      pointerEvents: 'none', flexShrink: 0 }} />
        <div className="cae__shear-float" style={{ float: 'right', width: dx, height: hPx, shapeOutside: `polygon(0px 0px,0px ${hPx}px,${dx}px ${hPx}px)`, pointerEvents: 'none', flexShrink: 0 }} />
      </>
    );
  }

  const borderStyles    = state?.template?.styles?.border ?? [];
  const fillStyles      = state?.template?.styles?.fill ?? [];
  const textStyles      = state?.template?.styles?.text ?? [];
  const paragraphStyles = state?.template?.styles?.paragraph ?? [];

  // Re-apply per-block paragraph CSS whenever the paragraph styles change while
  // editing. This makes a paragraph style applied to a selection visible IMMEDIATELY
  // (the modal forks via setTemplate, so the new style only exists after this
  // re-render) and propagates live edits made in the resource panel.
  // NOTE: declared AFTER paragraphStyles so the dependency array doesn't hit the TDZ.
  useEffect(() => {
    if (editingAreaId && editRef.current) {
      applyParagraphBlockStyles(editRef.current, paragraphStyles, zoom);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphStyles, editingAreaId, zoom]);

  const {
    css: borderCSS, svgBorder,
    fillColor: borderFillColor, shadow: borderShadow,
    margins: borderMargins, marginLine: borderMarginLine,
    diagonal: borderDiagonal, fillConfig: borderFillConfig,
    lineStyle: borderLineStyle, lineColor: borderLineColorG, lineWidth: borderLineWidthG,
  } = computeBorderData(element.border, borderStyles, state?.template?.styles?.fill ?? []);
  const images     = state?.template?.images ?? [];
  const fillStyle  = resolveFillToCSS(element.fill, fillStyles, images);
  // Border style fill takes priority over element-level fill
  const effectiveFill = borderFillColor ? { background: borderFillColor } : fillStyle;
  const shadowCSS  = borderShadow
    ? { boxShadow: `${borderShadow.offsetX}px ${borderShadow.offsetY}px 4px 0 ${borderShadow.color}` }
    : {};
  const hasSvgBorder = !!svgBorder;
  const visualCSS  = hasSvgBorder ? shadowCSS : { ...(effectiveFill ?? {}), ...(borderCSS ?? {}), ...shadowCSS };
  const hasVisual  = Object.keys(visualCSS).length > 0 || hasSvgBorder;

  // ── Text / paragraph styles for the root area ─────────────────────────────────

  const ts = resolveTextStyle(rootArea?.defaultTextStyleId, textStyles);
  const ps = rootArea?.paragraphStyleId
    ? resolveParagraphStyle(rootArea.paragraphStyleId, paragraphStyles)
    : (rootArea?.paragraphStyle ?? {});

  const textCss = {
    ...textStyleToCSS(ts, fillStyles, zoom),
    textAlign: ps.alignment ?? 'left',
  };
  if (ps.leftIndent)      textCss.paddingLeft   = `${mmToPxZ(ps.leftIndent)}px`;
  if (ps.rightIndent)     textCss.paddingRight  = `${mmToPxZ(ps.rightIndent)}px`;
  if (ps.firstLineIndent) textCss.textIndent    = `${mmToPxZ(ps.firstLineIndent)}px`;
  if (ps.spaceBefore)     textCss.paddingTop    = `${mmToPxZ(ps.spaceBefore)}px`;
  if (ps.spaceAfter)      textCss.paddingBottom = `${mmToPxZ(ps.spaceAfter)}px`;
  if (ps.letterSpacing)   textCss.letterSpacing = `${ps.letterSpacing * zoom}px`;
  if (ps.listIndent)      textCss['--list-indent'] = `${mmToPxZ(ps.listIndent)}px`;
  if (ps.listColor)       textCss['--list-color'] = ps.listColor;
  // lineSpacing overrides plain lineHeight when a typed spacing mode is set
  const lst = ps.lineSpacingType;
  if (lst === 'additional') {
    const base = ps.lineHeight ?? 1.4;
    const extra = ps.lineSpacing ?? 0;
    textCss.lineHeight = extra > 0 ? `calc(${base}em + ${extra}pt)` : base;
  } else if (lst === 'atleast') {
    textCss.lineHeight = `max(${ps.lineHeight ?? 1.4}em, ${ps.lineSpacing ?? 0}pt)`;
  } else if (lst === 'exact') {
    textCss.lineHeight = `${ps.lineSpacing ?? 0}pt`;
    textCss.overflow = 'hidden';
  } else if (lst === 'multipleof') {
    textCss.lineHeight = ps.lineSpacing ?? ps.lineHeight ?? 1.4;
  } else if (ps.lineHeight) {
    textCss.lineHeight = ps.lineHeight;
  }
  // Trim top half-leading so text starts at y=0 of the area (pixel-perfect).
  // CSS distributes (lineHeight - 1) / 2 em of empty space above the first line;
  // the negative marginTop cancels it out.
  if (typeof textCss.lineHeight === 'number') {
    textCss.marginTop = `${(1 - textCss.lineHeight) * 0.5}em`;
  }
  // flow breaks (respected by browser print/column layout)
  if (ps.flowBreakBefore && ps.flowBreakBefore !== 'none') {
    textCss.breakBefore = ps.flowBreakBefore === 'flowarea' ? 'column' : ps.flowBreakBefore;
  }
  if (ps.flowBreakAfter && ps.flowBreakAfter !== 'none') {
    textCss.breakAfter = ps.flowBreakAfter === 'flowarea' ? 'column' : ps.flowBreakAfter;
  }
  // keep lines together
  if (ps.keepLinesTogether && ps.keepLinesTogether !== 'no') {
    textCss.pageBreakInside = 'avoid';
    textCss.breakInside = 'avoid';
  }
  // doNotWrap
  if (ps.doNotWrap) { textCss.whiteSpace = 'nowrap'; textCss.overflow = 'visible'; }
  // hyphenation
  if (ps.hyphenation?.enabled) {
    textCss.hyphens = 'auto';
    textCss.WebkitHyphens = 'auto';
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────────

  function isInlineTagNode(node) {
    return node?.classList?.contains('var-tag')
        || node?.classList?.contains('area-tag')
        || node?.classList?.contains('element-tag');
  }

  // Tables render as inline-block inside the area editor; deleting the ZWS
  // after them should NOT also delete the table (unlike truly inline tags).
  // A second Backspace from the cursor position right-after the span lets the
  // browser delete the contenteditable="false" span atomically (table gone).
  function isBlockElementTag(node) {
    return node?.classList?.contains('element-tag') && node?.dataset?.type === 'table';
  }

  function handleEditorKeyDown(e) {
    if (e.key === 'Escape') {
      if (autocomplete) { setAutocomplete(null); return; }
      if (contextMenu)  { setContextMenu(null); return; }
      cancelEdit(e);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
    }
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      braceInfoRef.current = null;
      const pos = getCaretPosition();
      const sel = window.getSelection();
      if (sel?.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      setAutocomplete({ position: pos });
    }

    // ── Enter after a block element-tag (table): insert <br> instead of letting
    // the browser create a wrapping <div> (which moves the span and triggers
    // the MutationObserver as if the element were deleted).
    if (e.key === 'Enter') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const node   = sel.anchorNode;
        const offset = sel.anchorOffset;
        // Detect cursor right after a block element-tag span (directly or via ZWS)
        let blockTag = null;
        if (node?.nodeType === 3 && offset === 0) {
          const prev = node.previousSibling;
          if (isBlockElementTag(prev)) blockTag = prev;
          else if (prev?.nodeType === 3 && prev.textContent === '​') {
            const pp = prev.previousSibling;
            if (isBlockElementTag(pp)) blockTag = pp;
          }
        } else if (node?.nodeType === 3 && node.textContent === '​' && offset <= 1) {
          if (isBlockElementTag(node.previousSibling)) blockTag = node.previousSibling;
        } else if (node?.nodeType === 1 && offset > 0) {
          const prev = node.childNodes[offset - 1];
          if (isBlockElementTag(prev)) blockTag = prev;
          else if (prev?.nodeType === 3 && prev.textContent === '​') {
            if (isBlockElementTag(prev.previousSibling)) blockTag = prev.previousSibling;
          }
        }
        if (blockTag) {
          e.preventDefault();
          // Insert a <br> followed by a ZWS so the cursor has a visible landing spot
          const br = document.createElement('br');
          const zws = document.createTextNode('​');
          const range = sel.getRangeAt(0);
          range.collapse(false);
          range.insertNode(zws);
          range.insertNode(br);
          // Place cursor in the ZWS text node (after the br)
          const newRange = document.createRange();
          newRange.setStart(zws, 1);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
          return;
        }
      }
    }

    // ── Arrow keys: reliable navigation across area-tag--preview boundaries ──
    // Chrome can be ambiguous at the border between parent editor and editable
    // child span, so we handle the entry/exit points explicitly.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const node   = sel.anchorNode;
        const offset = sel.anchorOffset;

        if (e.key === 'ArrowLeft') {
          // Entering a sub-area from its right side:
          // Cursor is at start of a text node whose previous sibling is the span
          // (or at start of the ZWS text node that immediately follows the span).
          let prevSpan = null;
          if (node?.nodeType === 3 && offset === 0) {
            const prev = node.previousSibling;
            if (prev?.classList?.contains('area-tag--preview')) {
              prevSpan = prev;
            } else if (prev?.nodeType === 3 && prev.textContent === '​') {
              const pp = prev.previousSibling;
              if (pp?.classList?.contains('area-tag--preview')) prevSpan = pp;
            }
          }
          if (prevSpan) {
            e.preventDefault();
            const r = document.createRange();
            r.selectNodeContents(prevSpan);
            r.collapse(false); // to end of span
            sel.removeAllRanges();
            sel.addRange(r);
            return;
          }
        }

        if (e.key === 'ArrowRight') {
          // Exiting a sub-area from its right side:
          // Cursor is at the very end of an area-tag--preview span.
          const parentSpan = (node?.nodeType === 3 ? node.parentElement : node)
            ?.closest?.('.area-tag.area-tag--preview');
          if (parentSpan && editRef.current?.contains(parentSpan)) {
            const endRange = document.createRange();
            endRange.selectNodeContents(parentSpan);
            endRange.collapse(false);
            const curr = sel.getRangeAt(0);
            if (curr.compareBoundaryPoints(Range.START_TO_START, endRange) === 0) {
              e.preventDefault();
              const r = document.createRange();
              const zws = parentSpan.nextSibling;
              // Land after the ZWS so the cursor is visually outside the span
              if (zws?.nodeType === 3 && zws.textContent === '​') {
                r.setStart(zws, 1);
              } else {
                r.setStartAfter(parentSpan);
              }
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
              return;
            }
          }
        }
      }
    }

    // ── Backspace / Delete: handle inline-tag removal atomically ──
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      const node   = sel.anchorNode;
      const offset = sel.anchorOffset;
      if (!node) return;

      if (e.key === 'Backspace') {
        // Case 1: caret inside a tag span
        const tag = node.nodeType === 3
          ? node.parentElement?.closest('.var-tag[data-var], .area-tag[data-area]')
          : node.closest?.('.var-tag[data-var], .area-tag[data-area]');
        if (tag) {
          e.preventDefault();
          const spacer = tag.nextSibling;
          if (spacer?.nodeType === 3 && spacer.textContent === '​') spacer.remove();
          tag.remove();
          return;
        }
        // Case 2: caret right after ZWS spacer that follows a tag
        if (node.nodeType === 3 && offset > 0 && node.textContent[offset - 1] === '​') {
          const prev = offset === 1 ? node.previousSibling : null;
          if (isInlineTagNode(prev)) {
            e.preventDefault();
            node.textContent = node.textContent.slice(0, offset - 1) + node.textContent.slice(offset);
            if (!isBlockElementTag(prev)) {
              prev.remove();
            } else {
              // Block element-tag (table): only remove the ZWS, keep the span.
              // Explicitly reposition cursor right after the span so the browser
              // doesn't jump to a random position inside the empty text node.
              const rePos = document.createRange();
              rePos.setStartAfter(prev);
              rePos.collapse(true);
              sel.removeAllRanges();
              sel.addRange(rePos);
            }
            return;
          }
        }
        // Case 3: caret at start of text node, prev sibling is tag or ZWS+tag
        if (node.nodeType === 3 && offset === 0) {
          let prev = node.previousSibling;
          if (prev?.nodeType === 3 && prev.textContent === '​') {
            const spacer = prev;
            prev = spacer.previousSibling;
            if (isInlineTagNode(prev)) {
              e.preventDefault();
              spacer.remove();
              if (!isBlockElementTag(prev)) prev.remove();
              return;
            }
          }
          if (isInlineTagNode(prev)) {
            // Block element-tags: let the browser delete the contenteditable="false"
            // span naturally (it does so when cursor is at offset 0 right after it).
            if (isBlockElementTag(prev)) return;
            e.preventDefault();
            prev.remove();
            return;
          }
        }
        // Case 4: caret in element node, offset-1 is tag or ZWS+tag
        if (node.nodeType === 1 && offset > 0) {
          let target = node.childNodes[offset - 1];
          if (target?.nodeType === 3 && target.textContent === '​') {
            const spacer = target;
            target = spacer.previousSibling;
            if (isInlineTagNode(target)) {
              e.preventDefault();
              spacer.remove();
              if (!isBlockElementTag(target)) target.remove();
              return;
            }
          }
          if (isInlineTagNode(target)) {
            if (!isBlockElementTag(target)) {
              e.preventDefault();
              const spacer = target.nextSibling;
              if (spacer?.nodeType === 3 && spacer.textContent === '​') spacer.remove();
              target.remove();
              return;
            }
            // Block element-tag without ZWS: fall through to browser default deletion.
          }
        }
      } else {
        // Delete key: check if next node is a tag
        if (node.nodeType === 3 && offset === node.textContent.length) {
          const next = node.nextSibling;
          if (isInlineTagNode(next)) {
            e.preventDefault();
            const spacer = next.nextSibling;
            if (spacer?.nodeType === 3 && spacer.textContent === '​') spacer.remove();
            next.remove();
            return;
          }
        }
        if (node.nodeType === 1 && offset < node.childNodes.length) {
          const target = node.childNodes[offset];
          if (isInlineTagNode(target)) {
            e.preventDefault();
            const spacer = target.nextSibling;
            if (spacer?.nodeType === 3 && spacer.textContent === '​') spacer.remove();
            target.remove();
            return;
          }
        }
      }
    }
  }

  // ── Input handler ─────────────────────────────────────────────────────────────

  function handleEditorInput() {
    guardInlineTags(editRef.current);
    if (autocomplete) return;
    const info = detectDoubleBrace(editRef.current);
    if (info) {
      braceInfoRef.current = info;
      const pos = getCaretPosition();
      const sel = window.getSelection();
      if (sel?.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      setAutocomplete({ position: pos });
    }
  }

  // ── Variable autocomplete ─────────────────────────────────────────────────────

  function handleVarSelect(path) {
    if (braceInfoRef.current) {
      const freshRange = removeDoubleBrace(braceInfoRef.current);
      braceInfoRef.current = null;
      savedRangeRef.current = freshRange;
    }
    const range = savedRangeRef.current;
    savedRangeRef.current = null;
    insertVariableTag(editRef.current, path, range);
    setAutocomplete(null);
    editRef.current?.focus();
  }

  // ── Context menu (right-click → insert area-tag) ──────────────────────────────

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isEditing) return;
    editRef.current?.focus();
    const sel = window.getSelection();
    if (sel?.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function createAndInsertAreaTag() {
    const usedNums = collectAllAreaNums(state?.template);
    const nextLabel = `Área ${usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1}`;
    const newId = addArea?.(element.id, rootArea.id, { label: nextLabel });
    if (newId) {
      insertAreaTag(editRef.current, newId, nextLabel, savedRangeRef.current);
      savedRangeRef.current = null;
      // Immediately expand the chip to an editable preview span so no badge is visible
      // and no block-level layout split occurs. State update from addArea is async, so
      // pass the new area inline in a synthetic pool augment.
      const editZoom = state?.zoom ?? 1;
      const syntheticPool = [...(allPoolAreas ?? []), { id: newId, content: '', children: [] }];
      expandAreaTagsForEditor(editRef.current, syntheticPool, editZoom);
    }
    editRef.current?.focus();
  }

  function handleContextMenuAction(action, item) {
    const menuPos = contextMenu;
    setContextMenu(null);
    switch (action) {
      case 'insert-area-tag':
        insertAreaTag(editRef.current, item.area.id, item.area.label ?? 'Área', savedRangeRef.current);
        savedRangeRef.current = null;
        expandAreaTagsForEditor(editRef.current, allPoolAreas, state?.zoom ?? 1);
        editRef.current?.focus();
        break;
      case 'create-area-tag':
      case 'insert-area':
        createAndInsertAreaTag();
        break;
      case 'open-table-dialog':
        tableDialogOpenRef.current = true; // sync — must be before setState
        setTableDialog(true);
        break;
      case 'open-object-panel':
        setObjectPanel(menuPos);
        break;
      case 'insert-image':
      case 'insert-shape':
      case 'insert-qr':
      case 'insert-barcode': {
        const typeMap = { 'insert-image': 'image', 'insert-shape': 'shape', 'insert-qr': 'qr', 'insert-barcode': 'barcode' };
        handleInsertEmbeddedElement(typeMap[action]);
        break;
      }
      case 'make-conditional':
        state?.migrateAreaToCondition?.(element.id, editingAreaId);
        break;
      case 'text-style':
        setStyleModal({ kind: 'text' });
        break;
      case 'paragraph-style':
        setStyleModal({ kind: 'paragraph' });
        break;
      case 'bullets-numbering':
        setStyleModal({ kind: 'bullets' });
        break;
      default:
        break;
    }
  }

  function handleObjectPanelSelect(area) {
    setObjectPanel(null);
    insertAreaTag(editRef.current, area.id, area.label ?? 'Área', savedRangeRef.current);
    savedRangeRef.current = null;
    editRef.current?.focus();
  }

  // ── Embedded element insertion ────────────────────────────────────────────────

  function handleInsertEmbeddedElement(type, overrides = {}) {
    if (!editingAreaId) return;
    // For tables, default width to the parent area's width so the embedded table
    // fits inside the editor (which has overflow:hidden). Without this, a 120mm
    // default table inside a 90mm-wide area gets the rightmost column clipped.
    let finalOverrides = overrides;
    if (type === 'table' && overrides.width == null && element.width) {
      finalOverrides = { ...overrides, width: element.width };
    }
    const embeddedEl = state?.addEmbeddedElement?.(element.id, editingAreaId, type, finalOverrides);
    if (!embeddedEl?.id) return;
    const label = buildElementTagLabel(type, embeddedEl);
    insertElementTag(editRef.current, embeddedEl.id, type, label, savedRangeRef.current);
    savedRangeRef.current = null;

    // Render the element immediately into the just-inserted span
    const newSpan = editRef.current?.querySelector(`span.element-tag[data-element="${embeddedEl.id}"]`);
    if (newSpan && EMBEDDED_RENDERERS[embeddedEl.type] && !editEmbeddedRootsRef.current.has(embeddedEl.id)) {
      newSpan.setAttribute('data-orig-label', label);
      newSpan.textContent = '';
      newSpan.classList.add('element-tag--rendered');
      // Same width strategy as the re-render effect: use the current content
      // area width so the table fills horizontally consistently with view mode.
      const z2 = state?.zoom ?? 1;
      const newWrapStyle = embeddedEl.type === 'table'
        ? { position: 'relative', display: 'block', width: `${mmToPxDesign(element.width ?? embeddedEl.width ?? 120, z2)}px` }
        : { position: 'relative' };
      const root = createRoot(newSpan);
      root.render(
        <div style={newWrapStyle}>
          {EMBEDDED_RENDERERS[embeddedEl.type](embeddedEl)}
          <div style={{ position: 'absolute', inset: 0 }} />
        </div>
      );
      editEmbeddedRootsRef.current.set(embeddedEl.id, root);
    }

    editRef.current?.focus();
  }

  // Click on element-tag in edit mode → select it (show its properties)
  function handleEditorClick(e) {
    const tag = e.target.closest?.('.element-tag[data-element]');
    if (!tag) return;
    e.stopPropagation();
    const elementId = tag.getAttribute('data-element');
    if (elementId) state?.selectEmbeddedElement?.(element.id, editingAreaId, elementId);
  }

  // ── Area-tag double-click in editor → enter mini-canvas for that sub-area ────

  function handleEditorDoubleClick(e) {
    const tag = e.target.closest?.('.area-tag[data-area]');
    if (!tag) return;
    e.preventDefault();
    e.stopPropagation();
    const areaId = tag.getAttribute('data-area');
    if (areaId) {
      commitEdit();
      enterAreaEdit?.(element.id, areaId, { miniCanvas: true });
    }
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────

  function placeCaretAt(x, y, container) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r && container.contains(r.startContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
    } else if (document.caretPositionFromPoint) {
      const cp = document.caretPositionFromPoint(x, y);
      if (cp && container.contains(cp.offsetNode)) {
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStart(cp.offsetNode, cp.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
    }
    return false;
  }

  function handleTableDialogConfirm(options) {
    tableDialogOpenRef.current = false;
    setTableDialog(false);
    // Shared builder (same as the ElementBar "Tabla avanzada" flow): turns the
    // dialog options into a full, atado table structure + outer border style.
    const built = buildTableFromDialogOptions(options, state);
    handleInsertEmbeddedElement('table', built);
    editRef.current?.focus();
  }

  function handleDragOver(e) {
    if (!e.dataTransfer.types.includes('text/x-variable-path')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (editRef.current) placeCaretAt(e.clientX, e.clientY, editRef.current);
  }

  function handleDrop(e) {
    const varPath = e.dataTransfer.getData('text/x-variable-path');
    if (!varPath) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingVarRef.current = false;
    if (editRef.current) {
      placeCaretAt(e.clientX, e.clientY, editRef.current);
      insertVariableTag(editRef.current, varPath);
    }
  }

  function handleCaeDragOver(e) {
    if (!e.dataTransfer.types.includes('text/x-variable-path')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!editingAreaId && rootArea) {
      isDraggingVarRef.current = true;
      setEditingAreaId(rootArea.id);
    }
    if (editRef.current) placeCaretAt(e.clientX, e.clientY, editRef.current);
  }

  function handleCaeDrop(e) {
    const varPath = e.dataTransfer?.getData('text/x-variable-path');
    if (!varPath) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingVarRef.current = false;
    if (editRef.current) {
      placeCaretAt(e.clientX, e.clientY, editRef.current);
      insertVariableTag(editRef.current, varPath);
    } else if (rootArea) {
      pendingVarRef.current = varPath;
      setEditingAreaId(rootArea.id);
    }
  }

  function handleDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (!e.dataTransfer.types.includes('text/x-variable-path')) return;
    if (isDraggingVarRef.current) {
      isDraggingVarRef.current = false;
      commitEdit();
    }
  }

  // ── Derived flags ────────────────────────────────────────────────────────────

  const isEditing  = !!editingAreaId;
  const isVisible  = element.visible !== false;
  const isLocked   = element.locked === true;

  // ── Continuación de desbordamiento ───────────────────────────────────────
  // Si esta área recibe el desbordamiento de otra (previousAreaRef), resolvemos
  // la cabecera de la cadena para mostrar su flujo compartido (atenuado) + un
  // banner. El corte real del texto lo hace el motor de render; aquí es solo
  // indicación visual y NO es editable (se edita en la cabecera).
  const headInfo = useMemo(() => {
    const r = findChainHead(state?.template?.pages, element.previousAreaRef);
    if (!r) return null;
    const headAreas = state?.resolveAreas?.(r.head) ?? r.head.areas ?? [];
    const headArea  = headAreas[0] ?? null;
    return { ...r, headArea, label: r.head.label || headArea?.label || 'Área' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.previousAreaRef, state?.template]);
  const isContinuation = !!headInfo && !isEditing && !state?.areaEditCtx?.miniCanvas;

  // ── Badges ───────────────────────────────────────────────────────────────────

  const flowBadge = !editingAreaId && rootFlowType !== 'simple' && FLOW_TYPE_LABELS[rootFlowType] ? (
    <span className={`cae__flow-badge cae__flow-badge--${rootFlowType}`}>
      {FLOW_TYPE_LABELS[rootFlowType]}
    </span>
  ) : null;

  const overflowBadge = !editingAreaId && element.nextAreaRef ? (
    <span className="cae__overflow-badge" title="Texto continúa en otro área">→</span>
  ) : null;

  // Auto-desbordamiento: badge no intrusivo (NO bloquea la edición del área).
  const selfOverflowBadge = !editingAreaId && element.selfOverflow ? (
    <span className="cae__self-badge" title="Si desborda, repite la página y continúa en esta misma área">↻ Desborda aquí</span>
  ) : null;

  const textOverflowIndicator = contentOverflow && !editingAreaId && isVisible ? (
    <div className="cae__text-overflow" title="El contenido excede el alto del área" />
  ) : null;

  const lockIndicator = isLocked ? (
    <div className="cae__lock-indicator" title="Elemento bloqueado">
      <Lock size={8} />
    </div>
  ) : null;

  // ── Layout badges (production features) ──────────────────────────────────────
  const fittingBadge = !editingAreaId && element.fitting && element.fitting !== 'none' ? (
    <span className="cae__layout-badge" title={`Fitting: ${element.fitting}`}>⌖</span>
  ) : null;

  const balancingBadge = !editingAreaId && element.useBalancing ? (
    <span className="cae__layout-badge" title="Balancing activo">⇌</span>
  ) : null;

  const dynamicHeightBadge = !editingAreaId && element.dynamicHeight ? (
    <span className="cae__layout-badge cae__layout-badge--dh" title="Altura dinámica">↕</span>
  ) : null;

  const writingDirBadge = !editingAreaId && element.writingDirection === 'vertical' ? (
    <span className="cae__layout-badge" title="Escritura vertical">⟳</span>
  ) : null;

  const firstFittingBadge = !editingAreaId && rootArea?.fittingMode && rootArea.fittingMode !== 'none' ? (
    <span className="cae__layout-badge" title={`First Fitting: ${rootArea.fittingMode}`}>⌖ FF</span>
  ) : null;

  const sectionFlowBadge = !editingAreaId && rootArea?.isSectionFlow ? (
    <span className="cae__layout-badge" title="Flujo de sección">§ Sección</span>
  ) : null;

  // ── Area layout CSS ───────────────────────────────────────────────────────────
  const areaLayoutCSS   = applyAreaLayoutCSS(element);
  const contentLayoutCSS = applyContentLayoutCSS(element);
  const contentDir = element.worldwideSupport ? 'auto' : undefined;

  // ── Inline content for render ─────────────────────────────────────────────────

  const contentEl = !isVisible ? (
    <div className="cae__hidden-state">
      <span className="cae__hidden-label">oculto</span>
    </div>
  ) : isEditing ? (
    <>
      <AreaRuler
        widthMm={element.width ?? 80}
        paragraphStyle={ps}
        onIndentChange={changes => {
          const foc = state?.findOrCreateParagraphStyle;
          const upd = state?.updateContentArea;
          if (foc && upd && rootArea) {
            const newId = foc(rootArea.paragraphStyleId ?? null, changes);
            upd(rootArea.id, { paragraphStyleId: newId });
          }
        }}
      />
      <div
        ref={editRef}
        className={`cae__editor${showInv ? ' cae__editor--inv' : ''}`}
        style={{ ...textCss, ...contentLayoutCSS }}
        dir={contentDir}
        contentEditable
        suppressContentEditableWarning
        onMouseDown={e => e.stopPropagation()}
        onBlur={handleBlur}
        onKeyDown={handleEditorKeyDown}
        onInput={handleEditorInput}
        onDoubleClick={handleEditorDoubleClick}
        onClick={handleEditorClick}
        onContextMenu={handleContextMenu}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      />
      {autocomplete && (
        <VariableAutocomplete
          availableFields={availableFields}
          position={autocomplete.position}
          onSelect={handleVarSelect}
          onClose={() => { setAutocomplete(null); editRef.current?.focus(); }}
        />
      )}
      {contextMenu && (
        <ContentAreaContextMenu
          position={contextMenu}
          availableFields={availableFields}
          onAction={handleContextMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}
      {tableDialog && (
        <InsertTableDialog
          availableFields={availableFields}
          onConfirm={handleTableDialogConfirm}
          onCancel={() => { tableDialogOpenRef.current = false; setTableDialog(false); editRef.current?.focus(); }}
        />
      )}
      {objectPanel && (
        <ObjectListPanel
          position={objectPanel}
          allAreas={allPoolAreas}
          onSelect={handleObjectPanelSelect}
          onClose={() => { setObjectPanel(null); editRef.current?.focus(); }}
        />
      )}
    </>
  ) : (rootArea?.content || previewArea) ? (() => {
    const viewArea = previewArea ?? rootArea;
    const resolvedHtml = resolveParagraphBlocks(
      applyZoomToInlinePt(
        previewArea
          ? resolveForDisplay(previewArea.content ?? '', previewArea.children ?? [], showVarPreview ? sampleValues : null, allPoolAreas)
          : resolveForDisplay(rootArea.content, childAreas, showVarPreview ? sampleValues : null, allPoolAreas),
        zoom
      ),
      paragraphStyles, zoom
    );
    const viewEmbeddedEls = (viewArea?.elements ?? []).filter(e => e.embedded);
    const contentParts = !showVarPreview && viewEmbeddedEls.length
      ? splitHtmlAtElementTags(resolvedHtml, viewEmbeddedEls)
      : null;
    const contentClass = `cae__content${showVarPreview ? ' cae__content--var-preview' : ''}${previewArea ? ' cae__content--preview' : ''}`;
    // overflow:visible lets CSS floats push each line per the parallelogram indentation.
    // Content-only mode uses the same full-height floats — see comment above shearFloatDivs.
    const useShearFloats = shearDxPx > 0;
    const shearContentStyle = {};
    const activeFloatDivs = shearFloatDivs;
    if (contentParts) {
      // `.cae__content` carries a NEGATIVE marginTop ((1-lh)*0.5em) to trim the
      // first text line's half-leading so glyphs start at the area's y=0. An
      // embedded block (table/image) has no leading to absorb that shift, so it
      // gets pulled ABOVE the area and `.cae`'s overflow:hidden clips its top
      // border (the "table inserted, no top border" bug). Re-add the same
      // half-leading as positive top margin on the embedded wrapper so the
      // block sits back at y=0, inside the clip. Text trim is unaffected.
      const lh = typeof textCss.lineHeight === 'number' ? textCss.lineHeight : null;
      const halfLeadEm = lh != null ? Math.max(0, (lh - 1) * 0.5) : 0;
      return (
        <div
          ref={contentRef}
          className={contentClass}
          style={{ ...textCss, ...contentLayoutCSS, ...shearContentStyle }}
          dir={contentDir}
        >
          {useShearFloats && activeFloatDivs}
          {contentParts.map((part, i) =>
            part.type === 'html'
              ? <div key={i} dangerouslySetInnerHTML={{ __html: part.content }} />
              : (
                <div
                  key={part.key}
                  style={{
                    position: 'relative',
                    marginTop: `calc(2px + ${halfLeadEm}em)`,
                    marginBottom: '2px',
                  }}
                >
                  {renderEmbeddedInArea(part.el, viewArea?.id)}
                </div>
              )
          )}
        </div>
      );
    }
    return (
      <div
        ref={contentRef}
        className={contentClass}
        style={{ ...textCss, ...contentLayoutCSS, ...shearContentStyle }}
        dir={contentDir}
        dangerouslySetInnerHTML={{ __html: (useShearFloats ? shearFloatHtml : '') + resolvedHtml }}
      />
    );
  })() : (
    <div className="cae__content" style={{ ...textCss, ...contentLayoutCSS }} dir={contentDir}>
      <span className="cae__placeholder">Doble clic para escribir…</span>
    </div>
  );

  // Vista de "continuación": preview atenuado y de SOLO LECTURA del flujo de la
  // CABECERA + banner. Renderiza los elementos embebidos (tablas, imágenes…)
  // igual que la vista normal — NO como su etiqueta "◆ Tabla" — para que el área
  // de desbordamiento muestre el mismo diseño visual que la cabecera.
  const continuationContentEl = isContinuation ? (() => {
    const headArea = headInfo.headArea;
    const headHtml = resolveParagraphBlocks(
      applyZoomToInlinePt(
        resolveForDisplay(headArea?.content ?? '', headArea?.children ?? [], null, allPoolAreas),
        zoom
      ),
      paragraphStyles, zoom
    );
    const headEmbedded = (headArea?.elements ?? []).filter(e => e.embedded);
    const parts = headEmbedded.length ? splitHtmlAtElementTags(headHtml, headEmbedded) : null;
    return (
      <div className="cae__continuation">
        <div className="cae__continuation-banner" title="Doble clic para ir al área de origen">
          ↳ Continúa de: {headInfo.label}{headInfo.pageIdx >= 0 ? ` · pág. ${headInfo.pageIdx + 1}` : ''}
        </div>
        <div className="cae__continuation-body" style={{ ...textCss, ...contentLayoutCSS }} dir={contentDir}>
          {parts
            ? parts.map((part, i) =>
                part.type === 'html'
                  ? <div key={i} dangerouslySetInnerHTML={{ __html: part.content }} />
                  : (
                    <div key={part.key} style={{ position: 'relative', marginTop: '2px', marginBottom: '2px' }}>
                      {renderEmbeddedInArea(part.el, headArea?.id)}
                    </div>
                  )
              )
            : <div dangerouslySetInnerHTML={{ __html: headHtml }} />}
        </div>
      </div>
    );
  })() : null;

  const effectiveContentEl = continuationContentEl ?? contentEl;

  // ── Render paths ──────────────────────────────────────────────────────────────

  const borderAreaType    = _earlyBorderAreaType;
  const contentPad        = borderAreaType === 'content-with-gap' ? (element.border?.contentPadding ?? {}) : {};
  const contentPaddingCSS = {
    ...(contentPad.top    ? { paddingTop:    mmToPxZ(contentPad.top) }    : {}),
    ...(contentPad.bottom ? { paddingBottom: mmToPxZ(contentPad.bottom) } : {}),
    ...(contentPad.left   ? { paddingLeft:   mmToPxZ(contentPad.left) }   : {}),
    ...(contentPad.right  ? { paddingRight:  mmToPxZ(contentPad.right) }  : {}),
  };

  const caeClass = [
    'cae',
    hasSvgBorder
      ? (isContentOnly ? 'cae--svg-border' : 'cae--styled cae--svg-border')
      : (hasVisual && !isContentOnly ? 'cae--styled' : ''),
    isEditing  ? 'cae--editing' : '',
    !isVisible ? 'cae--hidden'  : '',
    isLocked   ? 'cae--locked'  : '',
    isContinuation ? 'cae--continuation' : '',
    element.dynamicHeight ? 'cae--dynamic-height' : '',
  ].filter(Boolean).join(' ');

  const diagLineColor = borderLineColorG;
  const diagLineWidth = borderLineWidthG;
  const diagLineStyle = borderLineStyle;

  // Shared diagonal SVG for CSS border mode
  const diagOverlay = borderDiagonal && (borderDiagonal.lr || borderDiagonal.rl) && (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}
    >
      {borderDiagonal.lr && (() => {
        const d = borderDiagonal.lr;
        const sw = d.lineWidth != null ? Math.max(0.5, mmToPxZ(d.lineWidth)) : diagLineWidth;
        const sc = d.lineColor ?? diagLineColor;
        const ss = (d.lineStyle ?? diagLineStyle ?? 'solid').toLowerCase();
        const da = ss === 'dashed' ? `${sw * 4},${sw * 2}` : ss === 'dotted' ? `${sw},${sw * 2}` : undefined;
        return <line x1="0" y1="0" x2="1" y2="1" stroke={sc} strokeWidth={sw} vectorEffect="non-scaling-stroke" strokeDasharray={da} />;
      })()}
      {borderDiagonal.rl && (() => {
        const d = borderDiagonal.rl;
        const sw = d.lineWidth != null ? Math.max(0.5, mmToPxZ(d.lineWidth)) : diagLineWidth;
        const sc = d.lineColor ?? diagLineColor;
        const ss = (d.lineStyle ?? diagLineStyle ?? 'solid').toLowerCase();
        const da = ss === 'dashed' ? `${sw * 4},${sw * 2}` : ss === 'dotted' ? `${sw},${sw * 2}` : undefined;
        return <line x1="1" y1="0" x2="0" y2="1" stroke={sc} strokeWidth={sw} vectorEffect="non-scaling-stroke" strokeDasharray={da} />;
      })()}
    </svg>
  );

  // Shared margin inner line for CSS border mode
  const marginLineOverlay = borderMarginLine && borderMargins && (
    <div style={{
      position: 'absolute',
      top: borderMargins.top, right: borderMargins.right,
      bottom: borderMargins.bottom, left: borderMargins.left,
      border: `${borderMarginLine.width}px ${borderMarginLine.style} ${borderMarginLine.color}`,
      pointerEvents: 'none', zIndex: 1, boxSizing: 'border-box',
    }} />
  );

  const outerEvents = {
    onDoubleClick: e => { if (!isEditing && !e.target.closest('.tele')) startEdit(e); },
    onContextMenu: isEditing ? handleContextMenu : undefined,
    onDragOver:    handleCaeDragOver,
    onDrop:        handleCaeDrop,
    onDragLeave:   handleDragLeave,
  };

  // ── SVG border mode ───────────────────────────────────────────────────────────

  const _svgBorderProps = hasSvgBorder ? {
    sideStyles: svgBorder.sideStyles,
    corners:    svgBorder.corners,
    fillStyle:  effectiveFill,
    margins:    borderMargins,
    marginLine: borderMarginLine,
    diagonal:   borderDiagonal,
    lineColor:  diagLineColor,
    lineWidth:  diagLineWidth,
    lineStyle:  diagLineStyle,
    fillConfig: borderFillConfig,
  } : null;

  // SvgBorderOverlay sits inside the skewed outer div — it draws a rectangle in div-space
  // which renders as a parallelogram in screen space. Same overlay for all modes.
  const svgOverlay          = hasSvgBorder && <SvgBorderOverlay {..._svgBorderProps} />;
  const svgOverlayContentOnly = svgOverlay;

  // ── Shear dashed border (shown when no other visual style) ──────────────────
  // A <rect> inside the skewX-transformed outer div renders as a parallelogram outline.
  const shearBorderSvg = shearAngle !== 0 && !hasVisual && !hasSvgBorder ? (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
               overflow: 'visible', pointerEvents: 'none', zIndex: 2 }}
    >
      <rect x="0" y="0" width="1" height="1" fill="none"
        stroke="rgba(124, 58, 237, 0.55)" strokeWidth="3" strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke" />
    </svg>
  ) : null;

  // Counter-skew text layer: outer div has skewX(-θ) for correct borders/fills;
  // this wrapper applies skewX(+θ) so characters are upright, with marginLeft offset
  // so text starts at the parallelogram's diagonal left edge.
  const shearPaddedContentEl = shearDxPx > 0 ? (
    <div style={{
      marginLeft: `-${shearDxPx}px`,
      width: `calc(100% + ${shearDxPx}px)`,
      transform: `skewX(${signedEffAngle}deg)`,
      transformOrigin: '0 0',
      overflow: 'visible',
    }}>
      {effectiveContentEl}
    </div>
  ) : effectiveContentEl;

  const adjustedVisualCSS = visualCSS;
  const shearCssBorderSvg = null;

  const styleModalEl = styleModal && rootArea ? (
    <StyleEditModal
      kind={styleModal.kind}
      state={state}
      area={rootArea}
      persist={ch => state?.updateArea?.(element.id, rootArea.id, ch)}
      editorRef={editRef}
      savedRange={savedRangeRef.current}
      onClose={() => setStyleModal(null)}
    />
  ) : null;

  const extraBadges = <>{selfOverflowBadge}{fittingBadge}{balancingBadge}{dynamicHeightBadge}{writingDirBadge}{firstFittingBadge}{sectionFlowBadge}{styleModalEl}</>;

  if (hasSvgBorder) {
    if (isContentOnly) {
      return (
        <div className={caeClass} style={{ ...areaLayoutCSS, ...shearStyle }} {...outerEvents}>
          <div style={{ position: 'relative', width: '100%', height: (!editingAreaId && contentOnlyHeight != null) ? `${contentOnlyHeight}px` : '100%', overflow: 'visible', ...shadowCSS, ...contentPaddingCSS }}>
            {svgOverlayContentOnly}
            {shearPaddedContentEl}
            {textOverflowIndicator}
          </div>
          {flowBadge}
          {overflowBadge}
          {extraBadges}
          {lockIndicator}
        </div>
      );
    }
    return (
      <div className={caeClass} style={{ ...(Object.keys(shadowCSS).length ? shadowCSS : {}), ...areaLayoutCSS, ...shearStyle }} {...outerEvents}>
        {svgOverlay}
        <div className="cae__bands-inner">
          {shearPaddedContentEl}
          {textOverflowIndicator}
        </div>
        {flowBadge}
        {overflowBadge}
        {extraBadges}
        {lockIndicator}
      </div>
    );
  }

  // ── CSS border mode ───────────────────────────────────────────────────────────

  if (isContentOnly) {
    return (
      <div className={caeClass} style={{ ...areaLayoutCSS, ...shearStyle }} {...outerEvents}>
        <div style={{ position: 'relative', width: '100%', height: (!editingAreaId && contentOnlyHeight != null) ? `${contentOnlyHeight}px` : '100%', ...(hasVisual ? adjustedVisualCSS : {}), ...contentPaddingCSS }}>
          {marginLineOverlay}
          {diagOverlay}
          {shearBorderSvg}
          {shearCssBorderSvg}
          {shearPaddedContentEl}
          {textOverflowIndicator}
        </div>
        {flowBadge}
        {overflowBadge}
        {extraBadges}
        {lockIndicator}
      </div>
    );
  }

  return (
    <div className={caeClass} style={{ ...(hasVisual ? adjustedVisualCSS : {}), ...areaLayoutCSS, ...shearStyle }} {...outerEvents}>
      {marginLineOverlay}
      {diagOverlay}
      {shearBorderSvg}
      {shearCssBorderSvg}
      {shearPaddedContentEl}
      {textOverflowIndicator}
      {flowBadge}
      {overflowBadge}
      {extraBadges}
      {lockIndicator}
    </div>
  );
}
