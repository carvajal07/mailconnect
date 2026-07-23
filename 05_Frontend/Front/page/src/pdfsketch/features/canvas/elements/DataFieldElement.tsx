import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { DataFieldEl } from '@/types/document';
import { MM_TO_PX, PT_PER_MM } from '@/utils/units';

interface Props {
  el: DataFieldEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<DataFieldEl>) => void;
  draggable: boolean;
}

/**
 * Campo dinámico. Muestra `{{binding}}` con un chip sutil para distinguirlo
 * del texto normal. En runtime/export el backend sustituye con la variable.
 */
export default function DataFieldElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const fontPx = (el.fontSize / PT_PER_MM) * s;
  const display = el.fallback || `{{${el.binding}}}`;
  const chipColor = 'oklch(0.68 0.19 235 / 0.12)'; // --sel @ 12%
  const chipBorder = 'oklch(0.68 0.19 235 / 0.55)';

  return (
    <Group
      id={el.id}
      name="pdfsketch-element"
      x={el.x * s}
      y={el.y * s}
      rotation={el.rotation}
      visible={el.visible}
      draggable={draggable && !el.locked}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onChange({ x: node.x() / s, y: node.y() / s });
      }}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Group;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x() / s,
          y: node.y() / s,
          width: Math.max(1, el.width * scaleX),
          height: Math.max(1, el.height * scaleY),
          rotation: node.rotation(),
        });
      }}
    >
      <Rect
        x={0}
        y={0}
        width={el.width * s}
        height={el.height * s}
        fill={chipColor}
        stroke={chipBorder}
        strokeWidth={1}
        dash={[2, 2]}
        cornerRadius={2}
      />
      <Text
        x={2}
        y={2}
        width={el.width * s - 4}
        height={el.height * s - 4}
        text={display}
        fontFamily={el.fontFamily}
        fontSize={fontPx}
        fill={el.color}
        verticalAlign="middle"
        wrap="word"
      />
    </Group>
  );
}
