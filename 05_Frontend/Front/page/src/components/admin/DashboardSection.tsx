import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Tooltip,
  LinearProgress,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import CampaignIcon from '@mui/icons-material/Campaign';
import SendIcon from '@mui/icons-material/Send';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { dashboardService } from '../../services/dashboardService';
import type { DashboardData, HealthLevel } from '../../services/dashboardService';
import { isOk } from '../../services/apiClient';
import { StatTile, Funnel, useStatusColors } from '../portal/charts';

const num = (n: number) => new Intl.NumberFormat('es-CO').format(n || 0);
const pct = (n: number) => `${((n || 0) * 100).toFixed(2)}%`;

const LEVEL_COLOR: Record<HealthLevel, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  warning: 'warning',
  critical: 'error',
};
const LEVEL_LABEL: Record<HealthLevel, string> = {
  ok: 'Saludable',
  warning: 'Atención',
  critical: 'Crítico',
};

/** Barra horizontal simple por canal (reutiliza el estilo del embudo). */
const ChannelBars = ({ data }: { data: DashboardData['byChannel'] }) => {
  const theme = useTheme();
  const top = data.reduce((m, d) => Math.max(m, d.sent), 0) || 1;
  if (data.length === 0) return <Typography variant="body2" color="text.secondary">Sin envíos en el periodo.</Typography>;
  return (
    <Stack spacing={1.5}>
      {data.map((d) => (
        <Box key={d.channel}>
          <Stack direction="row" justifyContent="space-between" mb={0.5}>
            <Typography variant="body2">{d.label}</Typography>
            <Typography variant="body2" fontWeight={700}>{num(d.sent)}</Typography>
          </Stack>
          <Box sx={{ height: 12, borderRadius: 1, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${Math.max((d.sent / top) * 100, 2)}%`, bgcolor: theme.palette.primary.main, borderRadius: 1, transition: 'width .4s' }} />
          </Box>
        </Box>
      ))}
    </Stack>
  );
};

/**
 * Sección admin: PANEL DE CONTROL GLOBAL. KPIs macro de la plataforma, embudo de
 * entrega global, volumen por canal y SALUD DE ENVÍOS (reputación) por cliente.
 */
export const DashboardSection = () => {
  const status = useStatusColors();
  const [month, setMonth] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await dashboardService.summary(month);
    setLoading(false);
    if (isOk(res) && res.data) setData(res.data);
    else setError(res.description || 'No se pudo cargar el panel.');
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const k = data?.kpis;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <DashboardIcon color="primary" />
          <Typography variant="h4">Panel de control</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField type="month" size="small" label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Vista macro de toda la plataforma: volumen, entrega y <strong>salud de envíos</strong>
        (reputación) por cliente. {data?.generatedAt && `Actualizado ${data.generatedAt} UTC.`}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {data?.truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Datos parciales: se alcanzó el tope de procesos agregados. Acota por mes para un cálculo completo.
        </Alert>
      )}

      {loading && !data && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {k && (
        <>
          {/* KPIs */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 2, mb: 2 }}>
            <StatTile label="Clientes" value={k.customers} icon={<PeopleIcon />} />
            <StatTile label="Campañas activas" value={k.activeCampaigns} sublabel={`${num(k.pendingCampaigns)} por aprobar`} icon={<CampaignIcon />} />
            <StatTile label="Envíos" value={k.totalSent} icon={<SendIcon />} />
            <StatTile label="Tasa de entrega" value={pct(k.deliveryRate)} sublabel={`${num(k.delivered)} entregados`} icon={<MarkEmailReadIcon />} />
            <StatTile label="Clientes en riesgo" value={k.atRisk} color={k.atRisk > 0 ? status.pendiente : undefined} sublabel="rebote/queja alto" icon={<WarningAmberIcon />} />
          </Box>

          {/* Embudo + por canal */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>Embudo de entrega (global)</Typography>
              <Funnel steps={data.funnel} />
            </Paper>
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>Envíos por canal</Typography>
              <ChannelBars data={data.byChannel} />
            </Paper>
          </Box>

          {/* Salud de envíos / reputación */}
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="subtitle1" fontWeight={700}>Salud de envíos por cliente</Typography>
          </Stack>
          <Alert severity="info" sx={{ mb: 1 }}>
            Umbrales de referencia (SES): rebote &gt; 5% atención / &gt; 10% crítico · queja &gt; 0.1% atención / &gt; 0.5% crítico.
            La reputación de SES es <strong>compartida</strong>: un cliente con métricas malas afecta a todos.
          </Alert>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Cliente</TableCell>
                  <TableCell align="right">Envíos</TableCell>
                  <TableCell align="right">Entregados</TableCell>
                  <TableCell align="right">Rebote</TableCell>
                  <TableCell align="right">Queja</TableCell>
                  <TableCell align="center">Estado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.health.length === 0 && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin envíos en el periodo.</TableCell></TableRow>
                )}
                {data.health.map((h) => (
                  <TableRow key={h.customerId} hover>
                    <TableCell><Typography fontWeight={600}>{h.company || '—'}</Typography></TableCell>
                    <TableCell align="right">{num(h.sent)}</TableCell>
                    <TableCell align="right">{num(h.delivered)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={`${num(h.bounces)} rebotes`}>
                        <Box sx={{ minWidth: 90, ml: 'auto' }}>
                          <Typography variant="body2" color={h.bounceRate >= 0.05 ? 'error' : 'text.primary'}>{pct(h.bounceRate)}</Typography>
                          <LinearProgress variant="determinate" value={Math.min(h.bounceRate * 100 * 10, 100)} color={h.bounceRate >= 0.1 ? 'error' : h.bounceRate >= 0.05 ? 'warning' : 'success'} sx={{ height: 4, borderRadius: 2 }} />
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={`${num(h.complaints)} quejas`}>
                        <Typography variant="body2" color={h.complaintRate >= 0.001 ? 'error' : 'text.primary'}>{pct(h.complaintRate)}</Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="center">
                      <Chip size="small" color={LEVEL_COLOR[h.level]} variant={h.level === 'ok' ? 'outlined' : 'filled'} label={LEVEL_LABEL[h.level]} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
};
