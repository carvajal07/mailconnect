import type { FillGradient } from '@/types/document';

/** Convierte '#rrggbb' + opacidad 0–1 a 'rgba(...)'. Devuelve el color tal cual si no es hex. */
export function hexWithOpacity(hex: string, opacity: number | undefined): string {
  const o = opacity ?? 1;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m || o >= 1) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${o})`;
}

/**
 * Props de relleno para un nodo Konva a partir del modelo del elemento.
 * - Sin degradado → `fill` sólido (con la opacidad integrada al color).
 * - `linear` → fillLinearGradient* con el ángulo del Diseñador (0° = ↑, 90° = →).
 * - `radial` → fillRadialGradient* centrado en cx/cy (%).
 * Konva prioriza el degradado sobre `fill` cuando ambos están presentes, pero
 * aquí se omite el sólido explícitamente para evitar ambigüedad.
 */
export function konvaFillProps(
  fill: string,
  gradient: FillGradient | undefined,
  opacity: number | undefined,
  wPx: number,
  hPx: number,
): Record<string, unknown> {
  if (!gradient || !gradient.stops?.length) {
    if (fill === 'transparent') return { fill: 'transparent' };
    return { fill: hexWithOpacity(fill, opacity) };
  }

  // Konva colorStops = [offset0-1, color, offset, color, ...]
  const colorStops: (number | string)[] = [];
  const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
  for (const st of sorted) {
    colorStops.push(Math.max(0, Math.min(1, st.offset / 100)));
    colorStops.push(hexWithOpacity(st.color, (st.opacity ?? 1) * (opacity ?? 1)));
  }

  if (gradient.kind === 'radial') {
    const cx = ((gradient.cx ?? 50) / 100) * wPx;
    const cy = ((gradient.cy ?? 50) / 100) * hPx;
    const r = Math.max(wPx, hPx) * 0.75;
    return {
      fillRadialGradientStartPoint: { x: cx, y: cy },
      fillRadialGradientEndPoint: { x: cx, y: cy },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: r,
      fillRadialGradientColorStops: colorStops,
    };
  }

  // linear: ángulo en grados, 0 = hacia arriba, 90 = hacia la derecha (como el Diseñador)
  const ang = ((gradient.angle ?? 180) - 90) * (Math.PI / 180);
  const cx = wPx / 2, cy = hPx / 2;
  const half = Math.abs(Math.cos(ang)) * (wPx / 2) + Math.abs(Math.sin(ang)) * (hPx / 2);
  const dx = Math.cos(ang) * half, dy = Math.sin(ang) * half;
  return {
    fillLinearGradientStartPoint: { x: cx - dx, y: cy - dy },
    fillLinearGradientEndPoint: { x: cx + dx, y: cy + dy },
    fillLinearGradientColorStops: colorStops,
  };
}

/** CSS del degradado (para vistas previas en la UI). */
export function gradientToCss(gradient: FillGradient | undefined, fallback: string): string {
  if (!gradient || !gradient.stops?.length) return fallback;
  const stops = [...gradient.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${hexWithOpacity(s.color, s.opacity)} ${s.offset}%`)
    .join(', ');
  if (gradient.kind === 'radial') {
    return `radial-gradient(circle at ${gradient.cx ?? 50}% ${gradient.cy ?? 50}%, ${stops})`;
  }
  return `linear-gradient(${gradient.angle ?? 180}deg, ${stops})`;
}
