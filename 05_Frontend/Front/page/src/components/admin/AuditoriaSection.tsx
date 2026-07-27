import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  MenuItem,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  CircularProgress,
  Alert,
  InputAdornment,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import HistoryIcon from '@mui/icons-material/History';
import SearchIcon from '@mui/icons-material/Search';
import PaidIcon from '@mui/icons-material/Paid';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SendIcon from '@mui/icons-material/Send';
import LoginIcon from '@mui/icons-material/Login';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import CampaignIcon from '@mui/icons-material/Campaign';
import DescriptionIcon from '@mui/icons-material/Description';
import ChatIcon from '@mui/icons-material/Chat';
import ScienceIcon from '@mui/icons-material/Science';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import TuneIcon from '@mui/icons-material/Tune';
import SpeedIcon from '@mui/icons-material/Speed';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DnsIcon from '@mui/icons-material/Dns';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import LockIcon from '@mui/icons-material/Lock';
import LockResetIcon from '@mui/icons-material/LockReset';
import LogoutIcon from '@mui/icons-material/Logout';
import ShieldIcon from '@mui/icons-material/Shield';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import ApartmentIcon from '@mui/icons-material/Apartment';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ReplayIcon from '@mui/icons-material/Replay';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import StorageIcon from '@mui/icons-material/Storage';
import BlockIcon from '@mui/icons-material/Block';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { auditService } from '../../services/auditService';
import type { AuditData } from '../../services/auditService';
import { isOk } from '../../services/apiClient';
import { formatDateTime } from '../../utils/datetime';

/**
 * Tono del chip de acción. NO se usa el `color` de MUI a propósito: en el tema OSCURO de
 * la marca `primary` es navy (#0a1628) y `secondary` azul oscuro (#2a3d5f), así que los
 * chips quedaban ilegibles sobre el fondo oscuro. Aquí cada tono tiene su valor para
 * claro y oscuro, y se aplica al TEXTO, al BORDE y al ICONO.
 */
type ChipTone = 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'gray';

const TONE_COLORS: Record<ChipTone, { light: string; dark: string }> = {
  blue:   { light: '#0075be', dark: '#5ab8ff' },
  cyan:   { light: '#0e7490', dark: '#22d3ee' },
  green:  { light: '#15803d', dark: '#34d399' },
  amber:  { light: '#b45309', dark: '#fbbf24' },
  red:    { light: '#c62828', dark: '#f87171' },
  purple: { light: '#7c3aed', dark: '#c084fc' },
  gray:   { light: '#64748b', dark: '#a3b3cc' },
};

