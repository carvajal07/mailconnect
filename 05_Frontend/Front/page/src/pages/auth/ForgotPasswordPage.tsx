import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Link,
  Alert,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { AuthLayout } from '../../components/AuthLayout';
import { authService } from '../../services/authService';
import {
  authCardSx,
  authTitleSx,
  authSubmitSx,
  authLinkSx,
  authBackButtonSx,
} from '../../theme/authStyles';

export const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  // Tras solicitar el código NO saltamos solos a otra pantalla (era confuso): mostramos una
  // confirmación y el usuario decide continuar a ingresar el código.
  const [sent, setSent] = useState(false);

  const validateEmail = (email: string): string | undefined => {
    if (!email) return 'El correo electrónico es requerido';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'El correo electrónico no es válido';
    return undefined;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const validationError = validateEmail(email);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await authService.forgotPassword(email);

      if (res.status || res.statusCode === 200) {
        setSuccessMessage(
          'Si el correo está registrado, te enviamos un código para restablecer tu contraseña. Revisa tu bandeja de entrada.'
        );
        setSent(true);
      } else if (res.statusCode === 0) {
        setError(res.description);
      } else {
        setError(res.description || 'No fue posible procesar la solicitud. Intenta nuevamente.');
      }
    } catch (error) {
      console.error('Error al enviar recuperación:', error);
      setError('Hubo un error al enviar el correo. Por favor, intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (error) {
      setError('');
    }
  };

  return (
    <AuthLayout>
      <Paper elevation={6} sx={authCardSx}>
          <Button
            startIcon={<ArrowBack />}
            onClick={() => navigate('/login')}
            sx={authBackButtonSx}
          >
            Volver al login
          </Button>

          <Typography
            variant="h4"
            component="h1"
            gutterBottom
            align="center"
            fontWeight="bold"
            sx={authTitleSx}
          >
            Recuperar Contraseña
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            align="center"
            sx={{ mb: 3 }}
          >
            Ingresa tu correo electrónico y te enviaremos las instrucciones para restablecer tu contraseña
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {sent ? (
            /* Confirmación: el usuario decide cuándo continuar a ingresar el código. */
            <Box>
              <Alert severity="success" sx={{ mb: 3 }}>
                {successMessage}
              </Alert>
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={() => navigate('/reset-password', { state: { email } })}
                sx={authSubmitSx}
              >
                Ya tengo el código → Continuar
              </Button>
              <Button
                fullWidth
                variant="text"
                size="small"
                onClick={() => { setSent(false); setSuccessMessage(''); }}
                sx={{ mt: 1 }}
              >
                Usar otro correo / reenviar
              </Button>
            </Box>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <TextField
                fullWidth
                label="Correo electrónico"
                name="email"
                type="email"
                value={email}
                onChange={handleEmailChange}
                error={!!error}
                disabled={isSubmitting}
                margin="normal"
                placeholder="tu@email.com"
                required
                autoFocus
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isSubmitting}
                sx={authSubmitSx}
              >
                {isSubmitting ? 'Enviando...' : 'Enviar instrucciones'}
              </Button>
            </form>
          )}

          <Box sx={{ textAlign: 'center', mt: 3 }}>
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

          <Box sx={{ textAlign: 'center', mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              ¿No tienes una cuenta?{' '}
              <Link
                component="button"
                variant="body2"
                onClick={() => navigate('/register')}
                sx={authLinkSx}
              >
                Regístrate aquí
              </Link>
            </Typography>
          </Box>
        </Paper>
    </AuthLayout>
  );
};
