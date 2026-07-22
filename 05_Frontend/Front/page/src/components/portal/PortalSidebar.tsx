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
import DescriptionIcon from '@mui/icons-material/Description';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SmsIcon from '@mui/icons-material/Sms';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import CampaignIcon from '@mui/icons-material/Campaign';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend';
import RateReviewIcon from '@mui/icons-material/RateReview';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import StorageIcon from '@mui/icons-material/Storage';
import BlockIcon from '@mui/icons-material/Block';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BarChartIcon from '@mui/icons-material/BarChart';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import DnsIcon from '@mui/icons-material/Dns';
import type { ReactNode } from 'react';
import { getUser, getTenantRole } from '../../services/authService';
import { canAccessTab } from '../../config/portalAccess';

export interface PortalTab {
  id: string;
  label: string;
  icon: ReactNode;
  /** Dibuja un separador DESPUÉS de este tab (agrupación visual). */
  dividerAfter?: boolean;
}

// Orden: Bases de datos primero · separador · Plantillas · separador · el resto.
export const PORTAL_TABS: PortalTab[] = [
  { id: 'basesdatos', label: 'Bases de datos', icon: <StorageIcon />, dividerAfter: true },
  { id: 'html', label: 'Plantillas HTML', icon: <CodeIcon /> },
  { id: 'docx', label: 'Plantillas DOCX', icon: <DescriptionIcon /> },
  { id: 'pdf', label: 'Plantillas PDF', icon: <PictureAsPdfIcon /> },
  { id: 'sms', label: 'Plantillas SMS', icon: <SmsIcon /> },
  { id: 'whatsapp', label: 'Plantillas WhatsApp', icon: <WhatsAppIcon />, dividerAfter: true },
  { id: 'campanas', label: 'Campañas', icon: <CampaignIcon /> },
  { id: 'cascada', label: 'Cascada omnicanal', icon: <AltRouteIcon /> },
  { id: 'programar', label: 'Programar envíos', icon: <ScheduleSendIcon /> },
  { id: 'muestras', label: 'Muestras', icon: <RateReviewIcon /> },
  { id: 'aprobaciones', label: 'Aprobaciones', icon: <HowToRegIcon /> },
  { id: 'listanegra', label: 'Lista negra', icon: <BlockIcon /> },
  { id: 'reportes', label: 'Reportes', icon: <AssessmentIcon /> },
  { id: 'estadisticas', label: 'Estadísticas', icon: <BarChartIcon /> },
  { id: 'saldo', label: 'Saldo y recargas', icon: <AccountBalanceWalletIcon /> },
  { id: 'dominios', label: 'Dominios', icon: <DnsIcon /> },
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
  // RBAC: solo se muestran los tabs permitidos para el sub-rol de la sesión.
  const role = getTenantRole(getUser());
  const tabs = PORTAL_TABS.filter((t) => canAccessTab(role, t.id));

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
        {tabs.map((tab, i) => (
          <Box key={tab.id}>
            <ListItem disablePadding sx={{ display: 'block' }}>
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
            {/* Separador de grupo (no tras el último visible). */}
            {tab.dividerAfter && i < tabs.length - 1 && <Divider sx={{ my: 0.5 }} />}
          </Box>
        ))}
      </List>
    </Drawer>
  );
};