// Metadatos por tipo de acción (etiqueta + color + icono). Debe cubrir TODAS las acciones
// que emiten las lambdas (`_audit(...)`): una acción sin entrada cae al chip gris sin icono.
const ACTION_META: Record<string, { label: string; tone: ChipTone; icon: ReactElement }> = {
  // ── Administración de clientes ──
  'customer.realSend': { label: 'Envíos por cliente', tone: 'amber', icon: <SendIcon fontSize="small" /> },
  'customer.features': { label: 'Funciones del cliente', tone: 'blue', icon: <TuneIcon fontSize="small" /> },
  'customer.limits': { label: 'Cuotas de envío', tone: 'amber', icon: <SpeedIcon fontSize="small" /> },
  'customer.delete': { label: 'Cliente eliminado', tone: 'red', icon: <DeleteForeverIcon fontSize="small" /> },
  'sendingConfig.set': { label: 'IP dedicada', tone: 'blue', icon: <DnsIcon fontSize="small" /> },
  'sendingConfig.remove': { label: 'IP dedicada quitada', tone: 'amber', icon: <DnsIcon fontSize="small" /> },
  'pricing.update': { label: 'Tarifas', tone: 'green', icon: <PaidIcon fontSize="small" /> },
  'config.set': { label: 'Configuración', tone: 'cyan', icon: <SettingsIcon fontSize="small" /> },
  // ── Usuarios y roles ──
  'user.role': { label: 'Cambio de rol', tone: 'blue', icon: <AdminPanelSettingsIcon fontSize="small" /> },
  'user.tenantRole': { label: 'Cambio de sub-rol', tone: 'blue', icon: <AdminPanelSettingsIcon fontSize="small" /> },
  'user.create': { label: 'Usuario creado', tone: 'green', icon: <PersonAddIcon fontSize="small" /> },
  'user.delete': { label: 'Usuario eliminado', tone: 'red', icon: <PersonRemoveIcon fontSize="small" /> },
  // ── Seguridad ──
  'security.login': { label: 'Ingreso', tone: 'purple', icon: <LoginIcon fontSize="small" /> },
  'security.token': { label: 'Token', tone: 'purple', icon: <VpnKeyIcon fontSize="small" /> },
  'security.lockout': { label: 'Cuenta bloqueada', tone: 'red', icon: <LockIcon fontSize="small" /> },
  'security.2fa.challenge': { label: '2FA solicitado', tone: 'purple', icon: <ShieldIcon fontSize="small" /> },
  'security.2fa.success': { label: '2FA correcto', tone: 'green', icon: <ShieldIcon fontSize="small" /> },
  'security.2fa.fail': { label: '2FA incorrecto', tone: 'amber', icon: <ShieldIcon fontSize="small" /> },
  'security.2fa.lockout': { label: '2FA bloqueado', tone: 'red', icon: <LockIcon fontSize="small" /> },
  'security.2fa.enable': { label: '2FA activado', tone: 'green', icon: <ShieldIcon fontSize="small" /> },
  'security.2fa.disable': { label: '2FA desactivado', tone: 'red', icon: <ShieldIcon fontSize="small" /> },
  'security.password': { label: 'Contraseña cambiada', tone: 'amber', icon: <LockResetIcon fontSize="small" /> },
  'security.recovery': { label: 'Recuperación solicitada', tone: 'amber', icon: <LockResetIcon fontSize="small" /> },
  'security.register': { label: 'Empresa registrada', tone: 'green', icon: <ApartmentIcon fontSize="small" /> },
  'security.activation': { label: 'Cuenta activada', tone: 'green', icon: <MarkEmailReadIcon fontSize="small" /> },
  'security.logout': { label: 'Cierre de sesión', tone: 'purple', icon: <LogoutIcon fontSize="small" /> },
  // ── Soporte ──
  'support.impersonate': { label: 'Vista como cliente', tone: 'amber', icon: <VisibilityIcon fontSize="small" /> },
  'support.resendActivation': { label: 'Reenvío de activación', tone: 'cyan', icon: <MarkEmailReadIcon fontSize="small" /> },
  'support.forceReset': { label: 'Reseteo de contraseña', tone: 'amber', icon: <LockResetIcon fontSize="small" /> },
  'support.revokeSessions': { label: 'Sesiones cerradas', tone: 'red', icon: <LogoutIcon fontSize="small" /> },
  // ── Contenido ──
  'campaign.create': { label: 'Campaña creada', tone: 'cyan', icon: <CampaignIcon fontSize="small" /> },
  'campaign.delete': { label: 'Campaña eliminada', tone: 'red', icon: <DeleteForeverIcon fontSize="small" /> },
  'campaign.request-approval': { label: 'Aprobación solicitada', tone: 'cyan', icon: <PendingActionsIcon fontSize="small" /> },
  'campaign.approve': { label: 'Campaña aprobada', tone: 'green', icon: <ThumbUpIcon fontSize="small" /> },
  'campaign.reject': { label: 'Campaña rechazada', tone: 'red', icon: <ThumbDownIcon fontSize="small" /> },
  'campaign.update': { label: 'Campaña editada', tone: 'cyan', icon: <CampaignIcon fontSize="small" /> },
  'template.create': { label: 'Plantilla correo', tone: 'cyan', icon: <DescriptionIcon fontSize="small" /> },
  'template.delete': { label: 'Plantilla eliminada', tone: 'red', icon: <DescriptionIcon fontSize="small" /> },
  'template.admin-delete': { label: 'Plantilla eliminada (admin)', tone: 'red', icon: <DescriptionIcon fontSize="small" /> },
  'messageTemplate.create': { label: 'Plantilla mensaje', tone: 'cyan', icon: <ChatIcon fontSize="small" /> },
  'messageTemplate.update': { label: 'Plantilla editada', tone: 'cyan', icon: <ChatIcon fontSize="small" /> },
  'messageTemplate.delete': { label: 'Plantilla mensaje eliminada', tone: 'red', icon: <ChatIcon fontSize="small" /> },
  // ── Bases de datos (datos personales) ──
  'database.register': { label: 'Base cargada', tone: 'cyan', icon: <StorageIcon fontSize="small" /> },
  'database.delete': { label: 'Base eliminada', tone: 'red', icon: <StorageIcon fontSize="small" /> },
  // ── Identidades de envío ──
  'domain.add': { label: 'Dominio agregado', tone: 'blue', icon: <DnsIcon fontSize="small" /> },
  'domain.delete': { label: 'Dominio eliminado', tone: 'red', icon: <DnsIcon fontSize="small" /> },
  // ── Cumplimiento (lista negra) ──
  'blacklist.add': { label: 'Lista negra: alta', tone: 'amber', icon: <BlockIcon fontSize="small" /> },
  'blacklist.delete': { label: 'Lista negra: baja', tone: 'red', icon: <BlockIcon fontSize="small" /> },
  // ── Envíos ──
  'send.samples': { label: 'Muestras', tone: 'amber', icon: <ScienceIcon fontSize="small" /> },
  'send.real': { label: 'Envío real', tone: 'green', icon: <MarkEmailReadIcon fontSize="small" /> },
  'job.requeue': { label: 'Reencolado', tone: 'amber', icon: <ReplayIcon fontSize="small" /> },
  'schedule.create': { label: 'Envío programado', tone: 'blue', icon: <ScheduleIcon fontSize="small" /> },
  'schedule.cancel': { label: 'Programación cancelada', tone: 'amber', icon: <ScheduleIcon fontSize="small" /> },
  'cascade.dispatch': { label: 'Cascada lanzada', tone: 'purple', icon: <AltRouteIcon fontSize="small" /> },
  // ── Dinero ──
  'balance.adjustment': { label: 'Ajuste de saldo', tone: 'blue', icon: <PaidIcon fontSize="small" /> },
  'balance.topup.approve': { label: 'Recarga aprobada', tone: 'green', icon: <AccountBalanceWalletIcon fontSize="small" /> },
  'balance.topup.reject': { label: 'Recarga rechazada', tone: 'red', icon: <AccountBalanceWalletIcon fontSize="small" /> },
  'balance.topup.request': { label: 'Recarga solicitada', tone: 'amber', icon: <AccountBalanceWalletIcon fontSize="small" /> },
  'balance.topup.init': { label: 'Recarga iniciada (Wompi)', tone: 'cyan', icon: <AccountBalanceWalletIcon fontSize="small" /> },
  'balance.topup.wompi': { label: 'Recarga acreditada (Wompi)', tone: 'green', icon: <AccountBalanceWalletIcon fontSize="small" /> },
  // ── Preferencias de la cuenta ──
  'notifications.prefs': { label: 'Avisos del owner', tone: 'blue', icon: <NotificationsIcon fontSize="small" /> },
};

