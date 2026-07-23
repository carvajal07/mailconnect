import { Ellipse } from 'react-konva';
import type Konva from 'konva';
import type { CircleEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  el: CircleEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<CircleEl>) => void;
  draggable: boolean;
}

export default function CircleElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const rx = (el.width / 2) * s;
  const ry = (el.height / 2) * s;
  return (
    <Ellipse
      id={el.id}
      name="pdfsketch-element"
      x={(el.x + el.width / 2) * s}
      y={(el.y + el.height / 2) * s}
      radiusX={rx}
      radiusY={ry}
      rotation={el.rotation}
      fill={el.fill}
      stroke={el.stroke}
      strokeWidth={el.strokeWidth * s}
      dash={el.dash?.map((v) => v * s)}
      dashEnabled={!!el.dash?.length}
      visible={el.visible}
      draggable={draggable && !el.locked}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onChange({
          x: node.x() / s - el.width / 2,
          y: node.y() / s - el.height / 2,
        });
      }}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Ellipse;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const newW = Math.max(1, node.radiusX() * 2 * scaleX);
        const newH = Math.max(1, node.radiusY() * 2 * scaleY);
        onChange({
          x: node.x() / s - newW / s / 2,
          y: node.y() / s - newH / s / 2,
          width: newW / s,
          height: newH / s,
          rotation: node.rotation(),
        });
      }}
    />
  );
}
