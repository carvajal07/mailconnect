import { useEffect, useRef, useState } from 'react';
import { Box, Paper, Stack, Typography, Tooltip, ButtonBase, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

/**
 * Gráficos ligeros en SVG (sin dependencias) para los tableros de Estadísticas y Panel.
 *
 * Diseño guiado por la skill `dataviz`: la forma se elige por el trabajo del dato, el color
 * va al final y la paleta categórica se VALIDÓ con el script (no a ojo). Identidad nunca por
 * color solo (siempre hay leyenda + etiquetas directas). Interactivo: la leyenda del donut
 * son "cuadritos" por estado que se activan/desactivan.
 */

/** Paleta categórica de estado de campaña, VALIDADA para claro y oscuro
 *  (node scripts/validate_palette.js — banda de L, piso de croma, separación CVD y de
 *  visión normal ≥15, contraste vs superficie). El par verde↔azul en oscuro se recalibró
 *  porque el anterior (#25a578↔#1f9fd6) fallaba el piso de visión normal (ΔE 14.9 < 15). */
export function useStatusColors() {
  const dark = useTheme().palette.mode === 'dark';
  return dark
    ? { pendiente: '#c07e1c', creada: '#2d8ecb', enviada: '#2ba862' }
    : { pendiente: '#c9760f', creada: '#0075be', enviada: '#159467' };
}

/* --------------------------- Animación de conteo --------------------------- */
/** Cuenta de `from` (último valor) hasta `target` con easing; respeta prefers-reduced-motion.
 *  Vuelve a animar cuando cambia el objetivo (p. ej. el total del donut al filtrar). */
export function useCountUp(target: number, durationMs = 700): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (typeof target !== 'number' || !Number.isFinite(target)) {
      setVal(target);
      return;
    }
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (reduce || from === target) {
      setVal(target);
      fromRef.current = target;
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(from + (target - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setVal(target);
        fromRef.current = target;
      }
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);
  return val;
}

/* ------------------------------- Stat tile ------------------------------- */
export const StatTile = ({
  label,
  value,
  sublabel,
  color,
  icon,
  suffix,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
  icon?: ReactNode;
  /** Sufijo para valores numéricos (p. ej. '%'). Solo aplica si value es number. */
  suffix?: string;
}) => {
  const theme = useTheme();
  const accent = color ?? theme.palette.primary.main;
  const numeric = typeof value === 'number';
  const animated = useCountUp(numeric ? (value as number) : 0);
  const display = numeric ? `${Math.round(animated).toLocaleString('es-CO')}${suffix ?? ''}` : value;
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        borderLeft: `3px solid ${accent}`,
        transition: 'transform .15s ease, box-shadow .15s ease',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: 4 },
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary" fontWeight={600}>
          {label}
        </Typography>
        {icon && (
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 36,
              height: 36,
              borderRadius: 2,
              color: accent,
              bgcolor: alpha(accent, 0.12),
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
      </Stack>
      <Typography
        variant="h3"
        sx={{ mt: 1, fontWeight: 800, lineHeight: 1.1, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}
      >
        {display}
      </Typography>
      {sublabel && (
        <Typography variant="caption" color="text.secondary">
          {sublabel}
        </Typography>
      )}
    </Paper>
  );
};

/* -------------------------------- Donut --------------------------------- */
export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

/** Donut con leyenda INTERACTIVA: cada estado es un "cuadrito" que se activa/desactiva.
 *  Al ocultar uno, el anillo y el total del centro se recalculan (con animación). */
export const Donut = ({ data, size = 190, thickness = 26 }: { data: DonutDatum[]; size?: number; thickness?: number }) => {
  const theme = useTheme();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggle = (label: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const visible = data.filter((d) => !hidden.has(d.label));
  const total = visible.reduce((s, d) => s + d.value, 0);
  const animatedTotal = useCountUp(total);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const gap = 2; // separación de superficie entre segmentos (skill: 2px surface gap)
  let offset = 0;

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
      <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Campañas por estado">
          {/* Pista de fondo */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={theme.palette.divider} strokeWidth={thickness} />
          {visible.map((d) => {
            const len = total > 0 ? (d.value / total) * C : 0;
            const seg = Math.max(len - gap, 0);
            const dim = hover !== null && hover !== d.label;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                strokeDasharray={mounted ? `${seg} ${C - seg}` : `0 ${C}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                opacity={dim ? 0.35 : 1}
                style={{
                  transition: 'stroke-dasharray .5s ease, stroke-dashoffset .5s ease, opacity .2s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={() => setHover(d.label)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${d.label}: ${d.value} (${Math.round((d.value / (total || 1)) * 100)}%)`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
          <text x="50%" y="46%" textAnchor="middle" fontSize="28" fontWeight="800" fill={theme.palette.text.primary}>
            {Math.round(animatedTotal)}
          </text>
          <text x="50%" y="60%" textAnchor="middle" fontSize="12" fill={theme.palette.text.secondary}>
            {total === data.reduce((s, d) => s + d.value, 0) ? 'campañas' : 'filtradas'}
          </text>
        </svg>
      </Box>

      {/* Leyenda INTERACTIVA: "cuadritos" por estado (clic para mostrar/ocultar). */}
      <Stack spacing={1} sx={{ minWidth: 190 }}>
        {data.map((d) => {
          const off = hidden.has(d.label);
          const pctTotal = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <ButtonBase
              key={d.label}
              onClick={() => toggle(d.label)}
              aria-pressed={!off}
              onMouseEnter={() => !off && setHover(d.label)}
              onMouseLeave={() => setHover(null)}
              sx={{
                justifyContent: 'flex-start',
                width: '100%',
                px: 1,
                py: 0.75,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: off ? 'divider' : alpha(d.color, 0.5),
                bgcolor: off ? 'transparent' : alpha(d.color, 0.06),
                opacity: off ? 0.55 : 1,
                transition: 'all .15s ease',
                '&:hover': { bgcolor: alpha(d.color, off ? 0.06 : 0.12) },
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '3px',
                    flexShrink: 0,
                    bgcolor: off ? 'transparent' : d.color,
                    border: `2px solid ${d.color}`,
                  }}
                />
                <Typography variant="body2" sx={{ flex: 1, textAlign: 'left', textDecoration: off ? 'line-through' : 'none' }}>
                  {d.label}
                </Typography>
                <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {d.value}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ width: 38, textAlign: 'right' }}>
                  {off ? '—' : `${pctTotal}%`}
                </Typography>
              </Stack>
            </ButtonBase>
          );
        })}
        <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
          Toca un estado para mostrarlo u ocultarlo.
        </Typography>
      </Stack>
    </Stack>
  );
};

/* ------------------------------ Area chart ------------------------------ */
/** Punto mínimo de la serie: un día + las métricas que declaren las series. */
export interface SeriesPoint {
  date: string; // YYYY-MM-DD
}

export interface AreaSeriesDef {
  key: string;
  label: string;
  color: string;
}

/** Paleta de la serie temporal (enviados/entregados/abiertos), coherente con la
 *  categórica validada de useStatusColors (mismos tonos por modo claro/oscuro). */
export function useSeriesColors() {
  const dark = useTheme().palette.mode === 'dark';
  return dark
    ? { enviados: '#2d8ecb', entregados: '#2ba862', abiertos: '#c07e1c' }
    : { enviados: '#0075be', entregados: '#159467', abiertos: '#c9760f' };
}

const fmtDayShort = (iso: string) => {
  // '2026-07-26' -> '26 jul'
  const [, m, d] = iso.split('-');
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(d)} ${months[Number(m) - 1] ?? ''}`;
};

/** Gráfico de ÁREA multi-serie (SVG propio, sin dependencias) para la actividad diaria.
 *  Leyenda interactiva (mostrar/ocultar serie), guía vertical + tooltip por día al pasar
 *  el mouse, ejes con ticks legibles y estado vacío explícito. Theme-aware. */
const pointValue = (p: SeriesPoint, key: string): number =>
  Number((p as unknown as Record<string, unknown>)[key]) || 0;

export const AreaChart = ({
  data,
  series,
  height = 220,
}: {
  data: SeriesPoint[];
  series: AreaSeriesDef[];
  height?: number;
}) => {
  const theme = useTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(el.clientWidth, 280));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const visible = series.filter((s) => !hidden.has(s.key));
  const pad = { top: 12, right: 12, bottom: 26, left: 46 };
  const iw = Math.max(width - pad.left - pad.right, 10);
  const ih = Math.max(height - pad.top - pad.bottom, 10);
  const n = data.length;
  const maxVal = Math.max(1, ...data.flatMap((p) => visible.map((s) => pointValue(p, s.key))));
  const hasActivity = data.some((p) => series.some((s) => pointValue(p, s.key) > 0));

  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v: number) => pad.top + ih - (v / maxVal) * ih;

  // Ticks del eje Y (4 divisiones "bonitas") y del eje X (~6 fechas).
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxVal * f));
  const xEvery = Math.max(1, Math.ceil(n / 6));

  const linePath = (key: string) =>
    data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pointValue(p, key)).toFixed(1)}`).join(' ');
  const areaPath = (key: string) =>
    `${linePath(key)} L${x(n - 1).toFixed(1)},${(pad.top + ih).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + ih).toFixed(1)} Z`;

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n > 1 ? Math.round(((px - pad.left) / iw) * (n - 1)) : 0;
    setHoverIdx(Math.min(Math.max(i, 0), n - 1));
  };

  const hover = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <Box ref={wrapRef} sx={{ position: 'relative', width: '100%' }}>
      {/* Leyenda interactiva (cuadritos como en el donut). */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        {series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <ButtonBase
              key={s.key}
              onClick={() => toggle(s.key)}
              aria-pressed={!off}
              sx={{
                px: 1,
                py: 0.4,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: off ? 'divider' : alpha(s.color, 0.5),
                bgcolor: off ? 'transparent' : alpha(s.color, 0.06),
                opacity: off ? 0.55 : 1,
                transition: 'all .15s ease',
              }}
            >
              <Box sx={{ width: 10, height: 10, borderRadius: '3px', mr: 0.75, bgcolor: off ? 'transparent' : s.color, border: `2px solid ${s.color}` }} />
              <Typography variant="caption" sx={{ textDecoration: off ? 'line-through' : 'none' }}>
                {s.label}
              </Typography>
            </ButtonBase>
          );
        })}
      </Stack>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Actividad diaria"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ display: 'block' }}
      >
        {/* Rejilla + eje Y */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} x2={pad.left + iw} y1={y(t)} y2={y(t)} stroke={theme.palette.divider} strokeDasharray={i === 0 ? undefined : '3 3'} />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill={theme.palette.text.secondary}>
              {t.toLocaleString('es-CO')}
            </text>
          </g>
        ))}
        {/* Eje X (fechas espaciadas) */}
        {data.map((p, i) =>
          i % xEvery === 0 ? (
            <text key={p.date} x={x(i)} y={pad.top + ih + 16} textAnchor="middle" fontSize="10" fill={theme.palette.text.secondary}>
              {fmtDayShort(String(p.date))}
            </text>
          ) : null,
        )}
        {/* Áreas + líneas (orden: la primera serie queda al fondo) */}
        {visible.map((s) => (
          <g key={s.key} style={{ opacity: mounted ? 1 : 0, transition: 'opacity .5s ease' }}>
            <path d={areaPath(s.key)} fill={alpha(s.color, 0.14)} stroke="none" />
            <path d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
          </g>
        ))}
        {/* Guía vertical + puntos del día bajo el mouse */}
        {hover && (
          <g>
            <line x1={x(hoverIdx!)} x2={x(hoverIdx!)} y1={pad.top} y2={pad.top + ih} stroke={theme.palette.text.secondary} strokeDasharray="3 3" />
            {visible.map((s) => (
              <circle key={s.key} cx={x(hoverIdx!)} cy={y(pointValue(hover, s.key))} r={3.5} fill={s.color} stroke={theme.palette.background.paper} strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>

      {/* Tooltip del día (HTML sobrepuesto, no se sale del contenedor) */}
      {hover && (
        <Paper
          elevation={4}
          sx={{
            position: 'absolute',
            top: 34,
            left: Math.min(Math.max(x(hoverIdx!) - 70, 0), Math.max(width - 150, 0)),
            px: 1.25,
            py: 0.75,
            pointerEvents: 'none',
            minWidth: 140,
          }}
        >
          <Typography variant="caption" fontWeight={700}>
            {fmtDayShort(String(hover.date))}
          </Typography>
          {visible.map((s) => (
            <Stack key={s.key} direction="row" alignItems="center" spacing={0.75}>
              <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: s.color }} />
              <Typography variant="caption" sx={{ flex: 1 }}>
                {s.label}
              </Typography>
              <Typography variant="caption" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {pointValue(hover, s.key).toLocaleString('es-CO')}
              </Typography>
            </Stack>
          ))}
        </Paper>
      )}

      {!hasActivity && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}
        >
          Sin actividad en el período.
        </Typography>
      )}
    </Box>
  );
};

