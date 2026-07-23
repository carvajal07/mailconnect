// CanvasRuler.jsx — Reglas con soporte de unidades, scroll sync y ticks completos
import { useMemo } from 'react';
import './CanvasRuler.css';

const RULER_SIZE = 28;
const PX_PER_MM  = 96 / 25.4;

// ── Unit config ────────────────────────────────────────────────────────────
// toMm: 1 display unit → mm | fromMm: 1mm → display units
// intervals: label spacing candidates (in display units)
// divisions: sub-ticks between labels
const UNIT_CFG = {
  mm: { toMm: 1,         fromMm: 1,        intervals: [1,2,5,10,20,50,100,200],    fmt: v => Math.round(v),            divisions: 5 },
  cm: { toMm: 10,        fromMm: 0.1,      intervals: [.1,.2,.5,1,2,5,10,20],     fmt: v => +(v.toFixed(1)),          divisions: 5 },
  pt: { toMm: 1/2.835,   fromMm: 2.835,    intervals: [1,2,5,10,25,50,100,200],   fmt: v => Math.round(v),            divisions: 5 },
  px: { toMm: 1/3.7795,  fromMm: 3.7795,   intervals: [1,2,5,10,25,50,100,200],   fmt: v => Math.round(v),            divisions: 5 },
  in: { toMm: 25.4,      fromMm: 1/25.4,   intervals: [.125,.25,.5,1,2,5],        fmt: v => +(v.toFixed(3)).replace(/\.?0+$/,''), divisions: 4 },
};

// pageOffsetPx: pixel position of the page's origin (0,0) within the ruler viewport
// containerSizePx: how many pixels wide/tall to generate ticks for
function buildTicks({ pageOffsetPx, containerSizePx = 3000, zoom, unit = 'mm' }) {
  const cfg = UNIT_CFG[unit] ?? UNIT_CFG.mm;

  // Smallest label interval where spacing >= 36px (dense but readable)
  const labelIntervalU = cfg.intervals.find(
    i => i * cfg.toMm * PX_PER_MM * zoom >= 36
  ) ?? cfg.intervals.at(-1);

  const labelIntervalMm = labelIntervalU * cfg.toMm;
  const subIntervalMm   = labelIntervalMm / cfg.divisions;

  // Visible mm range
  const startMm = -pageOffsetPx / (PX_PER_MM * zoom);
  const endMm   = (containerSizePx - pageOffsetPx) / (PX_PER_MM * zoom);

  const firstIdx = Math.floor(startMm / subIntervalMm) - 1;
  const lastIdx  = Math.ceil(endMm  / subIntervalMm) + 1;

  const ticks = [];
  for (let i = firstIdx; i <= lastIdx; i++) {
    const mm = i * subIntervalMm;
    const px = mm * PX_PER_MM * zoom + pageOffsetPx;
    if (px < -2 || px > containerSizePx + 2) continue;

    const isMajor = i % cfg.divisions === 0;
    const label   = isMajor ? String(cfg.fmt(mm * cfg.fromMm)) : null;

    ticks.push({ px, label, isMajor });
  }
  return ticks;
}

export function HorizontalRuler({ pageOffsetPx = 0, zoom = 1, unit = 'mm' }) {
  const ticks = useMemo(
    () => buildTicks({ pageOffsetPx, containerSizePx: 3000, zoom, unit }),
    [pageOffsetPx, zoom, unit]
  );

  return (
    <svg className="canvas-ruler canvas-ruler--h" height={RULER_SIZE}>
      <rect className="ruler-bg" width="100%" height={RULER_SIZE} />
      {ticks.map(({ px, label, isMajor }, i) => {
        const tickH = isMajor ? 10 : label === null ? 5 : 7;
        return (
          <g key={i}>
            <line
              className={`ruler-tick${isMajor ? ' ruler-tick--major' : ''}`}
              x1={px} y1={RULER_SIZE - tickH} x2={px} y2={RULER_SIZE}
            />
            {label && (
              <text className="ruler-label" x={px + 2} y={RULER_SIZE - tickH - 1}>
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function VerticalRuler({ pageOffsetPx = 0, zoom = 1, unit = 'mm' }) {
  const ticks = useMemo(
    () => buildTicks({ pageOffsetPx, containerSizePx: 3000, zoom, unit }),
    [pageOffsetPx, zoom, unit]
  );

  return (
    <svg className="canvas-ruler canvas-ruler--v" width={RULER_SIZE}>
      <rect className="ruler-bg" width={RULER_SIZE} height="100%" />
      {ticks.map(({ px, label, isMajor }, i) => {
        const tickW = isMajor ? 10 : 5;
        return (
          <g key={i}>
            <line
              className={`ruler-tick${isMajor ? ' ruler-tick--major' : ''}`}
              x1={RULER_SIZE - tickW} y1={px} x2={RULER_SIZE} y2={px}
            />
            {label && (
              <text className="ruler-label" x={RULER_SIZE - tickW - 2} y={px + 3} textAnchor="end">
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
