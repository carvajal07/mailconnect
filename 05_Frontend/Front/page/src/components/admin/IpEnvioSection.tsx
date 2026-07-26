import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DnsIcon from '@mui/icons-material/Dns';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import { customerService, type CustomerSummary } from '../../services/customerService';
import { sendingConfigService, type SendingConfig } from '../../services/sendingConfigService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';

/**
 * Panel ADMIN "IP de envío": configura la IP de envío DEDICADA por cliente. Un cliente
 * sin configuración envía por el pool GENERAL (config set por defecto); uno configurado
 * (habilitado) envía por SU config set → su pool de IP dedicada en SES.
 */
export const IpEnvioSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [configs, setConfigs] = useState<SendingConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // Diálogo de alta/edición.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerSummary | null>(null);
  const [configurationSet, setConfigurationSet] = useState('');
  const [poolName, setPoolName] = useState('');
  const [ipsText, setIpsText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [cRes, sRes] = await Promise.all([customerService.list(), sendingConfigService.list()]);
    setLoading(false);
    if (isOk(cRes)) setCustomers(cRes.data?.customers ?? []);
    else notify(cRes.description || 'No se pudieron cargar los clientes.', 'error');
    if (isOk(sRes)) setConfigs(sRes.data?.configs ?? []);
    else notify(sRes.description || 'No se pudo cargar la configuración de envío.', 'error');
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const configByCustomer = useMemo(() => {
    const m = new Map<string, SendingConfig>();
    for (const c of configs) m.set(c.customerId, c);
    return m;
  }, [configs]);

  const dedicatedCount = configs.filter((c) => c.enabled).length;

  const openDialog = (customer: CustomerSummary) => {
    const existing = configByCustomer.get(customer.customerId);
    setEditing(customer);
    setConfigurationSet(existing?.configurationSet ?? '');
    setPoolName(existing?.poolName ?? '');
    setIpsText((existing?.ips ?? []).join('\n'));
    setEnabled(existing?.enabled ?? true);
    setNotes(existing?.notes ?? '');
    setOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    if (!configurationSet.trim()) {
      notify('Indica el nombre del configuration set de SES.', 'warning');
      return;
    }
    const ips = ipsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    const res = await sendingConfigService.set({
      customerId: editing.customerId,
      configurationSet: configurationSet.trim(),
      poolName: poolName.trim(),
      ips,
      enabled,
      notes: notes.trim(),
    });
    setSaving(false);
    if (isOk(res)) {
      notify('Configuración de envío guardada.', 'success');
      setOpen(false);
      void load();
    } else {
      notify(res.description || 'No se pudo guardar la configuración.', 'error');
    }
  };

  const remove = async (customer: CustomerSummary) => {
    const ok = await confirm({
      title: 'Quitar IP dedicada',
      message: `¿Quitar la IP de envío dedicada de "${customer.company}"? Volverá a enviar por el pool general.`,
      confirmText: 'Quitar',
      confirmColor: 'error',
    });
    if (!ok) return;
    const res = await sendingConfigService.remove(customer.customerId);
    if (isOk(res)) {
      notify('El cliente volvió al pool general.', 'success');
      void load();
    } else {
      notify(res.description || 'No se pudo quitar la configuración.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <DnsIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>IP de envío por cliente</Typography>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" variant="outlined" label={`${dedicatedCount} con IP dedicada`} />
        <IconButton size="small" onClick={() => void load()} title="Refrescar"><RefreshIcon fontSize="small" /></IconButton>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Un cliente <strong>sin configurar</strong> envía por el <strong>pool general</strong> (por donde
        envían todos). Si le asignas un <strong>configuration set</strong> y lo dejas
        <strong> habilitado</strong>, sus correos salen por ese config set → su <strong>IP dedicada</strong>.
        El config set y su pool de IP dedicada deben existir en <strong>SES</strong>, y el config set debe
        tener el <strong>mismo destino de eventos (SNS)</strong> que el general para no perder los reportes
        de rebote/queja. Solo aplica a los canales de correo (EM/EAU/EAP).
      </Alert>

      {loading ? (
        <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Cliente</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Envío</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Configuration set</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>IPs</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customers.map((c) => {
                const cfg = configByCustomer.get(c.customerId);
                const dedicated = !!cfg && cfg.enabled;
                return (
                  <TableRow key={c.customerId} hover>
                    <TableCell>{c.company || c.customerId}</TableCell>
                    <TableCell>
                      {cfg
                        ? <Chip size="small" color={dedicated ? 'success' : 'default'}
                                variant={dedicated ? 'filled' : 'outlined'}
                                label={dedicated ? 'IP dedicada' : 'Dedicada (deshabilitada)'} />
                        : <Chip size="small" variant="outlined" label="Pool general" />}
                    </TableCell>
                    <TableCell>{cfg?.configurationSet ?? '—'}</TableCell>
                    <TableCell>
                      {cfg?.ips && cfg.ips.length
                        ? <Tooltip title={cfg.ips.join(', ')}><span>{cfg.ips.length}</span></Tooltip>
                        : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => openDialog(c)} title="Configurar">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      {cfg && (
                        <IconButton size="small" color="error" onClick={() => void remove(c)} title="Quitar IP dedicada">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!customers.length && (
                <TableRow><TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">No hay clientes.</Typography>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Diálogo de alta/edición */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>IP de envío — {editing?.company}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Configuration set (SES)"
              placeholder="p. ej. mc-empresa-dedicada"
              value={configurationSet}
              onChange={(e) => setConfigurationSet(e.target.value)}
              required
              helperText="Debe existir en SES, apuntando al pool de la IP dedicada, con el mismo destino de eventos SNS que el general."
            />
            <TextField
              label="Pool de IP dedicada (opcional, informativo)"
              placeholder="p. ej. pool-empresa"
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
            />
            <TextField
              label="IPs dedicadas (opcional, una por línea)"
              value={ipsText}
              onChange={(e) => setIpsText(e.target.value)}
              multiline
              minRows={2}
              helperText="Solo informativo (para tenerlas a la vista); el ruteo lo hace el configuration set."
            />
            <FormControlLabel
              control={<Switch color="success" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={enabled ? 'Habilitada (envía por la IP dedicada)' : 'Deshabilitada (envía por el pool general)'}
            />
            <TextField
              label="Notas (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving || !configurationSet.trim()}>
            {saving ? <CircularProgress size={22} /> : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {ConfirmDialog}
      {FeedbackSnackbar}
    </Box>
  );
};
