import type { TextSpan, TextEl } from '@/types/document';
import { PT_PER_MM, MM_TO_PX } from './units';

/* ─── Tipos internos ─── */

export interface DrawCmd {
  text: string;
  x: number;
  y: number;
  lineH: number;
  fontSize: number;
  font: string;
  color: string;
  underline: boolean;
  lineThrough: boolean;
  isVariable: boolean;
  /** Ancho medido del run (para el resaltado de variables). */
  width?: number;
}

/* ─── Plain text ─── */

export function spansToPlainText(spans: TextSpan[]): string {
  return spans
    .map((s) => (s.binding ? `{{${s.binding}}}` : (s.text ?? '')))
    .join('');
}

/* ─── Layout engine ─── */

export function layoutSpans(
  ctx: CanvasRenderingContext2D,
  spans: TextSpan[],
  el: Pick<TextEl, 'fontSize' | 'fontWeight' | 'fontStyle' | 'fontFamily' | 'lineHeight' | 'color' | 'textDecoration' | 'align'>,
  fontScale: number,        // zoom * MM_TO_PX
  containerWidthPx: number,
): DrawCmd[] {
  const defaultFontPx = (el.fontSize / PT_PER_MM) * fontScale;
  const defaultLineH  = defaultFontPx * el.lineHeight;

  function resolveFont(span: TextSpan) {
    const sz  = span.fontSize ? (span.fontSize / PT_PER_MM) * fontScale : defaultFontPx;
    const w   = (span.fontWeight ?? el.fontWeight) >= 600 ? 'bold' : 'normal';
    const it  = (span.fontStyle ?? el.fontStyle) === 'italic' ? 'italic ' : '';
    const fam = span.fontFamily ?? el.fontFamily;
    return { font: `${it}${w} ${sz}px "${fam}"`, fontSize: sz };
  }

  /* ── Tokenize ── */
  interface Token {
    text: string;
    font: string;
    fontSize: number;
    color: string;
    underline: boolean;
    lineThrough: boolean;
    isVariable: boolean;
    isNewline: boolean;
  }

  const tokens: Token[] = [];

  for (const span of spans) {
    const { font, fontSize } = resolveFont(span);
    const color = span.color ?? el.color;
    const td = span.textDecoration ?? el.textDecoration;

    if (span.binding) {
      const label = `{{${span.binding.split('.').pop() ?? span.binding}}}`;
      tokens.push({ text: label, font, fontSize, color, underline: false, lineThrough: false, isVariable: true, isNewline: false });
    } else {
      const lines = (span.text ?? '').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) tokens.push({ text: '', font, fontSize, color, underline: false, lineThrough: false, isVariable: false, isNewline: true });
        const words = lines[i].match(/\S+|\s+/g) ?? (lines[i] ? [lines[i]] : []);
        for (const w of words) {
          tokens.push({ text: w, font, fontSize, color, underline: td === 'underline', lineThrough: td === 'line-through', isVariable: false, isNewline: false });
        }
      }
    }
  }

  /* ── Layout: wrap into lines ── */
  interface Line { toks: Array<Token & { width: number }>; width: number; lineH: number; }
  const lines: Line[] = [];
  let lineX = 0;
  let curLineH = defaultLineH;
  let pending: Array<Token & { width: number }> = [];

  function pushLine() {
    // trim trailing whitespace of the line
    while (pending.length > 0 && /^\s+$/.test(pending[pending.length - 1].text)) {
      pending.pop();
    }
    let width = 0;
    for (const t of pending) width += t.width;
    lines.push({ toks: pending, width, lineH: curLineH });
    pending = [];
    lineX = 0;
    curLineH = defaultLineH;
  }

  for (const tok of tokens) {
    if (tok.isNewline) { pushLine(); continue; }

    const tokLineH = tok.fontSize * el.lineHeight;
    ctx.font = tok.font;
    const w = ctx.measureText(tok.text).width;
    const isWs = /^\s+$/.test(tok.text);

    if (!isWs && lineX > 0 && lineX + w > containerWidthPx) {
      // trim trailing whitespace before wrapping
      while (pending.length > 0 && /^\s+$/.test(pending[pending.length - 1].text)) {
        lineX -= pending[pending.length - 1].width;
        pending.pop();
      }
      pushLine();
    }

    if (isWs && lineX === 0) continue; // skip leading whitespace on new line

    curLineH = Math.max(curLineH, tokLineH);
    pending.push({ ...tok, width: w });
    lineX += w;
  }
  if (pending.length > 0) pushLine();

  /* ── Position lines according to alignment ── */
  const align = el.align ?? 'left';
  const isJustify = align.startsWith('justify');
  const cmds: DrawCmd[] = [];
  let lineY = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const isLastLine = li === lines.length - 1;
    const slack = Math.max(0, containerWidthPx - line.width);
    const wsToks = line.toks.filter((t) => /^\s+$/.test(t.text));
    // justify-left/center/right: la última línea se alinea (Word/InDesign).
    // justify-block ("Justificar bloque"): TODAS las líneas se estiran, incluida
    // la última — es lo que lo distingue de justify-left.
    const doJustify = isJustify && slack > 0 && wsToks.length > 0
      && (!isLastLine || align === 'justify-block');
    const extraPerGap = doJustify ? slack / wsToks.length : 0;

    let x: number;
    if (doJustify) {
      x = 0;
    } else if (align === 'center' || (align === 'justify-center' && isLastLine)) {
      x = slack / 2;
    } else if (align === 'right' || (align === 'justify-right' && isLastLine)) {
      x = slack;
    } else {
      x = 0; // left · justify-left · justify-block (última) · líneas justify sin espacios
    }

    for (const t of line.toks) {
      cmds.push({
        text: t.text, x, y: lineY, lineH: line.lineH, fontSize: t.fontSize,
        font: t.font, color: t.color, underline: t.underline, lineThrough: t.lineThrough,
        isVariable: t.isVariable, width: t.width,
      });
      x += t.width + (doJustify && /^\s+$/.test(t.text) ? extraPerGap : 0);
    }
    lineY += line.lineH;
  }

  return cmds;
}

