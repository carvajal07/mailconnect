// variableUtils.js — Shared utilities for variable tag insertion and detection

// ── Create variable span HTML ──────────────────────────────────────────────
// NO contenteditable="false" — we rely on CSS user-select:all to make it atomic.
// This allows execCommand (bold, italic, color) to wrap the span naturally.

export function createVariableSpan(path) {
  const span = document.createElement('span');
  span.className = 'var-tag';
  span.setAttribute('data-var', path);
  span.textContent = path;
  return span;
}

// ── Insert variable tag at current caret position in an editor ─────────────
// savedRange: optional Range to restore before inserting (e.g. from autocomplete)

export function insertVariableTag(editor, path, savedRange) {
  if (!editor) return;

  const sel = window.getSelection();
  if (!sel) return;

  // Restore saved range if provided (autocomplete steals focus)
  if (savedRange) {
    editor.focus();
    try {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } catch {
      editor.focus();
      if (sel.rangeCount === 0) {
        const r = document.createRange();
        r.selectNodeContents(editor);
        r.collapse(false);
        sel.addRange(r);
      }
    }
  } else {
    editor.focus();
    if (sel.rangeCount === 0) return;
  }

  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return;

  // Delete any selected text
  range.deleteContents();

  const span = createVariableSpan(path);

  // Insert the span
  range.insertNode(span);

  // Add a zero-width space after the tag so caret can sit after it
  const spacer = document.createTextNode('\u200B');
  span.after(spacer);

  // Move caret after the spacer
  const newRange = document.createRange();
  newRange.setStartAfter(spacer);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

// ── Detect if user just typed "{{" and return the range to replace ─────────

export function detectDoubleBrace(editor) {
  if (!editor) return null;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3 || !editor.contains(node)) return null;

  const text = node.textContent;
  const offset = sel.anchorOffset;

  if (offset >= 2 && text.slice(offset - 2, offset) === '{{') {
    return { node, offset };
  }
  return null;
}

// ── Remove the "{{" text that triggered autocomplete and restore caret ────

export function removeDoubleBrace(braceInfo) {
  if (!braceInfo) return null;
  const { node, offset } = braceInfo;
  const before = node.textContent.slice(0, offset - 2);
  const after  = node.textContent.slice(offset);
  node.textContent = before + after;

  const caretPos = Math.min(before.length, node.textContent.length);
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.setStart(node, caretPos);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return sel?.getRangeAt?.(0)?.cloneRange?.() ?? null;
}

// ── Get caret pixel position for positioning autocomplete ──────────────────

export function getCaretPosition() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { top: 100, left: 100 };

  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);

  // Try getClientRects — works in modern browsers without modifying the DOM
  const rects = range.getClientRects();
  if (rects.length > 0) {
    const rect = rects[0];
    return { top: rect.bottom + 4, left: rect.left };
  }

  // Try getBoundingClientRect
  const rect = range.getBoundingClientRect();
  if (rect.top !== 0 || rect.left !== 0) {
    return { top: rect.bottom + 4, left: rect.left };
  }

  // Last resort: insert temporary marker
  const marker = document.createElement('span');
  marker.textContent = '\u200B';
  range.insertNode(marker);
  const markerRect = marker.getBoundingClientRect();
  const pos = { top: markerRect.bottom + 4, left: markerRect.left };
  marker.remove();
  sel.anchorNode?.parentElement?.normalize();
  return pos;
}

// ── Protect var-tags: restore textContent if user edits inside one ─────────
// Called on the editor's "input" event to revert accidental edits.

export function guardVarTags(editor) {
  if (!editor) return;
  const tags = editor.querySelectorAll('.var-tag[data-var]');
  for (const tag of tags) {
    const expected = tag.getAttribute('data-var');
    if (tag.textContent !== expected) {
      tag.textContent = expected;
    }
  }
}

// ── Guard both var-tags and area-tags ──────────────────────────────────────

export function guardInlineTags(editor) {
  if (!editor) return;
  for (const tag of editor.querySelectorAll('.var-tag[data-var]')) {
    const expected = tag.getAttribute('data-var');
    if (tag.textContent !== expected) tag.textContent = expected;
  }
  // Guard ALL area-tags (collapsed and expanded) as contenteditable="false".
  // Expanded preview chips are read-only — editing is done via mini-canvas.
  for (const tag of editor.querySelectorAll('.area-tag[data-area]')) {
    if (tag.getAttribute('contenteditable') !== 'false') {
      tag.setAttribute('contenteditable', 'false');
    }
  }
  for (const tag of editor.querySelectorAll('.element-tag[data-element]')) {
    if (tag.getAttribute('contenteditable') !== 'false') {
      tag.setAttribute('contenteditable', 'false');
    }
  }
}

// ── Create area-tag span HTML ──────────────────────────────────────────────

export function createAreaTagSpan(areaId, label) {
  const span = document.createElement('span');
  span.className = 'area-tag';
  span.setAttribute('data-area', areaId);
  span.setAttribute('contenteditable', 'false');
  span.textContent = `⎇ ${label}`;
  return span;
}

// ── Insert area-tag at current caret position ──────────────────────────────

export function insertAreaTag(editor, areaId, label, savedRange) {
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel) return;

  if (savedRange) {
    editor.focus();
    try {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } catch {
      editor.focus();
      if (sel.rangeCount === 0) {
        const r = document.createRange();
        r.selectNodeContents(editor);
        r.collapse(false);
        sel.addRange(r);
      }
    }
  } else {
    editor.focus();
    if (sel.rangeCount === 0) return;
  }

  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return;

  range.deleteContents();
  const span = createAreaTagSpan(areaId, label);
  range.insertNode(span);

  const spacer = document.createTextNode('​');
  span.after(spacer);

  const newRange = document.createRange();
  newRange.setStartAfter(spacer);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

// ── Element-tag (embedded canvas element in flow) ──────────────────────────

export function createElementTagSpan(elementId, type, label) {
  const span = document.createElement('span');
  span.className = 'element-tag';
  span.setAttribute('data-element', elementId);
  span.setAttribute('data-type', type);
  span.setAttribute('contenteditable', 'false');
  span.textContent = label;
  return span;
}

export function insertElementTag(editor, elementId, type, label, savedRange) {
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel) return;

  if (savedRange) {
    editor.focus();
    try {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } catch {
      editor.focus();
      if (sel.rangeCount === 0) {
        const r = document.createRange();
        r.selectNodeContents(editor);
        r.collapse(false);
        sel.addRange(r);
      }
    }
  } else {
    editor.focus();
    if (sel.rangeCount === 0) return;
  }

  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return;

  range.deleteContents();
  const span = createElementTagSpan(elementId, type, label);
  range.insertNode(span);

  const spacer = document.createTextNode('​');
  span.after(spacer);

  const newRange = document.createRange();
  newRange.setStartAfter(spacer);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

export function buildElementTagLabel(type, element) {
  if (type === 'table') {
    const cols = element?.columns?.length ?? 0;
    return cols > 0 ? `◆ Tabla ${cols} col.` : '◆ Tabla';
  }
  const labels = { image: '◆ Imagen', shape: '◆ Forma', qr: '◆ QR', barcode: '◆ Código de barras' };
  return labels[type] ?? '◆ Elemento';
}
