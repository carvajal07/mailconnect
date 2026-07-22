/**
 * Modelo de bloques, ajustes globales y generación de HTML para el constructor
 * de plantillas (tipo Topol). El HTML resultante es "email-safe" y RESPONSIVE:
 * tablas + estilos inline, ghost tables para Outlook (MSO), media queries para
 * móvil, imágenes fluidas y botones bulletproof.
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
  | 'html'
  | 'imageText'   // combo: imagen a la izquierda + texto a la derecha
  | 'textImage'   // combo: texto a la izquierda + imagen a la derecha
  | 'products';   // grilla de productos (imagen + título + texto + enlace)

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  x?: string;
  linkedin?: string;
}

/** Un producto de la grilla `products`. */
export interface ProductItem {
  image: string;
  title: string;
  text: string;
  url?: string;
}

export interface Block {
  id: string;
  type: BlockType;
  text: string; // encabezado / texto / etiqueta botón / columna izq / html crudo / alt / cuerpo combo
  textRight: string; // columna derecha
  url: string; // src de imagen-logo / href del botón
  align: 'left' | 'center' | 'right';
  color: string; // color de texto / fondo del botón / barra del logo
  height: number; // alto del espaciador (px)
  links: SocialLinks; // redes sociales
  // Combos (imageText/textImage) y grilla de productos:
  imageUrl?: string; // combos: src de la imagen
  heading?: string; // combos: título
  buttonText?: string; // combos: etiqueta del botón (opcional)
  buttonUrl?: string; // combos: href del botón
  columns?: number; // products: nº de columnas (2 | 3)
  items?: ProductItem[]; // products: lista de productos
}

/** Ajustes globales del correo (como el panel "settings" de Topol). */
export interface EmailSettings {
  contentWidth: number; // ancho del contenedor (px)
  pageBg: string; // fondo de la página (fuera del contenedor)
  emailBg: string; // fondo del contenedor
  fontFamily: string; // familia tipográfica base
  textColor: string; // color de texto base
  linkColor: string; // color de enlaces
  rounded: boolean; // esquinas redondeadas del contenedor
  preheader: string; // texto de vista previa (oculto) del correo
}

export const DEFAULT_SETTINGS: EmailSettings = {
  contentWidth: 600,
  pageBg: '#f4f8fc',
  emailBg: '#ffffff',
  fontFamily: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  textColor: '#333333',
  linkColor: '#0075be',
  rounded: true,
  preheader: '',
};

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
  imageText: 'Imagen + Texto',
  textImage: 'Texto + Imagen',
  products: 'Productos',
};

/** Agrupación de la paleta (contenido / combinados / estructura), como Topol/MailPro. */
export const PALETTE_GROUPS: { label: string; types: BlockType[] }[] = [
  { label: 'Contenido', types: ['heading', 'text', 'image', 'button', 'logo', 'social', 'html'] },
  { label: 'Combinados', types: ['imageText', 'textImage', 'products'] },
  { label: 'Estructura', types: ['columns', 'divider', 'spacer'] },
];

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
      return { ...b, url: 'https://via.placeholder.com/600x240?text=Imagen', text: 'Imagen', align: 'center' };
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
    case 'imageText':
    case 'textImage':
      return {
        ...b,
        imageUrl: 'https://via.placeholder.com/260x200?text=Imagen',
        heading: 'Título de la sección',
        text: 'Describe aquí tu producto, novedad u oferta. Edítalo en el panel derecho.',
        buttonText: '',
        buttonUrl: 'https://',
        align: 'left',
      };
    case 'products':
      return { ...b, align: 'center', columns: 3, items: [defaultProduct(), defaultProduct(), defaultProduct()] };
    default:
      return b;
  }
};

