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
  Link,
  Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import ApartmentIcon from '@mui/icons-material/Apartment';
import AddCardIcon from '@mui/icons-material/AddCard';
import TuneIcon from '@mui/icons-material/Tune';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { balanceService } from '../../services/balanceService';
import type { AdminBalanceRow, AdminWalletTransaction, ManualTopupRow } from '../../services/balanceService';
import { formatCOP } from '../../services/costService';
import { isOk } from '../../services/apiClient';
import { formatDateTime } from '../../utils/datetime';
import { useFeedback } from '../../hooks/useFeedback';
import { WalletTxTable } from '../portal/WalletTxTable';

/**
 * Sección admin: SALDOS (cobro PREPAGO). Tres bloques:
 *  1. BANDEJA de solicitudes de recarga manual (comprobante): ver comprobante,
 *     Aprobar (acredita) o Rechazar (con motivo).  → Api_V1_Admin_Topups/-approve/-reject.
 *  2. Saldo por cliente + AJUSTE directo (crédito) del admin (Api_V1_Balance_Topup-manual,
 *     tipo `adjustment`), para correcciones/cortesías fuera del flujo de aprobación.
 *  3. Movimientos recientes del ledger global.
 * Todo movimiento queda en walletTransaction (auditable).
 */
const QUICK_AMOUNTS = [50000, 100000, 200000];

