import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layer, Line, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import Sheet from './Sheet';
import Rulers, { RULER_SIZE_PX } from './Rulers';
import ElementsLayer from './ElementsLayer';
import GuidesLayer from './GuidesLayer';
import DraftOverlay from './DraftOverlay';
import SelectionTransformer from './SelectionTransformer';
import TextEditorOverlay from './TextEditorOverlay';
import BarcodeCreateDialog from './BarcodeCreateDialog';
import TableCreateDialog from './TableCreateDialog';
import { useCanvasDraw } from './useCanvasDraw';
import { useDocumentStore, useDocumentHistory } from '@/store/documentStore';
import { useUIStore } from '@/store/uiStore';
import { useToolStore } from '@/store/toolStore';
import { useSelectionStore } from '@/store/selectionStore';
import { MM_TO_PX, pxToMm } from '@/utils/units';
import { nextId } from '@/utils/id';
import type { ElementModel, ImageEl, LineEl, PenEl, QrEl, TableEl, TextEl, TextSpan } from '@/types/document';
import { spansToPlainText } from '@/utils/richText';

/** Paso de la grilla en mm (alineada al origen de la hoja). */
const GRID_MM = 10;

/** Grilla de TODO el lienzo (no solo la hoja), alineada al origen de la hoja. */
function CanvasGrid({ width, height, offsetX, offsetY, zoom }: {
  width: number; height: number; offsetX: number; offsetY: number; zoom: number;
}) {
  const step = GRID_MM * MM_TO_PX * zoom;
  if (step < 4) return null; // demasiado denso a zoom muy bajo
  const lines: number[][] = [];
  const startX = ((offsetX % step) + step) % step;
  for (let x = startX; x <= width; x += step) lines.push([x, 0, x, height]);
  const startY = ((offsetY % step) + step) % step;
  for (let y = startY; y <= height; y += step) lines.push([0, y, width, y]);
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} stroke="rgba(59,130,246,0.20)" strokeWidth={1} listening={false} />
      ))}
    </>
  );
}

