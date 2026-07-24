import { useEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';

/**
 * Picker de color con la MISMA anatomía del editor de rellenos/colores del
 * Diseñador PDF (paridad visual pedida por producto):
 *   área SV (saturación/valor) grande → barra de MATIZ → muestras actual|nuevo →
 *   HTML (+ gotero) → RGB → CMYK → (la opacidad la pone el editor que lo usa).
 *
 * Controlado por `value` (#rrggbb); emite `onChange(hex)` en cada ajuste.
 */

/* ─── Conversiones ─── */

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) { rp = c; gp = x; } else if (h < 120) { rp = x; gp = c; }
  else if (h < 180) { gp = c; bp = x; } else if (h < 240) { gp = x; bp = c; }
  else if (h < 300) { rp = x; bp = c; } else { rp = c; bp = x; }
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

export function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

export function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const kn = k / 100;
  return {
    r: 255 * (1 - c / 100) * (1 - kn),
    g: 255 * (1 - m / 100) * (1 - kn),
    b: 255 * (1 - y / 100) * (1 - kn),
  };
}

/* ─── Sub-inputs numéricos con la etiqueta DEBAJO (como el Diseñador) ─── */

function LabeledNum({ label, value, max, onCommit }: {
  label: string; value: number; max: number; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const v = Number(raw);
    if (raw === '' || Number.isNaN(v)) return;
    onCommit(Math.max(0, Math.min(max, v)));
  };
  return (
    <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
      <input
        className="field w-full text-center"
        inputMode="numeric"
        value={draft ?? String(Math.round(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
      />
      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  );
}

/* ─── Panel principal ─── */

export default function ColorPickerPanel({ value, initial, onChange }: {
  /** Color actual (#rrggbb). */
  value: string;
  /** Color con el que se abrió el editor (muestra "actual" junto a "Nuevo"). */
  initial: string;
  onChange: (hex: string) => void;
}) {
  const rgb = hexToRgb(value);
  // HSV interno: conserva el matiz aunque S o V lleguen a 0 (si se recalculara
  // desde el hex, el matiz "saltaría" a 0 al pasar por negro/blanco/grises).
  const [hsv, setHsv] = useState(() => rgbToHsv(rgb.r, rgb.g, rgb.b));
  const lastEmitted = useRef(value.toLowerCase());
  useEffect(() => {
    // Cambio EXTERNO del valor (p. ej. escribir el hex): resincronizar el HSV.
    if (value.toLowerCase() !== lastEmitted.current) {
      const { r, g, b } = hexToRgb(value);
      const next = rgbToHsv(r, g, b);
      setHsv((prev) => ({ h: next.s === 0 ? prev.h : next.h, s: next.s, v: next.v }));
      lastEmitted.current = value.toLowerCase();
    }
  }, [value]);

  const emitHsv = (h: number, s: number, v: number) => {
    setHsv({ h, s, v });
    const { r, g, b } = hsvToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);
    lastEmitted.current = hex;
    onChange(hex);
  };
  const emitRgb = (r: number, g: number, b: number) => {
    const hex = rgbToHex(r, g, b);
    const next = rgbToHsv(r, g, b);
    setHsv((prev) => ({ h: next.s === 0 ? prev.h : next.h, s: next.s, v: next.v }));
    lastEmitted.current = hex;
    onChange(hex);
  };

  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  /** Arrastre genérico: llama `pick` con la posición 0–1 dentro del nodo. */
  function dragOn(ref: React.RefObject<HTMLDivElement | null>, pick: (nx: number, ny: number) => void) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      const apply = (ev: MouseEvent | React.MouseEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        pick(nx, ny);
      };
      apply(e);
      const onMove = (ev: MouseEvent) => apply(ev);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
  }

  const hueRgb = hsvToRgb(hsv.h, 1, 1);
  const hueHex = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
  const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);

  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const commitHex = (raw: string) => {
    setHexDraft(null);
    const t = raw.trim();
    const hex = t.startsWith('#') ? t : `#${t}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const { r, g, b } = hexToRgb(hex);
      emitRgb(r, g, b);
    }
  };

  async function eyedrop() {
    // API EyeDropper (Chrome/Edge): tomar un color de CUALQUIER parte de la pantalla.
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!ED) return;
    try {
      const res = await new ED().open();
      commitHex(res.sRGBHex);
    } catch { /* cancelado por el usuario */ }
  }

  const hasEyeDropper = typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper !== 'undefined';

  return (
    <div className="flex flex-col gap-2.5">
      {/* Área saturación/valor */}
      <div
        ref={svRef}
        className="relative rounded cursor-crosshair select-none"
        style={{
          height: 190,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
          border: '1px solid var(--line-2)',
        }}
        onMouseDown={dragOn(svRef, (nx, ny) => emitHsv(hsv.h, nx, 1 - ny))}
      >
        <div
          className="absolute w-3.5 h-3.5 rounded-full pointer-events-none"
          style={{
            left: `calc(${hsv.s * 100}% - 7px)`,
            top: `calc(${(1 - hsv.v) * 100}% - 7px)`,
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
            background: value,
          }}
        />
      </div>

      {/* Barra de matiz */}
      <div
        ref={hueRef}
        className="relative rounded-full cursor-pointer select-none"
        style={{
          height: 12,
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
        onMouseDown={dragOn(hueRef, (nx) => emitHsv(nx * 359.99, hsv.s, hsv.v))}
      >
        <div
          className="absolute top-1/2 w-4 h-4 rounded-full pointer-events-none"
          style={{
            left: `calc(${(hsv.h / 360) * 100}% - 8px)`,
            transform: 'translateY(-50%)',
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.25)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
          }}
        />
      </div>

      {/* Muestras: actual | nuevo */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-8 rounded" style={{ background: initial, border: '1px solid var(--line-2)' }} title="Color actual" />
        <div className="flex-1 h-8 rounded" style={{ background: value, border: '1px solid var(--line-2)' }} title="Color nuevo" />
        <span className="text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>Nuevo</span>
      </div>

      {/* HTML + gotero */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] w-10 shrink-0" style={{ color: 'var(--muted)' }}>HTML</span>
        <input
          className="field"
          style={{ width: 96 }}
          value={hexDraft ?? value}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitHex((e.target as HTMLInputElement).value); }}
        />
        {hasEyeDropper && (
          <button
            type="button"
            title="Tomar un color de la pantalla"
            onClick={() => void eyedrop()}
            className="w-7 h-7 flex items-center justify-center rounded"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }}
          >
            <Pipette size={13} />
          </button>
        )}
      </div>

      {/* RGB */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] w-10 shrink-0 pt-1.5" style={{ color: 'var(--muted)' }}>RGB</span>
        <LabeledNum label="R" value={rgb.r} max={255} onCommit={(v) => emitRgb(v, rgb.g, rgb.b)} />
        <LabeledNum label="G" value={rgb.g} max={255} onCommit={(v) => emitRgb(rgb.r, v, rgb.b)} />
        <LabeledNum label="B" value={rgb.b} max={255} onCommit={(v) => emitRgb(rgb.r, rgb.g, v)} />
      </div>

      {/* CMYK */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] w-10 shrink-0 pt-1.5" style={{ color: 'var(--accent)' }}>CMYK</span>
        <LabeledNum label="C" value={cmyk.c} max={100}
          onCommit={(v) => { const { r, g, b } = cmykToRgb(v, cmyk.m, cmyk.y, cmyk.k); emitRgb(r, g, b); }} />
        <LabeledNum label="M" value={cmyk.m} max={100}
          onCommit={(v) => { const { r, g, b } = cmykToRgb(cmyk.c, v, cmyk.y, cmyk.k); emitRgb(r, g, b); }} />
        <LabeledNum label="Y" value={cmyk.y} max={100}
          onCommit={(v) => { const { r, g, b } = cmykToRgb(cmyk.c, cmyk.m, v, cmyk.k); emitRgb(r, g, b); }} />
        <LabeledNum label="K" value={cmyk.k} max={100}
          onCommit={(v) => { const { r, g, b } = cmykToRgb(cmyk.c, cmyk.m, cmyk.y, v); emitRgb(r, g, b); }} />
      </div>
    </div>
  );
}
