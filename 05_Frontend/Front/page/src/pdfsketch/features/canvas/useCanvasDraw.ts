import { useCallback, useState } from 'react';
import type Konva from 'konva';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useToolStore, type Tool } from '@/store/toolStore';
import { pxToMm } from '@/utils/units';
import { nextId } from '@/utils/id';
import type {
  CircleEl,
  ElementModel,
  FlowableEl,
  FrameEl,
  LineEl,
  PenEl,
  RectEl,
  TextEl,
  TriangleEl,
} from '@/types/document';

export type DrawTool = 'rect' | 'circle' | 'triangle' | 'line' | 'pen' | 'text' | 'frame';

export interface Draft {
  tool: DrawTool;
  startMm: { x: number; y: number };
  currentMm: { x: number; y: number };
  /** Puntos acumulados en mm, sólo para `pen`. */
  pointsMm?: { x: number; y: number }[];
  /** Si true, rect/circle mantienen proporción 1:1 (Shift). */
  constrain: boolean;
}

export function isDrawTool(t: Tool): t is DrawTool {
  return t === 'rect' || t === 'circle' || t === 'triangle' || t === 'line' || t === 'pen' || t === 'text' || t === 'frame';
}

interface Args {
  offsetX: number;
  offsetY: number;
  zoom: number;
  pageId: string;
  /** Siguiente zIndex a asignar. */
  nextZIndex: () => number;
}

/**
 * Hook que maneja la creación de elementos con drag sobre el Stage.
 * - Devuelve handlers para conectar al Stage y el `draft` para previsualizar.
 * - Al soltar, hace `addElement` en el store y selecciona el nuevo elemento.
 */
export function useCanvasDraw({ offsetX, offsetY, zoom, pageId, nextZIndex }: Args) {
  const activeTool = useToolStore((s) => s.active);
  const setTool = useToolStore((s) => s.setActive);
  const autoReturn = useToolStore((s) => s.autoReturnToSelect);
  const addElement = useDocumentStore((s) => s.addElement);
  const doc = useDocumentStore((s) => s.doc);
  const select = useSelectionStore((s) => s.select);

  const [draft, setDraft] = useState<Draft | null>(null);

  const pointerMm = useCallback(
    (stage: Konva.Stage | null) => {
      if (!stage) return null;
      const p = stage.getPointerPosition();
      if (!p) return null;
      return { x: pxToMm(p.x - offsetX, zoom), y: pxToMm(p.y - offsetY, zoom) };
    },
    [offsetX, offsetY, zoom],
  );

  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>): boolean => {
      if (!isDrawTool(activeTool)) return false;
      const m = pointerMm(e.target.getStage());
      if (!m) return false;
      setDraft({
        tool: activeTool,
        startMm: m,
        currentMm: m,
        pointsMm: activeTool === 'pen' ? [m] : undefined,
        constrain: e.evt.shiftKey,
      });
      return true;
    },
    [activeTool, pointerMm],
  );

  const onMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>): boolean => {
      if (!draft) return false;
      const m = pointerMm(e.target.getStage());
      if (!m) return false;
      setDraft((d) => {
        if (!d) return d;
        const next: Draft = { ...d, currentMm: m, constrain: e.evt.shiftKey };
        if (d.tool === 'pen') {
          next.pointsMm = [...(d.pointsMm ?? []), m];
        }
        return next;
      });
      return true;
    },
    [draft, pointerMm],
  );

  const onMouseUp = useCallback((): boolean => {
    if (!draft) return false;
    const count = doc.pages.flatMap((p) => p.elements).filter((e) => e.type === draft.tool).length;
    const name = `${draft.tool}${count + 1}`;

    if (draft.tool === 'frame') {
      const frame = draftToFrame(draft, nextZIndex(), name);
      if (frame) {
        addElement(pageId, frame);
        const flowable = draftToFlowable(frame, nextZIndex() + 1, count + 1);
        addElement(pageId, flowable);
        select([frame.id]);
        if (autoReturn) setTool('select');
      }
      setDraft(null);
      return true;
    }

    const el = draftToElement(draft, nextZIndex(), name);
    if (el) {
      addElement(pageId, el);
      select([el.id]);
      if (autoReturn) setTool('select');
    }
    setDraft(null);
    return true;
  }, [draft, doc, pageId, nextZIndex, addElement, select, autoReturn, setTool]);

  const cancel = useCallback(() => setDraft(null), []);

  return {
    draft,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    cancel,
    isDrawing: draft !== null,
    isDrawToolActive: isDrawTool(activeTool),
  };
}

