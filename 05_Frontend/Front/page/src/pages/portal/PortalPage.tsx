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
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { useNavigate } from 'react-router-dom';
import { PortalSidebar, DRAWER_WIDTH_FULL, DRAWER_WIDTH_MINI } from '../../components/portal/PortalSidebar';
import { HtmlBuilderSection } from '../../components/portal/HtmlBuilderSection';
import { PlaceholderSection } from '../../components/portal/PlaceholderSection';
import { BasesDatosSection } from '../../components/portal/BasesDatosSection';
import { EstadisticasSection } from '../../components/portal/EstadisticasSection';
import { ReportesSection } from '../../components/portal/ReportesSection';
import { MiCuentaSection } from '../../components/portal/MiCuentaSection';
import { CampanasSection } from '../../components/admin/CampanasSection';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Logo } from '../../components/Logo';
import { authService, clearSession, getUser } from '../../services/authService';

export const PortalPage = () => {
  const [activeSection, setActiveSection] = useState('html');
  const [collapsed, setCollapsed] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const user = getUser();

  const drawerWidth = collapsed ? DRAWER_WIDTH_MINI : DRAWER_WIDTH_FULL;

  const handleLogout = () => {
    setAnchorEl(null);
    if (user?.email) {
      authService.logout(user.email).catch(() => { /* ignorar errores de red */ });
    }
    clearSession();
    navigate('/login');
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'html':
        return <HtmlBuilderSection />;
      case 'campanas':
        return <CampanasSection />;
      case 'cuenta':
        return <MiCuentaSection />;
      case 'pdf':
        return (
          <PlaceholderSection
            title="Plantillas PDF"
            icon={<PictureAsPdfIcon fontSize="inherit" />}
            description="Aquí podrás crear plantillas de documentos PDF (combinación de correspondencia) para los envíos con adjunto personalizado. Requiere el backend de combinación .docx/PDF."
          />
        );
      case 'basesdatos':
        return <BasesDatosSection />;
      case 'reportes':
        return <ReportesSection />;
      case 'estadisticas':
        return <EstadisticasSection />;
      default:
        return <HtmlBuilderSection />;
    }
  };

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: `calc(100% - ${drawerWidth}px)`,
          ml: `${drawerWidth}px`,
          transition: (t) => t.transitions.create(['width', 'margin'], { duration: t.transitions.duration.shorter }),
        }}
      >
        <Toolbar>
          <IconButton color="inherit" edge="start" onClick={() => setCollapsed((c) => !c)} sx={{ mr: 1 }} aria-label="Contraer menú">
            {collapsed ? <MenuIcon /> : <MenuOpenIcon />}
          </IconButton>
          <Logo height="40px" />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, ml: 2 }}>
            Portal del cliente
          </Typography>
          {user?.name && (
            <Typography variant="body2" sx={{ mr: 1, opacity: 0.9 }}>
              Hola, {user.name}
            </Typography>
          )}
          <ThemeToggle />
          <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ ml: 2 }}>
            <AccountCircleIcon />
          </IconButton>
          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
            <MenuItem
              onClick={() => {
                setAnchorEl(null);
                setActiveSection('cuenta');
              }}
            >
              Mi cuenta
            </MenuItem>
            <MenuItem onClick={handleLogout}>Cerrar Sesión</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <PortalSidebar activeSection={activeSection} onSectionChange={setActiveSection} collapsed={collapsed} />

      <Box component="main" sx={{ flexGrow: 1, p: 3, width: `calc(100% - ${drawerWidth}px)`, minWidth: 0 }}>
        <Toolbar />
        <Container maxWidth="xl" sx={{ mt: 4 }}>
          {renderSection()}
        </Container>
      </Box>
    </Box>
  );
};
