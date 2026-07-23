// useAreaMutations.js — CRUD mutations for content areas (pool, sub-areas, cell flows)
import { useCallback } from 'react';
import { createSimpleArea } from '../../engine/elementFactory.js';
import {
  findAreaById, mapAreaInTree, removeAreaFromTree,
  addChildToAreaInTree, reorderAreaInTree,
} from '../../engine/areaTreeUtils.js';
import { collectAllAreaNums } from '../canvas/elements/contentAreaUtils.js';

function searchAreaInEmbeddedCellsOfArea(area, targetId) {
  for (const el of (area.elements ?? [])) {
    if (el.type !== 'table') continue;
    for (const rs of (el.rowSets ?? [])) {
      for (const cell of (rs.cells ?? [])) {
        if (!cell.flow) continue;
        if (cell.flow.id === targetId) return true;
        if (findAreaById(cell.flow.children ?? [], targetId)) return true;
      }
    }
  }
  for (const child of (area.children ?? [])) {
    if (searchAreaInEmbeddedCellsOfArea(child, targetId)) return true;
  }
  return false;
}

function updateAreaInEmbeddedCellsOfArea(area, targetId, fn) {
  return {
    ...area,
    elements: (area.elements ?? []).map(el => {
      if (el.type !== 'table') return el;
      return {
        ...el,
        rowSets: (el.rowSets ?? []).map(rs => ({
          ...rs,
          cells: (rs.cells ?? []).map(c => {
            if (!c.flow) return c;
            if (c.flow.id === targetId) return { ...c, flow: fn(c.flow) };
            return { ...c, flow: { ...c.flow, children: mapAreaInTree(c.flow.children ?? [], targetId, fn) } };
          }),
        })),
      };
    }),
    children: (area.children ?? []).map(child => updateAreaInEmbeddedCellsOfArea(child, targetId, fn)),
  };
}

