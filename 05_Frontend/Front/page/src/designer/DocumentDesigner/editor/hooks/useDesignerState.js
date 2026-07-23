// useDesignerState.js — Estado central del editor de documentos
import { useState, useCallback, useRef, useMemo } from 'react';
import {
  createEmptyTemplate, createElement, cloneElement, updateElement,
  createPage,
  createContentArea, createEmbeddedElement,
} from '../../engine/elementFactory.js';
import {
  findAreaById, mapAreaInTree,
} from '../../engine/areaTreeUtils.js';
import { migrateTemplate } from '../../engine/templateMigration.js';
import { findOrCreateColor } from '../../engine/colorRegistry.js';
import { findOrCreateBorderStyle } from '../../engine/borderStyleFactory.js';
import { ensureFillStyleId } from '../../engine/tableResourceLink.js';
import { getShape } from '../../engine/shapeCatalog.js';
import { createDefaultBorderStyle } from '../resources/border/borderStyleDefaults.js';
import { useHistory } from './useHistory.js';
import { useTextParagraphStyles } from './useTextParagraphStyles.js';
import { useBorderFillStyles } from './useBorderFillStyles.js';
import { useBulletNumbering } from './useBulletNumbering.js';
import { useColorResources } from './useColorResources.js';
import { useAssetResources } from './useAssetResources.js';
import { useEmbeddedElements } from './useEmbeddedElements.js';
import { useAreaMutations } from './useAreaMutations.js';
import { useTableRowSets } from './useTableRowSets.js';
import { useTableOperations } from './useTableOperations.js';
import { collectAllAreaNums } from '../canvas/elements/contentAreaUtils.js';

function _scanAllTableElements(tmpl, fn) {
  for (const page of (tmpl?.pages ?? []))
    for (const el of (page.elements ?? [])) fn(el);
  for (const ca of (tmpl?.contentAreas ?? []))
    for (const el of (ca.elements ?? [])) fn(el);
}

function _countAllTableCells(tmpl) {
  let count = 0;
  _scanAllTableElements(tmpl, el => {
    if (el?.type !== 'table') return;
    for (const rs of (el.rowSets ?? [])) count += (rs.cells ?? []).length;
  });
  return count;
}

function _countAllTables(tmpl) {
  let count = 0;
  _scanAllTableElements(tmpl, el => { if (el?.type === 'table') count++; });
  return count;
}

function _countAllRowSets(tmpl) {
  let count = 0;
  _scanAllTableElements(tmpl, el => {
    if (el?.type === 'table') count += (el.rowSets ?? []).length;
  });
  return count;
}