function applyConstrain(
  start: { x: number; y: number },
  current: { x: number; y: number },
): { x: number; y: number } {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * d,
    y: start.y + Math.sign(dy || 1) * d,
  };
}

function bboxFromTwoPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function draftToElement(d: Draft, zIndex: number, name: string): ElementModel | null {
  const baseCommon = {
    id: nextId('el'),
    name,
    rotation: 0,
    visible: true,
    locked: false,
    zIndex,
  };

  if (d.tool === 'rect' || d.tool === 'circle' || d.tool === 'triangle') {
    const end = d.constrain ? applyConstrain(d.startMm, d.currentMm) : d.currentMm;
    const { x, y, w, h } = bboxFromTwoPoints(d.startMm, end);
    if (w < 0.5 && h < 0.5) return null;
    const width = Math.max(0.5, w);
    const height = Math.max(0.5, h);
    if (d.tool === 'rect') {
      const el: RectEl = {
        ...baseCommon,
        type: 'rect',
        x,
        y,
        width,
        height,
        fill: 'transparent',
        stroke: '#111111',
        strokeWidth: 0.25,
        cornerRadius: 0,
      };
      return el;
    }
    if (d.tool === 'triangle') {
      const el: TriangleEl = {
        ...baseCommon,
        type: 'triangle',
        x,
        y,
        width,
        height,
        fill: 'transparent',
        stroke: '#111111',
        strokeWidth: 0.25,
      };
      return el;
    }
    const el: CircleEl = {
      ...baseCommon,
      type: 'circle',
      x,
      y,
      width,
      height,
      fill: 'transparent',
      stroke: '#111111',
      strokeWidth: 0.25,
    };
    return el;
  }

  if (d.tool === 'line') {
    const end = d.constrain ? applyConstrain(d.startMm, d.currentMm) : d.currentMm;
    const { w, h } = bboxFromTwoPoints(d.startMm, end);
    if (w < 0.5 && h < 0.5) return null;
    const el: LineEl = {
      ...baseCommon,
      type: 'line',
      x: 0,
      y: 0,
      width: Math.max(0.5, w),
      height: Math.max(0.5, h),
      points: [d.startMm.x, d.startMm.y, end.x, end.y],
      stroke: '#111111',
      strokeWidth: 0.25,
    };
    return el;
  }

  if (d.tool === 'pen') {
    const pts = d.pointsMm ?? [];
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const el: PenEl = {
      ...baseCommon,
      type: 'pen',
      x: 0,
      y: 0,
      width: Math.max(0.5, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(0.5, Math.max(...ys) - Math.min(...ys)),
      points: pts.flatMap((p) => [p.x, p.y]),
      stroke: '#111111',
      strokeWidth: 0.25,
      tension: 0.5,
    };
    return el;
  }

  if (d.tool === 'text') {
    const { x, y, w, h } = bboxFromTwoPoints(d.startMm, d.currentMm);
    if (w < 0.5 && h < 0.5) return null;
    const el: TextEl = {
      ...baseCommon,
      type: 'text',
      x,
      y,
      width: Math.max(5, w),
      height: Math.max(3, h),
      text: 'Texto',
      fontFamily: 'Arial',
      fontSize: 10,
      fontStyle: 'normal',
      fontWeight: 400,
      align: 'left',
      lineHeight: 1.2,
      color: '#000000',
    };
    return el;
  }

  return null;
}

function draftToFrame(d: Draft, zIndex: number, name: string): FrameEl | null {
  const { x, y, w, h } = bboxFromTwoPoints(d.startMm, d.currentMm);
  if (w < 2 && h < 2) return null;
  return {
    id: nextId('el'),
    name,
    type: 'frame',
    x,
    y,
    width: Math.max(2, w),
    height: Math.max(2, h),
    rotation: 0,
    visible: true,
    locked: false,
    zIndex,
    fill: 'transparent',
    stroke: '#2563eb',
    strokeWidth: 0.4,
    cornerRadius: 0,
    padding: { top: 2, right: 2, bottom: 2, left: 2 },
  };
}

function draftToFlowable(frame: FrameEl, zIndex: number, count: number): FlowableEl {
  const pad = frame.padding;
  return {
    id: nextId('el'),
    name: `sub-área${count}`,
    type: 'flowable',
    frameId: frame.id,
    x: frame.x + pad.left,
    y: frame.y + pad.top,
    width: Math.max(1, frame.width - pad.left - pad.right),
    height: Math.max(1, frame.height - pad.top - pad.bottom),
    rotation: 0,
    visible: true,
    locked: false,
    zIndex,
    fill: 'rgba(37,99,235,0.06)',
    stroke: '#93c5fd',
    strokeWidth: 0.3,
    flowType: 'content',
  };
}
