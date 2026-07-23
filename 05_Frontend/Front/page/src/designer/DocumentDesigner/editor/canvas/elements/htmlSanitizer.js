// src/nodes/DocumentDesigner/editor/canvas/elements/htmlSanitizer.js
// Sanitización del HTML del Document Designer (anti-XSS almacenado). El contenido de áreas/celdas
// se edita en un contentEditable y se guarda como HTML; sin sanitizar, un usuario podía inyectar
// <img onerror>, <svg onload>, <iframe>, etc. que se ejecutaban en el navegador de OTROS miembros
// del workspace (templates compartidos) y robaban su sesión.
//
// DOMPurify conserva el HTML legítimo del editor (spans de formato, var-tag/area-tag/element-tag
// con sus data-*, estilos inline, tablas) y elimina todo vector activo (script, on*, javascript:,
// iframe/object/embed). Se aplica al GUARDAR, al MOSTRAR y al PEGAR (defensa en profundidad).
import DOMPurify from 'dompurify';

const CONFIG = {
  ALLOW_DATA_ATTR: true,                                  // var-tag/area-tag/element-tag usan data-*
  ADD_ATTR: ['contenteditable'],                          // el editor marca spans no editables
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'base', 'style'],
  FORBID_ATTR: ['srcdoc', 'xlink:href', 'formaction', 'action'],
};

/** Sanitiza HTML de contenido (áreas/celdas). Conserva el formato propio del editor, quita XSS. */
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || html === '') return html;
  return DOMPurify.sanitize(html, CONFIG);
}

/** Sanitiza un SVG generado (barcode/chart) a partir de datos del usuario (perfil SVG). */
export function sanitizeSvg(svg) {
  if (typeof svg !== 'string' || svg === '') return svg;
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
