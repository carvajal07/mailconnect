import { useEffect, useState } from 'react';
import {
  Paper, Stack, Typography, Button, TextField, Box, Chip, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert,
} from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import QRCode from 'qrcode';
import { totpService } from '../../services/totpService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

/**
 * Tarjeta de SEGUNDO FACTOR (2FA TOTP) en "Mi cuenta" (Bloque I). Enrolamiento con QR
 * (código de una app como Google Authenticator/Authy), activación con el primer código,
 * códigos de respaldo (se muestran una vez) y desactivación con un código válido.
 */
export const TwoFactorCard = () => {
  const { notify, FeedbackSnackbar } = useFeedback();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  // Enrolamiento.
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');

  // Códigos de respaldo (tras activar).
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Desactivación (aviso + código en el MISMO diálogo).
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const loadStatus = () => {
    setLoading(true);
    totpService.status()
      .then((res) => { if (isOk(res)) setEnabled(Boolean(res.data?.enabled)); })
      .finally(() => setLoading(false));
  };
  useEffect(loadStatus, []);

  const startEnroll = async () => {
    setBusy(true);
    const res = await totpService.enroll();
    setBusy(false);
    if (!isOk(res) || !res.data?.otpauthUri) {
      notify(res.description || 'No se pudo iniciar la configuración del 2FA.', 'error');
      return;
    }
    setSecret(res.data.secret);
    setCode('');
    try {
      const url = await QRCode.toDataURL(res.data.otpauthUri, { margin: 1, width: 200 });
      setQrDataUrl(url);
    } catch {
      setQrDataUrl(''); // sin QR: el usuario ingresa el secreto manualmente
    }
    setEnrollOpen(true);
  };

  const activate = async () => {
    if (!code.trim()) return notify('Ingresa el código de 6 dígitos.', 'warning');
    setBusy(true);
    const res = await totpService.activate(code.trim());
    setBusy(false);
    if (!isOk(res)) {
      notify(res.description || 'El código no es válido.', 'error');
      return;
    }
    setEnrollOpen(false);
    setEnabled(true);
    setBackupCodes(res.data?.backupCodes || []);
    notify('Segundo factor activado.', 'success');
  };

  /**
   * Desactivar el 2FA en UN solo diálogo.
   *
   * Antes eran dos seguidos para una sola acción: un aviso de confirmación y detrás el
   * `window.prompt` del navegador pidiendo el código. El aviso ahora vive DENTRO del mismo
   * diálogo que pide el código, que es donde tiene sentido leerlo.
   */
  const disable = () => { setDisableCode(''); setDisableOpen(true); };

  const confirmDisable = async () => {
    const entered = disableCode.trim();
    if (!entered) return;
    setBusy(true);
    const res = await totpService.disable(entered);
    setBusy(false);
    if (isOk(res)) {
      setDisableOpen(false);
      setEnabled(false);
      notify('Segundo factor desactivado.', 'success');
    } else {
      // El diálogo se queda ABIERTO: un código errado es lo normal (el TOTP rota cada 30 s)
      // y cerrarlo obligaría a empezar de nuevo.
      notify(res.description || 'No se pudo desactivar. ¿El código es correcto?', 'error');
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" mb={1}>
        <SecurityIcon color="primary" />
        <Typography variant="h6">Verificación en dos pasos (2FA)</Typography>
        {!loading && (
          <Chip size="small" color={enabled ? 'success' : 'default'}
            label={enabled ? 'Activado' : 'Desactivado'} variant={enabled ? 'filled' : 'outlined'} />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Añade una capa extra: al iniciar sesión pediremos un código temporal de tu app de
        autenticación (Google Authenticator, Authy, 1Password…).
      </Typography>

      {loading ? (
        <CircularProgress size={22} />
      ) : enabled ? (
        <Button variant="outlined" color="error" onClick={disable} disabled={busy}>
          {busy ? <CircularProgress size={20} /> : 'Desactivar 2FA'}
        </Button>
      ) : (
        <Button variant="contained" onClick={startEnroll} disabled={busy}>
          {busy ? <CircularProgress size={20} color="inherit" /> : 'Activar 2FA'}
        </Button>
      )}

      {/* Enrolamiento: QR + código */}
      <Dialog open={enrollOpen} onClose={() => setEnrollOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Configurar 2FA</DialogTitle>
        <DialogContent>
          <Stack spacing={2} alignItems="center" sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Escanea este código con tu app de autenticación:
            </Typography>
            {qrDataUrl
              ? <Box component="img" src={qrDataUrl} alt="Código QR 2FA" sx={{ width: 200, height: 200 }} />
              : <Alert severity="info">No se pudo generar el QR. Ingresa el código manualmente.</Alert>}
            <Box sx={{ width: '100%' }}>
              <Typography variant="caption" color="text.secondary">¿No puedes escanear? Ingresa esta clave:</Typography>
              <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, wordBreak: 'break-all' }}>{secret}</Typography>
            </Box>
            <TextField
              fullWidth
              label="Código de 6 dígitos"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputProps={{ inputMode: 'numeric', maxLength: 6 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnrollOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={activate} disabled={busy}>
            {busy ? <CircularProgress size={20} color="inherit" /> : 'Activar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Códigos de respaldo (una sola vez) */}
      <Dialog open={backupCodes !== null} onClose={() => setBackupCodes(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Guarda tus códigos de respaldo</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Guárdalos en un lugar seguro. Cada uno sirve UNA vez para entrar si pierdes acceso a
            tu app. No se volverán a mostrar.
          </Alert>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, fontFamily: 'monospace', fontSize: 15 }}>
              {(backupCodes || []).map((c) => <Box key={c}>{c}</Box>)}
            </Box>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            navigator.clipboard?.writeText((backupCodes || []).join('\n')).catch(() => {});
            notify('Códigos copiados.', 'success');
          }}>Copiar</Button>
          <Button variant="contained" onClick={() => setBackupCodes(null)}>Ya los guardé</Button>
        </DialogActions>
      </Dialog>

      {/* Desactivar: el aviso y el código, juntos (antes eran dos diálogos encadenados) */}
      <Dialog open={disableOpen} onClose={() => setDisableOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Desactivar segundo factor</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Tu cuenta quedará protegida <strong>solo con la contraseña</strong>.
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Para confirmar que eres tú, ingresa un código de tu app de autenticación (o uno de
            respaldo).
          </Typography>
          <TextField
            autoFocus fullWidth label="Código de verificación" placeholder="123456"
            value={disableCode} onChange={(e) => setDisableCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && disableCode.trim() && !busy) confirmDisable(); }}
            // Sin `maxLength` de 6: un código de RESPALDO es más largo que un TOTP y con el
            // tope no se podría pegar completo.
            inputProps={{ autoComplete: 'one-time-code' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisableOpen(false)}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={confirmDisable}
            disabled={busy || !disableCode.trim()}>
            {busy ? <CircularProgress size={20} color="inherit" /> : 'Desactivar'}
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Paper>
  );
};
