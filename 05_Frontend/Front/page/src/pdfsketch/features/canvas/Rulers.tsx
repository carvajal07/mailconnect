import type { JSX } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';

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
}

const RULER_SIZE = 20;
const TICK_COLOR = '#7d7d82';
const LABEL_COLOR = '#9a9aa0';
const BG = '#26262a';
const BORDER = '#1a1a1c';

/** px objetivo entre dos labels — determina la granularidad del step. */
const TARGET_LABEL_PX = 80;
/** Pasos (mm) entre labels permitidos — "nice numbers". */
const STEPS_MM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

function niceLabelEveryMm(pxPerMm: number): number {
  for (const s of STEPS_MM) if (s * pxPerMm >= TARGET_LABEL_PX) return s;
  return STEPS_MM[STEPS_MM.length - 1];
}

/**
 * Reglas horizontal y vertical en mm. El 0 queda alineado con la
 * esquina superior-izquierda de la hoja (passed como originX/originY).
 * El intervalo entre labels se adapta al zoom: 1, 2, 5, 10, 20, 50,
 * 100, 200, 500, 1000, 2000 mm.
 */
export default function Rulers({
  viewportWidth,
  viewportHeight,
  originX,
  originY,
  pxPerMm,
}: Props) {
  const labelEvery = niceLabelEveryMm(pxPerMm);
  const tickEvery = labelEvery / 10;
  const halfEvery = labelEvery / 2;
  const EPS = 1e-6;

  // --- horizontal ---
  const hTicks: JSX.Element[] = [];
  const startMmH = Math.floor((RULER_SIZE - originX) / pxPerMm / tickEvery) * tickEvery;
  const endMmH = (viewportWidth - originX) / pxPerMm;
  for (let i = 0; startMmH + i * tickEvery <= endMmH; i++) {
    const mm = startMmH + i * tickEvery;
    const stageX = originX + mm * pxPerMm;
    if (stageX < RULER_SIZE || stageX > viewportWidth) continue;
    const isLabel = Math.abs(mm) % labelEvery < EPS;
    const isHalf = !isLabel && Math.abs(mm) % halfEvery < EPS;
    const yTop = isLabel ? 6 : isHalf ? 10 : 14;
    hTicks.push(
      <Line
        key={`h-${i}`}
        points={[stageX, yTop, stageX, RULER_SIZE]}
        stroke={TICK_COLOR}
        strokeWidth={1}
        listening={false}
      />,
    );
    if (isLabel) {
      hTicks.push(
        <Text
          key={`hl-${i}`}
          x={stageX + 2}
          y={2}
          text={formatMm(mm)}
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
          fill={LABEL_COLOR}
          listening={false}
        />,
      );
    }
  }

  // --- vertical ---
  const vTicks: JSX.Element[] = [];
  const startMmV = Math.floor((RULER_SIZE - originY) / pxPerMm / tickEvery) * tickEvery;
  const endMmV = (viewportHeight - originY) / pxPerMm;
  for (let i = 0; startMmV + i * tickEvery <= endMmV; i++) {
    const mm = startMmV + i * tickEvery;
    const stageY = originY + mm * pxPerMm;
    if (stageY < RULER_SIZE || stageY > viewportHeight) continue;
    const isLabel = Math.abs(mm) % labelEvery < EPS;
    const isHalf = !isLabel && Math.abs(mm) % halfEvery < EPS;
    const xLeft = isLabel ? 6 : isHalf ? 10 : 14;
    vTicks.push(
      <Line
        key={`v-${i}`}
        points={[xLeft, stageY, RULER_SIZE, stageY]}
        stroke={TICK_COLOR}
        strokeWidth={1}
        listening={false}
      />,
    );
    if (isLabel) {
      vTicks.push(
        <Text
          key={`vl-${i}`}
          x={2}
          y={stageY + 2}
          text={formatMm(mm)}
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
          fill={LABEL_COLOR}
          listening={false}
        />,
      );
    }
  }

  return (
    <Group listening={false}>
      {/* fondo horizontal + vertical (se solapan en la esquina, da igual) */}
      <Rect x={0} y={0} width={viewportWidth} height={RULER_SIZE} fill={BG} />
      <Rect x={0} y={0} width={RULER_SIZE} height={viewportHeight} fill={BG} />
      {hTicks}
      {vTicks}
      {/* tapa la esquina para que los ticks verticales no pisen el ruler horizontal */}
      <Rect x={0} y={0} width={RULER_SIZE} height={RULER_SIZE} fill={BG} />
      {/* bordes */}
      <Line
        points={[0, RULER_SIZE + 0.5, viewportWidth, RULER_SIZE + 0.5]}
        stroke={BORDER}
        strokeWidth={1}
      />
      <Line
        points={[RULER_SIZE + 0.5, 0, RULER_SIZE + 0.5, viewportHeight]}
        stroke={BORDER}
        strokeWidth={1}
      />
    </Group>
  );
}

function formatMm(v: number): string {
  // sub-mm y mm con decimal → 1 decimal. Enteros → sin decimales.
  if (!Number.isInteger(v)) return v.toFixed(1);
  return String(v);
}

export const RULER_SIZE_PX = RULER_SIZE;
