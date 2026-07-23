import type { JSX } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import { UNIT_CFG, type DisplayUnit } from '@/utils/displayUnits';

interface Props {
  /** Ancho del viewport del canvas (px). */
  viewportWidth: number;
  /** Alto del viewport del canvas (px). */
  viewportHeight: number;
  /** Stage-coord X donde está el 0 mm (borde izquierdo de la hoja). */
  originX: number;
  /** Stage-coord Y donde está el 0 mm (borde superior de la hoja). */
  originY: number;
  /** Pixels por milímetro aplicando el zoom actual. */
  pxPerMm: number;
  /** Unidad de display de las reglas (mm/cm/pt/px/in). */
  unit?: DisplayUnit;
  /** Tema visual del editor (colores de la regla). */
  theme?: 'dark' | 'light';
}

const RULER_SIZE = 20;
/** Tamaño de la regla en px — lo usa el Canvas para centrar/ajustar la hoja. */
export const RULER_SIZE_PX = RULER_SIZE;

// Paletas de la regla (la clara sigue el look del DocumentDesigner).
const PALETTES = {
  dark: { bg: '#26262a', border: '#1a1a1c', tick: '#7d7d82', major: '#a8a8ae', label: '#9a9aa0' },
  light: { bg: '#f8fafc', border: '#cbd5e1', tick: '#94a3b8', major: '#64748b', label: '#64748b' },
} as const;

/** px mínimos entre dos labels — determina la granularidad (como el Diseñador). */
const MIN_LABEL_PX = 36;

/**
 * Reglas horizontal y vertical con el esquema del DocumentDesigner:
 * labels en la unidad elegida (mm/cm/pt/px/in) con sub-divisiones por unidad,
 * ticks mayores (10px, con número) y menores (5px), y paleta según el tema.
 * El 0 queda alineado con la esquina superior-izquierda de la hoja.
 */
export default function Rulers({
  viewportWidth,
  viewportHeight,
  originX,
  originY,
  pxPerMm,
  unit = 'mm',
  theme = 'dark',
}: Props) {
  const cfg = UNIT_CFG[unit] ?? UNIT_CFG.mm;
  const pal = PALETTES[theme] ?? PALETTES.dark;

  // Menor intervalo de label cuyo espaciado en px sea legible.
  const labelIntervalU =
    cfg.intervals.find((i) => i * cfg.toMm * pxPerMm >= MIN_LABEL_PX) ??
    cfg.intervals[cfg.intervals.length - 1];
  const labelEveryMm = labelIntervalU * cfg.toMm;
  const subEveryMm = labelEveryMm / cfg.divisions;
  const EPS = 1e-6;

  function buildTicks(
    origin: number,
    limit: number,
    horizontal: boolean,
  ): JSX.Element[] {
    const out: JSX.Element[] = [];
    const startIdx = Math.floor((RULER_SIZE - origin) / pxPerMm / subEveryMm) - 1;
    const endIdx = Math.ceil((limit - origin) / pxPerMm / subEveryMm) + 1;
    for (let i = startIdx; i <= endIdx; i++) {
      const mm = i * subEveryMm;
      const pos = origin + mm * pxPerMm;
      if (pos < RULER_SIZE || pos > limit) continue;

      const rem = Math.abs(mm % labelEveryMm);
      const isMajor = rem < EPS || Math.abs(rem - labelEveryMm) < EPS;
      const tickLen = isMajor ? 10 : 5;
      const points = horizontal
        ? [pos, RULER_SIZE - tickLen, pos, RULER_SIZE]
        : [RULER_SIZE - tickLen, pos, RULER_SIZE, pos];

      out.push(
        <Line
          key={`${horizontal ? 'h' : 'v'}-${i}`}
          points={points}
          stroke={isMajor ? pal.major : pal.tick}
          strokeWidth={1}
          listening={false}
        />,
      );
      if (isMajor) {
        out.push(
          <Text
            key={`${horizontal ? 'hl' : 'vl'}-${i}`}
            x={horizontal ? pos + 2 : 2}
            y={horizontal ? 2 : pos + 2}
            text={cfg.fmt(mm * cfg.fromMm)}
            fontSize={9}
            fontFamily="JetBrains Mono, monospace"
            fill={pal.label}
            listening={false}
          />,
        );
      }
    }
    return out;
  }

  const hTicks = buildTicks(originX, viewportWidth, true);
  const vTicks = buildTicks(originY, viewportHeight, false);

  return (
    <Group listening={false}>
      {/* fondos */}
      <Rect x={0} y={0} width={viewportWidth} height={RULER_SIZE} fill={pal.bg} />
      <Rect x={0} y={0} width={RULER_SIZE} height={viewportHeight} fill={pal.bg} />
      {/* bordes */}
      <Line points={[0, RULER_SIZE, viewportWidth, RULER_SIZE]} stroke={pal.border} strokeWidth={1} />
      <Line points={[RULER_SIZE, 0, RULER_SIZE, viewportHeight]} stroke={pal.border} strokeWidth={1} />
      {hTicks}
      {vTicks}
      {/* esquina con la unidad activa */}
      <Rect x={0} y={0} width={RULER_SIZE} height={RULER_SIZE} fill={pal.bg} />
      <Text
        x={2}
        y={6}
        width={RULER_SIZE - 4}
        align="center"
        text={unit}
        fontSize={8}
        fontFamily="JetBrains Mono, monospace"
        fill={pal.label}
        listening={false}
      />
    </Group>
  );
}
