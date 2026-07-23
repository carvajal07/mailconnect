/**
 * Unidades de VISUALIZACIÓN de reglas/cursor/tamaño de hoja — portado del
 * DocumentDesigner (CanvasRuler/CanvasStatusBar). El modelo interno del
 * documento sigue SIEMPRE en mm; esto solo formatea lo que se muestra.
 */
export type DisplayUnit = 'mm' | 'cm' | 'pt' | 'px' | 'in';

export const DISPLAY_UNITS: DisplayUnit[] = ['mm', 'cm', 'pt', 'px', 'in'];

interface UnitCfg {
  /** 1 unidad de display → mm */
  toMm: number;
  /** 1 mm → unidades de display */
  fromMm: number;
  /** Candidatos de separación entre labels (en unidades de display). */
  intervals: number[];
  /** Sub-ticks entre labels. */
  divisions: number;
  /** Decimales al formatear coordenadas. */
  decimals: number;
  fmt: (v: number) => string;
}

export const UNIT_CFG: Record<DisplayUnit, UnitCfg> = {
  mm: { toMm: 1, fromMm: 1, intervals: [1, 2, 5, 10, 20, 50, 100, 200], divisions: 5, decimals: 1, fmt: (v) => String(Math.round(v)) },
  cm: { toMm: 10, fromMm: 0.1, intervals: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20], divisions: 5, decimals: 2, fmt: (v) => String(+v.toFixed(1)) },
  pt: { toMm: 25.4 / 72, fromMm: 72 / 25.4, intervals: [1, 2, 5, 10, 25, 50, 100, 200], divisions: 5, decimals: 0, fmt: (v) => String(Math.round(v)) },
  px: { toMm: 25.4 / 96, fromMm: 96 / 25.4, intervals: [1, 2, 5, 10, 25, 50, 100, 200], divisions: 5, decimals: 0, fmt: (v) => String(Math.round(v)) },
  in: { toMm: 25.4, fromMm: 1 / 25.4, intervals: [0.125, 0.25, 0.5, 1, 2, 5], divisions: 4, decimals: 3, fmt: (v) => String(+v.toFixed(3)).replace(/\.?0+$/, '') },
};

/** Formatea una medida en mm en la unidad elegida (para cursor/tamaño de hoja). */
export function formatMmAs(mm: number, unit: DisplayUnit): string {
  const cfg = UNIT_CFG[unit] ?? UNIT_CFG.mm;
  return (mm * cfg.fromMm).toFixed(cfg.decimals);
}
