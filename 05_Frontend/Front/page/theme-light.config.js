import { createTheme } from '@mui/material/styles';

// Paleta de colores personalizada - Tema Claro/Profesional
export const colorPalette = {
  // Colores principales
  primary: {
    main: '#2C3E50',      // Azul oscuro elegante
    light: '#34495E',     // Azul oscuro claro
    dark: '#1A252F',      // Azul oscuro profundo
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: '#3498DB',      // Azul vibrante
    light: '#5DADE2',     // Azul claro
    dark: '#2874A6',      // Azul oscuro
    contrastText: '#FFFFFF',
  },
  
  // Colores de acento
  accent: {
    teal: '#1ABC9C',      // Verde azulado
    purple: '#9B59B6',    // Púrpura
    orange: '#E67E22',    // Naranja
    turquoise: '#16A085', // Turquesa
  },

  // Colores de estado
  success: {
    main: '#27AE60',      // Verde éxito
    light: '#2ECC71',     // Verde claro
    dark: '#1E8449',      // Verde oscuro
    contrastText: '#FFFFFF',
  },
  warning: {
    main: '#F39C12',      // Amarillo/Naranja advertencia
    light: '#F5B041',     // Amarillo claro
    dark: '#D68910',      // Naranja oscuro
    contrastText: '#000000',
  },
  error: {
    main: '#E74C3C',      // Rojo error
    light: '#EC7063',     // Rojo claro
    dark: '#C0392B',      // Rojo oscuro
    contrastText: '#FFFFFF',
  },
  info: {
    main: '#3498DB',      // Azul información
    light: '#5DADE2',     // Azul claro
    dark: '#2874A6',      // Azul oscuro
    contrastText: '#FFFFFF',
  },

  // Colores para cantidades/estados
  quantity: {
    low: '#E74C3C',       // Rojo para bajo
    medium: '#F39C12',    // Amarillo para medio
    high: '#27AE60',      // Verde para alto
    critical: '#C0392B',  // Rojo oscuro crítico
  },

  // Grises y neutros
  neutral: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#EEEEEE',
    300: '#E0E0E0',
    400: '#BDBDBD',
    500: '#9E9E9E',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
  },

  // Fondo y superficie
  background: {
    default: '#F8F9FA',   // Fondo claro
    paper: '#FFFFFF',     // Superficie de papel
    dark: '#1A252F',      // Fondo oscuro (para modo oscuro)
    overlay: 'rgba(0, 0, 0, 0.5)', // Overlay
  },

  // Texto
  text: {
    primary: '#2C3E50',   // Texto principal
    secondary: '#7F8C8D',  // Texto secundario
    disabled: '#BDC3C7',   // Texto deshabilitado
    hint: '#95A5A6',       // Texto de ayuda
  },

  // Divisores y bordes
  divider: '#ECF0F1',
  border: '#D5DBDB',
};

