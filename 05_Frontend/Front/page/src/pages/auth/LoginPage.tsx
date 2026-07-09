import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  TextField,
  Button,
  Typography,
  Link,
  InputAdornment,
  IconButton,
  Divider,
  Box,
  Alert,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { AuthLayout } from '../../components/AuthLayout';
import { authService, saveSession } from '../../services/authService';
import { MOCK_ENABLED, DEMO_CREDENTIALS } from '../../services/mockAuth';
import {
  authCardSx,
  authTitleSx,
  authSubmitSx,
  authLinkSx,
  authOutlinedButtonSx,
} from '../../theme/authStyles';

interface FormErrors {
  email?: string;
  password?: string;
}

interface FormData {
  email: string;
  password: string;
}

export const LoginPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: ''
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Validación de email
  const validateEmail = (email: string): string | undefined => {
    if (!email) {
      return 'El correo electrónico es requerido';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return 'El correo electrónico no es válido';
    }
    return undefined;
  };

  // Validación de contraseña
  const validatePassword = (password: string): string | undefined => {
    if (!password) {
      return 'La contraseña es requerida';
    }
    if (password.length < 8) {
      return 'La contraseña debe tener al menos 8 caracteres';
    }
    return undefined;
  };

  // Validar formulario completo
  const validateForm = (): boolean => {
    const newErrors: FormErrors = {
      email: validateEmail(formData.email),
      password: validatePassword(formData.password)
    };

    setErrors(newErrors);
    return !newErrors.email && !newErrors.password;
  };

  // Manejar cambios en los inputs
  const handleChange = (field: keyof FormData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = event.target.value;
    setSubmitError('');

    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    // Validar en tiempo real si el campo ya fue tocado
    if (touched[field]) {
      const error = field === 'email'
        ? validateEmail(value)
        : validatePassword(value);

      setErrors(prev => ({
        ...prev,
        [field]: error
      }));
    }
  };

  // Manejar cuando el usuario sale de un campo
  const handleBlur = (field: 'email' | 'password') => () => {
    setTouched(prev => ({
      ...prev,
      [field]: true
    }));

    const error = field === 'email'
      ? validateEmail(formData[field])
      : validatePassword(formData[field]);

    setErrors(prev => ({
      ...prev,
      [field]: error
    }));
  };

  // Manejar el envío del formulario
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Marcar todos los campos como tocados
    setTouched({ email: true, password: true });
    setSubmitError('');

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await authService.login(formData.email, formData.password);

      if (res.status && res.statusCode === 200 && res.data) {
        // Guardar sesión (token + datos del usuario) y entrar al portal del cliente
        saveSession(res.data.token, {
          userId: res.data.userId,
          name: res.data.name,
          customer: res.data.customer,
          email: formData.email,
        });
        navigate('/panel');
        return;
      }

      // Mapear los códigos de error del backend a mensajes claros
      const msg =
        res.statusCode === 404 ? 'Usuario o contraseña incorrectos.'
        : res.statusCode === 423 ? 'Tu cuenta aún no está activada. Revisa tu correo para activarla.'
        : res.statusCode === 400 ? 'Tu usuario está bloqueado. Contacta a soporte.'
        : res.statusCode === 0 ? res.description
        : (res.description || 'No fue posible iniciar sesión. Intenta nuevamente.');
      setSubmitError(msg);

    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      setSubmitError('Ocurrió un error inesperado. Por favor, intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <Paper elevation={6} sx={authCardSx}>
          <Typography
            variant="h4"
            component="h1"
            gutterBottom
            align="center"
            fontWeight="bold"
            sx={authTitleSx}
          >
            Iniciar Sesión
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            align="center"
            sx={{ mb: 3 }}
          >
            Ingresa tus credenciales para acceder
          </Typography>

          {MOCK_ENABLED && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Modo demo activo: puedes entrar con cualquier credencial. Sugerida{' '}
              <strong>{DEMO_CREDENTIALS.email}</strong> / <strong>{DEMO_CREDENTIALS.password}</strong>.
            </Alert>
          )}

          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {/* Campo de Email */}
            <TextField
              fullWidth
              label="Correo Electrónico"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange('email')}
              onBlur={handleBlur('email')}
              error={!!errors.email && touched.email}
              helperText={touched.email ? errors.email : ''}
              disabled={isSubmitting}
              margin="normal"
              placeholder="tu@email.com"
              required
              autoComplete="email"
            />

            {/* Campo de Contraseña */}
            <TextField
              fullWidth
              label="Contraseña"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange('password')}
              onBlur={handleBlur('password')}
              error={!!errors.password && touched.password}
              helperText={touched.password ? errors.password : ''}
              disabled={isSubmitting}
              margin="normal"
              placeholder="••••••••"
              required
              autoComplete="current-password"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      onMouseDown={(e) => e.preventDefault()}
                      edge="end"
                      disabled={isSubmitting}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            {/* Enlace de recuperar contraseña */}
            <Box sx={{ textAlign: 'right', mt: 1, mb: 2 }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => navigate('/forgot-password')}
                sx={authLinkSx}
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </Box>

            {/* Botón de Submit */}
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={isSubmitting}
              sx={authSubmitSx}
            >
              {isSubmitting ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </Button>
          </form>

          {/* Divider */}
          <Divider sx={{ my: 3 }} />

          {/* Sección de registro */}
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              ¿No tienes una cuenta?
            </Typography>
            <Button
              fullWidth
              variant="outlined"
              size="large"
              onClick={() => navigate('/register')}
              disabled={isSubmitting}
              sx={authOutlinedButtonSx}
            >
              Crear cuenta
            </Button>
          </Box>
        </Paper>
    </AuthLayout>
  );
};
