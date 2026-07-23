// contentAreaUtils.js — pure helpers extracted from ContentAreaElement.jsx

import { hexToRgba } from '../../../engine/colorUtils.js';
import { buildGradientCss } from '../../../engine/fillUtils.js';
import { sanitizeHtml } from './htmlSanitizer.js';

export function mmToPx(mm) { return parseFloat((mm * 3.7795).toFixed(2)); }

const PT_TO_PX_DESIGN   = 144 / 72;    // design DPI → px per pt
const MM_TO_PX_DESIGN   = 144 / 25.4;  // design DPI → px per mm

// ── Variable preview ──────────────────────────────────────────────────────────

export const SYSTEM_SAMPLE_VALUES = {
  '$pageNumber':   '1',
  '$totalPages':   '5',
  '$date':         new Date().toLocaleDateString(),
  '$datetime':     new Date().toLocaleString(),
  '$documentName': 'Documento ejemplo',
  '$index':        '0',
  '$item':         '{...}',
};

export function flattenFieldsForPreview(fields, prefix = '') {
  const result = {};
  for (const f of (fields ?? [])) {
    const path = f.path ?? (prefix ? `${prefix}.${f.name}` : f.name);
    if (f.children?.length) {
      Object.assign(result, flattenFieldsForPreview(f.children, path));
    } else {
      if (f.sampleValue !== undefined) {
        result[path] = String(f.sampleValue);
      } else {
        const t = (f.type ?? 'string').toLowerCase();
        if (t === 'integer')      result[path] = '42';
        else if (t === 'number')  result[path] = '3.14';
        else if (t === 'boolean') result[path] = 'true';
        else if (t === 'array')   result[path] = '[a, b, c]';
        else if (t === 'object')  result[path] = '{...}';
        else                      result[path] = 'text_example';
      }
    }
  }
  return result;
}

export function buildSampleValues(availableFields) {
  return { ...SYSTEM_SAMPLE_VALUES, ...flattenFieldsForPreview(availableFields) };
}

// ── Text style → CSS ──────────────────────────────────────────────────────────

export function textStyleToCSS(ts, fillStyles, zoom = 1) {
  if (!ts) return {};
  const css = {};
  if (ts.fontFamily) css.fontFamily = ts.fontFamily;
  if (ts.fontSize)   css.fontSize = `${ts.fontSize * PT_TO_PX_DESIGN * zoom}px`;
  if (ts.lineHeight) css.lineHeight = ts.lineHeight;
  if (ts.fontWeight) {
    const w = ts.fontWeight;
    css.fontWeight = w === 'Thin' ? 100 : w === 'Light' ? 300 : w === 'Regular' ? 400
      : w === 'Medium' ? 500 : w === 'SemiBold' ? 600 : w === 'Bold' ? 700
      : w === 'ExtraBold' ? 800 : 400;
  }
  if (ts.italic)         css.fontStyle = 'italic';
  if (ts.underline && ts.strikethrough) css.textDecoration = 'underline line-through';
  else if (ts.underline)      css.textDecoration = 'underline';
  else if (ts.strikethrough)  css.textDecoration = 'line-through';
  if (ts.letterSpacing)  css.letterSpacing = `${ts.letterSpacing * zoom}px`;
  if (ts.textTransform && ts.textTransform !== 'none') css.textTransform = ts.textTransform;
  if (ts.superscript) { css.verticalAlign = 'super'; css.fontSize = `${(ts.fontSize ?? 12) * 0.6 * PT_TO_PX_DESIGN * zoom}px`; }
  if (ts.subscript)   { css.verticalAlign = 'sub';   css.fontSize = `${(ts.fontSize ?? 12) * 0.6 * PT_TO_PX_DESIGN * zoom}px`; }

  // ── fillStyleId: overrides plain color ──
  if (ts.fillStyleId && fillStyles?.length) {
    const fs = fillStyles.find(s => s.id === ts.fillStyleId);
    if (fs) {
      if (fs.type === 'solid') {
        css.color = hexToRgba(fs.color ?? '#000000', fs.opacity ?? 1);
      } else if (fs.type === 'gradient') {
        css.background = gradientToCSSString(fs.gradient);
        css.WebkitBackgroundClip = 'text';
        css.WebkitTextFillColor = 'transparent';
        css.backgroundClip = 'text';
      }
    } else {
      css.color = ts.color ?? '#1f2937';
    }
  } else {
    if (ts.color) css.color = ts.color;
  }

  // ── outlineStyleId: -webkit-text-stroke ──
  if (ts.outlineStyleId && (ts.outlineWidth ?? 0) > 0 && fillStyles?.length) {
    const ofs = fillStyles.find(s => s.id === ts.outlineStyleId);
    if (ofs) {
      const oc = ofs.type === 'solid' ? hexToRgba(ofs.color ?? '#000000', ofs.opacity ?? 1) : (ofs.color ?? '#000000');
      css.WebkitTextStroke = `${ts.outlineWidth * MM_TO_PX_DESIGN * zoom}px ${oc}`;
    }
  }

  // ── language → CSS custom property (applied as lang attr at render time) ──
  if (ts.language) css['--text-lang'] = ts.language;

  return css;
}

