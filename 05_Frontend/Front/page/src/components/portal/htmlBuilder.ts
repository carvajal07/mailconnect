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
  | 'products'   // grilla de productos (imagen + título + texto + enlace)
  | 'video';     // miniatura enlazada al vídeo (el correo no puede reproducirlo)

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  x?: string;
  linkedin?: string;
  youtube?: string;
  tiktok?: string;
  whatsapp?: string;
  telegram?: string;
  website?: string;
}

/**
 * Redes soportadas, con su color de marca y la inicial de la INSIGNIA.
 *
 * La INSIGNIA (tabla + color de fondo + la inicial) es el respaldo que no depende de
 * nadie: pesa 0 y se ve igual en todos los clientes. Para los **logos reales** está el
 * paquete de iconos (`socialIconPack.ts`), que recolorea los PNG del repo en el navegador
 * y los sube al bucket del PROPIO cliente — nunca a un CDN ajeno, que es lo que dejaría
 * rotos TODOS los correos ya enviados el día que ese dominio caiga (`via.placeholder.com`).
 */
export const SOCIAL_NETWORKS: { key: keyof SocialLinks; label: string; color: string; initial: string }[] = [
  { key: 'facebook', label: 'Facebook', color: '#1877F2', initial: 'f' },
  { key: 'instagram', label: 'Instagram', color: '#E4405F', initial: 'ig' },
  { key: 'x', label: 'X', color: '#000000', initial: 'X' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', initial: 'in' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', initial: '▶' },
  { key: 'tiktok', label: 'TikTok', color: '#010101', initial: '♪' },
  { key: 'whatsapp', label: 'WhatsApp', color: '#25D366', initial: 'wa' },
  { key: 'telegram', label: 'Telegram', color: '#229ED9', initial: 'tg' },
  { key: 'website', label: 'Sitio web', color: '#0075be', initial: '🌐' },
];

/**
 * Estilo del bloque de redes:
 *  - `badge` — cada red con SU color de marca (Facebook azul, Instagram rosa…).
 *  - `mono`  — todas del MISMO color, el que elija el cliente (`socialColor`). Es lo que
 *              pide un manual de marca serio: los colores ajenos rompen la paleta.
 *  - `text`  — LEGADO: enlaces de texto separados por puntos.
 */
export type SocialStyle = 'badge' | 'mono' | 'text';

/** Color único de las insignias cuando el estilo es `mono`. */
export const DEFAULT_SOCIAL_MONO = '#16233f';

/** Forma de la insignia. `rounded` (cuadrado de esquinas suaves) es el look actual. */
export type SocialShape = 'circle' | 'rounded' | 'square';

/**
 * Radio de la insignia en px. ⚠️ Outlook ignora `border-radius`: ahí TODAS salen
 * cuadradas, que es justo por lo que `square`/`rounded` se ven mejor que el círculo — la
 * diferencia entre lo que ve un usuario de Gmail y uno de Outlook es mucho menor.
 */
export const socialRadius = (size: number, shape?: SocialShape): number => {
  if (shape === 'square') return 0;
  if (shape === 'rounded') return Math.max(4, Math.round(size * 0.26));
  return Math.round(size / 2);
};

export const isHexColor = (v?: string): boolean => /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim());

/**
 * Color monocromático efectivo. El cliente puede pegar el hex de su manual de marca, así
 * que mientras lo escribe el valor está a medias ("#01"): ahí se usa el default en vez de
 * emitir un color inválido al correo.
 */
export const socialMonoColor = (v?: string): string => (isHexColor(v) ? String(v).trim() : DEFAULT_SOCIAL_MONO);

/** Un producto de la grilla `products`. */
export interface ProductItem {
  image: string;
  title: string;
  text: string;
  url?: string;
}

/** Máximo de columnas por fila. Más allá, en móvil cada celda queda inservible y en
 *  Outlook la tabla se desarma. */
export const MAX_COLUMNS = 4;

/**
 * Distribuciones de ancho disponibles POR NÚMERO de columnas. Cada una suma 100.
 * El usuario elige primero cuántas columnas (1-4) y luego la proporción, que es como
 * funcionan los constructores de correo serios.
 */