export function useAreaMutations(template, setTemplate, currentPageIndex) {

  const addContentArea = useCallback((label) => {
    const id = `area_${Math.random().toString(36).slice(2, 8)}`;
    setTemplate(t => {
      const usedNums = collectAllAreaNums(t);
      const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1;
      const name = label ?? `Área ${next}`;
      const newArea = { ...createSimpleArea({ label: name, height: 30 }), id };
      return { ...t, contentAreas: [...(t.contentAreas ?? []), newArea] };
    });
    return id;
  }, [setTemplate]);

  const updateContentArea = useCallback((areaId, changes) => {
    setTemplate(t => {
      if ((t.contentAreas ?? []).some(a => a.id === areaId)) {
        return {
          ...t,
          contentAreas: (t.contentAreas ?? []).map(a =>
            a.id === areaId ? { ...a, ...changes, updatedAt: new Date().toISOString() } : a
          ),
        };
      }
      // Fallback: table cell flow embedded in a table element on a page
      const newPages = (t.pages ?? []).map(page => ({
        ...page,
        elements: (page.elements ?? []).map(el => {
          if (el.type !== 'table') return el;
          let hit = false;
          const newRowSets = (el.rowSets ?? []).map(rs => ({
            ...rs,
            cells: (rs.cells ?? []).map(cell => {
              if (!cell.flow || cell.flow.id !== areaId) return cell;
              hit = true;
              return { ...cell, flow: { ...cell.flow, ...changes, updatedAt: new Date().toISOString() } };
            }),
          }));
          return hit ? { ...el, rowSets: newRowSets, updatedAt: new Date().toISOString() } : el;
        }),
      }));
      return { ...t, pages: newPages };
    });
  }, [setTemplate]);

  const removeContentArea = useCallback((areaId) => {
    setTemplate(t => ({
      ...t,
      contentAreas: (t.contentAreas ?? []).filter(a => a.id !== areaId),
    }));
  }, [setTemplate]);

  const getContentAreaUsage = useCallback((areaId) => {
    const usages = [];
    for (const page of template.pages ?? []) {
      for (const el of page.elements ?? []) {
        if (el.type === 'contentarea' && el.areaRef === areaId) {
          usages.push({ pageId: page.id, pageName: page.name, elementId: el.id });
        }
      }
    }
    return usages;
  }, [template]);

  const updateArea = useCallback((caId, areaId, changes) => {
    const inPool = (template.contentAreas ?? []).some(a => a.id === areaId || findAreaById(a.children ?? [], areaId));
    if (inPool) {
      setTemplate(t => ({
        ...t,
        contentAreas: (t.contentAreas ?? []).map(a => {
          if (a.id === areaId) return { ...a, ...changes, updatedAt: new Date().toISOString() };
          if (a.children?.length) {
            const mapped = mapAreaInTree(a.children, areaId, sub => ({ ...sub, ...changes }));
            if (mapped !== a.children) return { ...a, children: mapped, updatedAt: new Date().toISOString() };
          }
          return a;
        }),
      }));
      return;
    }

    const poolAreaWithEmbedded = (template.contentAreas ?? []).find(a => searchAreaInEmbeddedCellsOfArea(a, areaId));
    if (poolAreaWithEmbedded) {
      setTemplate(t => ({
        ...t,
        contentAreas: (t.contentAreas ?? []).map(a =>
          a.id === poolAreaWithEmbedded.id
            ? updateAreaInEmbeddedCellsOfArea(a, areaId, sub => ({ ...sub, ...changes, updatedAt: new Date().toISOString() }))
            : a
        ),
      }));
      return;
    }

    const inCellFlow = (template.pages ?? []).some(p =>
      (p.elements ?? []).some(el =>
        el.type === 'table' && (el.rowSets ?? []).some(rs =>
          (rs.cells ?? []).some(c => findAreaById(c.flow?.children ?? [], areaId))
        )
      )
    );
    if (inCellFlow) {
      setTemplate(t => ({
        ...t,
        pages: (t.pages ?? []).map(p => ({
          ...p,
          elements: (p.elements ?? []).map(el => {
            if (el.type !== 'table') return el;
            const newRowSets = (el.rowSets ?? []).map(rs => ({
              ...rs,
              cells: (rs.cells ?? []).map(c => {
                if (!c.flow) return c;
                const newChildren = mapAreaInTree(c.flow.children ?? [], areaId, a => ({ ...a, ...changes }));
                if (newChildren === c.flow.children) return c;
                return { ...c, flow: { ...c.flow, children: newChildren, updatedAt: new Date().toISOString() } };
              }),
            }));
            return { ...el, rowSets: newRowSets, updatedAt: new Date().toISOString() };
          }),
        })),
      }));
      return;
    }

    // Fallback: old model (element.areas on page)
    setTemplate(t => ({
      ...t,
      pages: t.pages.map((p, i) =>
        i !== currentPageIndex ? p : {
          ...p,
          updatedAt: new Date().toISOString(),
          elements: p.elements.map(el =>
            el.id !== caId ? el : {
              ...el,
              areas: mapAreaInTree(el.areas ?? [], areaId, a => ({ ...a, ...changes })),
              updatedAt: new Date().toISOString(),
            }
          ),
        }
      ),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, template]);

  const addArea = useCallback((caId, parentAreaId = null, initialProps = {}) => {
    const newId = `area_${Math.random().toString(36).slice(2, 8)}`;

    if (parentAreaId) {
      const inPool = (template.contentAreas ?? []).some(a =>
        a.id === parentAreaId || findAreaById(a.children ?? [], parentAreaId)
      );
      if (inPool) {
        setTemplate(t => {
          const pool = t.contentAreas ?? [];
          const usedNums = collectAllAreaNums(t);
          const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1;
          const newArea = { ...createSimpleArea({ label: `Área ${next}`, height: 30 }), id: newId, ...initialProps };
          return {
            ...t,
            contentAreas: pool.map(a => {
              if (a.id === parentAreaId) return { ...a, children: [...(a.children ?? []), newArea], updatedAt: new Date().toISOString() };
              if (a.children?.length) return { ...a, children: addChildToAreaInTree(a.children, parentAreaId, newArea) };
              return a;
            }),
          };
        });
        return newId;
      }

      // Table cell flows in page elements
      const inCellFlow = (template.pages ?? []).some(p =>
        (p.elements ?? []).some(el =>
          el.type === 'table' && (el.rowSets ?? []).some(rs =>
            (rs.cells ?? []).some(c =>
              c.flow?.id === parentAreaId || findAreaById(c.flow?.children ?? [], parentAreaId)
            )
          )
        )
      );
      if (inCellFlow) {
        setTemplate(t => {
          const usedNums = collectAllAreaNums(t);
          const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1;
          const newArea = { ...createSimpleArea({ label: `Área ${next}`, height: 30 }), id: newId, ...initialProps };

          function patchFlow(flow) {
            if (!flow) return flow;
            if (flow.id === parentAreaId) {
              return { ...flow, children: [...(flow.children ?? []), newArea], updatedAt: new Date().toISOString() };
            }
            const newChildren = addChildToAreaInTree(flow.children ?? [], parentAreaId, newArea);
            if (newChildren !== (flow.children ?? [])) {
              return { ...flow, children: newChildren, updatedAt: new Date().toISOString() };
            }
            return flow;
          }

          return {
            ...t,
            pages: (t.pages ?? []).map(p => ({
              ...p,
              elements: (p.elements ?? []).map(el => {
                if (el.type !== 'table') return el;
                return {
                  ...el,
                  rowSets: (el.rowSets ?? []).map(rs => ({
                    ...rs,
                    cells: (rs.cells ?? []).map(c => ({ ...c, flow: patchFlow(c.flow) })),
                  })),
                  updatedAt: new Date().toISOString(),
                };
              }),
            })),
          };
        });
        return newId;
      }

      // Embedded table cell flows inside content areas
      function findInEmbeddedTables(areas) {
        return areas.some(a => {
          for (const el of (a.elements ?? [])) {
            if (el.type !== 'table') continue;
            for (const rs of (el.rowSets ?? [])) {
              for (const c of (rs.cells ?? [])) {
                if (c.flow?.id === parentAreaId) return true;
                if (findAreaById(c.flow?.children ?? [], parentAreaId)) return true;
              }
            }
          }
          return findInEmbeddedTables(a.children ?? []);
        });
      }
      const inEmbeddedCellFlow = findInEmbeddedTables(template.contentAreas ?? []);
      if (inEmbeddedCellFlow) {
        setTemplate(t => {
          const usedNums = collectAllAreaNums(t);
          const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1;
          const newArea = { ...createSimpleArea({ label: `Área ${next}`, height: 30 }), id: newId, ...initialProps };

          function patchCellFlow(flow) {
            if (!flow) return flow;
            if (flow.id === parentAreaId) {
              return { ...flow, children: [...(flow.children ?? []), newArea], updatedAt: new Date().toISOString() };
            }
            const newChildren = addChildToAreaInTree(flow.children ?? [], parentAreaId, newArea);
            return newChildren !== (flow.children ?? [])
              ? { ...flow, children: newChildren, updatedAt: new Date().toISOString() }
              : flow;
          }

          function patchTableEl(el) {
            if (el.type !== 'table') return el;
            return {
              ...el,
              rowSets: (el.rowSets ?? []).map(rs => ({
                ...rs,
                cells: (rs.cells ?? []).map(c => ({ ...c, flow: patchCellFlow(c.flow) })),
              })),
              updatedAt: new Date().toISOString(),
            };
          }

          function patchArea(a) {
            const newEls = (a.elements ?? []).map(patchTableEl);
            const newKids = (a.children ?? []).map(patchArea);
            if (newEls === a.elements && newKids === a.children) return a;
            return { ...a, elements: newEls, children: newKids, updatedAt: new Date().toISOString() };
          }

          return { ...t, contentAreas: (t.contentAreas ?? []).map(patchArea) };
        });
        return newId;
      }
    }

    // Fallback: create top-level area + assign areaRef to page element
    const areaId = addContentArea();
    if (caId) {
      setTemplate(t => ({
        ...t,
        pages: t.pages.map((p, i) =>
          i !== currentPageIndex ? p : {
            ...p,
            updatedAt: new Date().toISOString(),
            elements: p.elements.map(el =>
              el.id !== caId ? el : { ...el, areaRef: areaId, updatedAt: new Date().toISOString() }
            ),
          }
        ),
      }));
    }
    return areaId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, template, addContentArea]);

  const reorderChildArea = useCallback((caId, areaId, direction) => {
    setTemplate(t => ({
      ...t,
      contentAreas: (t.contentAreas ?? []).map(a => {
        if (!a.children?.length) return a;
        const newChildren = reorderAreaInTree(a.children, areaId, direction);
        return newChildren !== a.children
          ? { ...a, children: newChildren, updatedAt: new Date().toISOString() }
          : a;
      }),
    }));
  }, [setTemplate]);

  const removeArea = useCallback((caId, areaId) => {
    const pool = template.contentAreas ?? [];
    const inPool = pool.some(a => findAreaById(a.children ?? [], areaId));
    if (inPool) {
      setTemplate(t => ({
        ...t,
        contentAreas: (t.contentAreas ?? []).map(a => {
          if (a.children?.length) {
            return { ...a, children: removeAreaFromTree(a.children, areaId), updatedAt: new Date().toISOString() };
          }
          return a;
        }),
      }));
    } else {
      // Fallback: old model
      setTemplate(t => ({
        ...t,
        pages: t.pages.map((p, i) =>
          i !== currentPageIndex ? p : {
            ...p,
            updatedAt: new Date().toISOString(),
            elements: p.elements.map(el => {
              if (el.id !== caId || (el.areas ?? []).length <= 1) return el;
              return { ...el, areas: removeAreaFromTree(el.areas ?? [], areaId), updatedAt: new Date().toISOString() };
            }),
          }
        ),
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, template]);

  const migrateAreaToCondition = useCallback((caId, areaId) => {
    const newChildId = `area_${Math.random().toString(36).slice(2, 8)}`;
    setTemplate(t => {
      const pool = t.contentAreas ?? [];
      const usedNums = collectAllAreaNums(t);
      const label = `Área ${usedNums.length > 0 ? Math.max(...usedNums) + 1 : pool.length + 1}`;

      function migrate(areas) {
        return areas.map(a => {
          if (a.id === areaId) {
            const newChild = {
              ...createSimpleArea({ label, height: a.height ?? 30 }),
              id: newChildId,
              content: a.content ?? '',
              children: a.children ?? [],
            };
            const tagHtml = `<span class="area-tag" data-area="${newChildId}" contenteditable="false">⎇ ${label}</span>​`;
            return {
              ...a,
              flowType: 'inline-condition',
              defaultAreaId: newChildId,
              content: tagHtml,
              children: [newChild],
              updatedAt: new Date().toISOString(),
            };
          }
          if (a.children?.length) return { ...a, children: migrate(a.children) };
          return a;
        });
      }
      return { ...t, contentAreas: migrate(pool) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const migrateAreaFromCondition = useCallback((caId, areaId, targetFlowType) => {
    setTemplate(t => {
      const pool = t.contentAreas ?? [];

      function restore(areas) {
        return areas.map(a => {
          if (a.id === areaId) {
            const defaultChild = (a.children ?? []).find(c => c.id === a.defaultAreaId) ?? (a.children ?? [])[0] ?? null;
            return {
              ...a,
              flowType: targetFlowType,
              content: defaultChild?.content ?? '',
              children: defaultChild?.children ?? [],
              defaultAreaId: '',
              updatedAt: new Date().toISOString(),
            };
          }
          if (a.children?.length) return { ...a, children: restore(a.children) };
          return a;
        });
      }
      return { ...t, contentAreas: restore(pool) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const cloneArea = useCallback((areaId) => {
    setTemplate(t => {
      const pool = t.contentAreas ?? [];
      const area = pool.find(a => a.id === areaId);
      if (!area) return t;
      const clone = JSON.parse(JSON.stringify({
        ...area, id: `area_${Math.random().toString(36).slice(2, 8)}`,
      }));
      return { ...t, contentAreas: [...pool, clone] };
    });
  }, [setTemplate]);

  return {
    addContentArea, updateContentArea, removeContentArea, getContentAreaUsage,
    updateArea, addArea, reorderChildArea, removeArea,
    migrateAreaToCondition, migrateAreaFromCondition,
    cloneArea,
  };
}
