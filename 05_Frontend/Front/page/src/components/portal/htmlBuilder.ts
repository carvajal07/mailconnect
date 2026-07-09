/**
 * Modelo de bloques y generación de HTML para el constructor de plantillas.
 * Versión "pro" (tipo Topol, básico ampliable): bloques que se serializan a HTML
 * "email-safe" (tablas + estilos inline) apto para SES.
 */

export type BlockType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'logo'
  | 'columns'
  | 'social'
  | 'html';

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  x?: string;
  linkedin?: string;
}

export interface Block {
  id: string;
  type: BlockType;
  text: string; // encabezado / texto / etiqueta botón / columna izq / html crudo / alt
  textRight: string; // columna derecha
  url: string; // src de imagen-logo / href del botón
  align: 'left' | 'center' | 'right';
  color: string; // color de texto / fondo del botón / barra del logo
  height: number; // alto del espaciador (px)
  links: SocialLinks; // redes sociales
}

let seq = 0;
export const nextId = () => `b${++seq}_${(seq * 2654435761) % 100000}`;

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Encabezado',
  text: 'Texto',
  image: 'Imagen',
  button: 'Botón',
  divider: 'Divisor',
  spacer: 'Espaciador',
  logo: 'Logo',
  columns: '2 Columnas',
  social: 'Redes sociales',
  html: 'HTML crudo',
};

/** Variables de personalización que el motor de envío reemplaza por destinatario. */
export const VARIABLES = ['nombre', 'email', 'empresa', 'ciudad'];

const baseBlock = (type: BlockType): Block => ({
  id: nextId(),
  type,
  text: '',
  textRight: '',
  url: '',
  align: 'left',
  color: '',
  height: 24,
  links: {},
});

export const createBlock = (type: BlockType): Block => {
  const b = baseBlock(type);
  switch (type) {
    case 'heading':
      return { ...b, text: 'Título principal', align: 'center', color: '#16233f' };
    case 'text':
      return { ...b, text: 'Hola {{nombre}}, escribe aquí tu contenido. Edítalo en el panel derecho.' };
    case 'image':
      return { ...b, url: 'https://via.placeholder.com/600x200?text=Imagen', text: 'Imagen', align: 'center' };
    case 'button':
      return { ...b, text: 'Ver más', url: 'https://', align: 'center', color: '#0075be' };
    case 'logo':
      return { ...b, url: 'https://via.placeholder.com/180x54?text=Logo', align: 'center', color: '' };
    case 'columns':
      return { ...b, text: 'Columna izquierda', textRight: 'Columna derecha' };
    case 'social':
      return {
        ...b,
        align: 'center',
        links: { facebook: 'https://', instagram: 'https://', x: '', linkedin: '' },
      };
    case 'html':
      return { ...b, text: '<p style="text-align:center">Tu HTML aquí</p>' };
    default:
      return b;
  }
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const asParagraph = (s: string, align: string) =>
  `<p style="margin:0;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#333333;text-align:${align}">${esc(s).replace(/\n/g, '<br>')}</p>`;

function socialRow(links: SocialLinks): string {
  const items: string[] = [];
  const push = (label: string, href?: string) => {
    if (href && href.trim()) {
      items.push(
        `<a href="${esc(href)}" style="color:#0075be;text-decoration:none;font-family:Arial,sans-serif;font-size:14px">${label}</a>`,
      );
    }
  };
  push('Facebook', links.facebook);
  push('Instagram', links.instagram);
  push('X', links.x);
  push('LinkedIn', links.linkedin);
  if (!items.length) return '';
  return `<p style="margin:0;text-align:center">${items.join(' &nbsp;·&nbsp; ')}</p>`;
}

/** Serializa un bloque a HTML email-safe. */
function renderBlock(b: Block): string {
  const align = b.align || 'left';
  switch (b.type) {
    case 'heading':
      return `<h1 style="margin:0;font-family:Arial,sans-serif;font-size:26px;line-height:1.3;color:${b.color || '#16233f'};text-align:${align}">${esc(b.text)}</h1>`;
    case 'text':
      return asParagraph(b.text, align);
    case 'image':
      return `<img src="${esc(b.url)}" alt="${esc(b.text)}" style="display:block;max-width:100%;height:auto;margin:${align === 'center' ? '0 auto' : '0'};border:0" />`;
    case 'logo':
      return `<img src="${esc(b.url)}" alt="logo" style="display:block;max-width:180px;height:auto;margin:${align === 'center' ? '0 auto' : '0'};border:0" />`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:${align === 'center' ? '0 auto' : '0'}"><tr><td style="background:${b.color || '#0075be'};border-radius:6px"><a href="${esc(b.url)}" style="display:inline-block;padding:12px 22px;font-family:Arial,sans-serif;font-size:15px;color:#ffffff;text-decoration:none">${esc(b.text)}</a></td></tr></table>`;
    case 'columns':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" valign="top" style="padding-right:8px">${asParagraph(b.text, 'left')}</td><td width="50%" valign="top" style="padding-left:8px">${asParagraph(b.textRight, 'left')}</td></tr></table>`;
    case 'social':
      return socialRow(b.links);
    case 'html':
      return b.text; // HTML crudo, tal cual
    case 'divider':
      return `<hr style="border:none;border-top:1px solid #e4ebf3;margin:0" />`;
    case 'spacer':
      return `<div style="height:${b.height || 24}px;line-height:${b.height || 24}px">&nbsp;</div>`;
    default:
      return '';
  }
}

/** Genera el HTML completo del correo a partir de los bloques. */
export function generateHtml(blocks: Block[]): string {
  const rows = blocks
    .map(
      (b) =>
        `      <tr><td style="padding:10px 24px" align="${b.align || 'left'}">${renderBlock(b)}</td></tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f8fc">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8fc">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
${rows || '      <tr><td style="padding:24px;font-family:Arial,sans-serif;color:#888">Plantilla vacía</td></tr>'}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ----------------------------- Borradores locales ----------------------------- */
// Persistencia en localStorage: permite guardar/cargar el trabajo (modelo de bloques)
// sin depender del backend. Clave por usuario para no mezclar cuentas.

const DRAFTS_KEY = 'mc_html_drafts';

type DraftStore = Record<string, Block[]>;

function readStore(): DraftStore {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') as DraftStore;
  } catch {
    return {};
  }
}

function writeStore(store: DraftStore): void {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
}

export const drafts = {
  list: (): string[] => Object.keys(readStore()).sort(),
  save: (name: string, blocks: Block[]): void => {
    const store = readStore();
    store[name] = blocks;
    writeStore(store);
  },
  load: (name: string): Block[] | null => readStore()[name] ?? null,
  remove: (name: string): void => {
    const store = readStore();
    delete store[name];
    writeStore(store);
  },
};
