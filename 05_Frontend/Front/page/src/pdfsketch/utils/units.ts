import type { Unit } from '@/types/document';

/** Escala base: 2.2 px por mm (ajustable con zoom). */
export const MM_TO_PX = 2.2;

/** 1 pt = 25.4 / 72 mm. */
export const PT_PER_MM = 72 / 25.4;

export function mmToPx(mm: number, zoom = 1): number {
  return mm * MM_TO_PX * zoom;
}
export function pxToMm(px: number, zoom = 1): number {
  return px / (MM_TO_PX * zoom);
}

/** El XML del backend guarda coordenadas y tamaños en **metros**. */
export function mmToMeters(mm: number): number {
  return mm / 1000;
}
export function metersToMm(m: number): number {
  return m * 1000;
}

export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  // pasar todo a mm primero
  const mm = from === 'mm' ? value : from === 'pt' ? value / PT_PER_MM : value / MM_TO_PX;
  if (to === 'mm') return mm;
  if (to === 'pt') return mm * PT_PER_MM;
  return mm * MM_TO_PX;
}

export function formatValue(v: number, precision = 2): string {
  return Number(v.toFixed(precision)).toString();
}
