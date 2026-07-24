import { Rect, Group, Line } from 'react-konva';
import type { Page } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';
import { useUIStore } from '@/store/uiStore';

interface Props {
  page: Page;
  zoom: number;
  /** offset del Stage (pan). */
  offsetX: number;
  offsetY: number;
}

/** Separación de la grilla en mm. */
const GRID_MM = 10;

/**
 * Hoja blanca del documento con sombra ligera. El tamaño en px se
 * calcula con MM_TO_PX * zoom.
 */
export default function Sheet({ page, zoom, offsetX, offsetY }: Props) {
  const showGrid = useUIStore((s) => s.showGrid);
  const showMargins = useUIStore((s) => s.showMargins);
  const s = MM_TO_PX * zoom;
  const w = page.size.width * s;
  const h = page.size.height * s;

  // Líneas de la grilla (cada GRID_MM, dentro de la hoja).
  const gridLines: number[][] = [];
  if (showGrid) {
    for (let x = GRID_MM; x < page.size.width; x += GRID_MM) {
      const px = x * s;
      gridLines.push([px, 0, px, h]);
    }
    for (let y = GRID_MM; y < page.size.height; y += GRID_MM) {
      const py = y * s;
      gridLines.push([0, py, w, py]);
    }
  }

  const hasMargin =
    page.margin.top > 0 || page.margin.right > 0 || page.margin.bottom > 0 || page.margin.left > 0;

  return (
    <Group x={offsetX} y={offsetY}>
      {/* sombra simulada con un rect más oscuro detrás */}
      <Rect x={4} y={6} width={w} height={h} fill="rgba(0,0,0,0.45)" cornerRadius={0} listening={false} />
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
      {/* grilla */}
      {showGrid && gridLines.map((pts, i) => (
        <Line key={i} points={pts} stroke="rgba(59,130,246,0.22)" strokeWidth={1} listening={false} />
      ))}
      {/* márgenes de la hoja (guía punteada fina, desactivable) */}
      {showMargins && hasMargin && (
        <Rect
          x={page.margin.left * s}
          y={page.margin.top * s}
          width={Math.max(0, w - (page.margin.left + page.margin.right) * s)}
          height={Math.max(0, h - (page.margin.top + page.margin.bottom) * s)}
          stroke="rgba(59,130,246,0.55)"
          strokeWidth={1}
          dash={[3, 2]}
          listening={false}
        />
      )}
    </Group>
  );
}
