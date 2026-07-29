import { useEffect, useState } from 'react';
import {
  SOCIAL_NETWORKS, socialBgFor, socialGlyphFor,
  type Block, type SocialLinks,
} from './htmlBuilder';
import { renderIconPreview } from './socialIconPack';

/**
 * Logos de redes RECOLOREADOS para verlos mientras se edita, como `data:` URI.
 *
 * ⚠️ Estos `data:` URI sirven SOLO en el navegador: Gmail los bloquea, así que no pueden
 * viajar en el correo. Los archivos de verdad se generan y se suben al bucket del cliente
 * al PUBLICAR — mientras se está eligiendo el color no tiene sentido dejar un PNG huérfano
 * en S3 por cada ajuste.
 *
 * La clave del mapa es `bloque:red` porque cada bloque de redes puede tener su propio
 * estilo, y la firma del estilo entra en las dependencias para regenerar solo cuando algo
 * que afecta al dibujo cambió (no en cada tecla que se escribe en otro bloque).
 */
export type SocialPreviewMap = Record<string, string>;

export const previewKey = (blockId: string, network: keyof SocialLinks) => `${blockId}:${network}`;

/** Redes de un bloque que tienen enlace: solo esas se dibujan. */
export const activeNetworks = (b: Block): (keyof SocialLinks)[] =>
  SOCIAL_NETWORKS.filter((n) => {
    const v = b.links?.[n.key];
    return v && String(v).trim() && v !== 'https://';
  }).map((n) => n.key);

/** Bloques de redes en cualquier nivel (incluidos los anidados en columnas). */
const socialBlocks = (list: Block[]): Block[] =>
  list.flatMap((b) => [
    ...(b.type === 'social' ? [b] : []),
    ...(b.cols || []).flatMap(socialBlocks),
  ]);

/** Firma de lo que afecta al DIBUJO de los iconos de un bloque. */
const styleSignature = (b: Block): string => [
  b.id, b.socialStyle, b.socialColor, b.socialShape, b.socialSize, b.socialBadge, b.socialGlyph,
  activeNetworks(b).join(','),
].join('|');

export const useSocialPreviews = (blocks: Block[]): SocialPreviewMap => {
  const [map, setMap] = useState<SocialPreviewMap>({});
  const bloques = socialBlocks(blocks);
  const firma = bloques.map(styleSignature).join('||');

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const out: SocialPreviewMap = {};
      for (const b of bloques) {
        for (const red of activeNetworks(b)) {
          // Un icono subido a mano gana: no hay nada que recolorear.
          const propio = b.icons?.[red];
          if (propio) { out[previewKey(b.id, red)] = propio; continue; }
          const color = SOCIAL_NETWORKS.find((n) => n.key === red)?.color || '#0075be';
          try {
            out[previewKey(b.id, red)] = await renderIconPreview(red, {
              glyph: socialGlyphFor(b, color),
              background: b.socialBadge === false ? '' : socialBgFor(b, color),
              shape: b.socialShape || 'circle',
              size: b.socialSize ?? 34,
            });
          } catch { /* sin icono: el generador cae a la insignia de respaldo */ }
        }
      }
      if (!cancelado) setMap(out);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  return map;
};

/**
 * Devuelve los bloques con `icons` rellenos con las vistas previas, para que el LIENZO y la
 * VISTA PREVIA muestren los logos reales antes de publicar. No toca el estado: es una copia
 * de solo lectura para pintar.
 */
export const withPreviewIcons = (blocks: Block[], previews: SocialPreviewMap): Block[] =>
  blocks.map((b) => {
    const cols = b.cols?.length ? b.cols.map((c) => withPreviewIcons(c, previews)) : b.cols;
    if (b.type !== 'social') return cols === b.cols ? b : { ...b, cols };
    const icons = { ...(b.icons || {}) };
    for (const red of activeNetworks(b)) {
      const p = previews[previewKey(b.id, red)];
      if (p) icons[red] = p;
    }
    return { ...b, icons, cols };
  });
