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

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const DRAWER_WIDTH = 240;

export const Sidebar = ({ activeSection, onSectionChange }: SidebarProps) => {
  const menuItems = [
    { id: 'dashboard', label: 'Panel de control', icon: <DashboardIcon /> },
    { id: 'clientes', label: 'Clientes', icon: <PeopleIcon /> },
    { id: 'tarifas', label: 'Tarifas', icon: <PaidIcon /> },
    { id: 'facturacion', label: 'Facturación', icon: <ReceiptLongIcon /> },
    { id: 'trabajos', label: 'Trabajos', icon: <WorkHistoryIcon /> },
    { id: 'campanas', label: 'Campañas', icon: <CampaignIcon /> },
    { id: 'plantillas', label: 'Plantillas', icon: <DescriptionIcon /> },
    { id: 'plantillas-pre', label: 'Plantillas prediseñadas', icon: <ViewQuiltIcon /> },
    { id: 'configuracion', label: 'Configuración', icon: <SettingsIcon /> },
    { id: 'auditoria', label: 'Auditoría', icon: <HistoryIcon /> },
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