// ── Border computation ────────────────────────────────────────────────────────

export function radStr(rx, ry) { return rx === ry ? `${rx}px` : `${rx}px ${ry}px`; }

export function applyCSSCorner(css, type, rx, ry) {
  if (!rx && !ry) return;
  if (type === 'Round') {
    css.borderRadius = rx === ry ? `${rx}px` : `${rx}px / ${ry}px`;
  } else if (type === 'CutOut') {
    const pts = [
      `${rx}px 0%`, `calc(100% - ${rx}px) 0%`,
      `100% ${ry}px`, `100% calc(100% - ${ry}px)`,
      `calc(100% - ${rx}px) 100%`, `${rx}px 100%`,
      `0% calc(100% - ${ry}px)`, `0% ${ry}px`,
    ].join(', ');
    css.clipPath = `polygon(${pts})`;
  }
}

export function computeBorderData(border, borderStyles = [], fillStyles = []) {
  if (!border || border.mode === 'none') return { css: null, svgBorder: null };

  function resolveFSColor(id, fallback) {
    if (id) {
      const fs = fillStyles.find(s => s.id === id);
      if (fs?.color) return fs.color;
    }
    return fallback;
  }

  const css = {};
  let svgBorder   = null;
  let fillColor   = null;
  let shadow      = null;
  let margins     = null;
  let marginLine  = null;
  let diagonal    = null;
  let fillConfig  = null;

  const live = border.styleRef
    ? (borderStyles.find(s => s.id === border.styleRef) ?? null)
    : null;

  if (live) {
    const globalWidth = Math.max(0.5, mmToPx(live.lineWidth ?? 0.2));
    const globalStyle = (live.lineStyle ?? 'Solid').toLowerCase();
    const globalColor = resolveFSColor(live.lineFillStyleId, live.lineColor ?? '#000000');
    const liveSides   = live.sides   ?? {};
    const liveCorners = live.corners ?? {};
    const globalCorner = live.corner ?? 'Standard';
    const globalRx     = mmToPx(live.radiusX ?? 0);
    const globalRy     = mmToPx(live.radiusY ?? 0);

    const cornerKeys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
    const effCorners = cornerKeys.map(k => {
      const ck = liveCorners[k] ?? {};
      return {
        corner: ck.corner  ?? globalCorner,
        rx:     ck.radiusX != null ? mmToPx(ck.radiusX) : globalRx,
        ry:     ck.radiusY != null ? mmToPx(ck.radiusY) : globalRy,
      };
    });

    const hasRoundOut = effCorners.some(c => c.corner === 'RoundOut');

    const sideStyles = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const sd = liveSides[side];
      if (sd?.enabled === false) { sideStyles[side] = null; continue; }
      const w  = sd?.lineWidth != null ? Math.max(0.5, mmToPx(sd.lineWidth)) : globalWidth;
      const st = sd?.lineStyle != null ? sd.lineStyle.toLowerCase() : globalStyle;
      const c  = resolveFSColor(sd?.lineFillStyleId, sd?.lineColor != null ? sd.lineColor : globalColor);
      sideStyles[side] = st === 'none' ? null : { width: w, style: st, color: c };
    }

    if (hasRoundOut) {
      svgBorder = { sideStyles, corners: effCorners };
    } else {
      for (const [side, s] of Object.entries(sideStyles)) {
        const key = `border${side.charAt(0).toUpperCase() + side.slice(1)}`;
        css[key] = s ? `${s.width}px ${s.style} ${s.color}` : 'none';
      }
      const allSame = effCorners.every(
        c => c.corner === effCorners[0].corner && c.rx === effCorners[0].rx && c.ry === effCorners[0].ry
      );
      if (allSame) {
        applyCSSCorner(css, effCorners[0].corner, effCorners[0].rx, effCorners[0].ry);
      } else {
        const [tl, tr, br, bl] = effCorners;
        if (tl.corner === 'Round') css.borderTopLeftRadius     = radStr(tl.rx, tl.ry);
        if (tr.corner === 'Round') css.borderTopRightRadius    = radStr(tr.rx, tr.ry);
        if (br.corner === 'Round') css.borderBottomRightRadius = radStr(br.rx, br.ry);
        if (bl.corner === 'Round') css.borderBottomLeftRadius  = radStr(bl.rx, bl.ry);
      }
    }

    // ── Shading: fill, shadow, diagonal, fill shape ──
    if (live.fillFillStyleId) {
      const fs = fillStyles.find(s => s.id === live.fillFillStyleId);
      if (fs?.color) {
        const op = fs.opacity ?? 1;
        fillColor = op < 1 ? hexToRgba(fs.color, op) : fs.color;
      }
    } else if (live.fill) {
      fillColor = live.fill;
    }
    const resolvedShadowColor = resolveFSColor(live.shadowFillStyleId, live.shadowColor);
    if (resolvedShadowColor) {
      shadow = {
        color:   resolvedShadowColor,
        offsetX: mmToPx(live.shadowOffsetX ?? 0),
        offsetY: mmToPx(live.shadowOffsetY ?? 0),
      };
    }
    // Per-diagonal settings (new structure), with backward compat for old 'diagonal' enum
    const diags = live.diagonals ?? {};
    const lrEnabled = diags.lr?.enabled ?? (live.diagonal === 'lr' || live.diagonal === 'cross') ?? false;
    const rlEnabled = diags.rl?.enabled ?? (live.diagonal === 'rl' || live.diagonal === 'cross') ?? false;
    if (lrEnabled || rlEnabled) {
      diagonal = {
        lr: lrEnabled ? { ...diags.lr, lineColor: resolveFSColor(diags.lr?.lineFillStyleId, diags.lr?.lineColor) } : null,
        rl: rlEnabled ? { ...diags.rl, lineColor: resolveFSColor(diags.rl?.lineFillStyleId, diags.rl?.lineColor) } : null,
      };
    }

    // Fill shape (independent corner + padding)
    const fpl = mmToPx(live.fillPaddingLeft   ?? 0);
    const fpr = mmToPx(live.fillPaddingRight  ?? 0);
    const fpt = mmToPx(live.fillPaddingTop    ?? 0);
    const fpb = mmToPx(live.fillPaddingBottom ?? 0);
    const fc  = live.fillCorner ?? 'Standard';
    const frx = mmToPx(live.fillRadiusX ?? 0);
    const fry = mmToPx(live.fillRadiusY ?? 0);
    if (fillColor && (fpl || fpr || fpt || fpb || fc !== 'Standard' || frx || fry)) {
      fillConfig = { corner: fc, rx: frx, ry: fry, top: fpt, right: fpr, bottom: fpb, left: fpl };
    }

    // ── Margins ──
    const ml = mmToPx(live.marginLeft   ?? 0);
    const mr = mmToPx(live.marginRight  ?? 0);
    const mt = mmToPx(live.marginTop    ?? 0);
    const mb = mmToPx(live.marginBottom ?? 0);
    if (ml || mr || mt || mb) margins = { top: mt, right: mr, bottom: mb, left: ml };

    // Margin inner border line
    const mls = (live.marginLineStyle ?? 'None').toLowerCase();
    if (mls !== 'none' && (ml || mr || mt || mb)) {
      marginLine = {
        style: mls,
        color: resolveFSColor(live.marginFillStyleId, live.marginColor ?? '#000000'),
        width: Math.max(0.5, mmToPx(live.marginLineWidth ?? 0.2)),
      };
    }

  } else if (border.mode === 'unified') {
    if (border.unified?.enabled) {
      const { width = 1, style = 'solid', color = '#d1d5db' } = border.unified;
      css.border = `${width}px ${style} ${color}`;
    }
    const rx = border.radius?.unified ?? 0;
    if (rx) css.borderRadius = `${rx}px`;

  } else if (border.mode === 'sides') {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const s = (border.sides ?? {})[side];
      if (s?.enabled) {
        const key = `border${side.charAt(0).toUpperCase() + side.slice(1)}`;
        css[key] = `${s.width ?? 1}px ${s.style ?? 'solid'} ${s.color ?? '#d1d5db'}`;
      }
    }
  }

  return {
    css:        Object.keys(css).length ? css : null,
    svgBorder,
    fillColor,
    shadow,
    margins,
    marginLine,
    diagonal,
    fillConfig,
    lineStyle:  live ? (live.lineStyle ?? 'Solid').toLowerCase() : 'solid',
    lineColor:  live ? resolveFSColor(live.lineFillStyleId, live.lineColor ?? '#000000') : '#000000',
    lineWidth:  live ? Math.max(0.5, mmToPx(live.lineWidth ?? 0.2)) : 1,
  };
}

