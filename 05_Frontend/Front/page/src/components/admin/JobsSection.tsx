import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  MenuItem,
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
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import BlockIcon from '@mui/icons-material/Block';
import ReplayIcon from '@mui/icons-material/Replay';
import { jobsService } from '../../services/jobsService';
import type { JobRow, JobsData } from '../../services/jobsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';

const num = (n: number) => new Intl.NumberFormat('es-CO').format(n || 0);

const STATE_OPTIONS = ['', 'Procesando', 'Muestras', 'Terminada', 'Error'];

// Color del chip según el estado del proceso.
const stateColor = (s: string): 'info' | 'success' | 'error' | 'warning' | 'default' => {
  if (s === 'Procesando') return 'info';
  if (s === 'Terminada') return 'success';
  if (s === 'Error') return 'error';
  if (s === 'Muestras') return 'warning';
  return 'default';
};

const JobProgress = ({ job }: { job: JobRow }) => {
  const pctRaw = Math.round((job.progress || 0) * 100);
  const pct = Math.min(pctRaw, 100);
  return (
    <Box sx={{ minWidth: 140 }}>
      <Stack direction="row" justifyContent="space-between" mb={0.25}>
        <Typography variant="caption">{num(job.sent)} / {num(job.registersToSend)}</Typography>
        <Typography variant="caption" color="text.secondary">{pct}%</Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={job.processState === 'Error' ? 'error' : job.processState === 'Terminada' ? 'success' : 'info'}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  );
};

/**
 * Sección admin: TRABAJOS / colas. Monitor de solo lectura de los envíos en curso y
 * recientes (tabla `process`), con estado, progreso y bloqueos de la preparación.
 */
export const JobsSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  const [month, setMonth] = useState('');
  const [state, setState] = useState('');
  const [data, setData] = useState<JobsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requeuing, setRequeuing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await jobsService.list(month, state);
    setLoading(false);
    if (isOk(res) && res.data) setData(res.data);
    else setError(res.description || 'No se pudieron cargar los trabajos.');
  }, [month, state]);

  useEffect(() => {
    load();
  }, [load]);

  // Un trabajo es "reintentable" si es un envío troceado (parts>0), no terminó y le faltan
  // envíos. El backend reencola SOLO las partes pendientes (idempotente: no reduplica).
  const canRetry = (j: JobRow) =>
    (j.parts || 0) > 0 && j.processState !== 'Terminada' && (j.progress || 0) < 1;

  const retry = async (j: JobRow) => {
    const ok = await confirm({
      title: 'Reintentar envío',
      message: `Se reencolarán las partes pendientes de "${j.campaignName || j.processId}". ` +
        `Es seguro: los envíos ya realizados no se repiten (solo se procesan las partes que faltan).`,
      confirmText: 'Reintentar',
      confirmColor: 'primary',
    });
    if (!ok) return;
    setRequeuing(j.processId);
    const res = await jobsService.requeue(j.processId);
    setRequeuing(null);
    if (isOk(res) && res.data) {
      notify(res.data.requeued > 0
        ? `Reencoladas ${res.data.requeued} parte(s) pendiente(s).`
        : 'No había partes pendientes; el proceso ya está completo.', 'success');
      load();
    } else {
      notify(res.description || 'No se pudo reintentar el proceso.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <WorkHistoryIcon color="primary" />
          <Typography variant="h4">Trabajos</Typography>
        </Stack>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Envíos en curso y recientes con su <strong>progreso</strong> y los contactos filtrados en
        la preparación (lista negra, desuscritos, inválidos). Solo lectura.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {data?.truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Se alcanzó el tope de trabajos enriquecidos con conteo. Acota por mes o estado.
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} flexWrap="wrap" useFlexGap>
          <TextField type="month" size="small" label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} helperText="Vacío = recientes" />
          <TextField select size="small" label="Estado" value={state} onChange={(e) => setState(e.target.value)} sx={{ minWidth: 180 }}>
            {STATE_OPTIONS.map((s) => (
              <MenuItem key={s || 'all'} value={s}>{s || 'Todos'}</MenuItem>
            ))}
          </TextField>
          {data && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(data.counts ?? {}).map(([s, n]) => (
                <Chip key={s} size="small" color={stateColor(s)} variant="outlined" label={`${s}: ${n}`} />
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Campaña</TableCell>
              <TableCell>Cliente</TableCell>
              <TableCell>Canal</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Progreso</TableCell>
              <TableCell align="center">Filtrados</TableCell>
              <TableCell>Fecha</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && !data && (
              <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {!loading && data && (data.jobs?.length ?? 0) === 0 && (
              <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>No hay trabajos en el periodo/estado seleccionado.</TableCell></TableRow>
            )}
            {(data?.jobs ?? []).map((j) => {
              const b = j.blocked ?? { blacklist: 0, unsubscribe: 0, invalid: 0 };
              const blockedTotal = (b.blacklist || 0) + (b.unsubscribe || 0) + (b.invalid || 0);
              return (
                <TableRow key={j.processId} hover>
                  <TableCell><Typography fontWeight={600}>{j.campaignName || '—'}</Typography></TableCell>
                  <TableCell>{j.company || '—'}</TableCell>
                  <TableCell><Chip size="small" variant="outlined" label={j.channelLabel} /></TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Chip size="small" color={stateColor(j.processState)} label={j.processState || '—'} />
                      {j.campaignState && j.campaignState !== j.processState && (
                        <Typography variant="caption" color="text.secondary">camp: {j.campaignState}</Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell><JobProgress job={j} /></TableCell>
                  <TableCell align="center">
                    {blockedTotal > 0 ? (
                      <Tooltip title={`Lista negra: ${b.blacklist} · Desuscritos: ${b.unsubscribe} · Inválidos: ${b.invalid}`}>
                        <Chip size="small" icon={<BlockIcon />} variant="outlined" color="default" label={num(blockedTotal)} />
                      </Tooltip>
                    ) : '—'}
                  </TableCell>
                  <TableCell><Typography variant="caption">{j.date || '—'}</Typography></TableCell>
                  <TableCell align="right">
                    {canRetry(j) ? (
                      <Tooltip title="Reencolar las partes pendientes de este envío">
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={requeuing === j.processId ? <CircularProgress size={14} /> : <ReplayIcon />}
                            disabled={requeuing === j.processId}
                            onClick={() => retry(j)}
                          >
                            Reintentar
                          </Button>
                        </span>
                      </Tooltip>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {FeedbackSnackbar}
      {ConfirmDialog}
    </Box>
  );
};
