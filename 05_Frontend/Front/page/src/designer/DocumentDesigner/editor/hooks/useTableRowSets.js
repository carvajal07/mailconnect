// useTableRowSets.js — Table RowSet navigation state + child RowSet CRUD
import { useState, useCallback } from 'react';
import { createRowSet } from '../../engine/elementFactory.js';

// Counts all tables in the template (for global table naming)
export function countTablesInTemplate(t) {
  let count = 0;
  function scanEl(el) { if (el?.type === 'table') count++; }
  for (const p of (t?.pages ?? [])) for (const el of (p.elements ?? [])) scanEl(el);
  for (const ca of (t?.contentAreas ?? [])) for (const el of (ca.elements ?? [])) scanEl(el);
  return count;
}

// Counts all RowSets across all tables in the template (for global row naming)
export function countRowSetsInTemplate(t) {
  let count = 0;
  function scanEl(el) { if (el?.type === 'table') count += (el.rowSets ?? []).length; }
  for (const p of (t?.pages ?? [])) for (const el of (p.elements ?? [])) scanEl(el);
  for (const ca of (t?.contentAreas ?? [])) for (const el of (ca.elements ?? [])) scanEl(el);
  return count;
}

function _countAllRowSetsInTemplate(t) { return countRowSetsInTemplate(t); }

// Counts all cells across all single-row RowSets in the template (for global column naming)
export function countCellsInTemplate(t) {
  let count = 0;
  function scanEl(el) {
    if (el?.type !== 'table') return;
    for (const rs of (el.rowSets ?? [])) count += (rs.cells ?? []).length;
  }
  for (const p of (t?.pages ?? [])) for (const el of (p.elements ?? [])) scanEl(el);
  for (const ca of (t?.contentAreas ?? [])) for (const el of (ca.elements ?? [])) scanEl(el);
  return count;
}

function _countAllCellsInTemplate(t) { return countCellsInTemplate(t); }

// Patches a table element (by id) wherever it lives: page elements or content area elements
function patchTableInTemplate(t, tableElId, fn) {
  function patchEl(el) { return el.id === tableElId ? fn(el) : el; }
  return {
    ...t,
    pages: (t.pages ?? []).map(p => ({
      ...p,
      elements: (p.elements ?? []).map(patchEl),
    })),
    contentAreas: (t.contentAreas ?? []).map(area => ({
      ...area,
      elements: (area.elements ?? []).map(patchEl),
    })),
  };
}

