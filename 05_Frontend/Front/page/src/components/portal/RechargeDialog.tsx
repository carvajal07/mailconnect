import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Chip,
  Typography,
  InputAdornment,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { balanceService } from '../../services/balanceService';
import { formatCOP } from '../../services/costService';
import { isOk } from '../../services/apiClient';
import { loadWompiWidget } from '../../services/wompi';

/**
 * Diálogo de RECARGA de saldo con Wompi (Fase 2). Flujo:
 *   1. El cliente elige el monto (mín. MIN_TOPUP).
 *   2. /Balance/Topup-init crea el intento `pending` + firma de integridad.
 *   3. Se abre el Widget de Wompi con esa firma; el cliente paga.
 *   4. El SALDO lo acredita el WEBHOOK (no el navegador). Al cerrar el widget se refresca
 *      el saldo (puede tardar unos segundos en reflejarse mientras llega el webhook).
 */
export const MIN_TOPUP = 20000;
const QUICK_AMOUNTS = [50000, 100000, 200000];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Se llama tras cerrar el widget para refrescar el saldo. */
  onDone: () => void;
  notify: (message: string, severity?: 'success' | 'error' | 'warning' | 'info') => void;
}

export const RechargeDialog = ({ open, onClose, onDone, notify }: Props) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const value = parseInt(amount, 10) || 0;
  // Monto ingresado pero por debajo del mínimo: se avisa explícitamente (antes el botón
  // solo quedaba deshabilitado sin explicar por qué → parecía un error genérico).
  const belowMin = value > 0 && value < MIN_TOPUP;

  const reset = () => {
    setAmount('');
    setError('');
    setLoading(false);
  };

  const close = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const handlePay = async () => {
    setError('');
    if (value < MIN_TOPUP) {
      setError(`El monto mínimo de recarga es ${formatCOP(MIN_TOPUP)}.`);
      return;
    }
    setLoading(true);
    // 1. Intento de recarga en el backend (referencia + firma de integridad).
    const res = await balanceService.topupInit(value);
    if (!isOk(res) || !res.data) {
      setLoading(false);
      setError(res.description || 'No se pudo iniciar la recarga.');
      return;
    }
    // 2. Widget de Wompi con la firma.
    try {
      const WidgetCheckout = await loadWompiWidget();
      const data = res.data;
      const checkout = new WidgetCheckout({
        currency: data.currency,
        amountInCents: data.amountInCents,
        reference: data.reference,
        publicKey: data.publicKey,
        signature: { integrity: data.signatureIntegrity },
        redirectUrl: data.redirectUrl || undefined,
      });
      setLoading(false);
      // 3. Abrir el widget. El saldo lo acredita el webhook, no este callback.
      checkout.open((result) => {
        const status = result?.transaction?.status;
        if (status === 'APPROVED') {
          notify('Pago aprobado. Tu saldo se actualizará en unos segundos.', 'success');
        } else if (status) {
          notify(`El pago quedó en estado ${status}. Si se aprueba, tu saldo se actualizará solo.`, 'info');
        }
        reset();
        onClose();
        // Refresca el saldo (el webhook puede tardar un momento en acreditar).
        onDone();
        setTimeout(onDone, 4000);
      });
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : 'No se pudo abrir el widget de pagos.');
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <AccountBalanceWalletIcon color="primary" />
          <span>Recargar saldo</span>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Elige cuánto quieres recargar. El pago es seguro con <strong>Wompi</strong>; tu saldo se
            acredita automáticamente al confirmarse el pago.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {QUICK_AMOUNTS.map((a) => (
              <Chip
                key={a}
                label={formatCOP(a)}
                color="primary"
                variant={value === a ? 'filled' : 'outlined'}
                onClick={() => setAmount(String(a))}
              />
            ))}
          </Stack>
          <TextField
            label="Monto a recargar"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            type="number"
            fullWidth
            autoFocus
            error={belowMin}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            helperText={
              belowMin
                ? `El monto mínimo de recarga es ${formatCOP(MIN_TOPUP)} (COP).`
                : `Mínimo ${formatCOP(MIN_TOPUP)} (COP).`
            }
          />
          {belowMin && (
            <Alert severity="warning">
              El monto mínimo de recarga con Wompi es <strong>{formatCOP(MIN_TOPUP)}</strong>. Si
              necesitas recargar menos, usa <strong>Registrar transferencia</strong> (aprobación manual).
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Divider />
          <Typography variant="caption" color="text.secondary">
            Serás redirigido al checkout de Wompi. No compartas tu información de pago con nadie.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={loading}>Cancelar</Button>
        <Button
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AccountBalanceWalletIcon />}
          onClick={handlePay}
          disabled={loading || value < MIN_TOPUP}
        >
          {loading ? 'Abriendo…' : `Pagar ${value ? formatCOP(value) : ''}`.trim()}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
