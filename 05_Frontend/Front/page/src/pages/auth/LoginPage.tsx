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
  InputAdornment,
  IconButton,
  Divider,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { AuthLayout } from '../../components/AuthLayout';

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

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Aquí irá la lógica de autenticación
      console.log('Iniciando sesión con:', formData);

      // Simulación de llamada API
      await new Promise(resolve => setTimeout(resolve, 1000));

      // TODO: Implementar la lógica de autenticación real
      alert('Login exitoso! (Implementar lógica real de autenticación)');

    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      setErrors({
        email: 'Credenciales inválidas. Por favor, verifica tus datos.'
      });
    } finally {
      setIsSubmitting(false);
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
              sx={{
                '& .MuiInputBase-input::placeholder': {
                  color: 'rgba(255, 255, 255, 0.5)',
                  opacity: 1,
                }
              }}
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
              sx={{
                '& .MuiInputBase-input::placeholder': {
                  color: 'rgba(255, 255, 255, 0.5)',
                  opacity: 1,
                }
              }}
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
                disabled={isSubmitting}
                sx={{
                  cursor: 'pointer',
                  color: 'info.main',
                  textDecoration: 'none',
                  '&:hover': {
                    textShadow: '0 0 10px rgba(0, 195, 255, 0.6)',
                  }
                }}
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
              sx={{
                mt: 1,
                mb: 2,
                boxShadow: '0 0 20px rgba(0, 195, 255, 0.3)',
                '&:hover': {
                  boxShadow: '0 0 35px rgba(0, 195, 255, 0.6)',
                  transform: 'translateY(-2px)',
                }
              }}
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
              sx={{
                borderColor: 'info.main',
                color: 'info.main',
                '&:hover': {
                  borderColor: 'info.light',
                  boxShadow: '0 0 20px rgba(0, 195, 255, 0.4)',
                  backgroundColor: 'rgba(0, 195, 255, 0.05)',
                }
              }}
            >
              Crear cuenta
            </Button>
          </Box>
        </Paper>
    </AuthLayout>
  );
};
