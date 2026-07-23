// DesignCanvas.jsx — Lienzo principal del editor
import { useRef, useCallback, useState, useEffect, useLayoutEffect } from 'react';
import { mmToPx, pxToMm, getPageSizePx, PX_PER_MM } from '../../engine/units.js';
import { getShape } from '../../engine/shapeCatalog.js';
import { HorizontalRuler, VerticalRuler } from './CanvasRuler.jsx';
import CanvasStatusBar from './CanvasStatusBar.jsx';
import SelectionBox from './SelectionBox.jsx';
import ElementWrapper from './ElementWrapper.jsx';
import ElementRenderer from './elements/ElementRenderer.jsx';
import ContentAreaElement from './elements/ContentAreaElement.jsx';
import FlowOrderOverlay from './FlowOrderOverlay.jsx';
import InsertTableDialog from './elements/InsertTableDialog.jsx';
import ChartEditorModal from '../pages/ChartEditorModal.jsx';
import { buildTableFromDialogOptions } from './elements/advancedTableBuild.js';
import './designer-reset.css';
import './DesignCanvas.css';

const RULER_SIZE       = 28;
const CANVAS_PADDING   = 5;    // px, espacio mínimo alrededor de la página
const FIT_WIDTH_MARGIN_RATIO = 0.075; // ~7.5% del ancho del contenedor a cada lado (≈15% visual)
const SCROLL_BUFFER_MM = 500;  // mm de espacio de scroll más allá de cada borde
const GRID_STEP_MM     = 5;    // tamaño de celda de grilla en mm
const ARROW_SCROLL     = 40;   // px por pulsación de flecha

