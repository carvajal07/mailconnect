import { Ellipse, Line, Rect } from 'react-konva';
import type { Draft } from './useCanvasDraw';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  draft: Draft;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

const STROKE = 'oklch(0.68 0.19 235)'; // --sel
const DASH = [4, 4];

/**
 * Previsualización "fantasma" del elemento que se está dibujando.
 * Se pinta en la misma capa que los elementos, pero no es interactivo.
 */
export default function DraftOverlay({ draft, zoom, offsetX, offsetY }: Props) {
  const s = MM_TO_PX * zoom;

  if (draft.tool === 'frame') {
    const x = Math.min(draft.startMm.x, draft.currentMm.x);
    const y = Math.min(draft.startMm.y, draft.currentMm.y);
    const w = Math.abs(draft.currentMm.x - draft.startMm.x);
    const h = Math.abs(draft.currentMm.y - draft.startMm.y);
    return (
      <Rect
        x={offsetX + x * s}
        y={offsetY + y * s}
        width={w * s}
        height={h * s}
        fill="rgba(37,99,235,0.06)"
        stroke="#2563eb"
        strokeWidth={1.5}
        dash={[6, 3]}
        listening={false}
      />
    );
  }

  if (draft.tool === 'rect' || draft.tool === 'circle' || draft.tool === 'text') {
    const end = applyConstrainIfNeeded(draft);
    const x = Math.min(draft.startMm.x, end.x);
    const y = Math.min(draft.startMm.y, end.y);
    const w = Math.abs(end.x - draft.startMm.x);
    const h = Math.abs(end.y - draft.startMm.y);
    const absX = offsetX + x * s;
    const absY = offsetY + y * s;
    const absW = w * s;
    const absH = h * s;

    if (draft.tool === 'rect' || draft.tool === 'text') {
      return (
        <Rect
          x={absX}
          y={absY}
          width={absW}
          height={absH}
          fill="transparent"
          stroke={STROKE}
          strokeWidth={1}
          dash={DASH}
          listening={false}
        />
      );
    }
    return (
      <Ellipse
        x={absX + absW / 2}
        y={absY + absH / 2}
        radiusX={absW / 2}
        radiusY={absH / 2}
        fill="transparent"
        stroke={STROKE}
        strokeWidth={1}
        dash={DASH}
        listening={false}
      />
    );
  }

  if (draft.tool === 'line') {
    const end = applyConstrainIfNeeded(draft);
    return (
      <Line
        x={offsetX}
        y={offsetY}
        points={[draft.startMm.x * s, draft.startMm.y * s, end.x * s, end.y * s]}
        stroke={STROKE}
        strokeWidth={1}
        dash={DASH}
        lineCap="round"
        listening={false}
      />
    );
  }

  if (draft.tool === 'pen') {
    const pts = (draft.pointsMm ?? []).flatMap((p) => [p.x * s, p.y * s]);
    return (
      <Line
        x={offsetX}
        y={offsetY}
        points={pts}
        stroke={STROKE}
        strokeWidth={1}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
    );
  }

  return null;
}

function applyConstrainIfNeeded(draft: Draft): { x: number; y: number } {
  if (!draft.constrain) return draft.currentMm;
  const dx = draft.currentMm.x - draft.startMm.x;
  const dy = draft.currentMm.y - draft.startMm.y;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: draft.startMm.x + Math.sign(dx || 1) * d,
    y: draft.startMm.y + Math.sign(dy || 1) * d,
  };
}