export function computeFillStyle(fill) {
  if (!fill || fill.type === 'none') return null;
  if (fill.type === 'solid') {
    const op = fill.opacity ?? 1;
    return { background: op < 1 ? hexToRgba(fill.color ?? '#ffffff', op) : (fill.color ?? '#ffffff') };
  }
  if (fill.type === 'gradient') return { background: gradientToCSSString(fill.gradient) };
  return null;
}

export { buildGradientCss as gradientToCSSString };

export function fillStyleToCSS(style, images) {
  if (!style || style.type === 'none') return null;
  if (style.type === 'solid') {
    const op = style.opacity ?? 1;
    return { background: op < 1 ? hexToRgba(style.color ?? '#000000', op) : (style.color ?? '#000000') };
  }
  if (style.type === 'gradient') return { background: gradientToCSSString(style.gradient) };
  if (style.type === 'image') {
    const img = (images ?? []).find(i => i.id === style.imageId);
    const url = img?.source?.data
      ? img.source.data
      : (img?.source?.url ?? '');
    if (!url) return null;
    const css = { backgroundImage: `url(${JSON.stringify(url)})` };
    if (style.autofit !== false) {
      css.backgroundSize = 'cover';
      css.backgroundRepeat = 'no-repeat';
      css.backgroundPosition = 'center';
    } else if (style.tile) {
      css.backgroundRepeat = 'repeat';
      css.backgroundSize = 'auto';
    } else {
      css.backgroundRepeat = 'no-repeat';
      const sx = style.scaleX ?? 1;
      const sy = style.scaleY ?? 1;
      css.backgroundSize = `${sx * 100}% ${sy * 100}%`;
      const ox = mmToPx(style.offsetX ?? 0);
      const oy = mmToPx(style.offsetY ?? 0);
      css.backgroundPosition = `${ox}px ${oy}px`;
    }
    const transforms = [];
    if (style.rotation) transforms.push(`rotate(${style.rotation}deg)`);
    if (style.flipX) transforms.push('scaleX(-1)');
    if (style.flipY) transforms.push('scaleY(-1)');
    if (transforms.length) css.transform = transforms.join(' ');
    return css;
  }
  return null;
}

