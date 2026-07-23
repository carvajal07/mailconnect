import { Shape, Text } from 'react-konva';
import type Konva from 'konva';
import type { TextEl } from '@/types/document';
import { MM_TO_PX, PT_PER_MM } from '@/utils/units';
import { layoutSpans, drawCmds } from '@/utils/richText';

interface Props {
  el: TextEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<TextEl>) => void;
  onEdit: () => void;
  draggable: boolean;
  isEditing: boolean;
}

export default function TextElement({ el, zoom, onSelect, onChange, onEdit, draggable, isEditing }: Props) {
  const s       = MM_TO_PX * zoom;
  const fontPx  = (el.fontSize / PT_PER_MM) * s;
  const weight  = el.fontWeight >= 600 ? 'bold' : 'normal';
  const italic  = el.fontStyle === 'italic' ? 'italic' : '';
  const konvaFontStyle = [weight, italic].filter(Boolean).join(' ') || 'normal';

  const hasSpans = (el.spans?.length ?? 0) > 0;

  const commonEvents = {
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isEditing) onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
    },
    onDblClick: () => { onSelect(el.id, false); onEdit(); },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      onChange({ x: node.x() / s, y: node.y() / s });
    },
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target as Konva.Node;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      onChange({
        x: node.x() / s,
        y: node.y() / s,
        width:  Math.max(5, (node.width()  * scaleX) / s),
        height: Math.max(3, (node.height() * scaleY) / s),
        rotation: node.rotation(),
      });
    },
  };

  if (hasSpans) {
    return (
      <Shape
        id={el.id}
        name="pdfsketch-element"
        x={el.x * s}
        y={el.y * s}
        width={el.width * s}
        height={el.height * s}
        rotation={el.rotation}
        visible={el.visible && !isEditing}
        draggable={draggable && !el.locked && !isEditing}
        sceneFunc={(ctx, shape) => {
          const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
          native.save();
          const cmds = layoutSpans(native, el.spans!, el, MM_TO_PX * zoom, el.width * MM_TO_PX * zoom);
          drawCmds(native, cmds);
          native.restore();
          // hit region = bounding rect
          ctx.beginPath();
          (ctx as unknown as CanvasRenderingContext2D).rect(0, 0, shape.width(), shape.height());
          ctx.closePath();
          (ctx as unknown as { fillStrokeShape: (s: Konva.Shape) => void }).fillStrokeShape(shape);
        }}
        hitFunc={(ctx, shape) => {
          ctx.beginPath();
          (ctx as unknown as CanvasRenderingContext2D).rect(0, 0, shape.width(), shape.height());
          ctx.closePath();
          (ctx as unknown as { fillStrokeShape: (s: Konva.Shape) => void }).fillStrokeShape(shape);
        }}
        {...commonEvents}
      />
    );
  }

  return (
    <Text
      id={el.id}
      name="pdfsketch-element"
      x={el.x * s}
      y={el.y * s}
      width={el.width * s}
      height={el.height * s}
      text={el.text || ' '}
      fontFamily={el.fontFamily}
      fontSize={fontPx}
      fontStyle={konvaFontStyle}
      textDecoration={el.textDecoration}
      align={el.align.startsWith('justify') ? 'left' : (el.align as 'left' | 'center' | 'right')}
      lineHeight={el.lineHeight}
      fill={el.color}
      rotation={el.rotation}
      visible={el.visible && !isEditing}
      wrap="word"
      draggable={draggable && !el.locked && !isEditing}
      {...commonEvents}
    />
  );
}
