import { useEffect, useRef } from 'react';
import type { TextEl, TextSpan } from '@/types/document';
import { MM_TO_PX, PT_PER_MM } from '@/utils/units';
import { spansToHtml, htmlToSpans } from '@/utils/richText';
import { useActiveEditorStore } from '@/store/activeEditorStore';

interface Props {
  el: TextEl;
  zoom: number;
  offsetX: number;
  offsetY: number;
  onCommit: (spans: TextSpan[]) => void;
  onCancel: () => void;
}

/**
 * Editor de texto en línea (contenteditable) del lienzo.
 *
 * - SOLO edita el texto y permite insertar variables `{{campo}}` (fichas).
 * - El FORMATO (fuente, tamaño, color, negrita, alineación…) se controla desde
 *   la barra de formato de ARRIBA (a nivel de elemento) para que haya una sola
 *   fuente de verdad — se quitó la barra flotante que causaba inconsistencias.
 * - Se registra en `activeEditorStore` para que el panel de Datos inserte una
 *   variable en la posición del cursor (doble clic o arrastre).
 */
export default function TextEditorOverlay({ el, zoom, offsetX, offsetY, onCommit, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef    = useRef<HTMLDivElement>(null);
  const doneRef      = useRef(false);
  const cancelRef    = useRef(false);
  const savedRange   = useRef<Range | null>(null);
  const onCommitRef  = useRef(onCommit);
  const onCancelRef  = useRef(onCancel);
  const setApi = useActiveEditorStore((s) => s.setApi);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  const s      = MM_TO_PX * zoom;
  const fontPx = (el.fontSize / PT_PER_MM) * s;
  const textAlign = el.align.startsWith('justify')
    ? (el.align === 'justify-center' ? 'center' : el.align === 'justify-right' ? 'right' : 'left')
    : (el.align as 'left' | 'center' | 'right');

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

  /* ── selección: guardar el rango para insertar variables ── */
  function rangeInsideEditor(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    return !!editorRef.current && editorRef.current.contains(r.commonAncestorContainer);
  }
  function saveSelection() {
    if (rangeInsideEditor()) {
      savedRange.current = window.getSelection()!.getRangeAt(0).cloneRange();
    }
  }
  function restoreSelection() {
    const ed = editorRef.current;
    const r = savedRange.current;
    if (!ed || !r || !ed.contains(r.commonAncestorContainer)) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  /* ── formato inline sobre la selección (lo llama la barra de arriba) ── */
  function execCmd(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    restoreSelection();
    document.execCommand(cmd, false);
    saveSelection();
  }
  function wrapSelectionCss(cssText: string) {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.cssText = cssText;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);
      savedRange.current = nr.cloneRange();
    } catch { /* selección cruzada: se ignora */ }
  }
  function setColorSel(hex: string) { wrapSelectionCss(`color:${hex}`); }
  function setFontSizeSel(pt: number) { if (pt > 0) wrapSelectionCss(`font-size:${pt}pt`); }

  /* ── inserción de una variable como ficha ── */
  function makeChip(binding: string): HTMLElement {
    const label = binding.split('.').pop() ?? binding;
    const span = document.createElement('span');
    span.className = 'var-chip';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-binding', binding);
    span.style.cssText =
      'background:rgba(144,39,116,.13);color:#902774;border-radius:3px;padding:0 3px;' +
      'font-size:.9em;border:1px solid rgba(144,39,116,.3);user-select:none;cursor:default';
    span.textContent = `{{${label}}}`;
    return span;
  }
  function insertNodeAtRange(range: Range, node: Node) {
    range.deleteContents();
    range.insertNode(node);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    savedRange.current = after.cloneRange();
  }
  function insertBindingAtCaret(binding: string) {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    // usa el rango guardado si sigue dentro del editor; si no, inserta al final
    let range = savedRange.current;
    if (!range || !ed.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
    }
    insertNodeAtRange(range, makeChip(binding));
  }
  function insertBindingAtPoint(binding: string, clientX: number, clientY: number) {
    const ed = editorRef.current;
    if (!ed) return;
    const docAny = document as unknown as {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let range: Range | null = null;
    if (docAny.caretRangeFromPoint) {
      range = docAny.caretRangeFromPoint(clientX, clientY);
    } else if (docAny.caretPositionFromPoint) {
      const pos = docAny.caretPositionFromPoint(clientX, clientY);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    }
    if (!range || !ed.contains(range.commonAncestorContainer)) { insertBindingAtCaret(binding); return; }
    insertNodeAtRange(range, makeChip(binding));
  }

  /* ── init editor ── */
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    const initHtml = (el.spans?.length) ? spansToHtml(el.spans) : escHtml(el.text);
    ed.innerHTML = initHtml;

    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    savedRange.current = range.cloneRange();

    // Registrar este editor como el activo (barra de formato + panel de Datos)
    setApi({
      insertBinding: insertBindingAtCaret,
      exec: execCmd,
      setColor: setColorSel,
      setFontSize: setFontSizeSel,
    });

    // Mantener actualizado el rango del cursor
    const onSelChange = () => saveSelection();
    document.addEventListener('selectionchange', onSelChange);

    // Clic fuera: commitea (salvo si es sobre el árbol de Datos → insertar variable)
    function onOutsideMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (containerRef.current && containerRef.current.contains(target as Node)) return;
      // No cerrar el editor al usar el panel de Datos o la barra de formato
      // (insertar variable / formatear la selección).
      if (target && (target.closest('[data-var-source]') || target.closest('[data-format-toolbar]'))) return;
      cancelRef.current ? cancel() : commit();
    }
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', onOutsideMouseDown, true);
      document.removeEventListener('selectionchange', onSelChange);
      setApi(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── keyboard ── */
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.preventDefault(); cancelRef.current = true; cancel(); }
    // Ctrl+B/I/U aplican formato inline nativo del contentEditable (a la palabra
    // seleccionada) — se dejan pasar; el guard del Canvas ignora atajos cuando el
    // foco está en un contentEditable.
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
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onBlur={() => { if (!cancelRef.current) saveSelection(); }}
        onDragOver={(e) => {
          // permite el "cursor de texto" nativo siguiendo al puntero durante el arrastre
          if (e.dataTransfer.types.includes('text/x-binding-path')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const binding = e.dataTransfer.getData('text/x-binding-path');
          if (!binding) return;
          e.preventDefault();
          e.stopPropagation();
          insertBindingAtPoint(binding, e.clientX, e.clientY);
        }}
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
    </div>
  );
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