export function resolveFillToCSS(fill, fillStyles, images) {
  if (fill?.fillStyleId) {
    const style = (fillStyles ?? []).find(s => s.id === fill.fillStyleId);
    if (style) return fillStyleToCSS(style, images);
  }
  return computeFillStyle(fill);
}

// ── SVG rect path ─────────────────────────────────────────────────────────────

export function buildRectPath(x0, y0, x1, y1, corner, rx, ry) {
  rx = Math.min(rx, (x1 - x0) / 2);
  ry = Math.min(ry, (y1 - y0) / 2);
  if (corner === 'Standard' || (!rx && !ry)) {
    return `M ${x0},${y0} H ${x1} V ${y1} H ${x0} Z`;
  }
  if (corner === 'Round') {
    return [
      `M ${x0 + rx},${y0}`, `H ${x1 - rx}`, `A ${rx} ${ry} 0 0 1 ${x1},${y0 + ry}`,
      `V ${y1 - ry}`, `A ${rx} ${ry} 0 0 1 ${x1 - rx},${y1}`,
      `H ${x0 + rx}`, `A ${rx} ${ry} 0 0 1 ${x0},${y1 - ry}`,
      `V ${y0 + ry}`, `A ${rx} ${ry} 0 0 1 ${x0 + rx},${y0}`, 'Z',
    ].join(' ');
  }
  if (corner === 'CutOut') {
    return [
      `M ${x0 + rx},${y0}`, `H ${x1 - rx}`, `L ${x1},${y0 + ry}`,
      `V ${y1 - ry}`, `L ${x1 - rx},${y1}`,
      `H ${x0 + rx}`, `L ${x0},${y1 - ry}`,
      `V ${y0 + ry}`, `L ${x0 + rx},${y0}`, 'Z',
    ].join(' ');
  }
  return `M ${x0},${y0} H ${x1} V ${y1} H ${x0} Z`;
}

