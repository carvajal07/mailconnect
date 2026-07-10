import { useState } from 'react';
import {
  Paper,
  Stack,
  Typography,
  Button,
  Box,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  TextField,
  MenuItem,
  InputAdornment,
} from '@mui/material';
import PaidIcon from '@mui/icons-material/Paid';
import CalculateIcon from '@mui/icons-material/Calculate';
import { getUser } from '../../services/authService';
import {
  costService,
  formatCOP,
  type Channel,
  type EmailMode,
  type EstimateResult,
} from '../../services/costService';
import { isOk } from '../../services/apiClient';

/**
 * Estimador de costo interactivo (los 4 canales), pensado para mostrarse ANTES de
 * enviar. El customerId sale de la sesión (tarifa por cliente si existe). Se puede
 * fijar el canal y los destinatarios por props (p. ej. desde una campaña) y bloquearlos.
 */
interface Props {
  channel?: Channel;
  emailMode?: EmailMode;
  recipients?: number;
  lockChannel?: boolean;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  EMAIL: 'Correo', SMS: 'SMS', WHATSAPP: 'WhatsApp', VOICE: 'Voz',
};

export const CostEstimate = ({ channel: initChannel = 'EMAIL', emailMode: initMode = 'EM', recipients: initRecipients, lockChannel = false }: Props) => {
  const customerId = getUser()?.customerId ?? '';

  const [channel, setChannel] = useState<Channel>(initChannel);
  const [emailMode, setEmailMode] = useState<EmailMode>(initMode);
  const [recipients, setRecipients] = useState<string>(initRecipients ? String(initRecipients) : '');
  const [attachmentSizeMB, setAttachmentSizeMB] = useState('');
  const [attachmentType, setAttachmentType] = useState<'pdf' | 'docx'>('pdf');
  const [smsSegments, setSmsSegments] = useState('1');
  const [voiceMinutes, setVoiceMinutes] = useState('0.5');

  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const withAttachment = channel === 'EMAIL' && (emailMode === 'EAU' || emailMode === 'EAP');

  const estimate = async () => {
    const n = parseInt(recipients, 10);
    if (!n || n <= 0) {
      setError('Indica cuántos destinatarios tendrá el envío.');
      setResult(null);
      return;
    }
    setLoading(true);
    setError('');
    const res = await costService.estimate({
      customerId,
      channel,
      recipients: n,
      emailMode: channel === 'EMAIL' ? emailMode : undefined,
      attachmentSizeMB: withAttachment ? parseFloat(attachmentSizeMB) || 0 : undefined,
      attachmentType: channel === 'EMAIL' && emailMode === 'EAP' ? attachmentType : undefined,
      smsSegments: channel === 'SMS' ? parseInt(smsSegments, 10) || 1 : undefined,
      voiceMinutes: channel === 'VOICE' ? parseFloat(voiceMinutes) || 0.5 : undefined,
    });
    setLoading(false);
    if (isOk(res) && res.data) setResult(res.data);
    else { setError(res.description || 'No se pudo calcular el estimado.'); setResult(null); }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5, bgcolor: 'action.hover' }}>
      <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
        <PaidIcon color="primary" />
        <Typography variant="subtitle1" fontWeight={700}>Costo estimado del envío</Typography>
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
        <TextField
          select label="Canal" value={channel} size="small" disabled={lockChannel}
          onChange={(e) => setChannel(e.target.value as Channel)}
        >
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
            <MenuItem key={c} value={c}>{CHANNEL_LABEL[c]}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Destinatarios" value={recipients} size="small" type="number"
          onChange={(e) => setRecipients(e.target.value)} inputProps={{ min: 1 }}
        />

        {channel === 'EMAIL' && (
          <TextField select label="Tipo de correo" value={emailMode} size="small" onChange={(e) => setEmailMode(e.target.value as EmailMode)}>
            <MenuItem value="EM">EM — sin adjunto</MenuItem>
            <MenuItem value="EAU">EAU — adjunto único</MenuItem>
            <MenuItem value="EAP">EAP — adjunto personalizado</MenuItem>
          </TextField>
        )}

        {withAttachment && (
          <TextField
            label="Peso adjunto" value={attachmentSizeMB} size="small" type="number"
            onChange={(e) => setAttachmentSizeMB(e.target.value)}
            InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
          />
        )}
        {channel === 'EMAIL' && emailMode === 'EAP' && (
          <TextField select label="Formato adjunto" value={attachmentType} size="small" onChange={(e) => setAttachmentType(e.target.value as 'pdf' | 'docx')}>
            <MenuItem value="pdf">PDF</MenuItem>
            <MenuItem value="docx">Word (.docx)</MenuItem>
          </TextField>
        )}
        {channel === 'SMS' && (
          <TextField label="Segmentos por SMS" value={smsSegments} size="small" type="number" onChange={(e) => setSmsSegments(e.target.value)} inputProps={{ min: 1 }} />
        )}
        {channel === 'VOICE' && (
          <TextField label="Minutos por llamada" value={voiceMinutes} size="small" type="number" onChange={(e) => setVoiceMinutes(e.target.value)} inputProps={{ min: 0.1, step: 0.1 }} />
        )}
      </Box>

      <Button
        sx={{ mt: 2 }} variant="contained" size="small"
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <CalculateIcon />}
        onClick={estimate} disabled={loading}
      >
        {loading ? 'Calculando…' : 'Calcular estimado'}
      </Button>

      {error && <Typography variant="body2" color="error" sx={{ mt: 1 }}>{error}</Typography>}

      {result && (
        <Collapse in>
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
              <Typography variant="h5" fontWeight={800} color="primary.main">{formatCOP(result.estimatedCost)}</Typography>
              <Typography variant="body2" color="text.secondary">
                ({result.recipients.toLocaleString('es-CO')} destinatarios · {formatCOP(result.unitCost)} c/u aprox.)
              </Typography>
              {result.appliedMinimum && <Chip size="small" color="warning" label="Mínimo por campaña" variant="outlined" />}
            </Stack>

            <Table size="small" sx={{ mt: 1.5 }}>
              <TableBody>
                {result.breakdown.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ border: 0, py: 0.4 }}>
                      <Typography variant="body2">{b.concept}</Typography>
                      <Typography variant="caption" color="text.secondary">{b.detail}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ border: 0, py: 0.4, whiteSpace: 'nowrap' }}>{formatCOP(b.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell sx={{ border: 0, py: 0.4 }}><Typography variant="body2">Subtotal</Typography></TableCell>
                  <TableCell align="right" sx={{ border: 0, py: 0.4 }}>{formatCOP(result.subtotal)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ border: 0, py: 0.4 }}><Typography variant="body2">IVA ({Math.round(result.taxRate * 100)}%)</Typography></TableCell>
                  <TableCell align="right" sx={{ border: 0, py: 0.4 }}>{formatCOP(result.tax)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary">{result.note}</Typography>
          </Box>
        </Collapse>
      )}
    </Paper>
  );
};