/* ─── Konva Shape draw helper ─── */

export function drawCmds(ctx: CanvasRenderingContext2D, cmds: DrawCmd[]) {
  ctx.textBaseline = 'top';
  for (const cmd of cmds) {
    ctx.save();
    ctx.font  = cmd.font;

    // Half-leading: CSS centra el glifo dentro de la caja de línea (lineHeight),
    // el canvas con textBaseline='top' lo pintaba pegado arriba → al entrar a
    // editar (contentEditable) el texto "bajaba" y parecía cambiar. Se centra
    // igual que CSS para que lienzo y editor coincidan.
    const dy = Math.max(0, (cmd.lineH - cmd.fontSize) / 2);

    if (cmd.isVariable) {
      ctx.fillStyle = 'rgba(144,39,116,0.12)';
      ctx.fillRect(cmd.x, cmd.y + 1, cmd.width ?? ctx.measureText(cmd.text).width, cmd.lineH * 0.9);
    }

    ctx.fillStyle = cmd.color;
    ctx.fillText(cmd.text, cmd.x, cmd.y + dy);

    if (cmd.underline) {
      ctx.fillRect(cmd.x, cmd.y + dy + cmd.fontSize + 1, ctx.measureText(cmd.text).width, 1);
    }
    if (cmd.lineThrough) {
      ctx.fillRect(cmd.x, cmd.y + dy + cmd.fontSize * 0.5, ctx.measureText(cmd.text).width, 1);
    }
    ctx.restore();
  }
}

/* ─── Spans ↔ HTML ─── */

export function spansToHtml(spans: TextSpan[]): string {
  return spans
    .map((span) => {
      if (span.binding) {
        const label = span.binding.split('.').pop() ?? span.binding;
        return (
          `<span class="var-chip" contenteditable="false" data-binding="${ea(span.binding)}"` +
          ` style="background:rgba(144,39,116,.13);color:#902774;border-radius:3px;padding:0 3px;` +
          `font-size:.9em;border:1px solid rgba(144,39,116,.3);user-select:none;cursor:default">` +
          `{{${eh(label)}}}</span>`
        );
      }

      const styledText = eh(span.text ?? '').replace(/\n/g, '<br>');
      const css: string[] = [];
      if (span.color)                     css.push(`color:${span.color}`);
      if (span.fontSize)                  css.push(`font-size:${span.fontSize}pt`);
      if ((span.fontWeight ?? 0) >= 700)  css.push('font-weight:bold');
      if (span.fontStyle === 'italic')    css.push('font-style:italic');
      if (span.textDecoration === 'underline')    css.push('text-decoration:underline');
      if (span.textDecoration === 'line-through') css.push('text-decoration:line-through');

      return css.length ? `<span style="${css.join(';')}">${styledText}</span>` : styledText;
    })
    .join('');
}

