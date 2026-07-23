import { useEffect, useRef, useState } from 'react';
import type { TextEl, TextSpan } from '@/types/document';
import { MM_TO_PX, PT_PER_MM } from '@/utils/units';
import { spansToHtml, htmlToSpans } from '@/utils/richText';

interface Props {
  el: TextEl;
  zoom: number;
  offsetX: number;
  offsetY: number;
  onCommit: (spans: TextSpan[]) => void;
  onCancel: () => void;
}

/* Colores rápidos de la paleta */
const PALETTE = ['#000000', '#ffffff', '#ef4444', '#3b82f6', '#22c55e', '#f97316', '#a855f7', '#902774'];

export default function TextEditorOverlay({ el, zoom, offsetX, offsetY, onCommit, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef    = useRef<HTMLDivElement>(null);
  const doneRef      = useRef(false);
  const cancelRef    = useRef(false);
  const savedRange   = useRef<Range | null>(null);
  const onCommitRef  = useRef(onCommit);
  const onCancelRef  = useRef(onCancel);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  const [sizeInput, setSizeInput] = useState(String(el.fontSize));

  const s      = MM_TO_PX * zoom;
  const fontPx = (el.fontSize / PT_PER_MM) * s;
  const textAlign = el.align.startsWith('justify') ? 'left' : (el.align as 'left' | 'center' | 'right');

  /* ── commit / cancel ── */
  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    const html = editorRef.current?.innerHTML ?? '';
    onCommitRef.current(htmlToSpans(html));
  }
  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancelRef.current();
  }

  /* ── init editor ── */
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    // Populate with existing content
    const initHtml = (el.spans?.length)
      ? spansToHtml(el.spans)
      : escHtml(el.text);
    ed.innerHTML = initHtml;

    ed.focus();
    // Place cursor at end
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    // Outside-click commits
    function onOutsideMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        cancelRef.current ? cancel() : commit();
      }
    }
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── selection save/restore (for toolbar interactions) ── */
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    editorRef.current?.focus();
    const r = savedRange.current;
    if (!r) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  /* ── formatting helpers ── */
  function fmt(cmd: string, val?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  }
  function wrapSelection(cssText: string) {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.cssText = cssText;
    try {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);
    } catch { /* cross-boundary selection – skip */ }
  }
  function applyColor(hex: string) { wrapSelection(`color:${hex}`); }
  function applySize(pt: number) {
    if (!pt || pt < 1) return;
    wrapSelection(`font-size:${pt}pt`);
  }

  /* ── keyboard ── */
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.preventDefault(); cancelRef.current = true; cancel(); }
    // Allow Enter (line break inside contenteditable)
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: offsetX + el.x * s,
        top:  offsetY + el.y * s,
        zIndex: 1000,
        transformOrigin: 'top left',
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      {/* ── Editor ── */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onBlur={() => { if (!cancelRef.current) commit(); }}
        style={{
          width: el.width * s,
          minHeight: el.height * s,
          fontFamily: el.fontFamily,
          fontSize: fontPx,
          fontStyle: el.fontStyle,
          fontWeight: el.fontWeight,
          color: el.color,
          lineHeight: el.lineHeight,
          textAlign,
          background: 'rgba(255,255,255,0.97)',
          border: '1.5px solid oklch(0.68 0.19 235)',
          borderRadius: 2,
          outline: 'none',
          padding: 0,
          margin: 0,
          boxSizing: 'border-box',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      />

      {/* ── Toolbar ── */}
      <div
        onMouseDown={(e) => e.preventDefault()} // keep editor focus
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 2,
          marginTop: 4,
          padding: '3px 4px',
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,.18)',
          userSelect: 'none',
        }}
      >
        {/* Bold */}
        <TBtn title="Negrita (Ctrl+B)" style={{ fontWeight: 700 }} onMouseDown={() => fmt('bold')}>B</TBtn>
        {/* Italic */}
        <TBtn title="Cursiva (Ctrl+I)" style={{ fontStyle: 'italic' }} onMouseDown={() => fmt('italic')}>I</TBtn>
        {/* Underline */}
        <TBtn title="Subrayado (Ctrl+U)" style={{ textDecoration: 'underline' }} onMouseDown={() => fmt('underline')}>U</TBtn>
        {/* Strikethrough */}
        <TBtn title="Tachado" style={{ textDecoration: 'line-through' }} onMouseDown={() => fmt('strikeThrough')}>S</TBtn>

        <Sep />

        {/* Color palette */}
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); applyColor(c); }}
            style={{
              width: 14, height: 14, borderRadius: 2, cursor: 'pointer',
              background: c, border: c === '#ffffff' ? '1px solid #ccc' : '1px solid transparent',
              flexShrink: 0,
            }}
          />
        ))}

        {/* Hex color input */}
        <input
          type="text"
          maxLength={7}
          placeholder="#hex"
          defaultValue=""
          title="Color personalizado"
          onMouseDown={(e) => { e.stopPropagation(); saveSelection(); }}
          onFocus={saveSelection}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const val = e.currentTarget.value;
              if (/^#[0-9a-f]{6}$/i.test(val)) applyColor(val);
            }
          }}
          style={{ width: 46, fontSize: 10, padding: '1px 3px', border: '1px solid var(--line)', borderRadius: 2, background: 'var(--bg-2)', color: 'var(--ink)' }}
        />

        <Sep />

        {/* Font size */}
        <input
          type="number"
          min={4} max={300} step={0.5}
          value={sizeInput}
          title="Tamaño de fuente (pt)"
          onMouseDown={(e) => { e.stopPropagation(); saveSelection(); }}
          onFocus={saveSelection}
          onChange={(e) => setSizeInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') applySize(parseFloat(sizeInput));
          }}
          onBlur={() => applySize(parseFloat(sizeInput))}
          style={{ width: 42, fontSize: 10, padding: '1px 3px', border: '1px solid var(--line)', borderRadius: 2, background: 'var(--bg-2)', color: 'var(--ink)' }}
        />
        <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>pt</span>

        <Sep />

        {/* Clear rich text */}
        <TBtn
          title="Quitar formato"
          onMouseDown={() => { restoreSelection(); fmt('removeFormat'); }}
          style={{ fontSize: 9, color: 'var(--ink-2)' }}
        >A×</TBtn>
      </div>
    </div>
  );
}

/* ── Small components ── */

function TBtn({ children, title, style, onMouseDown }: {
  children: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
  onMouseDown: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, borderRadius: 3, cursor: 'pointer', border: 'none',
        background: 'var(--bg-3)', color: 'var(--ink)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px', flexShrink: 0 }} />;
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
