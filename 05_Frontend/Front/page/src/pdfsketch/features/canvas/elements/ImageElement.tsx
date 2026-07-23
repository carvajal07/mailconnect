import { Group, Image as KImage, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { ImageEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';
import { useHtmlImage } from './useHtmlImage';

interface Props {
  el: ImageEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<ImageEl>) => void;
  draggable: boolean;
}

export default function ImageElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const w = el.width * s;
  const h = el.height * s;
  const { image, status } = useHtmlImage(el.src || null);

  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    onChange({ x: node.x() / s, y: node.y() / s });
  };

  if (!image) {
    const label =
      status === 'loading' ? 'Cargando…' : status === 'error' ? 'Error' : 'Sin imagen';
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
        onDragEnd={onDragEnd}
      >
        <Rect
          width={w}
          height={h}
          fill="oklch(0.94 0 0 / 0.6)"
          stroke="#bbb"
          strokeWidth={1}
          dash={[4, 4]}
        />
        <Text
          x={4}
          y={4}
          width={w - 8}
          height={h - 8}
          text={label}
          fontSize={Math.min(12, h / 3)}
          fill="#666"
          align="center"
          verticalAlign="middle"
        />
      </Group>
    );
  }

  return (
    <KImage
      id={el.id}
      name="pdfsketch-element"
      image={image}
      x={el.x * s}
      y={el.y * s}
      width={w}
      height={h}
      rotation={el.rotation}
      opacity={el.opacity ?? 1}
      crop={
        el.cropX !== undefined || el.cropY !== undefined
          ? {
              x: el.cropX ?? 0,
              y: el.cropY ?? 0,
              width: image.naturalWidth,
              height: image.naturalHeight,
            }
          : undefined
      }
      visible={el.visible}
      draggable={draggable && !el.locked}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={onDragEnd}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Image;
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
