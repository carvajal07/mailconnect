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
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import DnsIcon from '@mui/icons-material/Dns';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { domainsService } from '../../services/domainsService';
import type { SenderDomain, DomainStatus, DnsRecord } from '../../services/domainsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { formatDateTime } from '../../utils/datetime';

const STATUS_META: Record<DomainStatus, { label: string; color: 'success' | 'warning' | 'error'; icon: React.ReactElement }> = {
  verified: { label: 'Verificado', color: 'success', icon: <CheckCircleIcon fontSize="small" /> },
  pending: { label: 'Pendiente de DNS', color: 'warning', icon: <HourglassEmptyIcon fontSize="small" /> },
  failed: { label: 'Falló', color: 'error', icon: <ErrorOutlineIcon fontSize="small" /> },
};

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
  const [newDomain, setNewDomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [recordsView, setRecordsView] = useState<SenderDomain | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await domainsService.list();
    setLoading(false);
    if (isOk(res) && res.data?.domains) setDomains(res.data.domains);
    else if (!isOk(res)) notify(res.description || 'No se pudieron cargar los dominios.', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const d = newDomain.trim().toLowerCase();
    if (!d) return notify('Indica un dominio (ej. empresa.com).', 'warning');
    setAdding(true);
    const res = await domainsService.add(d);
    setAdding(false);
    if (isOk(res) && res.data) {
      notify('Dominio registrado. Publica los registros DNS para verificarlo.', 'success');
      setAddOpen(false);
      setNewDomain('');
      await load();
      // Abre directamente los registros DNS del dominio recién creado.
      setRecordsView(res.data);
    } else {
      notify(res.description || 'No se pudo registrar el dominio.', 'error');
    }
  };

  const handleDelete = async (d: SenderDomain) => {
    const ok = await confirm({
      title: 'Eliminar dominio',
      message: `¿Eliminar el dominio "${d.domain}"? Dejará de estar disponible como remitente y se quitará la identidad en SES.`,
      confirmText: 'Eliminar',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeletingId(d.domainId);
    const res = await domainsService.delete(d.domainId);
    setDeletingId(null);
    if (isOk(res)) {
      notify('Dominio eliminado.', 'success');
      load();
    } else {
      notify(res.description || 'No se pudo eliminar el dominio.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Dominios de envío</Typography>
          <Typography variant="body2" color="text.secondary">
            Configura tu propio dominio para enviar desde tus direcciones (ej. comunicaciones@tuempresa.com).
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={load} disabled={loading}>
            Actualizar
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setNewDomain(''); setAddOpen(true); }}>
            Agregar dominio
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Para usar tu dominio: <strong>1)</strong> agrégalo aquí, <strong>2)</strong> publica en tu proveedor
        de DNS los registros que te mostramos (1 TXT de verificación + 3 CNAME de firma DKIM), y{' '}
        <strong>3)</strong> pulsa <strong>Actualizar</strong> hasta que quede <em>Verificado</em>. La
        propagación de DNS puede tardar de minutos a unas horas. Solo los dominios <strong>verificados</strong>
        se pueden elegir como remitente al crear una campaña.
      </Alert>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Dominio</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Registrado</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {domains.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {loading ? 'Cargando…' : 'Aún no configuras ningún dominio propio.'}
                </TableCell>
              </TableRow>
            )}
            {domains.map((d) => {
              const meta = STATUS_META[d.status] ?? STATUS_META.pending;
              return (
                <TableRow key={d.domainId} hover>
                  <TableCell sx={{ fontWeight: 600 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <DnsIcon fontSize="small" color="action" />
                      {d.domain}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" color={meta.color} icon={meta.icon} label={meta.label} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(d.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Ver registros DNS">
                      <IconButton color="info" onClick={() => setRecordsView(d)}>
                        <VisibilityIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Eliminar dominio">
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

      {/* Diálogo: agregar dominio */}
      <Dialog open={addOpen} onClose={() => !adding && setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Agregar dominio de envío</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Escribe el dominio desde el que quieres enviar (sin <code>www</code> ni <code>@</code>).
              Debes ser dueño del dominio y poder editar sus registros DNS.
            </Typography>
            <TextField
              label="Dominio"
              placeholder="tuempresa.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              fullWidth
              autoFocus
              InputProps={{ startAdornment: <DnsIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={adding}>Cancelar</Button>
          <Button
            variant="contained"
            startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
            onClick={handleAdd}
            disabled={adding || !newDomain.trim()}
          >
            Registrar y ver DNS
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo: registros DNS del dominio */}
      <Dialog open={!!recordsView} onClose={() => setRecordsView(null)} maxWidth="md" fullWidth>
        <DialogTitle>Registros DNS — {recordsView?.domain}</DialogTitle>
        <DialogContent dividers>
          {recordsView && (
            <Stack spacing={2}>
              {recordsView.status === 'verified' ? (
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
                    {(recordsView.records || []).map((r: DnsRecord, i: number) => (
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
          <Button onClick={() => setRecordsView(null)}>Cerrar</Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { setRecordsView(null); load(); }}>
            Actualizar estado
          </Button>
        </DialogActions>
      </Dialog>

      {ConfirmDialog}
      {FeedbackSnackbar}
    </Box>
  );
};
