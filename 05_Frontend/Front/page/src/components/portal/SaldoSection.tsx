import { useState } from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
  Button,
  Chip,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddCardIcon from '@mui/icons-material/AddCard';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { usePortalData } from '../../context/PortalDataContext';
import { formatCOP } from '../../services/costService';
import { useFeedback } from '../../hooks/useFeedback';
import { WalletTxTable } from './WalletTxTable';
import { RechargeDialog } from './RechargeDialog';
import { ManualRechargeDialog } from './ManualRechargeDialog';

/**
 * Sección SALDO / RECARGAS del portal del cliente (cobro PREPAGO). Muestra el saldo del
 * monedero y el historial de movimientos (recargas / envíos / reembolsos). El saldo se
 * precarga en el login (PortalDataProvider) y se puede refrescar.
 *
 * Dos formas de recargar: en línea con Wompi (tarjeta/PSE/Nequi) o por transferencia
 * (sube el comprobante → queda pendiente de aprobación del admin).
 */
export const SaldoSection = () => {
  const { balance, refreshBalance } = usePortalData();
  const { notify, FeedbackSnackbar } = useFeedback();
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Saldo y recargas</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshBalance} disabled={balance.loading}>
            Refrescar
          </Button>
          <Button variant="contained" startIcon={<AddCardIcon />} onClick={() => setRechargeOpen(true)}>
            Recargar
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Tu plataforma funciona con <strong>saldo prepago</strong> en pesos. Cada envío real descuenta
        su costo del saldo; si no alcanza, el envío se bloquea hasta que recargues.
      </Typography>

      {balance.error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={refreshBalance}>Reintentar</Button>}>
          {balance.error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <AccountBalanceWalletIcon color="primary" sx={{ fontSize: 40 }} />
            <Box>
              <Typography variant="caption" color="text.secondary">Saldo disponible</Typography>
              <Stack direction="row" spacing={1.5} alignItems="baseline">
                <Typography variant="h3" fontWeight={800} color={balance.value <= 0 ? 'error.main' : 'primary.main'}>
                  {balance.loading && !balance.loaded ? <CircularProgress size={28} /> : formatCOP(balance.value)}
                </Typography>
                <Typography variant="body2" color="text.secondary">{balance.currency}</Typography>
              </Stack>
            </Box>
          </Stack>
          {balance.value <= 0 && balance.loaded && (
            <Chip color="error" variant="outlined" label="Sin saldo — recarga para enviar" />
          )}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            Recarga <strong>en línea con Wompi</strong> (tarjeta/PSE/Nequi) o <strong>por transferencia</strong>
            &nbsp;(sube el comprobante y un administrador la aprueba).
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="contained" startIcon={<AddCardIcon />} onClick={() => setRechargeOpen(true)}>
              Recargar con Wompi
            </Button>
            <Button variant="outlined" startIcon={<ReceiptLongIcon />} onClick={() => setManualOpen(true)}>
              Registrar transferencia
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Movimientos</Typography>
      <WalletTxTable transactions={balance.transactions} emptyText="Aún no tienes movimientos de saldo." />

      <RechargeDialog
        open={rechargeOpen}
        onClose={() => setRechargeOpen(false)}
        onDone={refreshBalance}
        notify={notify}
      />
      <ManualRechargeDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onDone={refreshBalance}
        notify={notify}
      />
      {FeedbackSnackbar}
    </Box>
  );
};
