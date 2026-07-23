import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { FrameEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  el: FrameEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<FrameEl>) => void;
  draggable: boolean;
}

export default function FrameElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const x = el.x * s;
  const y = el.y * s;
  const w = el.width * s;
  const h = el.height * s;

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    onChange({ x: node.x() / s, y: node.y() / s });
  }

  function handleTransformEnd(e: Konva.KonvaEventObject<Event>) {
    const node = e.target as Konva.Group;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      x: node.x() / s,
      y: node.y() / s,
      width: Math.max(2, (w * scaleX) / s),
      height: Math.max(2, (h * scaleY) / s),
      rotation: node.rotation(),
    });
  }

  return (
    <Group
      id={el.id}
      name="pdfsketch-element"
      x={x}
      y={y}
      width={w}
      height={h}
      rotation={el.rotation}
      visible={el.visible}
      draggable={draggable && !el.locked}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    >
      {/* Fondo */}
      <Rect
        width={w}
        height={h}
        fill={el.fill}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth * s}
        cornerRadius={el.cornerRadius * s}
        dash={[6 * zoom, 3 * zoom]}
      />
      {/* Etiqueta ÁREA en la esquina superior izquierda */}
      <Rect
        x={0}
        y={0}
        width={Math.min(w, 40 * zoom)}
        height={10 * zoom}
        fill={el.stroke}
        cornerRadius={[el.cornerRadius * s, 0, 0, 0]}
        listening={false}
      />
      <Text
        x={2 * zoom}
        y={1.5 * zoom}
        text="ÁREA"
        fontSize={7 * zoom}
        fill="#ffffff"
        listening={false}
        fontStyle="bold"
      />
    </Group>
  );
}
