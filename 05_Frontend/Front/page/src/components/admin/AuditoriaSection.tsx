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
import { auditService } from '../../services/auditService';
import type { AuditData } from '../../services/auditService';
import { isOk } from '../../services/apiClient';
import { formatDateTime } from '../../utils/datetime';

type ChipColor = 'primary' | 'success' | 'warning' | 'info' | 'default' | 'error' | 'secondary';

// Metadatos por tipo de acción (etiqueta + color + icono). Debe cubrir TODAS las acciones
// que emiten las lambdas (`_audit(...)`): una acción sin entrada cae al chip gris sin icono.
const ACTION_META: Record<string, { label: string; color: ChipColor; icon: ReactElement }> = {
  // ── Administración de clientes ──
  'customer.realSend': { label: 'Envíos por cliente', color: 'warning', icon: <SendIcon fontSize="small" /> },
  'customer.features': { label: 'Funciones del cliente', color: 'primary', icon: <TuneIcon fontSize="small" /> },
  'customer.limits': { label: 'Cuotas de envío', color: 'warning', icon: <SpeedIcon fontSize="small" /> },
  'customer.delete': { label: 'Cliente eliminado', color: 'error', icon: <DeleteForeverIcon fontSize="small" /> },
  'sendingConfig.set': { label: 'IP dedicada', color: 'primary', icon: <DnsIcon fontSize="small" /> },
  'sendingConfig.remove': { label: 'IP dedicada quitada', color: 'warning', icon: <DnsIcon fontSize="small" /> },
  'pricing.update': { label: 'Tarifas', color: 'success', icon: <PaidIcon fontSize="small" /> },
  'config.set': { label: 'Configuración', color: 'info', icon: <SettingsIcon fontSize="small" /> },
  // ── Usuarios y roles ──
  'user.role': { label: 'Cambio de rol', color: 'primary', icon: <AdminPanelSettingsIcon fontSize="small" /> },
  'user.tenantRole': { label: 'Cambio de sub-rol', color: 'primary', icon: <AdminPanelSettingsIcon fontSize="small" /> },
  'user.create': { label: 'Usuario creado', color: 'success', icon: <PersonAddIcon fontSize="small" /> },
  'user.delete': { label: 'Usuario eliminado', color: 'error', icon: <PersonRemoveIcon fontSize="small" /> },
  // ── Seguridad ──
  'security.login': { label: 'Ingreso', color: 'secondary', icon: <LoginIcon fontSize="small" /> },
  'security.token': { label: 'Token', color: 'secondary', icon: <VpnKeyIcon fontSize="small" /> },
  'security.lockout': { label: 'Cuenta bloqueada', color: 'error', icon: <LockIcon fontSize="small" /> },
  'security.2fa.challenge': { label: '2FA solicitado', color: 'secondary', icon: <ShieldIcon fontSize="small" /> },
  'security.2fa.success': { label: '2FA correcto', color: 'success', icon: <ShieldIcon fontSize="small" /> },
  'security.2fa.fail': { label: '2FA incorrecto', color: 'warning', icon: <ShieldIcon fontSize="small" /> },
  'security.2fa.lockout': { label: '2FA bloqueado', color: 'error', icon: <LockIcon fontSize="small" /> },
  // ── Soporte ──
  'support.impersonate': { label: 'Vista como cliente', color: 'warning', icon: <VisibilityIcon fontSize="small" /> },
  'support.resendActivation': { label: 'Reenvío de activación', color: 'info', icon: <MarkEmailReadIcon fontSize="small" /> },
  'support.forceReset': { label: 'Reseteo de contraseña', color: 'warning', icon: <LockResetIcon fontSize="small" /> },
  'support.revokeSessions': { label: 'Sesiones cerradas', color: 'error', icon: <LogoutIcon fontSize="small" /> },
  // ── Contenido ──
  'campaign.create': { label: 'Campaña creada', color: 'info', icon: <CampaignIcon fontSize="small" /> },
  'campaign.delete': { label: 'Campaña eliminada', color: 'error', icon: <DeleteForeverIcon fontSize="small" /> },
  'campaign.request-approval': { label: 'Aprobación solicitada', color: 'info', icon: <PendingActionsIcon fontSize="small" /> },
  'campaign.approve': { label: 'Campaña aprobada', color: 'success', icon: <ThumbUpIcon fontSize="small" /> },
  'campaign.reject': { label: 'Campaña rechazada', color: 'error', icon: <ThumbDownIcon fontSize="small" /> },
  'template.create': { label: 'Plantilla correo', color: 'info', icon: <DescriptionIcon fontSize="small" /> },
  'messageTemplate.create': { label: 'Plantilla mensaje', color: 'info', icon: <ChatIcon fontSize="small" /> },
  'messageTemplate.update': { label: 'Plantilla editada', color: 'info', icon: <ChatIcon fontSize="small" /> },
  // ── Envíos ──
  'send.samples': { label: 'Muestras', color: 'warning', icon: <ScienceIcon fontSize="small" /> },
  'send.real': { label: 'Envío real', color: 'success', icon: <MarkEmailReadIcon fontSize="small" /> },
  'job.requeue': { label: 'Reencolado', color: 'warning', icon: <ReplayIcon fontSize="small" /> },
  // ── Dinero ──
  'balance.adjustment': { label: 'Ajuste de saldo', color: 'primary', icon: <PaidIcon fontSize="small" /> },
  'balance.topup.approve': { label: 'Recarga aprobada', color: 'success', icon: <AccountBalanceWalletIcon fontSize="small" /> },
  'balance.topup.reject': { label: 'Recarga rechazada', color: 'error', icon: <AccountBalanceWalletIcon fontSize="small" /> },
};

