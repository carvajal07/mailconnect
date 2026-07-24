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
  /** Interletra en px (se aplica a measure y draw vía ctx.letterSpacing). */
  letterSpacing?: number;
  /** Desplazamiento vertical extra en px (super/subíndice). */
  shift?: number;
}

/** Subconjunto de TextEl que consume el layout (todas las props de párrafo son opcionales). */
export type LayoutEl = Pick<TextEl,
  'fontSize' | 'fontWeight' | 'fontStyle' | 'fontFamily' | 'lineHeight' | 'color' | 'textDecoration' | 'align'
> & Partial<Pick<TextEl,
  'letterSpacing' | 'textTransform' | 'leftIndent' | 'rightIndent' | 'firstLineIndent' |
  'spaceBefore' | 'spaceAfter' | 'listStyle' | 'listIndent' | 'bulletChar' | 'numberFormat'
>>;

/* ─── Plain text ─── */

export function spansToPlainText(spans: TextSpan[]): string {
  return spans
    .map((s) => (s.binding ? `{{${s.binding}}}` : (s.text ?? '')))
    .join('');
}

/* ─── Transformación de mayúsculas ─── */

function applyTransform(text: string, t: string | undefined): string {
  if (!t || t === 'none') return text;
  if (t === 'uppercase') return text.toUpperCase();
  if (t === 'lowercase') return text.toLowerCase();
  if (t === 'capitalize') return text.replace(/\p{L}+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
  return text;
}

/* ─── Marcador de lista ─── */

/** Formatea el marcador de lista del párrafo n (1-based) según el estilo. */
export function listMarker(style: string, n: number, bulletChar?: string, numberFormat?: string): string {
  if (style === 'bullet') return `${bulletChar || '•'} `;
  const fmt = numberFormat || '0.';
  const val = style === 'letter'
    ? String.fromCharCode(96 + ((n - 1) % 26) + 1) // a, b, c…
    : String(n);
  // '0.' → '1.' · '0)' → '1)' · '(0)' → '(1)'
  return `${fmt.replace('0', val)} `;
}

/* ─── Layout engine ─── */

export function layoutSpans(
  ctx: CanvasRenderingContext2D,
  spans: TextSpan[],
  el: LayoutEl,
  fontScale: number,        // zoom * MM_TO_PX  (= px por mm)
  containerWidthPx: number,
): DrawCmd[] {
  const defaultFontPx = (el.fontSize / PT_PER_MM) * fontScale;
  const defaultLineH  = defaultFontPx * el.lineHeight;
  const ptToPx = (pt: number) => (pt / PT_PER_MM) * fontScale;
  const mmToPx = (mm: number) => mm * fontScale;

  // Sangrías / espaciado del párrafo (mm → px)
  const leftIndentPx  = mmToPx(el.leftIndent ?? 0);
  const rightIndentPx = mmToPx(el.rightIndent ?? 0);
  const firstLinePx   = mmToPx(el.firstLineIndent ?? 0);
  const spaceBeforePx = mmToPx(el.spaceBefore ?? 0);
  const spaceAfterPx  = mmToPx(el.spaceAfter ?? 0);
  const isList        = !!el.listStyle && el.listStyle !== 'none';
  const listIndentPx  = isList ? mmToPx(el.listIndent ?? 5) : 0;

  function resolveFont(span: TextSpan) {
    let sz  = span.fontSize ? ptToPx(span.fontSize) : defaultFontPx;
    const shiftBase = sz;
    let shift = 0;
    if (span.baselineShift === 'super' || span.baselineShift === 'sub') {
      sz = sz * 0.58; // superSubSize default del Diseñador (58%)
      shift = span.baselineShift === 'super' ? -shiftBase * 0.33 : shiftBase * 0.2;
    }
    const w   = (span.fontWeight ?? el.fontWeight) >= 600 ? 'bold' : 'normal';
    const it  = (span.fontStyle ?? el.fontStyle) === 'italic' ? 'italic ' : '';
    const fam = span.fontFamily ?? el.fontFamily;
    const ls  = ptToPx(span.letterSpacing ?? el.letterSpacing ?? 0);
    return { font: `${it}${w} ${sz}px "${fam}"`, fontSize: sz, shift, letterSpacing: ls };
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
    letterSpacing: number;
    shift: number;
  }

  const tokens: Token[] = [];

  for (const span of spans) {
    const { font, fontSize, shift, letterSpacing } = resolveFont(span);
    const color = span.color ?? el.color;
    const td = span.textDecoration ?? el.textDecoration;

    if (span.binding) {
      const label = `{{${span.binding.split('.').pop() ?? span.binding}}}`;
      tokens.push({ text: label, font, fontSize, color, underline: false, lineThrough: false, isVariable: true, isNewline: false, letterSpacing, shift });
    } else {
      const raw = applyTransform(span.text ?? '', el.textTransform);
      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) tokens.push({ text: '', font, fontSize, color, underline: false, lineThrough: false, isVariable: false, isNewline: true, letterSpacing: 0, shift: 0 });
        const words = lines[i].match(/\S+|\s+/g) ?? (lines[i] ? [lines[i]] : []);
        for (const w of words) {
          tokens.push({ text: w, font, fontSize, color, underline: td === 'underline', lineThrough: td === 'line-through', isVariable: false, isNewline: false, letterSpacing, shift });
        }
      }
    }
  }

  /* ── Medición con interletra (ctx.letterSpacing si el navegador lo soporta) ── */
  const canLS = 'letterSpacing' in ctx;
  function measure(tok: Token): number {
    ctx.font = tok.font;
    if (canLS) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tok.letterSpacing || 0}px`;
    const w = ctx.measureText(tok.text).width;
    if (canLS) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    return w;
  }

  /* ── Layout por PÁRRAFOS (separados por newline) ── */
  interface Line { toks: Array<Token & { width: number }>; width: number; lineH: number; indent: number; avail: number; }
  const cmds: DrawCmd[] = [];
  let lineY = 0;
  let paraIndex = 0;   // 1-based tras incremento

  // Partir tokens en párrafos
  const paragraphs: Token[][] = [[]];
  for (const tok of tokens) {
    if (tok.isNewline) { paragraphs.push([]); continue; }
    paragraphs[paragraphs.length - 1].push(tok);
  }

  const align = el.align ?? 'left';
  const isJustify = align.startsWith('justify');

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const paraToks = paragraphs[pi];
    paraIndex += 1;

    // Espacio ANTES del párrafo (no en el primero, como el Diseñador por defecto)
    if (pi > 0) lineY += spaceBeforePx;

    // Marcador de lista como token al inicio del párrafo
    let markerTok: (Token & { width: number }) | null = null;
    if (isList && paraToks.length > 0) {
      const ref = paraToks[0];
      const markerText = listMarker(el.listStyle!, paraIndex, el.bulletChar, el.numberFormat);
      const mt: Token = { ...ref, text: markerText, underline: false, lineThrough: false, isVariable: false, isNewline: false, shift: 0 };
      markerTok = { ...mt, width: measure(mt) };
    }

    // Sangría de la primera línea vs siguientes
    const baseIndent  = leftIndentPx + listIndentPx;
    const firstIndent = isList ? leftIndentPx : leftIndentPx + Math.max(0, firstLinePx);
    const hangingNeg  = !isList && firstLinePx < 0 ? Math.max(0, leftIndentPx + firstLinePx) : null;

    const lines: Line[] = [];
    let pending: Array<Token & { width: number }> = [];
    let lineX = 0;
    let curLineH = defaultLineH;

    function lineIndent(lineNo: number): number {
      if (lineNo === 0) return hangingNeg !== null ? hangingNeg : (isList ? firstIndent : firstIndent);
      return baseIndent;
    }
    function lineAvail(lineNo: number): number {
      return Math.max(1, containerWidthPx - lineIndent(lineNo) - rightIndentPx);
    }

    function pushLine() {
      while (pending.length > 0 && /^\s+$/.test(pending[pending.length - 1].text)) pending.pop();
      let width = 0;
      for (const t of pending) width += t.width;
      const ln = lines.length;
      lines.push({ toks: pending, width, lineH: curLineH, indent: lineIndent(ln), avail: lineAvail(ln) });
      pending = [];
      lineX = 0;
      curLineH = defaultLineH;
    }

    // El marcador de lista ocupa el arranque de la primera línea (en el hueco del listIndent)
    for (const tok of paraToks) {
      const tokLineH = tok.fontSize * el.lineHeight;
      const w = measure(tok);
      const isWs = /^\s+$/.test(tok.text);
      const avail = lineAvail(lines.length);

      if (!isWs && lineX > 0 && lineX + w > avail) {
        while (pending.length > 0 && /^\s+$/.test(pending[pending.length - 1].text)) {
          lineX -= pending[pending.length - 1].width;
          pending.pop();
        }
        pushLine();
      }
      if (isWs && lineX === 0) continue;
      curLineH = Math.max(curLineH, tokLineH);
      pending.push({ ...tok, width: w });
      lineX += w;
    }
    if (pending.length > 0 || paraToks.length === 0) pushLine();

    /* ── Posicionar líneas del párrafo según alineación ── */
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const isLastLine = li === lines.length - 1;
      const slack = Math.max(0, line.avail - line.width);
      const wsToks = line.toks.filter((t) => /^\s+$/.test(t.text));
      const doJustify = isJustify && slack > 0 && wsToks.length > 0
        && (!isLastLine || align === 'justify-block');
      const extraPerGap = doJustify ? slack / wsToks.length : 0;

      let x = line.indent;
      if (doJustify) {
        x = line.indent;
      } else if (align === 'center' || (align === 'justify-center' && isLastLine)) {
        x = line.indent + slack / 2;
      } else if (align === 'right' || (align === 'justify-right' && isLastLine)) {
        x = line.indent + slack;
      }

      // Marcador de lista: solo en la primera línea, a la izquierda del texto
      if (li === 0 && markerTok) {
        cmds.push({
          text: markerTok.text, x: Math.max(0, x - markerTok.width), y: lineY, lineH: line.lineH,
          fontSize: markerTok.fontSize, font: markerTok.font, color: markerTok.color,
          underline: false, lineThrough: false, isVariable: false, width: markerTok.width,
          letterSpacing: markerTok.letterSpacing, shift: 0,
        });
      }

      for (const t of line.toks) {
        cmds.push({
          text: t.text, x, y: lineY, lineH: line.lineH, fontSize: t.fontSize,
          font: t.font, color: t.color, underline: t.underline, lineThrough: t.lineThrough,
          isVariable: t.isVariable, width: t.width, letterSpacing: t.letterSpacing, shift: t.shift,
        });
        x += t.width + (doJustify && /^\s+$/.test(t.text) ? extraPerGap : 0);
      }
      lineY += line.lineH;
    }

    // Espacio DESPUÉS del párrafo (no tras el último)
    if (pi < paragraphs.length - 1) lineY += spaceAfterPx;
  }

  return cmds;
}

/* ─── Konva Shape draw helper ─── */

export function drawCmds(ctx: CanvasRenderingContext2D, cmds: DrawCmd[]) {
  ctx.textBaseline = 'top';
  const canLS = 'letterSpacing' in ctx;
  for (const cmd of cmds) {
    ctx.save();
    ctx.font  = cmd.font;
    if (canLS) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${cmd.letterSpacing || 0}px`;

    // Half-leading: CSS centra el glifo dentro de la caja de línea (lineHeight),
    // el canvas con textBaseline='top' lo pintaba pegado arriba → al entrar a
    // editar (contentEditable) el texto "bajaba" y parecía cambiar. Se centra
    // igual que CSS para que lienzo y editor coincidan.
    const dy = Math.max(0, (cmd.lineH - cmd.fontSize) / 2) + (cmd.shift ?? 0);

    if (cmd.isVariable) {
      ctx.fillStyle = 'rgba(144,39,116,0.12)';
      ctx.fillRect(cmd.x, cmd.y + 1, cmd.width ?? ctx.measureText(cmd.text).width, cmd.lineH * 0.9);
    }

    ctx.fillStyle = cmd.color;
    ctx.fillText(cmd.text, cmd.x, cmd.y + dy);

    if (cmd.underline) {
      ctx.fillRect(cmd.x, cmd.y + dy + cmd.fontSize + 1, cmd.width ?? ctx.measureText(cmd.text).width, 1);
    }
    if (cmd.lineThrough) {
      ctx.fillRect(cmd.x, cmd.y + dy + cmd.fontSize * 0.5, cmd.width ?? ctx.measureText(cmd.text).width, 1);
    }
    if (canLS) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
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
      if (span.baselineShift === 'super') css.push('vertical-align:super;font-size:.58em');
      if (span.baselineShift === 'sub')   css.push('vertical-align:sub;font-size:.58em');
      if (span.letterSpacing)             css.push(`letter-spacing:${span.letterSpacing}pt`);

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

