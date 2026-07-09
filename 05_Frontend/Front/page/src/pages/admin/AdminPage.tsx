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
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { Sidebar } from '../../components/admin/Sidebar';
import { ClientesSection } from '../../components/admin/ClientesSection';
import { PlantillasSection } from '../../components/admin/PlantillasSection';
import { CampanasSection } from '../../components/admin/CampanasSection';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Logo } from '../../components/Logo';
import { useNavigate } from 'react-router-dom';

const DRAWER_WIDTH = 240;

export const AdminPage = () => {
  const [activeSection, setActiveSection] = useState('clientes');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleMenuClose();
    // Aquí puedes agregar la lógica de logout
    navigate('/login');
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'clientes':
        return <ClientesSection />;
      case 'plantillas':
        return <PlantillasSection />;
      case 'campanas':
        return <CampanasSection />;
      default:
        return <ClientesSection />;
    }
  };

  return (
    <Box sx={{ display: 'flex' }}>
      {/* AppBar */}
      <AppBar
        position="fixed"
        sx={{
          width: `calc(100% - ${DRAWER_WIDTH}px)`,
          ml: `${DRAWER_WIDTH}px`,
        }}
      >
        <Toolbar>
          <Logo height="40px" />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, ml: 2 }}>
            Panel de Administración
          </Typography>
          <ThemeToggle />
          <IconButton
            color="inherit"
            onClick={handleMenuOpen}
            sx={{ ml: 2 }}
          >
            <AccountCircleIcon />
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
  );
};
