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
  Typography,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CampaignIcon from '@mui/icons-material/Campaign';
import StorageIcon from '@mui/icons-material/Storage';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BarChartIcon from '@mui/icons-material/BarChart';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import type { ReactNode } from 'react';

export interface PortalTab {
  id: string;
  label: string;
  icon: ReactNode;
}

export const PORTAL_TABS: PortalTab[] = [
  { id: 'html', label: 'Plantillas HTML', icon: <CodeIcon /> },
  { id: 'pdf', label: 'Plantillas PDF', icon: <PictureAsPdfIcon /> },
  { id: 'campanas', label: 'Campañas', icon: <CampaignIcon /> },
  { id: 'basesdatos', label: 'Bases de datos', icon: <StorageIcon /> },
  { id: 'reportes', label: 'Reportes', icon: <AssessmentIcon /> },
  { id: 'estadisticas', label: 'Estadísticas', icon: <BarChartIcon /> },
  { id: 'cuenta', label: 'Mi cuenta', icon: <AccountCircleIcon /> },
];

const DRAWER_WIDTH = 240;

interface PortalSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export const PortalSidebar = ({ activeSection, onSectionChange }: PortalSidebarProps) => (
  <Drawer
    variant="permanent"
    sx={{
      width: DRAWER_WIDTH,
      flexShrink: 0,
      '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
    }}
  >
    <Toolbar>
      <Box sx={{ width: '100%', textAlign: 'center' }}>
        <Typography variant="h6" component="div">
          Mi portal
        </Typography>
      </Box>
    </Toolbar>
    <Divider />
    <List>
      {PORTAL_TABS.map((tab) => (
        <ListItem key={tab.id} disablePadding>
          <ListItemButton selected={activeSection === tab.id} onClick={() => onSectionChange(tab.id)}>
            <ListItemIcon>{tab.icon}</ListItemIcon>
            <ListItemText primary={tab.label} />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  </Drawer>
);