export function useDesignerState(initialTemplate) {

  // ── Template ───────────────────────────────────────────────────────────────
  const [template, _setTemplate] = useState(() =>
    migrateTemplate(initialTemplate ?? createEmptyTemplate())
  );

  // ── UI state ───────────────────────────────────────────────────────────────
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedIds,   setSelectedIds]   = useState([]);
  const [panelContext,  _setPanelContext]  = useState('pagesConfig');
  const [lastPanelContext, setLastPanelContext] = useState('pagesConfig');
  const [activeTool,    setActiveTool]    = useState('select');
  const [activeShape,   setActiveShape]   = useState('rectangle');
  // When true, drawing a table zone opens the InsertTableDialog (advanced) and
  // builds a full table from the chosen options instead of a plain grid.
  const [advancedTableMode, setAdvancedTableMode] = useState(false);
  const [zoom,          setZoom]          = useState(1.0);
  const [isDragging,    setIsDragging]    = useState(false);
  const [isResizing,    setIsResizing]    = useState(false);
  const [clipboard,     setClipboard]     = useState(null);
  const [showGuides,    setShowGuides]    = useState(true);
  const [showRulers,    setShowRulers]    = useState(true);
  const [showGrid,      setShowGrid]      = useState(false);
  const [snapEnabled,   setSnapEnabled]   = useState(true);
  const [unit,          setUnit]          = useState('mm');
  const [areaEditCtx,         _setAreaEditCtx]         = useState(null);
  const [focusedAreaCtx,      setFocusedAreaCtx]       = useState(null);
  const [previewAreaCtx,      setPreviewAreaCtx]       = useState(null);
  const [embeddedElementCtx,  _setEmbeddedElementCtx]  = useState(null);
  const [editorCursorPath, setEditorCursorPath] = useState(null);
  const areaEditCtxRef = useRef(null);
  const activeEditorRef = useRef(null);
  const activeEditorMetaRef = useRef(null);
  const tableGridDimsRef = useRef({ cols: 3, rows: 2 });

  // ── History ────────────────────────────────────────────────────────────────
  const restoreTemplate = useCallback((t) => { _setTemplate(t); setSelectedIds([]); }, []);
  // `template` en el primer render es el template inicial migrado → siembra el
  // present para que el PRIMER cambio ya sea reversible (useRef ignora el valor
  // en renders posteriores).
  const history = useHistory(restoreTemplate, template);

  // Espejo SÍNCRONO del último template comprometido. Sirve para (a) mutaciones
  // encadenadas en el mismo handler (auto-link de colores/bordes, ver abajo) y
  // (b) registrar el historial FUERA del updater de React: así `record` corre
  // exactamente una vez por cambio, evitando el doble-invoke del updater en
  // StrictMode que, en operaciones compuestas (varios setTemplate en un tick),
  // duplicaba estados y hacía el undo errático.
  const templatePendingRef = useRef(template);
  // Si React commitea un template por una vía que NO pasa por setTemplate
  // (undo/redo vía restoreTemplate, carga externa), resincroniza el ref.
  if (templatePendingRef.current !== template) templatePendingRef.current = template;

  const setTemplate = useCallback((updater) => {
    const prev = templatePendingRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;            // no-op: no ensucia el historial
    templatePendingRef.current = next;    // espejo síncrono para llamadas encadenadas
    history.record(next);                 // se registra una sola vez (fuera del updater)
    _setTemplate(next);
  }, [history]);

  // ── Sub-hooks ──────────────────────────────────────────────────────────────
  const textParagraphStyles = useTextParagraphStyles(template, setTemplate);
  const borderFillStyles    = useBorderFillStyles(template, setTemplate);
  const bulletNumbering     = useBulletNumbering(template, setTemplate);
  const colorResources      = useColorResources(template, setTemplate);
  const assetResources      = useAssetResources(setTemplate);

  // ── Auto-link helpers ──────────────────────────────────────────────────────
  // Registran síncronamente un color/estilo de borde en el template si no existe
  // y devuelven su id. Usados por flujos de auto-link (p. ej. insertar una tabla
  // desde el dialog: cada color → entrada de paleta; cada borde de sección →
  // estilo con nombre; si la misma forma aparece dos veces, la segunda llamada
  // devuelve el id existente). Leen `templatePendingRef` (espejo síncrono,
  // declarado arriba) para que las llamadas encadenadas en el mismo handler vean
  // el estado más reciente. `setTemplate` ya actualiza ese ref, así que aquí solo
  // hace falta computar `next` y delegar en él.
  const findOrCreateColorSync = useCallback((hex) => {
    const { template: next, colorId } = findOrCreateColor(templatePendingRef.current, hex);
    if (next !== templatePendingRef.current) setTemplate(next);
    return colorId;
  }, [setTemplate]);

  const findOrCreateBorderStyleSync = useCallback((config) => {
    const { template: next, styleId } = findOrCreateBorderStyle(templatePendingRef.current, config);
    if (next !== templatePendingRef.current) setTemplate(next);
    return styleId;
  }, [setTemplate]);

  // Al crear una FORMA: relleno y borde se UNIFICAN en UN solo recurso — un
  // border style (Model B) que lleva la línea Y el "relleno interior" (shading).
  // Ese shading ES el relleno de la forma. Cadena: border style → (línea y
  // relleno) → fill style → color, todo en Recursos y editable centralmente.
  // El border style es ÚNICO por forma (no se deduplica) para que editarlo no
  // afecte a otras formas. Los colores/fill styles sí se reutilizan (paleta).
  const resourcifyShapeResources = useCallback((el) => {
    const isOpen = getShape(el.shape).kind === 'open';
    let t = templatePendingRef.current;

    // Color de línea → fill style (paleta, deduped por color)
    const lineHex = isOpen
      ? (el.lineStyle?.color ?? el.border?.unified?.color ?? '#1f2937')
      : (el.border?.unified?.color ?? '#9ca3af');
    const rl = ensureFillStyleId(t, lineHex);
    t = rl.t;

    // Relleno interior (shading) — solo formas cerradas — → fill style (paleta)
    let fillFillStyleId = null;
    if (!isOpen) {
      const fillHex = (el.fill?.type === 'solid' && el.fill.color) ? el.fill.color : '#e5e7eb';
      const rf = ensureFillStyleId(t, fillHex);
      t = rf.t;
      fillFillStyleId = rf.fillStyleId;
    }

    // Border style único por forma: línea (grosor visible) + relleno interior.
    // SIN flag `system` → gcOrphanBorderStyles no lo borra (solo toca system+celdas).
    const bsId = `bs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const bs = {
      ...createDefaultBorderStyle(isOpen ? 'Forma · línea' : 'Forma · borde'),
      id: bsId,
      lineWidth: isOpen ? 1.2 : 0.75,
      lineStyle: 'solid',
      lineColor: lineHex,
      lineFillStyleId: rl.fillStyleId,
      fill: '',
      fillFillStyleId,                    // ← relleno interior = relleno de la forma
    };
    t = { ...t, styles: { ...t.styles, border: [...(t.styles?.border ?? []), bs] } };

    if (t !== templatePendingRef.current) setTemplate(t);   // eager → actualiza ref + historial
    // El relleno de la forma vive en el border style; element.fill = none.
    return { ...el, fill: { type: 'none' }, border: { styleRef: bsId, mode: 'unified' }, lineStyle: null };
  }, [setTemplate]);

  const embeddedElements    = useEmbeddedElements(setTemplate, {
    setSelectedIds,
    setPanelContext: _setPanelContext,
    setLastPanelContext,
    setEmbeddedCtx: _setEmbeddedElementCtx,
  });

  const areaMutations = useAreaMutations(template, setTemplate, currentPageIndex);

  const tableRowSets = useTableRowSets(template, setTemplate, {
    areaEditCtxRef,
    setAreaEditCtx: _setAreaEditCtx,
  });

  // ── Computed ───────────────────────────────────────────────────────────────
  const pages       = template.pages ?? [];
  const currentPage = pages[currentPageIndex] ?? pages[0] ?? null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function updateCurrentPage(pageUpdater) {
    setTemplate(t => ({
      ...t,
      pages: t.pages.map((p, i) =>
        i === currentPageIndex
          ? {
              ...(typeof pageUpdater === 'function' ? pageUpdater(p) : { ...p, ...pageUpdater }),
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
  }

  function updatePageById(pageId, changes) {
    setTemplate(t => ({
      ...t,
      pages: t.pages.map(p =>
        p.id === pageId ? { ...p, ...changes, updatedAt: new Date().toISOString() } : p
      ),
    }));
  }

  // ── Table operations + cell selection ──────────────────────────────────
  const tableOps = useTableOperations({ currentPage, updateCurrentPage, setTemplate });
  // tableCellSelection = { tableElId, cells: [{ rowSetId, colId }] } | null
  const [tableCellSelection, setTableCellSelection] = useState(null);
  const clearTableCellSelection = useCallback(() => setTableCellSelection(null), []);
  // Word-like "Copiar borde" (border painter): { active, width, color } | null.
  // When active, clicking a table cell paints the pen onto its borders.
  const [borderPainter, setBorderPainter] = useState(null);

  // ── Editor de gráfico (Chart) ───────────────────────────────────────────
  // Id del elemento chart cuyo modal está abierto (o null). Lo abren tanto el
  // doble-clic en el canvas como el botón "Editar gráfico…" del panel.
  const [chartEditorElId, setChartEditorElId] = useState(null);
  const openChartEditor  = useCallback((elId) => setChartEditorElId(elId), []);
  const closeChartEditor = useCallback(() => setChartEditorElId(null), []);

  // ── Orden de desbordamiento (Flow Order) ────────────────────────────────
  // Cuando activeTool === 'floworder', clicar áreas encadena su desbordamiento.
  // floworderSource = id del elemento contentarea "armado" como origen (o null).
  const [floworderSource, setFloworderSource] = useState(null);
  // Mostrar las flechas de orden de desbordamiento aunque la herramienta no esté activa.
  const [showFlowArrowsAlways, setShowFlowArrowsAlways] = useState(false);

  const updatePagesConfig = useCallback((changes) => {
    setTemplate(t => ({
      ...t,
      pagesConfig: { ...t.pagesConfig, ...changes },
    }));
  }, []);

  // ── Orden de desbordamiento: enlazar / desenlazar áreas de contenido ─────
  // Enlaza src → dst (src.nextAreaRef = dst, dst.previousAreaRef = src), limpia
  // enlaces colaterales para mantener la cadena consistente (1 next y 1 previous
  // por área) y evita ciclos. Si están en páginas distintas marca flowToNextPage.
  const linkFlowAreas = useCallback((srcElId, dstElId) => {
    if (!srcElId || !dstElId || srcElId === dstElId) return;
    setTemplate(t => {
      let srcPageIdx = -1, dstPageIdx = -1;
      t.pages.forEach((p, i) => {
        if (p.elements.some(e => e.id === srcElId)) srcPageIdx = i;
        if (p.elements.some(e => e.id === dstElId)) dstPageIdx = i;
      });
      if (srcPageIdx < 0 || dstPageIdx < 0) return t;

      const all = t.pages.flatMap(p => p.elements);
      // Evitar ciclos: si siguiendo next desde dst llegamos a src, abortar.
      let cur = dstElId, guard = 0;
      while (cur && guard++ < 1000) {
        if (cur === srcElId) return t;
        cur = all.find(e => e.id === cur)?.nextAreaRef ?? null;
      }
      const src = all.find(e => e.id === srcElId);
      const dst = all.find(e => e.id === dstElId);
      const oldDstOfSrc = src?.nextAreaRef ?? null;     // a quién apuntaba src
      const oldSrcOfDst = dst?.previousAreaRef ?? null;  // quién apuntaba a dst
      const crossPage = srcPageIdx !== dstPageIdx;
      const now = new Date().toISOString();

      return {
        ...t,
        pages: t.pages.map(p => ({
          ...p,
          elements: p.elements.map(el => {
            // Excluyente: enlazar a otra área quita el auto-desbordamiento del origen.
            if (el.id === srcElId) return { ...el, nextAreaRef: dstElId, selfOverflow: false, flowToNextPage: crossPage || !!el.flowToNextPage, updatedAt: now };
            if (el.id === dstElId) return { ...el, previousAreaRef: srcElId, updatedAt: now };
            if (el.id === oldDstOfSrc && el.id !== dstElId) return { ...el, previousAreaRef: null, updatedAt: now };
            if (el.id === oldSrcOfDst && el.id !== srcElId) return { ...el, nextAreaRef: null, updatedAt: now };
            return el;
          }),
        })),
      };
    });
  }, []);

  // Saca un área de su cadena: limpia su next/previous y repara a los vecinos.
  const unlinkFlowArea = useCallback((elId) => {
    if (!elId) return;
    setTemplate(t => {
      const all = t.pages.flatMap(p => p.elements);
      const el = all.find(e => e.id === elId);
      if (!el) return t;
      const nextId = el.nextAreaRef ?? null;
      const prevId = el.previousAreaRef ?? null;
      const now = new Date().toISOString();
      return {
        ...t,
        pages: t.pages.map(p => ({
          ...p,
          elements: p.elements.map(e => {
            if (e.id === elId)   return { ...e, nextAreaRef: null, previousAreaRef: null, selfOverflow: false, flowToNextPage: false, updatedAt: now };
            if (e.id === nextId) return { ...e, previousAreaRef: null, updatedAt: now };
            if (e.id === prevId) return { ...e, nextAreaRef: null, updatedAt: now };
            return e;
          }),
        })),
      };
    });
  }, []);

  // Auto-desbordamiento: el área desborda sobre SÍ MISMA (repite página y continúa
  // aquí). Excluyente con encadenar a otra área → al activarlo se saca de la cadena.
  // El área NO se bloquea (sigue editable) porque NO es una continuación.
  const toggleSelfOverflow = useCallback((elId) => {
    if (!elId) return;
    setTemplate(t => {
      const all = t.pages.flatMap(p => p.elements ?? []);
      const el = all.find(e => e.id === elId);
      if (!el) return t;
      const turnOn = !el.selfOverflow;
      const nextId = el.nextAreaRef ?? null;
      const prevId = el.previousAreaRef ?? null;
      const now = new Date().toISOString();
      return {
        ...t,
        pages: t.pages.map(p => ({
          ...p,
          elements: p.elements.map(e => {
            if (e.id === elId) {
              // al activar: sácalo de cualquier cadena (excluyente). selfOverflow = "el overflow
              // continúa en ESTA misma área"; si eso es en la misma hoja o en la página siguiente lo
              // decide flowToNextPage por separado (NO se fuerza: se respeta el valor del usuario).
              return turnOn
                ? { ...e, selfOverflow: true, nextAreaRef: null, previousAreaRef: null, updatedAt: now }
                : { ...e, selfOverflow: false, updatedAt: now };
            }
            // repara vecinos al sacarlo de la cadena
            if (turnOn && e.id === nextId) return { ...e, previousAreaRef: null, updatedAt: now };
            if (turnOn && e.id === prevId) return { ...e, nextAreaRef: null, updatedAt: now };
            return e;
          }),
        })),
      };
    });
  }, []);

  // Click de la herramienta: 1er click arma el origen; click sobre el MISMO área
  // lo desarma; click sobre OTRA área enlaza y deja el destino armado para seguir
  // la cadena. (El auto-desbordamiento se activa con doble-clic o con el chip ↻.)
  const floworderClickArea = useCallback((elId) => {
    setFloworderSource(prev => {
      if (!prev) return elId;
      if (prev === elId) return null;
      linkFlowAreas(prev, elId);
      return elId;
    });
  }, [linkFlowAreas]);

  // ── Area-edit element helpers (used by addElement / updateElement / removeElement) ─

  function _updateAreaElements(p, caId, areaId, updater) {
    const pool = template.contentAreas ?? [];
    const areaInPool = pool.some(a => a.id === areaId || findAreaById(a.children ?? [], areaId));
    if (areaInPool) return p; // handled via setTemplate in pool path
    return {
      ...p,
      elements: p.elements.map(pageEl =>
        pageEl.id !== caId ? pageEl : {
          ...pageEl,
          areas: mapAreaInTree(pageEl.areas ?? [], areaId, a => ({ ...updater(a), updatedAt: new Date().toISOString() })),
          updatedAt: new Date().toISOString(),
        }
      ),
    };
  }

  function _updatePoolAreaElements(caId, areaId, updater) {
    setTemplate(t => ({
      ...t,
      contentAreas: (t.contentAreas ?? []).map(a => {
        if (a.id === areaId) return { ...updater(a), updatedAt: new Date().toISOString() };
        if (a.children?.length) {
          return { ...a, children: mapAreaInTree(a.children, areaId, sub => ({ ...updater(sub), updatedAt: new Date().toISOString() })) };
        }
        return a;
      }),
    }));
  }

  // ── Elementos ──────────────────────────────────────────────────────────────

  const addElement = useCallback((type, position) => {
    const pos = type === 'table'
      ? {
          ...position,
          ...tableGridDimsRef.current,
          tableNum:     _countAllTables(template) + 1,
          startRowNum:  _countAllRowSets(template) + 1,
          startCellNum: _countAllTableCells(template) + 1,
        }
      : position;

    // Auto-wrap tables in a ContentArea when drawn on the canvas
    if (type === 'table' && !areaEditCtxRef.current) {
      const caEl = createContentArea({ x: pos.x, y: pos.y, width: pos.width ?? 170, height: pos.height ?? 60 });
      const pendingArea = caEl._pendingArea;
      delete caEl._pendingArea;

      const allCA = (template.pages ?? []).flatMap(p => p.elements ?? []).filter(e => e.type === 'contentarea');
      caEl.label = `Content Area ${allCA.length + 1}`;
      caEl.dynamicHeight = true;

      const usedNums = collectAllAreaNums(template);
      pendingArea.label = `Área ${usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1}`;

      const tblEl = createEmbeddedElement('table', {
        width: caEl.width,
        height: caEl.height,
        cols:         pos.cols ?? 3,
        rows:         pos.rows ?? 1,
        tableNum:     pos.tableNum ?? 1,
        startRowNum:  pos.startRowNum ?? 1,
        startCellNum: pos.startCellNum ?? 1,
        ...(pos.columns && pos.rowSets && pos.rootRowSetId
          ? { columns: pos.columns, rowSets: pos.rowSets, rootRowSetId: pos.rootRowSetId }
          : {}),
        // Advanced table (from the InsertTableDialog) carries table-level
        // border/corner config — forward it to the factory.
        ...(pos.borderStyleId ? { borderStyleId: pos.borderStyleId } : {}),
        ...(pos.tableRadius   != null ? { tableRadius: pos.tableRadius } : {}),
        ...(pos.tableCorners  ? { tableCorners: pos.tableCorners } : {}),
        ...(pos.outerBorder   ? { outerBorder: pos.outerBorder } : {}),
        ...(pos.cellCornersAll != null ? { cellCornersAll: pos.cellCornersAll } : {}),
      });

      pendingArea.elements = [tblEl];
      pendingArea.content = `<span class="element-tag" data-element="${tblEl.id}" data-type="table" contenteditable="false">◆ Tabla</span>​`;

      setTemplate(t => ({
        ...t,
        contentAreas: [...(t.contentAreas ?? []), pendingArea],
        pages: t.pages.map((p, i) =>
          i !== currentPageIndex ? p
          : { ...p, elements: [...(p.elements ?? []), caEl], updatedAt: new Date().toISOString() }
        ),
      }));

      setSelectedIds([caEl.id]);
      setActiveTool('select');
      return caEl;
    }

    let el = createElement(type, pos);

    if (type === 'contentarea') {
      const allCA = (template.pages ?? []).flatMap(p => p.elements ?? []).filter(e => e.type === 'contentarea');
      el.label = `Content Area ${allCA.length + 1}`;
    }

    // Formas: relleno/borde como recursos reutilizables (Fill/Color/Border Style).
    if (type === 'shape') el = resourcifyShapeResources(el);

    const ctx = areaEditCtxRef.current;
    const pendingArea = el._pendingArea;
    if (pendingArea) {
      delete el._pendingArea;
      const usedNums = collectAllAreaNums(template);
      pendingArea.label = `Área ${usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1}`;
    }

    let pendingImageAsset = null;
    if (type === 'image' && !position?.assetId) {
      const assetId = `img_asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      el.source = { kind: 'asset', assetId };
      const now = new Date().toISOString();
      pendingImageAsset = {
        id: assetId, assetKind: 'static',
        source: { kind: 'static', url: '' },
        properties: {
          useImageDpi: true, dpiX: 96, dpiY: 96,
          resizeWidth: false, resizeHeight: false,
          resizeWidthValue: 50, resizeHeightValue: 50,
          resizeUnit: 'mm', maintainAspectRatio: true,
          useDifferentSizeForHtml: false, htmlWidth: '', htmlHeight: '',
          altText: '', useAlphaChannel: true,
        },
        variableConfig: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    function withImageAsset(t) {
      if (!pendingImageAsset) return t;
      const existing = t.images ?? [];
      const usedNums = existing
        .map(img => img.name?.match(/^Imagen\s*(\d+)$/)?.[1])
        .filter(Boolean)
        .map(Number);
      const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
      return { ...t, images: [...existing, { ...pendingImageAsset, name: `Imagen ${next}` }] };
    }

    if (ctx) {
      const pool = template.contentAreas ?? [];
      const inPool = pool.some(a => a.id === ctx.areaId || findAreaById(a.children ?? [], ctx.areaId));
      if (inPool) {
        setTemplate(t => {
          let next = pendingArea
            ? { ...t, contentAreas: [...(t.contentAreas ?? []), pendingArea] }
            : t;
          next = withImageAsset(next);
          next = {
            ...next,
            contentAreas: (next.contentAreas ?? []).map(a => {
              if (a.id === ctx.areaId) return { ...a, elements: [...(a.elements ?? []), el], updatedAt: new Date().toISOString() };
              if (a.children?.length) {
                return { ...a, children: mapAreaInTree(a.children, ctx.areaId, sub => ({ ...sub, elements: [...(sub.elements ?? []), el], updatedAt: new Date().toISOString() })) };
              }
              return a;
            }),
          };
          return next;
        });
      } else {
        if (pendingArea || pendingImageAsset) {
          setTemplate(t => {
            let next = pendingArea ? { ...t, contentAreas: [...(t.contentAreas ?? []), pendingArea] } : t;
            return withImageAsset(next);
          });
        }
        updateCurrentPage(p => _updateAreaElements(p, ctx.caId, ctx.areaId,
          a => ({ ...a, elements: [...(a.elements ?? []), el] })
        ));
      }
    } else {
      if (pendingArea || pendingImageAsset) {
        setTemplate(t => {
          let next = pendingArea
            ? { ...t, contentAreas: [...(t.contentAreas ?? []), pendingArea] }
            : t;
          next = withImageAsset(next);
          return {
            ...next,
            pages: next.pages.map((p, i) =>
              i === currentPageIndex
                ? { ...p, elements: [...(p.elements ?? []), el], updatedAt: new Date().toISOString() }
                : p
            ),
          };
        });
      } else {
        updateCurrentPage(p => ({ ...p, elements: [...(p.elements ?? []), el] }));
      }
    }
    setSelectedIds([el.id]);
    setActiveTool('select');
    return el;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, template]);

  const updatePageElement = useCallback((id, changes) => {
    updateCurrentPage(p => ({
      ...p,
      elements: p.elements.map(el => el.id === id ? updateElement(el, changes) : el),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex]);

  const updateElement_ = useCallback((id, changes) => {
    const ctx = areaEditCtxRef.current;
    // A page element (e.g. the ContentArea host itself being resized/moved)
    // must always update on the page, even while an area-edit context is
    // active. Without this guard the change is routed into the area's
    // embedded elements, never matches, and is silently dropped — so the
    // ContentArea snaps back to its previous size after a resize.
    const isPageEl = (template?.pages?.[currentPageIndex]?.elements ?? [])
      .some(el => el.id === id);
    if (ctx && !isPageEl) {
      const pool = template.contentAreas ?? [];
      const inPool = pool.some(a => a.id === ctx.areaId || findAreaById(a.children ?? [], ctx.areaId));
      if (inPool) {
        _updatePoolAreaElements(ctx.caId, ctx.areaId,
          a => ({ ...a, elements: (a.elements ?? []).map(el => el.id === id ? updateElement(el, changes) : el) })
        );
      } else {
        updateCurrentPage(p => _updateAreaElements(p, ctx.caId, ctx.areaId,
          a => ({ ...a, elements: a.elements.map(el => el.id === id ? updateElement(el, changes) : el) })
        ));
      }
    } else {
      updateCurrentPage(p => ({
        ...p,
        elements: p.elements.map(el => el.id === id ? updateElement(el, changes) : el),
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, template]);

  const removeElements = useCallback((ids) => {
    const s = new Set(ids);
    const ctx = areaEditCtxRef.current;
    if (ctx) {
      const pool = template.contentAreas ?? [];
      const inPool = pool.some(a => a.id === ctx.areaId || findAreaById(a.children ?? [], ctx.areaId));
      if (inPool) {
        _updatePoolAreaElements(ctx.caId, ctx.areaId,
          a => ({ ...a, elements: (a.elements ?? []).filter(el => !s.has(el.id)) })
        );
      } else {
        updateCurrentPage(p => _updateAreaElements(p, ctx.caId, ctx.areaId,
          a => ({ ...a, elements: a.elements.filter(el => !s.has(el.id)) })
        ));
      }
    } else {
      updateCurrentPage(p => ({ ...p, elements: p.elements.filter(el => !s.has(el.id)) }));
    }
    setSelectedIds(prev => prev.filter(id => !s.has(id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, template]);

  const alignElements = useCallback((type) => {
    const selected = (currentPage?.elements ?? []).filter(el => selectedIds.includes(el.id));
    if (selected.length < 2) return;

    const minX      = Math.min(...selected.map(el => el.x));
    const minY      = Math.min(...selected.map(el => el.y));
    const maxRight  = Math.max(...selected.map(el => el.x + el.width));
    const maxBottom = Math.max(...selected.map(el => el.y + el.height));
    const midX      = (minX + maxRight) / 2;
    const midY      = (minY + maxBottom) / 2;

    let posMap = null;

    if (type === 'distributeH' && selected.length >= 3) {
      const sorted = [...selected].sort((a, b) => (a.x + a.width / 2) - (b.x + b.width / 2));
      const totalW  = sorted.reduce((s, el) => s + el.width, 0);
      const gap     = (maxRight - minX - totalW) / (sorted.length - 1);
      posMap = {};
      let cursor = minX;
      sorted.forEach(el => { posMap[el.id] = { x: cursor }; cursor += el.width + gap; });
    } else if (type === 'distributeV' && selected.length >= 3) {
      const sorted = [...selected].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2));
      const totalH  = sorted.reduce((s, el) => s + el.height, 0);
      const gap     = (maxBottom - minY - totalH) / (sorted.length - 1);
      posMap = {};
      let cursor = minY;
      sorted.forEach(el => { posMap[el.id] = { y: cursor }; cursor += el.height + gap; });
    }

    const getNewPos = (el) => {
      if (posMap) return posMap[el.id] ?? {};
      switch (type) {
        case 'left':    return { x: minX };
        case 'centerH': return { x: midX - el.width  / 2 };
        case 'right':   return { x: maxRight  - el.width  };
        case 'top':     return { y: minY };
        case 'middleV': return { y: midY - el.height / 2 };
        case 'bottom':  return { y: maxBottom - el.height };
        default:        return {};
      }
    };

    const selectedSet = new Set(selectedIds);
    updateCurrentPage(p => ({
      ...p,
      elements: p.elements.map(el =>
        selectedSet.has(el.id) ? updateElement(el, getNewPos(el)) : el
      ),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, currentPage, selectedIds]);

  // Mueve TODOS los elementos indicados por un delta (mm) en un solo cambio
  // (un paso de undo). El delta se asume ya acotado por el llamador (drag de
  // grupo) para que ningún elemento quede en negativo; el Math.max(0,…) es
  // defensivo y no distorsiona las posiciones relativas cuando el delta ya viene
  // acotado.
  const moveElements = useCallback((ids, dx, dy) => {
    if (!dx && !dy) return;
    const s = new Set(ids);
    updateCurrentPage(p => ({
      ...p,
      elements: p.elements.map(el =>
        s.has(el.id)
          ? updateElement(el, { x: Math.max(0, el.x + dx), y: Math.max(0, el.y + dy) })
          : el
      ),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex]);

  const duplicateElements = useCallback((ids) => {
    const s = new Set(ids);
    let clones = [];
    updateCurrentPage(p => {
      clones = p.elements.filter(el => s.has(el.id)).map(cloneElement);
      return { ...p, elements: [...p.elements, ...clones] };
    });
    setSelectedIds(clones.map(e => e.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex]);

  function zOrder(id, fn) {
    updateCurrentPage(p => {
      const els = [...p.elements];
      const i = els.findIndex(e => e.id === id);
      if (i !== -1) fn(els, i);
      return { ...p, elements: els };
    });
  }

  const bringForward = useCallback((id) => zOrder(id, (els, i) => { if (i < els.length - 1) [els[i], els[i+1]] = [els[i+1], els[i]]; }), [currentPageIndex]);
  const sendBackward = useCallback((id) => zOrder(id, (els, i) => { if (i > 0) [els[i], els[i-1]] = [els[i-1], els[i]]; }), [currentPageIndex]);
  const bringToFront = useCallback((id) => zOrder(id, (els, i) => els.push(els.splice(i, 1)[0])),   [currentPageIndex]);
  const sendToBack   = useCallback((id) => zOrder(id, (els, i) => els.unshift(els.splice(i, 1)[0])), [currentPageIndex]);

  // ── Selección ──────────────────────────────────────────────────────────────

  const setPanelContext = useCallback((ctx) => {
    _setPanelContext(ctx);
    if (ctx) setLastPanelContext(ctx);
    if (ctx && ctx !== 'element') setSelectedIds([]);
  }, []);

  const navigateToResource = useCallback((ctx) => {
    _setPanelContext(ctx);
    if (ctx) setLastPanelContext(ctx);
  }, []);

  const selectElement = useCallback((id, additive = false) => {
    _setEmbeddedElementCtx(null);
    if (!id) {
      setSelectedIds([]);
      _setPanelContext(prev => prev === 'element' ? null : prev);
      return;
    }
    _setPanelContext(prev => prev === 'element' ? prev : 'element');
    setLastPanelContext(prev => prev === 'element' ? prev : 'element');
    setFocusedAreaCtx(prev => prev === null ? prev : null);
    setSelectedIds(prev => {
      if (additive) {
        return prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
      }
      if (prev.length === 1 && prev[0] === id) return prev;
      return [id];
    });
  }, []);

  const selectAll     = useCallback(() => setSelectedIds((currentPage?.elements ?? []).map(e => e.id)), [currentPage]);
  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    _setPanelContext(prev => prev === 'element' ? null : prev);
  }, []);

  // ── Clipboard ──────────────────────────────────────────────────────────────

  const copySelected = useCallback(() => {
    const toCopy = (currentPage?.elements ?? []).filter(e => selectedIds.includes(e.id));
    if (toCopy.length > 0) setClipboard(toCopy);
  }, [currentPage, selectedIds]);

  const paste = useCallback(() => {
    if (!clipboard?.length) return;
    const clones = clipboard.map(cloneElement);
    updateCurrentPage(p => ({ ...p, elements: [...p.elements, ...clones] }));
    setSelectedIds(clones.map(c => c.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboard, currentPageIndex]);

  // ── Páginas ────────────────────────────────────────────────────────────────

  const addPage = useCallback((overrides = {}) => {
    const newPage = createPage({ name: `Página ${pages.length + 1}`, ...overrides });
    setTemplate(t => ({ ...t, pages: [...t.pages, newPage] }));
    setCurrentPageIndex(pages.length);
    return newPage;
  }, [pages.length]);

  const removePage = useCallback((pageId) => {
    if (pages.length <= 1) return;
    setTemplate(t => ({ ...t, pages: t.pages.filter(p => p.id !== pageId) }));
    setCurrentPageIndex(prev => Math.min(prev, pages.length - 2));
    setSelectedIds([]);
  }, [pages]);

  const duplicatePage = useCallback((pageId) => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return;
    const clone = {
      ...JSON.parse(JSON.stringify(page)),
      id: `pg_${Date.now()}`,
      name: `${page.name} (copia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      elements: page.elements.map(el => ({ ...el, id: `${el.id}_c` })),
    };
    const idx = pages.findIndex(p => p.id === pageId);
    setTemplate(t => {
      const arr = [...t.pages];
      arr.splice(idx + 1, 0, clone);
      return { ...t, pages: arr };
    });
    setCurrentPageIndex(idx + 1);
  }, [pages]);

  const movePage = useCallback((fromIndex, toIndex) => {
    setTemplate(t => {
      const arr = [...t.pages];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return { ...t, pages: arr };
    });
    setCurrentPageIndex(toIndex);
  }, []);

  // ── Meta ───────────────────────────────────────────────────────────────────

  const updateMeta = useCallback((changes) => {
    setTemplate(t => ({ ...t, meta: { ...t.meta, ...changes, updatedAt: new Date().toISOString() } }));
  }, []);

  // ── Zoom ───────────────────────────────────────────────────────────────────

  const setZoomLevel = useCallback((value) => {
    setZoom(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      return Math.max(0.1, Math.min(5, next));
    });
  }, []);

  const zoomIn    = useCallback(() => setZoomLevel(z => z + 0.1), [setZoomLevel]);
  const zoomOut   = useCallback(() => setZoomLevel(z => z - 0.1), [setZoomLevel]);
  const zoomFitRef = useRef(null);
  const zoomFit   = useCallback(() => {
    if (zoomFitRef.current) zoomFitRef.current();
    else setZoomLevel(1.0);
  }, [setZoomLevel]);

  // ── Area edit mode ─────────────────────────────────────────────────────────

  const enterAreaEdit = useCallback((caId, areaId, { miniCanvas = false } = {}) => {
    const ctx = { caId, areaId, miniCanvas };
    areaEditCtxRef.current = ctx;
    _setAreaEditCtx(ctx);
    setFocusedAreaCtx({ caId, areaId });
    setSelectedIds([]);
    setActiveTool('select');
  }, []);

  const exitAreaEdit = useCallback(() => {
    const caId = areaEditCtxRef.current?.caId ?? null;
    areaEditCtxRef.current = null;
    _setAreaEditCtx(null);
    setFocusedAreaCtx(null);
    if (caId) {
      setSelectedIds([caId]);
      _setPanelContext('element');
      setLastPanelContext('element');
    } else {
      setSelectedIds([]);
    }
  }, []);

  // ── Content Areas — resolver ───────────────────────────────────────────────

  function resolveAreas(el) {
    if (el?.areaRef) {
      for (const a of (template.contentAreas ?? [])) {
        if (a.id === el.areaRef) return [a];
        const child = findAreaById(a.children ?? [], el.areaRef);
        if (child) return [child];
      }
      return [];
    }
    return el?.areas ?? [];
  }

  // ── Text style usage search ────────────────────────────────────────────────

  const getTextStyleUsage = useCallback((textStyleId) => {
    const usages = [];
    for (const page of template.pages ?? []) {
      for (const el of page.elements ?? []) {
        if (el.type === 'text' && el.textStyleId === textStyleId) {
          usages.push({ type: 'element', pageId: page.id, pageName: page.name, elementId: el.id, label: el.label });
        }
      }
    }
    function searchAreas(areas) {
      for (const area of areas ?? []) {
        if (area.defaultTextStyleId === textStyleId) {
          usages.push({ type: 'area', areaId: area.id, label: area.label });
        }
        if ((area.inlineStyleRefs ?? []).includes(textStyleId)) {
          usages.push({ type: 'inline', areaId: area.id, label: area.label });
        }
        for (const el of area.elements ?? []) {
          if (el.type === 'text' && el.textStyleId === textStyleId) {
            usages.push({ type: 'element-in-area', areaId: area.id, elementId: el.id, label: el.label });
          }
        }
        if (area.children?.length) searchAreas(area.children);
      }
    }
    searchAreas(template.contentAreas);
    return usages;
  }, [template]);

  // ── Toolbar-visible content areas (includes active cell flow) ─────────────

  const contentAreas = useMemo(() => {
    const base = template.contentAreas ?? [];
    if (!areaEditCtx) return base;
    const page = template.pages?.[currentPageIndex] ?? null;
    if (!page) return base;
    const tableEl = (page.elements ?? []).find(
      e => e.id === areaEditCtx.caId && e.type === 'table'
    );
    if (!tableEl) return base;
    let cellFlow = null;
    for (const rs of tableEl.rowSets ?? []) {
      for (const cell of rs.cells ?? []) {
        if (cell.flow?.id === areaEditCtx.areaId) { cellFlow = cell.flow; break; }
      }
      if (cellFlow) break;
    }
    if (!cellFlow || base.some(a => a.id === cellFlow.id)) return base;
    return [...base, cellFlow];
  }, [template, areaEditCtx, currentPageIndex]);

  // ── Cross-page element helpers (used by resource sections) ────────────────

  const updateAnyElement = useCallback((elId, changes) => {
    setTemplate(t => ({
      ...t,
      pages: (t.pages ?? []).map(p => ({
        ...p,
        elements: (p.elements ?? []).map(el =>
          el.id === elId ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
        ),
      })),
    }));
  }, []);

  const removeAnyElement = useCallback((elId) => {
    setTemplate(t => ({
      ...t,
      pages: (t.pages ?? []).map(p => ({
        ...p,
        elements: (p.elements ?? []).filter(el => el.id !== elId),
      })),
    }));
  }, []);

  const clonePageElement = useCallback((elId) => {
    setTemplate(t => {
      for (const p of (t.pages ?? [])) {
        const el = (p.elements ?? []).find(e => e.id === elId);
        if (!el) continue;
        const newId = `${el.type[0]}${Math.random().toString(36).slice(2, 7)}`;
        const clone = JSON.parse(JSON.stringify({
          ...el, id: newId, x: (el.x ?? 0) + 5, y: (el.y ?? 0) + 5,
          updatedAt: new Date().toISOString(),
        }));
        delete clone._pendingArea;
        let newCAs = t.contentAreas ?? [];
        if (el.type === 'contentarea' && el.areaRef) {
          const refArea = newCAs.find(a => a.id === el.areaRef);
          if (refArea) {
            const clonedArea = JSON.parse(JSON.stringify({
              ...refArea, id: `area_${Math.random().toString(36).slice(2, 8)}`,
            }));
            clone.areaRef = clonedArea.id;
            newCAs = [...newCAs, clonedArea];
          }
        }
        return {
          ...t,
          contentAreas: newCAs,
          pages: (t.pages ?? []).map(pg =>
            pg === p ? { ...pg, elements: [...pg.elements, clone] } : pg
          ),
        };
      }
      return t;
    });
  }, []);

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    // Template
    template, pages, currentPageIndex, currentPage,
    // UI
    selectedIds, panelContext, lastPanelContext,
    activeTool, activeShape, zoom,
    advancedTableMode, setAdvancedTableMode,
    isDragging, isResizing, clipboard,
    showGuides, showRulers, showGrid, snapEnabled, unit,
    areaEditCtx, focusedAreaCtx, previewAreaCtx, setPreviewAreaCtx,
    embeddedElementCtx,

    // Table rowset state (from useTableRowSets)
    ...tableRowSets,

    // Table CRUD operations (insert/remove rows/cols, distribute, merge, ...)
    ...tableOps,

    // Multi-cell selection (drag or shift/ctrl-click to select cells)
    tableCellSelection, setTableCellSelection, clearTableCellSelection,
    borderPainter, setBorderPainter,

    // Editor de gráfico
    chartEditorElId, openChartEditor, closeChartEditor,

    // Orden de desbordamiento (Flow Order)
    floworderSource, setFloworderSource,
    showFlowArrowsAlways, setShowFlowArrowsAlways,
    linkFlowAreas, unlinkFlowArea, floworderClickArea, toggleSelfOverflow,

    // Setters
    setCurrentPageIndex: (idx) => {
      setCurrentPageIndex(typeof idx === 'function' ? idx(currentPageIndex) : idx);
      setSelectedIds([]);
    },
    setPanelContext, navigateToResource,
    setActiveTool, setActiveShape, setIsDragging, setIsResizing,
    setTableGridDims: (dims) => { tableGridDimsRef.current = dims; },
    setShowGuides, setShowRulers, setShowGrid, setSnapEnabled, setUnit,

    // Template mutations
    setTemplate, updateMeta,
    updateCurrentPage, updatePageById, updatePagesConfig,

    // Elementos
    addElement, updateElement: updateElement_, updatePageElement,
    removeElements, duplicateElements, alignElements, moveElements,
    bringForward, sendBackward, bringToFront, sendToBack,

    // Toolbar-visible content areas
    contentAreas,

    // Area edit
    enterAreaEdit, exitAreaEdit,
    setFocusedAreaCtx, activeEditorRef, activeEditorMetaRef,
    resolveAreas,
    editorCursorPath, setEditorCursorPath,

    // Area mutations (from useAreaMutations)
    ...areaMutations,

    // Text + Paragraph styles
    ...textParagraphStyles,

    // Border + Fill styles
    ...borderFillStyles,

    // Viñetas y numeración (recurso reutilizable)
    ...bulletNumbering,

    // Color resources
    ...colorResources,
    // Auto-link helpers (color + border style)
    findOrCreateColor: findOrCreateColorSync,
    findOrCreateBorderStyle: findOrCreateBorderStyleSync,

    // Image + Font assets
    ...assetResources,

    // Selección
    selectElement, selectAll, clearSelection,

    // Embedded elements
    ...embeddedElements,

    // Cross-page element helpers
    updateAnyElement, removeAnyElement, clonePageElement,

    // Clipboard
    copySelected, paste,

    // Páginas
    addPage, removePage, duplicatePage, movePage,

    // Zoom
    setZoomLevel, zoomIn, zoomOut, zoomFit, zoomFitRef,

    // Text style usage search
    getTextStyleUsage,

    // History
    undo: history.undo, redo: history.redo,
    canUndo: history.canUndo, canRedo: history.canRedo,
  };
}
