import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import RefreshIcon from '@mui/icons-material/Refresh';
import CircleIcon from '@mui/icons-material/Circle';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import PaidIcon from '@mui/icons-material/Paid';
import ShieldIcon from '@mui/icons-material/Shield';
import HistoryIcon from '@mui/icons-material/History';
import ConveyorBeltIcon from '@mui/icons-material/DoubleArrow';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { controlCenterService } from '../../services/controlCenterService';
import type { ControlCenterData, QueueStatus, ServiceHealth } from '../../services/controlCenterService';
import { isOk } from '../../services/apiClient';
import { formatCOP } from '../../services/costService';
import { formatDateTime } from '../../utils/datetime';

/**
 * CENTRO DE MANDO (admin): tablero de OPERACIÓN en vivo — lo que un operador revisa
 * cada mañana. Semáforo del pipeline (atascados, schedules fallidos, colas/DLQs),
 * dinero del día, reputación en riesgo con tendencia, salud de servicios (SES/
 * DynamoDB/SQS) y actividad admin reciente. Auto-refresco opcional cada 60 s.
 */

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  ok: 'success', warning: 'warning', critical: 'error', error: 'error',
};

const StatusDot = ({ level }: { level: string }) => (
  <CircleIcon sx={{ fontSize: 12 }} color={LEVEL_COLOR[level] ?? 'success'} />
);

