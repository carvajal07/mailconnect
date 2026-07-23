import { Group } from 'react-konva';
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
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useToolStore } from '@/store/toolStore';

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
 */
export default function ElementsLayer({ page, zoom, offsetX, offsetY, preview = false }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const select = useSelectionStore((s) => s.select);
  const toggle = useSelectionStore((s) => s.toggle);
  const editingId = useSelectionStore((s) => s.editingId);
  const setEditing = useSelectionStore((s) => s.setEditing);
  const activeTool = useToolStore((s) => s.active);
  const draggable = !preview && activeTool === 'select';

  function handleSelect(id: string, additive: boolean) {
    if (preview || activeTool !== 'select') return;
    if (additive) toggle(id);
    else select([id]);
  }

  const onUpdate = preview
    ? (_id: string, _patch: Partial<ElementModel>) => {}
    : (id: string, patch: Partial<ElementModel>) => updateElement(id, patch);
  const onEdit = preview ? (_id: string) => {} : (id: string) => setEditing(id);
  const activeEditId = preview ? null : editingId;

  const elements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <Group x={offsetX} y={offsetY}>
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
