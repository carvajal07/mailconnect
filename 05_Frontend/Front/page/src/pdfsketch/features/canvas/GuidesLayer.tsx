import { Group, Rect } from 'react-konva';
import type { Page } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  page: Page;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Capa de guías visuales: dibuja un rectángulo punteado en los límites
 * de cada elemento para indicar su tamaño en el lienzo.
 * No se muestra en la vista previa PDF ni en el export.
 */
export default function GuidesLayer({ page, zoom, offsetX, offsetY }: Props) {
  const s = MM_TO_PX * zoom;

  return (
    <Group x={offsetX} y={offsetY} listening={false}>
      {page.elements.map((el) => (
        <Rect
          key={el.id}
          x={el.x * s}
          y={el.y * s}
          width={el.width * s}
          height={el.height * s}
          rotation={el.rotation}
          fill="transparent"
          stroke="rgba(144,39,116,0.72)"
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[4, 3]}
          listening={false}
        />
      ))}
    </Group>
  );
}
