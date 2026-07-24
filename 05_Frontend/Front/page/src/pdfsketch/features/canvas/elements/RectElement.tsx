import { Rect } from 'react-konva';
import type Konva from 'konva';
import type { RectEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';
import { konvaFillProps } from '@/utils/konvaFill';

interface Props {
  el: RectEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<RectEl>) => void;
  draggable: boolean;
}

export default function RectElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  // El interior SIEMPRE intercepta el mouse, incluso sin relleno: seleccionar con
  // un clic en cualquier parte de la caja gana sobre "marquee dentro de la forma
  // hueca" (petición de UX; el Canvas ya no arranca el marquee sobre un elemento).
  return (
    <Rect
      id={el.id}
      name="pdfsketch-element"
      x={el.x * s}
      y={el.y * s}
      width={el.width * s}
      height={el.height * s}
      rotation={el.rotation}
      {...konvaFillProps(el.fill, el.fillGradient, el.opacity, el.width * s, el.height * s)}
      stroke={el.stroke}
      strokeWidth={el.strokeWidth * s}
      cornerRadius={el.cornerRadius * s}
      dash={el.dash?.map((v) => v * s)}
      dashEnabled={!!el.dash?.length}
      visible={el.visible}
      hitStrokeWidth={Math.max(10, el.strokeWidth * s + 6)}
      draggable={draggable && !el.locked}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onChange({ x: node.x() / s, y: node.y() / s });
      }}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Rect;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x() / s,
          y: node.y() / s,
          width: Math.max(1, (node.width() * scaleX) / s),
          height: Math.max(1, (node.height() * scaleY) / s),
          rotation: node.rotation(),
        });
      }}
    />
  );
}
