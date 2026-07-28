/**
 * Modelo de bloques + generación del HTML del correo (responsive y cross-client).
 *
 * El HTML que sale de aquí se publica como plantilla SES, así que se escribe con las
 * reglas del correo, no de la web: tablas para maquetar, estilos EN LÍNEA (Gmail borra
 * el `<style>` del head en algunos contextos), condicionales MSO para Outlook y media
 * queries solo como MEJORA (si el cliente las ignora, el correo sigue leyéndose).
 */
import { blockContentHtml, escapeText, sanitizeBlockHtml, richToPlain, usedVariables } from './richText';

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
  | 'textButton'  // combo: texto a la izquierda + botón a la derecha
  | 'buttonTextRow' // combo: botón a la izquierda + texto a la derecha
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

/** Proporciones disponibles para el bloque de columnas. */
export type ColumnRatio = '50-50' | '33-67' | '67-33' | '33-33-33';

export const COLUMN_RATIOS: { value: ColumnRatio; label: string; widths: number[] }[] = [
  { value: '50-50', label: '2 columnas iguales', widths: [50, 50] },
  { value: '33-67', label: '1/3 + 2/3', widths: [33, 67] },
  { value: '67-33', label: '2/3 + 1/3', widths: [67, 33] },
  { value: '33-33-33', label: '3 columnas iguales', widths: [33, 34, 33] },
];

export interface Block {
  id: string;
  type: BlockType;
  text: string; // encabezado / texto / etiqueta botón / columna izq / html crudo / alt / cuerpo combo
  textRight: string; // columna derecha (LEGADO: lo reemplaza `cols`)
  url: string; // src de imagen-logo / href del botón
  align: 'left' | 'center' | 'right';
  color: string; // color de texto / fondo del botón / barra del logo
  height: number; // alto del espaciador (px)
  links: SocialLinks; // redes sociales

  /** El contenido de `text` (y `heading`) es HTML EN LÍNEA, no texto plano. Marca por
   *  bloque: sin ella se escapa como siempre, así que las plantillas viejas no se rompen. */
  rich?: boolean;

  // ── Estilo propio del bloque (antes todo compartía padding:10px 24px fijo) ──
  padY?: number;      // relleno vertical (px)
  padX?: number;      // relleno horizontal (px)
  bgColor?: string;   // fondo de la fila del bloque
  fontSize?: number;  // tamaño base del texto/encabezado del bloque

  // ── Imagen ──
  imageWidth?: number;   // ancho en px (por defecto, el del contenedor)
  imageHref?: string;    // hace la imagen CLICABLE
  imageRadius?: number;  // esquinas redondeadas

  // Combos (imageText/textImage) y grilla de productos:
  imageUrl?: string; // combos: src de la imagen
  heading?: string; // combos: título
  buttonText?: string; // combos: etiqueta del botón (opcional)
  buttonUrl?: string; // combos: href del botón
  columns?: number; // products: nº de columnas (2 | 3)
  items?: ProductItem[]; // products: lista de productos

  // ── Columnas con bloques anidados ──
  ratio?: ColumnRatio;
  /** Contenido de cada columna. Un nivel de anidamiento (no hay columnas dentro de
   *  columnas: en correo eso multiplica las tablas y rompe en Outlook). */
  cols?: Block[][];
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
  /** Emite reglas `prefers-color-scheme: dark`. Sin esto, Apple Mail y Outlook invierten
   *  los colores por su cuenta y suelen romper el contraste del diseño. */
  darkMode: boolean;
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
  darkMode: true,
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
  columns: 'Columnas',
  social: 'Redes sociales',
  html: 'HTML crudo',
  imageText: 'Imagen + Texto',
  textImage: 'Texto + Imagen',
  textButton: 'Texto + Botón',
  buttonTextRow: 'Botón + Texto',
  products: 'Productos',
};

/** Agrupación de la paleta (contenido / combinados / estructura), como Topol/MailPro. */
export const PALETTE_GROUPS: { label: string; types: BlockType[] }[] = [
  { label: 'Contenido', types: ['heading', 'text', 'image', 'button', 'logo', 'social', 'html'] },
  { label: 'Combinados', types: ['imageText', 'textImage', 'textButton', 'buttonTextRow', 'products'] },
  { label: 'Estructura', types: ['columns', 'divider', 'spacer'] },
];

/** Tipos que se pueden anidar DENTRO de una columna (nada que ya sea una tabla ancha). */
export const NESTABLE_TYPES: BlockType[] = ['heading', 'text', 'image', 'button', 'divider', 'spacer'];

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
  rich: true,
});

