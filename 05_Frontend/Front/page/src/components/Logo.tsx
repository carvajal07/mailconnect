import React from 'react';
import { Box } from '@mui/material';
import { useTheme } from '../contexts/ThemeContext';

interface LogoProps {
  width?: number | string;
  height?: number | string;
  sx?: object;
}

export const Logo: React.FC<LogoProps> = ({ width = 300, height = 'auto', sx }) => {
  const { mode } = useTheme();

  const logoSrc = mode === 'light' ? '/Logo_Original.svg' : '/Logo_Gris.svg';

  return (
    <Box
      component="img"
      src={logoSrc}
      alt="MailConnect Logo"
      sx={{
        width,
        height,
        objectFit: 'contain',
        ...sx,
      }}
    />
  );
};
