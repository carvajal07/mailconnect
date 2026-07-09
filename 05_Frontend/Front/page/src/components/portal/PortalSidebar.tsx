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
  Tooltip,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CampaignIcon from '@mui/icons-material/Campaign';
import RateReviewIcon from '@mui/icons-material/RateReview';
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
  { id: 'muestras', label: 'Muestras', icon: <RateReviewIcon /> },
  { id: 'basesdatos', label: 'Bases de datos', icon: <StorageIcon /> },
  { id: 'reportes', label: 'Reportes', icon: <AssessmentIcon /> },
  { id: 'estadisticas', label: 'Estadísticas', icon: <BarChartIcon /> },
  { id: 'cuenta', label: 'Mi cuenta', icon: <AccountCircleIcon /> },
];

export const DRAWER_WIDTH_FULL = 240;
export const DRAWER_WIDTH_MINI = 72;

interface PortalSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  collapsed: boolean;
}

export const PortalSidebar = ({ activeSection, onSectionChange, collapsed }: PortalSidebarProps) => {
  const width = collapsed ? DRAWER_WIDTH_MINI : DRAWER_WIDTH_FULL;

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          transition: (t) => t.transitions.create('width', { duration: t.transitions.duration.shorter }),
        },
      }}
    >
      <Toolbar sx={{ px: collapsed ? 1 : 2 }}>
        <Box sx={{ width: '100%', textAlign: 'center', overflow: 'hidden' }}>
          <Typography variant="h6" component="div" noWrap>
            {collapsed ? 'MC' : 'Mi portal'}
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List sx={{ px: collapsed ? 0.5 : 0 }}>
        {PORTAL_TABS.map((tab) => (
          <ListItem key={tab.id} disablePadding sx={{ display: 'block' }}>
            <Tooltip title={collapsed ? tab.label : ''} placement="right" arrow>
              <ListItemButton
                selected={activeSection === tab.id}
                onClick={() => onSectionChange(tab.id)}
                sx={{
                  minHeight: 48,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  px: 2.5,
                  borderRadius: collapsed ? 2 : 0,
                }}
              >
                <ListItemIcon sx={{ minWidth: 0, mr: collapsed ? 0 : 3, justifyContent: 'center' }}>
                  {tab.icon}
                </ListItemIcon>
                {!collapsed && <ListItemText primary={tab.label} />}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
};