// Busca un elemento embebido por id dentro de un árbol de áreas; devuelve
// { el, areaId } (el área que lo contiene) o null. Usado para editar charts
// embebidos vía el modal (ruteo de update a updateEmbeddedElement).
function findEmbeddedChart(areas, id) {
  for (const a of (areas ?? [])) {
    const el = (a.elements ?? []).find(e => e.embedded && e.id === id);
    if (el) return { el, areaId: a.id };
    if (a.children?.length) {
      const hit = findEmbeddedChart(a.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

// Calcula wrapperPad{H,V} y tamaño de página para un zoom arbitrario
// (función pura de módulo para usarla fuera del ciclo de render)
function calcPad(z, wMm, hMm, cW, cH) {
  const buf = SCROLL_BUFFER_MM * PX_PER_MM * z;
  const pW  = wMm * PX_PER_MM * z;
  const pH  = hMm * PX_PER_MM * z;
  return {
    h:  cW > 0 ? Math.max(buf, Math.round((cW - pW) / 2)) : buf,
    v:  cH > 0 ? Math.max(buf, Math.round((cH - pH) / 2)) : buf,
    pW, pH,
  };
}

export default function DesignCanvas({ state }) {
  const {
    currentPage, selectedIds, activeTool, activeShape, zoom,
    addElement, selectElement, clearSelection, updateCurrentPage, updateElement,
    updatePageElement, moveElements,
    areaEditCtx, exitAreaEdit,
    showRulers, showGrid, setShowGrid, showGuides,
    setZoomLevel, unit, setUnit, zoomFitRef,
    setFloworderSource,
  } = state;

  const scrollRef     = useRef(null);   // el contenedor con scroll
  const pageRef       = useRef(null);   // la hoja blanca
  const selStart      = useRef(null);
  const createStart   = useRef(null);
  const didInitialFit = useRef(false);
  const zoomRef       = useRef(zoom);   // zoom actual (accesible en listeners DOM)
  const prevZoomRef   = useRef(zoom);   // zoom del render anterior (para fallback de centrado)
  const pageDimsRef   = useRef({ widthMm: 210, heightMm: 297 });
  const pendingScroll = useRef(null);   // { left, top } a aplicar tras re-render por zoom

  const [selRect,          setSelRect]          = useState(null);
  const [createRect,       setCreateRect]       = useState(null);
  // Advanced-table flow: the drawn zone is captured here, then the
  // InsertTableDialog opens to configure the full table.
  const [advTableRect,     setAdvTableRect]     = useState(null);
  const [cursorMm,         setCursorMm]         = useState(null);
  const [scrollPos,        setScrollPos]        = useState({ x: 0, y: 0 });
  const [scrollContainerW, setScrollContainerW] = useState(0);
  const [scrollContainerH, setScrollContainerH] = useState(0);
  // ── Mini-canvas: auto-expand + refs ──────────────────────────────────────
  const miniCanvasWrapRef     = useRef(null);
  const miniCanvasInfoRef     = useRef(null);  // updated each render after areaEditInfo is known
  const updatePageElementRef  = useRef(updatePageElement);
  updatePageElementRef.current = updatePageElement;

  useEffect(() => {
    const handleInput = () => {
      const info = miniCanvasInfoRef.current;
      if (!info) return;
      const container = miniCanvasWrapRef.current;
      if (!container) return;
      const editor = container.querySelector('.cae__editor');
      if (!editor) return;
      const overflow = editor.scrollHeight - editor.clientHeight;
      if (overflow > 2) {
        const newHeightMm = info.caEl.height + overflow / PX_PER_MM / zoomRef.current;
        updatePageElementRef.current?.(info.caEl.id, { height: Math.ceil(newHeightMm * 10) / 10 });
      }
    };
    document.addEventListener('input', handleInput, true);
    return () => document.removeEventListener('input', handleInput, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!currentPage) return null;

  const { size, orientation, margins, elements = [] } = currentPage;

  const pageSizePx = size?.preset === 'custom'
    ? (() => {
        const w = size?.width  ?? 210;
        const h = size?.height ?? 297;
        return { width: mmToPx(w, zoom), height: mmToPx(h, zoom), widthMm: w, heightMm: h };
      })()
    : getPageSizePx(size?.preset ?? 'A4', orientation ?? 'portrait', zoom);

  const { widthMm: pageWidthMm, heightMm: pageHeightMm } = pageSizePx;

  // ── Area edit mode: mini-canvas uses area dimensions ──────────────────────
  function findAreaById(areas, id) {
    for (const a of areas) {
      if (a.id === id) return a;
      if (a.children?.length) { const f = findAreaById(a.children, id); if (f) return f; }
    }
    return null;
  }

  // Search recursively through embedded tables (tables in area.elements) for an area by ID.
  function findAreaInEmbeddedTables(areas, targetId) {
    for (const a of areas) {
      for (const el of (a.elements ?? [])) {
        if (el.type !== 'table') continue;
        for (const rs of (el.rowSets ?? [])) {
          for (const cell of (rs.cells ?? [])) {
            if (!cell.flow) continue;
            if (cell.flow.id === targetId) return cell.flow;
            const sub = findAreaById(cell.flow.children ?? [], targetId);
            if (sub) return sub;
            const deep = findAreaInEmbeddedTables(cell.flow.children ?? [], targetId);
            if (deep) return deep;
          }
        }
      }
      const childDeep = findAreaInEmbeddedTables(a.children ?? [], targetId);
      if (childDeep) return childDeep;
    }
    return null;
  }

  let areaEditInfo = null;
  if (areaEditCtx) {
    const caEl = elements.find(el => el.id === areaEditCtx.caId);
    if (caEl) {
      const resolvedAreas = state?.resolveAreas?.(caEl) ?? caEl.areas ?? [];
      const area = findAreaById(resolvedAreas, areaEditCtx.areaId);
      if (area) { areaEditInfo = { caEl, area }; }
    }
  }
  // Fallback: cell flows or sub-areas inside standalone table elements
  if (!areaEditInfo && areaEditCtx) {
    const tableEl = elements.find(el => el.id === areaEditCtx.caId && el.type === 'table');
    if (tableEl) {
      let found = null;
      for (const rs of (tableEl.rowSets ?? [])) {
        if (found) break;
        for (const cell of (rs.cells ?? [])) {
          if (cell.flow?.id === areaEditCtx.areaId) { found = { caEl: tableEl, area: cell.flow, isCellSubArea: true }; break; }
          const sub = findAreaById(cell.flow?.children ?? [], areaEditCtx.areaId);
          if (sub) { found = { caEl: tableEl, area: sub, isCellSubArea: true }; break; }
        }
      }
      if (found) areaEditInfo = found;
    }
  }
  // Fallback: areas inside embedded tables within content area elements
  if (!areaEditInfo && areaEditCtx) {
    for (const caEl of elements) {
      if (caEl.type !== 'contentarea') continue;
      const resolvedAreas = state?.resolveAreas?.(caEl) ?? caEl.areas ?? [];
      const found = findAreaInEmbeddedTables(resolvedAreas, areaEditCtx.areaId);
      if (found) { areaEditInfo = { caEl, area: found, isEmbeddedSubArea: true }; break; }
    }
  }

  const isMiniCanvas = !!(areaEditCtx?.miniCanvas && areaEditInfo);  // mini-canvas view
  const isAreaMode   = isMiniCanvas;
  const widthMm  = isMiniCanvas ? areaEditInfo.caEl.width  : pageWidthMm;
  const heightMm = isMiniCanvas ? areaEditInfo.caEl.height : pageHeightMm;
  const pageW    = widthMm  * PX_PER_MM * zoom;
  const pageH    = heightMm * PX_PER_MM * zoom;

  // Sync refs used by DOM listeners (no re-render)
  zoomRef.current          = zoom;
  pageDimsRef.current      = { widthMm, heightMm };
  miniCanvasInfoRef.current = isMiniCanvas ? { caEl: areaEditInfo.caEl } : null;

  // ── Buffer de scroll: 500mm de espacio más allá de cada borde de la hoja ──
  // Garantiza que los scrollbars siempre estén visibles y que se pueda colocar
  // contenido fuera de la hoja. El buffer se escala con el zoom.
  const bufferPx = mmToPx(SCROLL_BUFFER_MM, zoom);

  // Padding horizontal: al menos bufferPx, o el necesario para centrar la hoja
  const wrapperPadH = scrollContainerW > 0
    ? Math.max(bufferPx, Math.round((scrollContainerW - pageW) / 2))
    : bufferPx;
  // Padding vertical: ídem
  const wrapperPadV = scrollContainerH > 0
    ? Math.max(bufferPx, Math.round((scrollContainerH - pageH) / 2))
    : bufferPx;

  // ── Grid background (cubre toda el área de scroll, alineado con la hoja) ──
  const gridStepPx = mmToPx(GRID_STEP_MM, zoom);
  const gridBgPos  = `${wrapperPadH % gridStepPx}px ${wrapperPadV % gridStepPx}px`;
  const gridBgSize = `${gridStepPx}px ${gridStepPx}px`;

  // ── Ruler page offsets ─────────────────────────────────────────────────────
  const hPageOffset = wrapperPadH - scrollPos.x;
  const vPageOffset = wrapperPadV - scrollPos.y;

  // ── Coord helper: client coords → mm on page ──────────────────────────────
  function canvasToMm(clientX, clientY) {
    if (!pageRef.current) return { x: 0, y: 0 };
    const r = pageRef.current.getBoundingClientRect();
    return {
      x: (clientX - r.left) / PX_PER_MM / zoom,
      y: (clientY - r.top)  / PX_PER_MM / zoom,
    };
  }

  // ── Scroll tracking ───────────────────────────────────────────────────────
  function handleScroll(e) {
    setScrollPos({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop });
  }

  // ── Ctrl+wheel / pinch zoom — listener no-pasivo para poder preventDefault ─
  // React registra onWheel como pasivo (no puede llamar preventDefault).
  // Añadimos el listener directamente al DOM con { passive: false }.
  const setZoomLevelRef = useRef(setZoomLevel);
  setZoomLevelRef.current = setZoomLevel;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const oldZ = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZ  = Math.max(0.1, Math.min(5, +((oldZ + delta).toFixed(2))));
      if (newZ === oldZ) return;

      const { widthMm: wMm, heightMm: hMm } = pageDimsRef.current;
      const cW = el.clientWidth;
      const cH = el.clientHeight;
      const rect = el.getBoundingClientRect();
      const viewX = e.clientX - rect.left;
      const viewY = e.clientY - rect.top;

      const oldP = calcPad(oldZ, wMm, hMm, cW, cH);
      const newP = calcPad(newZ, wMm, hMm, cW, cH);
      const ratio = newZ / oldZ;

      // Punto bajo el cursor en coords de página (px a zoom oldZ)
      const pageX = el.scrollLeft + viewX - oldP.h;
      const pageY = el.scrollTop  + viewY - oldP.v;

      pendingScroll.current = {
        left: pageX * ratio + newP.h - viewX,
        top:  pageY * ratio + newP.v - viewY,
      };
      setZoomLevelRef.current(newZ);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Aplica scroll pendiente DESPUÉS de que React haya re-renderizado con el nuevo zoom.
  // useLayoutEffect garantiza que se aplica antes de que el browser pinte (sin parpadeo).
  // Si pendingScroll no fue seteado (p.ej. botones +/- de la barra), hace zoom
  // alrededor del centro del viewport para que la hoja no se desplace.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevZ = prevZoomRef.current;
    prevZoomRef.current = zoom;
    if (zoom === prevZ) return;

    if (pendingScroll.current === 'fit' || pendingScroll.current === 'fit-top') {
      // DOM ya tiene el nuevo zoom aplicado → leer posición real de la página.
      const mode = pendingScroll.current;
      pendingScroll.current = null;
      applyFitScroll(el, mode);
    } else if (pendingScroll.current) {
      const { left, top } = pendingScroll.current;
      pendingScroll.current = null;
      el.scrollLeft = left;
      el.scrollTop  = top;
    } else {
      // Fallback: zoom alrededor del centro del viewport
      const { widthMm: wMm, heightMm: hMm } = pageDimsRef.current;
      const cW = el.clientWidth;
      const cH = el.clientHeight;
      const vX = cW / 2;
      const vY = cH / 2;
      const oldP = calcPad(prevZ, wMm, hMm, cW, cH);
      const newP = calcPad(zoom,  wMm, hMm, cW, cH);
      const r    = zoom / prevZ;
      el.scrollLeft = (el.scrollLeft + vX - oldP.h) * r + newP.h - vX;
      el.scrollTop  = (el.scrollTop  + vY - oldP.v) * r + newP.v - vY;
    }
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ResizeObserver: trackea el ancho del scroll container para centrado ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScrollContainerW(entry.contentRect.width);
      setScrollContainerH(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit inicial al montar: aplica fit-width con 15% de margen a cada lado ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (didInitialFit.current) return;
    didInitialFit.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        handleZoomFitWidth();
      });
    });
  }, []); // solo al montar

  // ── Re-centrado al entrar/salir de modo área ──────────────────────────────
  const isFirstAreaCtxMount = useRef(true);
  useEffect(() => {
    if (isFirstAreaCtxMount.current) { isFirstAreaCtxMount.current = false; return; }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        const { widthMm: wMm, heightMm: hMm } = pageDimsRef.current;
        const cW = el.clientWidth;
        const cH = el.clientHeight;
        const p = calcPad(zoomRef.current, wMm, hMm, cW, cH);
        el.scrollLeft = Math.round(p.h - (cW - p.pW) / 2);
        el.scrollTop  = Math.max(0, p.v - 10);
      });
    });
  }, [areaEditCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-centrado horizontal cuando el contenedor cambia de tamaño ──────────
  // (p.ej. ContextPanel se abre/cierra y el canvas-area se reduce/amplía)
  const prevContainerW = useRef(scrollContainerW);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || prevContainerW.current === 0) {
      prevContainerW.current = scrollContainerW;
      return;
    }
    const oldCW = prevContainerW.current;
    prevContainerW.current = scrollContainerW;
    if (oldCW === scrollContainerW) return;

    const z  = zoomRef.current;
    const { widthMm: wMm, heightMm: hMm } = pageDimsRef.current;
    const oldP = calcPad(z, wMm, hMm, oldCW, el.clientHeight);
    const newP = calcPad(z, wMm, hMm, scrollContainerW, el.clientHeight);

    // Mantener el mismo punto central visible
    const viewCenterX = el.scrollLeft + oldCW / 2;
    const pageX = viewCenterX - oldP.h; // posición relativa a la hoja
    el.scrollLeft = pageX + newP.h - scrollContainerW / 2;
  }, [scrollContainerW]);

  // ── Arrow-key scroll ──────────────────────────────────────────────────────
  function handleKeyDown(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (e.key === 'Escape' && areaEditCtx) { e.stopPropagation(); exitAreaEdit(); return; }
    const moves = { ArrowLeft: [-ARROW_SCROLL, 0], ArrowRight: [ARROW_SCROLL, 0],
                    ArrowUp: [0, -ARROW_SCROLL],   ArrowDown:  [0, ARROW_SCROLL] };
    const d = moves[e.key];
    if (!d) return;
    e.preventDefault();
    scrollRef.current.scrollLeft += d[0];
    scrollRef.current.scrollTop  += d[1];
  }

  // ── Zoom fit: ajusta zoom para que la hoja quepa y centra la vista ────────
  // Usamos requestAnimationFrame para garantizar que el browser haya hecho
  // layout y clientWidth/clientHeight tengan valores reales (> 0).
  // Centra la vista sobre pageRef leyendo su posición real en el DOM.
  // Evita inconsistencias con wrapperPadH calculado desde scrollContainerW (React state).
  function applyFitScroll(el, mode) {
    if (!pageRef.current) return;
    const pageRect = pageRef.current.getBoundingClientRect();
    const viewRect = el.getBoundingClientRect();
    // Posición del borde izquierdo/superior de la página en coordenadas de scroll
    const pageScrollLeft = el.scrollLeft + (pageRect.left - viewRect.left);
    const pageScrollTop  = el.scrollTop  + (pageRect.top  - viewRect.top);
    const cW = el.clientWidth;
    const cH = el.clientHeight;
    const pW = pageRect.width;
    const pH = pageRect.height;
    el.scrollLeft = pageScrollLeft - Math.max(0, Math.round((cW - pW) / 2));
    el.scrollTop  = mode === 'fit'
      ? pageScrollTop - Math.max(0, Math.round((cH - pH) / 2))
      : Math.max(0, pageScrollTop - CANVAS_PADDING);
  }

  const handleZoomFitWidth = useCallback(() => {
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const el  = scrollRef.current;
      const cW  = el.clientWidth;
      if (!cW) return;
      const fitZoom = Math.max(0.1, Math.min(5,
        (cW * (1 - 2 * FIT_WIDTH_MARGIN_RATIO)) / (widthMm * PX_PER_MM)
      ));
      if (Math.abs(fitZoom - zoomRef.current) < 0.0001) {
        applyFitScroll(el, 'fit-top');
      } else {
        pendingScroll.current = 'fit-top';
        setZoomLevel(fitZoom);
      }
    });
  }, [widthMm, setZoomLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleZoomFit = useCallback(() => {
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const el = scrollRef.current;
      const cW = el.clientWidth;
      const cH = el.clientHeight;
      if (!cW || !cH) return;
      const fitZoom = Math.max(0.1, Math.min(5,
        Math.min(
          (cW - 2 * CANVAS_PADDING) / (widthMm  * PX_PER_MM),
          (cH - 2 * CANVAS_PADDING) / (heightMm * PX_PER_MM),
        )
      ));
      if (Math.abs(fitZoom - zoomRef.current) < 0.0001) {
        applyFitScroll(el, 'fit');
      } else {
        pendingScroll.current = 'fit';
        setZoomLevel(fitZoom);
      }
    });
  }, [widthMm, heightMm, setZoomLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Registra handleZoomFit en el ref del state para que el toolbar de arriba
  // también pueda llamar al fit real (con centrado), no solo setZoom(1.0).
  useEffect(() => {
    if (zoomFitRef) zoomFitRef.current = handleZoomFitWidth;
    return () => { if (zoomFitRef) zoomFitRef.current = null; };
  }, [handleZoomFitWidth, zoomFitRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse events ──────────────────────────────────────────────────────────
  function handleDoubleClick(e) {
    if (!isAreaMode) return;
    const isGray = e.target === scrollRef.current || e.target.classList.contains('dc-page-wrapper');
    if (isGray) exitAreaEdit();
  }

  function handleMouseDown(e) {
    if (e.button !== 0) return;
    if (activeTool === 'floworder') {
      // Los clics sobre áreas los maneja FlowOrderOverlay; clic en vacío desarma.
      const isBg =
        e.target === scrollRef.current ||
        e.target.classList.contains('dc-page') ||
        e.target.classList.contains('dc-page-inner') ||
        e.target.classList.contains('dc-page-wrapper');
      if (isBg) setFloworderSource?.(null);
      return;
    }
    if (activeTool === 'select') {
      const isCanvasBg =
        e.target === scrollRef.current ||
        e.target.classList.contains('dc-page') ||
        e.target.classList.contains('dc-page-inner') ||
        e.target.classList.contains('dc-page-wrapper');
      if (isCanvasBg) {
        clearSelection();
        state.clearEmbeddedSelection?.();
        const pageRect = pageRef.current.getBoundingClientRect();
        selStart.current = { x: e.clientX - pageRect.left, y: e.clientY - pageRect.top };
        setSelRect(null);
      }
      return;
    }
    const pos = canvasToMm(e.clientX, e.clientY);
    createStart.current = pos;
    e.preventDefault();
  }

  function handleMouseMove(e) {
    const mm = canvasToMm(e.clientX, e.clientY);
    // Solo mostrar coords cuando el cursor está dentro de la hoja
    if (mm.x >= 0 && mm.x <= widthMm && mm.y >= 0 && mm.y <= heightMm) {
      setCursorMm(mm);
    } else {
      setCursorMm(null);
    }

    if (selStart.current) {
      const pageRect = pageRef.current.getBoundingClientRect();
      setSelRect({
        x: selStart.current.x,
        y: selStart.current.y,
        width:  e.clientX - pageRect.left - selStart.current.x,
        height: e.clientY - pageRect.top  - selStart.current.y,
      });
    }

    if (createStart.current && activeTool !== 'select') {
      const z = zoomRef.current;
      const sx = mmToPx(createStart.current.x, z);
      const sy = mmToPx(createStart.current.y, z);
      const cx = mmToPx(mm.x, z);
      const cy = mmToPx(mm.y, z);
      setCreateRect({
        x:      Math.min(sx, cx),
        y:      Math.min(sy, cy),
        width:  Math.abs(cx - sx),
        height: Math.abs(cy - sy),
      });
    }
  }

  function handleMouseUp(e) {
    if (selStart.current) {
      const start = selStart.current;
      const pageRect = pageRef.current.getBoundingClientRect();
      const endX = e.clientX - pageRect.left;
      const endY = e.clientY - pageRect.top;
      const normX = Math.min(start.x, endX);
      const normY = Math.min(start.y, endY);
      const normW = Math.abs(endX - start.x);
      const normH = Math.abs(endY - start.y);

      if (normW > 3 || normH > 3) {
        const z = zoom;
        const toSelect = elements.filter(el => {
          if (el.locked) return false;
          const elX = mmToPx(el.x, z);
          const elY = mmToPx(el.y, z);
          const elW = mmToPx(el.width, z);
          const elH = mmToPx(el.height, z);
          return elX < normX + normW && elX + elW > normX &&
                 elY < normY + normH && elY + elH > normY;
        });
        toSelect.forEach((el, i) => selectElement(el.id, i > 0));
      }
      selStart.current = null;
      setSelRect(null);
    }
    setCreateRect(null);
    if (createStart.current && activeTool !== 'select') {
      const pos = canvasToMm(e.clientX, e.clientY);
      let x = Math.min(createStart.current.x, pos.x);
      let y = Math.min(createStart.current.y, pos.y);
      let w = Math.abs(pos.x - createStart.current.x);
      let h = Math.abs(pos.y - createStart.current.y);
      // Formas "open" (líneas/flechas): no forzar alto a 40 (deben poder ser finas).
      const openShape = activeTool === 'shape' && getShape(activeShape)?.kind === 'open';
      if (w < 5) w = activeTool === 'text' ? 80 : activeTool === 'table' ? 120 : activeTool === 'barcode' ? 60 : activeTool === 'chart' ? 100 : activeTool === 'contentarea' ? 120 : openShape ? 60 : 40;
      if (h < 5) h = activeTool === 'text' ? 20 : activeTool === 'table' ? 40  : activeTool === 'barcode' ? 15 : activeTool === 'chart' ? 70 : activeTool === 'contentarea' ? 60  : openShape ? 1  : 40;
      // Advanced table: capture the drawn zone and open the dialog instead of
      // inserting a plain table; the dialog confirm builds the full table here.
      if (activeTool === 'table' && state.advancedTableMode) {
        setAdvTableRect({ x: Math.max(0, x), y: Math.max(0, y), width: w, height: h });
        state.setAdvancedTableMode?.(false);
        state.setActiveTool?.('select');
        createStart.current = null;
        return;
      }
      const extra = activeTool === 'shape' ? { shape: activeShape } : {};
      addElement(activeTool, { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h, ...extra });
      createStart.current = null;
    }
  }

  function handleMouseLeave() {
    selStart.current = null;
    setSelRect(null);
    createStart.current = null;
    setCreateRect(null);
    setCursorMm(null);
  }

  function handleDragOver(e) {
    if (e.dataTransfer.types.includes('application/x-image-asset')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDrop(e) {
    const assetId = e.dataTransfer.getData('application/x-image-asset');
    if (!assetId) return;
    e.preventDefault();
    const pos = canvasToMm(e.clientX, e.clientY);
    const x = Math.max(0, Math.round(pos.x * 10) / 10 - 25);
    const y = Math.max(0, Math.round(pos.y * 10) / 10 - 25);
    addElement('image', { x, y, width: 50, height: 50, assetId });
  }

  // ── Element callbacks ──────────────────────────────────────────────────────
  const handleSelectEl = useCallback((id, additive) => {
    selectElement(id, additive);
  }, [selectElement]);

  const handleUpdateEl = useCallback((id, changes) => {
    updateElement(id, changes);
  }, [updateElement]);

  // ── Drag de grupo (mover todos los elementos seleccionados juntos) ──────────
  // ElementWrapper coordina el gesto; aquí guardamos el delta (mm) para el
  // preview en vivo (cada wrapper seleccionado se desplaza por `groupDrag`) y al
  // soltar lo aplicamos a todos en un solo cambio (un paso de undo).
  const [groupDrag, setGroupDrag] = useState(null);   // { dx, dy } en mm | null
  const groupDragMinRef = useRef(null);               // { minX, minY } al iniciar

  const handleGroupDragStart = useCallback(() => {
    const sel = (currentPage?.elements ?? []).filter(el => selectedIds.includes(el.id));
    groupDragMinRef.current = sel.length
      ? { minX: Math.min(...sel.map(el => el.x)), minY: Math.min(...sel.map(el => el.y)) }
      : null;
  }, [currentPage, selectedIds]);

  // Acota el delta para que ningún elemento cruce el borde (x/y < 0),
  // conservando las posiciones relativas del grupo.
  const clampGroupDelta = useCallback((dx, dy) => {
    const m = groupDragMinRef.current;
    if (!m) return { dx, dy };
    return { dx: Math.max(dx, -m.minX), dy: Math.max(dy, -m.minY) };
  }, []);

  const handleGroupDragMove = useCallback((dx, dy) => {
    setGroupDrag(clampGroupDelta(dx, dy));
  }, [clampGroupDelta]);

  const handleGroupDragEnd = useCallback((dx, dy) => {
    const d = clampGroupDelta(dx, dy);
    setGroupDrag(null);
    groupDragMinRef.current = null;
    if (d.dx || d.dy) moveElements?.(selectedIds, d.dx, d.dy);
  }, [clampGroupDelta, selectedIds, moveElements]);

  // ── Margins ───────────────────────────────────────────────────────────────
  const mTop    = mmToPx(margins?.top    ?? 20, zoom);
  const mRight  = mmToPx(margins?.right  ?? 20, zoom);
  const mBottom = mmToPx(margins?.bottom ?? 20, zoom);
  const mLeft   = mmToPx(margins?.left   ?? 20, zoom);

  // ── Wrapper background: grid extendido fuera de la hoja ───────────────────
  const wrapperStyle = {
    paddingTop:    wrapperPadV,
    paddingBottom: wrapperPadV,
    paddingLeft:   wrapperPadH,
    paddingRight:  wrapperPadH,
    ...(showGrid ? {
      backgroundImage: `
        linear-gradient(to right,  rgba(148,163,184,0.25) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)
      `,
      backgroundSize:     gridBgSize,
      backgroundPosition: gridBgPos,
    } : {}),
  };

  // Created once per render instead of once per element inside the map.
  const canvasState = {
    ...state,
    zoom,
  };

  return (
    <div className="dc-root">
      {/* ── Mini-canvas banner (pencil/sidebar area edit) ── */}
      {isMiniCanvas && areaEditInfo && (
        <div className="dc-area-banner dc-area-banner--mini">
          <span className="dc-area-banner__text">
            Mini-canvas · <strong>{areaEditInfo.area?.label || areaEditCtx.areaId}</strong>
            {'  ·  '}{widthMm.toFixed(0)} × {heightMm.toFixed(0)} mm
          </span>
          <button className="dc-area-banner__exit" onClick={exitAreaEdit}>
            Salir (Esc)
          </button>
        </div>
      )}

      {/* ── Rulers row ── */}
      {showRulers && (
        <div className="dc-ruler-row">
          <div className="dc-ruler-corner" style={{ width: RULER_SIZE, height: RULER_SIZE }} />
          <div className="dc-ruler-h">
            <HorizontalRuler pageOffsetPx={hPageOffset} zoom={zoom} unit={unit} />
          </div>
        </div>
      )}

      {/* ── Main row: vertical ruler + canvas ── */}
      <div className="dc-row">
        {showRulers && (
          <div className="dc-ruler-v" style={{ width: RULER_SIZE }}>
            <VerticalRuler pageOffsetPx={vPageOffset} zoom={zoom} unit={unit} />
          </div>
        )}

        {/* Canvas scroll area */}
        <div
          ref={scrollRef}
          className="dc-scroll"
          tabIndex={0}
          style={{ cursor: activeTool === 'select' ? 'default' : 'crosshair' }}
          onScroll={handleScroll}
          onDoubleClick={handleDoubleClick}
          onMouseDown={(e) => { if (e.button === 0) scrollRef.current?.focus({ preventScroll: true }); handleMouseDown(e); }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onKeyDown={handleKeyDown}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="dc-page-wrapper" style={wrapperStyle}>
            <div
              ref={pageRef}
              className={`dc-page${isAreaMode ? ' dc-page--area-mode' : ''}`}
              style={{
                width:  pageW,
                height: pageH,
                background: isAreaMode ? '#fff' : (currentPage.background?.color ?? '#ffffff'),
                position: 'relative',
                boxShadow: isAreaMode
                  ? '0 0 0 2px #7c3aed, 0 4px 24px rgba(124,58,237,0.25)'
                  : '0 4px 24px rgba(0,0,0,0.18)',
                overflow: isAreaMode ? 'visible' : 'hidden',
              }}
            >
              {/* Grid inside page — continuous with the wrapper grid */}
              {showGrid && (
                <div style={{
                  position: 'absolute', inset: 0,
                  backgroundImage: `
                    linear-gradient(to right,  rgba(148,163,184,0.25) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)
                  `,
                  backgroundSize:     gridBgSize,
                  backgroundPosition: '0 0',
                  pointerEvents: 'none', zIndex: 0,
                }} />
              )}
              {/* Margins — only in page mode */}
              {showGuides && !isAreaMode && (
                <div className="dc-margins" style={{
                  position: 'absolute',
                  top: mTop, right: mRight, bottom: mBottom, left: mLeft,
                  border: '1px dashed rgba(59,130,246,0.4)',
                  pointerEvents: 'none', zIndex: 1,
                }} />
              )}
              {/* Elements */}
              <div className="dc-page-inner" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>

                {/* Page mode: render all page elements */}
                {!isMiniCanvas && elements.map(el => (
                  <ElementWrapper
                    key={el.id}
                    element={el} zoom={zoom}
                    selected={selectedIds.includes(el.id)}
                    selectedCount={selectedIds.length}
                    dragOffset={groupDrag && selectedIds.includes(el.id) ? groupDrag : null}
                    onSelect={handleSelectEl}
                    onUpdate={(ch) => handleUpdateEl(el.id, ch)}
                    onGroupDragStart={handleGroupDragStart}
                    onGroupDragMove={handleGroupDragMove}
                    onGroupDragEnd={handleGroupDragEnd}
                    onContextMenu={() => {}}
                    onDoubleClick={undefined}
                  >
                    <ElementRenderer element={el} state={canvasState} />
                  </ElementWrapper>
                ))}

                {/* Orden de desbordamiento: flechas de cadena + zonas clicables */}
                {!isMiniCanvas && (
                  <FlowOrderOverlay state={state} elements={elements} zoom={zoom} />
                )}

                {/* Mini-canvas mode: render the area as an editable ContentAreaElement */}
                {isMiniCanvas && (() => {
                  const syntheticEl = (areaEditInfo.isCellSubArea || areaEditInfo.isEmbeddedSubArea)
                    ? { ...areaEditInfo.caEl, x: 0, y: 0, areaRef: undefined, areas: [areaEditInfo.area] }
                    : { ...areaEditInfo.caEl, x: 0, y: 0, width: areaEditInfo.caEl.width, height: areaEditInfo.caEl.height, areaRef: areaEditCtx.areaId };
                  return (
                    <div ref={miniCanvasWrapRef} style={{
                      position: 'absolute',
                      left:   0,
                      top:    0,
                      width:  areaEditInfo.caEl.width  * PX_PER_MM * zoom,
                      height: areaEditInfo.caEl.height * PX_PER_MM * zoom,
                      zIndex: 0,
                    }}>
                      <ContentAreaElement element={syntheticEl} state={state} />
                    </div>
                  );
                })()}

                {/* Mini-canvas: drag handle to resize height */}
                {isMiniCanvas && (
                  <div
                    className="dc-mini-resize-handle"
                    style={{
                      top:   areaEditInfo.caEl.height * PX_PER_MM * zoom,
                      width: areaEditInfo.caEl.width  * PX_PER_MM * zoom,
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const startY   = e.clientY;
                      const startH   = areaEditInfo.caEl.height;
                      const caElId   = areaEditInfo.caEl.id;
                      const zVal     = zoomRef.current;
                      const handleEl = e.currentTarget;
                      const wrapEl   = miniCanvasWrapRef.current;
                      let pendingH   = startH;
                      const onMove  = (ev) => {
                        const dy = (ev.clientY - startY) / PX_PER_MM / zVal;
                        pendingH = Math.max(5, Math.round((startH + dy) * 10) / 10);
                        // Mueve el handle y el área directo en DOM — sin React update durante drag
                        if (handleEl) handleEl.style.top  = `${pendingH * PX_PER_MM * zVal}px`;
                        if (wrapEl)   wrapEl.style.height = `${pendingH * PX_PER_MM * zVal}px`;
                      };
                      const onUp = () => {
                        updatePageElementRef.current?.(caElId, { height: pendingH });
                        window.removeEventListener('mousemove', onMove);
                        window.removeEventListener('mouseup', onUp);
                      };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp);
                    }}
                  />
                )}

              </div>
              {/* Create-drag preview */}
              {createRect && createRect.width > 2 && createRect.height > 2 && (
                <div style={{
                  position: 'absolute',
                  left: createRect.x, top: createRect.y,
                  width: createRect.width, height: createRect.height,
                  border: '1.5px dashed var(--color-node-design, #3b82f6)',
                  background: 'rgba(59,130,246,0.07)',
                  pointerEvents: 'none',
                  zIndex: 100,
                  boxSizing: 'border-box',
                }} />
              )}
              <SelectionBox rect={selRect} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Status bar ── */}
      <CanvasStatusBar
        cursorMm={cursorMm}
        pageSizeMm={{ w: widthMm, h: heightMm }}
        unit={unit}
        setUnit={setUnit}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        zoom={zoom}
        setZoomLevel={setZoomLevel}
        onZoomFit={handleZoomFit}
        onZoomFitWidth={handleZoomFitWidth}
        cursorPath={state.editorCursorPath}
      />

      {/* ── Advanced table: configure the drawn zone, then build the full table ── */}
      {advTableRect && (
        <InsertTableDialog
          availableFields={state.availableFields ?? []}
          onConfirm={options => {
            const built = buildTableFromDialogOptions(options, state);
            addElement('table', { ...advTableRect, ...built });
            setAdvTableRect(null);
          }}
          onCancel={() => setAdvTableRect(null)}
        />
      )}

      {/* ── Editor de gráfico (doble-clic en chart o botón del panel) ── */}
      {state.chartEditorElId && (() => {
        const id = state.chartEditorElId;
        const allEls = (state.template?.pages ?? []).flatMap(p => p.elements ?? []);
        // 1. Chart de página (standalone)
        const pageEl = elements.find(e => e.id === id) ?? allEls.find(e => e.id === id);
        if (pageEl?.type === 'chart') {
          return (
            <ChartEditorModal
              element={pageEl}
              fillStyles={state.template?.styles?.fill ?? []}
              colors={state.template?.colors ?? []}
              textStyles={state.template?.styles?.text ?? []}
              availableFields={state.availableFields ?? []}
              onAddFillStyle={state.addFillStyle}
              onNavigateFill={id => state.setPanelContext?.('fillStyle:' + id)}
              onUpdate={ch => updateElement(pageEl.id, ch)}
              onClose={state.closeChartEditor}
            />
          );
        }
        // 2. Chart embebido en un content area → ruteo a updateEmbeddedElement
        for (const caEl of allEls) {
          if (caEl.type !== 'contentarea') continue;
          const areas = state.resolveAreas?.(caEl) ?? caEl.areas ?? [];
          const hit = findEmbeddedChart(areas, id);
          if (hit && hit.el.type === 'chart') {
            return (
              <ChartEditorModal
                element={hit.el}
                fillStyles={state.template?.styles?.fill ?? []}
                colors={state.template?.colors ?? []}
                availableFields={state.availableFields ?? []}
              onAddFillStyle={state.addFillStyle}
              onNavigateFill={id => state.setPanelContext?.('fillStyle:' + id)}
                onUpdate={ch => state.updateEmbeddedElement?.(caEl.id, hit.areaId, id, ch)}
                onClose={state.closeChartEditor}
              />
            );
          }
        }
        return null;
      })()}
    </div>
  );
}
