import { useEffect, useRef } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';
import { useSelectionStore } from '@/store/selectionStore';
import { useDocumentStore } from '@/store/documentStore';
import { useToolStore } from '@/store/toolStore';

interface Props {
  stageRef: React.RefObject<Konva.Stage | null>;
}

/**
 * Transformer único que se reengancha a los nodos seleccionados.
 * Sólo activo con la herramienta `select`; se oculta en hand/draw/etc.
 */
export default function SelectionTransformer({ stageRef }: Props) {
  const trRef = useRef<Konva.Transformer | null>(null);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const activeTool = useToolStore((s) => s.active);
  // sincroniza cuando los elementos cambian (tras drag/transform)
  const version = useDocumentStore((s) => s.doc.updatedAt);

  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;

    if (activeTool !== 'select' || selectedIds.length === 0) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }

    const nodes = selectedIds
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, activeTool, version, stageRef]);

  const accent = 'oklch(0.68 0.19 235)'; // --sel

  return (
    <Transformer
      ref={trRef}
      anchorSize={8}
      anchorStroke={accent}
      anchorFill="#fff"
      anchorCornerRadius={2}
      borderStroke={accent}
      borderDash={[3, 3]}
      rotateAnchorOffset={24}
      rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
      keepRatio={false}
      flipEnabled={false}
      ignoreStroke
      boundBoxFunc={(oldBox, newBox) => {
        if (newBox.width < 5 || newBox.height < 5) return oldBox;
        return newBox;
      }}
    />
  );
}