export function useTableRowSets(_template, setTemplate, { areaEditCtxRef, setAreaEditCtx }) {
  const [tableRowSetCtx, _setTableRowSetCtx] = useState(null);

  const setTableRowSetCtx = useCallback((ctx) => _setTableRowSetCtx(ctx), []);

  const enterTableCellEdit = useCallback((tableElId, flowId) => {
    const ctx = { caId: tableElId, areaId: flowId };
    areaEditCtxRef.current = ctx;
    setAreaEditCtx(ctx);
  }, [areaEditCtxRef, setAreaEditCtx]);

  const exitTableCellEdit = useCallback(() => {
    areaEditCtxRef.current = null;
    setAreaEditCtx(null);
  }, [areaEditCtxRef, setAreaEditCtx]);

  const addChildRowSet = useCallback((tableElId, parentRowSetId, type = 'single-row') => {
    setTemplate(t => {
      const globalRowNum  = _countAllRowSetsInTemplate(t) + 1;
      const startCellNum  = _countAllCellsInTemplate(t) + 1;
      return patchTableInTemplate(t, tableElId, el => {
        const parentRs = (el.rowSets ?? []).find(rs => rs.id === parentRowSetId);
        if (!parentRs) return el;
        const newRs = createRowSet({ type, name: `Fila ${globalRowNum}`, columns: el.columns ?? [], startCellNum });
        return {
          ...el,
          rowSets: [
            ...(el.rowSets ?? []).map(rs =>
              rs.id === parentRowSetId
                ? { ...rs, childIds: [...(rs.childIds ?? []), newRs.id] }
                : rs
            ),
            newRs,
          ],
          updatedAt: new Date().toISOString(),
        };
      });
    });
  }, [setTemplate]);

  const createAndReplaceChildRowSet = useCallback((tableElId, parentRowSetId, oldChildId, type = 'single-row') => {
    setTemplate(t => {
      const globalRowNum = _countAllRowSetsInTemplate(t) + 1;
      const startCellNum = _countAllCellsInTemplate(t) + 1;
      return patchTableInTemplate(t, tableElId, el => {
        const parentRs = (el.rowSets ?? []).find(rs => rs.id === parentRowSetId);
        if (!parentRs) return el;
        const newRs = createRowSet({ type, name: `Fila ${globalRowNum}`, columns: el.columns ?? [], startCellNum });
        return {
          ...el,
          rowSets: [
            ...(el.rowSets ?? []).map(rs =>
              rs.id === parentRowSetId
                ? { ...rs, childIds: (rs.childIds ?? []).map(id => id === oldChildId ? newRs.id : id) }
                : rs
            ),
            newRs,
          ],
          updatedAt: new Date().toISOString(),
        };
      });
    });
  }, [setTemplate]);

  const convertRowSetToHeaderFooter = useCallback((tableElId, rsId) => {
    setTemplate(t => {
      const baseRowCount  = _countAllRowSetsInTemplate(t);
      const baseCellCount = _countAllCellsInTemplate(t);
      return patchTableInTemplate(t, tableElId, el => {
        const rsToConvert = (el.rowSets ?? []).find(rs => rs.id === rsId);
        if (!rsToConvert) return el;
        const cols = el.columns ?? [];

        // Header RS — cells labeled with global consecutive nums
        const headerRs = createRowSet({ type: 'single-row', name: `Fila ${baseRowCount + 1}`, columns: cols, startCellNum: baseCellCount + 1 });
        // Footer RS — continues after header cells
        const footerRs = createRowSet({ type: 'single-row', name: `Fila ${baseRowCount + 2}`, columns: cols, startCellNum: baseCellCount + cols.length + 1 });

        // Body RS — preserves previous content of the converted RS
        let bodyRs;
        const prevType = rsToConvert.type;
        if (prevType === 'single-row') {
          // Reuse existing cells (already labeled); body RS gets a new id but keeps cells
          bodyRs = { ...createRowSet({ type: 'single-row', name: `Fila ${baseRowCount + 3}`, columns: cols, startCellNum: baseCellCount + cols.length * 2 + 1 }), cells: rsToConvert.cells ?? [] };
        } else if (prevType === 'multiple-rows' || prevType === 'repeated') {
          bodyRs = { ...createRowSet({ type: prevType, name: `Fila ${baseRowCount + 3}`, columns: cols, startCellNum: baseCellCount + cols.length * 2 + 1 }), childIds: rsToConvert.childIds ?? [], repeatVar: rsToConvert.repeatVar ?? null };
        } else {
          bodyRs = createRowSet({ type: 'single-row', name: `Fila ${baseRowCount + 3}`, columns: cols, startCellNum: baseCellCount + cols.length * 2 + 1 });
        }

        const updatedRs = {
          id: rsId,
          name: rsToConvert.name,
          type: 'header-footer',
          displayAllRows: false,
          firstHeaderId: headerRs.id,
          headerId:       headerRs.id,
          bodyId:         bodyRs.id,
          footerId:       footerRs.id,
          lastFooterId:   footerRs.id,
        };

        return {
          ...el,
          rowSets: [
            ...(el.rowSets ?? []).map(rs => rs.id === rsId ? updatedRs : rs),
            headerRs, footerRs, bodyRs,
          ],
          updatedAt: new Date().toISOString(),
        };
      });
    });
  }, [setTemplate]);

  const createAndAssignHFSlot = useCallback((tableElId, parentRsId, slotKey, type = 'single-row') => {
    setTemplate(t => {
      const globalRowNum = _countAllRowSetsInTemplate(t) + 1;
      const startCellNum = _countAllCellsInTemplate(t) + 1;
      return patchTableInTemplate(t, tableElId, el => {
        const parentRs = (el.rowSets ?? []).find(rs => rs.id === parentRsId);
        if (!parentRs) return el;
        const newRs = createRowSet({ type, name: `Fila ${globalRowNum}`, columns: el.columns ?? [], startCellNum });
        return {
          ...el,
          rowSets: [
            ...(el.rowSets ?? []).map(rs =>
              rs.id === parentRsId ? { ...rs, [slotKey]: newRs.id } : rs
            ),
            newRs,
          ],
          updatedAt: new Date().toISOString(),
        };
      });
    });
  }, [setTemplate]);

  const removeChildRowSet = useCallback((tableElId, parentRowSetId, childRowSetId) => {
    setTemplate(t =>
      patchTableInTemplate(t, tableElId, el => {
        // Collect the removed rowset and all its descendants
        const idsToRemove = new Set([childRowSetId]);
        function collectDescendants(rs) {
          for (const cid of (rs?.childIds ?? [])) {
            idsToRemove.add(cid);
            collectDescendants((el.rowSets ?? []).find(r => r.id === cid));
          }
        }
        collectDescendants((el.rowSets ?? []).find(r => r.id === childRowSetId));

        return {
          ...el,
          rowSets: (el.rowSets ?? [])
            .filter(rs => !idsToRemove.has(rs.id))
            .map(rs =>
              rs.id === parentRowSetId
                ? { ...rs, childIds: (rs.childIds ?? []).filter(id => !idsToRemove.has(id)) }
                : rs
            ),
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }, [setTemplate]);

  return {
    tableRowSetCtx, setTableRowSetCtx,
    enterTableCellEdit, exitTableCellEdit,
    addChildRowSet, createAndReplaceChildRowSet, removeChildRowSet,
    createAndAssignHFSlot, convertRowSetToHeaderFooter,
  };
}
