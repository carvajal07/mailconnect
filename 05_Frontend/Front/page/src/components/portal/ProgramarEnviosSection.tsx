import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Chip,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend';
import RefreshIcon from '@mui/icons-material/Refresh';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import BlockIcon from '@mui/icons-material/Block';
import { scheduleService } from '../../services/scheduleService';
import type { ScheduledSend, ScheduleStatus } from '../../services/scheduleService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { usePortalData } from '../../context/PortalDataContext';
import { formatDateTime } from '../../utils/datetime';
import type { CampaignSummary } from '../../services/campaignsService';

const STATUS_META: Record<ScheduleStatus, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error'; icon: React.ReactElement }> = {
  pending: { label: 'Programado', color: 'warning', icon: <HourglassEmptyIcon fontSize="small" /> },
  firing: { label: 'Disparando', color: 'info', icon: <HourglassEmptyIcon fontSize="small" /> },
  sent: { label: 'Enviado', color: 'success', icon: <CheckCircleIcon fontSize="small" /> },
  canceled: { label: 'Cancelado', color: 'default', icon: <BlockIcon fontSize="small" /> },
  failed: { label: 'Falló', color: 'error', icon: <ErrorOutlineIcon fontSize="small" /> },
};

/** Una campaña se puede PROGRAMAR si está lista para el envío real (mismo criterio que el backend). */
const isSchedulable = (c: CampaignSummary): boolean =>
  ['Pendiente', 'Muestras'].includes(c.campaignState) &&
  c.approvalStatus !== 'pending' &&
  c.approvalStatus !== 'rejected';

/** Valor mínimo para el input datetime-local (ahora + 1 min, en hora LOCAL). */
const minLocalDateTime = (): string => {
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const ProgramarEnviosSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  const { campaigns } = usePortalData();
  const schedulable = campaigns.items.filter(isSchedulable);

  const [campaignId, setCampaignId] = useState('');
  const [when, setWhen] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [schedules, setSchedules] = useState<ScheduledSend[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadingList(true);
    const res = await scheduleService.list();
    setLoadingList(false);
    if (isOk(res) && res.data?.schedules) setSchedules(res.data.schedules);
    else if (!isOk(res)) notify(res.description || 'No se pudieron cargar los envíos programados.', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!campaignId) return notify('Elige una campaña.', 'warning');
    if (!when) return notify('Elige la fecha y hora del envío.', 'warning');
    const ts = new Date(when).getTime();
    if (Number.isNaN(ts) || ts <= Date.now()) return notify('La fecha y hora deben ser futuras.', 'warning');
    // datetime-local es hora LOCAL; se envía en UTC ISO para que el backend compare sin ambigüedad.
    const scheduledAtUtc = new Date(when).toISOString();
    setSubmitting(true);
    const res = await scheduleService.create(campaignId, scheduledAtUtc);
    setSubmitting(false);
    if (isOk(res)) {
      notify('Envío programado. Se disparará automáticamente a la hora indicada.', 'success');
      setCampaignId('');
      setWhen('');
      load();
    } else {
      notify(res.description || 'No se pudo programar el envío.', 'error');
    }
  };

  const handleCancel = async (s: ScheduledSend) => {
    const ok = await confirm({
      title: 'Cancelar envío programado',
      message: `¿Cancelar el envío programado de "${s.campaignName}" para ${formatDateTime(s.scheduledAt)}?`,
      confirmText: 'Cancelar envío',
      confirmColor: 'error',
    });
    if (!ok) return;
    setCancelingId(s.scheduleId);
    const res = await scheduleService.cancel(s.scheduleId);
    setCancelingId(null);
    if (isOk(res)) {
      notify('Envío programado cancelado.', 'success');
      load();
    } else {
      notify(res.description || 'No se pudo cancelar.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Programar envíos</Typography>
          <Typography variant="body2" color="text.secondary">
            Agenda el envío real de una campaña aprobada para una fecha y hora futura.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={loadingList ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={load} disabled={loadingList}>
          Actualizar
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        A la hora programada, el sistema dispara el envío real automáticamente. Se validan en ese
        momento el <strong>saldo</strong>, la <strong>aprobación</strong> y que los envíos reales
        estén habilitados — igual que un envío manual. La ejecución puede tardar unos minutos
        respecto a la hora exacta.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Nuevo envío programado</Typography>
        {schedulable.length === 0 ? (
          <Alert severity="warning">
            No tienes campañas listas para programar. Una campaña se puede programar cuando está en
            estado <strong>Pendiente</strong> o <strong>Muestras</strong> y no está en aprobación
            pendiente o rechazada.
          </Alert>
        ) : (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
            <FormControl fullWidth>
              <InputLabel>Campaña</InputLabel>
              <Select value={campaignId} label="Campaña" onChange={(e) => setCampaignId(e.target.value)}>
                {schedulable.map((c) => (
                  <MenuItem key={c.campaignId} value={c.campaignId}>
                    {c.campaignName} {c.consecutive ? `(#${c.consecutive})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              type="datetime-local"
              label="Fecha y hora"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: minLocalDateTime() }}
            />
            <Button
              variant="contained"
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <ScheduleSendIcon />}
              onClick={handleCreate}
              disabled={submitting || !campaignId || !when}
              sx={{ minWidth: 160, height: 56 }}
            >
              Programar
            </Button>
          </Stack>
        )}
      </Paper>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Campaña</TableCell>
              <TableCell>Programado para</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {schedules.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {loadingList ? 'Cargando…' : 'Aún no tienes envíos programados.'}
                </TableCell>
              </TableRow>
            )}
            {schedules.map((s) => {
              const meta = STATUS_META[s.status] ?? STATUS_META.pending;
              return (
                <TableRow key={s.scheduleId} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{s.campaignName}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(s.scheduledAt)}</TableCell>
                  <TableCell>
                    <Tooltip title={s.status === 'failed' && s.error ? s.error : ''}>
                      <Chip size="small" variant="outlined" color={meta.color} icon={meta.icon} label={meta.label} />
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    {s.status === 'pending' ? (
                      <Tooltip title="Cancelar">
                        <span>
                          <IconButton color="error" onClick={() => handleCancel(s)} disabled={cancelingId === s.scheduleId}>
                            {cancelingId === s.scheduleId ? <CircularProgress size={20} /> : <CancelIcon />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {ConfirmDialog}
      {FeedbackSnackbar}
    </Box>
  );
};
