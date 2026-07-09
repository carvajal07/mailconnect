import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Link,
  Alert,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { ArrowBack, Visibility, VisibilityOff } from '@mui/icons-material';
import { AuthLayout } from '../../components/AuthLayout';
import { authService } from '../../services/authService';
import {
  authCardSx,
  authTitleSx,
  authSubmitSx,
  authLinkSx,
  authBackButtonSx,
} from '../../theme/authStyles';

interface LocationState {
  email?: string;
}

/**
 * Pantalla de reseteo de contraseña con OTP.
 * El usuario llega aquí desde "Recuperar contraseña" (ForgotPasswordPage), que
 * dispara el envío de un código al correo. Aquí ingresa ese código + la nueva
 * contraseña; se llama a /change-password con { user, password, otp }.
 */
export const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillEmail = (location.state as LocationState | null)?.email ?? '';

  const [email, setEmail] = useState(prefillEmail);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reglas de contraseña alineadas con el backend (change-password).
  const validatePassword = (pwd: string): string | undefined => {
    if (!pwd) return 'La contraseña es requerida';
    if (pwd.length < 8) return 'Debe tener al menos 8 caracteres';
    if (!/[a-z]/.test(pwd)) return 'Debe incluir al menos una minúscula';
    if (!/[A-Z]/.test(pwd)) return 'Debe incluir al menos una mayúscula';
    if (!/\d/.test(pwd)) return 'Debe incluir al menos un número';
    return undefined;
  };

  const validate = (): string | undefined => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) return 'El correo electrónico no es válido';
    if (!/^\d{6}$/.test(otp.trim())) return 'El código debe tener 6 dígitos';
    const pwdError = validatePassword(password);
    if (pwdError) return pwdError;
    if (password !== confirmPassword) return 'Las contraseñas no coinciden';
    return undefined;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await authService.changePassword(email, password, Number(otp.trim()));

      if (res.status || res.statusCode === 200) {
        setSuccessMessage('¡Contraseña actualizada! Ya puedes iniciar sesión con tu nueva contraseña.');
        setTimeout(() => navigate('/login'), 1500);
      } else if (res.statusCode === 0) {
        setError(res.description);
      } else if (res.statusCode === 401 || res.statusCode === 410) {
        setError('El código es inválido o expiró. Solicita uno nuevo.');
      } else if (res.statusCode === 400) {
        setError(res.description || 'La contraseña no cumple los requisitos mínimos.');
      } else if (res.statusCode === 404) {
        setError('No encontramos una cuenta con ese correo.');
      } else {
        setError(res.description || 'No fue posible actualizar la contraseña. Intenta nuevamente.');
      }
    } catch (err) {
      console.error('Error al restablecer la contraseña:', err);
      setError('Hubo un error al procesar la solicitud. Por favor, intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <Paper elevation={6} sx={authCardSx}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate('/forgot-password')}
          sx={authBackButtonSx}
        >
          Solicitar otro código
        </Button>

        <Typography
          variant="h4"
          component="h1"
          gutterBottom
          align="center"
          fontWeight="bold"
          sx={authTitleSx}
        >
          Restablecer Contraseña
        </Typography>
        <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
          Ingresa el código de 6 dígitos que enviamos a tu correo y define tu nueva contraseña
        </Typography>

        {successMessage && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {successMessage}
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <TextField
            fullWidth
            label="Correo electrónico"
            name="email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
            disabled={isSubmitting || !!successMessage}
            margin="normal"
            placeholder="tu@email.com"
            required
            autoFocus={!prefillEmail}
          />

          <TextField
            fullWidth
            label="Código de verificación"
            name="otp"
            value={otp}
            onChange={(e) => {
              const onlyDigits = e.target.value.replace(/\D/g, '').slice(0, 6);
              setOtp(onlyDigits);
              if (error) setError('');
            }}
            disabled={isSubmitting || !!successMessage}
            margin="normal"
            placeholder="123456"
            required
            autoFocus={!!prefillEmail}
            inputProps={{ inputMode: 'numeric', maxLength: 6, style: { letterSpacing: '0.4em' } }}
          />

          <TextField
            fullWidth
            label="Nueva contraseña"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
            disabled={isSubmitting || !!successMessage}
            margin="normal"
            required
            helperText="Mínimo 8 caracteres, con mayúscula, minúscula y número"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword((s) => !s)} edge="end">
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <TextField
            fullWidth
            label="Confirmar nueva contraseña"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(''); }}
            disabled={isSubmitting || !!successMessage}
            margin="normal"
            required
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={isSubmitting || !!successMessage}
            sx={authSubmitSx}
          >
            {isSubmitting ? 'Actualizando...' : 'Restablecer contraseña'}
          </Button>
        </form>

        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            ¿Recordaste tu contraseña?{' '}
            <Link
              component="button"
              variant="body2"
              onClick={() => navigate('/login')}
              sx={authLinkSx}
            >
              Inicia sesión aquí
            </Link>
          </Typography>
        </Box>
      </Paper>
    </AuthLayout>
  );
};
