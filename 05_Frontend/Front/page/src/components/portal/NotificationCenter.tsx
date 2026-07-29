import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, IconButton, Badge, Popover, Typography, Stack, Divider, Button,
  Tooltip, CircularProgress, Slide, Paper,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { notificationsInbox, type PortalNotification, type NotificationLevel } from '../../services/notificationsService';
import { isOk } from '../../services/apiClient';
import { formatDateTime } from '../../utils/datetime';

/**
 * Centro de notificaciones del portal: campanita con contador + panel, y los avisos
 * NUEVOS asomando abajo a la derecha.
 *
 * Se refresca por sondeo cada `POLL_MS`. No hay websockets en la plataforma y montarlos
 * por esto sería desproporcionado: son avisos de minutos (una campaña por aprobar, saldo
 * bajo), no un chat. El sondeo se PAUSA cuando la pestaña está oculta — si no, cada
 * pestaña abierta en segundo plano seguiría pegándole a la API toda la tarde.
 */

const POLL_MS = 60_000;
/** Cuántos avisos nuevos se asoman a la vez. Más que esto tapa la pantalla. */
const MAX_TOASTS = 3;
const TOAST_MS = 8_000;

const ICONO: Record<NotificationLevel, React.ReactNode> = {
  success: <CheckCircleIcon fontSize="small" />,
  error: <ErrorOutlineIcon fontSize="small" />,
  warning: <WarningAmberIcon fontSize="small" />,
  info: <InfoOutlinedIcon fontSize="small" />,
};

const COLOR: Record<NotificationLevel, 'success' | 'error' | 'warning' | 'info'> = {
  success: 'success', error: 'error', warning: 'warning', info: 'info',
};

interface Props {
  /** Lleva al tab que corresponde al aviso (`link`). */
  onNavigate?: (tab: string) => void;
}

export const NotificationCenter = ({ onNavigate }: Props) => {
  const [items, setItems] = useState<PortalNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [cargando, setCargando] = useState(false);
  const [toasts, setToasts] = useState<PortalNotification[]>([]);
  /** Ids ya vistos: sin esto, cada sondeo volvería a asomar los mismos avisos. */
  const vistos = useRef<Set<string> | null>(null);

  const cargar = useCallback(async (silencioso = true) => {
    if (!silencioso) setCargando(true);
    const res = await notificationsInbox.list();
    if (!silencioso) setCargando(false);
    if (!isOk(res)) return;
    const lista = res.data?.items ?? [];
    setItems(lista);
    setUnread(res.data?.unread ?? 0);

    // La PRIMERA carga solo siembra la memoria: al entrar al portal no tiene sentido que
    // salten de golpe todos los avisos acumulados de la semana.
    if (vistos.current === null) {
      vistos.current = new Set(lista.map((n) => n.notificationId));
      return;
    }
    const nuevos = lista.filter((n) => !n.read && !vistos.current!.has(n.notificationId));
    nuevos.forEach((n) => vistos.current!.add(n.notificationId));
    if (nuevos.length) setToasts((prev) => [...nuevos, ...prev].slice(0, MAX_TOASTS));
  }, []);

  useEffect(() => {
    void cargar();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void cargar();
    }, POLL_MS);
    // Al volver a la pestaña se refresca de una: es cuando el usuario mira.
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
  }, [cargar]);

  // Los avisos se retiran solos; si no, se acumulan tapando la esquina.
  useEffect(() => {
    if (!toasts.length) return;
    const id = window.setTimeout(() => setToasts((prev) => prev.slice(0, -1)), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toasts]);

  const abrir = async (e: React.MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
    await cargar(false);
  };

  const marcarLeida = async (n: PortalNotification) => {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.notificationId === n.notificationId ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      await notificationsInbox.markRead(n.notificationId);
    }
  };

  const irA = async (n: PortalNotification) => {
    await marcarLeida(n);
    setToasts((prev) => prev.filter((t) => t.notificationId !== n.notificationId));
    setAnchor(null);
    if (n.link && onNavigate) onNavigate(n.link);
  };

  const marcarTodas = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await notificationsInbox.markAllRead();
  };

  return (
    <>
      <Tooltip title="Notificaciones">
        <IconButton color="inherit" onClick={abrir}>
          <Badge badgeContent={unread} color="error" max={99}>
            {unread > 0 ? <NotificationsIcon /> : <NotificationsNoneIcon />}
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: '100vw' } } }}
      >
        <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
            Notificaciones{unread ? ` (${unread})` : ''}
          </Typography>
          {unread > 0 && (
            <Button size="small" startIcon={<DoneAllIcon />} onClick={marcarTodas}>
              Marcar leídas
            </Button>
          )}
        </Stack>
        <Divider />

        {cargando && <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>}

        {!cargando && items.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 5, px: 3, color: 'text.secondary' }}>
            <NotificationsNoneIcon sx={{ fontSize: 40, opacity: 0.4 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              No tienes notificaciones. Aquí verás las campañas por aprobar, los avisos de
              saldo y el estado de tus envíos.
            </Typography>
          </Box>
        )}

        <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
          {items.map((n) => (
            <Box
              key={n.notificationId}
              onClick={() => irA(n)}
              sx={{
                display: 'flex', gap: 1.25, px: 2, py: 1.5, cursor: 'pointer',
                borderLeft: '3px solid',
                borderColor: n.read ? 'transparent' : `${COLOR[n.level] || 'info'}.main`,
                bgcolor: n.read ? 'transparent' : 'action.hover',
                '&:hover': { bgcolor: 'action.selected' },
              }}
            >
              <Box sx={{ color: `${COLOR[n.level] || 'info'}.main`, mt: 0.25 }}>
                {ICONO[n.level] || ICONO.info}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={n.read ? 400 : 700}>{n.title}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {n.body}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {formatDateTime(n.createdAt)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Popover>

      {/* Avisos NUEVOS abajo a la derecha. `pointerEvents:'none'` en el contenedor para no
          bloquear los clics de la página detrás; cada tarjeta los vuelve a habilitar. */}
      <Box sx={{
        position: 'fixed', right: 16, bottom: 16, zIndex: (t) => t.zIndex.snackbar,
        display: 'flex', flexDirection: 'column-reverse', gap: 1,
        pointerEvents: 'none', maxWidth: 'calc(100vw - 32px)',
      }}>
        {toasts.map((n) => (
          <Slide key={n.notificationId} direction="left" in mountOnEnter unmountOnExit>
            <Paper elevation={8} sx={{
              width: 360, maxWidth: '100%', p: 1.5, pointerEvents: 'auto',
              borderLeft: '4px solid', borderColor: `${COLOR[n.level] || 'info'}.main`,
            }}>
              <Stack direction="row" spacing={1.25} alignItems="flex-start">
                <Box sx={{ color: `${COLOR[n.level] || 'info'}.main`, mt: 0.25 }}>
                  {ICONO[n.level] || ICONO.info}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1, cursor: n.link ? 'pointer' : 'default' }}
                  onClick={() => n.link && irA(n)}>
                  <Typography variant="body2" fontWeight={700}>{n.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{n.body}</Typography>
                </Box>
                <IconButton size="small" onClick={() =>
                  setToasts((prev) => prev.filter((t) => t.notificationId !== n.notificationId))}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Paper>
          </Slide>
        ))}
      </Box>
    </>
  );
};