export function htmlToSpans(html: string): TextSpan[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const out: TextSpan[] = [];
  walkNode(div, {}, out);
  return merge(out);
}

type Inherited = Partial<Pick<TextSpan, 'fontWeight' | 'fontStyle' | 'textDecoration' | 'color' | 'fontSize' | 'fontFamily'>>;

function walkNode(node: Node, inh: Inherited, out: TextSpan[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? '';
    if (t) out.push({ text: t, ...inh });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el  = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (el.dataset.binding) { out.push({ binding: el.dataset.binding, ...inh }); return; }
  if (tag === 'br')        { out.push({ text: '\n' }); return; }

  if ((tag === 'div' || tag === 'p') && out.length > 0) {
    const last = out[out.length - 1];
    if (last.text && !last.text.endsWith('\n')) out.push({ text: '\n' });
  }

  const s: Inherited = { ...inh };
  if (tag === 'b' || tag === 'strong')  s.fontWeight = 700;
  if (tag === 'i' || tag === 'em')      s.fontStyle  = 'italic';
  if (tag === 'u')                       s.textDecoration = 'underline';
  if (tag === 's' || tag === 'strike')  s.textDecoration = 'line-through';

  const css = el.getAttribute('style') ?? '';
  if (css) {
    const cm = css.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (cm) s.color = normalizeColor(cm[1].trim());

    const sm = css.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/i);
    if (sm) {
      const raw = sm[1].trim();
      if (raw.endsWith('pt'))      s.fontSize = parseFloat(raw);
      else if (raw.endsWith('px')) s.fontSize = parseFloat(raw) * 72 / 96;
    }

    const wm = css.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i);
    if (wm) {
      const v = wm[1].trim();
      s.fontWeight = v === 'bold' ? 700 : v === 'normal' ? 400 : (parseInt(v) || undefined);
    }

    const im = css.match(/(?:^|;)\s*font-style\s*:\s*([^;]+)/i);
    if (im) s.fontStyle = im[1].trim() === 'italic' ? 'italic' : 'normal';

    const dm = css.match(/(?:^|;)\s*text-decoration\s*:\s*([^;]+)/i);
    if (dm) {
      const d = dm[1].trim();
      if (d.includes('underline'))   s.textDecoration = 'underline';
      else if (d.includes('line-through')) s.textDecoration = 'line-through';
    }
  }

  for (const child of Array.from(el.childNodes)) walkNode(child, s, out);
}

function merge(spans: TextSpan[]): TextSpan[] {
  const out: TextSpan[] = [];
  for (const s of spans) {
    if (s.binding) { out.push(s); continue; }
    const last = out[out.length - 1];
    if (last && !last.binding && stylesEq(last, s)) {
      last.text = (last.text ?? '') + (s.text ?? '');
    } else {
      out.push({ ...s });
    }
  }
  return out.filter((s) => s.binding !== undefined || (s.text ?? '').length > 0);
}

function stylesEq(a: TextSpan, b: TextSpan) {
  return a.color === b.color && a.fontSize === b.fontSize && a.fontWeight === b.fontWeight && a.fontStyle === b.fontStyle && a.textDecoration === b.textDecoration && a.fontFamily === b.fontFamily;
}

/** Convierte rgb(r,g,b) → #rrggbb para normalizar colores del browser. */
function normalizeColor(c: string): string {
  const m = c.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (!m) return c;
  return '#' + [m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');
}

function ea(s: string) { return s.replace(/"/g, '&quot;'); }
function eh(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ─── Unidades ─── */
export { MM_TO_PX };
