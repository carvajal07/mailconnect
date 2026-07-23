// editor/hooks/useKeyboardShortcuts.js — Keyboard shortcuts for the designer editor

import { useEffect } from 'react';

/**
 * @param {object} ds - useDesignerState instance
 * @param {function} onSave - called when Ctrl+S
 * @param {function} onClose - called when Escape (with no modal open)
 */
export function useKeyboardShortcuts(ds, onSave, onClose) {
  useEffect(() => {
    function handleKeyDown(e) {
      // Don't intercept if typing in an input / textarea / contenteditable
      const tag = document.activeElement?.tagName;
      const isEditing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        document.activeElement?.isContentEditable;

      const ctrl = e.ctrlKey || e.metaKey;

      // ── Escape: exit area edit → deselect → close ─────────────────────
      if (e.key === 'Escape') {
        if (ds.areaEditCtx) {
          e.stopImmediatePropagation();
          ds.exitAreaEdit();
          return;
        }
        if (ds.selectedIds.length > 0) {
          ds.clearSelection();
        } else if (!isEditing) {
          onClose?.();
        }
        return;
      }

      // ── Save: Ctrl+S ──────────────────────────────────────────────────
      if (ctrl && e.key === 's') {
        e.preventDefault();
        onSave?.();
        return;
      }

      // ── Undo / Redo ───────────────────────────────────────────────────
      // stopImmediatePropagation: el editor maneja su propio historial; sin
      // esto el evento llega al keydown de WorkflowCanvas (fase bubble) que
      // ejecuta useWorkflowStore.undo() y termina borrando el nodo del workflow.
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ds.undo();
        return;
      }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ds.redo();
        return;
      }

      // ── Copy / Paste / Cut ────────────────────────────────────────────
      if (!isEditing) {
        if (ctrl && e.key === 'c') {
          e.preventDefault();
          ds.copySelected();
          return;
        }
        if (ctrl && e.key === 'x') {
          e.preventDefault();
          ds.copySelected();
          ds.removeElements(ds.selectedIds);
          return;
        }
        if (ctrl && e.key === 'v') {
          e.preventDefault();
          ds.paste();
          return;
        }
        if (ctrl && e.key === 'd') {
          e.preventDefault();
          ds.duplicateElements(ds.selectedIds);
          return;
        }

        // ── Delete / Backspace ──────────────────────────────────────────
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          e.stopImmediatePropagation(); // prevent ReactFlow from deleting the node
          if (ds.selectedIds.length > 0) ds.removeElements(ds.selectedIds);
          return;
        }

        // ── Select all ──────────────────────────────────────────────────
        if (ctrl && e.key === 'a') {
          e.preventDefault();
          ds.selectAll();
          return;
        }

        // ── Z-order ─────────────────────────────────────────────────────
        if (ctrl && e.key === ']') {
          e.preventDefault();
          if (e.shiftKey) ds.bringToFront(ds.selectedIds);
          else ds.bringForward(ds.selectedIds);
          return;
        }
        if (ctrl && e.key === '[') {
          e.preventDefault();
          if (e.shiftKey) ds.sendToBack(ds.selectedIds);
          else ds.sendBackward(ds.selectedIds);
          return;
        }

        // ── Arrow nudge (1mm, or 10mm with Shift) ───────────────────────
        const nudge = e.shiftKey ? 10 : 1;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
            ds.selectedIds.length > 0) {
          e.preventDefault();
          const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
          const dy = e.key === 'ArrowUp'   ? -nudge : e.key === 'ArrowDown'  ? nudge : 0;
          const page = ds.template?.pages?.[ds.currentPageIndex];
          if (!page) return;
          const updatedElements = page.elements.map(el => {
            if (!ds.selectedIds.includes(el.id)) return el;
            return { ...el, x: el.x + dx, y: el.y + dy };
          });
          ds.updateCurrentPage({ elements: updatedElements });
          return;
        }

        // ── Zoom ─────────────────────────────────────────────────────────
        if (ctrl && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          ds.zoomIn();
          return;
        }
        if (ctrl && e.key === '-') {
          e.preventDefault();
          ds.zoomOut();
          return;
        }
        if (ctrl && e.key === '0') {
          e.preventDefault();
          ds.setZoomLevel(1);
          return;
        }
      }
    }

    // Capture phase: runs before ReactFlow's window listeners (avoids deleting the node)
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [ds, onSave, onClose]);
}
