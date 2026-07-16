import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Typography,
  InputAdornment,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { balanceService } from '../../services/balanceService';
import { campaignsService } from '../../services/campaignsService';
import { formatCOP } from '../../services/costService';
import { isOk } from '../../services/apiClient';
import { getUser } from '../../services/authService';

/**
 * Diálogo de RECARGA MANUAL por transferencia (cobro PREPAGO). El cliente:
 *   1. Consigna/transfiere por fuera del sistema.
 *   2. Sube el comprobante (imagen/PDF) a S3 (get-urlS3, documentType=document).
 *   3. Registra la solicitud (Topup-manual-request) → queda PENDIENTE de aprobación admin.
 * El saldo NO cambia hasta que el admin apruebe la solicitud (revisa el comprobante).
 */
interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  notify: (message: string, severity?: 'success' | 'error' | 'warning' | 'info') => void;
}

const MAX_MB = 8;

export const ManualRechargeDialog = ({ open, onClose, onDone, notify }: Props) => {
  const user = getUser();
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const value = parseInt(amount, 10) || 0;

  const reset = () => {
    setAmount(''); setBank(''); setReference(''); setFile(null); setError(''); setLoading(false);
  };
  const close = () => { if (loading) return; reset(); onClose(); };

  const pickFile = (f: File | null) => {
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setError(`El comprobante supera ${MAX_MB} MB.`);
      return;
    }
    setError('');
    setFile(f);
  };

  const handleSubmit = async () => {
    setError('');
    if (value <= 0) return setError('Indica el monto transferido (COP).');
    if (!file) return setError('Adjunta el comprobante de la transferencia.');

    setLoading(true);
    // 1. Subir el comprobante a S3 (bucket de documentos del cliente).
    const presign = await campaignsService.presignUrl({
      customer: user?.customer ?? '',
      nit: user?.nit ?? '',
      documentName: file.name,
      documentType: 'document',
    });
    if (!isOk(presign) || !presign.data?.url || !presign.data?.path) {
      setLoading(false);
      return setError(presign.description || 'No se pudo preparar la subida del comprobante.');
    }
    const uploaded = await campaignsService.uploadToS3(presign.data.url, file);
    if (!uploaded) {
      setLoading(false);
      return setError('No se pudo subir el comprobante. Intenta de nuevo.');
    }
    // 2. Registrar la solicitud (queda pendiente de aprobación).
    const res = await balanceService.topupManualRequest({
      amount: value,
      proofS3Path: presign.data.path,
      bank: bank.trim() || undefined,
      reference: reference.trim() || undefined,
    });
    setLoading(false);
    if (isOk(res)) {
      notify('Solicitud enviada. Un administrador la revisará y acreditará tu saldo.', 'success');
      reset();
      onClose();
      onDone();
    } else {
      setError(res.description || 'No se pudo registrar la solicitud.');
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <ReceiptLongIcon color="primary" />
          <span>Registrar recarga por transferencia</span>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Consigna o transfiere a la cuenta de MailConnect, sube el comprobante y registra la
            solicitud. Tu saldo se acreditará cuando un administrador la apruebe.
          </Typography>
          <TextField
            label="Monto transferido"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            type="number"
            fullWidth
            autoFocus
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            helperText="En pesos colombianos (COP)."
          />
          <Stack direction="row" spacing={1}>
            <TextField label="Banco / medio" value={bank} onChange={(e) => setBank(e.target.value)} fullWidth placeholder="Bancolombia, Nequi…" />
            <TextField label="Referencia" value={reference} onChange={(e) => setReference(e.target.value)} fullWidth placeholder="N° de transacción" />
          </Stack>
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
            {file ? file.name : 'Adjuntar comprobante (imagen/PDF)'}
            <input
              type="file"
              hidden
              accept="image/*,application/pdf"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          <Divider />
          <Typography variant="caption" color="text.secondary">
            La solicitud queda <strong>pendiente</strong> hasta la aprobación del administrador.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={loading}>Cancelar</Button>
        <Button
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <ReceiptLongIcon />}
          onClick={handleSubmit}
          disabled={loading || value <= 0 || !file}
        >
          {loading ? 'Enviando…' : `Enviar solicitud ${value ? formatCOP(value) : ''}`.trim()}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
