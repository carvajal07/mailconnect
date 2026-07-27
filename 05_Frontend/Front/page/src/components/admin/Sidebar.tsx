import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Divider,
  Box,
  Typography
} from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import CampaignIcon from '@mui/icons-material/Campaign';
import DescriptionIcon from '@mui/icons-material/Description';
import ViewQuiltIcon from '@mui/icons-material/ViewQuilt';
import PaidIcon from '@mui/icons-material/Paid';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import DashboardIcon from '@mui/icons-material/Dashboard';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import SettingsIcon from '@mui/icons-material/Settings';
import HistoryIcon from '@mui/icons-material/History';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import TuneIcon from '@mui/icons-material/Tune';
import DnsIcon from '@mui/icons-material/Dns';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const DRAWER_WIDTH = 240;

export const Sidebar = ({ activeSection, onSectionChange }: SidebarProps) => {
  const menuItems = [
    { id: 'centro', label: 'Centro de mando', icon: <MonitorHeartIcon /> },
    { id: 'dashboard', label: 'Panel de control', icon: <DashboardIcon /> },
    { id: 'soporte', label: 'Soporte', icon: <SupportAgentIcon /> },
    { id: 'clientes', label: 'Clientes', icon: <PeopleIcon /> },
    { id: 'funciones', label: 'Funciones por cliente', icon: <TuneIcon /> },
    { id: 'ipenvio', label: 'IP de envío', icon: <DnsIcon /> },
    { id: 'tarifas', label: 'Tarifas', icon: <PaidIcon /> },
    { id: 'saldos', label: 'Saldos', icon: <AccountBalanceWalletIcon /> },
    { id: 'facturacion', label: 'Facturación', icon: <ReceiptLongIcon /> },
    { id: 'trabajos', label: 'Trabajos', icon: <WorkHistoryIcon /> },
    { id: 'campanas', label: 'Campañas', icon: <CampaignIcon /> },
    { id: 'plantillas', label: 'Plantillas de correo', icon: <DescriptionIcon /> },
    { id: 'plantillas-pre', label: 'Plantillas prediseñadas', icon: <ViewQuiltIcon /> },
    { id: 'configuracion', label: 'Configuración', icon: <SettingsIcon /> },
    { id: 'auditoria', label: 'Auditoría', icon: <HistoryIcon /> },
    { id: 'despliegue', label: 'Salud de despliegue', icon: <HealthAndSafetyIcon /> },
  ];

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
        },
      }}
    >
      <Toolbar>
        <Box sx={{ width: '100%', textAlign: 'center' }}>
          <Typography variant="h6" component="div">
            Administración
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.id} disablePadding>
            <ListItemButton
              selected={activeSection === item.id}
              onClick={() => onSectionChange(item.id)}
            >
              <ListItemIcon>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
};
