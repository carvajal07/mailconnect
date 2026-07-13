import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Paper, Button, Typography } from '@mui/material';
import { CheckCircleOutline, ErrorOutline, HourglassEmpty } from '@mui/icons-material';
import { AuthLayout } from '../../components/AuthLayout';
import { authCardSx, authTitleSx, authSubmitSx } from '../../theme/authStyles';

/**
 * Página de resultado de la activación de cuenta. La lambda Acount-activation redirige
 * aquí con ?estado=ok|error|expirado tras validar la clave del correo. Muestra un mensaje
 * claro (antes redirigía a la landing sin decir nada) y un botón para iniciar sesión.
 */
type Estado = 'ok' | 'error' | 'expirado';

const CONTENT: Record<Estado, { icon: React.ReactNode; title: string; message: string; color: string }> = {
  ok: {
    icon: <CheckCircleOutline sx={{ fontSize: 64 }} />,
    title: '¡Cuenta activada!',
    message: 'Tu cuenta quedó activada correctamente. Ya puedes iniciar sesión y empezar a usar MailConnect.',
    color: '#1fbf87',
  },
  expirado: {
    icon: <HourglassEmpty sx={{ fontSize: 64 }} />,
    title: 'El enlace expiró',
    message: 'El enlace de activación ya no es válido (expira a las 24 horas). Regístrate de nuevo o solicita el reenvío del correo de activación.',
    color: '#ff9d2e',
  },
  error: {
    icon: <ErrorOutline sx={{ fontSize: 64 }} />,
    title: 'No se pudo activar la cuenta',
    message: 'El enlace de activación no es válido o ya fue usado. Si tu cuenta ya está activa, inicia sesión normalmente.',
    color: '#ff5c72',
  },
};

export const AccountActivatedPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const raw = (params.get('estado') || 'ok').toLowerCase();
  const estado: Estado = raw === 'error' || raw === 'expirado' ? raw : 'ok';
  const c = CONTENT[estado];

  return (
    <AuthLayout>
      <Paper elevation={0} sx={{ ...authCardSx, textAlign: 'center' }}>
        <Box sx={{ color: c.color, display: 'flex', justifyContent: 'center', mb: 1 }}>{c.icon}</Box>
        <Typography variant="h4" sx={{ ...authTitleSx, mb: 1 }}>
          {c.title}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {c.message}
        </Typography>
        <Button fullWidth variant="contained" sx={authSubmitSx} onClick={() => navigate('/login')}>
          Iniciar sesión
        </Button>
      </Paper>
    </AuthLayout>
  );
};
