import { Shape } from 'react-konva';
import type Konva from 'konva';
import type { TextEl, TextSpan } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';
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

/**
 * Elemento de texto. Renderiza SIEMPRE vía layoutSpans (texto plano se
 * convierte en un span único) → un solo camino de render con alineación,
 * variables, RECORTE al cuadro e indicador de desborde:
 * si el contenido no cabe, se recorta y se pinta un (−) rojo en la esquina
 * inferior derecha (como el marcador de overflow de los editores de texto).
 */
export default function TextElement({ el, zoom, onSelect, onChange, onEdit, draggable, isEditing }: Props) {
  const s = MM_TO_PX * zoom;
  const spans: TextSpan[] = el.spans?.length ? el.spans : [{ text: el.text }];

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
        const w = shape.width();
        const h = shape.height();

        const cmds = layoutSpans(native, spans, el, MM_TO_PX * zoom, w);

        // Texto RECORTADO al cuadro (lo que no cabe no se muestra)
        native.save();
        native.beginPath();
        native.rect(0, 0, w, h);
        native.clip();
        drawCmds(native, cmds);
        native.restore();

        // ¿Desborda? (alto del contenido o una palabra más ancha que el cuadro)
        const contentH = cmds.length ? Math.max(...cmds.map((c) => c.y + c.lineH)) : 0;
        const overflowX = cmds.some((c) => c.x + (c.width ?? 0) > w + 0.5);
        if (contentH > h + 0.5 || overflowX) {
          const sz = 11;
          native.save();
          native.fillStyle = '#dc2626';
          native.fillRect(w - sz - 1, h - sz - 1, sz, sz);
          native.fillStyle = '#ffffff';
          native.fillRect(w - sz - 1 + 2.5, h - 1 - sz / 2 - 1, sz - 5, 2);
          native.restore();
        }

        // hit region = bounding rect
        ctx.beginPath();
        (ctx as unknown as CanvasRenderingContext2D).rect(0, 0, w, h);
        ctx.closePath();
        (ctx as unknown as { fillStrokeShape: (sh: Konva.Shape) => void }).fillStrokeShape(shape);
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        (ctx as unknown as CanvasRenderingContext2D).rect(0, 0, shape.width(), shape.height());
        ctx.closePath();
        (ctx as unknown as { fillStrokeShape: (sh: Konva.Shape) => void }).fillStrokeShape(shape);
      }}
      {...commonEvents}
    />
  );
}
