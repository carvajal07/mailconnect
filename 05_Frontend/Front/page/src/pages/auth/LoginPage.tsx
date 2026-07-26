import React, { useState, useEffect } from 'react';
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
import { authService, saveSession, consumeLogoutReason } from '../../services/authService';
import type { LoginData } from '../../services/authService';
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
  const [sessionNotice, setSessionNotice] = useState('');
  // 2FA: si el login lo requiere, se guarda el desafío y se pide el código de 6 dígitos.
  const [twofaChallenge, setTwofaChallenge] = useState<string | null>(null);
  const [twofaCode, setTwofaCode] = useState('');

  // Aviso cuando la sesión se cerró sola (token vencido o inactividad).
  useEffect(() => {
    const reason = consumeLogoutReason();
    if (reason === 'expired') setSessionNotice('Tu sesión expiró. Inicia sesión nuevamente.');
    if (reason === 'inactive') setSessionNotice('Cerramos tu sesión por inactividad. Inicia sesión nuevamente.');
  }, []);

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

  // Guarda la sesión y entra al portal (o /admin para el personal interno).
  const finishLogin = (data: LoginData) => {
    saveSession(data.token, {
      userId: data.userId,
      name: data.name,
      customer: data.customer,
      customerId: data.customerId,
      nit: data.companyTin,
      realSendEnabled: data.realSendEnabled,
      role: data.role,
      tenantRole: data.tenantRole,
      featureFlags: data.featureFlags,
      email: formData.email,
    });
    navigate(data.role === 'admin' ? '/admin' : '/panel');
  };

  // Segundo paso del login con 2FA: canjea el desafío + el código por el token real.
  const handleVerify2fa = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!twofaChallenge) return;
    const code = twofaCode.trim();
    if (!code) {
      setSubmitError('Ingresa el código de tu app de autenticación.');
      return;
    }
    setSubmitError('');
    setIsSubmitting(true);
    try {
      const res = await authService.verify2fa(twofaChallenge, code);
      if (res.status && res.statusCode === 200 && res.data?.token) {
        finishLogin(res.data);
        return;
      }
      if (res.statusCode === 429 || res.statusCode === 401) {
        // Desafío vencido / demasiados intentos → volver a pedir la contraseña.
        if (res.statusCode === 429) {
          setTwofaChallenge(null);
        }
        setSubmitError(res.description || 'Código incorrecto.');
      } else {
        setSubmitError(res.description || 'No se pudo verificar el código.');
      }
    } catch {
      setSubmitError('Ocurrió un error inesperado. Intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelTwofa = () => {
    setTwofaChallenge(null);
    setTwofaCode('');
    setSubmitError('');
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
        // 2FA: si el usuario tiene segundo factor, el login NO trae token; pide el código.
        if (res.data.twofaRequired && res.data.challenge) {
          setTwofaChallenge(res.data.challenge);
          setTwofaCode('');
          setIsSubmitting(false);
          return;
        }
        finishLogin(res.data);
        return;
      }

      // Mapear los códigos de error del backend a mensajes claros. En el 404 se
      // prefiere la descripción del backend: puede traer el aviso de "te queda 1
      // intento antes del bloqueo". El 429 es el bloqueo temporal por intentos.
      const msg =
        res.statusCode === 404 ? (res.description || 'Usuario o contraseña incorrectos.')
        : res.statusCode === 423 ? 'Tu cuenta aún no está activada. Revisa tu correo para activarla.'
        : res.statusCode === 429 ? (res.description || 'Cuenta bloqueada temporalmente por intentos fallidos.')
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

          {sessionNotice && (
            <Alert severity="info" sx={{ mb: 2 }} onClose={() => setSessionNotice('')}>
              {sessionNotice}
            </Alert>
          )}

          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}

          {/* Segundo factor (2FA): pantalla de código, tras la contraseña correcta */}
          {twofaChallenge ? (
            <form onSubmit={handleVerify2fa} noValidate>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Ingresa el código de 6 dígitos de tu app de autenticación (o un código de
                respaldo).
              </Typography>
              <TextField
                fullWidth
                autoFocus
                label="Código de verificación"
                value={twofaCode}
                onChange={(e) => { setTwofaCode(e.target.value); setSubmitError(''); }}
                disabled={isSubmitting}
                margin="normal"
                placeholder="123456"
                inputProps={{ inputMode: 'text', autoComplete: 'one-time-code', maxLength: 9 }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isSubmitting}
                sx={{ ...authSubmitSx, mt: 2 }}
              >
                {isSubmitting ? 'Verificando...' : 'Verificar e ingresar'}
              </Button>
              <Box sx={{ textAlign: 'center', mt: 2 }}>
                <Link component="button" type="button" variant="body2" onClick={cancelTwofa} sx={authLinkSx}>
                  Volver a iniciar sesión
                </Link>
              </Box>
            </form>
          ) : (
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
          )}

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