export const createBlock = (type: BlockType): Block => {
  const b = baseBlock(type);
  switch (type) {
    case 'heading':
      return { ...b, text: 'Título principal', align: 'center', color: '#16233f' };
    case 'text':
      return { ...b, text: 'Hola {{nombre}}, escribe aquí tu contenido. Haz doble clic para editarlo.' };
    // La imagen nace VACÍA a propósito: antes apuntaba a via.placeholder.com y, si el
    // cliente no la cambiaba, salía un correo real con la imagen de un tercero (dominio
    // ajeno, con caídas). Vacía, el lienzo muestra un marcador y el chequeo previo avisa.
    case 'image':
      return { ...b, url: '', text: 'Describe la imagen', align: 'center' };
    case 'button':
      return { ...b, text: 'Ver más', url: 'https://', align: 'center', color: '#0075be' };
    case 'logo':
      return { ...b, url: '', align: 'center', color: '' };
    case 'columns':
      return {
        ...b,
        ratio: '50-50',
        cols: [[createBlock('text')], [createBlock('text')]],
      };
    case 'social':
      return {
        ...b,
        align: 'center',
        links: { facebook: 'https://', instagram: 'https://', x: '', linkedin: '' },
      };
    case 'html':
      return { ...b, rich: false, text: '<p style="text-align:center">Tu HTML aquí</p>' };
    case 'imageText':
    case 'textImage':
      return {
        ...b,
        imageUrl: '',
        heading: 'Título de la sección',
        text: 'Describe aquí tu producto, novedad u oferta.',
        buttonText: '',
        buttonUrl: 'https://',
        align: 'left',
      };
    case 'textButton':
    case 'buttonTextRow':
      return {
        ...b,
        heading: 'Título de la sección',
        text: 'Texto que acompaña al botón.',
        buttonText: 'Ver más',
        buttonUrl: 'https://',
        color: '#0075be',
        align: 'left',
      };
    case 'products':
      return { ...b, align: 'center', columns: 3, items: [defaultProduct(), defaultProduct(), defaultProduct()] };
    default:
      return b;
  }
};

