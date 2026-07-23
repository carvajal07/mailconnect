import { createTheme } from '@mui/material/styles';

// Paleta de colores personalizada - Tema Claro/Profesional
//
// Derivada de la MARCA MailConnect (los mismos tokens del logo y la landing):
//   cyan #00c3ff · azul #0075be · navy/ink #16233f · verde #1fbf87 · amber #ff9d2e
// Fuente única de la marca: src/pages/landing/landing.css (bloque .mc-landing).
export const colorPalette = {
  // Colores principales (azul de marca)
  primary: {
    main: '#0075be',      // Brand-strong (azul del logo) - acción principal
    light: '#00c3ff',     // Brand cyan
    dark: '#005a94',      // Azul oscuro
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: '#16233f',      // Ink/navy de marca
    light: '#2a3a5a',     // Navy claro
    dark: '#0a1628',      // Ink profundo
    contrastText: '#FFFFFF',
  },

  // Colores de acento (canales / documentos, igual que la landing)
  accent: {
    teal: '#1fbf87',      // Verde de marca
    purple: '#6f5ec2',    // Violeta de marca
    orange: '#ff9d2e',    // Ámbar de marca
    turquoise: '#00c3ff', // Cyan de marca
  },

  // Colores de estado (alineados a la marca)
  success: {
    main: '#1fbf87',      // Verde de marca
    light: '#4fd0a2',     // Verde claro
    dark: '#159467',      // Verde oscuro
    contrastText: '#FFFFFF',
  },
  warning: {
    main: '#ff9d2e',      // Ámbar de marca
    light: '#ffb75e',     // Ámbar claro
    dark: '#d97e12',      // Ámbar oscuro
    contrastText: '#16233f',
  },
  error: {
    main: '#e5484d',      // Rojo (accesible sobre fondo claro)
    light: '#ef6f73',     // Rojo claro
    dark: '#c1343a',      // Rojo oscuro
    contrastText: '#FFFFFF',
  },
  info: {
    main: '#00c3ff',      // Cyan de marca
    light: '#5bd6ff',     // Cyan claro
    dark: '#0092c4',      // Cyan oscuro
    contrastText: '#16233f',
  },

  // Colores para cantidades/estados
  quantity: {
    low: '#e5484d',       // Rojo para bajo
    medium: '#ff9d2e',    // Ámbar para medio
    high: '#1fbf87',      // Verde para alto
    critical: '#c1343a',  // Rojo oscuro crítico
  },

  // Grises y neutros (con leve tinte azulado de la marca)
  neutral: {
    50: '#f4f8fc',
    100: '#eaf1f8',
    200: '#e4ebf3',
    300: '#d8e2ee',
    400: '#b7c4d6',
    500: '#8090a6',
    600: '#5b6b86',
    700: '#42506a',
    800: '#28344c',
    900: '#16233f',
  },

  // Fondo y superficie
  background: {
    default: '#f4f8fc',   // Fondo claro (bg-alt de la marca)
    paper: '#FFFFFF',     // Superficie de papel
    dark: '#16233f',      // Fondo oscuro (bloques navy de la marca)
    overlay: 'rgba(16, 35, 63, 0.5)', // Overlay (ink transparente)
  },

  // Texto
  text: {
    primary: '#16233f',   // Ink de marca
    secondary: '#5b6b86',  // Texto atenuado de la marca
    disabled: '#9fb0c4',   // Texto deshabilitado
    hint: '#8090a6',       // Texto de ayuda
  },

  // Divisores y bordes
  divider: '#e4ebf3',
  border: '#d8e2ee',
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
            backgroundColor: colorPalette.primary.dark,
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
    // Tablas: filas compactas (densidad "small" por defecto), encabezado con
    // color diferenciado (azul-gris de marca) y filas cebra + hover.
    MuiTable: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: '#e2ecf6',
          '& .MuiTableCell-head': {
            fontWeight: 700,
            color: colorPalette.text.primary,
            backgroundColor: '#e2ecf6',
            borderBottom: `2px solid ${colorPalette.primary.main}`,
          },
        },
      },
    },
    MuiTableBody: {
      styleOverrides: {
        root: {
          '& .MuiTableRow-root:nth-of-type(odd)': {
            backgroundColor: 'rgba(15, 45, 90, 0.035)',
          },
          '& .MuiTableRow-root:hover': {
            backgroundColor: 'rgba(15, 45, 90, 0.07)',
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
