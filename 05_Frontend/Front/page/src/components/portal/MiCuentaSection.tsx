import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  Divider,
  Avatar,
  CircularProgress,
} from '@mui/material';
import LockResetIcon from '@mui/icons-material/LockReset';
import { getUser, authService } from '../../services/authService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

/** Reglas de contraseña alineadas con el backend (change-password). */
const validatePassword = (pwd: string): string | undefined => {
  if (pwd.length < 8) return 'Mínimo 8 caracteres';
  if (!/[a-z]/.test(pwd)) return 'Falta una minúscula';
  if (!/[A-Z]/.test(pwd)) return 'Falta una mayúscula';
  if (!/\d/.test(pwd)) return 'Falta un número';
  return undefined;
};

export const MiCuentaSection = () => {
  const user = getUser();
  const { notify, FeedbackSnackbar } = useFeedback();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  const handleChangePassword = async () => {
    if (!user?.email) {
      notify('No hay una sesión activa.', 'error');
      return;
    }
    const err = validatePassword(password);
    if (err) return notify(err, 'warning');
    if (password !== confirm) return notify('Las contraseñas no coinciden.', 'warning');

    setSubmitting(true);
    // Sin OTP → change-password usa el token de sesión (Authorization: Bearer).
    const res = await authService.changePassword(user.email, password);
    setSubmitting(false);

    if (isOk(res)) {
      notify('Contraseña actualizada correctamente.', 'success');
      setPassword('');
      setConfirm('');
    } else {
      notify(res.description || 'No se pudo actualizar la contraseña.', 'error');
    }
  };

  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Mi cuenta
      </Typography>

      <Stack spacing={3} sx={{ maxWidth: 640 }}>
        {/* Datos del perfil */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} alignItems="center" mb={2}>
            <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56, fontSize: 24 }}>
              {initial}
            </Avatar>
            <Box>
              <Typography variant="h6">{user?.name || '—'}</Typography>
              <Typography color="text.secondary">{user?.customer || 'Empresa'}</Typography>
            </Box>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Stack spacing={1}>
            <Row label="Correo" value={user?.email} />
            <Row label="User ID" value={user?.userId} />
            <Row label="Empresa" value={user?.customer} />
          </Stack>
        </Paper>

        {/* Cambio de contraseña */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <LockResetIcon color="primary" />
            <Typography variant="h6">Cambiar contraseña</Typography>
          </Stack>
          <Stack spacing={2}>
            <TextField
              fullWidth
              type="password"
              label="Nueva contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="Mínimo 8 caracteres, con mayúscula, minúscula y número"
              disabled={submitting}
            />
            <TextField
              fullWidth
              type="password"
              label="Confirmar contraseña"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={submitting}
            />
            <Box>
              <Button
                variant="contained"
                onClick={handleChangePassword}
                disabled={submitting || !password || !confirm}
              >
                {submitting ? <CircularProgress size={22} /> : 'Actualizar contraseña'}
              </Button>
            </Box>
          </Stack>
        </Paper>
      </Stack>

      {FeedbackSnackbar}
    </Box>
  );
};

const Row = ({ label, value }: { label: string; value?: string }) => (
  <Stack direction="row" spacing={2}>
    <Typography sx={{ minWidth: 100, color: 'text.secondary' }}>{label}:</Typography>
    <Typography sx={{ fontWeight: 500, wordBreak: 'break-all' }}>{value || '—'}</Typography>
  </Stack>
);