// Familia de la acción (por prefijo) para las que NO estén en el catálogo: así una acción
// nueva del backend sigue saliendo con color/icono coherente en vez de un chip gris.
const FAMILY_META: Array<[string, { color: ChipColor; icon: ReactElement }]> = [
  ['security.', { color: 'secondary', icon: <ShieldIcon fontSize="small" /> }],
  ['support.', { color: 'warning', icon: <SupportAgentIcon fontSize="small" /> }],
  ['balance.', { color: 'primary', icon: <AccountBalanceWalletIcon fontSize="small" /> }],
  ['campaign.', { color: 'info', icon: <CampaignIcon fontSize="small" /> }],
  ['customer.', { color: 'primary', icon: <ApartmentIcon fontSize="small" /> }],
  ['user.', { color: 'primary', icon: <AdminPanelSettingsIcon fontSize="small" /> }],
  ['send.', { color: 'success', icon: <SendIcon fontSize="small" /> }],
  ['template.', { color: 'info', icon: <DescriptionIcon fontSize="small" /> }],
  ['messageTemplate.', { color: 'info', icon: <ChatIcon fontSize="small" /> }],
];

/** Color + icono de una acción: catálogo exacto → familia por prefijo → genérico. */
const actionMeta = (a: string): { color: ChipColor; icon: ReactElement } => {
  const exact = ACTION_META[a];
  if (exact) return { color: exact.color, icon: exact.icon };
  const fam = FAMILY_META.find(([p]) => a.startsWith(p));
  return fam ? fam[1] : { color: 'default', icon: <HistoryIcon fontSize="small" /> };
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
              return (
                <TableRow key={e.auditId} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="caption">{fmtDate(e.date)}</Typography></TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{e.actor || '—'}</Typography>
                    {e.customer && <Typography variant="caption" color="text.secondary">{e.customer}</Typography>}
                  </TableCell>
                  <TableCell>
                    {/* Chip OUTLINED (claro, no bloques de color sólido) forzando que el
                        ICONO tome el color del chip: por defecto MUI le pone el gris
                        secundario y todas las acciones se veían iguales. */}
                    <Chip
                      size="small"
                      color={meta.color}
                      variant="outlined"
                      icon={meta.icon}
                      label={actionLabel(e.action)}
                      sx={{ fontWeight: 600, '& .MuiChip-icon': { color: 'inherit' } }}
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