// ── Area-tag expansion (view mode) ────────────────────────────────────────────

export function findChildAreaById(childAreas, id) {
  for (const a of (childAreas ?? [])) {
    if (a.id === id) return a;
    const found = findChildAreaById(a.children ?? [], id);
    if (found) return found;
  }
  return null;
}

export function resolveVarTagsIn(container, sampleValues) {
  for (const tag of container.querySelectorAll('.var-tag[data-var]')) {
    tag.textContent = sampleValues[tag.getAttribute('data-var')] ?? tag.getAttribute('data-var');
  }
}

// fullPool: the complete area pool (template.contentAreas). When provided, area-tag
// lookup searches the full pool so references to sibling/cousin areas are resolved.
export function expandAreaTagsInContainer(container, childAreas, sampleValues, visitedIds, showIndicators = false, fullPool = null) {
  // querySelectorAll is live — snapshot with spread to avoid mutation issues
  const tags = [...container.querySelectorAll('.area-tag[data-area]')];
  for (const tag of tags) {
    const areaId = tag.getAttribute('data-area');
    if (visitedIds.has(areaId)) { tag.replaceWith(document.createTextNode('')); continue; }

    // Search childAreas first (covers table cell sub-areas stored in cell.flow.children),
    // then fall back to the global pool (covers template.contentAreas references).
    const child = findChildAreaById(childAreas, areaId)
      ?? (fullPool ? findChildAreaById(fullPool, areaId) : null);
    if (!child) { tag.replaceWith(document.createTextNode('')); continue; }

    const newVisited = new Set(visitedIds);
    newVisited.add(areaId);

    if (child.flowType === 'inline-condition') {
      const defaultChild =
        (child.children ?? []).find(c => c.id === child.defaultAreaId) ??
        child.children?.[0];
      if (defaultChild) {
        const tmp = document.createElement('div');
        tmp.innerHTML = sanitizeHtml(defaultChild.content ?? '');
        expandAreaTagsInContainer(tmp, defaultChild.children ?? [], sampleValues, newVisited, showIndicators, fullPool);
        if (sampleValues) resolveVarTagsIn(tmp, sampleValues);
        tag.replaceWith(document.createRange().createContextualFragment(tmp.innerHTML));
      } else {
        tag.replaceWith(document.createTextNode(''));
      }
      continue;
    }

    // Simple and repeated: expand content recursively (repeated shows content as preview)
    const tmp = document.createElement('div');
    tmp.innerHTML = sanitizeHtml(child.content ?? '');
    expandAreaTagsInContainer(tmp, child.children ?? [], sampleValues, newVisited, showIndicators, fullPool);
    if (sampleValues) resolveVarTagsIn(tmp, sampleValues);

    // The area-tag is inline in the parent content, so the expanded content must also
    // be inline-safe. blockToInline() converts <p>/<div> wrappers to inline so the
    // replacement doesn't introduce block-level breaks (e.g. "text [area] text" stays
    // on one line instead of "text\n[area content block]\ntext").
    const inlineHtml = blockToInline(tmp.innerHTML);

    if (showIndicators) {
      const wrapper = document.createElement('span');
      wrapper.className = 'area-content-view';
      wrapper.style.cssText = `--area-color:${getAreaColor(areaId)}`;
      wrapper.innerHTML = inlineHtml;
      tag.replaceWith(wrapper);
    } else {
      tag.replaceWith(document.createRange().createContextualFragment(inlineHtml));
    }
  }
}

