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
  Avatar,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { useNavigate } from 'react-router-dom';
import { PortalSidebar, DRAWER_WIDTH_FULL, DRAWER_WIDTH_MINI } from '../../components/portal/PortalSidebar';
import { HtmlBuilderSection } from '../../components/portal/HtmlBuilderSection';
import { MessageTemplatesSection } from '../../components/portal/MessageTemplatesSection';
import { DocxTemplatesSection } from '../../components/portal/DocxTemplatesSection';
import { BasesDatosSection } from '../../components/portal/BasesDatosSection';
import { ListaNegraSection } from '../../components/portal/ListaNegraSection';
import { MuestrasSection } from '../../components/portal/MuestrasSection';
import { AprobacionesSection } from '../../components/portal/AprobacionesSection';
import { DominiosSection } from '../../components/portal/DominiosSection';
import { EstadisticasSection } from '../../components/portal/EstadisticasSection';
import { ReportesSection } from '../../components/portal/ReportesSection';
import { SaldoSection } from '../../components/portal/SaldoSection';
import { MiCuentaSection } from '../../components/portal/MiCuentaSection';
import { CampanasSection } from '../../components/admin/CampanasSection';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Logo } from '../../components/Logo';
import { authService, clearSession, getUser, getTenantRole } from '../../services/authService';
import { canAccessTab } from '../../config/portalAccess';
import { PortalDataProvider } from '../../context/PortalDataContext';

export const PortalPage = () => {
  const [activeSection, setActiveSection] = useState('html');
  const [collapsed, setCollapsed] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const user = getUser();
  // RBAC: sub-rol de empresa (owner|approver|operator) para gatear los módulos/tabs.
  const role = getTenantRole(user);

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
    // Guardia RBAC: si el rol no puede ver el tab activo, cae al tab por defecto.
    if (!canAccessTab(role, activeSection)) return <HtmlBuilderSection />;
    switch (activeSection) {
      case 'html':
        return <HtmlBuilderSection />;
      case 'docx':
        return <DocxTemplatesSection />;
      case 'sms':
        return <MessageTemplatesSection channel="SMS" />;
      case 'whatsapp':
        return <MessageTemplatesSection channel="WSP" />;
      case 'campanas':
        return <CampanasSection />;
      case 'muestras':
        return <MuestrasSection />;
      case 'aprobaciones':
        return <AprobacionesSection />;
      case 'cuenta':
        return <MiCuentaSection />;
      case 'basesdatos':
        return <BasesDatosSection />;
      case 'listanegra':
        return <ListaNegraSection />;
      case 'reportes':
        return <ReportesSection />;
      case 'estadisticas':
        return <EstadisticasSection />;
      case 'saldo':
        return <SaldoSection />;
      case 'dominios':
        return <DominiosSection />;
      default:
        return <HtmlBuilderSection />;
    }
  };

  return (
    <PortalDataProvider>
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        elevation={0}
        color="default"
        sx={{
          width: `calc(100% - ${drawerWidth}px)`,
          ml: `${drawerWidth}px`,
          transition: (t) => t.transitions.create(['width', 'margin'], { duration: t.transitions.duration.shorter }),
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar>
          <IconButton onClick={() => setCollapsed((c) => !c)} edge="start" sx={{ mr: 1, color: 'text.secondary' }} aria-label="Contraer menú">
            {collapsed ? <MenuIcon /> : <MenuOpenIcon />}
          </IconButton>
          <Logo height="34px" />
          <Box sx={{ flexGrow: 1 }} />
          {user?.name && (
            <Typography variant="body2" sx={{ mr: 1.5, color: 'text.secondary', display: { xs: 'none', md: 'block' } }}>
              Hola, <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{user.name}</Box>
            </Typography>
          )}
          <ThemeToggle sx={{ color: 'text.secondary' }} />
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ ml: 0.5 }} aria-label="Cuenta">
            <Avatar sx={{ width: 32, height: 32, bgcolor: '#0075be', color: '#fff', fontSize: 15 }}>
              {(user?.name || user?.email || '?').trim().charAt(0).toUpperCase()}
            </Avatar>
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
    </PortalDataProvider>
  );
};
