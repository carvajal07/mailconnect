import { Ellipse } from 'react-konva';
import type Konva from 'konva';
import type { CircleEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';
import { konvaFillProps } from '@/utils/konvaFill';

interface Props {
  el: CircleEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<CircleEl>) => void;
  draggable: boolean;
}

/** Los gradientes de la elipse se calculan sobre el bbox pero el nodo Konva usa
 *  el CENTRO como origen → se desplazan -rx/-ry para que coincidan. */
function centerGradientProps(props: Record<string, unknown>, rx: number, ry: number) {
  const shift = (p: unknown) => {
    const pt = p as { x: number; y: number } | undefined;
    return pt ? { x: pt.x - rx, y: pt.y - ry } : pt;
  };
  const out = { ...props };
  for (const k of ['fillLinearGradientStartPoint', 'fillLinearGradientEndPoint',
    'fillRadialGradientStartPoint', 'fillRadialGradientEndPoint'] as const) {
    if (out[k]) out[k] = shift(out[k]);
  }
  return out;
}

export default function CircleElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const rx = (el.width / 2) * s;
  const ry = (el.height / 2) * s;
  // Sin relleno → el interior no intercepta el mouse (marquee iniciable dentro).
  const hollow = el.fill === 'transparent' && !el.fillGradient;
  return (
    <Ellipse
      id={el.id}
      name="pdfsketch-element"
      x={(el.x + el.width / 2) * s}
      y={(el.y + el.height / 2) * s}
      radiusX={rx}
      radiusY={ry}
      rotation={el.rotation}
      {...centerGradientProps(konvaFillProps(el.fill, el.fillGradient, el.opacity, el.width * s, el.height * s), rx, ry)}
      stroke={el.stroke}
      strokeWidth={el.strokeWidth * s}
      dash={el.dash?.map((v) => v * s)}
      dashEnabled={!!el.dash?.length}
      visible={el.visible}
      hitStrokeWidth={Math.max(10, el.strokeWidth * s + 6)}
      hitFunc={hollow ? (ctx, shape) => {
        const e = shape as Konva.Ellipse;
        ctx.beginPath();
        (ctx as unknown as CanvasRenderingContext2D).ellipse(0, 0, e.radiusX(), e.radiusY(), 0, 0, Math.PI * 2);
        ctx.closePath();
        (ctx as unknown as { strokeShape: (sh: Konva.Shape) => void }).strokeShape(shape);
      } : undefined}
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
