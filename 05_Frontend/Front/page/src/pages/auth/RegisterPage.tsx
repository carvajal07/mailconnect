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
  InputAdornment,
  IconButton,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { AuthLayout } from '../../components/AuthLayout';
import { authService } from '../../services/authService';
import {
  authCardSx,
  authTitleSx,
  authSubmitSx,
  authLinkSx,
} from '../../theme/authStyles';

interface FormData {
  name: string;
  email: string;
  phone: string;
  company: string;
  companyTin: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  companyTin?: string;
  password?: string;
  confirmPassword?: string;
}

export const RegisterPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    phone: '',
    company: '',
    companyTin: '',
    password: '',
    confirmPassword: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [submitError, setSubmitError] = useState('');

  // Validaciones
  const validateName = (name: string): string | undefined => {
    if (!name.trim()) return 'El nombre es requerido';
    if (name.trim().length < 2) return 'El nombre debe tener al menos 2 caracteres';
    return undefined;
  };

  const validateEmail = (email: string): string | undefined => {
    if (!email) return 'El correo electrónico es requerido';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'El correo electrónico no es válido';
    return undefined;
  };

  const validatePhone = (phone: string): string | undefined => {
    if (!phone) return 'El teléfono es requerido';
    if (!/^[0-9]+$/.test(phone)) return 'El teléfono debe contener solo números';
    return undefined;
  };

  const validateCompany = (company: string): string | undefined => {
    if (!company.trim()) return 'La empresa es requerida';
    if (company.trim().length < 2) return 'La empresa debe tener al menos 2 caracteres';
    return undefined;
  };

  const validateCompanyTin = (companyTin: string): string | undefined => {
    if (!companyTin) return 'El NIT es requerido';
    if (!/^[0-9]+$/.test(companyTin)) return 'El NIT debe contener solo números';
    return undefined;
  };

  const validatePassword = (password: string): string | undefined => {
    if (!password) return 'La contraseña es requerida';
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
    if (!/(?=.*[a-z])/.test(password)) return 'Debe contener al menos una letra minúscula';
    if (!/(?=.*[A-Z])/.test(password)) return 'Debe contener al menos una letra mayúscula';
    if (!/(?=.*\d)/.test(password)) return 'Debe contener al menos un número';
    return undefined;
  };

  const validateConfirmPassword = (password: string, confirmPassword: string): string | undefined => {
    if (!confirmPassword) return 'Confirma tu contraseña';
    if (password !== confirmPassword) return 'Las contraseñas no coinciden';
    return undefined;
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {
      name: validateName(formData.name),
      email: validateEmail(formData.email),
      phone: validatePhone(formData.phone),
      company: validateCompany(formData.company),
      companyTin: validateCompanyTin(formData.companyTin),
      password: validatePassword(formData.password),
      confirmPassword: validateConfirmPassword(formData.password, formData.confirmPassword),
    };

    setErrors(newErrors);
    return !Object.values(newErrors).some(error => error !== undefined);
  };

  const handleChange = (field: keyof FormData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = event.target.value;
    setSubmitError('');
    setFormData(prev => ({ ...prev, [field]: value }));

    // Validar en tiempo real
    let error: string | undefined;
    switch (field) {
      case 'name': error = validateName(value); break;
      case 'email': error = validateEmail(value); break;
      case 'phone': error = validatePhone(value); break;
      case 'company': error = validateCompany(value); break;
      case 'companyTin': error = validateCompanyTin(value); break;
      case 'password':
        error = validatePassword(value);
        if (formData.confirmPassword) {
          setErrors(prev => ({
            ...prev,
            confirmPassword: validateConfirmPassword(value, formData.confirmPassword),
          }));
        }
        break;
      case 'confirmPassword':
        error = validateConfirmPassword(formData.password, value);
        break;
    }

    setErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);
    setSuccessMessage('');
    setSubmitError('');

    try {
      const res = await authService.register({
        name: formData.name.trim(),
        phone: formData.phone,
        email: formData.email,
        company: formData.company.trim(),
        companyTin: Number(formData.companyTin),
        password: formData.password,
      });

      if (res.status && (res.statusCode === 201 || res.statusCode === 200)) {
        setSuccessMessage('¡Cuenta creada! Revisa tu correo para activarla y luego inicia sesión.');
        setTimeout(() => navigate('/login'), 2500);
        return;
      }

      const msg =
        res.statusCode === 409 ? 'Este correo ya está registrado. Intenta iniciar sesión.'
        : res.statusCode === 400 ? 'Algunos datos no son válidos. Revisa el formulario.'
        : res.statusCode === 0 ? res.description
        : (res.description || 'No fue posible completar el registro. Intenta nuevamente.');
      setSubmitError(msg);

    } catch (error) {
      console.error('Error al registrar:', error);
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
            Crear Cuenta
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            align="center"
            sx={{ mb: 3 }}
          >
            Completa el formulario para registrarte
          </Typography>

          {successMessage && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {successMessage}
            </Alert>
          )}
          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <TextField
              fullWidth
              label="Nombre completo"
              name="name"
              value={formData.name}
              onChange={handleChange('name')}
              error={!!errors.name}
              helperText={errors.name}
              disabled={isSubmitting}
              margin="normal"
              required
              placeholder="Juan Pérez"            />

            <TextField
              fullWidth
              label="Correo electrónico"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange('email')}
              error={!!errors.email}
              helperText={errors.email}
              disabled={isSubmitting}
              margin="normal"
              required
              placeholder="tu@email.com"            />

            <TextField
              fullWidth
              label="Teléfono"
              name="phone"
              value={formData.phone}
              onChange={handleChange('phone')}
              error={!!errors.phone}
              helperText={errors.phone}
              disabled={isSubmitting}
              margin="normal"
              required
              placeholder="3001234567"
              inputProps={{ inputMode: 'numeric' }}            />

            <TextField
              fullWidth
              label="Empresa"
              name="company"
              value={formData.company}
              onChange={handleChange('company')}
              error={!!errors.company}
              helperText={errors.company}
              disabled={isSubmitting}
              margin="normal"
              required
              placeholder="Mi Empresa S.A.S."            />

            <TextField
              fullWidth
              label="NIT (sin dígito de verificación)"
              name="companyTin"
              value={formData.companyTin}
              onChange={handleChange('companyTin')}
              error={!!errors.companyTin}
              helperText={errors.companyTin}
              disabled={isSubmitting}
              margin="normal"
              required
              placeholder="900123456"
              inputProps={{ inputMode: 'numeric' }}            />

            <TextField
              fullWidth
              label="Contraseña"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange('password')}
              error={!!errors.password}
              helperText={errors.password}
              disabled={isSubmitting}
              margin="normal"
              required
              placeholder="••••••••"              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                      disabled={isSubmitting}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="Confirmar contraseña"
              name="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={handleChange('confirmPassword')}
              error={!!errors.confirmPassword}
              helperText={errors.confirmPassword}
              disabled={isSubmitting}
              margin="normal"
              required
              placeholder="••••••••"              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      edge="end"
                      disabled={isSubmitting}
                    >
                      {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={isSubmitting}
              sx={authSubmitSx}
            >
              {isSubmitting ? 'Registrando...' : 'Crear Cuenta'}
            </Button>
          </form>

          <Box sx={{ textAlign: 'center', mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              ¿Ya tienes una cuenta?{' '}
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
