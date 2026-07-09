import React from 'react';
import { Box, Container } from '@mui/material';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

interface AuthLayoutProps {
  children: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children, maxWidth = 'sm' }) => {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background.default',
        position: 'relative',
        py: 4,
      }}
    >
      {/* Botón de cambio de tema en la parte superior derecha */}
      <ThemeToggle
        sx={{
          position: 'absolute',
          top: 16,
          right: 16,
        }}
      />

      {/* Logo en la parte superior */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1,
        }}
      >
        <Logo width={180} />
      </Box>

      {/* Contenido principal centrado */}
      <Container
        maxWidth={maxWidth}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          px: 2,
          mt: 10, // Espacio para el logo
        }}
      >
        <Box sx={{ width: '100%' }}>
          {children}
        </Box>
      </Container>
    </Box>
  );
};
