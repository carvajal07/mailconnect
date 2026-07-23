import type { Unit } from '@/types/document';

export interface PageSize {
  id: string;
  label: string;
  width: number;
  height: number;
  unit: Unit;
}

/** Presets de tamaño de hoja. Todas las medidas se guardan en mm. */
export const PAGE_SIZES: PageSize[] = [
  { id: 'a4', label: 'A4', width: 210, height: 297, unit: 'mm' },
  { id: 'a3', label: 'A3', width: 297, height: 420, unit: 'mm' },
  { id: 'a5', label: 'A5', width: 148, height: 210, unit: 'mm' },
  { id: 'a6', label: 'A6', width: 105, height: 148, unit: 'mm' },
  { id: 'letter', label: 'Letter', width: 215.9, height: 279.4, unit: 'mm' },
  { id: 'legal', label: 'Legal', width: 215.9, height: 355.6, unit: 'mm' },
  { id: 'tabloid', label: 'Tabloid', width: 279.4, height: 431.8, unit: 'mm' },
  { id: 'executive', label: 'Executive', width: 184.15, height: 266.7, unit: 'mm' },
  { id: 'b5', label: 'B5', width: 176, height: 250, unit: 'mm' },
  // dl es sobre largo; útil para cartas
  { id: 'dl', label: 'DL', width: 99, height: 210, unit: 'mm' },
];

/** Devuelve el preset que coincide con (width,height) en mm, o null si es personalizado. */
export function findPreset(widthMm: number, heightMm: number): PageSize | null {
  const tol = 0.5;
  return (
    PAGE_SIZES.find(
      (p) =>
        Math.abs(p.width - widthMm) < tol && Math.abs(p.height - heightMm) < tol,
    ) ?? null
  );
}

/** Etiqueta legible para el tamaño actual (preset o “Personalizado”). */
export function sizeLabel(widthMm: number, heightMm: number): string {
  const preset = findPreset(widthMm, heightMm);
  if (preset) return preset.label;
  return 'Personalizado';
}
