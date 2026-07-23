import { Rect, Group } from 'react-konva';
import type { Page } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  page: Page;
  zoom: number;
  /** offset del Stage (pan). */
  offsetX: number;
  offsetY: number;
}

/**
 * Hoja blanca del documento con sombra ligera. El tamaño en px se
 * calcula con MM_TO_PX * zoom.
 */
export default function Sheet({ page, zoom, offsetX, offsetY }: Props) {
  const w = page.size.width * MM_TO_PX * zoom;
  const h = page.size.height * MM_TO_PX * zoom;

  return (
    <Group x={offsetX} y={offsetY}>
      {/* sombra simulada con un rect más oscuro detrás */}
      <Rect
        x={4}
        y={6}
        width={w}
        height={h}
        fill="rgba(0,0,0,0.45)"
        cornerRadius={0}
        listening={false}
      />
      {/* hoja */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={page.background || '#fbfbf8'}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={1}
        listening={false}
      />
    </Group>
  );
}
