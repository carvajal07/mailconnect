import { createTheme } from '@mui/material/styles';

// Paleta de colores personalizada - Dark/Cyberpunk Theme
export const colorPalette = {
  // Colores principales (oscuros)
  primary: {
    main: '#0a1628',      // Dark Navy - Principal
    light: '#1a2742',     // Dark Blue - Hover
    dark: '#050b14',      // Más oscuro aún
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: '#2a3d5f',      // Navy Blue
    light: '#3a4d7f',     // Navy Blue Light
    dark: '#1a2d4f',      // Navy Blue Dark
    contrastText: '#FFFFFF',
  },
  
  // Colores base oscuros
  darkBase: {
    darkNavy: '#0a1628',
    darkBlue: '#1a2742',
    navyBlue: '#2a3d5f',
    tealDark: '#1e4756',
    teal: '#2d5f6f',
    cyan: '#4a9fb8',
  },

  // Colores de acento electrizantes (NEÓN)
  accent: {
    cyan: '#00c3ff',      // Cyan neón brillante
    green: '#00ff9d',     // Verde neón brillante
    purple: '#b74aff',    // Púrpura neón
    pink: '#ff006e',      // Rosa neón
    yellow: '#ffed4e',    // Amarillo neón
  },

  // Colores de estado
  success: {
    main: '#00ff9d',      // Verde neón
    light: '#33ffb0',     
    dark: '#00cc7d',      
    contrastText: '#0a1628',
  },
  warning: {
    main: '#ffed4e',      // Amarillo neón
    light: '#fff176',     
    dark: '#ffd700',      
    contrastText: '#0a1628',
  },
  error: {
    main: '#ff006e',      // Rosa/Rojo neón
    light: '#ff3388',     
    dark: '#cc0058',      
    contrastText: '#FFFFFF',
  },
  info: {
    main: '#00c3ff',      // Cyan neón
    light: '#33d1ff',     
    dark: '#009fcc',      
    contrastText: '#0a1628',
  },

  // Colores para cantidades/estados
  quantity: {
    critical: '#ff006e',  // Rosa neón para crítico
    low: '#ff6b35',       // Naranja neón para bajo
    medium: '#ffed4e',    // Amarillo neón para medio
    high: '#00ff9d',      // Verde neón para alto
  },

  // Grises oscuros
  neutral: {
    50: '#1a2742',
    100: '#2a3d5f',
    200: '#3a4d6f',
    300: '#4a5d7f',
    400: '#5a6d8f',
    500: '#6a7d9f',
    600: '#7a8daf',
    700: '#8a9dbf',
    800: '#9aadcf',
    900: '#aabddf',
  },

  // Fondo y superficie
  background: {
    default: '#0a1628',   // Dark Navy
    paper: '#1a2742',     // Dark Blue
    card: '#2a3d5f',      // Navy Blue
    dark: '#050b14',      // Casi negro
    overlay: 'rgba(0, 0, 0, 0.7)',
  },

  // Texto
  text: {
    primary: '#FFFFFF',       // Blanco
    secondary: '#aabddf',     // Gris claro azulado
    disabled: '#6a7d9f',      // Gris medio
    hint: '#4a5d7f',          // Gris oscuro
    accent: '#00c3ff',        // Cyan para énfasis
  },

  // Divisores y bordes
  divider: 'rgba(74, 159, 184, 0.2)',  // Cyan transparente
  border: 'rgba(74, 159, 184, 0.3)',
};

