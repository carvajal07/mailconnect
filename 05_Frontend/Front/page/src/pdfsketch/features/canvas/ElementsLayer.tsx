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
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useToolStore } from '@/store/toolStore';
import { useUIStore } from '@/store/uiStore';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  page: Page;
  zoom: number;
  offsetX: number;
  offsetY: number;
  /** Modo vista previa: sin arrastre ni selección (para el modal PDF). */
  preview?: boolean;
}

/** Umbral magnético del snap, en px de pantalla. */
const SNAP_PX = 6;
/** Paso de la grilla en mm (mismo que el dibujo de la grilla). */
const GRID_MM = 10;

/**
 * Capa de elementos posicionada en el offset de la hoja.
 * Los elementos guardan sus coordenadas en mm (modelo), aquí se convierten a px.
 *
 * ── Multiselección (cómo funciona de verdad) ─────────────────────────────────
 * El Transformer de Konva 9 tiene `_proxyDrag`: al arrastrar UN nodo adjunto,
 * él mismo pone a los DEMÁS nodos de la selección en su propio drag nativo
 * (todos siguen el puntero solos). Por eso aquí NO se mueve nada durante el
 * arrastre — cualquier movimiento adicional (imperativo o vía store) pelea con
 * ese drag nativo y produce saltos/separaciones. Lo único que hacemos es:
 *   1. suprimir los commits individuales x/y de los nodos de la selección, y
 *   2. al PRIMER dragend, confirmar TODAS las posiciones en una sola operación
 *      (updateElements) = un único paso de undo.
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

  const multiDragRef = useRef<{
    ids: string[];
    /** Posición INICIAL (mm, del modelo) de cada elemento seleccionado. */
    startMm: Map<string, { x: number; y: number }>;
    /** Posición inicial del NODO ancla en px (para calcular el delta). */
    anchorId: string;
    anchorStartPx: { x: number; y: number };
    committed: boolean;
  } | null>(null);
  const pendingCollapse = useRef<string | null>(null);

  function handleSelect(id: string, additive: boolean) {
    if (preview || activeTool !== 'select') return;
    // Volver a las propiedades del ELEMENTO en el panel de abajo.
    useUIStore.getState().setStyleTarget(null);
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
    : (id: string, patch: Partial<ElementModel>) => {
        const d = multiDragRef.current;
        // Durante un arrastre múltiple, TODOS los nodos de la selección están en
        // drag (proxy del Transformer) y cada uno dispara su propio onDragEnd →
        // se suprimen esos commits x/y individuales; el commit único lo hace el
        // handler del Group.
        if (d && d.ids.includes(id)) {
          const keys = Object.keys(patch);
          if (keys.length > 0 && keys.every((k) => k === 'x' || k === 'y')) return;
        }
        updateElement(id, patch);
      };
  const onEdit = preview ? (_id: string) => {} : (id: string) => setEditing(id);
  const activeEditId = preview ? null : editingId;

  const elements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  function onDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    if (preview) return;
    pendingCollapse.current = null; // es un arrastre, no un clic-colapso
    // Los startDrag en cascada del proxy del Transformer también burbujean aquí.
    if (multiDragRef.current) return;
    const node = e.target as Konva.Node;
    const id = node.id();
    const sel = useSelectionStore.getState().selectedIds;
    if (id && sel.includes(id) && sel.length > 1) {
      const startMm = new Map<string, { x: number; y: number }>();
      for (const el of page.elements) {
        // Los BLOQUEADOS no se mueven (tampoco están adjuntos al Transformer) →
        // fuera del commit; si se incluyeran, el delta los teletransportaría.
        if (sel.includes(el.id) && !el.locked) startMm.set(el.id, { x: el.x, y: el.y });
      }
      multiDragRef.current = {
        ids: [...sel],
        startMm,
        anchorId: id,
        anchorStartPx: { x: node.x(), y: node.y() },
        committed: false,
      };
    }
  }

  function onDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    // Snap magnético: solo para el arrastre de UN elemento (en multi, cada nodo
    // sigue el puntero por su cuenta y ajustar el ancla los desalinearía).
    if (preview || multiDragRef.current) return;
    if (!useUIStore.getState().showSnap) return;
    const node = e.target as Konva.Node;
    const el = page.elements.find((x) => x.id === node.id());
    if (!el || el.type === 'line' || el.type === 'pen') return; // sin bbox real en x/y

    const s = MM_TO_PX * zoom;
    const w = el.width * s;
    const h = el.height * s;
    const withGrid = useUIStore.getState().showGrid;
    const gridStep = withGrid ? GRID_MM * s : undefined;

    // Objetivos: bordes de hoja + líneas de margen (en coords del Group = hoja).
    const targetsX = [0, page.size.width * s, page.margin.left * s, (page.size.width - page.margin.right) * s];
    const targetsY = [0, page.size.height * s, page.margin.top * s, (page.size.height - page.margin.bottom) * s];

    const snapAxis = (v: number, size: number, targets: number[]): number => {
      let bestD = SNAP_PX;
      let bestV = v;
      const consider = (target: number, edge: number) => {
        const d = Math.abs(target - edge);
        if (d < bestD) { bestD = d; bestV = v + (target - edge); }
      };
      for (const t of targets) { consider(t, v); consider(t, v + size); }
      if (gridStep) {
        consider(Math.round(v / gridStep) * gridStep, v);
        consider(Math.round((v + size) / gridStep) * gridStep, v + size);
      }
      return bestV;
    };

    // La elipse usa su CENTRO como posición del nodo → convertir a esquina para
    // snapear los BORDES y volver a centro al aplicar.
    const offX = el.type === 'circle' ? w / 2 : 0;
    const offY = el.type === 'circle' ? h / 2 : 0;
    const nx = snapAxis(node.x() - offX, w, targetsX) + offX;
    const ny = snapAxis(node.y() - offY, h, targetsY) + offY;
    if (nx !== node.x() || ny !== node.y()) node.position({ x: nx, y: ny });
  }

  function onDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const d = multiDragRef.current;
    if (!d || d.committed) return;
    d.committed = true;
    const stage = (e.target as Konva.Node).getStage();
    const sc = MM_TO_PX * zoom;
    // Commit RÍGIDO por delta: posición inicial del MODELO + desplazamiento del
    // ancla. Es inmune a la semántica de posición de cada tipo de nodo (la
    // elipse, por ejemplo, usa su CENTRO como posición del nodo — leer node.x()
    // como el.x la hacía saltar medio ancho al soltar) y garantiza que las
    // posiciones RELATIVAS de la selección se conservan exactas.
    const anchorNode = stage?.findOne('#' + d.anchorId);
    if (!anchorNode) { setTimeout(() => { multiDragRef.current = null; }, 0); return; }
    const dx = (anchorNode.x() - d.anchorStartPx.x) / sc;
    const dy = (anchorNode.y() - d.anchorStartPx.y) / sc;
    const patches: { id: string; patch: Partial<ElementModel> }[] = [];
    for (const [sid, p] of d.startMm) {
      patches.push({ id: sid, patch: { x: p.x + dx, y: p.y + dy } as Partial<ElementModel> });
    }
    if (patches.length && (dx !== 0 || dy !== 0)) updateElements(patches);
    // Los dragend de los demás nodos llegan síncronos en este mismo mouseup;
    // se limpia el ref DESPUÉS para que sus commits individuales sigan suprimidos.
    setTimeout(() => { multiDragRef.current = null; }, 0);
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