export function resolveForDisplay(html, childAreas, sampleValues, fullPool = null) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHtml(html);   // anti-XSS: limpia el HTML almacenado antes de renderizar
  expandAreaTagsInContainer(tmp, childAreas ?? [], sampleValues, new Set(), true, fullPool);
  if (sampleValues) resolveVarTagsIn(tmp, sampleValues);
  return tmp.innerHTML;
}

// ── Area indicator colors (shared between edit mode and view mode) ────────────

const AREA_INDICATOR_COLORS = [
  'rgba(5, 150, 105, 0.45)',   // green
  'rgba(59, 130, 246, 0.45)',  // blue
  'rgba(168, 85, 247, 0.45)',  // purple
  'rgba(249, 115, 22, 0.45)',  // orange
  'rgba(236, 72, 153, 0.45)',  // pink
];

// Deterministic color per area ID so the same area always gets the same color
// in both edit mode and view mode.
function getAreaColor(areaId) {
  let h = 0;
  for (let i = 0; i < areaId.length; i++) { h = Math.imul(31, h) + areaId.charCodeAt(i) | 0; }
  return AREA_INDICATOR_COLORS[Math.abs(h) % AREA_INDICATOR_COLORS.length];
}

// ── Editor area-tag inline preview (edit mode) ────────────────────────────────
// Expand area-tag spans to show child area content inline with a colored dotted
// underline. Before saving, collapseAreaTagsForEditor reverts them to tag refs.

// Flattens block-level elements to inline so the area preview span can use
// display:inline without invalid HTML. commitEdit() never reads the preview
// innerHTML (it restores from data-orig-html via collapseAreaTagsForEditor),
// so this is display-only and never affects saved data.
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE']);

function blockToInline(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const parts = [];
  let first = true;
  for (const node of tmp.childNodes) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      if (node.textContent) parts.push(node.textContent);
    } else if (BLOCK_TAGS.has(node.tagName)) {
      if (!first) parts.push('<br>');
      parts.push(node.innerHTML || '');
      first = false;
    } else {
      parts.push(node.outerHTML);
      first = false;
    }
  }
  return parts.join('');
}

