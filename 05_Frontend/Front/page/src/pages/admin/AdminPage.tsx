import { useState } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  Container,
  IconButton,
  Menu,
  MenuItem,
  Divider,
  Avatar,
} from '@mui/material';
import { Sidebar } from '../../components/admin/Sidebar';
import { ClientesSection } from '../../components/admin/ClientesSection';
import { EnviosClientesSection } from '../../components/admin/EnviosClientesSection';
import { TarifasSection } from '../../components/admin/TarifasSection';
import { FacturacionSection } from '../../components/admin/FacturacionSection';
import { PlantillasSection } from '../../components/admin/PlantillasSection';
import { CampanasSection } from '../../components/admin/CampanasSection';
import { HtmlBuilderSection } from '../../components/portal/HtmlBuilderSection';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Logo } from '../../components/Logo';
import { useNavigate } from 'react-router-dom';
import { authService, clearSession, getUser } from '../../services/authService';
import { PortalDataProvider } from '../../context/PortalDataContext';

const DRAWER_WIDTH = 240;

export const AdminPage = () => {
  const [activeSection, setActiveSection] = useState('clientes');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const user = getUser();

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleMenuClose();
    // Cerrar sesión: notificar al backend (best-effort) y limpiar sesión local
    if (user?.email) {
      authService.logout(user.email).catch(() => { /* ignorar errores de red */ });
    }
    clearSession();
    navigate('/login');
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'clientes':
        return <ClientesSection />;
      case 'envios-clientes':
        return <EnviosClientesSection />;
      case 'tarifas':
        return <TarifasSection />;
      case 'facturacion':
        return <FacturacionSection />;
      case 'plantillas':
        return <PlantillasSection />;
      case 'plantillas-pre':
        return <HtmlBuilderSection allowSavePreset />;
      case 'campanas':
        return <CampanasSection />;
      default:
        return <ClientesSection />;
    }
  };

  return (
    // CampanasSection (y otras secciones reutilizadas del portal) consumen usePortalData(),
    // que lanza excepción si no hay un <PortalDataProvider> ancestro → antes dejaba la página
    // en blanco al abrir "Campañas". Se envuelve todo el panel admin en el provider.
    <PortalDataProvider>
    <Box sx={{ display: 'flex' }}>
      {/* AppBar */}
      <AppBar
        position="fixed"
        elevation={0}
        color="default"
        sx={{
          width: `calc(100% - ${DRAWER_WIDTH}px)`,
          ml: `${DRAWER_WIDTH}px`,
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar>
          <Logo height="34px" />
          <Divider orientation="vertical" flexItem sx={{ mx: 2, my: 1.5, display: { xs: 'none', sm: 'block' } }} />
          <Typography variant="subtitle1" component="div" sx={{ flexGrow: 1, fontWeight: 600, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            Panel de Administración
          </Typography>
          <Box sx={{ flexGrow: { xs: 1, sm: 0 } }} />
          {user?.name && (
            <Typography variant="body2" sx={{ mr: 1.5, color: 'text.secondary', display: { xs: 'none', md: 'block' } }}>
              Hola, <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{user.name}</Box>
            </Typography>
          )}
          <ThemeToggle sx={{ color: 'text.secondary' }} />
          <IconButton onClick={handleMenuOpen} sx={{ ml: 0.5 }} aria-label="Cuenta">
            <Avatar sx={{ width: 32, height: 32, bgcolor: '#0075be', color: '#fff', fontSize: 15 }}>
              {(user?.name || user?.email || '?').trim().charAt(0).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
          >
            <MenuItem onClick={handleLogout}>Cerrar Sesión</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: `calc(100% - ${DRAWER_WIDTH}px)`,
        }}
      >
        <Toolbar />
        <Container maxWidth="xl" sx={{ mt: 4 }}>
          {renderSection()}
        </Container>
      </Box>
    </Box>
    </PortalDataProvider>
  );
};
