// TextFormatToolbar.jsx — Inline text formatting (immutable style system)
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
  Bold, Italic, Underline, Strikethrough,
  Link2,
  Superscript, Subscript,
  List, ListOrdered, IndentIncrease, IndentDecrease,
  Pilcrow, Type, SquareArrowOutUpRight,
  ChevronDown, Plus,
} from 'lucide-react';
import { resolveTextStyle } from '../../engine/textStyleUtils.js';
import { resolveParagraphStyle } from '../../engine/paragraphStyleUtils.js';
import { applyTextStyleToRange, applyParagraphStyleToRange, applyParagraphBlockStyles } from '../canvas/elements/selectionStyle.js';
import {
  FONT_FAMILIES, FONT_WEIGHTS,
  ALIGNMENTS, V_ALIGNMENTS, TEXT_TRANSFORMS,
  TEXT_TYPES, SIZE_UNITS, SIZE_CONVERSIONS,
  findAreaInPool, getTextStyleId,
  DeferredColorInput, SizeInput, LinkModal, TextColorButton,
} from './textFormatHelpers.jsx';
import './TextFormatToolbar.css';

// ── Component ───────────────────────────────────────────────────────────────

export default function TextFormatToolbar({ state, showInvisibles, onToggleInvisibles }) {
  const {
    selectedIds, currentPage, updateElement: updateEl,
    areaEditCtx, findOrCreateTextStyle, findOrCreateParagraphStyle, template,
    updateContentArea, activeEditorRef, activeEditorMetaRef,
    navigateToResource, addFillStyle,
    addTextStyle, addParagraphStyle,
  } = state;

  const fillStyles   = template?.styles?.fill ?? [];
  const customFonts  = (template?.fonts ?? []).map(f => f.family);
  const allFontFamilies = [...FONT_FAMILIES, ...customFonts.filter(f => !FONT_FAMILIES.includes(f))];

  const textStyles = template?.styles?.text ?? [];
  // state.contentAreas includes table cell flows when editing a cell inline
  const contentAreas = state.contentAreas ?? template?.contentAreas ?? [];
  const [sizeUnit, setSizeUnit] = useState('pt');
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [listDropdown, setListDropdown] = useState(null); // 'bullet' | 'numbered' | null
  const [styleDropdown, setStyleDropdown] = useState(null); // 'text' | 'paragraph' | null
  const linkRangeRef = useRef(null); // saved range for link insertion
  const linkBtnRef = useRef(null);   // anchor for portal-based modal positioning
  const bulletDropBtnRef = useRef(null);
  const numberDropBtnRef = useRef(null);
  const textStyleBtnRef = useRef(null);
  const paraStyleBtnRef = useRef(null);
  // Force re-render when selection changes to update inline format state
  const [, forceUpdate] = useState(0);
  // Always-current zoom ref — avoids stale closures in useCallback (inlineState)
  const zoomRef = useRef(1);
  zoomRef.current = state?.zoom ?? 1;

  // Resolve selected elements — from page or from area
  const elements = useMemo(() => {
    if (areaEditCtx) {
      const area = findAreaInPool(contentAreas, areaEditCtx.areaId);
      if (area) return area.elements ?? [];
      return [];
    }
    return currentPage?.elements ?? [];
  }, [currentPage, areaEditCtx, contentAreas]);

  // Get selected text-capable elements (text + contentarea)
  const textEls = useMemo(() => {
    if (!selectedIds.length) return [];
    const set = new Set(selectedIds);
    return elements.filter(e => set.has(e.id) && TEXT_TYPES.has(e.type));
  }, [elements, selectedIds]);

  // Toolbar is active if: text elements selected, editor open, or area edit mode active
  const hasActiveEditor = !!activeEditorRef?.current;
  const hasText = textEls.length > 0 || hasActiveEditor || !!areaEditCtx;
  const el = textEls[0] ?? null;

  // Resolve current text style from element or active area (including table cell flow)
  const currentStyleId = useMemo(() => {
    if (el) return getTextStyleId(el, contentAreas);
    if (areaEditCtx) {
      const area = findAreaInPool(contentAreas, areaEditCtx.areaId);
      return area?.defaultTextStyleId ?? null;
    }
    return null;
  }, [el, contentAreas, areaEditCtx]);

  const ts = useMemo(() => {
    if (!currentStyleId) return {};
    return resolveTextStyle(currentStyleId, textStyles);
  }, [currentStyleId, textStyles]);

  const paragraphStyles = template?.styles?.paragraph ?? [];

  // Resolve the paragraphStyleId for the current element/area (or active cell flow)
  const currentParagraphStyleId = useMemo(() => {
    if (!el) {
      if (areaEditCtx) {
        const area = findAreaInPool(contentAreas, areaEditCtx.areaId);
        return area?.paragraphStyleId ?? null;
      }
      return null;
    }
    if (el.type === 'contentarea' && el.areaRef) {
      const area = findAreaInPool(contentAreas, el.areaRef);
      return area?.paragraphStyleId ?? null;
    }
    return el.paragraphStyleId ?? null;
  }, [el, contentAreas, areaEditCtx]);

  const ps = useMemo(() => {
    if (currentParagraphStyleId) {
      return resolveParagraphStyle(currentParagraphStyleId, paragraphStyles);
    }
    // Fallback to inline paragraphStyle (legacy)
    if (!el) return {};
    if (el.type === 'contentarea' && el.areaRef) {
      const area = findAreaInPool(contentAreas, el.areaRef);
      return area?.paragraphStyle ?? {};
    }
    return el.paragraphStyle ?? {};
  }, [el, contentAreas, currentParagraphStyleId, paragraphStyles]);

  // ── Query inline formatting state from the active editor selection ────
  // This detects bold/italic/etc on the current cursor position or selection
  // via document.queryCommandState, so buttons reflect the actual formatting.
  // Walk up from a node looking for an <a> ancestor within the editor
  const findLinkFromNode = useCallback((node) => {
    const editor = activeEditorRef?.current;
    while (node && node !== editor) {
      if (node.nodeName === 'A') return node;
      node = node.parentNode;
    }
    return null;
  }, [activeEditorRef]);

  const inlineState = useCallback(() => {
    if (!activeEditorRef?.current) return null;
    try {
      const fc = document.queryCommandValue('foreColor');
      let color;
      if (fc) {
        const m = fc.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        color = m
          ? '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('')
          : fc;
      }
      // Detect if selection is inside a link (check both anchor and focus nodes)
      const sel = window.getSelection();
      let linkAnchor = null;
      if (sel && sel.rangeCount > 0) {
        linkAnchor = findLinkFromNode(sel.anchorNode) || findLinkFromNode(sel.focusNode);
      }
      // Read inline font-size from the node at the cursor/selection anchor.
      // Spans created by applyInlineFormat store `font-size: Xpx` (144dpi-scaled).
      // Convert px → pt using the current zoom so the toolbar shows the design pt value.
      // We INCLUDE the editor element itself in the lookup — for table cells
      // and `.cae__editor`, the editor div carries the text-style fontSize
      // (e.g. 22px = 11pt @ design DPI) via textStyleToCSS. Stopping BEFORE
      // the editor left fontSize undefined and the toolbar fell back to the
      // hardcoded `?? 12`, showing 12 even when the real rendered size was 11.
      let fontSize;
      if (sel && sel.rangeCount > 0) {
        const editor = activeEditorRef.current;
        let fnode = sel.anchorNode;
        if (fnode?.nodeType === 3) fnode = fnode.parentElement;
        while (fnode) {
          if (fnode.style?.fontSize) {
            const mpt = fnode.style.fontSize.match(/([\d.]+)\s*pt\b/i);
            if (mpt) { fontSize = parseFloat(mpt[1]); break; }
            const mpx = fnode.style.fontSize.match(/([\d.]+)\s*px\b/i);
            if (mpx) {
              fontSize = parseFloat(mpx[1]) / ((144 / 72) * zoomRef.current);
              break;
            }
          }
          if (fnode === editor) break;
          fnode = fnode.parentElement;
        }
      }
      return {
        fontWeight: document.queryCommandState('bold') ? 'Bold' : undefined,
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikethrough: document.queryCommandState('strikeThrough'),
        superscript: document.queryCommandState('superscript'),
        subscript: document.queryCommandState('subscript'),
        color,
        fontFamily: document.queryCommandValue('fontName')?.replace(/"/g, '') || undefined,
        linkAnchor,
        fontSize,
      };
    } catch { return null; }
  }, [activeEditorRef, findLinkFromNode]);

  // Listen for selection changes to update toolbar button states.
  // Always listen (not gated by hasActiveEditor) because activeEditorRef.current
  // is set in another component's useEffect and doesn't trigger re-renders here.
  useEffect(() => {
    const handler = () => {
      if (activeEditorRef?.current) forceUpdate(n => n + 1);
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [activeEditorRef]);

  // Effective style: merge base text style with inline overrides
  const iState = inlineState();
  const ets = hasActiveEditor && iState ? { ...ts, ...Object.fromEntries(
    Object.entries(iState).filter(([, v]) => v !== undefined)
  ) } : ts;

  // Resolved text color: follows fillStyleId chain so the "A" bar shows the real color
  const _etsFill = ets.fillStyleId ? fillStyles.find(f => f.id === ets.fillStyleId) : null;
  const resolvedTextColor = _etsFill?.color ?? ets.color ?? '#1f2937';

  // ── Inline selection helpers ──────────────────────────────────────────

  // Saved range for controls that steal focus (selects, color picker)
  const savedRangeRef = useRef(null);

  function saveSelection() {
    const editor = activeEditorRef?.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const range = savedRangeRef.current;
    if (!range) return false;
    const editor = activeEditorRef?.current;
    if (!editor) return false;
    editor.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    savedRangeRef.current = null;
    return true;
  }

  // Check if there's a non-collapsed text selection inside the active editor
  function hasInlineSelection() {
    const editor = activeEditorRef?.current;
    if (!editor) return false;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return editor.contains(sel.anchorNode);
  }

  // Apply formatting inline via execCommand (for selected text only).
  // IMPORTANT: Do NOT call editor.focus() — the toolbar's onMouseDown
  // already calls preventDefault, so the contentEditable retains focus
  // and the text selection is preserved.
  // Get the base text style ID for the area currently being edited
  function getEditingStyleId() {
    // First try metadata from the active editor (always set when editing)
    const meta = activeEditorMetaRef?.current;
    if (meta?.defaultTextStyleId) return meta.defaultTextStyleId;
    // Fallback to areaEditCtx
    const ctx = areaEditCtx;
    if (!ctx) return null;
    const area = findAreaInPool(contentAreas, ctx.areaId);
    return area?.defaultTextStyleId ?? null;
  }

  // Replace <font size="N"> elements generated by execCommand with <span style="...">
  function patchFontElements(sizeAttr, styles) {
    const editor = activeEditorRef?.current;
    if (!editor) return;
    for (const font of editor.querySelectorAll(`font[size="${sizeAttr}"]`)) {
      const span = document.createElement('span');
      Object.assign(span.style, styles);
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    }
  }

  // Track inline style references on the current content area
  function trackInlineStyleRef(styleId) {
    if (!styleId) return;
    const meta = activeEditorMetaRef?.current;
    const areaId = meta?.areaId;
    if (!areaId) return;
    const area = findAreaInPool(contentAreas, areaId);
    const refs = area?.inlineStyleRefs ?? [];
    if (!refs.includes(styleId)) {
      updateContentArea(areaId, { inlineStyleRefs: [...refs, styleId] });
    }
  }

  // ── Hyperlink helpers ─────────────────────────────────────────────────
  // Detect if the cursor/selection is inside an <a> tag
  function getSelectionLink() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return findLinkFromNode(sel.anchorNode) || findLinkFromNode(sel.focusNode);
  }

  function openLinkModal() {
    // Save the selection so we can restore it when the modal confirms
    const editor = activeEditorRef?.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      linkRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
    setLinkModalOpen(true);
  }

  function insertLink(url) {
    const editor = activeEditorRef?.current;
    if (!editor || !linkRangeRef.current) { setLinkModalOpen(false); return; }
    editor.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(linkRangeRef.current);
    document.execCommand('createLink', false, url);
    // Style links to look visually distinct
    const anchor = getSelectionLink();
    if (anchor) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
    // Apply hyperlink visual formatting (blue + underline)
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, '#2563eb');
    document.execCommand('underline');
    // Create/find a "Hipervínculo" TextStyle in the catalog
    const baseStyleId = getEditingStyleId();
    if (baseStyleId) {
      const fullState = { color: '#2563eb', underline: true };
      try {
        if (document.queryCommandState('bold')) fullState.fontWeight = 'Bold';
        if (document.queryCommandState('italic')) fullState.italic = true;
        if (document.queryCommandState('strikeThrough')) fullState.strikethrough = true;
        const fn = document.queryCommandValue('fontName')?.replace(/"/g, '');
        if (fn) fullState.fontFamily = fn;
      } catch { /* ignore */ }
      const newStyleId = findOrCreateTextStyle(baseStyleId, fullState);
      trackInlineStyleRef(newStyleId);
    }
    linkRangeRef.current = null;
    setLinkModalOpen(false);
  }

  function removeLink() {
    const editor = activeEditorRef?.current;
    if (!editor) { setLinkModalOpen(false); return; }
    if (linkRangeRef.current) {
      editor.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(linkRangeRef.current);
    }
    document.execCommand('unlink');
    // Revert visual formatting to the base text style
    const baseStyleId = getEditingStyleId();
    const baseStyle = baseStyleId
      ? resolveTextStyle(baseStyleId, textStyles)
      : {};
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, baseStyle.color || '#1f2937');
    // Remove underline if base style doesn't have it
    if (!baseStyle.underline && document.queryCommandState('underline')) {
      document.execCommand('underline');
    }
    linkRangeRef.current = null;
    setLinkModalOpen(false);
  }

  function applyInlineFormat(changes) {
    const editor = activeEditorRef?.current;
    if (!editor) return;

    // execCommand only works on the *focused* element. If focus moved to a toolbar
    // button (e.g., in canvas contexts where preventDefault doesn't fully prevent
    // blur on contentEditable), refocus the editor and restore the saved selection.
    if (document.activeElement !== editor) {
      editor.focus();
      const saved = savedRangeRef.current;
      if (saved) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(saved);
      } else {
        // No saved range — check if the current selection is still usable
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return;
      }
    }

    // styleWithCSS makes execCommand emit <span style="..."> instead of <b>/<i>
    document.execCommand('styleWithCSS', false, true);

    if ('fontWeight' in changes) {
      document.execCommand('bold');
    }
    if ('italic' in changes) {
      document.execCommand('italic');
    }
    if ('underline' in changes) {
      document.execCommand('underline');
    }
    if ('strikethrough' in changes) {
      document.execCommand('strikeThrough');
    }
    // Superscript / subscript: execCommand toggles <sup>/<sub> elements
    if ('superscript' in changes) {
      document.execCommand('superscript');
    }
    if ('subscript' in changes) {
      document.execCommand('subscript');
    }
    if ('color' in changes) {
      document.execCommand('foreColor', false, changes.color);
    }
    if ('fontFamily' in changes) {
      document.execCommand('fontName', false, changes.fontFamily);
    }
    if ('fontSize' in changes) {
      // Direct DOM wrap: extract selection, wrap in span with 144dpi-scaled px,
      // so the visual size matches view mode (which uses the same px scaling).
      // On save, commitEdit/commitCurrentCell converts px → pt for storage.
      const fsSel = window.getSelection();
      if (fsSel && fsSel.rangeCount > 0) {
        const fsRange = fsSel.getRangeAt(0);
        const fsFrag = fsRange.extractContents();
        const fsSpan = document.createElement('span');
        const fsZoom = state?.zoom ?? 1;
        fsSpan.style.fontSize = `${(changes.fontSize * (144 / 72) * fsZoom).toFixed(2)}px`;
        fsSpan.appendChild(fsFrag);
        fsRange.insertNode(fsSpan);
        const fsNew = document.createRange();
        fsNew.selectNodeContents(fsSpan);
        fsSel.removeAllRanges();
        fsSel.addRange(fsNew);
      }
    }
    if ('textTransform' in changes) {
      document.execCommand('styleWithCSS', false, false);
      const val = changes.textTransform === 'none' ? '' : changes.textTransform;
      document.execCommand('fontSize', false, '7');
      patchFontElements('7', { textTransform: val });
      document.execCommand('styleWithCSS', false, true);
    }
    if ('letterSpacing' in changes) {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '6');
      patchFontElements('6', { letterSpacing: `${changes.letterSpacing}px` });
      document.execCommand('styleWithCSS', false, true);
    }

    // selectionchange may not fire after patchFontElements (text nodes moved but not changed),
    // so force a re-render here so inlineState() re-reads the patched DOM.
    forceUpdate(n => n + 1);

    // Capture the FULL accumulated inline formatting state after applying commands,
    // not just the single change — so "Bold+Italic+Red" creates one combined style.
    const baseStyleId = getEditingStyleId();
    if (baseStyleId) {
      const fullState = {};
      try {
        if (document.queryCommandState('bold')) fullState.fontWeight = 'Bold';
        if (document.queryCommandState('italic')) fullState.italic = true;
        if (document.queryCommandState('underline')) fullState.underline = true;
        if (document.queryCommandState('strikeThrough')) fullState.strikethrough = true;
        if (document.queryCommandState('superscript')) fullState.superscript = true;
        if (document.queryCommandState('subscript')) fullState.subscript = true;
        const fc = document.queryCommandValue('foreColor');
        if (fc) {
          // Browser returns rgb(r,g,b) — convert to hex for consistent matching
          const m = fc.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
          fullState.color = m
            ? '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('')
            : fc;
        }
        const fn = document.queryCommandValue('fontName')?.replace(/"/g, '');
        if (fn) fullState.fontFamily = fn;
      } catch { /* ignore query errors */ }
      // Merge non-execCommand properties from the explicit changes
      if ('fontSize' in changes) fullState.fontSize = changes.fontSize;
      if ('textTransform' in changes) fullState.textTransform = changes.textTransform;
      if ('letterSpacing' in changes) fullState.letterSpacing = changes.letterSpacing;
      if ('lineHeight' in changes) fullState.lineHeight = changes.lineHeight;
      const newStyleId = findOrCreateTextStyle(baseStyleId, fullState);
      trackInlineStyleRef(newStyleId);
    }
  }

  // ── Update helpers (immutable: clone → find/create → assign ID) ──────

  function applyTextStyleChange(changes) {
    // If there's a text selection in the editor → apply inline formatting only
    if (hasInlineSelection()) {
      applyInlineFormat(changes);
      return;
    }
    // Check if we have a saved selection (from focus-stealing controls like selects)
    if (savedRangeRef.current && restoreSelection()) {
      applyInlineFormat(changes);
      return;
    }
    // Otherwise → apply to the whole element via the style system
    for (const te of textEls) {
      const styleId = getTextStyleId(te, contentAreas);
      const newId = findOrCreateTextStyle(styleId, changes);

      if (te.type === 'contentarea' && te.areaRef) {
        updateContentArea(te.areaRef, { defaultTextStyleId: newId });
      }
    }
    // Editing a table cell inline (no element selected, but cell editor is active)
    if (textEls.length === 0 && areaEditCtx) {
      const area = findAreaInPool(contentAreas, areaEditCtx.areaId);
      const styleId = area?.defaultTextStyleId ?? null;
      const newId = findOrCreateTextStyle(styleId, changes);
      updateContentArea(areaEditCtx.areaId, { defaultTextStyleId: newId });
    }
  }

  function setParagraphStyle(changes) {
    if (textEls.length > 0) {
      for (const te of textEls) {
        if (te.type === 'contentarea' && te.areaRef) {
          const area = findAreaInPool(contentAreas, te.areaRef);
          const styleId = area?.paragraphStyleId ?? null;
          const newId = findOrCreateParagraphStyle(styleId, changes);
          updateContentArea(te.areaRef, { paragraphStyleId: newId });
        } else {
          const styleId = te.paragraphStyleId ?? null;
          const newId = findOrCreateParagraphStyle(styleId, changes);
          updateEl(te.id, { paragraphStyleId: newId });
        }
      }
    } else if (areaEditCtx) {
      // Editing an area inline (no element selected, but editor is active)
      const area = findAreaInPool(contentAreas, areaEditCtx.areaId);
      const styleId = area?.paragraphStyleId ?? null;
      const newId = findOrCreateParagraphStyle(styleId, changes);
      updateContentArea(areaEditCtx.areaId, { paragraphStyleId: newId });
    }
  }

  function toggleBool(prop) {
    const current = ts[prop] ?? false;
    applyTextStyleChange({ [prop]: !current });
  }

  // ── List helpers (HTML-based list manipulation) ────────────────────

  // Detect current list state at cursor position (per-line, like Word/Docs)
  function inlineListState() {
    const editor = activeEditorRef?.current;
    if (editor) {
      // Check if cursor/selection is inside a <ul> or <ol>
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node = sel.anchorNode;
        while (node && node !== editor) {
          if (node.nodeType === 1) {
            const tag = node.tagName;
            if (tag === 'UL') return 'bullet';
            if (tag === 'OL') return 'numbered';
          }
          node = node.parentNode;
        }
      }
      // Cursor is in editor but not inside a list
      return null;
    }
    // Not in edit mode: check stored content for the first text element
    if (el?.type === 'contentarea' && el.areaRef) {
      const area = findAreaInPool(contentAreas, el.areaRef);
      const html = area?.content ?? '';
      if (html.includes('<ul>') || html.includes('<ul ')) return 'bullet';
      if (html.includes('<ol>') || html.includes('<ol ')) return 'numbered';
    }
    if (ps.listStyle && ps.listStyle !== 'none') return ps.listStyle;
    return null;
  }

  // Convert plain HTML content ↔ list HTML
  function htmlToList(html, tag) {
    // If already a list, strip it first
    const plain = htmlFromList(html);
    // Split into lines by <br>, <div>, or actual newlines
    const tmp = document.createElement('div');
    tmp.innerHTML = plain;
    const lines = [];
    function extractLines(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { // text node
          const text = child.textContent;
          if (text.trim()) lines.push(text);
        } else if (child.nodeName === 'BR') {
          // skip — line break separator
        } else if (child.nodeName === 'DIV' || child.nodeName === 'P') {
          lines.push(child.innerHTML || '&nbsp;');
        } else {
          lines.push(child.outerHTML);
        }
      }
    }
    extractLines(tmp);
    if (lines.length === 0) lines.push('&nbsp;');
    const items = lines.map(l => `<li>${l}</li>`).join('');
    return `<${tag}>${items}</${tag}>`;
  }

  function htmlFromList(html) {
    if (!html) return '';
    // Detect if it's wrapped in <ul> or <ol>
    const trimmed = html.trim();
    if (!trimmed.match(/^<[uo]l[\s>]/i)) return html;
    // Extract <li> contents
    const tmp = document.createElement('div');
    tmp.innerHTML = trimmed;
    const list = tmp.querySelector('ul, ol');
    if (!list) return html;
    const items = list.querySelectorAll(':scope > li');
    return Array.from(items).map(li => `<div>${li.innerHTML}</div>`).join('');
  }

  // Helper: count how many list levels deep the cursor is
  function getListDepth(editor) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    let depth = 0;
    let node = sel.anchorNode;
    while (node && node !== editor) {
      if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) depth++;
      node = node.parentNode;
    }
    return depth;
  }

  function toggleList(type) {
    const tag = type === 'bullet' ? 'ul' : 'ol';
    const currentState = inlineListState();
    const isActive = currentState === type;

    const editor = activeEditorRef?.current;

    if (editor) {
      // In edit mode: use native execCommand for per-line toggle (like Word/Docs)
      // Ensure selection is inside the editor
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
        if (savedRangeRef.current) {
          restoreSelection();
        } else {
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(range);
        }
      }

      if (isActive) {
        // Removing list: outdent all levels first, then remove the list
        const depth = getListDepth(editor);
        for (let i = 1; i < depth; i++) {
          document.execCommand('outdent');
        }
        // Final toggle removes the list entirely
        const cmd = type === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
        document.execCommand(cmd);
      } else if (currentState && currentState !== type) {
        // Switching list type (e.g. bullet → numbered): remove current, apply new
        const depth = getListDepth(editor);
        for (let i = 1; i < depth; i++) {
          document.execCommand('outdent');
        }
        const removeCmd = currentState === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
        document.execCommand(removeCmd);
        const cmd = type === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
        document.execCommand(cmd);
      } else {
        // Applying list to plain text
        const cmd = type === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
        document.execCommand(cmd);
      }
    } else {
      // Not in edit mode: transform the stored area content (whole block)
      for (const te of textEls) {
        if (te.type === 'contentarea' && te.areaRef) {
          const area = findAreaInPool(contentAreas, te.areaRef);
          const html = area?.content ?? '';
          const newHtml = isActive ? htmlFromList(html) : htmlToList(html, tag);
          updateContentArea(te.areaRef, { content: newHtml });
        }
      }
    }

    // Also update paragraph style resource for tracking
    const newState = inlineListState();
    setParagraphStyle({ listStyle: newState ?? 'none' });
  }

  function applyIndent(direction) {
    const editor = activeEditorRef?.current;
    if (editor) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        if (direction === 'decrease') {
          const depth = getListDepth(editor);
          if (depth === 1) {
            // At top-level list: execCommand('outdent') would remove the <ol>/<ul>
            // entirely (numbers disappear). Instead, just reduce padding-left to keep
            // the list structure intact and numbers visible at the left border.
            let node = sel.anchorNode;
            while (node && node !== editor) {
              if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) {
                const currentPx = parseFloat(window.getComputedStyle(node).paddingLeft) || 22;
                if (currentPx <= 0) return; // already at left border, do nothing
                node.style.paddingLeft = Math.max(0, currentPx - 10) + 'px';
                return;
              }
              node = node.parentNode;
            }
          }
        }
        document.execCommand(direction === 'increase' ? 'indent' : 'outdent');
        return;
      }
    }
    // No active editor — adjust paragraph style leftIndent
    const current = ps.leftIndent ?? 0;
    const newVal = direction === 'increase' ? current + 5 : Math.max(0, current - 5);
    setParagraphStyle({ leftIndent: newVal });
  }

  // ── List style sub-types ─────────────────────────────────────────────
  // Detect current list sub-style from data-list-style attribute
  function getListSubStyle() {
    const editor = activeEditorRef?.current;
    if (!editor) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node = sel.anchorNode;
    while (node && node !== editor) {
      if (node.nodeType === 1) {
        const tag = node.tagName;
        if (tag === 'UL' || tag === 'OL') {
          return node.getAttribute('data-list-style') || (tag === 'UL' ? 'disc' : 'decimal');
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  // Apply a list sub-style: ensure list exists, then set data-list-style on closest <ul>/<ol>
  function applyListSubStyle(type, subStyle) {
    const editor = activeEditorRef?.current;
    if (!editor) return;

    // Ensure cursor is in editor
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      if (savedRangeRef.current) restoreSelection();
      else { editor.focus(); }
    }

    // Ensure we're inside the right list type
    const curState = inlineListState();
    if (!curState) {
      // Not in any list — create one
      const cmd = type === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
      document.execCommand(cmd);
    } else if ((type === 'bullet' && curState === 'numbered') || (type === 'numbered' && curState === 'bullet')) {
      // Wrong list type — switch
      const removeCmd = curState === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
      document.execCommand(removeCmd);
      const cmd = type === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
      document.execCommand(cmd);
    }

    // Now find the closest <ul>/<ol> and set data-list-style
    const sel2 = window.getSelection();
    if (sel2 && sel2.rangeCount > 0) {
      let node = sel2.anchorNode;
      while (node && node !== editor) {
        if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) {
          node.setAttribute('data-list-style', subStyle);
          break;
        }
        node = node.parentNode;
      }
    }

    setListDropdown(null);
    setParagraphStyle({ listStyle: type === 'bullet' ? 'bullet' : 'numbered' });
  }

  // Close list dropdown on outside click (skip if native color picker is open)
  useEffect(() => {
    if (!listDropdown) return;
    const handler = (e) => {
      const tgt = e.target;
      if (tgt.closest('.tft__list-dropdown') || tgt.closest('.tft__list-arrow')) return;
      // Don't close if a color picker inside the dropdown has focus
      const activeEl = document.activeElement;
      if (activeEl && activeEl.type === 'color' && activeEl.closest('.tft__list-dropdown')) return;
      setListDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [listDropdown]);

  // Close style dropdown on outside click
  useEffect(() => {
    if (!styleDropdown) return;
    const handler = (e) => {
      if (e.target.closest('.tft__style-dropdown') || e.target.closest('.tft__style-picker')) return;
      setStyleDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [styleDropdown]);

  // Resolve current style names for display
  const currentTextStyleObj = useMemo(() => {
    if (!currentStyleId) return null;
    return textStyles.find(s => s.id === currentStyleId) ?? null;
  }, [currentStyleId, textStyles]);

  const currentParagraphStyleObj = useMemo(() => {
    if (!currentParagraphStyleId) return null;
    return paragraphStyles.find(s => s.id === currentParagraphStyleId) ?? null;
  }, [currentParagraphStyleId, paragraphStyles]);

  // Apply a named text style to the selected elements (or active area/cell flow).
  // If there's a text SELECTION in the editor → apply only to that selection (inline span).
  function applyNamedTextStyle(styleId) {
    const editor = activeEditorRef?.current;
    if (editor && (hasInlineSelection() || savedRangeRef.current)) {
      if (!hasInlineSelection() && savedRangeRef.current) restoreSelection();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed && editor.contains(sel.anchorNode)) {
        applyTextStyleToRange(sel.getRangeAt(0), resolveTextStyle(styleId, textStyles), fillStyles, zoomRef.current);
        trackInlineStyleRef(styleId);
        forceUpdate(n => n + 1);
        setStyleDropdown(null);
        return;
      }
    }
    // No selection → whole element/area (as before)
    for (const te of textEls) {
      if (te.type === 'contentarea' && te.areaRef) {
        updateContentArea(te.areaRef, { defaultTextStyleId: styleId });
      } else {
        updateEl(te.id, { textStyleId: styleId });
      }
    }
    if (textEls.length === 0 && areaEditCtx) {
      updateContentArea(areaEditCtx.areaId, { defaultTextStyleId: styleId });
    }
    setStyleDropdown(null);
  }

  // Apply a named paragraph style. If editing with a cursor/selection inside the
  // editor → apply per-block (only the paragraph(s) the selection touches) via
  // data-pstyle. Otherwise → whole element/area (as before).
  function applyNamedParagraphStyle(styleId) {
    const editor = activeEditorRef?.current;
    if (editor) {
      let sel = window.getSelection();
      const inEditor = sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode);
      if (inEditor || savedRangeRef.current) {
        if (!inEditor && savedRangeRef.current) restoreSelection();
        sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
          applyParagraphStyleToRange(editor, sel.getRangeAt(0), styleId);
          applyParagraphBlockStyles(editor, paragraphStyles, zoomRef.current);
          forceUpdate(n => n + 1);
          setStyleDropdown(null);
          return;
        }
      }
    }
    // Not editing → whole element/area (as before)
    for (const te of textEls) {
      if (te.type === 'contentarea' && te.areaRef) {
        updateContentArea(te.areaRef, { paragraphStyleId: styleId });
      } else {
        updateEl(te.id, { paragraphStyleId: styleId });
      }
    }
    if (textEls.length === 0 && areaEditCtx) {
      updateContentArea(areaEditCtx.areaId, { paragraphStyleId: styleId });
    }
    setStyleDropdown(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className={`tft${hasText ? '' : ' tft--disabled'}`}
      onMouseDown={e => {
        // Always save the current editor selection before any toolbar interaction
        saveSelection();
        // Prevent focus steal (keeps contentEditable cursor) — but allow selects/inputs to work
        const tag = e.target.tagName;
        if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'OPTION') e.preventDefault();
      }}
    >
      {/* ── Text Style Picker ── */}
      <div className="tft__style-picker" ref={textStyleBtnRef}>
        <button
          className="tft__style-btn"
          disabled={!hasText}
          title="Estilo de texto"
          onClick={() => setStyleDropdown(d => d === 'text' ? null : 'text')}
        >
          <Type size={12} />
          <span className="tft__style-btn__name">
            {currentTextStyleObj?.name ?? 'Normal'}
          </span>
          <ChevronDown size={9} />
        </button>
        <button
          className="tft__style-nav"
          title={currentTextStyleObj ? 'Ir al estilo de texto' : 'Sin estilo asignado'}
          disabled={!currentTextStyleObj}
          onClick={() => {
            if (currentTextStyleObj) navigateToResource?.('textStyle:' + currentTextStyleObj.id);
          }}
        >
          <SquareArrowOutUpRight size={11} />
        </button>
        {styleDropdown === 'text' && textStyleBtnRef.current && ReactDOM.createPortal(
          <div
            className="tft__style-dropdown tft"
            style={{
              position: 'fixed',
              top: textStyleBtnRef.current.getBoundingClientRect().bottom + 4,
              left: textStyleBtnRef.current.getBoundingClientRect().left,
            }}
          >
            <div className="tft__style-dropdown__header">
              <span className="tft__style-dropdown__title">Estilos de texto</span>
              <button
                className="tft__style-dropdown__add"
                title="Crear nuevo estilo de texto"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  const id = addTextStyle?.();
                  if (id) navigateToResource?.('textStyle:' + id);
                  setStyleDropdown(null);
                }}
              >
                <Plus size={11} />
              </button>
            </div>
            <div className="tft__style-dropdown__list">
              {textStyles.map(s => (
                <button
                  key={s.id}
                  className={`tft__style-dropdown__item${s.id === currentStyleId ? ' tft__style-dropdown__item--active' : ''}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => applyNamedTextStyle(s.id)}
                  style={{
                    fontFamily: s.fontFamily ?? 'Inter',
                    fontWeight: s.fontWeight === 'Bold' || s.fontWeight === 'ExtraBold' ? 'bold'
                      : s.fontWeight === 'Light' || s.fontWeight === 'Thin' ? '300' : 'normal',
                    fontStyle: s.italic ? 'italic' : 'normal',
                    color: s.color ?? '#1f2937',
                  }}
                >
                  <span className="tft__style-dropdown__item-name">{s.name}</span>
                  <span className="tft__style-dropdown__item-preview">
                    {s.fontFamily ?? 'Inter'} {s.fontSize ?? 12}pt
                  </span>
                </button>
              ))}
              {textStyles.length === 0 && (
                <div className="tft__style-dropdown__empty">Sin estilos definidos</div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* ── Paragraph Style Picker ── */}
      <div className="tft__style-picker" ref={paraStyleBtnRef}>
        <button
          className="tft__style-btn tft__style-btn--para"
          disabled={!hasText}
          title="Estilo de párrafo"
          onClick={() => setStyleDropdown(d => d === 'paragraph' ? null : 'paragraph')}
        >
          <Pilcrow size={12} />
          <span className="tft__style-btn__name">
            {currentParagraphStyleObj?.name ?? 'Normal'}
          </span>
          <ChevronDown size={9} />
        </button>
        <button
          className="tft__style-nav"
          title={currentParagraphStyleObj ? 'Ir al estilo de párrafo' : 'Sin estilo asignado'}
          disabled={!currentParagraphStyleObj}
          onClick={() => {
            if (currentParagraphStyleObj) navigateToResource?.('paragraphStyle:' + currentParagraphStyleObj.id);
          }}
        >
          <SquareArrowOutUpRight size={11} />
        </button>
        {styleDropdown === 'paragraph' && paraStyleBtnRef.current && ReactDOM.createPortal(
          <div
            className="tft__style-dropdown tft"
            style={{
              position: 'fixed',
              top: paraStyleBtnRef.current.getBoundingClientRect().bottom + 4,
              left: paraStyleBtnRef.current.getBoundingClientRect().left,
            }}
          >
            <div className="tft__style-dropdown__header">
              <span className="tft__style-dropdown__title">Estilos de párrafo</span>
              <button
                className="tft__style-dropdown__add"
                title="Crear nuevo estilo de párrafo"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  const id = addParagraphStyle?.();
                  if (id) navigateToResource?.('paragraphStyle:' + id);
                  setStyleDropdown(null);
                }}
              >
                <Plus size={11} />
              </button>
            </div>
            <div className="tft__style-dropdown__list">
              {paragraphStyles.map(s => (
                <button
                  key={s.id}
                  className={`tft__style-dropdown__item${s.id === currentParagraphStyleId ? ' tft__style-dropdown__item--active' : ''}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => applyNamedParagraphStyle(s.id)}
                >
                  <span className="tft__style-dropdown__item-name">{s.name}</span>
                  <span className="tft__style-dropdown__item-preview">
                    {s.alignment ?? 'left'}{s.listStyle && s.listStyle !== 'none' ? ` · ${s.listStyle}` : ''}
                  </span>
                </button>
              ))}
              {paragraphStyles.length === 0 && (
                <div className="tft__style-dropdown__empty">Sin estilos definidos</div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>

      <div className="tft__sep" />

      {/* ── Font Family ── */}
      <div className="tft__select-wrap">
        <select
          className="tft__select tft__select--font"
          value={ets.fontFamily ?? 'Inter'}
          disabled={!hasText}
          onChange={e => applyTextStyleChange({ fontFamily: e.target.value })}
        >
          {allFontFamilies.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <ChevronDown size={10} className="tft__select-arrow" />
      </div>

      {/* ── Font Weight ── */}
      <div className="tft__select-wrap tft__select-wrap--weight">
        <select
          className="tft__select tft__select--weight"
          value={ets.fontWeight ?? 'Regular'}
          disabled={!hasText}
          onChange={e => applyTextStyleChange({ fontWeight: e.target.value })}
        >
          {FONT_WEIGHTS.map(w => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
        <ChevronDown size={10} className="tft__select-arrow" />
      </div>

      {/* ── Font Size + unit + arrows ── */}
      <SizeInput
        valuePt={ets.fontSize ?? 12}
        unit={sizeUnit}
        disabled={!hasText}
        onChangeUnit={() => setSizeUnit(u => SIZE_UNITS[(SIZE_UNITS.indexOf(u) + 1) % SIZE_UNITS.length])}
        onChange={ptVal => applyTextStyleChange({ fontSize: ptVal })}
      />

      <div className="tft__sep" />

      {/* ── Bold / Italic / Underline / Strikethrough ── */}
      <button
        className={`tft__btn${(ets.fontWeight === 'Bold' || ets.fontWeight === 'ExtraBold') ? ' tft__btn--active' : ''}`}
        disabled={!hasText}
        title="Negrita"
        onClick={() => {
          const isBold = ets.fontWeight === 'Bold' || ets.fontWeight === 'ExtraBold';
          applyTextStyleChange({ fontWeight: isBold ? 'Regular' : 'Bold' });
        }}
      >
        <Bold size={14} />
      </button>
      <button
        className={`tft__btn${ets.italic ? ' tft__btn--active' : ''}`}
        disabled={!hasText}
        title="Cursiva"
        onClick={() => toggleBool('italic')}
      >
        <Italic size={14} />
      </button>
      <button
        className={`tft__btn${ets.underline ? ' tft__btn--active' : ''}`}
        disabled={!hasText}
        title="Subrayado"
        onClick={() => toggleBool('underline')}
      >
        <Underline size={14} />
      </button>
      <button
        className={`tft__btn${ets.strikethrough ? ' tft__btn--active' : ''}`}
        disabled={!hasText}
        title="Tachado"
        onClick={() => toggleBool('strikethrough')}
      >
        <Strikethrough size={14} />
      </button>

      {/* ── Hyperlink ── */}
      <div className="tft__link-wrap" ref={linkBtnRef}>
        <button
          className={`tft__btn${(iState?.linkAnchor || getSelectionLink()) ? ' tft__btn--active' : ''}`}
          disabled={!hasText}
          title="Hipervínculo"
          onClick={openLinkModal}
        >
          <Link2 size={14} />
        </button>
        {linkModalOpen && (
          <LinkModal
            anchorRef={linkBtnRef}
            initialUrl={(iState?.linkAnchor || getSelectionLink())?.href ?? ''}
            onConfirm={insertLink}
            onRemove={removeLink}
            onClose={() => setLinkModalOpen(false)}
          />
        )}
      </div>

      <div className="tft__sep" />

      {/* ── Text Color ── */}
      <TextColorButton
        color={resolvedTextColor}
        fillStyleId={ets.fillStyleId ?? null}
        fillStyles={fillStyles}
        disabled={!hasText}
        onOpen={saveSelection}
        onApplyColor={hex => applyTextStyleChange({ color: hex })}
        onApplyFillStyle={(fsId, fsColor) => applyTextStyleChange({ fillStyleId: fsId, color: fsColor })}
        onAddFillStyle={addFillStyle}
        onNavigate={id => navigateToResource?.('fillStyle:' + id)}
      />

      <div className="tft__sep" />

      {/* ── Alignment ── */}
      {ALIGNMENTS.map(a => (
        <button
          key={a.value}
          className={`tft__btn${(ps.alignment ?? 'left') === a.value ? ' tft__btn--active' : ''}`}
          disabled={!hasText}
          title={a.label}
          onClick={() => setParagraphStyle({ alignment: a.value })}
        >
          <a.Icon size={14} />
        </button>
      ))}

      <div className="tft__sep" />

      {/* ── Line Height ── */}
      <div className="tft__mini-field" title="Interlineado">
        <span className="tft__mini-label">LH</span>
        <input
          className="tft__mini-input"
          type="number"
          min={0.5}
          max={5}
          step={0.1}
          value={ets.lineHeight ?? 1.4}
          disabled={!hasText}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) applyTextStyleChange({ lineHeight: v });
          }}
        />
      </div>

      {/* ── Letter Spacing ── */}
      <div className="tft__mini-field" title="Espaciado de letras (px)">
        <span className="tft__mini-label">LS</span>
        <input
          className="tft__mini-input"
          type="number"
          step={0.1}
          value={ets.letterSpacing ?? 0}
          disabled={!hasText}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) applyTextStyleChange({ letterSpacing: v });
          }}
        />
      </div>

      <div className="tft__sep" />

      {/* ── Vertical Alignment ── */}
      {V_ALIGNMENTS.map(a => (
        <button
          key={a.value}
          className={`tft__btn${(ps.verticalAlign ?? 'top') === a.value ? ' tft__btn--active' : ''}`}
          disabled={!hasText}
          title={a.label}
          onClick={() => setParagraphStyle({ verticalAlign: a.value })}
        >
          <a.Icon size={14} />
        </button>
      ))}

      <div className="tft__sep" />

      {/* ── List Style (split buttons with dropdown for style selection) ── */}
      <div className="tft__list-split" ref={bulletDropBtnRef}>
        <button
          className={`tft__btn tft__btn--split-main${inlineListState() === 'bullet' ? ' tft__btn--active' : ''}`}
          disabled={!hasText}
          title="Lista con viñetas"
          onClick={() => toggleList('bullet')}
        >
          <List size={14} />
        </button>
        <button
          className={`tft__list-arrow${inlineListState() === 'bullet' ? ' tft__list-arrow--active' : ''}`}
          disabled={!hasText}
          title="Estilos de viñeta"
          onClick={() => setListDropdown(d => d === 'bullet' ? null : 'bullet')}
        >
          <ChevronDown size={8} />
        </button>
        {listDropdown === 'bullet' && bulletDropBtnRef.current && ReactDOM.createPortal(
          <div
            className="tft__list-dropdown"
            style={{
              position: 'fixed',
              top: bulletDropBtnRef.current.getBoundingClientRect().bottom + 4,
              left: bulletDropBtnRef.current.getBoundingClientRect().left,
            }}
          >
            <div className="tft__list-dropdown__title">Estilos de viñeta</div>
            <div className="tft__list-dropdown__grid">
              {[
                { style: 'disc',   symbol: '●', label: 'Disco' },
                { style: 'circle', symbol: '○', label: 'Círculo' },
                { style: 'square', symbol: '■', label: 'Cuadrado' },
                { style: 'dash',   symbol: '–', label: 'Guion' },
                { style: 'arrow',  symbol: '➤', label: 'Flecha' },
                { style: 'check',  symbol: '✓', label: 'Check' },
              ].map(b => (
                <button
                  key={b.style}
                  className={`tft__list-dropdown__item${getListSubStyle() === b.style ? ' tft__list-dropdown__item--active' : ''}`}
                  title={b.label}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => applyListSubStyle('bullet', b.style)}
                >
                  <span className="tft__list-dropdown__symbol">{b.symbol}</span>
                  <span className="tft__list-dropdown__label">{b.label}</span>
                </button>
              ))}
            </div>
            <div className="tft__list-dropdown__color-section">
              <div className="tft__list-dropdown__color-label">Color marcador</div>
              <div className="tft__list-dropdown__color-row">
                {['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#111827'].map(c => (
                  <button
                    key={c || 'inherit'}
                    className={`tft__list-dropdown__color-chip${(currentParagraphStyleObj?.listColor ?? '') === c ? ' tft__list-dropdown__color-chip--active' : ''}`}
                    style={c ? { background: c } : undefined}
                    title={c || 'Heredar'}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setParagraphStyle({ listColor: c }); }}
                  >
                    {!c && <span className="tft__list-dropdown__color-x">∅</span>}
                  </button>
                ))}
                <DeferredColorInput
                  className="tft__list-dropdown__color-custom"
                  value={currentParagraphStyleObj?.listColor || '#000000'}
                  onCommit={c => setParagraphStyle({ listColor: c })}
                  title="Color personalizado"
                />
              </div>
            </div>
            <button
              className="tft__list-dropdown__none"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { toggleList('bullet'); setListDropdown(null); }}
            >
              Ninguna
            </button>
          </div>,
          document.body
        )}
      </div>

      <div className="tft__list-split" ref={numberDropBtnRef}>
        <button
          className={`tft__btn tft__btn--split-main${inlineListState() === 'numbered' ? ' tft__btn--active' : ''}`}
          disabled={!hasText}
          title="Lista numerada"
          onClick={() => toggleList('numbered')}
        >
          <ListOrdered size={14} />
        </button>
        <button
          className={`tft__list-arrow${inlineListState() === 'numbered' ? ' tft__list-arrow--active' : ''}`}
          disabled={!hasText}
          title="Estilos de numeración"
          onClick={() => setListDropdown(d => d === 'numbered' ? null : 'numbered')}
        >
          <ChevronDown size={8} />
        </button>
        {listDropdown === 'numbered' && numberDropBtnRef.current && ReactDOM.createPortal(
          <div
            className="tft__list-dropdown"
            style={{
              position: 'fixed',
              top: numberDropBtnRef.current.getBoundingClientRect().bottom + 4,
              left: numberDropBtnRef.current.getBoundingClientRect().left,
            }}
          >
            <div className="tft__list-dropdown__title">Estilos de numeración</div>
            <div className="tft__list-dropdown__grid tft__list-dropdown__grid--num">
              {[
                { style: 'decimal',     lines: ['1.', '2.', '3.'], label: 'Decimal' },
                { style: 'decimal-paren', lines: ['1)', '2)', '3)'], label: 'Decimal paréntesis' },
                { style: 'upper-roman', lines: ['I.', 'II.', 'III.'], label: 'Romano mayúscula' },
                { style: 'upper-alpha', lines: ['A.', 'B.', 'C.'], label: 'Letra mayúscula' },
                { style: 'lower-alpha', lines: ['a.', 'b.', 'c.'], label: 'Letra minúscula' },
                { style: 'lower-roman', lines: ['i.', 'ii.', 'iii.'], label: 'Romano minúscula' },
                { style: 'lower-alpha-paren', lines: ['a)', 'b)', 'c)'], label: 'Letra paréntesis' },
              ].map(n => (
                <button
                  key={n.style}
                  className={`tft__list-dropdown__item tft__list-dropdown__item--num${getListSubStyle() === n.style ? ' tft__list-dropdown__item--active' : ''}`}
                  title={n.label}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => applyListSubStyle('numbered', n.style)}
                >
                  <div className="tft__list-dropdown__lines">
                    {n.lines.map((l, i) => <div key={i}>{l} ────</div>)}
                  </div>
                </button>
              ))}
            </div>
            <div className="tft__list-dropdown__color-section">
              <div className="tft__list-dropdown__color-label">Color marcador</div>
              <div className="tft__list-dropdown__color-row">
                {['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#111827'].map(c => (
                  <button
                    key={c || 'inherit'}
                    className={`tft__list-dropdown__color-chip${(currentParagraphStyleObj?.listColor ?? '') === c ? ' tft__list-dropdown__color-chip--active' : ''}`}
                    style={c ? { background: c } : undefined}
                    title={c || 'Heredar'}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setParagraphStyle({ listColor: c }); }}
                  >
                    {!c && <span className="tft__list-dropdown__color-x">∅</span>}
                  </button>
                ))}
                <DeferredColorInput
                  className="tft__list-dropdown__color-custom"
                  value={currentParagraphStyleObj?.listColor || '#000000'}
                  onCommit={c => setParagraphStyle({ listColor: c })}
                  title="Color personalizado"
                />
              </div>
            </div>
            <button
              className="tft__list-dropdown__none"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { toggleList('numbered'); setListDropdown(null); }}
            >
              Ninguna
            </button>
          </div>,
          document.body
        )}
      </div>

      {/* ── Indent ── */}
      <button
        className="tft__btn"
        disabled={!hasText}
        title="Aumentar sangría"
        onClick={() => applyIndent('increase')}
      >
        <IndentIncrease size={14} />
      </button>
      <button
        className="tft__btn"
        disabled={!hasText}
        title="Disminuir sangría"
        onClick={() => applyIndent('decrease')}
      >
        <IndentDecrease size={14} />
      </button>

      <div className="tft__sep" />

      {/* ── Superscript / Subscript ── */}
      <button
        className={`tft__btn${ets.superscript ? ' tft__btn--active' : ''}`}
        disabled={!hasText}
        title="Superíndice"
        onClick={() => {
          if (hasInlineSelection() || savedRangeRef.current) {
            applyTextStyleChange({ superscript: true });
          } else {
            const on = !(ets.superscript ?? false);
            applyTextStyleChange({ superscript: on, subscript: on ? false : (ets.subscript ?? false) });
          }
        }}
      >
        <Superscript size={14} />
      </button>
      <button
        className={`tft__btn${ets.subscript ? ' tft__btn--active' : ''}`}
        disabled={!hasText}
        title="Subíndice"
        onClick={() => {
          if (hasInlineSelection() || savedRangeRef.current) {
            applyTextStyleChange({ subscript: true });
          } else {
            const on = !(ets.subscript ?? false);
            applyTextStyleChange({ subscript: on, superscript: on ? false : (ets.superscript ?? false) });
          }
        }}
      >
        <Subscript size={14} />
      </button>

      <div className="tft__sep" />

      {/* ── Text Transform ── */}
      {TEXT_TRANSFORMS.map(t => (
        <button
          key={t.value}
          className={`tft__btn${(ets.textTransform ?? 'none') === t.value ? ' tft__btn--active' : ''}`}
          disabled={!hasText}
          title={t.label}
          onClick={() => {
            const current = ets.textTransform ?? 'none';
            applyTextStyleChange({ textTransform: current === t.value ? 'none' : t.value });
          }}
        >
          <t.Icon size={14} />
        </button>
      ))}

      <div className="tft__sep" />

      {/* ── Show Invisible Characters ── */}
      <button
        className={`tft__btn${showInvisibles ? ' tft__btn--active' : ''}`}
        title="Mostrar caracteres invisibles (¶)"
        onClick={onToggleInvisibles}
      >
        <Pilcrow size={14} />
      </button>
    </div>
  );
}