/* ------------------------------- Funnel --------------------------------- */
export interface FunnelStep {
  label: string;
  value: number;
}

/** Embudo: una serie (magnitud) en un solo tono; barras con conteo y % del tope.
 *  Las barras crecen al aparecer (animación de entrada) y resaltan al pasar el mouse. */
export const Funnel = ({ steps, color }: { steps: FunnelStep[]; color?: string }) => {
  const theme = useTheme();
  const hue = color ?? theme.palette.primary.main;
  const top = steps[0]?.value || 1;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <Stack spacing={1.5}>
      {steps.map((s, i) => {
        const pctOfTop = Math.round((s.value / top) * 100);
        const prev = i > 0 ? steps[i - 1].value : s.value;
        const conv = prev > 0 ? Math.round((s.value / prev) * 100) : 0;
        return (
          <Box key={s.label}>
            <Stack direction="row" justifyContent="space-between" mb={0.5}>
              <Typography variant="body2">{s.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                <strong style={{ color: theme.palette.text.primary }}>{s.value.toLocaleString('es-CO')}</strong>
                {i > 0 && ` · ${pctOfTop}%`}
              </Typography>
            </Stack>
            <Tooltip
              title={`${s.label}: ${s.value.toLocaleString('es-CO')} (${pctOfTop}% del tope${i > 0 ? ` · ${conv}% vs. paso anterior` : ''})`}
              arrow
            >
              <Box sx={{ height: 14, borderRadius: 1, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
                <Box
                  sx={{
                    height: '100%',
                    width: mounted ? `${Math.max(pctOfTop, 2)}%` : '0%',
                    bgcolor: hue,
                    borderRadius: 1,
                    transition: 'width .6s cubic-bezier(.22,1,.36,1)',
                  }}
                />
              </Box>
            </Tooltip>
          </Box>
        );
      })}
    </Stack>
  );
};
