import { useRef } from 'react';
import { Group } from 'react-konva';
import type Konva from 'konva';
import RectElement from './elements/RectElement';
import CircleElement from './elements/CircleElement';
import LineLikeElement from './elements/LineLikeElement';
import TextElement from './elements/TextElement';
import DataFieldElement from './elements/DataFieldElement';
import ImageElement from './elements/ImageElement';
import QrElement from './elements/QrElement';
import TableElement from './elements/TableElement';
import FrameElement from './elements/FrameElement';
import FlowableElement from './elements/FlowableElement';
import type { ElementModel, Page } from '@/types/document';
import { useDocumentStore, useDocumentHistory } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useToolStore } from '@/store/toolStore';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  page: Page;
  zoom: number;
  offsetX: number;
  offsetY: number;
  /** Modo vista previa: sin arrastre ni selección (para el modal PDF). */
  preview?: boolean;
}

/**
 * Capa de elementos posicionada en el offset de la hoja.
 * Los elementos guardan sus coordenadas en mm (modelo), aquí se convierten a px.
 *
 * El arrastre de una selección MÚLTIPLE se maneja aquí, a nivel del <Group>: los
 * eventos de drag de cada elemento burbujean hasta el grupo; al mover el ancla
 * movemos el resto de la selección en tándem y confirmamos TODO en una sola
 * operación (updateElements) = un único paso de undo.
 */
export default function ElementsLayer({ page, zoom, offsetX, offsetY, preview = false }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const updateElements = useDocumentStore((s) => s.updateElements);
  const select = useSelectionStore((s) => s.select);
  const toggle = useSelectionStore((s) => s.toggle);
  const editingId = useSelectionStore((s) => s.editingId);
  const setEditing = useSelectionStore((s) => s.setEditing);
  const activeTool = useToolStore((s) => s.active);
  const draggable = !preview && activeTool === 'select';

  const dragRef = useRef<{
    anchorId: string;
    preDrag: Map<string, { x: number; y: number }>; // posiciones en mm al iniciar
    moved: boolean;
  } | null>(null);
  const pendingCollapse = useRef<string | null>(null);

  function handleSelect(id: string, additive: boolean) {
    if (preview || activeTool !== 'select') return;
    if (additive) { pendingCollapse.current = null; toggle(id); return; }
    const sel = useSelectionStore.getState().selectedIds;
    if (sel.includes(id) && sel.length > 1) {
      // Puede ser el inicio de un arrastre del grupo o un clic para colapsar la
      // selección a este único elemento → se decide al soltar (mouseup).
      pendingCollapse.current = id;
      return;
    }
    pendingCollapse.current = null;
    select([id]);
  }

  const onUpdate = preview
    ? (_id: string, _patch: Partial<ElementModel>) => {}
    : (id: string, patch: Partial<ElementModel>) => updateElement(id, patch);
  const onEdit = preview ? (_id: string) => {} : (id: string) => setEditing(id);
  const activeEditId = preview ? null : editingId;

  const elements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  // ── Arrastre de selección MÚLTIPLE ─────────────────────────────────────────
  // El movimiento del grupo es autoritativo desde el STORE (no manipulación
  // imperativa de nodos, que se pisaba con el arrastre nativo del Transformer y
  // hacía que los elementos se separaran). Durante el arrastre se pausa el
  // historial; al soltar se registra UN solo paso de undo (restaurar→final).
  function selectedPositionsMm(): Map<string, { x: number; y: number }> {
    const sel = useSelectionStore.getState().selectedIds;
    const els = useDocumentStore.getState().doc.pages.flatMap((p) => p.elements);
    const m = new Map<string, { x: number; y: number }>();
    for (const sid of sel) {
      const el = els.find((x) => x.id === sid);
      if (el) m.set(sid, { x: el.x, y: el.y });
    }
    return m;
  }

  function onDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    if (preview) return;
    pendingCollapse.current = null; // es un arrastre, no un clic-colapso
    const id = (e.target as Konva.Node).id();
    const sel = useSelectionStore.getState().selectedIds;
    if (!id || !sel.includes(id) || sel.length <= 1) { dragRef.current = null; return; }
    dragRef.current = { anchorId: id, preDrag: selectedPositionsMm(), moved: false };
  }

  function onDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    const d = dragRef.current;
    if (!d) return;
    const node = e.target as Konva.Node;
    if (node.id() !== d.anchorId) return;
    const a0 = d.preDrag.get(d.anchorId);
    if (!a0) return;
    const sc = MM_TO_PX * zoom;
    const dx = node.x() / sc - a0.x;
    const dy = node.y() / sc - a0.y;
    if (!d.moved) { useDocumentHistory().getState().pause(); d.moved = true; }
    const patches: { id: string; patch: Partial<ElementModel> }[] = [];
    for (const [sid, p] of d.preDrag) {
      patches.push({ id: sid, patch: { x: p.x + dx, y: p.y + dy } as Partial<ElementModel> });
    }
    updateElements(patches);
  }

  function onDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return; // arrastre simple → lo confirma el propio elemento
    const node = e.target as Konva.Node;
    const a0 = d.preDrag.get(d.anchorId);
    const sc = MM_TO_PX * zoom;
    const dx = a0 ? node.x() / sc - a0.x : 0;
    const dy = a0 ? node.y() / sc - a0.y : 0;
    const restore: { id: string; patch: Partial<ElementModel> }[] = [];
    const final: { id: string; patch: Partial<ElementModel> }[] = [];
    for (const [sid, p] of d.preDrag) {
      restore.push({ id: sid, patch: { x: p.x, y: p.y } as Partial<ElementModel> });
      final.push({ id: sid, patch: { x: p.x + dx, y: p.y + dy } as Partial<ElementModel> });
    }
    // Volver al estado previo (aún pausado) y registrar el final como UN paso.
    updateElements(restore);
    useDocumentHistory().getState().resume();
    updateElements(final);
  }

  function onGroupMouseUp() {
    if (pendingCollapse.current) {
      select([pendingCollapse.current]);
      pendingCollapse.current = null;
    }
  }

  return (
    <Group
      x={offsetX}
      y={offsetY}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onMouseUp={onGroupMouseUp}
    >
      {elements.map((el) =>
        renderElement(el, zoom, handleSelect, onUpdate, draggable, activeEditId, onEdit),
      )}
    </Group>
  );
}

function renderElement(
  el: ElementModel,
  zoom: number,
  onSelect: (id: string, additive: boolean) => void,
  onUpdate: (id: string, patch: Partial<ElementModel>) => void,
  draggable: boolean,
  editingId: string | null,
  onEdit: (id: string) => void,
) {
  const key = el.id;
  switch (el.type) {
    case 'rect':
      return (
        <RectElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'circle':
      return (
        <CircleElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'line':
    case 'pen':
      return (
        <LineLikeElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'text':
      return (
        <TextElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          onEdit={() => onEdit(el.id)}
          draggable={draggable}
          isEditing={editingId === el.id}
        />
      );
    case 'dataField':
      return (
        <DataFieldElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'image':
      return (
        <ImageElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'qr':
      return (
        <QrElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'table':
      return (
        <TableElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'frame':
      return (
        <FrameElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    case 'flowable':
      return (
        <FlowableElement
          key={key}
          el={el}
          zoom={zoom}
          onSelect={onSelect}
          onChange={(p) => onUpdate(el.id, p)}
          draggable={draggable}
        />
      );
    default:
      return null;
  }
}
