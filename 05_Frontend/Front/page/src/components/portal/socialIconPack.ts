/**
 * PAQUETE DE ICONOS de redes sociales: los logos REALES, recoloreados en el navegador.
 *
 * Los PNG de `public/social-icons/` son **máscaras alfa**: la silueta del logo en negro
 * sólido sobre fondo transparente. Eso es justo lo que permite teñirlos a cualquier color
 * con un `canvas` (`globalCompositeOperation: 'source-in'` conserva la forma y reemplaza
 * el color), en vez de estar atados al negro del archivo original.
 *
 * ⚠️ **Por qué se genera una IMAGEN y no se recolorea en el correo:** un cliente de correo
 * no aplica `filter`/`mask` de CSS (Gmail los elimina), así que el color TIENE que quedar
 * horneado en el archivo. Y tiene que ser una imagen porque el correo tampoco admite SVG
 * en línea ni `data:` URI. El PNG resultante se sube al bucket del PROPIO cliente: si se
 * enlazara un CDN ajeno, el día que ese dominio caiga quedarían rotos TODOS los correos ya
 * enviados (justo lo que pasó con `via.placeholder.com`).
 *
 * Se renderiza a 3× del tamaño en el que se muestra, para que se vea nítido en pantallas
 * de alta densidad (el correo lo escala con los atributos `width`/`height`).
 */

import type { SocialLinks, SocialShape } from './htmlBuilder';

/** Escala de render respecto al tamaño lógico de la insignia (nitidez en retina). */
const SCALE = 3;

export interface IconPackStyle {
  /** Color del logo. */
  glyph: string;
  /** Color de la insignia de fondo; vacío/undefined = sin fondo (solo el logo). */
  background?: string;
  /** Forma del fondo (se ignora si no hay fondo). */
  shape?: SocialShape;
  /** Tamaño lógico de la insignia en px. */
  size: number;
}

export const DEFAULT_ICON_PACK: IconPackStyle = {
  glyph: '#ffffff',
  background: '#16233f',
  shape: 'rounded',
  size: 34,
};

/** Ruta del PNG original de una red (servido por el propio front, mismo origen). */
export const iconSource = (network: keyof SocialLinks): string => `/social-icons/${network}.png`;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar el icono ${src}`));
    img.src = src;
  });

/** Rectángulo con esquinas redondeadas (no todos los navegadores traen `roundRect`). */
const roundedPath = (ctx: CanvasRenderingContext2D, s: number, r: number) => {
  const radio = Math.min(r, s / 2);
  ctx.beginPath();
  ctx.moveTo(radio, 0);
  ctx.lineTo(s - radio, 0);
  ctx.quadraticCurveTo(s, 0, s, radio);
  ctx.lineTo(s, s - radio);
  ctx.quadraticCurveTo(s, s, s - radio, s);
  ctx.lineTo(radio, s);
  ctx.quadraticCurveTo(0, s, 0, s - radio);
  ctx.lineTo(0, radio);
  ctx.quadraticCurveTo(0, 0, radio, 0);
  ctx.closePath();
};

/**
 * Dibuja el icono de una red con los colores pedidos y devuelve el canvas.
 * Exportada aparte de `renderIconBlob` para poder pintar la vista previa sin generar
 * un archivo por cada tecla que se toca en el selector de color.
 */
export async function renderIconCanvas(
  network: keyof SocialLinks,
  style: IconPackStyle,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(iconSource(network));
  const s = Math.round(style.size * SCALE);

  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite generar los iconos (canvas 2d).');

  if (style.background) {
    ctx.fillStyle = style.background;
    if (style.shape === 'square') {
      ctx.fillRect(0, 0, s, s);
    } else if (style.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      roundedPath(ctx, s, s * 0.26);
      ctx.fill();
    }
  }

  // Aire alrededor del logo SOLO si va sobre una insignia: suelto se ve mejor a sangre.
  const margen = style.background ? Math.round(s * 0.22) : 0;
  const interior = s - margen * 2;

  // El teñido va en un canvas aparte: `source-in` sobre el canvas final borraría el fondo.
  const capa = document.createElement('canvas');
  capa.width = s;
  capa.height = s;
  const cctx = capa.getContext('2d');
  if (!cctx) throw new Error('El navegador no permite generar los iconos (canvas 2d).');
  cctx.drawImage(img, margen, margen, interior, interior);
  // Conserva el ALFA (la silueta del logo) y reemplaza el color por el elegido.
  cctx.globalCompositeOperation = 'source-in';
  cctx.fillStyle = style.glyph;
  cctx.fillRect(0, 0, s, s);

  ctx.drawImage(capa, 0, 0);
  return canvas;
}

/** Vista previa (data URI). NO sirve para el correo: Gmail bloquea los `data:`. */
export async function renderIconPreview(network: keyof SocialLinks, style: IconPackStyle): Promise<string> {
  return (await renderIconCanvas(network, style)).toDataURL('image/png');
}

/** Archivo PNG listo para subir al bucket del cliente. */
export async function renderIconFile(network: keyof SocialLinks, style: IconPackStyle): Promise<File> {
  const canvas = await renderIconCanvas(network, style);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('No se pudo generar el archivo del icono.');
  // Nombre estable por (red + estilo): re-aplicar el MISMO estilo reescribe el objeto en
  // vez de dejar una copia nueva en el bucket cada vez que se toca el color.
  const firma = [style.glyph, style.background || 'none', style.shape || 'circle', style.size]
    .join('-').replace(/[^a-z0-9-]/gi, '');
  return new File([blob], `social-${network}-${firma}.png`, { type: 'image/png' });
}
