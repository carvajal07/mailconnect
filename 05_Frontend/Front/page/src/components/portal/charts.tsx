import { Box, Paper, Stack, Typography, Tooltip, useTheme } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * Gráficos ligeros en SVG (sin dependencias) para el tablero de Estadísticas.
 * Colores theme-aware y validados (paleta categórica con separación CVD suficiente;
 * la identidad nunca es solo color: siempre hay leyenda + etiquetas directas).
 */

/** Paleta categórica de estado de campaña, validada para claro y oscuro. */
export function useStatusColors() {
  const dark = useTheme().palette.mode === 'dark';
  return dark
    ? { pendiente: '#bd7815', creada: '#1f9fd6', enviada: '#25a578' }
    : { pendiente: '#d97e12', creada: '#0075be', enviada: '#159467' };
}

/* ------------------------------- Stat tile ------------------------------- */
export const StatTile = ({
  label,
  value,
  sublabel,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
  icon?: ReactNode;
}) => (
  <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      {icon && <Box sx={{ color: color ?? 'text.secondary', display: 'flex' }}>{icon}</Box>}
    </Stack>
    <Typography variant="h3" sx={{ mt: 1, fontWeight: 700, color: color ?? 'text.primary', lineHeight: 1.1 }}>
      {value}
    </Typography>
    {sublabel && (
      <Typography variant="caption" color="text.secondary">
        {sublabel}
      </Typography>
    )}
  </Paper>
);

/* -------------------------------- Donut --------------------------------- */
export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export const Donut = ({ data, size = 180, thickness = 26 }: { data: DonutDatum[]; size?: number; thickness?: number }) => {
  const theme = useTheme();
  const surface = theme.palette.background.paper;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const gap = 2; // separación entre segmentos (surface gap)
  let offset = 0;

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
      <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Campañas por estado">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={theme.palette.divider} strokeWidth={thickness} />
          {data.map((d) => {
            const len = (d.value / total) * C;
            const seg = Math.max(len - gap, 0);
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${seg} ${C - seg}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              >
                <title>{`${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
          <text x="50%" y="46%" textAnchor="middle" fontSize="26" fontWeight="700" fill={theme.palette.text.primary}>
            {total}
          </text>
          <text x="50%" y="60%" textAnchor="middle" fontSize="12" fill={theme.palette.text.secondary}>
            campañas
          </text>
          {/* anillo de superficie para separar del fondo */}
          <circle cx={size / 2} cy={size / 2} r={r + thickness / 2} fill="none" stroke={surface} strokeWidth={0} />
        </svg>
      </Box>
      {/* Leyenda con etiquetas directas (identidad no depende solo del color) */}
      <Stack spacing={1} sx={{ minWidth: 160 }}>
        {data.map((d) => (
          <Stack key={d.label} direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: d.color, flexShrink: 0 }} />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {d.label}
            </Typography>
            <Typography variant="body2" fontWeight={700}>
              {d.value}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ width: 38, textAlign: 'right' }}>
              {Math.round((d.value / total) * 100)}%
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
};

/* ------------------------------- Funnel --------------------------------- */
export interface FunnelStep {
  label: string;
  value: number;
}

/** Embudo: una serie (magnitud) en un solo tono; barras con conteo y % del tope. */
export const Funnel = ({ steps, color }: { steps: FunnelStep[]; color?: string }) => {
  const theme = useTheme();
  const hue = color ?? theme.palette.primary.main;
  const top = steps[0]?.value || 1;

  return (
    <Stack spacing={1.5}>
      {steps.map((s, i) => {
        const pctOfTop = Math.round((s.value / top) * 100);
        return (
          <Box key={s.label}>
            <Stack direction="row" justifyContent="space-between" mb={0.5}>
              <Typography variant="body2">{s.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                <strong style={{ color: theme.palette.text.primary }}>{s.value.toLocaleString('es-CO')}</strong>
                {i > 0 && ` · ${pctOfTop}%`}
              </Typography>
            </Stack>
            <Tooltip title={`${s.label}: ${s.value.toLocaleString('es-CO')} (${pctOfTop}% del tope)`} arrow>
              <Box sx={{ height: 14, borderRadius: 1, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
                <Box
                  sx={{
                    height: '100%',
                    width: `${Math.max(pctOfTop, 2)}%`,
                    bgcolor: hue,
                    borderRadius: 1,
                    transition: 'width .4s',
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
