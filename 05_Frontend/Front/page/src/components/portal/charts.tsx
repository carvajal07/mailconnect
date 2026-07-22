import { useEffect, useRef, useState } from 'react';
import { Box, Paper, Stack, Typography, Tooltip, ButtonBase, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';

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