// Familia de la acción (por prefijo) para las que NO estén en el catálogo: así una acción
// nueva del backend sigue saliendo con color/icono coherente en vez de un chip gris.
const FAMILY_META: Array<[string, { tone: ChipTone; icon: ReactElement }]> = [
  ['security.', { tone: 'purple', icon: <ShieldIcon fontSize="small" /> }],
  ['support.', { tone: 'amber', icon: <SupportAgentIcon fontSize="small" /> }],
  ['balance.', { tone: 'blue', icon: <AccountBalanceWalletIcon fontSize="small" /> }],
  ['campaign.', { tone: 'cyan', icon: <CampaignIcon fontSize="small" /> }],
  ['customer.', { tone: 'blue', icon: <ApartmentIcon fontSize="small" /> }],
  ['user.', { tone: 'blue', icon: <AdminPanelSettingsIcon fontSize="small" /> }],
  ['send.', { tone: 'green', icon: <SendIcon fontSize="small" /> }],
  ['schedule.', { tone: 'blue', icon: <ScheduleIcon fontSize="small" /> }],
  ['cascade.', { tone: 'purple', icon: <AltRouteIcon fontSize="small" /> }],
  ['template.', { tone: 'cyan', icon: <DescriptionIcon fontSize="small" /> }],
  ['messageTemplate.', { tone: 'cyan', icon: <ChatIcon fontSize="small" /> }],
  ['database.', { tone: 'cyan', icon: <StorageIcon fontSize="small" /> }],
  ['domain.', { tone: 'blue', icon: <DnsIcon fontSize="small" /> }],
  ['blacklist.', { tone: 'amber', icon: <BlockIcon fontSize="small" /> }],
  ['notifications.', { tone: 'blue', icon: <NotificationsIcon fontSize="small" /> }],
];

/** Color + icono de una acción: catálogo exacto → familia por prefijo → genérico. */
const actionMeta = (a: string): { tone: ChipTone; icon: ReactElement } => {
  const exact = ACTION_META[a];
  if (exact) return { tone: exact.tone, icon: exact.icon };
  const fam = FAMILY_META.find(([p]) => a.startsWith(p));
  return fam ? fam[1] : { tone: 'gray', icon: <HistoryIcon fontSize="small" /> };
};

const actionLabel = (a: string) => ACTION_META[a]?.label ?? a;