const defaultProduct = (): ProductItem => ({
  image: 'https://via.placeholder.com/200x200?text=Producto',
  title: 'Producto',
  text: 'Descripción breve',
  url: '',
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function paragraph(s: string, align: string, st: EmailSettings): string {
  return `<p style="margin:0;font-family:${st.fontFamily};font-size:15px;line-height:1.6;color:${st.textColor};text-align:${align}">${esc(s).replace(/\n/g, '<br>')}</p>`;
}

/** Botón bulletproof: fondo en el <td> (bgcolor + border-radius) y padding en el <a>,
 *  con mso-padding-alt para que Outlook respete el alto. */
function buttonHtml(b: Block, st: EmailSettings): string {
  const bg = b.color || st.linkColor;
  const alignAttr = b.align || 'left';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:${alignAttr === 'center' ? '0 auto' : '0'}"><tr>
        <td align="center" bgcolor="${bg}" style="border-radius:6px;">
          <a href="${esc(b.url)}" target="_blank" style="display:inline-block;padding:12px 26px;font-family:${st.fontFamily};font-size:15px;font-weight:bold;line-height:1;color:#ffffff;text-decoration:none;border-radius:6px;mso-padding-alt:0;">
            <!--[if mso]>&nbsp;&nbsp;<![endif]-->${esc(b.text)}<!--[if mso]>&nbsp;&nbsp;<![endif]-->
          </a>
        </td>
      </tr></table>`;
}

function socialRow(links: SocialLinks, st: EmailSettings): string {
  const items: string[] = [];
  const push = (label: string, href?: string) => {
    if (href && href.trim()) {
      items.push(
        `<a href="${esc(href)}" target="_blank" style="color:${st.linkColor};text-decoration:none;font-family:${st.fontFamily};font-size:14px">${label}</a>`,
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

/** Imagen fluida (100% del contenedor, con tope). */
function imageHtml(src: string, alt: string, align: string, maxW: number): string {
  return `<img src="${esc(src)}" alt="${esc(alt)}" width="${maxW}" style="width:100%;max-width:${maxW}px;height:auto;display:block;margin:${align === 'center' ? '0 auto' : '0'};border:0;outline:none;text-decoration:none;" />`;
}

/** Combo imagen+texto (o texto+imagen). Dos celdas que APILAN en móvil (clase mc-col). */
function comboHtml(b: Block, st: EmailSettings, imageLeft: boolean): string {
  const img = imageHtml(b.imageUrl || '', b.heading || '', 'left', 240);
  const btn = b.buttonText
    ? `<div style="padding-top:14px;">${buttonHtml({ ...b, text: b.buttonText, url: b.buttonUrl || '#', align: 'left', color: '' }, st)}</div>`
    : '';
  const txt = `${b.heading ? `<h3 style="margin:0 0 8px;font-family:${st.fontFamily};font-size:19px;line-height:1.3;color:#16233f;">${esc(b.heading)}</h3>` : ''}${paragraph(b.text, b.align || 'left', st)}${btn}`;
  const first = imageLeft ? img : txt;
  const second = imageLeft ? txt : img;
  const firstW = imageLeft ? 'width="42%" ' : '';
  const secondW = imageLeft ? '' : 'width="42%" ';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td class="mc-col" ${firstW}valign="top" style="padding:0 12px 0 0;">${first}</td>
        <td class="mc-col" ${secondW}valign="top" style="padding:0 0 0 12px;">${second}</td>
      </tr></table>`;
}

/** Grilla de productos: imagen + título + texto + enlace, en filas de `columns` (apilan en móvil). */
function productsHtml(b: Block, st: EmailSettings): string {
  const items = b.items || [];
  if (!items.length) return '';
  const cols = Math.min(Math.max(b.columns || 3, 1), 4);
  const w = Math.floor(100 / cols);
  const cell = (it: ProductItem): string => `<td class="mc-col" width="${w}%" valign="top" style="padding:8px;">
        ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.title || '')}" width="100%" style="width:100%;max-width:100%;height:auto;display:block;border:0;border-radius:8px;" />` : ''}
        ${it.title ? `<p style="margin:12px 0 4px;font-family:${st.fontFamily};font-size:16px;font-weight:bold;line-height:1.3;color:#16233f;text-align:center;">${esc(it.title)}</p>` : ''}
        ${it.text ? `<p style="margin:0;font-family:${st.fontFamily};font-size:13px;line-height:1.5;color:${st.textColor};text-align:center;">${esc(it.text)}</p>` : ''}
        ${it.url ? `<p style="margin:8px 0 0;text-align:center;"><a href="${esc(it.url)}" target="_blank" style="color:${st.linkColor};font-family:${st.fontFamily};font-size:13px;font-weight:bold;text-decoration:none;">Ver m&aacute;s &rsaquo;</a></p>` : ''}
      </td>`;
  const rows: ProductItem[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  const trs = rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('');
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">${trs}</table>`;
}

/** Serializa un bloque a HTML email-safe y responsive. */
function renderBlock(b: Block, st: EmailSettings): string {
  const align = b.align || 'left';
  const innerW = st.contentWidth - 48; // contenedor menos padding lateral (24+24)
  switch (b.type) {
    case 'heading':
      return `<h1 style="margin:0;font-family:${st.fontFamily};font-size:26px;line-height:1.3;color:${b.color || '#16233f'};text-align:${align}">${esc(b.text)}</h1>`;
    case 'text':
      return paragraph(b.text, align, st);
    case 'image':
      return imageHtml(b.url, b.text, align, innerW);
    case 'logo':
      return imageHtml(b.url, 'logo', align, 180);
    case 'button':
      return buttonHtml(b, st);
    case 'columns':
      return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td class="mc-col" width="50%" valign="top" style="padding:0 8px 0 0;">${paragraph(b.text, 'left', st)}</td>
          <td class="mc-col" width="50%" valign="top" style="padding:0 0 0 8px;">${paragraph(b.textRight, 'left', st)}</td>
        </tr>
      </table>`;
    case 'social':
      return socialRow(b.links, st);
    case 'imageText':
      return comboHtml(b, st, true);
    case 'textImage':
      return comboHtml(b, st, false);
    case 'products':
      return productsHtml(b, st);
    case 'html':
      return b.text; // HTML crudo, tal cual
    case 'divider':
      return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:1px solid #e4ebf3;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
    case 'spacer':
      return `<div style="height:${b.height || 24}px;line-height:${b.height || 24}px;font-size:0;">&nbsp;</div>`;
    default:
      return '';
  }
}

/** Genera el correo completo (responsive, cross-client) a partir de bloques + ajustes. */
export function generateHtml(blocks: Block[], settings: EmailSettings = DEFAULT_SETTINGS): string {
  const st = { ...DEFAULT_SETTINGS, ...settings };
  const radius = st.rounded ? 12 : 0;

  const rows =
    blocks
      .map(
        (b) =>
          `            <tr><td align="${b.align || 'left'}" style="padding:10px 24px;">${renderBlock(b, st)}</td></tr>`,
      )
      .join('\n') ||
    `            <tr><td style="padding:24px;font-family:${st.fontFamily};color:#888888;">Plantilla vacía</td></tr>`;

  const preheader = st.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${st.emailBg};opacity:0;">${esc(st.preheader)}</div>`
    : '';

  // Pie de desuscripción: SIEMPRE presente (requisito de SES/anti-spam y buenas
  // prácticas). {{unsubscribeUrl}} lo llena el motor de envío por destinatario
  // con un enlace firmado; no es editable ni removible desde el builder.
  const unsubscribeFooter = `            <tr><td align="center" class="mc-pad" style="padding:18px 24px 24px;border-top:1px solid #e8edf3;">
              <p style="margin:0;font-family:${st.fontFamily};font-size:12px;line-height:18px;color:#8a97ab;">
                Recibes este correo porque estás suscrito a nuestras comunicaciones.<br />
                <a href="{{unsubscribeUrl}}" target="_blank" style="color:#8a97ab;text-decoration:underline;">Cancelar suscripci&oacute;n</a>
              </p>
            </td></tr>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
  <title>MailConnect</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    html, body { margin:0 !important; padding:0 !important; height:100% !important; width:100% !important; }
    * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse; }
    img { -ms-interpolation-mode:bicubic; border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
    a { text-decoration:none; }
    .mc-container { width:${st.contentWidth}px; }
    @media screen and (max-width:${st.contentWidth}px) {
      .mc-container { width:100% !important; }
      .mc-col { display:block !important; width:100% !important; box-sizing:border-box; padding:8px 0 !important; }
      .mc-pad { padding-left:16px !important; padding-right:16px !important; }
      .mc-h1 { font-size:22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${st.pageBg};">
  ${preheader}
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:${st.pageBg};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${st.contentWidth}"><tr><td><![endif]-->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="mc-container" width="${st.contentWidth}" style="width:${st.contentWidth}px;max-width:100%;background:${st.emailBg};border-radius:${radius}px;overflow:hidden;">
${rows}
${unsubscribeFooter}
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ----------------------------- Borradores locales ----------------------------- */
// Persistencia en localStorage (modelo de bloques + ajustes) sin depender del backend.

const DRAFTS_KEY = 'mc_html_drafts';

export interface Draft {
  blocks: Block[];
  settings: EmailSettings;
}

type DraftStore = Record<string, Draft | Block[]>;

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

/** Normaliza borradores viejos (solo array de bloques) al nuevo formato. */
function normalize(entry: Draft | Block[] | undefined): Draft | null {
  if (!entry) return null;
  if (Array.isArray(entry)) return { blocks: entry, settings: { ...DEFAULT_SETTINGS } };
  return { blocks: entry.blocks ?? [], settings: { ...DEFAULT_SETTINGS, ...entry.settings } };
}

export const drafts = {
  list: (): string[] => Object.keys(readStore()).sort(),
  save: (name: string, blocks: Block[], settings: EmailSettings): void => {
    const store = readStore();
    store[name] = { blocks, settings };
    writeStore(store);
  },
  load: (name: string): Draft | null => normalize(readStore()[name]),
  remove: (name: string): void => {
    const store = readStore();
    delete store[name];
    writeStore(store);
  },
};
