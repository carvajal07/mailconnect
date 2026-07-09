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
import StorageIcon from '@mui/icons-material/Storage';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BarChartIcon from '@mui/icons-material/BarChart';
import { useNavigate } from 'react-router-dom';
import { PortalSidebar } from '../../components/portal/PortalSidebar';
import { HtmlBuilderSection } from '../../components/portal/HtmlBuilderSection';
import { PlaceholderSection } from '../../components/portal/PlaceholderSection';
import { MiCuentaSection } from '../../components/portal/MiCuentaSection';
import { CampanasSection } from '../../components/admin/CampanasSection';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Logo } from '../../components/Logo';
import { authService, clearSession, getUser } from '../../services/authService';

const DRAWER_WIDTH = 240;

export const PortalPage = () => {
  const [activeSection, setActiveSection] = useState('html');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const user = getUser();

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
        return (
          <PlaceholderSection
            title="Bases de datos"
            icon={<StorageIcon fontSize="inherit" />}
            description="Gestión de tus listas de destinatarios y lista negra por cliente. El backend de listar/editar destinatarios aún no está expuesto."
          />
        );
      case 'reportes':
        return (
          <PlaceholderSection
            title="Reportes"
            icon={<AssessmentIcon fontSize="inherit" />}
            description="Descarga reportes por campaña (estados de envío, entregas, rebotes) en CSV/Excel. Pendiente exponer el endpoint de reportes."
          />
        );
      case 'estadisticas':
        return (
          <PlaceholderSection
            title="Estadísticas"
            icon={<BarChartIcon fontSize="inherit" />}
            description="Tableros con tasas de apertura, clics y rebotes de tus campañas. Se conectará cuando el backend exponga las métricas agregadas."
          />
        );
      default:
        return <HtmlBuilderSection />;
    }
  };

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed" sx={{ width: `calc(100% - ${DRAWER_WIDTH}px)`, ml: `${DRAWER_WIDTH}px` }}>
        <Toolbar>
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

      <PortalSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

      <Box component="main" sx={{ flexGrow: 1, p: 3, width: `calc(100% - ${DRAWER_WIDTH}px)` }}>
        <Toolbar />
        <Container maxWidth="xl" sx={{ mt: 4 }}>
          {renderSection()}
        </Container>
      </Box>
    </Box>
  );
};