export const COLUMN_LAYOUTS: Record<number, number[][]> = {
  1: [[100]],
  2: [[50, 50], [33, 67], [67, 33], [25, 75], [75, 25]],
  3: [[33, 34, 33], [25, 50, 25], [50, 25, 25], [25, 25, 50]],
  4: [[25, 25, 25, 25]],
};

/** Proporciones del modelo VIEJO (se conservan para leer plantillas ya guardadas). */
export type ColumnRatio = '50-50' | '33-67' | '67-33' | '33-33-33';

const LEGACY_RATIOS: Record<ColumnRatio, number[]> = {
  '50-50': [50, 50],
  '33-67': [33, 67],
  '67-33': [67, 33],
  '33-33-33': [33, 34, 33],
};

/** Anchos efectivos de un bloque de columnas: modelo nuevo → legado → 50/50. */
export const columnWidths = (b: Block): number[] => {
  if (b.widths?.length) return b.widths;
  if (b.ratio && LEGACY_RATIOS[b.ratio]) return LEGACY_RATIOS[b.ratio];
  return [50, 50];
};

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
  /** Estilo del bloque de redes: insignias de color (default), monocromáticas o texto. */
  socialStyle?: SocialStyle;
  /** Color de TODAS las insignias cuando el estilo es `mono` (manual de marca del cliente). */
  socialColor?: string;
  /** Forma de la insignia (círculo por defecto; `rounded` es el estilo actual). */
  socialShape?: SocialShape;
  /** Tamaño de la insignia en px. */
  socialSize?: number;
  /** Icono PROPIO por red (URL de una imagen subida por el cliente). Si está, gana. */
  icons?: Partial<Record<keyof SocialLinks, string>>;

  /** El contenido de `text` (y `heading`) es HTML EN LÍNEA, no texto plano. Marca por
   *  bloque: sin ella se escapa como siempre, así que las plantillas viejas no se rompen. */
  rich?: boolean;

  // ── Visibilidad por dispositivo ──
  /** Oculta el bloque en pantallas pequeñas (una imagen enorme solo tiene sentido en
   *  escritorio; un botón compacto, solo en móvil). */
  hideMobile?: boolean;
  /** Oculta el bloque en escritorio. */
  hideDesktop?: boolean;

  // ── Botón ──
  buttonFullWidth?: boolean;  // ancho completo: en móvil es lo que más convierte
  buttonRadius?: number;      // radio de la esquina (px)
  buttonFontSize?: number;
  buttonPadY?: number;
  buttonPadX?: number;

  // ── Vídeo ──
  /** Enlace al vídeo (YouTube, Vimeo o el que sea). */
  videoUrl?: string;
  /** Miniatura propia. Si está vacía y la URL es de YouTube, se deriva de ahí. */
  videoThumb?: string;
  /** Etiqueta del botón de reproducción. */
  videoLabel?: string;

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
  /** Anchos en % (suman 100). Su LONGITUD es el número de columnas (1-4). */
  widths?: number[];
  /** LEGADO: proporción del modelo viejo; `widths` la reemplaza. */
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
  /** Parámetros UTM que se agregan a TODOS los enlaces del correo al generar. Sin esto,
   *  el tráfico del correo llega a Analytics como "directo" y la campaña no se puede medir. */
  utm: { enabled: boolean; source: string; medium: string; campaign: string };
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
  utm: { enabled: false, source: 'mailconnect', medium: 'email', campaign: '' },
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
  video: 'Vídeo',
};

/**
 * Paleta. Los COMBINADOS (imagen+texto, texto+botón…) salieron: eran atajos rígidos que
 * el bloque de COLUMNAS ahora cubre mejor — se elige la distribución y se pone dentro lo
 * que se quiera. Se siguen RENDERIZANDO para no romper las plantillas ya guardadas, pero
 * no se pueden crear nuevos.
 */
export const PALETTE_GROUPS: { label: string; types: BlockType[] }[] = [
  { label: 'Contenido', types: ['heading', 'text', 'image', 'button', 'logo', 'video'] },
  { label: 'Estructura', types: ['columns', 'divider', 'spacer'] },
  { label: 'Avanzado', types: ['social', 'products', 'html'] },
];