/** Bounding box REAL de un elemento en mm (líneas/lápiz usan sus points). */
function elementBBoxMm(el: ElementModel): { x: number; y: number; w: number; h: number } {
  if ((el.type === 'line' || el.type === 'pen') && (el as LineEl | PenEl).points.length >= 2) {
    const pts = (el as LineEl | PenEl).points;
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    return {
      x: el.x + Math.min(...xs),
      y: el.y + Math.min(...ys),
      w: Math.max(0.5, Math.max(...xs) - Math.min(...xs)),
      h: Math.max(0.5, Math.max(...ys) - Math.min(...ys)),
    };
  }
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

export default function Canvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const setCursor = useUIStore((s) => s.setCursor);
  const unit = useUIStore((s) => s.unit);
  const theme = useUIStore((s) => s.theme);
  const showGrid = useUIStore((s) => s.showGrid);
  const fitTick = useUIStore((s) => s.fitTick);
  const fitWidthTick = useUIStore((s) => s.fitWidthTick);
  const activeTool = useToolStore((s) => s.active);
  const setActiveTool = useToolStore((s) => s.setActive);
  const clearSelection = useSelectionStore((s) => s.clear);
  const editingId = useSelectionStore((s) => s.editingId);
  const setEditing = useSelectionStore((s) => s.setEditing);

  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const addElement = useDocumentStore((s) => s.addElement);
  const select = useSelectionStore((s) => s.select);
  const page = pages.find((p) => p.id === currentPageId) ?? pages[0];

  const editingEl = editingId
    ? (page?.elements.find((e) => e.id === editingId && e.type === 'text') as TextEl | undefined)
    : undefined;

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const panningRef = useRef(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // marquee selection — el seguimiento va por listeners de WINDOW (no del Stage):
  // así el rectángulo de selección no depende del estado (transformer adjunto,
  // selección previa, salir del lienzo…) y nada de Konva puede interrumpirlo.
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeRef = useRef<typeof marquee>(null);
  const marqueeCleanupRef = useRef<(() => void) | null>(null);

  function finishMarquee() {
    const m = marqueeRef.current;
    setMarquee(null);
    marqueeRef.current = null;
    if (!m) return;
    const rx1 = Math.min(m.x1, m.x2);
    const ry1 = Math.min(m.y1, m.y2);
    const rx2 = Math.max(m.x1, m.x2);
    const ry2 = Math.max(m.y1, m.y2);
    if (rx2 - rx1 > 4 && ry2 - ry1 > 4 && page) {
      const s = MM_TO_PX * zoom;
      const hits = page.elements.filter((el) => {
        if (el.visible === false) return false;
        const b = elementBBoxMm(el);
        const ex1 = b.x * s + offset.x;
        const ey1 = b.y * s + offset.y;
        const ex2 = ex1 + b.w * s;
        const ey2 = ey1 + b.h * s;
        return ex1 < rx2 && ex2 > rx1 && ey1 < ry2 && ey2 > ry1;
      });
      if (hits.length > 0) {
        useSelectionStore.getState().select(hits.map((e) => e.id));
        useUIStore.getState().setStyleTarget(null);
      }
    }
  }

  function startMarquee(p: { x: number; y: number }) {
    marqueeCleanupRef.current?.();
    const m = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    setMarquee(m);
    marqueeRef.current = m;
    const onMove = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !marqueeRef.current) return;
      const nm = { ...marqueeRef.current, x2: ev.clientX - rect.left, y2: ev.clientY - rect.top };
      setMarquee(nm);
      marqueeRef.current = nm;
    };
    const onUp = () => {
      cleanup();
      finishMarquee();
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      marqueeCleanupRef.current = null;
    };
    marqueeCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => () => marqueeCleanupRef.current?.(), []);

  // imagen: ref al input oculto y posición pendiente en mm
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImagePosMm = useRef<{ x: number; y: number }>({ x: 20, y: 20 });

  // diálogos de creación
  const [barcodeDialog, setBarcodeDialog] = useState<{ x: number; y: number } | null>(null);
  const [tableDialog, setTableDialog] = useState<{ x: number; y: number } | null>(null);

  // siguiente zIndex a asignar a un nuevo elemento
  const nextZIndex = useMemo(
    () => () => (page ? Math.max(0, ...page.elements.map((e) => e.zIndex)) + 1 : 0),
    [page],
  );

  const draw = useCanvasDraw({
    offsetX: offset.x,
    offsetY: offset.y,
    zoom,
    pageId: page?.id ?? '',
    nextZIndex,
  });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl/⌘ + rueda hace zoom del LIENZO, nunca del navegador: un listener nativo
  // NO pasivo sobre el contenedor previene el zoom del navegador aunque el puntero
  // esté sobre las reglas/overlay (donde el onWheel de Konva no llega).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []);

  useEffect(() => {
    if (!page) return;
    const sheetW = page.size.width * MM_TO_PX * zoom;
    const sheetH = page.size.height * MM_TO_PX * zoom;
    const cx = RULER_SIZE_PX + Math.max(0, (size.w - RULER_SIZE_PX - sheetW) / 2);
    const cy = RULER_SIZE_PX + Math.max(0, (size.h - RULER_SIZE_PX - sheetH) / 2);
    setOffset({ x: cx, y: cy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, size.w, size.h]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        // Deshacer / Rehacer por teclado (Ctrl+Z · Ctrl+Shift+Z)
        e.preventDefault();
        const hist = useDocumentHistory().getState();
        if (e.shiftKey) hist.redo();
        else hist.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        // Rehacer por teclado (Ctrl+Y)
        e.preventDefault();
        useDocumentHistory().getState().redo();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceDown(true);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length > 0) {
          useDocumentStore.getState().removeElements(ids);
          useSelectionStore.getState().clear();
        } else {
          // Sin elementos seleccionados → eliminar página actual (si hay más de una)
          const ds = useDocumentStore.getState();
          if (ds.doc.pages.length > 1) {
            ds.removePage(ds.currentPageId);
          }
        }
      } else if (e.key === '0') {
        fitToViewport();
      } else if (e.key === '1') {
        setZoom(1);
      } else if (e.key === 'Escape') {
        draw.cancel();
      } else if (e.key === 'f' || e.key === 'F') {
        setActiveTool('frame');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setZoom, draw.cancel]);

  // "Ajustar a la ventana" / "Ajustar al ancho" pedidos desde la barra de estado.
  useEffect(() => {
    if (fitTick > 0) fitToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);

  useEffect(() => {
    if (fitWidthTick > 0) fitToWidth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitWidthTick]);

  function fitToWidth() {
    if (!page) return;
    const margin = 40;
    const availW = Math.max(100, size.w - RULER_SIZE_PX - margin * 2);
    const z = Math.min(5, availW / (page.size.width * MM_TO_PX));
    setZoom(z);
    const sheetW = page.size.width * MM_TO_PX * z;
    setOffset({
      x: RULER_SIZE_PX + (size.w - RULER_SIZE_PX - sheetW) / 2,
      y: RULER_SIZE_PX + 24,
    });
  }

  function fitToViewport() {
    if (!page) return;
    const margin = 40;
    const availW = Math.max(100, size.w - RULER_SIZE_PX - margin * 2);
    const availH = Math.max(100, size.h - RULER_SIZE_PX - margin * 2);
    const z = Math.min(
      availW / (page.size.width * MM_TO_PX),
      availH / (page.size.height * MM_TO_PX),
    );
    setZoom(z);
    const sheetW = page.size.width * MM_TO_PX * z;
    const sheetH = page.size.height * MM_TO_PX * z;
    setOffset({
      x: RULER_SIZE_PX + (size.w - RULER_SIZE_PX - sheetW) / 2,
      y: RULER_SIZE_PX + (size.h - RULER_SIZE_PX - sheetH) / 2,
    });
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    const native = e.evt;
    if (!(native.ctrlKey || native.metaKey)) {
      native.preventDefault();
      setOffset((o) => ({ x: o.x - native.deltaX, y: o.y - native.deltaY }));
      return;
    }
    native.preventDefault();
    const scaleBy = 1.08;
    const direction = native.deltaY > 0 ? -1 : 1;
    const nextZoom = Math.max(
      0.1,
      Math.min(5, zoom * (direction > 0 ? scaleBy : 1 / scaleBy)),
    );
    const stage = stageRef.current;
    if (!stage) {
      setZoom(nextZoom);
      return;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      setZoom(nextZoom);
      return;
    }
    const mx = (pointer.x - offset.x) / zoom;
    const my = (pointer.y - offset.y) / zoom;
    const nx = pointer.x - mx * nextZoom;
    const ny = pointer.y - my * nextZoom;
    setZoom(nextZoom);
    setOffset({ x: nx, y: ny });
  }

  const isHand = activeTool === 'hand' || spaceDown;

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !page) return;
    const src = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const pos = pendingImagePosMm.current;
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      // Limitar a 100mm de ancho máximo, mantener proporción
      const maxW = 100;
      const scaleF = naturalW > 0 ? Math.min(1, maxW / (naturalW * 0.2646)) : 1;
      const w = Math.max(5, naturalW * 0.2646 * scaleF);
      const h = Math.max(5, naturalH * 0.2646 * scaleF);
      const el: ImageEl = {
        id: nextId('el'),
        name: file.name.replace(/\.[^.]+$/, ''),
        type: 'image',
        x: pos.x,
        y: pos.y,
        width: w,
        height: h,
        rotation: 0,
        visible: true,
        locked: false,
        zIndex: nextZIndex(),
        src,
        opacity: 1,
      };
      addElement(page.id, el);
      select([el.id]);
      setActiveTool('select');
    };
    img.src = src;
    e.target.value = '';
  }

  // Al arrastrar una variable SOBRE un texto, se entra en modo edición para que
  // aparezca el cursor de texto NATIVO (|) siguiendo al puntero letra a letra;
  // al soltar, el overlay la inserta en esa posición del cursor.
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // Si el puntero está sobre el editor de texto (contentEditable), NO tocar el
    // evento: el navegador maneja el drag de texto de forma nativa y es lo que
    // pinta el caret | recorriendo cada letra. Interceptarlo lo suprime.
    const t = e.target as HTMLElement | null;
    if (t && t.isContentEditable) return;
    e.preventDefault();
    const hasBinding = Array.from(e.dataTransfer.types).includes('text/x-binding-path');
    e.dataTransfer.dropEffect = 'copy';
    if (!hasBinding || !page) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xMm = pxToMm(e.clientX - rect.left - offset.x, zoom);
    const yMm = pxToMm(e.clientY - rect.top - offset.y, zoom);
    const target = page.elements.find(
      (el) => el.type === 'text' && xMm >= el.x && xMm <= el.x + el.width && yMm >= el.y && yMm <= el.y + el.height,
    );
    if (target && editingId !== target.id) {
      select([target.id]);
      setEditing(target.id);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const binding = e.dataTransfer.getData('text/x-binding-path');
    if (!binding || !page) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const xMm = pxToMm(canvasPx.x - offset.x, zoom);
    const yMm = pxToMm(canvasPx.y - offset.y, zoom);

    // Find text element under the drop point
    const target = page.elements.find(
      (el) => el.type === 'text' && xMm >= el.x && xMm <= el.x + el.width && yMm >= el.y && yMm <= el.y + el.height,
    ) as TextEl | undefined;

    if (!target) return; // variables only go into text elements

    const varSpan: TextSpan = { binding, color: '#902774' };
    const existing: TextSpan[] = target.spans?.length
      ? target.spans
      : target.text ? [{ text: target.text }] : [];
    const newSpans = [...existing, varSpan];
    updateElement(target.id, { spans: newSpans, text: spansToPlainText(newSpans) });
    select([target.id]);
  }

  function onMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isHand) {
      // herramienta imagen: abrir selector de archivo
      if (activeTool === 'image') {
        const stage = e.target.getStage();
        const p = stage?.getPointerPosition();
        if (p) {
          pendingImagePosMm.current = {
            x: pxToMm(p.x - offset.x, zoom),
            y: pxToMm(p.y - offset.y, zoom),
          };
        }
        imageInputRef.current?.click();
        return;
      }
      // herramienta código de barras / QR: abrir diálogo de configuración
      if (activeTool === 'qr') {
        const stage = e.target.getStage();
        const p = stage?.getPointerPosition();
        if (p) {
          setBarcodeDialog({
            x: pxToMm(p.x - offset.x, zoom),
            y: pxToMm(p.y - offset.y, zoom),
          });
        }
        return;
      }
      // herramienta tabla: abrir diálogo de configuración
      if (activeTool === 'table') {
        const stage = e.target.getStage();
        const p = stage?.getPointerPosition();
        if (p) {
          setTableDialog({
            x: pxToMm(p.x - offset.x, zoom),
            y: pxToMm(p.y - offset.y, zoom),
          });
        }
        return;
      }
      // herramientas de dibujo: iniciar draft y salir
      if (draw.onMouseDown(e)) return;
      if (activeTool === 'select') {
        // El marquee arranca SIEMPRE que el puntero NO esté sobre un elemento
        // del lienzo ni sobre un anclaje del Transformer — INDEPENDIENTE de si
        // ya hay algo seleccionado. La detección de "sobre un elemento" usa el
        // MODELO (bboxes en mm), no el `e.target` de Konva: con un Transformer
        // adjunto el target es poco fiable (su `back`/anclajes tapan el área),
        // que era la causa de que el marquee no arrancara con algo seleccionado.
        const t = e.target as Konva.Node;
        const stage = t.getStage();
        // SOLO los anclajes de resize/rotación del Transformer (name `_anchor`)
        // deben dejar pasar el gesto al Transformer. El `back` del Transformer
        // (que tapa todo el bbox, incluido el interior vacío de formas huecas)
        // NO cuenta como anclaje → así el marquee arranca aunque haya selección.
        const onAnchor =
          t !== (stage as unknown as Konva.Node) && t.hasName('_anchor');
        const p = stage?.getPointerPosition();
        let overElement = false;
        if (p && page) {
          const mx = pxToMm(p.x - offset.x, zoom);
          const my = pxToMm(p.y - offset.y, zoom);
          overElement = page.elements.some((el) => {
            if (el.visible === false) return false;
            const b = elementBBoxMm(el);
            return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
          });
        }
        if (!onAnchor && !overElement) {
          if (p) startMarquee(p);
          clearSelection();
        }
      }
      return;
    }

    panningRef.current = true;
    panStart.current = {
      x: e.evt.clientX,
      y: e.evt.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }
  function onMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (panningRef.current) {
      setOffset({
        x: panStart.current.ox + (e.evt.clientX - panStart.current.x),
        y: panStart.current.oy + (e.evt.clientY - panStart.current.y),
      });
      return;
    }
    if (marqueeRef.current) return; // lo sigue el listener de window
    // si estamos dibujando, actualizar draft
    draw.onMouseMove(e);
    const stage = stageRef.current;
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    setCursor(pxToMm(p.x - offset.x, zoom), pxToMm(p.y - offset.y, zoom));
  }
  function onMouseUp() {
    panningRef.current = false;
    // El marquee lo termina su listener de window (finishMarquee) — aquí solo
    // se evita disparar el draw.
    if (marqueeRef.current) return;
    draw.onMouseUp();
  }

  const CROSSHAIR_CURSOR =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cline x1='10' y1='1' x2='10' y2='19' stroke='%23111111' stroke-width='1.5'/%3E%3Cline x1='1' y1='10' x2='19' y2='10' stroke='%23111111' stroke-width='1.5'/%3E%3Ccircle cx='10' cy='10' r='2.5' fill='none' stroke='%23111111' stroke-width='1.2'/%3E%3C/svg%3E\") 10 10, crosshair";

  const cursor = isHand
    ? panningRef.current
      ? 'grabbing'
      : 'grab'
    : activeTool === 'select'
      ? 'default'
      : CROSSHAIR_CURSOR;

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative overflow-hidden"
      style={{ background: 'var(--canvas)', cursor }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />
      {editingEl && (
        <TextEditorOverlay
          el={editingEl}
          zoom={zoom}
          offsetX={offset.x}
          offsetY={offset.y}
          onCommit={(spans) => {
            updateElement(editingEl.id, { spans, text: spansToPlainText(spans) });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {barcodeDialog && (
        <BarcodeCreateDialog
          posMm={barcodeDialog}
          zIndex={nextZIndex()}
          onConfirm={(el: QrEl) => {
            if (!page) return;
            addElement(page.id, el);
            select([el.id]);
            setActiveTool('select');
            setBarcodeDialog(null);
          }}
          onCancel={() => setBarcodeDialog(null)}
        />
      )}

      {tableDialog && (
        <TableCreateDialog
          posMm={tableDialog}
          zIndex={nextZIndex()}
          onConfirm={(el: TableEl) => {
            if (!page) return;
            addElement(page.id, el);
            select([el.id]);
            setActiveTool('select');
            setTableDialog(null);
          }}
          onCancel={() => setTableDialog(null)}
        />
      )}

      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <Layer>
          {page && <Sheet page={page} zoom={zoom} offsetX={offset.x} offsetY={offset.y} />}
          {/* Grilla por TODO el lienzo (encima de la hoja, debajo de los elementos) */}
          {showGrid && (
            <CanvasGrid width={size.w} height={size.h} offsetX={offset.x} offsetY={offset.y} zoom={zoom} />
          )}
          {page && (
            <ElementsLayer
              page={page}
              zoom={zoom}
              offsetX={offset.x}
              offsetY={offset.y}
            />
          )}
          {page && (
            <GuidesLayer
              page={page}
              zoom={zoom}
              offsetX={offset.x}
              offsetY={offset.y}
            />
          )}
          {draw.draft && (
            <DraftOverlay
              draft={draw.draft}
              zoom={zoom}
              offsetX={offset.x}
              offsetY={offset.y}
            />
          )}
          <SelectionTransformer stageRef={stageRef} />
          {marquee && (
            <Rect
              x={Math.min(marquee.x1, marquee.x2)}
              y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)}
              height={Math.abs(marquee.y2 - marquee.y1)}
              fill="rgba(100,149,237,0.15)"
              stroke="#6495ed"
              strokeWidth={1}
              dash={[4, 3]}
              listening={false}
            />
          )}
        </Layer>

        <Layer listening={false}>
          <Rulers
            viewportWidth={size.w}
            viewportHeight={size.h}
            originX={offset.x}
            originY={offset.y}
            pxPerMm={zoom * MM_TO_PX}
            unit={unit}
            theme={theme}
          />
        </Layer>
      </Stage>
    </div>
  );
}
