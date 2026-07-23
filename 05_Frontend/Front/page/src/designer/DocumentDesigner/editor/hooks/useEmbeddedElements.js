// useEmbeddedElements.js — Elements embedded inside flow areas for useDesignerState

import { useCallback } from 'react';
import { createEmbeddedElement } from '../../engine/elementFactory.js';
import { mapAreaInTree } from '../../engine/areaTreeUtils.js';

// ── Helpers for locating areas in the pool and in table cell flows ─────────────

function areaExistsInPool(areas, targetId) {
  for (const a of (areas ?? [])) {
    if (a.id === targetId) return true;
    if (a.children?.length && areaExistsInPool(a.children, targetId)) return true;
  }
  return false;
}

function hasCellFlow(tableEl, flowId) {
  for (const rs of (tableEl.rowSets ?? [])) {
    for (const c of (rs.cells ?? [])) {
      if (c.flow?.id === flowId) return true;
    }
  }
  return false;
}

function patchTableCellFlow(tableEl, flowId, patcher) {
  return {
    ...tableEl,
    rowSets: (tableEl.rowSets ?? []).map(rs => ({
      ...rs,
      cells: (rs.cells ?? []).map(c =>
        c.flow?.id === flowId ? { ...c, flow: patcher(c.flow) } : c
      ),
    })),
  };
}

// caId: the table element's own id; flowId: cell.flow.id
function findCellFlowLocation(t, caId, flowId) {
  for (let pi = 0; pi < (t.pages ?? []).length; pi++) {
    const page = t.pages[pi];
    for (let ei = 0; ei < (page.elements ?? []).length; ei++) {
      const el = page.elements[ei];
      if (el.type === 'table' && el.id === caId && hasCellFlow(el, flowId)) {
        return { type: 'page', pageIndex: pi, elIndex: ei };
      }
    }
  }
  for (let ai = 0; ai < (t.contentAreas ?? []).length; ai++) {
    const area = t.contentAreas[ai];
    for (let ei = 0; ei < (area.elements ?? []).length; ei++) {
      const el = area.elements[ei];
      if (el.type === 'table' && el.id === caId && hasCellFlow(el, flowId)) {
        return { type: 'embedded', areaIndex: ai, elIndex: ei };
      }
    }
  }
  return null;
}