// Tema de Material UI - Modo Claro
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: colorPalette.primary,
    secondary: colorPalette.secondary,
    success: colorPalette.success,
    warning: colorPalette.warning,
    error: colorPalette.error,
    info: colorPalette.info,
    background: {
      default: colorPalette.background.default,
      paper: colorPalette.background.paper,
    },
    text: colorPalette.text,
    divider: colorPalette.divider,
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    h1: {
      fontSize: '2.5rem',
      fontWeight: 600,
      color: colorPalette.text.primary,
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 600,
      color: colorPalette.text.primary,
    },
    h3: {
      fontSize: '1.75rem',
      fontWeight: 600,
      color: colorPalette.text.primary,
    },
    h4: {
      fontSize: '1.5rem',
      fontWeight: 600,
      color: colorPalette.text.primary,
    },
    h5: {
      fontSize: '1.25rem',
      fontWeight: 600,
      color: colorPalette.text.primary,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
      color: colorPalette.text.primary,
    },
    body1: {
      color: colorPalette.text.primary,
    },
    body2: {
      color: colorPalette.text.secondary,
    },
  },
  shape: {
    borderRadius: 8,
  },
  shadows: [
    'none',
    '0px 2px 4px rgba(0,0,0,0.1)',
    '0px 4px 8px rgba(0,0,0,0.1)',
    '0px 8px 16px rgba(0,0,0,0.1)',
    '0px 16px 24px rgba(0,0,0,0.1)',
    '0px 24px 32px rgba(0,0,0,0.1)',
    // Material UI requiere 25 niveles de sombras
    '0px 2px 4px rgba(0,0,0,0.1)',
    '0px 4px 8px rgba(0,0,0,0.1)',
    '0px 8px 16px rgba(0,0,0,0.1)',
    '0px 16px 24px rgba(0,0,0,0.1)',
    '0px 24px 32px rgba(0,0,0,0.1)',
    '0px 2px 4px rgba(0,0,0,0.1)',
    '0px 4px 8px rgba(0,0,0,0.1)',
    '0px 8px 16px rgba(0,0,0,0.1)',
    '0px 16px 24px rgba(0,0,0,0.1)',
    '0px 24px 32px rgba(0,0,0,0.1)',
    '0px 2px 4px rgba(0,0,0,0.1)',
    '0px 4px 8px rgba(0,0,0,0.1)',
    '0px 8px 16px rgba(0,0,0,0.1)',
    '0px 16px 24px rgba(0,0,0,0.1)',
    '0px 24px 32px rgba(0,0,0,0.1)',
    '0px 2px 4px rgba(0,0,0,0.1)',
    '0px 4px 8px rgba(0,0,0,0.1)',
    '0px 8px 16px rgba(0,0,0,0.1)',
    '0px 16px 24px rgba(0,0,0,0.1)',
    '0px 24px 32px rgba(0,0,0,0.1)',
  ],
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          borderRadius: 8,
          transition: 'all 0.2s ease',
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0px 4px 8px rgba(0,0,0,0.15)',
            transform: 'translateY(-2px)',
          },
        },
        containedPrimary: {
          '&:hover': {
            backgroundColor: colorPalette.primary.light,
          },
        },
        outlined: {
          borderWidth: '2px',
          '&:hover': {
            borderWidth: '2px',
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            '& fieldset': {
              borderColor: colorPalette.border,
            },
            '&:hover fieldset': {
              borderColor: colorPalette.secondary.main,
            },
            '&.Mui-focused fieldset': {
              borderColor: colorPalette.secondary.main,
              borderWidth: '2px',
            },
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 8px rgba(0,0,0,0.08)',
          borderRadius: 12,
          transition: 'all 0.3s ease',
          '&:hover': {
            boxShadow: '0px 8px 16px rgba(0,0,0,0.12)',
            transform: 'translateY(-4px)',
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 500,
        },
        standardSuccess: {
          backgroundColor: '#E8F8F5',
          color: '#1E8449',
          borderLeft: `4px solid ${colorPalette.success.main}`,
        },
        standardError: {
          backgroundColor: '#FADBD8',
          color: '#C0392B',
          borderLeft: `4px solid ${colorPalette.error.main}`,
        },
        standardWarning: {
          backgroundColor: '#FEF5E7',
          color: '#D68910',
          borderLeft: `4px solid ${colorPalette.warning.main}`,
        },
        standardInfo: {
          backgroundColor: '#EBF5FB',
          color: '#2874A6',
          borderLeft: `4px solid ${colorPalette.info.main}`,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 6,
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: colorPalette.background.default,
          '& .MuiTableCell-head': {
            fontWeight: 600,
            color: colorPalette.text.primary,
            borderBottom: `2px solid ${colorPalette.divider}`,
          },
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: colorPalette.background.default,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        elevation1: {
          boxShadow: '0px 2px 4px rgba(0,0,0,0.08)',
        },
        elevation2: {
          boxShadow: '0px 4px 8px rgba(0,0,0,0.1)',
        },
        elevation3: {
          boxShadow: '0px 8px 16px rgba(0,0,0,0.12)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: '0px 8px 32px rgba(0,0,0,0.2)',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colorPalette.primary.main,
          fontSize: '0.85rem',
          borderRadius: 6,
          padding: '8px 12px',
        },
        arrow: {
          color: colorPalette.primary.main,
        },
      },
    },
  },
});

export default theme;
