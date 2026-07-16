import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  MenuItem,
  InputAdornment,
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
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CampaignIcon from '@mui/icons-material/Campaign';
import SearchIcon from '@mui/icons-material/Search';
import { adminCampaignsService } from '../../services/adminCampaignsService';
import type { AdminCampaignRow } from '../../services/adminCampaignsService';
import { isOk } from '../../services/apiClient';

/** Etiqueta legible del canal. */
const CHANNEL_LABEL: Record<string, string> = {
  EM: 'Correo (EM)', EAU: 'Correo adjunto (EAU)', EAP: 'Correo personalizado (EAP)',
  SMS: 'SMS', WSP: 'WhatsApp', VOZ: 'Voz',
};

/** Color del chip según el estado de la campaña. */
const ESTADO_COLOR: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  Pendiente: 'default',
  Muestras: 'warning',
  Enviando: 'info',
  Procesando: 'info',
  Terminada: 'success',
  Error: 'error',
};

const STATE_OPTIONS = ['', 'Pendiente', 'Muestras', 'Enviando', 'Terminada', 'Error'];
const CHANNEL_OPTIONS = ['', 'EM', 'EAU', 'EAP', 'SMS', 'WSP', 'VOZ'];

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/**
 * Sección admin: CAMPAÑAS de TODOS los clientes (solo lectura). A diferencia del tab de
 * campañas del portal (acotado al tenant), aquí el admin ve las campañas de todas las
 * empresas, con la columna de cliente y filtros por empresa/estado/canal/mes/búsqueda.
 */
export const AdminCampanasSection = () => {
  const [month, setMonth] = useState('');
  const [state, setState] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [channel, setChannel] = useState('');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<AdminCampaignRow[]>([]);
  const [customers, setCustomers] = useState<{ customerId: string; company: string }[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // El filtrado por mes/estado/cliente/canal lo hace el backend; la búsqueda por texto
  // (nombre de campaña o empresa) es local para respuesta inmediata.
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await adminCampaignsService.list({ month, state, customerId, channel });
    setLoading(false);
    if (isOk(res) && res.data) {
      setRows(res.data.campaigns ?? []);
      setCustomers(res.data.customers ?? []);
      setTruncated(Boolean(res.data.truncated));
    } else {
      setRows([]);
      setError(res.description || 'No se pudieron cargar las campañas.');
    }
  }, [month, state, customerId, channel]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.campaignName || '').toLowerCase().includes(q) ||
        (r.company || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <CampaignIcon color="primary" />
          <Typography variant="h4">Campañas</Typography>
        </Stack>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Campañas de <strong>todos los clientes</strong> con la empresa a la que pertenecen. Solo lectura.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Se alcanzó el tope de campañas devueltas. Acota por mes, cliente, canal o estado.
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField type="month" size="small" label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} helperText="Vacío = todas" />
          <TextField select size="small" label="Cliente" value={customerId} onChange={(e) => setCustomerId(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todos los clientes</MenuItem>
            {customers.map((c) => (
              <MenuItem key={c.customerId} value={c.customerId}>{c.company}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Estado" value={state} onChange={(e) => setState(e.target.value)} sx={{ minWidth: 150 }}>
            {STATE_OPTIONS.map((s) => (
              <MenuItem key={s || 'all'} value={s}>{s || 'Todos'}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Canal" value={channel} onChange={(e) => setChannel(e.target.value)} sx={{ minWidth: 160 }}>
            {CHANNEL_OPTIONS.map((c) => (
              <MenuItem key={c || 'all'} value={c}>{c ? (CHANNEL_LABEL[c] || c) : 'Todos'}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Buscar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Campaña o empresa"
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Empresa</TableCell>
              <TableCell>Campaña</TableCell>
              <TableCell>Consecutivo</TableCell>
              <TableCell>Canal</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>Fecha</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {!loading && visible.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No hay campañas para el filtro seleccionado.</TableCell></TableRow>
            )}
            {visible.map((c) => (
              <TableRow key={c.campaignId} hover>
                <TableCell><Typography fontWeight={600}>{c.company || '—'}</Typography></TableCell>
                <TableCell>{c.campaignName || '—'}</TableCell>
                <TableCell>{c.consecutive || '—'}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={CHANNEL_LABEL[c.channel] || c.channel || '—'} /></TableCell>
                <TableCell><Chip size="small" color={ESTADO_COLOR[c.campaignState] || 'default'} label={c.campaignState || '—'} /></TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(c.date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {!loading && rows.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {visible.length} de {rows.length} campaña(s){search ? ' (filtradas por búsqueda)' : ''}.
        </Typography>
      )}
    </Box>
  );
};
