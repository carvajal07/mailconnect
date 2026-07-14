import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
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
  InputAdornment,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import SearchIcon from '@mui/icons-material/Search';
import PaidIcon from '@mui/icons-material/Paid';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SendIcon from '@mui/icons-material/Send';
import { auditService } from '../../services/auditService';
import type { AuditData } from '../../services/auditService';
import { isOk } from '../../services/apiClient';

// Metadatos por tipo de acción (etiqueta + color + icono).
const ACTION_META: Record<string, { label: string; color: 'primary' | 'success' | 'warning' | 'info'; icon: ReactElement }> = {
  'customer.realSend': { label: 'Envíos por cliente', color: 'warning', icon: <SendIcon fontSize="small" /> },
  'user.role': { label: 'Cambio de rol', color: 'primary', icon: <AdminPanelSettingsIcon fontSize="small" /> },
  'pricing.update': { label: 'Tarifas', color: 'success', icon: <PaidIcon fontSize="small" /> },
  'config.set': { label: 'Configuración', color: 'info', icon: <SettingsIcon fontSize="small" /> },
};

const actionLabel = (a: string) => ACTION_META[a]?.label ?? a;

/**
 * Sección admin: AUDITORÍA. Bitácora de acciones administrativas sensibles (quién
 * hizo qué y cuándo): envíos por cliente, roles, tarifas y configuración.
 */
export const AuditoriaSection = () => {
  const [month, setMonth] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await auditService.list(month, action, actor.trim());
    setLoading(false);
    if (isOk(res) && res.data) setData(res.data);
    else setError(res.description || 'No se pudo cargar la auditoría.');
  }, [month, action, actor]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <HistoryIcon color="primary" />
          <Typography variant="h4">Auditoría</Typography>
        </Stack>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Registro de acciones administrativas sensibles: quién habilitó envíos, cambió un rol,
        tocó tarifas o configuración, y cuándo.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {data?.truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Mostrando los eventos más recientes (se alcanzó el tope). Acota por mes o acción.
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField type="month" size="small" label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} helperText="Vacío = recientes" />
          <TextField select size="small" label="Acción" value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todas</MenuItem>
            {(data?.actions ?? []).map((a) => (
              <MenuItem key={a} value={a}>{actionLabel(a)}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Actor"
            placeholder="correo o id…"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
          />
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Fecha (UTC)</TableCell>
              <TableCell>Actor</TableCell>
              <TableCell>Acción</TableCell>
              <TableCell>Objetivo</TableCell>
              <TableCell>Detalle</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && !data && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {!loading && data && data.entries.length === 0 && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>No hay eventos registrados para el filtro.</TableCell></TableRow>
            )}
            {data?.entries.map((e) => {
              const meta = ACTION_META[e.action];
              return (
                <TableRow key={e.auditId} hover>
                  <TableCell><Typography variant="caption">{e.date}</Typography></TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{e.actor || '—'}</Typography>
                    {e.customer && <Typography variant="caption" color="text.secondary">{e.customer}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={meta?.color ?? 'default'} variant="outlined" icon={meta?.icon} label={actionLabel(e.action)} />
                  </TableCell>
                  <TableCell><Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{e.target || '—'}</Typography></TableCell>
                  <TableCell><Typography variant="body2" color="text.secondary">{e.detail || '—'}</Typography></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
