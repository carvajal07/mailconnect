import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Button,
  TextField,
  Chip,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import DnsIcon from '@mui/icons-material/Dns';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import SendIcon from '@mui/icons-material/Send';
import { domainsService, senderKindOf } from '../../services/domainsService';
import type { SenderDomain, DomainStatus, DnsRecord, SenderKind } from '../../services/domainsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { formatDateTime } from '../../utils/datetime';

const STATUS_META: Record<DomainStatus, { color: 'success' | 'warning' | 'error'; icon: React.ReactElement }> = {
  verified: { color: 'success', icon: <CheckCircleIcon fontSize="small" /> },
  pending: { color: 'warning', icon: <HourglassEmptyIcon fontSize="small" /> },
  failed: { color: 'error', icon: <ErrorOutlineIcon fontSize="small" /> },
};

/** Etiqueta del estado, sensible al tipo (los pendientes se verifican distinto). */
const statusLabel = (d: SenderDomain): string => {
  if (d.status === 'verified') return 'Verificado';
  if (d.status === 'failed') return 'Falló';
  return senderKindOf(d) === 'email' ? 'Pendiente de correo' : 'Pendiente de DNS';
};

const KIND_META: Record<SenderKind, { label: string; icon: React.ReactElement }> = {
  domain: { label: 'Dominio', icon: <DnsIcon fontSize="small" color="action" /> },
  email: { label: 'Correo', icon: <AlternateEmailIcon fontSize="small" color="action" /> },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN_RE = /^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;

const copy = (text: string, notify: (m: string, s?: 'success' | 'info') => void) => {
  navigator.clipboard?.writeText(text).then(
    () => notify('Copiado al portapapeles.', 'info'),
    () => {},
  );
};

export const DominiosSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  const [domains, setDomains] = useState<SenderDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<SenderKind>('domain');
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [resending, setResending] = useState(false);
  const [detailView, setDetailView] = useState<SenderDomain | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await domainsService.list();
    setLoading(false);
    if (isOk(res) && res.data?.domains) setDomains(res.data.domains);
    else if (!isOk(res)) notify(res.description || 'No se pudieron cargar los remitentes.', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = (kind: SenderKind) => {
    setAddKind(kind);
    setNewValue('');
    setAddOpen(true);
  };

  const handleAdd = async () => {
    const v = newValue.trim().toLowerCase();
    if (addKind === 'email') {
      if (!EMAIL_RE.test(v)) return notify('Indica un correo válido (ej. ventas@tuempresa.com).', 'warning');
    } else if (!DOMAIN_RE.test(v)) {
      return notify('Indica un dominio válido (ej. empresa.com).', 'warning');
    }
    setAdding(true);
    const res = await domainsService.add(v);
    setAdding(false);
    if (isOk(res) && res.data) {
      notify(
        res.data.kind === 'email'
          ? 'Correo registrado. Revisa tu bandeja y haz clic en el enlace de verificación.'
          : 'Dominio registrado. Publica los registros DNS para verificarlo.',
        'success',
      );
      setAddOpen(false);
      setNewValue('');
      await load();
      // Abre directamente las instrucciones del remitente recién creado.
      setDetailView(res.data);
    } else {
      notify(res.description || 'No se pudo registrar el remitente.', 'error');
    }
  };

  /** Reenvía el correo de verificación (SES) para un correo pendiente. */
  const handleResend = async (email: string) => {
    setResending(true);
    const res = await domainsService.add(email);
    setResending(false);
    if (isOk(res)) notify('Te reenviamos el correo de verificación. Revisa tu bandeja (y spam).', 'success');
    else notify(res.description || 'No se pudo reenviar la verificación.', 'error');
  };

  const handleDelete = async (d: SenderDomain) => {
    const isEmail = senderKindOf(d) === 'email';
    const ok = await confirm({
      title: isEmail ? 'Eliminar correo' : 'Eliminar dominio',
      message: `¿Eliminar "${d.domain}"? Dejará de estar disponible como remitente y se quitará la identidad en SES.`,
      confirmText: 'Eliminar',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeletingId(d.domainId);
    const res = await domainsService.delete(d.domainId);
    setDeletingId(null);
    if (isOk(res)) {
      notify('Remitente eliminado.', 'success');
      load();
    } else {
      notify(res.description || 'No se pudo eliminar el remitente.', 'error');
    }
  };

  const detailKind = detailView ? senderKindOf(detailView) : 'domain';

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Dominios y correos de envío</Typography>
          <Typography variant="body2" color="text.secondary">
            Verifica tu propio dominio (para enviar desde cualquier dirección, ej.
            comunicaciones@tuempresa.com) o un correo específico (para enviar solo desde esa dirección).
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={load} disabled={loading}>
            Actualizar
          </Button>
          <Button variant="outlined" startIcon={<AlternateEmailIcon />} onClick={() => openAdd('email')}>
            Agregar correo
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openAdd('domain')}>
            Agregar dominio
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Puedes verificar un <strong>dominio</strong> (publicando registros DNS: 1 TXT + 3 CNAME) o
        un <strong>correo</strong> específico (haciendo clic en el enlace que Amazon SES envía a esa
        dirección — sin tocar el DNS). El correo es más rápido si solo quieres enviar desde una
        dirección; el dominio te habilita cualquier dirección de tu empresa. Solo los remitentes{' '}
        <strong>verificados</strong> se pueden elegir al crear una campaña.
      </Alert>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Tipo</TableCell>
              <TableCell>Remitente</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Registrado</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {domains.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {loading ? 'Cargando…' : 'Aún no configuras ningún dominio o correo propio.'}
                </TableCell>
              </TableRow>
            )}
            {domains.map((d) => {
              const meta = STATUS_META[d.status] ?? STATUS_META.pending;
              const kind = senderKindOf(d);
              const kindMeta = KIND_META[kind];
              return (
                <TableRow key={d.domainId} hover>
                  <TableCell>
                    <Chip size="small" variant="outlined" icon={kindMeta.icon} label={kindMeta.label} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{d.domain}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" color={meta.color} icon={meta.icon} label={statusLabel(d)} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(d.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={kind === 'email' ? 'Ver instrucciones' : 'Ver registros DNS'}>
                      <IconButton color="info" onClick={() => setDetailView(d)}>
                        <VisibilityIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Eliminar">
                      <span>
                        <IconButton color="error" onClick={() => handleDelete(d)} disabled={deletingId === d.domainId}>
                          {deletingId === d.domainId ? <CircularProgress size={20} /> : <DeleteIcon />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Diálogo: agregar dominio o correo */}
      <Dialog open={addOpen} onClose={() => !adding && setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Agregar remitente de envío</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={addKind}
              onChange={(_, v) => { if (v) { setAddKind(v); setNewValue(''); } }}
            >
              <ToggleButton value="domain"><DnsIcon fontSize="small" sx={{ mr: 1 }} />Dominio</ToggleButton>
              <ToggleButton value="email"><AlternateEmailIcon fontSize="small" sx={{ mr: 1 }} />Correo</ToggleButton>
            </ToggleButtonGroup>

            {addKind === 'domain' ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  Escribe el dominio desde el que quieres enviar (sin <code>www</code> ni <code>@</code>).
                  Debes ser dueño del dominio y poder editar sus registros DNS. Te mostraremos los
                  registros a publicar (1 TXT + 3 CNAME).
                </Typography>
                <TextField
                  label="Dominio"
                  placeholder="tuempresa.com"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  fullWidth
                  autoFocus
                  InputProps={{ startAdornment: <DnsIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                />
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  Escribe el correo desde el que quieres enviar. Amazon SES le enviará un enlace de
                  verificación; debes tener acceso a esa bandeja para confirmarlo. Podrás enviar solo
                  desde esa dirección exacta.
                </Typography>
                <TextField
                  label="Correo"
                  placeholder="ventas@tuempresa.com"
                  type="email"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  fullWidth
                  autoFocus
                  InputProps={{ startAdornment: <AlternateEmailIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={adding}>Cancelar</Button>
          <Button
            variant="contained"
            startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
            onClick={handleAdd}
            disabled={adding || !newValue.trim()}
          >
            {addKind === 'email' ? 'Registrar y enviar verificación' : 'Registrar y ver DNS'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo: detalle del remitente (registros DNS para dominio, guía para correo) */}
      <Dialog open={!!detailView} onClose={() => setDetailView(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {detailKind === 'email' ? 'Verificación del correo' : 'Registros DNS'} — {detailView?.domain}
        </DialogTitle>
        <DialogContent dividers>
          {detailView && detailKind === 'email' && (
            <Stack spacing={2}>
              {detailView.status === 'verified' ? (
                <Alert severity="success" icon={<CheckCircleIcon />}>
                  Este correo ya está <strong>verificado</strong> y listo para usarse como remitente.
                </Alert>
              ) : (
                <>
                  <Alert severity="warning" icon={<MarkEmailUnreadIcon />}>
                    Sigue estos pasos para verificar <strong>{detailView.domain}</strong>. El enlace de
                    verificación vence en <strong>24 horas</strong>.
                  </Alert>
                  <Box component="ol" sx={{ pl: 3, m: 0, '& li': { mb: 1.5 } }}>
                    <li>
                      <Typography variant="body2">
                        Amazon SES envió un correo de verificación a <strong>{detailView.domain}</strong>.
                        Revisa esa bandeja (y la carpeta de <em>spam</em>). Remitente:{' '}
                        <code>no-reply-aws@amazon.com</code> · Asunto: <em>“Amazon SES Address Verification Request”</em>.
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2">
                        Abre ese correo y haz clic en el enlace <strong>“Verify this email address”</strong>
                        (verificar esta dirección).
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2">
                        Vuelve aquí y pulsa <strong>Actualizar estado</strong> hasta que quede{' '}
                        <em>Verificado</em>.
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2">
                        Listo: podrás elegir <strong>{detailView.domain}</strong> como remitente al crear
                        una campaña.
                      </Typography>
                    </li>
                  </Box>
                  <Box>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={resending ? <CircularProgress size={14} /> : <SendIcon />}
                      onClick={() => handleResend(detailView.domain)}
                      disabled={resending}
                    >
                      ¿No llegó? Reenviar correo de verificación
                    </Button>
                  </Box>
                </>
              )}
            </Stack>
          )}

          {detailView && detailKind === 'domain' && (
            <Stack spacing={2}>
              {detailView.status === 'verified' ? (
                <Alert severity="success">Este dominio ya está <strong>verificado</strong> y listo para usarse como remitente.</Alert>
              ) : (
                <Alert severity="warning">
                  Publica <strong>todos</strong> estos registros en el DNS de tu dominio. Cuando SES los
                  detecte, el estado pasará a <em>Verificado</em> (pulsa Actualizar).
                </Alert>
              )}
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tipo</TableCell>
                      <TableCell>Nombre / Host</TableCell>
                      <TableCell>Valor</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detailView.records || []).map((r: DnsRecord, i: number) => (
                      <TableRow key={i}>
                        <TableCell><Chip size="small" label={r.type} /></TableCell>
                        <TableCell sx={{ maxWidth: 260 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{r.name}</Typography>
                            <IconButton size="small" onClick={() => copy(r.name, notify)}><ContentCopyIcon sx={{ fontSize: 14 }} /></IconButton>
                          </Box>
                          {r.purpose && <Typography variant="caption" color="text.secondary">{r.purpose}</Typography>}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 300 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{r.value}</Typography>
                            <IconButton size="small" onClick={() => copy(r.value, notify)}><ContentCopyIcon sx={{ fontSize: 14 }} /></IconButton>
                          </Box>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="caption" color="text.secondary">
                Algunos proveedores agregan el dominio automáticamente al "Nombre"; si te queda duplicado
                (…tuempresa.com.tuempresa.com), usa solo la parte antes del dominio.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailView(null)}>Cerrar</Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { setDetailView(null); load(); }}>
            Actualizar estado
          </Button>
        </DialogActions>
      </Dialog>

      {ConfirmDialog}
      {FeedbackSnackbar}
    </Box>
  );
};
