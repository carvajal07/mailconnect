// selectionStyle.js — aplicar estilos a una SELECCIÓN/párrafo dentro del editor.
//
// Texto  → se envuelve el rango en un <span> con el CSS del estilo (inline,
//          snapshot — igual que el formato inline del toolbar). px escalado por
//          zoom; commitEdit lo convierte px→pt al guardar.
// Párrafo→ se etiquetan los BLOQUES (<div>/<p>) que toca el rango con
//          data-pstyle="ps_xxx" (referencia, "atado"). El render resuelve ese
//          ref a CSS por bloque (vista + edición); al commitear se quita el CSS
//          inyectado y solo persiste el atributo data-pstyle.

import { textStyleToCSS } from './contentAreaUtils.js';
import { resolveParagraphStyle } from '../../../engine/paragraphStyleUtils.js';

// 144 DPI de diseño (igual que mmToPxZ en ContentAreaElement) — NO usar units.mmToPx (96dpi).
const mmToPxDesign = (mm, zoom = 1) => mm * (144 / 25.4) * zoom;

// Tags de bloque que pueden llevar un estilo de párrafo.
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

// Propiedades que inyectamos en los bloques data-pstyle (para poder quitarlas
// limpiamente en commit sin tocar estilos que el usuario haya puesto aparte).
export const INJECTED_PARA_PROPS = [
  'textAlign', 'paddingLeft', 'paddingRight', 'textIndent',
  'paddingTop', 'paddingBottom', 'lineHeight', 'letterSpacing',
];

// ── Texto: envolver el rango en un span con el CSS del estilo ──────────────────

export function applyTextStyleToRange(range, styleObj, fillStyles, zoom = 1) {
  if (!range || range.collapsed || !styleObj) return null;
  const css = textStyleToCSS(styleObj, fillStyles, zoom);
  const span = document.createElement('span');
  for (const [k, v] of Object.entries(css)) {
    if (k.startsWith('--')) { try { span.style.setProperty(k, v); } catch { /* ignore */ } }
    else { try { span.style[k] = v; } catch { /* ignore */ } }
  }
  try {
    range.surroundContents(span);
  } catch {
    // surroundContents falla si el rango cruza fronteras de nodos parcialmente.
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
  return span;
}

// ── Párrafo: encontrar los bloques que toca el rango y etiquetarlos ────────────

function closestBlock(node, editor) {
  while (node && node !== editor) {
    if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) return node;
    node = node.parentNode;
  }
  return null;
}

function blockElementsInRange(editor, range) {
  const startB = closestBlock(range.startContainer, editor);
  const endB   = closestBlock(range.endContainer, editor);
  if (!startB) return endB ? [endB] : [];
  if (!endB || startB === endB) return [startB];
  // Caso plano (lo normal en contentEditable): bloques hermanos consecutivos.
  const out = [];
  let n = startB;
  while (n) {
    out.push(n);
    if (n === endB) break;
    n = n.nextElementSibling;
  }
  if (out[out.length - 1] !== endB) return [startB, endB];
  return out;
}

// Etiqueta con data-pstyle los bloques que toca el rango. Si el texto está suelto
// en el editor (sin bloque contenedor), envuelve el contenido del rango en un div.
export function applyParagraphStyleToRange(editor, range, psId) {
  if (!editor || !range || !psId) return;
  const blocks = blockElementsInRange(editor, range);
  if (blocks.length === 0) {
    const div = document.createElement('div');
    div.setAttribute('data-pstyle', psId);
    try {
      range.surroundContents(div);
    } catch {
      const frag = range.extractContents();
      div.appendChild(frag);
      range.insertNode(div);
    }
    return;
  }
  blocks.forEach(b => b.setAttribute('data-pstyle', psId));
}

// ── Resolución del estilo de párrafo a CSS por bloque ──────────────────────────

export function paragraphStyleToBlockCSS(ps, zoom = 1) {
  if (!ps) return {};
  const css = {};
  const mm = v => `${mmToPxDesign(v, zoom)}px`;
  if (ps.alignment)       css.textAlign     = ps.alignment;
  if (ps.leftIndent)      css.paddingLeft   = mm(ps.leftIndent);
  if (ps.rightIndent)     css.paddingRight  = mm(ps.rightIndent);
  if (ps.firstLineIndent) css.textIndent    = mm(ps.firstLineIndent);
  if (ps.spaceBefore)     css.paddingTop    = mm(ps.spaceBefore);
  if (ps.spaceAfter)      css.paddingBottom = mm(ps.spaceAfter);
  if (ps.letterSpacing)   css.letterSpacing = `${ps.letterSpacing * zoom}px`;
  if (ps.lineHeight && ps.lineHeight !== 'normal') css.lineHeight = ps.lineHeight;
  return css;
}

// Edición: inyecta el CSS resuelto en los bloques data-pstyle del DOM vivo.
export function applyParagraphBlockStyles(editor, paragraphStyles, zoom = 1) {
  if (!editor) return;
  editor.querySelectorAll('[data-pstyle]').forEach(block => {
    const ps = resolveParagraphStyle(block.getAttribute('data-pstyle'), paragraphStyles);
    const css = paragraphStyleToBlockCSS(ps, zoom);
    Object.assign(block.style, css);
  });
}

// Commit: quita SOLO el CSS que inyectamos (el atributo data-pstyle se conserva).
export function stripParagraphBlockStyles(editor) {
  if (!editor) return;
  editor.querySelectorAll('[data-pstyle]').forEach(block => {
    INJECTED_PARA_PROPS.forEach(p => { block.style[p] = ''; });
    if (!block.getAttribute('style')) block.removeAttribute('style');
  });
}

// Vista: devuelve el HTML con el CSS de párrafo inyectado en cada bloque data-pstyle.
export function resolveParagraphBlocks(html, paragraphStyles, zoom = 1) {
  if (!html || !html.includes('data-pstyle')) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('[data-pstyle]').forEach(block => {
    const ps = resolveParagraphStyle(block.getAttribute('data-pstyle'), paragraphStyles);
    const css = paragraphStyleToBlockCSS(ps, zoom);
    Object.assign(block.style, css);
  });
  return tmp.innerHTML;
}