export function expandAreaTagsForEditor(editor, childAreas, zoom = 1) {
  const tags = [...editor.querySelectorAll('.area-tag[data-area]:not(.area-tag--preview)')];
  if (!tags.length) return;
  const pxScale = (144 / 72) * zoom;
  tags.forEach(tag => {
    const areaId = tag.getAttribute('data-area');
    const child  = findChildAreaById(childAreas, areaId);
    if (!child) return;
    tag.setAttribute('data-orig-html', tag.innerHTML);
    const scaledHtml = (child.content ?? '').replace(
      /font-size\s*:\s*([\d.]+)pt/gi,
      (_, pts) => `font-size: ${(parseFloat(pts) * pxScale).toFixed(2)}px`
    );
    // Flatten block elements to inline so display:inline on the span works correctly.
    tag.innerHTML = blockToInline(scaledHtml);
    tag.classList.add('area-tag--preview');
    tag.style.setProperty('--area-color', getAreaColor(areaId));
    // Remove contenteditable="false" so the span inherits the parent editor's
    // contenteditable="true" context. This allows arrow-key navigation and
    // inline formatting (bold, italic, etc.) within the sub-area without
    // requiring mini-canvas. Sub-area content is saved in commitEdit() before
    // collapsing the spans.
    tag.removeAttribute('contenteditable');
  });
}

export function collapseAreaTagsForEditor(editor) {
  if (!editor) return;
  const tags = [...editor.querySelectorAll('.area-tag.area-tag--preview[data-area]')];
  tags.forEach(tag => {
    tag.innerHTML = tag.getAttribute('data-orig-html') ?? '';
    tag.removeAttribute('data-orig-html');
    tag.classList.remove('area-tag--preview');
    tag.style.removeProperty('--area-color');
    tag.setAttribute('contenteditable', 'false'); // restore atomic behaviour
  });
}

// ── Push cross-boundary formatting into preview spans (pre-save normalisation) ──
//
// Problem: execCommand('bold') wraps selected content at the highest possible
// level, producing <b><span.preview>A</span><span.preview>B</span></b>.
// When commitEdit reads span.innerHTML it gets "A" and "B" without the bold.
//
// Fix: for every format element that directly contains a .area-tag--preview span,
// move the format tag *inside* each child so span.innerHTML captures it.
// Non-preview children keep their own copy of the wrapper.
//
// Selector covers all tags execCommand may insert.
const FORMAT_TAG_SEL = 'b,i,u,s,strike,strong,em,mark,font,span[style]';

export function pushFormattingIntoPreviewSpans(editor) {
  if (!editor) return;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const fmt of [...editor.querySelectorAll(FORMAT_TAG_SEL)]) {
      if (!fmt.isConnected) continue;
      // Skip if it IS itself a preview span (area-tag spans have inline style too)
      if (fmt.classList?.contains('area-tag')) continue;
      // Check whether any DIRECT child is a preview span
      const hasPreview = [...fmt.children].some(
        c => c.classList?.contains('area-tag--preview')
      );
      if (!hasPreview) continue;

      // Build replacement fragment
      const frag = document.createDocumentFragment();
      for (const child of [...fmt.childNodes]) {
        const isPreview = child.nodeType === 1 && child.classList?.contains('area-tag--preview');
        const clone = fmt.cloneNode(false); // shallow clone — keeps tag + attributes
        if (isPreview) {
          // Move preview span's content into the format clone, put clone inside span
          while (child.firstChild) clone.appendChild(child.firstChild);
          child.appendChild(clone);
          frag.appendChild(child);
        } else {
          // Non-preview child (text node or other element): keep it wrapped
          clone.appendChild(child); // moves the node
          frag.appendChild(clone);
        }
      }
      fmt.replaceWith(frag);
      changed = true;
    }
    if (!changed) break;
  }
}

// ── Global area number collector ──────────────────────────────────────────────
// Scans EVERY place areas can live in the template so new areas always get
// a globally unique "Área N" label. Covers:
//   • contentAreas pool (areas + their children, recursively)
//   • embedded table elements inside those areas (cell flows + their children)
//   • standalone table elements on pages (same depth)

