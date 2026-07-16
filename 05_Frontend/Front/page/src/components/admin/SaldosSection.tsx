import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Stack,
  InputAdornment,
  Chip,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import ApartmentIcon from '@mui/icons-material/Apartment';
import AddCardIcon from '@mui/icons-material/AddCard';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { balanceService } from '../../services/balanceService';
import type { AdminBalanceRow, AdminWalletTransaction } from '../../services/balanceService';
import { formatCOP } from '../../services/costService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { WalletTxTable } from '../portal/WalletTxTable';

/**
 * Sección admin: SALDOS (cobro PREPAGO). Lista el saldo de cada cliente, permite hacer
 * una RECARGA MANUAL (Api_V1_Balance_Topup-manual) y muestra los últimos movimientos del
 * ledger global. Todo movimiento queda registrado en walletTransaction (auditable).
 */
const QUICK_AMOUNTS = [50000, 100000, 200000];

export const SaldosSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();

  const [rows, setRows] = useState<AdminBalanceRow[]>([]);
  const [recent, setRecent] = useState<AdminWalletTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [target, setTarget] = useState<AdminBalanceRow | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await balanceService.adminBalances();
    setLoading(false);
    if (isOk(res) && res.data) {
      setRows(res.data.customers ?? []);
      setRecent(res.data.recentTransactions ?? []);
      setTotal(res.data.totals?.balance ?? 0);
    } else {
      setError(res.description || 'No se pudieron cargar los saldos.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openRecharge = (c: AdminBalanceRow) => {
    setTarget(c);
    setAmount('');
    setNote('');
  };

  const closeRecharge = () => setTarget(null);

  const handleTopup = async () => {
    if (!target) return;
    const value = parseInt(amount, 10);
    if (!value || value <= 0) {
      return notify('Indica un monto a recargar mayor a 0.', 'warning');
    }
    setSaving(true);
    const res = await balanceService.topupManual(target.customerId, value, note.trim() || undefined);
    setSaving(false);
    if (isOk(res)) {
      notify(`Recarga de ${formatCOP(value)} aplicada a ${target.company}.`, 'success');
      closeRecharge();
      load();
    } else {
      notify(res.description || 'No se pudo aplicar la recarga.', 'error');
    }
  };

  const filtered = rows.filter((c) =>
    `${c.company} ${c.companyTin ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Saldos</Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refrescar
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Saldo prepago de cada cliente. Usa <strong>Recargar</strong> para acreditar saldo manualmente
        (transferencia/efectivo). Cada recarga queda en el ledger auditable.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <AccountBalanceWalletIcon color="primary" />
            <Box>
              <Typography variant="caption" color="text.secondary">Saldo total en la plataforma</Typography>
              <Typography variant="h5" fontWeight={800}>{formatCOP(total)}</Typography>
            </Box>
          </Stack>
          <TextField
            size="small"
            placeholder="Buscar por empresa o NIT…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon /></InputAdornment>) }}
            sx={{ minWidth: { sm: 280 } }}
          />
        </Stack>
      </Paper>

      <TableContainer component={Paper} sx={{ mb: 3 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Empresa</TableCell>
              <TableCell>NIT</TableCell>
              <TableCell align="right">Saldo</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {rows.length === 0 ? 'No hay clientes registrados.' : 'Sin resultados para la búsqueda.'}
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
                <TableCell align="right">
                  <Chip
                    size="small"
                    variant="outlined"
                    color={c.balance <= 0 ? 'error' : 'success'}
                    label={formatCOP(c.balance)}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" startIcon={<AddCardIcon />} onClick={() => openRecharge(c)}>
                    Recargar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Movimientos recientes</Typography>
      <WalletTxTable transactions={recent} showCompany emptyText="Aún no hay movimientos de saldo." />

      {/* Diálogo de recarga manual */}
      <Dialog open={!!target} onClose={closeRecharge} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <AddCardIcon color="primary" />
            <span>Recargar saldo</span>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {target && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">Cliente</Typography>
                <Typography fontWeight={700}>{target.company}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Saldo actual: {formatCOP(target.balance)}
                </Typography>
              </Box>
              <Divider />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {QUICK_AMOUNTS.map((a) => (
                  <Chip key={a} label={formatCOP(a)} variant={parseInt(amount, 10) === a ? 'filled' : 'outlined'}
                    color="primary" onClick={() => setAmount(String(a))} />
                ))}
              </Stack>
              <TextField
                label="Monto a recargar"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                type="number"
                fullWidth
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                helperText="En pesos colombianos (COP)."
              />
              <TextField
                label="Nota (opcional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                fullWidth
                placeholder="Ej.: transferencia Bancolombia 12/07"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRecharge} disabled={saving}>Cancelar</Button>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <AddCardIcon />}
            onClick={handleTopup}
            disabled={saving || !amount}
          >
            {saving ? 'Recargando…' : 'Recargar'}
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