const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'flat' }) => {
  // "up" = el rebote SUBIÓ (malo) → rojo; "down" = mejoró → verde.
  if (trend === 'up') return <TrendingUpIcon fontSize="small" color="error" />;
  if (trend === 'down') return <TrendingDownIcon fontSize="small" color="success" />;
  return <TrendingFlatIcon fontSize="small" color="disabled" />;
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const CardBox = ({ icon, title, chip, children }: {
  icon: React.ReactNode; title: string; chip?: React.ReactNode; children: React.ReactNode;
}) => (
  <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
      {icon}
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
      <Box sx={{ flex: 1 }} />
      {chip}
    </Stack>
    {children}
  </Paper>
);

const BigNumber = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Box sx={{ minWidth: 130 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>{value}</Typography>
    {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
  </Box>
);

function queueOverall(queues: QueueStatus[]): 'ok' | 'warning' | 'critical' {
  if (queues.some((q) => q.level === 'critical')) return 'critical';
  if (queues.some((q) => q.level === 'warning')) return 'warning';
  return 'ok';
}

function healthOverall(services: ServiceHealth[]): 'ok' | 'warning' | 'error' {
  if (services.some((s) => s.status === 'error')) return 'error';
  if (services.some((s) => s.status === 'warning')) return 'warning';
  return 'ok';
}

export const CentroMandoSection = () => {
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await controlCenterService.get();
    setLoading(false);
    if (isOk(res) && res.data) {
      setData(res.data);
      setError('');
    } else {
      setError(res.description || 'No se pudo cargar el centro de mando.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresco cada 60 s (es un tablero "en vivo").
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(() => { void load(); }, 60000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, load]);

  // Resumen superior: un chip por área con su peor nivel.
  const overview = useMemo(() => {
    if (!data) return [];
    const q = queueOverall(data.pipeline.queues ?? []);
    const dlqTotal = (data.pipeline.queues ?? []).reduce((a, x) => a + x.dlqDepth, 0);
    return [
      { label: data.pipeline.stuckCount ? `${data.pipeline.stuckCount} atascado(s)` : 'Pipeline al día',
        level: data.pipeline.stuckCount ? 'critical' : 'ok' },
      { label: dlqTotal ? `${dlqTotal} en DLQ` : 'DLQs vacías', level: dlqTotal ? 'critical' : 'ok' },
      { label: data.pipeline.failedSchedules.length ? `${data.pipeline.failedSchedules.length} schedule(s) fallidos` : 'Schedules OK',
        level: data.pipeline.failedSchedules.length ? 'warning' : 'ok' },
      { label: q === 'ok' ? 'Colas fluyendo' : 'Colas con backlog', level: q },
      { label: `Salud: ${healthOverall(data.health.services) === 'ok' ? 'OK' : 'revisar'}`,
        level: healthOverall(data.health.services) },
      { label: data.money.pendingTopups.count
          ? `${data.money.pendingTopups.count} recarga(s) por revisar` : 'Sin recargas pendientes',
        level: data.money.pendingTopups.count ? 'warning' : 'ok' },
    ];
  }, [data]);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <MonitorHeartIcon color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Centro de mando</Typography>
        <Box sx={{ flex: 1 }} />
        {data && (
          <Typography variant="caption" color="text.secondary">
            Actualizado: {formatDateTime(data.generatedAt)}
          </Typography>
        )}
        <FormControlLabel
          control={<Switch size="small" checked={auto} onChange={(e) => setAuto(e.target.checked)} />}
          label={<Typography variant="caption">Auto (60 s)</Typography>}
        />
        <IconButton size="small" onClick={() => void load()} disabled={loading} title="Refrescar">
          {loading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
        </IconButton>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!data && !error && <LinearProgress sx={{ mb: 2 }} />}
      {data && (
        <>
          {/* Resumen: el estado de cada área de un vistazo */}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            {overview.map((o, i) => (
              <Chip key={i} icon={<StatusDot level={o.level} />} label={o.label}
                    variant={o.level === 'ok' ? 'outlined' : 'filled'}
                    color={o.level === 'ok' ? 'default' : LEVEL_COLOR[o.level]}
                    size="small" />
            ))}
          </Stack>

          <Box sx={{ display: 'grid', gap: 2,
                     gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>

            {/* ── Salud de servicios ── */}
            <CardBox icon={<HealthAndSafetyIcon color="primary" />} title="Salud de los servicios"
                     chip={<StatusDot level={healthOverall(data.health.services)} />}>
              <Stack spacing={1.25}>
                {data.health.services.map((s) => (
                  <Box key={s.service}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <StatusDot level={s.status} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.service}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {s.detail}
                      </Typography>
                    </Stack>
                    {s.metric && s.metric.max > 0 && (
                      <LinearProgress variant="determinate" value={Math.min(100, s.metric.pct)}
                                      color={s.metric.pct >= 80 ? 'warning' : 'primary'}
                                      sx={{ mt: 0.5, height: 6, borderRadius: 3 }} />
                    )}
                  </Box>
                ))}
              </Stack>
            </CardBox>

            {/* ── Dinero del día ── */}
            <CardBox icon={<PaidIcon color="primary" />} title="Dinero del día">
              <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                <BigNumber label="Débitos de envío (hoy)" value={formatCOP(data.money.todayDebits)}
                           sub={`${data.money.todayDebitsCount} envío(s)`} />
                <BigNumber label="Recargas acreditadas (hoy)" value={formatCOP(data.money.todayTopups)}
                           sub={`${data.money.todayTopupsCount} recarga(s)`} />
                <BigNumber label="Solicitudes pendientes" value={String(data.money.pendingTopups.count)}
                           sub={data.money.pendingTopups.count ? formatCOP(data.money.pendingTopups.amount) + ' · revisar en Saldos' : '—'} />
                <BigNumber
                  label="Saldo total plataforma"
                  value={formatCOP(data.money.platformBalance)}
                  sub={data.money.orphanBalance
                    ? `+ ${formatCOP(data.money.orphanBalance)} de ${data.money.orphanCount} cliente(s) eliminado(s), sin contar`
                    : undefined}
                />
              </Stack>
            </CardBox>

            {/* ── Semáforo del pipeline ── */}
            <CardBox icon={<ConveyorBeltIcon color="primary" />} title="Pipeline de envío"
                     chip={<StatusDot level={queueOverall(data.pipeline.queues)} />}>
              {data.pipeline.stuckProcesses.length > 0 && (
                <Alert severity="error" sx={{ mb: 1 }} icon={false}>
                  <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                    Procesos atascados ({data.pipeline.stuckCount})
                  </Typography>
                  {data.pipeline.stuckProcesses.slice(0, 5).map((p) => (
                    <Typography key={p.processId} variant="caption" display="block">
                      {p.customerName} · {p.campaignName} · {p.processState} hace {p.hoursStuck} h
                    </Typography>
                  ))}
                </Alert>
              )}
              {data.pipeline.failedSchedules.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1 }} icon={false}>
                  <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Programaciones fallidas</Typography>
                  {data.pipeline.failedSchedules.slice(0, 5).map((s) => (
                    <Typography key={s.scheduleId} variant="caption" display="block">
                      {s.campaignName || s.scheduleId} · {formatDateTime(s.scheduledAt)} · {s.error || 'sin detalle'}
                    </Typography>
                  ))}
                </Alert>
              )}
              <TableContainer sx={{ maxHeight: 260 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Cola</TableCell>
                      <TableCell align="right">En cola</TableCell>
                      <TableCell align="right">Más viejo</TableCell>
                      <TableCell align="right">DLQ</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.pipeline.queues.map((q) => (
                      <TableRow key={q.queue} hover>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <StatusDot level={q.level} />
                            <Typography variant="caption">{q.queue}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{q.error ? '—' : q.depth}</TableCell>
                        <TableCell align="right">
                          {q.error ? '—' : q.oldestSeconds > 0 ? `${Math.round(q.oldestSeconds / 60)} min` : '—'}
                        </TableCell>
                        <TableCell align="right">
                          {q.dlqDepth > 0
                            ? <Chip size="small" color="error" label={q.dlqDepth} />
                            : '0'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardBox>

            {/* ── Reputación en riesgo ── */}
            <CardBox icon={<ShieldIcon color="primary" />} title="Reputación en riesgo (7 días)"
                     chip={data.reputation.truncated
                       ? <Chip size="small" variant="outlined" label="parcial" /> : undefined}>
              {data.reputation.top.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Sin actividad reciente con datos de reputación.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell align="right">Envíos</TableCell>
                      <TableCell align="right">Rebote</TableCell>
                      <TableCell align="right">Queja</TableCell>
                      <TableCell align="center">Tendencia</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.reputation.top.map((r) => (
                      <TableRow key={r.tenant} hover>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <StatusDot level={r.level} />
                            <Typography variant="body2">{r.company || r.tenant}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{r.sent}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700,
                          color: r.level === 'critical' ? 'error.main' : undefined }}>
                          {pct(r.bounceRate)}
                        </TableCell>
                        <TableCell align="right">{pct(r.complaintRate)}</TableCell>
                        <TableCell align="center">
                          <Tooltip title={r.prevBounceRate != null
                            ? `7 días anteriores: ${pct(r.prevBounceRate)}` : 'Sin ventana previa'}>
                            <Box component="span"><TrendIcon trend={r.trend} /></Box>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                La reputación de SES es compartida entre todos los clientes de la plataforma.
              </Typography>
            </CardBox>

            {/* ── Actividad admin reciente ── */}
            <Box sx={{ gridColumn: { md: '1 / -1' } }}>
              <CardBox icon={<HistoryIcon color="primary" />} title="Actividad administrativa reciente">
                {data.audit.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">Sin actividad registrada.</Typography>
                ) : (
                  <Table size="small">
                    <TableBody>
                      {data.audit.map((a, i) => (
                        <TableRow key={i} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap', width: 160 }}>
                            <Typography variant="caption">{formatDateTime(a.date)}</Typography>
                          </TableCell>
                          <TableCell sx={{ width: 180 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>{a.actor}</Typography>
                          </TableCell>
                          <TableCell sx={{ width: 190 }}>
                            <Chip size="small" variant="outlined" label={a.action} />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {a.target}{a.detail ? ` — ${a.detail}` : ''}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardBox>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};
