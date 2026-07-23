import { Line } from 'react-konva';
import type Konva from 'konva';
import type { LineEl, PenEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';

interface Props<T extends LineEl | PenEl> {
  el: T;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<T>) => void;
  draggable: boolean;
}

/** Renderiza tanto `LineEl` (tension 0) como `PenEl` (tension > 0). */
export default function LineLikeElement<T extends LineEl | PenEl>({
  el,
  zoom,
  onSelect,
  onChange,
  draggable,
}: Props<T>) {
  const s = MM_TO_PX * zoom;
  const pointsPx = el.points.map((v) => v * s);
  const tension = (el as PenEl).tension ?? 0;

  return (
    <Line
      id={el.id}
      name="pdfsketch-element"
      x={el.x * s}
      y={el.y * s}
      points={pointsPx}
      rotation={el.rotation}
      stroke={el.stroke}
      strokeWidth={Math.max(1, el.strokeWidth * s)}
      tension={tension}
      dash={el.type === 'line' ? (el as LineEl).dash : undefined}
      visible={el.visible}
      lineCap="butt"
      lineJoin="miter"
      draggable={draggable && !el.locked}
      hitStrokeWidth={Math.max(6, el.strokeWidth * s + 4)}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onChange({ x: node.x() / s, y: node.y() / s } as Partial<T>);
      }}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Line;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const scaled = el.points.map((v, i) => v * (i % 2 === 0 ? scaleX : scaleY));
        const xs = scaled.filter((_, i) => i % 2 === 0);
        const ys = scaled.filter((_, i) => i % 2 === 1);
        onChange({
          x: node.x() / s,
          y: node.y() / s,
          points: scaled,
          width: Math.max(0.5, Math.max(...xs) - Math.min(...xs)),
          height: Math.max(0.5, Math.max(...ys) - Math.min(...ys)),
          rotation: node.rotation(),
        } as Partial<T>);
      }}
    />
  );
}