// Tema de Material UI
const theme = createTheme({
  palette: {
    mode: 'dark',
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
      fontWeight: 700,
      color: colorPalette.text.primary,
      textShadow: `0 0 20px ${colorPalette.accent.cyan}40`,
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
    `0 0 10px ${colorPalette.accent.cyan}20`,
    `0 0 15px ${colorPalette.accent.cyan}30`,
    `0 0 20px ${colorPalette.accent.cyan}40`,
    `0 0 25px ${colorPalette.accent.cyan}50`,
    `0 0 30px ${colorPalette.accent.green}50`,
    // Rellenar hasta 25 sombras
    `0 0 10px ${colorPalette.accent.cyan}20`,
    `0 0 15px ${colorPalette.accent.cyan}30`,
    `0 0 20px ${colorPalette.accent.cyan}40`,
    `0 0 25px ${colorPalette.accent.cyan}50`,
    `0 0 30px ${colorPalette.accent.green}50`,
    `0 0 10px ${colorPalette.accent.cyan}20`,
    `0 0 15px ${colorPalette.accent.cyan}30`,
    `0 0 20px ${colorPalette.accent.cyan}40`,
    `0 0 25px ${colorPalette.accent.cyan}50`,
    `0 0 30px ${colorPalette.accent.green}50`,
    `0 0 10px ${colorPalette.accent.cyan}20`,
    `0 0 15px ${colorPalette.accent.cyan}30`,
    `0 0 20px ${colorPalette.accent.cyan}40`,
    `0 0 25px ${colorPalette.accent.cyan}50`,
    `0 0 30px ${colorPalette.accent.green}50`,
    `0 0 10px ${colorPalette.accent.cyan}20`,
    `0 0 15px ${colorPalette.accent.cyan}30`,
    `0 0 20px ${colorPalette.accent.cyan}40`,
    `0 0 25px ${colorPalette.accent.cyan}50`,
    `0 0 30px ${colorPalette.accent.green}50`,
  ],
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          transition: 'all 0.3s ease',
        },
        contained: {
          boxShadow: `0 0 15px ${colorPalette.accent.cyan}40`,
          '&:hover': {
            boxShadow: `0 0 25px ${colorPalette.accent.cyan}60`,
            transform: 'translateY(-2px)',
          },
        },
        containedPrimary: {
          background: `linear-gradient(135deg, ${colorPalette.primary.main}, ${colorPalette.secondary.main})`,
          border: `1px solid ${colorPalette.accent.cyan}40`,
          '&:hover': {
            background: `linear-gradient(135deg, ${colorPalette.primary.light}, ${colorPalette.secondary.light})`,
            boxShadow: `0 0 30px ${colorPalette.accent.cyan}70`,
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            backgroundColor: colorPalette.background.paper,
            '& fieldset': {
              borderColor: colorPalette.border,
            },
            '&:hover fieldset': {
              borderColor: colorPalette.accent.cyan,
            },
            '&.Mui-focused fieldset': {
              borderColor: colorPalette.accent.cyan,
              boxShadow: `0 0 15px ${colorPalette.accent.cyan}30`,
            },
          },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        input: {
          '&::placeholder': {
            color: `${colorPalette.text.primary}b3`,
            opacity: 1,
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: colorPalette.text.secondary,
          '&.Mui-focused': {
            color: colorPalette.text.primary,
          },
          '&.MuiInputLabel-shrink': {
            color: colorPalette.text.primary,
          },
          '&.MuiFormLabel-filled': {
            color: colorPalette.text.primary,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: colorPalette.background.paper,
          backgroundImage: 'none',
          border: `1px solid ${colorPalette.border}`,
          borderRadius: 12,
          transition: 'all 0.3s ease',
          '&:hover': {
            border: `1px solid ${colorPalette.accent.cyan}`,
            boxShadow: `0 0 30px ${colorPalette.accent.cyan}40`,
            transform: 'translateY(-4px)',
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
        standardSuccess: {
          backgroundColor: `${colorPalette.success.main}20`,
          color: colorPalette.success.main,
          border: `1px solid ${colorPalette.success.main}60`,
        },
        standardError: {
          backgroundColor: `${colorPalette.error.main}20`,
          color: colorPalette.error.main,
          border: `1px solid ${colorPalette.error.main}60`,
        },
        standardWarning: {
          backgroundColor: `${colorPalette.warning.main}20`,
          color: colorPalette.warning.main,
          border: `1px solid ${colorPalette.warning.main}60`,
        },
        standardInfo: {
          backgroundColor: `${colorPalette.info.main}20`,
          color: colorPalette.info.main,
          border: `1px solid ${colorPalette.info.main}60`,
        },
      },
    },
  },
});

export default theme;
