/**
 * Texto ENRIQUECIDO del constructor de correos + saneamiento por LISTA BLANCA.
 *
 * Por qué existe: el generador escapaba el texto de cada bloque (`esc(texto)`), así que
 * no se podía poner una palabra en negrita ni un enlace dentro de un párrafo — la
 * carencia más visible frente a Mailchimp/Topol. Ahora un bloque puede guardar HTML
 * EN LÍNEA, pero solo el subconjunto que los clientes de correo renderizan bien.
 *
 * Se sanea SIEMPRE, en los dos sentidos:
 *   · al ENTRAR (lo que produce el contentEditable, que al pegar mete `<div>`, `<font>`,
 *     `style` de Word, `<script>`…),
 *   · al SALIR (lo que se serializa al HTML final).
 * Así el editor nunca guarda algo que no se pueda enviar, y un bloque manipulado a mano
 * tampoco puede inyectar script en el correo de un cliente.
 *
 * No se usa DOMPurify (no es dependencia del repo): la lista blanca de abajo es
 * deliberadamente CORTA — lo que sobra en un correo se descarta, no se intenta arreglar.
 */

/** Etiquetas en línea permitidas dentro de un párrafo. */
const INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'SPAN', 'BR']);
/** Etiquetas de bloque permitidas (listas y saltos de párrafo). */
const BLOCK_TAGS = new Set(['UL', 'OL', 'LI', 'P', 'DIV']);

/**
 * Propiedades CSS que sobreviven al saneamiento (el resto se tira).
 * `font-family` y `background-color` (resaltado) están aquí porque son estilos EN LÍNEA
 * que todos los clientes de correo respetan. Deliberadamente NO está `text-align`: es una
 * propiedad de BLOQUE y el generador ya envuelve el contenido en un `<p>` con su propia
 * alineación — meter otra dentro produciría HTML anidado que Outlook rompe. La alineación
 * se controla desde el bloque (AlignPicker), no desde el texto.
 */
const ALLOWED_STYLES = new Set([
  'color', 'font-size', 'font-weight', 'font-style', 'text-decoration',
  'background-color', 'font-family',
]);

/** Normaliza a las etiquetas semánticas que mejor soportan los clientes de correo. */
const TAG_ALIAS: Record<string, string> = { B: 'strong', I: 'em', STRIKE: 's' };

const isSafeHref = (href: string): boolean => {
  const v = href.trim().toLowerCase();
  // `javascript:` y `data:` son los vectores clásicos; se permiten enlaces normales,
  // correo, teléfono y las variables de plantilla ({{unsubscribeUrl}} y compañía).
  return (
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('mailto:') ||
    v.startsWith('tel:') ||
    v.startsWith('#') ||
    v.startsWith('{{')
  );
};

/** Filtra un `style` inline dejando solo las propiedades de la lista blanca. */
const cleanStyle = (raw: string): string => {
  const out: string[] = [];
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLES.has(prop) || !value) continue;
    // `expression()` / `url()` no tienen nada que hacer en un correo.
    if (/expression\s*\(|url\s*\(|@import/i.test(value)) continue;
    out.push(`${prop}:${value}`);
  }
  return out.join(';');
};

/**
 * Sanea HTML EN LÍNEA (el de un párrafo del constructor). Devuelve una cadena segura
 * con solo las etiquetas/atributos de la lista blanca; el texto de lo descartado se
 * conserva (se "desenvuelve"), para no perder contenido del usuario.
 */
export const sanitizeInlineHtml = (dirty: string): string => {
  if (!dirty) return '';
  const doc = new DOMParser().parseFromString(`<body>${dirty}</body>`, 'text/html');

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeText(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    const inner = Array.from(el.childNodes).map(walk).join('');

    // `<script>`/`<style>` se descartan ENTEROS (su texto tampoco debe sobrevivir).
    if (tag === 'SCRIPT' || tag === 'STYLE') return '';
    if (tag === 'BR') return '<br>';

    if (!INLINE_TAGS.has(tag) && !BLOCK_TAGS.has(tag)) return inner; // desenvuelve

    // Los `div` que produce el contentEditable al presionar Enter se vuelven saltos.
    if (tag === 'DIV' || tag === 'P') return inner ? `${inner}<br>` : '';

    const name = TAG_ALIAS[tag] || tag.toLowerCase();
    const attrs: string[] = [];

    if (name === 'a') {
      const href = el.getAttribute('href') || '';
      if (!isSafeHref(href)) return inner; // enlace peligroso → queda solo el texto
      attrs.push(`href="${escapeAttr(href)}"`, 'target="_blank"', 'rel="noopener"');
    }

    const style = cleanStyle(el.getAttribute('style') || '');
    if (style) attrs.push(`style="${escapeAttr(style)}"`);

    // Un `span` sin estilo no aporta nada al correo: se desenvuelve.
    if (name === 'span' && !style) return inner;

    return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${name}>`;
  };

  return Array.from(doc.body.childNodes).map(walk).join('');
};

/**
 * Sanea un documento HTML COMPLETO (el bloque "HTML crudo", donde el usuario puede pegar
 * markup de otra herramienta). Más permisivo que el inline —deja tablas y su maquetación,
 * que es como se construyen los correos— pero igual elimina script/eventos/`javascript:`.
 */
export const sanitizeBlockHtml = (dirty: string): string => {
  if (!dirty) return '';
  const doc = new DOMParser().parseFromString(`<body>${dirty}</body>`, 'text/html');

  doc.body.querySelectorAll('script,style,iframe,object,embed,form,input,link,meta,base').forEach((n) => n.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // Manejadores de evento (onclick, onerror, onload…): fuera todos.
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src') && !isSafeHref(attr.value) && !attr.value.startsWith('cid:')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
};

/** Escapa texto para insertarlo como contenido. */
export const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escapa un valor para insertarlo en un atributo entrecomillado. */
export const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

/**
 * Contenido de un bloque listo para el HTML final.
 * `rich` distingue el formato NUEVO (HTML en línea) del LEGADO (texto plano que hay que
 * escapar). Sin esa marca, una plantilla vieja con "5 < 10" se rompería al tratarla como
 * HTML — por eso la migración es por bloque y no una conversión masiva.
 */
export const blockContentHtml = (text: string, rich?: boolean): string =>
  rich ? sanitizeInlineHtml(text) : escapeText(text || '').replace(/\n/g, '<br>');

/** Texto plano de un contenido enriquecido (para vistas previas y conteos). */
export const richToPlain = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return (doc.body.textContent || '').trim();
};

/**
 * Token de variable con VALOR POR DEFECTO. `{{nombre}}` deja "Hola ," cuando el dato
 * viene vacío; con respaldo se emite la forma condicional de Handlebars, que es la que
 * entiende el motor de plantillas de SES (y que los renderizadores de PDF del repo
 * también resuelven).
 */
export const variableToken = (field: string, fallback?: string): string => {
  const f = String(field || '').trim();
  if (!f) return '';
  const fb = String(fallback || '').trim();
  return fb ? `{{#if ${f}}}{{${f}}}{{else}}${fb}{{/if}}` : `{{${f}}}`;
};

/** Nombres de variable usados en un texto (incluye la forma condicional). */
export const usedVariables = (html: string): string[] => {
  const found = new Set<string>();
  const re = /\{\{\s*(?:#if\s+)?([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== 'else' && m[1] !== '/if') found.add(m[1]);
  }
  return Array.from(found);
};
