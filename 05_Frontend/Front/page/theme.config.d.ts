import { Theme } from '@mui/material/styles';

export const colorPalette: {
  primary: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
  };
  secondary: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
  };
  darkBase: {
    darkNavy: string;
    darkBlue: string;
    navyBlue: string;
    tealDark: string;
    teal: string;
    cyan: string;
  };
  accent: {
    cyan: string;
    green: string;
    purple: string;
    pink: string;
    yellow: string;
  };
  success: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
  };
  warning: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
  };
  error: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
  };
  info: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
  };
  quantity: {
    critical: string;
    low: string;
    medium: string;
    high: string;
  };
  neutral: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
  };
  background: {
    default: string;
    paper: string;
    card: string;
    dark: string;
    overlay: string;
  };
  text: {
    primary: string;
    secondary: string;
    disabled: string;
    hint: string;
    accent: string;
  };
  divider: string;
  border: string;
};

declare const theme: Theme;
export default theme;