export function collectAllAreaNums(template) {
  function collectAreaLabels(area) {
    const labels = [area.label];
    for (const child of (area.children ?? [])) labels.push(...collectAreaLabels(child));
    for (const el of (area.elements ?? [])) {
      if (el.type === 'table') {
        for (const rs of (el.rowSets ?? [])) {
          for (const c of (rs.cells ?? [])) {
            if (c.flow) labels.push(...collectAreaLabels(c.flow));
          }
        }
      }
    }
    return labels;
  }
  const allLabels = [
    ...(template?.contentAreas ?? []).flatMap(collectAreaLabels),
    ...(template?.pages ?? []).flatMap(p =>
      (p.elements ?? []).flatMap(el => {
        if (el.type !== 'table') return [];
        return (el.rowSets ?? []).flatMap(rs =>
          (rs.cells ?? []).flatMap(c => c.flow ? collectAreaLabels(c.flow) : [])
        );
      })
    ),
  ];
  return allLabels.map(l => l?.match(/^Área\s*(\d+)$/)?.[1]).filter(Boolean).map(Number);
}

// ── Area layout CSS (dynamicHeight, writingDirection) ─────────────────────────

export function applyAreaLayoutCSS(element) {
  const css = {};
  // dynamicHeight: in the editor we allow overflow so content is visible beyond the box
  if (element?.dynamicHeight) {
    css.overflow = 'visible';
    css.minHeight = '100%';
  }
  return css;
}

export function applyContentLayoutCSS(element) {
  const css = {};
  if (element?.writingDirection === 'vertical') {
    css.writingMode = 'vertical-rl';
    css.textOrientation = 'mixed';
  }
  return css;
}

export const FLOW_TYPE_LABELS = {
  repeated:           '↻ Repetido',
  'inline-condition': '⎇ Variable',
  section:            '§ Sección',
};

// ── Segmented rendering helper ────────────────────────────────────────────────
// Splits resolved HTML at element-tag span boundaries.
// Returns array of { type:'html', content } | { type:'element', key, el }
// or null if no element-tags are found.
export function splitHtmlAtElementTags(html, embeddedEls) {
  if (!html || !embeddedEls.length) return null;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const found = {};
  tmp.querySelectorAll('span.element-tag[data-element]').forEach(span => {
    const id = span.getAttribute('data-element');
    const el = embeddedEls.find(e => e.id === id);
    if (!el) return;
    found[id] = el;
    const ph = document.createElement('ins');
    ph.setAttribute('data-ph', id);
    span.replaceWith(ph);
  });
  if (!Object.keys(found).length) return null;
  const processed = tmp.innerHTML;
  const parts = [];
  const re = /<ins data-ph="([^"]*)"><\/ins>/gi;
  let last = 0, m;
  let prevWasElement = false;
  while ((m = re.exec(processed)) !== null) {
    if (m.index > last) {
      let htmlContent = processed.slice(last, m.index);
      // In edit mode the table is inline-block, so a <br> before it keeps the table
      // on its own line. In view mode each part is a <div>, so the <br> adds an extra
      // blank line. Strip the single trailing <br> (mechanically added by the editor).
      htmlContent = htmlContent.replace(/<br\s*\/?>$/i, '');
      // Strip leading <br> + optional ZWS after a block element-tag. Our Enter interceptor
      // inserts <br>+ZWS after the table; in view mode the <div> wrapping already separates
      // them, so the <br> creates a phantom blank line.
      if (prevWasElement) htmlContent = htmlContent.replace(new RegExp('^<br\\s*\\/?>\\u200B?', 'i'), '');
      parts.push({ type: 'html', content: htmlContent });
    }
    const el = found[m[1]];
    if (el) parts.push({ type: 'element', key: m[1], el });
    prevWasElement = !!el;
    last = re.lastIndex;
  }
  if (last < processed.length) {
    let htmlContent = processed.slice(last);
    if (prevWasElement) htmlContent = htmlContent.replace(new RegExp('^<br\\s*\\/?>\\u200B?', 'i'), '');
    parts.push({ type: 'html', content: htmlContent });
  }
  return parts;
}