// La fecha se guarda en UTC sin zona ('YYYY-MM-DD HH:MM:SS'); se normaliza a UTC (Z) y se
// muestra en hora local con el formato unificado DD-MM-YYYY HH:MM:SS.
const fmtDate = (raw: string) => {
  if (!raw) return '—';
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z';
  return formatDateTime(iso);
};

/**
 * Sección admin: AUDITORÍA. Bitácora de acciones administrativas sensibles (quién
 * hizo qué y cuándo): envíos por cliente, roles, tarifas y configuración.
 */
export const AuditoriaSection = () => {
  const isDark = useTheme().palette.mode === 'dark';
  const [month, setMonth] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await auditService.list(month, action, actor.trim(), dateFrom, dateTo);
    setLoading(false);
    if (isOk(res) && res.data) setData(res.data);
    else setError(res.description || 'No se pudo cargar la auditoría.');
    setPage(0); // vuelve a la primera página al recargar/filtrar
  }, [month, action, actor, dateFrom, dateTo]);

  /** Exporta las entradas FILTRADAS (todas, no solo la página) a CSV. */
  const exportCsv = () => {
    const entries = data?.entries ?? [];
    if (!entries.length) return;
    const esc = (v: string) => {
      const s = String(v ?? '');
      return s.includes(';') || s.includes('"') || /[\r\n]/.test(s)
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [['Fecha', 'Actor', 'Empresa', 'Acción', 'Objetivo', 'Detalle']]
      .concat(entries.map((e) => [e.date, e.actor, e.customer, e.action, e.target, e.detail]));
    const csv = rows.map((r) => r.map(esc).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const range = dateFrom || dateTo ? `_${dateFrom || 'inicio'}_a_${dateTo || 'hoy'}` : (month ? `_${month}` : '');
    a.download = `auditoria${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  useEffect(() => {
    load();
  }, [load]);

  const entries = data?.entries ?? [];
  const pageEntries = useMemo(
    () => entries.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [entries, page, rowsPerPage],
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <HistoryIcon color="primary" />
          <Typography variant="h4">Auditoría</Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportCsv}
                  disabled={loading || !(data?.entries?.length)}>
            Exportar CSV
          </Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Registro de acciones sensibles: <strong>seguridad</strong> (ingresos, contraseñas
        incorrectas, usuarios inexistentes, tokens), administración (envíos por cliente, roles,
        tarifas, configuración), <strong>contenido</strong> (campañas y plantillas creadas) y
        <strong> envíos</strong> (muestras y envíos reales), con quién y cuándo.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {data?.truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Mostrando los eventos más recientes (se alcanzó el tope). Acota por mes o acción.
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField type="month" size="small" label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} helperText="Vacío = recientes" />
          <TextField select size="small" label="Acción" value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todas</MenuItem>
            {(data?.actions ?? []).map((a) => (
              <MenuItem key={a} value={a}>{actionLabel(a)}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Actor"
            placeholder="correo o id…"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
          />
          <TextField type="date" size="small" label="Desde" value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }}
            helperText="Rango para el export" />
          <TextField type="date" size="small" label="Hasta" value={dateTo}
            onChange={(e) => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Fecha</TableCell>
              <TableCell>Actor</TableCell>
              <TableCell>Acción</TableCell>
              <TableCell>Objetivo</TableCell>
              <TableCell>Detalle</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && !data && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {!loading && data && (data.entries?.length ?? 0) === 0 && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>No hay eventos registrados para el filtro.</TableCell></TableRow>
            )}
            {pageEntries.map((e) => {
              const meta = actionMeta(e.action);
              const hue = TONE_COLORS[meta.tone][isDark ? 'dark' : 'light'];
              return (
                <TableRow key={e.auditId} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="caption">{fmtDate(e.date)}</Typography></TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{e.actor || '—'}</Typography>
                    {e.customer && <Typography variant="caption" color="text.secondary">{e.customer}</Typography>}
                  </TableCell>
                  <TableCell>
                    {/* Chip OUTLINED con el color del TONO aplicado a texto, borde e icono
                        (no se usa `color` de MUI: en el tema oscuro primary/secondary son
                        navy y el chip quedaba ilegible). */}
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={meta.icon}
                      label={actionLabel(e.action)}
                      sx={{
                        fontWeight: 600,
                        color: hue,
                        borderColor: hue,
                        '& .MuiChip-icon': { color: hue },
                      }}
                    />
                  </TableCell>
                  <TableCell><Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{e.target || '—'}</Typography></TableCell>
                  <TableCell><Typography variant="body2" color="text.secondary">{e.detail || '—'}</Typography></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={entries.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          labelRowsPerPage="Filas por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
        />
      </TableContainer>
    </Box>
  );
};
