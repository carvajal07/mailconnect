// styleGc.js — limpieza de estilos "copia" huérfanos.
//
// El modelo viejo de "fork-on-open" creaba un estilo "(copia)" en cada clic,
// dejando huérfanos sin referencia. Esta utilidad recolecta TODAS las referencias
// reales (áreas, elementos, celdas de tabla, estilos de párrafo) y elimina los
// estilos de texto / párrafo / viñetas cuyo nombre termina en "(copia)" y que no
// están referenciados en ningún sitio. Conserva los default y los estilos con
// nombre propio (no toca nada que el usuario haya nombrado).

const COPY_RE = /\(copia\)\s*$/i;

function collectReferencedStyleIds(template) {
  const text = new Set();
  const para = new Set();
  const bullet = new Set();

  const visitArea = (a) => {
    if (!a) return;
    if (a.defaultTextStyleId) text.add(a.defaultTextStyleId);
    if (a.paragraphStyleId)   para.add(a.paragraphStyleId);
    (a.elements ?? []).forEach(visitEl);
    (a.children ?? []).forEach(visitArea);
  };

  const visitEl = (el) => {
    if (!el) return;
    if (el.textStyleId)      text.add(el.textStyleId);
    if (el.paragraphStyleId) para.add(el.paragraphStyleId);
    if (el.type === 'table') {
      (el.rowSets ?? []).forEach(rs =>
        (rs.cells ?? []).forEach(c => { if (c.flow) visitArea(c.flow); })
      );
    }
    (el.areas ?? []).forEach(visitArea); // modelo viejo inline
  };

  (template?.pages ?? []).forEach(p => (p.elements ?? []).forEach(visitEl));
  (template?.contentAreas ?? []).forEach(visitArea);

  // Los estilos de párrafo referencian viñetas + un estilo de texto por defecto.
  (template?.styles?.paragraph ?? []).forEach(ps => {
    if (ps.bulletNumberingId)  bullet.add(ps.bulletNumberingId);
    if (ps.defaultTextStyleId) text.add(ps.defaultTextStyleId);
  });

  return { text, para, bullet };
}

// Devuelve un template nuevo sin los estilos "(copia)" huérfanos. Idempotente.
export function gcOrphanCopyStyles(template) {
  if (!template?.styles) return template;
  const refs = collectReferencedStyleIds(template);

  const keep = (refSet) => (s) =>
    s.isDefault || !COPY_RE.test(s.name ?? '') || refSet.has(s.id);

  const text   = (template.styles.text ?? []).filter(keep(refs.text));
  const para   = (template.styles.paragraph ?? []).filter(keep(refs.para));
  const bullet = (template.styles.bulletNumbering ?? []).filter(keep(refs.bullet));

  // Sin cambios → devuelve el mismo objeto (evita re-render innecesario).
  if (text.length === (template.styles.text ?? []).length
    && para.length === (template.styles.paragraph ?? []).length
    && bullet.length === (template.styles.bulletNumbering ?? []).length) {
    return template;
  }

  return {
    ...template,
    styles: { ...template.styles, text, paragraph: para, bulletNumbering: bullet },
  };
}
