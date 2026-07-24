import { Line } from 'react-konva';
import type Konva from 'konva';
import type { TriangleEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';
import { konvaFillProps } from '@/utils/konvaFill';

interface Props {
  el: TriangleEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<TriangleEl>) => void;
  draggable: boolean;
}

/**
 * Triángulo (apunta hacia arriba, como la forma `triangle` del Diseñador y el
 * motor PDF). Se dibuja como Line CERRADA con puntos relativos al bbox — así el
 * Transformer redimensiona por escala del nodo y se convierte a width/height.
 */
export default function TriangleElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const w = el.width * s;
  const h = el.height * s;
  const points = [w / 2, 0, w, h, 0, h]; // ápice arriba, base abajo
  const hollow = el.fill === 'transparent' && !el.fillGradient;
  return (
    <Line
      id={el.id}
      name="pdfsketch-element"
      x={el.x * s}
      y={el.y * s}
      points={points}
      closed
      rotation={el.rotation}
      {...konvaFillProps(el.fill, el.fillGradient, el.opacity, w, h)}
      stroke={el.stroke}
      strokeWidth={el.strokeWidth * s}
      dash={el.dash?.map((v) => v * s)}
      dashEnabled={!!el.dash?.length}
      visible={el.visible}
      hitStrokeWidth={Math.max(10, el.strokeWidth * s + 6)}
      hitFunc={hollow ? (ctx, shape) => {
        const c = ctx as unknown as CanvasRenderingContext2D;
        ctx.beginPath();
        c.moveTo(w / 2, 0);
        c.lineTo(w, h);
        c.lineTo(0, h);
        ctx.closePath();
        (ctx as unknown as { strokeShape: (sh: Konva.Shape) => void }).strokeShape(shape);
      } : undefined}
      draggable={draggable && !el.locked}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onChange({ x: node.x() / s, y: node.y() / s });
      }}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Line;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x() / s,
          y: node.y() / s,
          width: Math.max(1, (el.width * s * scaleX) / s),
          height: Math.max(1, (el.height * s * scaleY) / s),
          rotation: node.rotation(),
        });
      }}
    />
  );
}