/** Tipos que ya no se ofrecen en la paleta pero siguen renderizando (plantillas viejas). */
export const LEGACY_TYPES: BlockType[] = ['imageText', 'textImage', 'textButton', 'buttonTextRow'];

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
    // Nacen VACÍAS: el lienzo muestra un "+" por columna para poner lo que se quiera.
    // Antes venían con dos bloques de texto que casi siempre había que borrar.
    case 'columns':
      return { ...b, widths: [50, 50], cols: [[], []] };
    case 'social':
      // Nace VACÍO: una insignia con enlace 'https://' no lleva a ningún lado y el
      // chequeo previo la marcaría como enlace sin destino.
      return { ...b, align: 'center', links: {}, socialStyle: 'badge', socialSize: 34 };
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
    case 'video':
      return { ...b, align: 'center', videoUrl: '', videoThumb: '', videoLabel: 'Ver el vídeo', color: '#0075be' };
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
  const radius = b.buttonRadius ?? 6;
  const fs = b.buttonFontSize ?? 15;
  const py = b.buttonPadY ?? 12;
  const px = b.buttonPadX ?? 26;
  // Ancho completo: en móvil es lo que más convierte (el dedo no tiene que apuntar).
  const full = b.buttonFullWidth;
  const tableAttrs = full
    ? 'width="100%" style="width:100%;"'
    : `style="margin:${alignAttr === 'center' ? '0 auto' : '0'}"`;
  const anchorDisplay = full ? 'display:block;' : 'display:inline-block;';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" ${tableAttrs}><tr>
        <td align="center" bgcolor="${bg}" style="border-radius:${radius}px;">
          <a href="${esc(b.url)}" target="_blank" style="${anchorDisplay}padding:${py}px ${px}px;font-family:${st.fontFamily};font-size:${fs}px;font-weight:bold;line-height:1;color:#ffffff;text-decoration:none;border-radius:${radius}px;mso-padding-alt:0;">
            <!--[if mso]>&nbsp;&nbsp;<![endif]-->${richToPlain(content(b)) || esc(b.text)}<!--[if mso]>&nbsp;&nbsp;<![endif]-->
          </a>
        </td>
      </tr></table>`;
}

function socialRow(b: Block, st: EmailSettings): string {
  const links = b.links || {};
  const size = b.socialSize || 34;
  const style: SocialStyle = b.socialStyle || 'badge';

  const activos = SOCIAL_NETWORKS.filter((n) => {
    const v = links[n.key];
    return v && String(v).trim() && v !== 'https://';
  });
  if (!activos.length) return '';

  // La alineación del bloque manda: antes iba clavada a `center` y los botones de
  // izquierda/derecha del panel no hacían nada.
  const align = b.align || 'center';

  // LEGADO: enlaces de texto separados por puntos.
  if (style === 'text') {
    const items = activos.map((n) =>
      `<a href="${esc(String(links[n.key]))}" target="_blank" style="color:${st.linkColor};text-decoration:none;font-family:${st.fontFamily};font-size:14px">${n.label}</a>`);
    return `<p style="margin:0;text-align:${align}">${items.join(' &nbsp;·&nbsp; ')}</p>`;
  }

  // Insignias: una celda por red. `border-radius` lo ignora Outlook (queda cuadrada,
  // que se ve bien igual); el color de fondo sí lo respeta.
  const radio = socialRadius(size, b.socialShape);
  const celdas = activos.map((n) => {
    const href = esc(String(links[n.key]));
    const propio = b.icons?.[n.key];
    // En `mono` todas comparten el color elegido por el cliente; en `badge`, el de cada marca.
    const color = style === 'mono' ? socialMonoColor(b.socialColor) : n.color;
    const contenido = propio
      ? `<img src="${esc(propio)}" alt="${esc(n.label)}" width="${size}" height="${size}" style="display:block;width:${size}px;height:${size}px;border:0;border-radius:${radio}px;" />`
      : `<a href="${href}" target="_blank" style="display:block;width:${size}px;height:${size}px;line-height:${size}px;text-align:center;font-family:${st.fontFamily};font-size:${Math.round(size * 0.42)}px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(n.initial)}</a>`;
    const bg = propio ? '' : ` bgcolor="${color}"`;
    const bgStyle = propio ? '' : `background-color:${color};`;
    return `<td style="padding:0 5px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td${bg} style="${bgStyle}border-radius:${radio}px;" width="${size}" height="${size}" align="center" valign="middle">${propio ? `<a href="${href}" target="_blank" style="display:block;text-decoration:none;">${contenido}</a>` : contenido}</td></tr></table></td>`;
  });

  // ⚠️ `align` NO puede ir en esta tabla: por la especificación de HTML,
  // `<table align="left|right">` se renderiza como **float**, que saca la fila del flujo
  // → el contenedor del bloque colapsa (en el lienzo se veía como una franja delgada con
  // los iconos por fuera) y en el correo el bloque siguiente se le sube al lado. Se alinea
  // desde una tabla ENVOLVENTE con `align` en el `td` (lo que respeta Outlook) + el margen
  // de la tabla interna para el resto de clientes. `align="center"` sí sería seguro (mapea
  // a `margin:auto`, no a float), pero se trata igual para no tener dos caminos.
  const margen = align === 'center' ? 'margin:0 auto;' : align === 'right' ? 'margin:0 0 0 auto;' : 'margin:0;';
  const fila = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${margen}"><tr>${celdas.join('')}</tr></table>`;
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="${align}">${fila}</td></tr></table>`;
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


/** Id del vídeo si la URL es de YouTube (para derivar la miniatura). */
export const youtubeId = (url: string): string | null => {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(String(url || ''));
  return m ? m[1] : null;
};

/** Miniatura efectiva del bloque de vídeo: la propia, o la de YouTube si se puede derivar. */
export const videoThumbnail = (b: Block): string => {
  if (b.videoThumb && b.videoThumb.trim()) return b.videoThumb;
  const id = youtubeId(b.videoUrl || '');
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
};

/**
 * Bloque de VÍDEO: miniatura clicable + botón de reproducción debajo.
 *
 * ⚠️ Ningún cliente de correo reproduce vídeo embebido (Gmail y Outlook eliminan
 * `<video>` e `<iframe>`), así que lo que se envía SIEMPRE es una imagen que lleva al
 * vídeo. El botón va DEBAJO y no superpuesto: superponer exige `background` en el `td`,
 * que en Outlook necesita VML y se rompe con facilidad; un botón aparte funciona en todos.
 */
function videoHtml(b: Block, st: EmailSettings, innerW: number): string {
  const thumb = videoThumbnail(b);
  const href = b.videoUrl && b.videoUrl.trim() ? b.videoUrl : '';
  if (!thumb || !href) return '';
  const img = imageHtml(thumb, richToPlain(content(b)) || 'Ver el vídeo', b.align || 'center',
                        b.imageWidth || innerW, href, b.imageRadius);
  const boton = buttonHtml(
    { ...b, type: 'button', rich: false, text: b.videoLabel || 'Ver el vídeo', url: href, align: 'center' },
    st,
  );
  return `${img}<div style="padding-top:12px;">${boton}</div>`;
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
  const widths = columnWidths(b);
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

/**
 * Serializa un bloque a HTML email-safe y responsive.
 *
 * Se EXPORTA a propósito: el lienzo del editor dibuja este mismo HTML en vez de tener su
 * propia implementación en React. Antes había dos renderizadores (uno para el correo y
 * otro para el lienzo) que divergían en silencio — el relleno y el fondo por bloque
 * salían en el correo pero no se veían al editar, y nada lo detectaba.
 */
export function renderBlock(b: Block, st: EmailSettings, widthOverride?: number): string {
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
      return socialRow(b, st);
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
    case 'video':
      return videoHtml(b, st, innerW);
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


/**
 * Agrega los parámetros UTM a los enlaces http(s) del correo.
 *
 * Se hace sobre el HTML YA generado (no al escribir el enlace) para que el usuario vea y
 * edite su URL limpia, y para que cambiar la campaña re-etiquete todo de una vez. Se
 * respetan los que ya estén puestos a mano: si el enlace trae `utm_source`, no se pisa.
 *
 * NO se tocan: las variables de plantilla (`{{unsubscribeUrl}}`, que el motor reemplaza
 * por una URL firmada — meterle parámetros la rompería), ni `mailto:`/`tel:`/anclas.
 */
function applyUtm(html: string, utm: EmailSettings['utm']): string {
  if (!utm?.enabled) return html;
  const params: [string, string][] = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
  ].filter(([, v]) => v && String(v).trim()) as [string, string][];
  if (!params.length) return html;

  return html.replace(/href="([^"]+)"/g, (full, url: string) => {
    if (!/^https?:\/\//i.test(url)) return full;      // variables, mailto, tel, anclas
    if (/[?&]utm_source=/i.test(url)) return full;      // ya etiquetado a mano
    const faltantes = params.filter(([k]) => !new RegExp(`[?&]${k}=`, 'i').test(url));
    if (!faltantes.length) return full;
    const sep = url.includes('?') ? '&' : '?';
    const qs = faltantes.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `href="${url}${sep}${qs}"`;
  });
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
        // Visibilidad por dispositivo. `mc-hide-mobile` se apaga con la media query;
        // `mc-hide-desktop` nace oculto y la media query lo enciende — al revés no
        // funciona en los clientes que ignoran las media queries (verían ambos).
        const vis = [b.hideMobile ? 'mc-hide-mobile' : '', b.hideDesktop ? 'mc-hide-desktop' : ''].filter(Boolean).join(' ');
        const hidden = b.hideDesktop
          ? 'display:none;max-height:0;overflow:hidden;mso-hide:all;'
          : '';
        return `            <tr class="${vis}"><td align="${b.align || 'left'}"${bg} class="mc-pad mc-row ${vis}" style="${hidden}${bgStyle}padding:${padY}px ${padX}px;">${renderBlock(b, st)}</td></tr>`;
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

  const doc = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
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
      .mc-hide-mobile { display:none !important; max-height:0 !important; overflow:hidden !important; }
      .mc-hide-desktop { display:block !important; max-height:none !important; overflow:visible !important; }
      tr.mc-hide-desktop { display:table-row !important; }
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

  // Los UTM se agregan al FINAL, sobre el HTML ya armado: así el usuario ve y edita su
  // URL limpia, y cambiar la campaña re-etiqueta todos los enlaces de una vez.
  return applyUtm(doc, st.utm);
}

// ───────────────────────── Alternativa de TEXTO PLANO ─────────────────────────

/**
 * Versión en TEXTO PLANO del correo (la `TextPart` de la plantilla SES).
 *
 * Por qué importa: los filtros anti-spam comparan la parte HTML con la de texto. Si la
 * de texto va vacía, con etiquetas dentro o sin el enlace de baja, el correo se penaliza
 * — y eso no aparece en ningún reporte, solo en la reputación.
 *
 * Antes se armaba con `blocks.filter(text|heading).map(b => b.text)`, que desde el texto
 * enriquecido emitía HTML crudo, ignoraba botones/columnas/productos (un correo hecho a
 * base de columnas quedaba con el texto VACÍO) y no incluía `{{unsubscribeUrl}}`.
 */
export function generatePlainText(blocks: Block[], settings: EmailSettings = DEFAULT_SETTINGS): string {
  const lines: string[] = [];

  if (settings.preheader.trim()) {
    lines.push(settings.preheader.trim(), '');
  }

  const plain = (b: Block, field: 'text' | 'heading' = 'text') =>
    richToPlain(blockContentHtml(field === 'text' ? b.text : b.heading || '', b.rich)).trim();

  const walk = (list: Block[]) => {
    for (const b of list) {
      switch (b.type) {
        case 'heading': {
          const t = plain(b);
          // Se subraya el encabezado: en texto plano es la única forma de jerarquía.
          if (t) lines.push(t, '='.repeat(Math.min(t.length, 60)), '');
          break;
        }
        case 'text': {
          const t = plain(b);
          if (t) lines.push(t, '');
          break;
        }
        // El botón sin su URL es inútil en texto plano: el destinatario no puede hacer clic.
        case 'button': {
          const label = plain(b) || 'Ver más';
          if (b.url && b.url !== 'https://') lines.push(`${label}: ${b.url}`, '');
          break;
        }
        case 'image':
        case 'logo': {
          const alt = plain(b);
          if (alt && b.url) lines.push(`[${alt}]`, '');
          break;
        }
        case 'imageText':
        case 'textImage':
        case 'textButton':
        case 'buttonTextRow': {
          const h = plain(b, 'heading');
          const t = plain(b);
          if (h) lines.push(h, '');
          if (t) lines.push(t, '');
          if (b.buttonText && b.buttonUrl && b.buttonUrl !== 'https://') {
            lines.push(`${b.buttonText}: ${b.buttonUrl}`, '');
          }
          break;
        }
        // El vídeo en texto plano es su ENLACE: sin él, quien lee la parte de texto no
        // tiene forma de llegar al vídeo (la miniatura no existe ahí).
        case 'video': {
          if (b.videoUrl && b.videoUrl.trim()) {
            lines.push(`${b.videoLabel || 'Ver el vídeo'}: ${b.videoUrl.trim()}`, '');
          }
          break;
        }
        case 'products': {
          for (const it of b.items || []) {
            const partes = [it.title, it.text].filter(Boolean).join(' — ');
            if (partes) lines.push(it.url ? `${partes}: ${it.url}` : partes);
          }
          if ((b.items || []).length) lines.push('');
          break;
        }
        case 'social': {
          const redes = Object.entries(b.links || {})
            .filter(([, v]) => v && String(v).trim() && v !== 'https://')
            .map(([k, v]) => `${k}: ${v}`);
          if (redes.length) lines.push(...redes, '');
          break;
        }
        case 'columns': {
          // Las columnas se aplanan en orden de lectura: en texto plano no hay columnas.
          const cols = b.cols?.length
            ? b.cols
            : [[{ ...b, type: 'text' as BlockType, cols: undefined }],
               [{ ...b, type: 'text' as BlockType, text: b.textRight, cols: undefined }]];
          for (const col of cols) walk(col);
          break;
        }
        case 'divider':
          lines.push('—'.repeat(40), '');
          break;
        case 'html': {
          const t = richToPlain(sanitizeBlockHtml(b.text)).trim();
          if (t) lines.push(t, '');
          break;
        }
        default:
          break;   // espaciador y demás no aportan nada al texto
      }
    }
  };
  walk(blocks);

  // Pie obligatorio: sin el enlace de baja en la parte de texto, esa versión del correo
  // incumple lo mismo que el HTML sí cumple.
  lines.push(
    '—'.repeat(40),
    'Recibes este correo porque estás suscrito a nuestras comunicaciones.',
    'Administrar preferencias: {{preferencesUrl}}',
    'Cancelar suscripción: {{unsubscribeUrl}}',
  );

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ───────────────────────── Chequeo previo (entregabilidad) ─────────────────────────


/**
 * Palabras y patrones que los filtros anti-spam puntúan alto. No es una lista de
 * prohibidas —una promoción legítima usa "descuento"— sino de señales que, ACUMULADAS,
 * mandan el correo a Promociones o a spam.
 */
const SPAM_WORDS = [
  'gratis', 'grátis', '100% gratis', 'sin costo', 'garantizado', 'garantizada',
  'urgente', 'actúa ya', 'actua ya', 'última oportunidad', 'ultima oportunidad',
  'oferta limitada', 'gana dinero', 'ingresos extra', 'sin riesgo', 'clic aquí',
  'haz clic aquí', 'compra ahora', 'felicidades', 'ganaste', 'premio', 'viagra',
  'crédito fácil', 'credito facil', 'préstamo', 'prestamo', 'money', 'free',
];

/** Luminancia relativa (WCAG) de un color #rgb / #rrggbb. */
const luminance = (hex: string): number | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Relación de contraste WCAG entre dos colores (1 = idénticos, 21 = negro sobre blanco). */
export const contrastRatio = (fg: string, bg: string): number | null => {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  if (l1 === null || l2 === null) return null;
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

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

  // Un bloque de vídeo sin enlace (o sin miniatura derivable) se OMITE al generar: el
  // cliente creería que envió el vídeo y en la bandeja no habría nada.
  const videoRoto = all.filter((b) => b.type === 'video' && (!b.videoUrl?.trim() || !videoThumbnail(b)));
  if (videoRoto.length) {
    issues.push({
      level: 'error',
      title: `${videoRoto.length} bloque(s) de vídeo sin enlace o miniatura`,
      detail: 'Se omiten al generar el correo. Pega el enlace del vídeo (de YouTube se toma la miniatura sola) o sube una miniatura propia.',
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

  // ── Palabras que disparan los filtros ──
  const enMinusculas = texto.toLowerCase();
  const encontradas = SPAM_WORDS.filter((w) => enMinusculas.includes(w));
  if (encontradas.length >= 2) {
    issues.push({
      level: 'warning',
      title: `${encontradas.length} expresiones que suelen marcar spam`,
      detail: `Aparecen: ${encontradas.slice(0, 6).join(', ')}. Ninguna está prohibida, pero acumuladas mandan el correo a Promociones o a spam. Reescribe las que puedas.`,
    });
  }

  // GRITOS: mayúsculas sostenidas y signos repetidos ("GRATIS!!! OFERTA!!!"). Es de las
  // señales que más puntúan los filtros — más que la palabra en sí, que puede ser legítima.
  // Se mira en el preheader Y EN EL CUERPO: antes solo en el preheader, así que un correo
  // gritando de arriba abajo pasaba el chequeo sin un solo aviso.
  const gritar = (t: string) => {
    // Las variables van en mayúsculas por convención de algunas bases: no son gritos.
    const limpio = t.replace(/\{\{[^}]*\}\}/g, ' ');
    return {
      mayus: (limpio.match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g) || []).length,
      signos: /[!¡]{2,}|[?¿]{2,}/.test(limpio),
    };
  };
  const pre = gritar(settings.preheader);
  const cuerpo = gritar(texto);
  const donde = [
    (pre.mayus >= 1 || pre.signos) && 'el texto de vista previa',
    (cuerpo.mayus >= 2 || cuerpo.signos) && 'el cuerpo del correo',
  ].filter(Boolean);
  if (donde.length) {
    issues.push({
      level: 'warning',
      title: `Mayúsculas sostenidas o signos repetidos en ${donde.join(' y ')}`,
      detail: 'Escribir "GRATIS!!!" o "OFERTA!!!" es de las señales de spam más puntuadas, por encima de la palabra en sí. Usa mayúscula y minúscula normales y un solo signo de admiración.',
    });
  }

  // ── Contraste y legibilidad ──
  const fondo = settings.emailBg;
  const bajoContraste = all.filter((b) => {
    if (!['text', 'heading'].includes(b.type)) return false;
    const color = b.color || (b.type === 'heading' ? '#16233f' : settings.textColor);
    const r = contrastRatio(color, b.bgColor || fondo);
    return r !== null && r < 4.5;      // umbral AA para texto normal
  });
  if (bajoContraste.length) {
    issues.push({
      level: 'warning',
      title: `${bajoContraste.length} bloque(s) con poco contraste`,
      detail: 'El texto no llega a la relación 4.5:1 de WCAG AA sobre su fondo. Se lee mal en pantallas con brillo bajo y penaliza accesibilidad.',
    });
  }

  const chicos = all.filter((b) => (b.type === 'text' && (b.fontSize ?? 15) < 14));
  if (chicos.length) {
    issues.push({
      level: 'warning',
      title: `${chicos.length} bloque(s) con texto menor a 14 px`,
      detail: 'En móvil se vuelve ilegible y iOS lo reescala por su cuenta, lo que suele romper la maquetación.',
    });
  }

  // ── Imágenes de la grilla de productos sin alt ──
  const prodSinAlt = all
    .filter((b) => b.type === 'products')
    .flatMap((b) => b.items || [])
    .filter((it) => it.image && !String(it.title || '').trim());
  if (prodSinAlt.length) {
    issues.push({
      level: 'warning',
      title: `${prodSinAlt.length} producto(s) sin título`,
      detail: 'El título es lo que se usa como texto alternativo de la imagen: con las imágenes bloqueadas, ese producto no se ve NI se lee.',
    });
  }

  // ── Seguimiento ──
  if (!settings.utm?.enabled && /href="https?:\/\//.test(html)) {
    issues.push({
      level: 'info',
      title: 'Enlaces sin UTM',
      detail: 'Sin parámetros UTM, el tráfico de este correo llega a Analytics como "directo" y no vas a poder atribuirle las conversiones.',
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
