import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

/**
 * Estilos compartidos y "theme-aware" para las páginas de autenticación
 * (login, registro, recuperación, reseteo).
 *
 * En modo OSCURO conservan el look cyberpunk con "glow" cyan; en modo CLARO
 * usan bordes y sombras neutras estándar. Así ambos temas lucen bien sin colores
 * hardcodeados "dark-only" repartidos por los componentes.
 */

/** Tarjeta contenedora (Paper) de cada formulario de auth. */
export const authCardSx = (theme: Theme): SystemStyleObject<Theme> => {
  const isDark = theme.palette.mode === 'dark';
  const glow = theme.palette.info.main;
  return {
    p: 4,
    width: '100%',
    backgroundColor: 'background.paper',
    border: '1px solid',
    borderColor: isDark ? alpha(glow, 0.3) : theme.palette.divider,
    boxShadow: isDark ? `0 0 40px ${alpha(glow, 0.2)}` : theme.shadows[3],
    transition: 'all 0.3s ease',
    '&:hover': {
      borderColor: isDark ? glow : theme.palette.primary.main,
      boxShadow: isDark ? `0 0 60px ${alpha(glow, 0.4)}` : theme.shadows[6],
      transform: 'translateY(-4px)',
    },
  };
};

/** Título principal del formulario. */
export const authTitleSx = (theme: Theme): SystemStyleObject<Theme> => {
  const isDark = theme.palette.mode === 'dark';
  return {
    color: isDark ? theme.palette.info.main : theme.palette.primary.main,
    textShadow: isDark ? `0 0 20px ${alpha(theme.palette.info.main, 0.6)}` : 'none',
    mb: 2,
  };
};

/** Botón de envío del formulario. */
export const authSubmitSx = (theme: Theme): SystemStyleObject<Theme> => {
  const isDark = theme.palette.mode === 'dark';
  const glow = theme.palette.info.main;
  return {
    mt: 3,
    mb: 2,
    boxShadow: isDark ? `0 0 20px ${alpha(glow, 0.3)}` : undefined,
    '&:hover': {
      boxShadow: isDark ? `0 0 35px ${alpha(glow, 0.6)}` : undefined,
      transform: 'translateY(-2px)',
    },
  };
};

/** Enlaces (¿olvidaste tu contraseña?, inicia sesión, regístrate). */
export const authLinkSx = (theme: Theme): SystemStyleObject<Theme> => {
  const isDark = theme.palette.mode === 'dark';
  return {
    cursor: 'pointer',
    color: isDark ? theme.palette.info.main : theme.palette.primary.main,
    textDecoration: 'none',
    '&:hover': {
      textShadow: isDark ? `0 0 10px ${alpha(theme.palette.info.main, 0.6)}` : 'none',
      textDecoration: isDark ? 'none' : 'underline',
    },
  };
};

/** Botón secundario "outlined" (p. ej. "Crear cuenta" en el login). */
export const authOutlinedButtonSx = (theme: Theme): SystemStyleObject<Theme> => {
  const isDark = theme.palette.mode === 'dark';
  const accent = isDark ? theme.palette.info.main : theme.palette.primary.main;
  return {
    borderColor: accent,
    color: accent,
    '&:hover': {
      borderColor: isDark ? theme.palette.info.light : theme.palette.primary.dark,
      backgroundColor: alpha(theme.palette.info.main, 0.05),
      boxShadow: isDark ? `0 0 20px ${alpha(theme.palette.info.main, 0.4)}` : undefined,
    },
  };
};

/** Botón "volver" / "solicitar otro código" (con icono). */
export const authBackButtonSx = (theme: Theme): SystemStyleObject<Theme> => {
  const isDark = theme.palette.mode === 'dark';
  const glow = theme.palette.info.main;
  return {
    mb: 2,
    color: isDark ? glow : theme.palette.primary.main,
    '&:hover': {
      backgroundColor: alpha(glow, 0.05),
      textShadow: isDark ? `0 0 10px ${alpha(glow, 0.6)}` : 'none',
    },
  };
};
