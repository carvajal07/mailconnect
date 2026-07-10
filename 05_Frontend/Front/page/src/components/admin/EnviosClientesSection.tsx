import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Switch,
  Chip,
  Button,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import ApartmentIcon from '@mui/icons-material/Apartment';
import { customerService } from '../../services/customerService';
import type { CustomerSummary } from '../../services/customerService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

/**
 * Sección admin: habilitar/deshabilitar los ENVÍOS REALES por cliente.
 * Cuando un cliente queda deshabilitado, el backend (Prepare-batch) bloquea el envío
 * real de sus campañas y su portal muestra el botón deshabilitado (las muestras siguen).
 */
export const EnviosClientesSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await customerService.list();
    setLoading(false);
    if (isOk(res) && res.data?.customers) {
      setCustomers(res.data.customers);
    } else {
      setError(res.description || 'No se pudieron cargar los clientes.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (c: CustomerSummary) => {
    const next = !c.realSendEnabled;
    setSavingId(c.customerId);
    const res = await customerService.setRealSendEnabled(c.customerId, next);
    setSavingId(null);
    if (isOk(res)) {
      setCustomers((prev) =>
        prev.map((x) => (x.customerId === c.customerId ? { ...x, realSendEnabled: next } : x)),
      );
      notify(
        `Envíos reales ${next ? 'habilitados' : 'deshabilitados'} para ${c.company}.`,
        next ? 'success' : 'warning',
      );
    } else {
      notify(res.description || 'No se pudo actualizar el cliente.', 'error');
    }
  };

  const filtered = customers.filter((c) =>
    `${c.company} ${c.companyTin ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const disabledCount = customers.filter((c) => !c.realSendEnabled).length;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Envíos por cliente</Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refrescar
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Habilita o deshabilita los <strong>envíos reales</strong> de cada cliente. Con los envíos
        deshabilitados, el cliente puede probar muestras pero no enviar a toda su base.
      </Typography>

      {disabledCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {disabledCount} cliente(s) con envíos reales deshabilitados.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Buscar por empresa o NIT…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon /></InputAdornment>) }}
        />
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Empresa</TableCell>
              <TableCell>NIT</TableCell>
              <TableCell>Estado de envíos reales</TableCell>
              <TableCell align="center">Habilitado</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={26} />
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {customers.length === 0 ? 'No hay clientes registrados.' : 'Sin resultados para la búsqueda.'}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.customerId} hover>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ApartmentIcon fontSize="small" color="action" />
                    <Typography fontWeight={600}>{c.company || '—'}</Typography>
                  </Stack>
                </TableCell>
                <TableCell>{c.companyTin ?? '—'}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={c.realSendEnabled ? 'success' : 'error'}
                    label={c.realSendEnabled ? 'Habilitado' : 'Deshabilitado'}
                  />
                </TableCell>
                <TableCell align="center">
                  {savingId === c.customerId ? (
                    <CircularProgress size={20} />
                  ) : (
                    <Switch
                      checked={c.realSendEnabled}
                      onChange={() => toggle(c)}
                      color="success"
                      inputProps={{ 'aria-label': `Envíos reales de ${c.company}` }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {FeedbackSnackbar}
    </Box>
  );
};
