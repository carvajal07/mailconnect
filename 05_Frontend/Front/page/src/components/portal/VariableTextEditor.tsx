import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Editor de texto con VARIABLES como "fichas" (chips) azules NO editables.
 *
 * A diferencia de un <TextField> normal, aquí las variables `{{Columna}}` se pintan como una
 * ficha azul de una sola pieza: se insertan EN EL CURSOR (no al final) y el retroceso
 * (Backspace) borra la ficha completa de un golpe (no carácter por carácter).
 *
 * Es un `contentEditable` controlado: el `value` sigue siendo el texto plano con tokens
 * `{{Columna}}` (para que el backend no cambie), pero visualmente se renderiza con chips.
 *
 * Uso:
 *   const ref = useRef<VariableTextEditorHandle>(null);
 *   <VariableTextEditor ref={ref} value={body} onChange={setBody} placeholder="…" />
 *   <DatabaseFieldPicker onInsert={(f) => ref.current?.insertVariable(f)} />
 */

export interface VariableTextEditorHandle {
  /** Inserta la variable como ficha en la posición del cursor (o al final si no hay foco previo). */
  insertVariable: (name: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Alto mínimo aproximado en filas de texto. */
  minRows?: number;
  disabled?: boolean;
}

const ZWSP = '​';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const chipHtml = (name: string): string => {
  const safe = escapeHtml(name);
  return `<span class="mc-var-chip" contenteditable="false" data-var="${safe}">${safe}</span>`;
};

/** Texto plano con {{tokens}} -> HTML con fichas (para pintar en el editor). */
export const tokensToHtml = (value: string): string => {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let html = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    html += escapeHtml(value.slice(last, m.index)).replace(/\n/g, '<br>');
    html += chipHtml(m[1].trim());
    last = m.index + m[0].length;
  }
  html += escapeHtml(value.slice(last)).replace(/\n/g, '<br>');
  return html;
};

/** HTML del editor -> texto plano con {{tokens}} (para guardar). */
export const serializeTokens = (root: HTMLElement): string => {
  let out = '';
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (el.dataset.var !== undefined) {
          out += `{{${el.dataset.var}}}`;
        } else if (el.tagName === 'BR') {
          out += '\n';
        } else if (el.tagName === 'DIV' || el.tagName === 'P') {
          if (out && !out.endsWith('\n')) out += '\n';
          walk(el);
        } else {
          walk(el);
        }
      }
    });
  };
  walk(root);
  return out.split(ZWSP).join('');
};

export const VariableTextEditor = forwardRef<VariableTextEditorHandle, Props>(
  ({ value, onChange, placeholder, minRows = 3, disabled }, ref) => {
    const elRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);
    const lastValue = useRef<string>('');

    // Enter -> <br> (en vez de <div>), serialización más simple.
    useEffect(() => {
      try { document.execCommand('defaultParagraphSeparator', false, 'br'); } catch { /* noop */ }
    }, []);

    // Sincroniza value externo -> DOM (solo cuando REALMENTE cambia desde afuera).
    useEffect(() => {
      const el = elRef.current;
      if (!el) return;
      if (value === lastValue.current) return; // cambio propio (tecleo/insert): no repintar
      if (value !== serializeTokens(el)) el.innerHTML = tokensToHtml(value);
      lastValue.current = value;
    }, [value]);

    const emitChange = () => {
      const el = elRef.current;
      if (!el) return;
      const v = serializeTokens(el);
      lastValue.current = v;
      onChange(v);
    };

    const saveSelection = () => {
      const el = elRef.current;
      const sel = window.getSelection();
      if (el && sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        if (el.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
      }
    };

    useImperativeHandle(ref, () => ({
      focus: () => elRef.current?.focus(),
      insertVariable: (name: string) => {
        const el = elRef.current;
        const sel = window.getSelection();
        if (!el || !sel) return;
        el.focus();
        // Restaura la última posición del cursor dentro del editor (o coloca al final).
        let range =
          savedRange.current && el.contains(savedRange.current.commonAncestorContainer)
            ? savedRange.current
            : sel.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer)
              ? sel.getRangeAt(0)
              : null;
        if (!range) {
          range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);
        range.deleteContents();

        const chip = document.createElement('span');
        chip.className = 'mc-var-chip';
        chip.contentEditable = 'false';
        chip.dataset.var = name;
        chip.textContent = name;
        range.insertNode(chip);

        // Deja el cursor JUSTO después de la ficha.
        const after = document.createRange();
        after.setStartAfter(chip);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
        savedRange.current = after.cloneRange();
        emitChange();
      },
    }));

    // Backspace/Delete pegado a una ficha => borra la ficha COMPLETA.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const el = elRef.current;
      const sel = window.getSelection();
      if (!el || !sel || !sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const { startContainer, startOffset } = range;
      let target: Node | null = null;
      if (e.key === 'Backspace') {
        if (startContainer.nodeType === Node.TEXT_NODE) {
          if (startOffset === 0) target = startContainer.previousSibling;
        } else {
          target = startContainer.childNodes[startOffset - 1] ?? null;
        }
      } else {
        if (startContainer.nodeType === Node.TEXT_NODE) {
          if (startOffset === (startContainer.textContent?.length ?? 0)) target = startContainer.nextSibling;
        } else {
          target = startContainer.childNodes[startOffset] ?? null;
        }
      }
      if (target && target.nodeType === Node.ELEMENT_NODE && (target as HTMLElement).dataset?.var !== undefined) {
        e.preventDefault();
        (target as HTMLElement).remove();
        emitChange();
      }
    };

    return (
      <Box sx={{ position: 'relative' }}>
        <Box
          ref={elRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={emitChange}
          onKeyDown={onKeyDown}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onBlur={saveSelection}
          sx={{
            minHeight: minRows * 24 + 16,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.25,
            fontSize: 14,
            lineHeight: 1.7,
            outline: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            transition: 'border-color .15s, box-shadow .15s',
            '&:focus': {
              borderColor: 'primary.main',
              boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}`,
            },
            '& .mc-var-chip': {
              display: 'inline-block',
              bgcolor: 'primary.main',
              color: '#fff',
              borderRadius: '6px',
              px: 0.75,
              mx: '2px',
              fontSize: '0.82em',
              fontWeight: 700,
              lineHeight: 1.5,
              userSelect: 'none',
              cursor: 'default',
              whiteSpace: 'nowrap',
            },
          }}
        />
        {!value && placeholder && (
          <Typography
            variant="body2"
            sx={{ position: 'absolute', top: 11, left: 12, color: 'text.disabled', pointerEvents: 'none' }}
          >
            {placeholder}
          </Typography>
        )}
      </Box>
    );
  },
);

VariableTextEditor.displayName = 'VariableTextEditor';