export const SaldosSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();

  const [rows, setRows] = useState<AdminBalanceRow[]>([]);
  const [recent, setRecent] = useState<AdminWalletTransaction[]>([]);
  const [topups, setTopups] = useState<ManualTopupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busyTopup, setBusyTopup] = useState<string | null>(null);

  // Ajuste directo (crédito) del admin.
  const [target, setTarget] = useState<AdminBalanceRow | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Rechazo de una solicitud (con motivo).
  const [rejectTarget, setRejectTarget] = useState<ManualTopupRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [balances, pend] = await Promise.all([
      balanceService.adminBalances(),
      balanceService.adminTopups('pending'),
    ]);
    setLoading(false);
    if (isOk(balances) && balances.data) {
      setRows(balances.data.customers ?? []);
      setRecent(balances.data.recentTransactions ?? []);
      setTotal(balances.data.totals?.balance ?? 0);
    } else {
      setError(balances.description || 'No se pudieron cargar los saldos.');
    }
    if (isOk(pend) && pend.data) setTopups(pend.data.topups ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // --- Solicitudes de recarga manual (bandeja) ---
  const approve = async (t: ManualTopupRow) => {
    setBusyTopup(t.txId);
    const res = await balanceService.topupApprove(t.txId);
    setBusyTopup(null);
    if (isOk(res)) {
      notify(`Recarga de ${formatCOP(t.amount)} aprobada para ${t.company}.`, 'success');
      load();
    } else {
      notify(res.description || 'No se pudo aprobar la recarga.', 'error');
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) return notify('Indica el motivo del rechazo.', 'warning');
    setBusyTopup(rejectTarget.txId);
    const res = await balanceService.topupReject(rejectTarget.txId, rejectReason.trim());
    setBusyTopup(null);
    if (isOk(res)) {
      notify('Solicitud rechazada.', 'info');
      setRejectTarget(null);
      setRejectReason('');
      load();
    } else {
      notify(res.description || 'No se pudo rechazar la solicitud.', 'error');
    }
  };

  // --- Ajuste directo de saldo ---
  const openAdjust = (c: AdminBalanceRow) => {
    setTarget(c);
    setAmount('');
    setNote('');
  };
  const closeAdjust = () => setTarget(null);

  const handleAdjust = async () => {
    if (!target) return;
    const value = parseInt(amount, 10);
    if (!value || value <= 0) return notify('Indica un monto mayor a 0.', 'warning');
    setSaving(true);
    const res = await balanceService.topupManual(target.customerId, value, note.trim() || undefined);
    setSaving(false);
    if (isOk(res)) {
      notify(`Ajuste de ${formatCOP(value)} aplicado a ${target.company}.`, 'success');
      closeAdjust();
      load();
    } else {
      notify(res.description || 'No se pudo aplicar el ajuste.', 'error');
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
        Revisa y aprueba las <strong>solicitudes de recarga</strong> de los clientes, consulta el saldo
        de cada uno y haz <strong>ajustes</strong> directos. Todo queda en el ledger auditable.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}

      {/* 1. Bandeja de solicitudes de recarga manual (pendientes) */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
          <ReceiptLongIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={700}>Solicitudes de recarga por transferencia</Typography>
          <Chip size="small" color={topups.length ? 'warning' : 'default'} label={`${topups.length} pendiente(s)`} />
        </Stack>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Fecha</TableCell>
                <TableCell>Empresa</TableCell>
                <TableCell>Banco / referencia</TableCell>
                <TableCell align="right">Monto</TableCell>
                <TableCell align="center">Comprobante</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {topups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    No hay solicitudes pendientes.
                  </TableCell>
                </TableRow>
              )}
              {topups.map((t) => (
                <TableRow key={t.txId} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(t.createdAt)}</TableCell>
                  <TableCell>{t.company || t.customerId}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{t.bank || '—'}</Typography>
                    {t.reference && <Typography variant="caption" color="text.secondary">{t.reference}</Typography>}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{formatCOP(t.amount)}</TableCell>
                  <TableCell align="center">
                    {t.proofUrl ? (
                      <Link href={t.proofUrl} target="_blank" rel="noopener">
                        <Tooltip title="Ver comprobante"><VisibilityIcon fontSize="small" /></Tooltip>
                      </Link>
                    ) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small" color="success" variant="outlined" startIcon={<CheckCircleIcon />}
                        disabled={busyTopup !== null} onClick={() => approve(t)}
                      >
                        {busyTopup === t.txId ? <CircularProgress size={16} /> : 'Aprobar'}
                      </Button>
                      <Button
                        size="small" color="error" variant="outlined" startIcon={<CancelIcon />}
                        disabled={busyTopup !== null} onClick={() => { setRejectTarget(t); setRejectReason(''); }}
                      >
                        Rechazar
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* 2. Saldo por cliente */}
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
                  <Button size="small" startIcon={<TuneIcon />} onClick={() => openAdjust(c)}>
                    Ajustar saldo
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 3. Movimientos recientes */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Movimientos recientes</Typography>
      <WalletTxTable transactions={recent} showCompany emptyText="Aún no hay movimientos de saldo." />

      {/* Diálogo de ajuste directo de saldo */}
      <Dialog open={!!target} onClose={closeAdjust} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <TuneIcon color="primary" />
            <span>Ajustar saldo</span>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {target && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">Cliente</Typography>
                <Typography fontWeight={700}>{target.company}</Typography>
                <Typography variant="body2" color="text.secondary">Saldo actual: {formatCOP(target.balance)}</Typography>
              </Box>
              <Alert severity="info" sx={{ py: 0.5 }}>
                Ajuste <strong>directo</strong> (crédito) — úsalo para correcciones o cortesías. Las
                recargas por transferencia del cliente se aprueban en la bandeja de arriba.
              </Alert>
              <Divider />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {QUICK_AMOUNTS.map((a) => (
                  <Chip key={a} label={formatCOP(a)} variant={parseInt(amount, 10) === a ? 'filled' : 'outlined'}
                    color="primary" onClick={() => setAmount(String(a))} />
                ))}
              </Stack>
              <TextField
                label="Monto a acreditar"
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
                placeholder="Ej.: corrección / cortesía"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAdjust} disabled={saving}>Cancelar</Button>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <AddCardIcon />}
            onClick={handleAdjust}
            disabled={saving || !amount}
          >
            {saving ? 'Aplicando…' : 'Aplicar ajuste'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo de rechazo (motivo) */}
      <Dialog open={!!rejectTarget} onClose={() => setRejectTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rechazar solicitud</DialogTitle>
        <DialogContent dividers>
          {rejectTarget && (
            <Stack spacing={2}>
              <Typography variant="body2">
                Rechazar la recarga de <strong>{formatCOP(rejectTarget.amount)}</strong> de{' '}
                <strong>{rejectTarget.company}</strong>. No se acreditará saldo.
              </Typography>
              <TextField
                label="Motivo del rechazo"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                fullWidth
                multiline
                minRows={2}
                placeholder="Ej.: comprobante ilegible / monto no coincide"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)} disabled={busyTopup !== null}>Cancelar</Button>
          <Button
            variant="contained" color="error"
            startIcon={busyTopup !== null ? <CircularProgress size={16} color="inherit" /> : <CancelIcon />}
            onClick={confirmReject}
            disabled={busyTopup !== null || !rejectReason.trim()}
          >
            Rechazar
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