type Inherited = Partial<Pick<TextSpan, 'fontWeight' | 'fontStyle' | 'textDecoration' | 'color' | 'fontSize' | 'fontFamily' | 'baselineShift' | 'letterSpacing'>>;

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
  if (tag === 'sup')                     s.baselineShift = 'super';
  if (tag === 'sub')                     s.baselineShift = 'sub';

  const css = el.getAttribute('style') ?? '';
  if (css) {
    const cm = css.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (cm) s.color = normalizeColor(cm[1].trim());

    const sm = css.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/i);
    if (sm) {
      const raw = sm[1].trim();
      if (raw.endsWith('pt'))      s.fontSize = parseFloat(raw);
      else if (raw.endsWith('px')) s.fontSize = parseFloat(raw) * 72 / 96;
      // '.58em' (super/sub) se ignora: el tamaño relativo lo aplica baselineShift.
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

    const vm = css.match(/(?:^|;)\s*vertical-align\s*:\s*([^;]+)/i);
    if (vm) {
      const v = vm[1].trim();
      if (v === 'super') s.baselineShift = 'super';
      else if (v === 'sub') s.baselineShift = 'sub';
    }

    const lm = css.match(/(?:^|;)\s*letter-spacing\s*:\s*([^;]+)/i);
    if (lm) {
      const raw = lm[1].trim();
      if (raw.endsWith('pt'))      s.letterSpacing = parseFloat(raw);
      else if (raw.endsWith('px')) s.letterSpacing = parseFloat(raw) * 72 / 96;
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
  return a.color === b.color && a.fontSize === b.fontSize && a.fontWeight === b.fontWeight
    && a.fontStyle === b.fontStyle && a.textDecoration === b.textDecoration
    && a.fontFamily === b.fontFamily && a.baselineShift === b.baselineShift
    && a.letterSpacing === b.letterSpacing;
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
