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

export const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

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
      // Simulación de llamada API
      console.log('Enviando email de recuperación a:', email);
      await new Promise(resolve => setTimeout(resolve, 1500));

      // TODO: Implementar lógica real de recuperación de contraseña
      setSuccessMessage(
        'Se ha enviado un enlace de recuperación a tu correo electrónico. Por favor, revisa tu bandeja de entrada.'
      );

      // Limpiar el formulario
      setEmail('');

    } catch (error) {
      console.error('Error al enviar email de recuperación:', error);
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
      <Paper
          elevation={6}
          sx={{
            p: 4,
            width: '100%',
            backgroundColor: 'background.paper',
            border: '2px solid',
            borderColor: 'rgba(74, 159, 184, 0.3)',
            boxShadow: '0 0 40px rgba(0, 195, 255, 0.2)',
            transition: 'all 0.3s ease',
            '&:hover': {
              borderColor: 'info.main',
              boxShadow: '0 0 60px rgba(0, 195, 255, 0.4)',
              transform: 'translateY(-4px)',
            }
          }}
        >
          <Button
            startIcon={<ArrowBack />}
            onClick={() => navigate('/login')}
            sx={{
              mb: 2,
              color: 'info.main',
              '&:hover': {
                backgroundColor: 'rgba(0, 195, 255, 0.05)',
                textShadow: '0 0 10px rgba(0, 195, 255, 0.6)',
              }
            }}
          >
            Volver al login
          </Button>

          <Typography
            variant="h4"
            component="h1"
            gutterBottom
            align="center"
            fontWeight="bold"
            sx={{
              color: 'info.main',
              textShadow: '0 0 20px rgba(0, 195, 255, 0.6)',
              mb: 2,
            }}
          >
            Recuperar Contraseña
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            align="center"
            sx={{ mb: 3 }}
          >
            Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña
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
              onChange={handleEmailChange}
              error={!!error && !successMessage}
              disabled={isSubmitting}
              margin="normal"
              placeholder="tu@email.com"
              required
              autoFocus
              sx={{
                '& .MuiInputBase-input::placeholder': {
                  color: 'rgba(255, 255, 255, 0.5)',
                  opacity: 1,
                }
              }}
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={isSubmitting}
              sx={{
                mt: 3,
                mb: 2,
                boxShadow: '0 0 20px rgba(0, 195, 255, 0.3)',
                '&:hover': {
                  boxShadow: '0 0 35px rgba(0, 195, 255, 0.6)',
                  transform: 'translateY(-2px)',
                }
              }}
            >
              {isSubmitting ? 'Enviando...' : 'Enviar Enlace de Recuperación'}
            </Button>
          </form>

          <Box sx={{ textAlign: 'center', mt: 3 }}>
            <Typography variant="body2" color="text.secondary">
              ¿Recordaste tu contraseña?{' '}
              <Link
                component="button"
                variant="body2"
                onClick={() => navigate('/login')}
                sx={{
                  cursor: 'pointer',
                  color: 'info.main',
                  textDecoration: 'none',
                  '&:hover': {
                    textShadow: '0 0 10px rgba(0, 195, 255, 0.6)',
                  }
                }}
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
                sx={{
                  cursor: 'pointer',
                  color: 'info.main',
                  textDecoration: 'none',
                  '&:hover': {
                    textShadow: '0 0 10px rgba(0, 195, 255, 0.6)',
                  }
                }}
              >
                Regístrate aquí
              </Link>
            </Typography>
          </Box>
        </Paper>
    </AuthLayout>
  );
};