function applyToTableLocation(t, location, flowId, patcher) {
  if (location.type === 'page') {
    return {
      ...t,
      pages: t.pages.map((p, pi) => pi !== location.pageIndex ? p : {
        ...p,
        elements: p.elements.map((el, ei) =>
          ei === location.elIndex ? patchTableCellFlow(el, flowId, patcher) : el
        ),
      }),
    };
  }
  if (location.type === 'embedded') {
    return {
      ...t,
      contentAreas: t.contentAreas.map((a, ai) => ai !== location.areaIndex ? a : {
        ...a,
        elements: a.elements.map((el, ei) =>
          ei === location.elIndex ? patchTableCellFlow(el, flowId, patcher) : el
        ),
      }),
    };
  }
  return t;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useEmbeddedElements(setTemplate, { setSelectedIds, setPanelContext, setLastPanelContext, setEmbeddedCtx }) {

  const addEmbeddedElement = useCallback((caId, areaId, type, overrides = {}) => {
    const defaults = type === 'table' ? { width: 120, height: 40, cols: 3, rows: 2 }
                   : type === 'image' ? { width: 60, height: 40 }
                   : { width: 60, height: 30 };
    const el = createEmbeddedElement(type, { ...defaults, ...overrides });

    let pendingImageAsset = null;
    if (type === 'image') {
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
        variableConfig: null, createdAt: now, updatedAt: now,
      };
    }

    setTemplate(t => {
      let next = t;
      if (pendingImageAsset) {
        const imgs = t.images ?? [];
        const usedNums = imgs.map(i => i.name?.match(/^Imagen\s*(\d+)$/)?.[1]).filter(Boolean).map(Number);
        const n = usedNums.length > 0 ? Math.max(...usedNums) + 1 : imgs.length + 1;
        next = { ...next, images: [...imgs, { ...pendingImageAsset, name: `Imagen ${n}` }] };
      }

      // Try contentAreas pool first (existing behavior)
      if (areaExistsInPool(next.contentAreas ?? [], areaId)) {
        return {
          ...next,
          contentAreas: (next.contentAreas ?? []).map(a => {
            if (a.id === areaId) return { ...a, elements: [...(a.elements ?? []), el], updatedAt: new Date().toISOString() };
            if (a.children?.length) {
              return { ...a, children: mapAreaInTree(a.children, areaId, sub => ({ ...sub, elements: [...(sub.elements ?? []), el], updatedAt: new Date().toISOString() })) };
            }
            return a;
          }),
        };
      }

      // areaId is a table cell flow — find and patch the table
      const location = findCellFlowLocation(next, caId, areaId);
      if (!location) {
        // Fallback: legacy inline-areas model — area lives on element.areas[]
        // Walk the pages to find the element with this caId and patch its areas[].
        let patched = false;
        const pages = (next.pages ?? []).map(page => {
          if (patched) return page;
          const els = page.elements ?? [];
          if (!els.some(e => e.id === caId)) return page;
          const newEls = els.map(e => {
            if (e.id !== caId) return e;
            const areas = e.areas ?? [];
            if (!areas.some(a => a.id === areaId)) return e;
            patched = true;
            return {
              ...e,
              areas: areas.map(a => a.id === areaId
                ? { ...a, elements: [...(a.elements ?? []), el] }
                : a
              ),
            };
          });
          return { ...page, elements: newEls };
        });
        if (patched) return { ...next, pages };
        return next;
      }
      return applyToTableLocation(next, location, areaId, flow => ({
        ...flow,
        elements: [...(flow.elements ?? []), el],
        updatedAt: new Date().toISOString(),
      }));
    });

    setEmbeddedCtx({ caId, areaId, elementId: el.id });
    setPanelContext('element');
    setLastPanelContext('element');
    return el;
  }, [setTemplate, setEmbeddedCtx, setPanelContext, setLastPanelContext]);

  const updateEmbeddedElement = useCallback((caId, areaId, elementId, changes) => {
    setTemplate(t => {
      // Try contentAreas pool first
      if (areaExistsInPool(t.contentAreas ?? [], areaId)) {
        return {
          ...t,
          contentAreas: (t.contentAreas ?? []).map(a => {
            if (a.id === areaId) return {
              ...a,
              elements: (a.elements ?? []).map(el =>
                el.embedded && el.id === elementId ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
              ),
              updatedAt: new Date().toISOString(),
            };
            if (a.children?.length) {
              return { ...a, children: mapAreaInTree(a.children, areaId, sub => ({
                ...sub,
                elements: (sub.elements ?? []).map(el =>
                  el.embedded && el.id === elementId ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
                ),
              }))};
            }
            return a;
          }),
        };
      }

      // Table cell flow
      const location = findCellFlowLocation(t, caId, areaId);
      if (!location) return t;
      return applyToTableLocation(t, location, areaId, flow => ({
        ...flow,
        elements: (flow.elements ?? []).map(el =>
          el.embedded && el.id === elementId ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
        ),
        updatedAt: new Date().toISOString(),
      }));
    });
  }, [setTemplate]);

  const removeEmbeddedElement = useCallback((caId, areaId, elementId) => {
    function stripElementTagFromContent(content) {
      if (!content) return content;
      const re = new RegExp(`<span[^>]*class="element-tag"[^>]*data-element="${elementId}"[^>]*>[^<]*</span>(&#8203;|&ZeroWidthSpace;|​)?`, 'gi');
      return content.replace(re, '');
    }

    setTemplate(t => {
      // Try contentAreas pool first
      if (areaExistsInPool(t.contentAreas ?? [], areaId)) {
        return {
          ...t,
          contentAreas: (t.contentAreas ?? []).map(a => {
            if (a.id === areaId) return {
              ...a,
              elements: (a.elements ?? []).filter(el => !(el.embedded && el.id === elementId)),
              content: stripElementTagFromContent(a.content),
              updatedAt: new Date().toISOString(),
            };
            if (a.children?.length) {
              return { ...a, children: mapAreaInTree(a.children, areaId, sub => ({
                ...sub,
                elements: (sub.elements ?? []).filter(el => !(el.embedded && el.id === elementId)),
                content: stripElementTagFromContent(sub.content),
              }))};
            }
            return a;
          }),
        };
      }

      // Table cell flow
      const location = findCellFlowLocation(t, caId, areaId);
      if (!location) return t;
      return applyToTableLocation(t, location, areaId, flow => ({
        ...flow,
        elements: (flow.elements ?? []).filter(el => !(el.embedded && el.id === elementId)),
        content: stripElementTagFromContent(flow.content),
        updatedAt: new Date().toISOString(),
      }));
    });
    setEmbeddedCtx(prev => (prev?.elementId === elementId ? null : prev));
  }, [setTemplate, setEmbeddedCtx]);

  const selectEmbeddedElement = useCallback((caId, areaId, elementId) => {
    setSelectedIds([]);
    setPanelContext('element');
    setLastPanelContext('element');
    setEmbeddedCtx(elementId ? { caId, areaId, elementId } : null);
  }, [setSelectedIds, setPanelContext, setLastPanelContext, setEmbeddedCtx]);

  const clearEmbeddedSelection = useCallback(() => {
    setEmbeddedCtx(null);
  }, [setEmbeddedCtx]);

  // Update a specific cell's content inside a table embedded in a content area.
  // Used by TableElement.commitCell when element.embedded === true.
  const updateEmbeddedTableCell = useCallback((caId, areaId, tableId, rowSetId, colId, html) => {
    function patchTable(el) {
      if (el.id !== tableId) return el;
      return {
        ...el,
        rowSets: (el.rowSets ?? []).map(r =>
          r.id !== rowSetId ? r : {
            ...r,
            cells: (r.cells ?? []).map(c =>
              c.colId !== colId ? c : {
                ...c,
                flow: { ...c.flow, content: html, updatedAt: new Date().toISOString() },
              }
            ),
          }
        ),
        updatedAt: new Date().toISOString(),
      };
    }

    setTemplate(t => {
      if (areaExistsInPool(t.contentAreas ?? [], areaId)) {
        return {
          ...t,
          contentAreas: (t.contentAreas ?? []).map(a => {
            if (a.id === areaId) return { ...a, elements: (a.elements ?? []).map(patchTable) };
            if (a.children?.length) {
              return { ...a, children: mapAreaInTree(a.children, areaId, sub => ({
                ...sub, elements: (sub.elements ?? []).map(patchTable),
              }))};
            }
            return a;
          }),
        };
      }
      const location = findCellFlowLocation(t, caId, areaId);
      if (!location) return t;
      return applyToTableLocation(t, location, areaId, flow => ({
        ...flow,
        elements: (flow.elements ?? []).map(patchTable),
      }));
    });
  }, [setTemplate]);

  return { addEmbeddedElement, updateEmbeddedElement, removeEmbeddedElement, selectEmbeddedElement, clearEmbeddedSelection, updateEmbeddedTableCell };
}
