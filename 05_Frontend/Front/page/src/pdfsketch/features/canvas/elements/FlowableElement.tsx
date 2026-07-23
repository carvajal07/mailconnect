import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { FlowableEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  el: FlowableEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<FlowableEl>) => void;
  draggable: boolean;
}

export default function FlowableElement({ el, zoom, onSelect, onChange, draggable }: Props) {
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
      width: Math.max(1, (w * scaleX) / s),
      height: Math.max(1, (h * scaleY) / s),
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
      <Rect
        width={w}
        height={h}
        fill={el.fill}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth * s}
        dash={[3 * zoom, 3 * zoom]}
      />
      {/* Etiqueta del tipo de flowable */}
      <Text
        x={3 * zoom}
        y={3 * zoom}
        text={`↳ ${el.flowType === 'content' ? 'sub-área' : el.flowType}`}
        fontSize={6.5 * zoom}
        fill="#2563eb"
        listening={false}
        opacity={0.7}
      />
    </Group>
  );
}