const defaultProduct = (): ProductItem => ({
  image: '',
  title: 'Producto',
  text: 'Descripción breve',
  url: '',
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Contenido de texto de un bloque: HTML en línea saneado, o texto plano escapado. */
const content = (b: Block, field: 'text' | 'heading' = 'text'): string =>
  blockContentHtml(field === 'text' ? b.text : b.heading || '', b.rich);

function paragraph(b: Block, align: string, st: EmailSettings, size?: number): string {
  const fs = size || b.fontSize || 15;
  return `<p style="margin:0;font-family:${st.fontFamily};font-size:${fs}px;line-height:1.6;color:${b.color && b.type === 'text' ? b.color : st.textColor};text-align:${align}">${content(b)}</p>`;
}

/** Botón bulletproof: fondo en el <td> (bgcolor + border-radius) y padding en el <a>,
 *  con mso-padding-alt para que Outlook respete el alto. */
function buttonHtml(b: Block, st: EmailSettings): string {
  const bg = b.color || st.linkColor;
  const alignAttr = b.align || 'left';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:${alignAttr === 'center' ? '0 auto' : '0'}"><tr>
        <td align="center" bgcolor="${bg}" style="border-radius:6px;">
          <a href="${esc(b.url)}" target="_blank" style="display:inline-block;padding:12px 26px;font-family:${st.fontFamily};font-size:15px;font-weight:bold;line-height:1;color:#ffffff;text-decoration:none;border-radius:6px;mso-padding-alt:0;">
            <!--[if mso]>&nbsp;&nbsp;<![endif]-->${richToPlain(content(b)) || esc(b.text)}<!--[if mso]>&nbsp;&nbsp;<![endif]-->
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

/**
 * Imagen fluida. Si `href` está definida, se envuelve en un enlace (una promoción cuya
 * imagen no es clicable pierde conversiones). Sin `src` NO se emite nada: mejor un hueco
 * que una imagen rota en el correo del destinatario.
 */
function imageHtml(src: string, alt: string, align: string, maxW: number, href?: string, radius?: number): string {
  if (!src || !src.trim()) return '';
  const r = radius ? `border-radius:${radius}px;` : '';
  const img = `<img src="${esc(src)}" alt="${esc(alt)}" width="${maxW}" style="width:100%;max-width:${maxW}px;height:auto;display:block;margin:${align === 'center' ? '0 auto' : '0'};border:0;${r}outline:none;text-decoration:none;" />`;
  return href && href.trim() && href !== 'https://'
    ? `<a href="${esc(href)}" target="_blank" style="text-decoration:none;">${img}</a>`
    : img;
}

/** Combo imagen+texto (o texto+imagen). Dos celdas que APILAN en móvil (clase mc-col). */
function comboHtml(b: Block, st: EmailSettings, imageLeft: boolean): string {
  const img = imageHtml(b.imageUrl || '', richToPlain(content(b, 'heading')), 'left', 240, b.imageHref, b.imageRadius);
  const btn = b.buttonText
    ? `<div style="padding-top:14px;">${buttonHtml({ ...b, text: b.buttonText, rich: false, url: b.buttonUrl || '#', align: 'left', color: b.color }, st)}</div>`
    : '';
  const txt = `${b.heading ? `<h3 style="margin:0 0 8px;font-family:${st.fontFamily};font-size:19px;line-height:1.3;color:#16233f;">${content(b, 'heading')}</h3>` : ''}${paragraph(b, b.align || 'left', st, 14)}${btn}`;
  const first = imageLeft ? img : txt;
  const second = imageLeft ? txt : img;
  const firstW = imageLeft ? 'width="42%" ' : '';
  const secondW = imageLeft ? '' : 'width="42%" ';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td class="mc-col" ${firstW}valign="top" style="padding:0 12px 0 0;">${first}</td>
        <td class="mc-col" ${secondW}valign="top" style="padding:0 0 0 12px;">${second}</td>
      </tr></table>`;
}

/** Combo texto+botón (o botón+texto). Botón vertical-centrado junto al texto; apilan en móvil. */
function ctaHtml(b: Block, st: EmailSettings, buttonLeft: boolean): string {
  const btn = b.buttonText
    ? buttonHtml({ ...b, text: b.buttonText, rich: false, url: b.buttonUrl || '#', align: buttonLeft ? 'left' : 'right', color: b.color }, st)
    : '';
  const txt = `${b.heading ? `<h3 style="margin:0 0 6px;font-family:${st.fontFamily};font-size:19px;line-height:1.3;color:#16233f;">${content(b, 'heading')}</h3>` : ''}${paragraph(b, b.align || 'left', st)}`;
  const first = buttonLeft ? btn : txt;
  const second = buttonLeft ? txt : btn;
  const firstW = buttonLeft ? 'width="38%" ' : '';
  const secondW = buttonLeft ? '' : 'width="38%" ';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td class="mc-col" ${firstW}valign="middle" style="padding:0 12px 0 0;">${first}</td>
        <td class="mc-col" ${secondW}valign="middle" style="padding:0 0 0 12px;">${second}</td>
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

/**
 * Fila de columnas con proporciones y bloques ANIDADOS. Antes era 50/50 fijo con solo
 * texto plano a cada lado (`text` / `textRight`); esos campos se siguen leyendo para no
 * romper las plantillas guardadas con el modelo viejo.
 */
function columnsHtml(b: Block, st: EmailSettings): string {
  const ratio = COLUMN_RATIOS.find((r) => r.value === (b.ratio || '50-50')) || COLUMN_RATIOS[0];
  const widths = ratio.widths;
  const cols: Block[][] = b.cols?.length
    ? b.cols
    : [[{ ...b, type: 'text', cols: undefined }], [{ ...b, type: 'text', text: b.textRight, cols: undefined }]];

  const cells = widths
    .map((w, i) => {
      const inner = (cols[i] || []).map((child) => renderBlock(child, st, Math.round((st.contentWidth - 48) * (w / 100)))).join('');
      const padLeft = i === 0 ? 0 : 8;
      const padRight = i === widths.length - 1 ? 0 : 8;
      return `<td class="mc-col" width="${w}%" valign="top" style="padding:0 ${padRight}px 0 ${padLeft}px;">${inner}</td>`;
    })
    .join('');
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>${cells}</tr></table>`;
}

/** Serializa un bloque a HTML email-safe y responsive. */
function renderBlock(b: Block, st: EmailSettings, widthOverride?: number): string {
  const align = b.align || 'left';
  const innerW = widthOverride ?? st.contentWidth - 48; // contenedor menos padding lateral
  switch (b.type) {
    case 'heading':
      return `<h1 class="mc-h1" style="margin:0;font-family:${st.fontFamily};font-size:${b.fontSize || 26}px;line-height:1.3;color:${b.color || '#16233f'};text-align:${align}">${content(b)}</h1>`;
    case 'text':
      return paragraph(b, align, st);
    case 'image':
      return imageHtml(b.url, richToPlain(content(b)) || 'imagen', align, b.imageWidth || innerW, b.imageHref, b.imageRadius);
    case 'logo':
      return imageHtml(b.url, 'logo', align, b.imageWidth || 180, b.imageHref, b.imageRadius);
    case 'button':
      return buttonHtml(b, st);
    case 'columns':
      return columnsHtml(b, st);
    case 'social':
      return socialRow(b.links, st);
    case 'imageText':
      return comboHtml(b, st, true);
    case 'textImage':
      return comboHtml(b, st, false);
    case 'textButton':
      return ctaHtml(b, st, false); // texto izquierda, botón derecha
    case 'buttonTextRow':
      return ctaHtml(b, st, true); // botón izquierda, texto derecha
    case 'products':
      return productsHtml(b, st);
    // HTML pegado por el usuario: se SANEA (fuera script, iframe, on*, javascript:).
    // Antes se insertaba tal cual, así que un pegado malicioso viajaba en el correo.
    case 'html':
      return sanitizeBlockHtml(b.text);
    case 'divider':
      return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td class="mc-divider" style="border-top:1px solid ${b.color || '#e4ebf3'};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
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
      .map((b) => {
        const padY = b.padY ?? 10;
        const padX = b.padX ?? 24;
        const bg = b.bgColor ? ` bgcolor="${esc(b.bgColor)}"` : '';
        const bgStyle = b.bgColor ? `background-color:${esc(b.bgColor)};` : '';
        return `            <tr><td align="${b.align || 'left'}"${bg} class="mc-pad mc-row" style="${bgStyle}padding:${padY}px ${padX}px;">${renderBlock(b, st)}</td></tr>`;
      })
      .join('\n') ||
    `            <tr><td style="padding:24px;font-family:${st.fontFamily};color:#888888;">Plantilla vacía</td></tr>`;

  const preheader = st.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${st.emailBg};opacity:0;">${escapeText(st.preheader)}</div>`
    : '';

  // Modo oscuro. Sin estas reglas, Apple Mail y Outlook invierten los colores por su
  // cuenta y el resultado suele ser texto oscuro sobre fondo oscuro. `color-scheme` le
  // dice al cliente que el correo SABE manejar los dos modos y no lo toque él.
  const darkCss = st.darkMode
    ? `
    @media (prefers-color-scheme: dark) {
      body, .mc-body { background:#12161d !important; }
      .mc-container, .mc-row { background-color:#1b212b !important; }
      .mc-row p, .mc-row h1, .mc-row h3, .mc-row td, .mc-row span { color:#e7ecf3 !important; }
      .mc-divider { border-top-color:#33404f !important; }
      .mc-footer, .mc-footer p, .mc-footer a { color:#93a1b5 !important; background-color:#1b212b !important; }
    }`
    : '';
  const colorScheme = st.darkMode
    ? `  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
`
    : '';

  // Pie de desuscripción: SIEMPRE presente (requisito de SES/anti-spam y buenas
  // prácticas). {{unsubscribeUrl}} y {{preferencesUrl}} los llena el motor de envío por
  // destinatario con enlaces firmados; no son editables ni removibles desde el builder.
  const unsubscribeFooter = `            <tr><td align="center" class="mc-pad mc-footer" style="padding:18px 24px 24px;border-top:1px solid #e8edf3;">
              <p style="margin:0;font-family:${st.fontFamily};font-size:12px;line-height:18px;color:#8a97ab;">
                Recibes este correo porque estás suscrito a nuestras comunicaciones.<br />
                <a href="{{preferencesUrl}}" target="_blank" style="color:#8a97ab;text-decoration:underline;">Administrar preferencias</a>
                &nbsp;&middot;&nbsp;
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
${colorScheme}  <title>MailConnect</title>
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
    }${darkCss}
  </style>
</head>
<body class="mc-body" style="margin:0;padding:0;background:${st.pageBg};">
  ${preheader}
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:${st.pageBg};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${st.contentWidth}"><tr><td><![endif]-->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="mc-container" style="width:${st.contentWidth}px;max-width:100%;background:${st.emailBg};border-radius:${radius}px;overflow:hidden;">
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

// ───────────────────────── Chequeo previo (entregabilidad) ─────────────────────────

export type IssueLevel = 'error' | 'warning' | 'info';

export interface TemplateIssue {
  level: IssueLevel;
  title: string;
  detail: string;
}

/** Límite a partir del cual Gmail RECORTA el correo y muestra "ver mensaje completo". */
export const GMAIL_CLIP_BYTES = 102 * 1024;

/**
 * Revisa la plantilla antes de publicarla. Son las causas típicas de que un correo
 * "bien diseñado" llegue roto o a spam; verlas aquí es más barato que en el reporte de
 * rebotes, y la reputación de SES es COMPARTIDA entre todos los clientes.
 */
export function analyzeTemplate(blocks: Block[], settings: EmailSettings, html: string): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const bytes = new TextEncoder().encode(html).length;

  if (bytes > GMAIL_CLIP_BYTES) {
    issues.push({
      level: 'warning',
      title: 'El correo pesa más de 102 KB',
      detail: `Pesa ${(bytes / 1024).toFixed(0)} KB. Gmail lo recorta y muestra "ver mensaje completo", que oculta el pie de desuscripción y baja la tasa de clic. Reduce el HTML crudo o divide el contenido.`,
    });
  }

  const walk = (list: Block[]): Block[] => list.flatMap((b) => [b, ...(b.cols || []).flatMap(walk)]);
  const all = walk(blocks);

  const imgBlocks = all.filter((b) => b.type === 'image' || b.type === 'logo');
  const sinImagen = imgBlocks.filter((b) => !b.url || !b.url.trim());
  if (sinImagen.length) {
    issues.push({
      level: 'error',
      title: `${sinImagen.length} bloque(s) de imagen sin imagen`,
      detail: 'Se omiten al generar el correo y dejan un hueco. Sube la imagen o elimina el bloque.',
    });
  }

  const sinAlt = imgBlocks.filter((b) => b.url && b.type === 'image' && !richToPlain(b.text || '').trim());
  if (sinAlt.length) {
    issues.push({
      level: 'warning',
      title: `${sinAlt.length} imagen(es) sin texto alternativo`,
      detail: 'Muchos clientes bloquean las imágenes por defecto: sin el texto alternativo, ahí no se ve NADA. También lo usan los lectores de pantalla.',
    });
  }

  const links = Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]);
  const vacios = links.filter((h) => !h.trim() || h === '#' || h === 'https://' || h === 'http://');
  if (vacios.length) {
    issues.push({
      level: 'error',
      title: `${vacios.length} enlace(s) sin destino`,
      detail: 'Hay botones o enlaces apuntando a "https://" o "#". El destinatario hace clic y no pasa nada.',
    });
  }

  // Proporción imagen/texto: los filtros anti-spam castigan el correo "solo imagen".
  const texto = all
    .filter((b) => ['text', 'heading', 'imageText', 'textImage', 'textButton', 'buttonTextRow'].includes(b.type))
    .map((b) => richToPlain(blockContentHtml(b.text, b.rich)))
    .join(' ')
    .trim();
  if (imgBlocks.length > 0 && texto.length < 120) {
    issues.push({
      level: 'warning',
      title: 'Muy poco texto frente a las imágenes',
      detail: 'Los filtros anti-spam penalizan los correos que son casi solo imagen. Agrega texto real (no dentro de la imagen).',
    });
  }

  if (!settings.preheader.trim()) {
    issues.push({
      level: 'info',
      title: 'Sin texto de vista previa',
      detail: 'Es la línea que se ve junto al asunto en la bandeja. Sin ella, el cliente de correo muestra el primer texto que encuentre, que suele quedar mal.',
    });
  }

  if (!settings.darkMode) {
    issues.push({
      level: 'info',
      title: 'Modo oscuro desactivado',
      detail: 'Sin reglas para modo oscuro, Apple Mail y Outlook invierten los colores por su cuenta y el contraste suele romperse.',
    });
  }

  const vars = usedVariables(html).filter((v) => !['unsubscribeUrl', 'preferencesUrl'].includes(v));
  const sinRespaldo = vars.filter((v) => !html.includes(`{{#if ${v}}}`));
  if (sinRespaldo.length) {
    issues.push({
      level: 'info',
      title: 'Variables sin valor por defecto',
      detail: `${sinRespaldo.map((v) => `{{${v}}}`).join(', ')} — si el dato viene vacío en la base, queda un hueco ("Hola ,"). Puedes darles un respaldo desde el menú Variable.`,
    });
  }

  const rawHtml = all.filter((b) => b.type === 'html' && b.text.trim());
  if (rawHtml.length) {
    issues.push({
      level: 'info',
      title: `${rawHtml.length} bloque(s) de HTML crudo`,
      detail: 'Se sanean (se quitan script, iframe y manejadores de evento), pero su maquetación no se valida: revisa la vista previa en móvil.',
    });
  }

  return issues;
}

/** Tamaño del correo generado, en bytes. */
export const htmlBytes = (html: string): number => new TextEncoder().encode(html).length;
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
