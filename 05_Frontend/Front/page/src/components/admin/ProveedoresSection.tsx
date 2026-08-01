import { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, MenuItem, TextField, Table, TableBody,
  TableCell, TableHead, TableRow, Chip, Alert, CircularProgress, Tooltip, IconButton,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { providersService } from '../../services/providersService';
import type { ProviderChannel, ProviderListData } from '../../services/providersService';
import { customerService } from '../../services/customerService';
import type { CustomerSummary } from '../../services/customerService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

/**
 * Sección admin "Proveedores de envío": por cuál proveedor sale cada canal, GLOBAL o
 * POR CLIENTE (ej.: la Panadería envía EMAIL por SocketLabs y SMS por Twilio; el resto
 * hereda el global). El desplegable ofrece SOLO lo que la matriz del backend declara
 * con adaptador — la UI nunca promete un proveedor que el envío no sabe cumplir.
 */

const CHANNELS: { id: ProviderChannel; label: string }[] = [
  { id: 'EMAIL', label: 'Correo' },
  { id: 'SMS', label: 'SMS' },
  { id: 'WSP', label: 'WhatsApp' },
  { id: 'VOZ', label: 'Voz' },
];

export const ProveedoresSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const [data, setData] = useState<ProviderListData | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selected, setSelected] = useState('');   // '' = configuración GLOBAL
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');       // canal que se está guardando

  // Sin setLoading(true) SÍNCRONO aquí: el estado inicial ya es true y el primer set
  // ocurre tras el await (el lint de efectos prohíbe el setState síncrono al montar).
  const load = useCallback(async () => {
    const [provs, custs] = await Promise.all([providersService.list(), customerService.list()]);
    if (isOk(provs) && provs.data) setData(provs.data);
    else notify(provs.description || 'No se pudieron cargar los proveedores.', 'error');
    if (isOk(custs)) setCustomers(custs.data?.customers ?? []);
    setLoading(false);
  }, [notify]);

  // Mismo patrón (y misma supresión) que IpEnvioSection: la carga es async y los
  // setState ocurren tras el await, pero el lint no lo rastrea por el callback.
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  const labels = data?.labels ?? {};
  const globalCfg = data?.global ?? {};
  const overrides = data?.overrides ?? [];

  /** Proveedor EFECTIVO del canal para el alcance elegido, con su origen. */
  const efectivo = (canal: ProviderChannel) => {
    if (selected) {
      const propio = overrides.find((o) => o.customerId === selected && o.channel === canal);
      if (propio) return { provider: propio.provider, origen: 'cliente' as const };
    }
    if (globalCfg[canal]) return { provider: globalCfg[canal], origen: 'global' as const };
    return { provider: data?.defaultProvider ?? 'aws', origen: 'default' as const };
  };

  const refrescar = () => { setLoading(true); void load(); };

  const cambiar = async (canal: ProviderChannel, provider: string) => {
    setSaving(canal);
    const r = await providersService.set(canal, provider, selected || undefined);
    setSaving('');
    if (!isOk(r)) { notify(r.description || 'No se pudo guardar.', 'error'); return; }
    notify(`${canal}: los próximos envíos ${selected ? 'de este cliente ' : ''}saldrán por ${labels[provider] ?? provider}.`, 'success');
    void load();
  };

  const heredar = async (canal: ProviderChannel) => {
    setSaving(canal);
    const r = await providersService.inherit(canal, selected || undefined);
    setSaving('');
    if (!isOk(r)) { notify(r.description || 'No se pudo guardar.', 'error'); return; }
    notify(`${canal} vuelve a heredar ${selected ? 'la configuración global' : 'el proveedor por defecto (AWS)'}.`, 'success');
    void load();
  };

  const nombreCliente = (id: string) =>
    customers.find((c) => c.customerId === id)?.company || id;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Proveedores de envío</Typography>
          <Typography variant="body2" color="text.secondary">
            Por cuál proveedor sale cada canal. La configuración global aplica a todos;
            un cliente con proveedor propio la ignora en ese canal.
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} onClick={refrescar}>Refrescar</Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        El cambio aplica a los envíos que se PREPAREN después de guardar (los lotes ya en
        cola conservan su proveedor). Las credenciales de cada proveedor son de la
        plataforma: sin ellas configuradas, el envío por ese proveedor falla y se
        reintenta — configúralas antes de activar el switch.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <TextField
          select size="small" label="Ámbito" value={selected} sx={{ minWidth: 320 }}
          onChange={(e) => setSelected(e.target.value)}
          helperText={selected
            ? 'Configuración PROPIA de este cliente; lo no configurado hereda del global.'
            : 'Configuración GLOBAL: aplica a todo cliente sin proveedor propio.'}
        >
          <MenuItem value="">🌐 Global (todos los clientes)</MenuItem>
          {customers.map((c) => (
            <MenuItem key={c.customerId} value={c.customerId}>{c.company}</MenuItem>
          ))}
        </TextField>
      </Paper>

      {loading ? <CircularProgress size={28} /> : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Canal</TableCell>
                <TableCell>Proveedor</TableCell>
                <TableCell>Origen</TableCell>
                <TableCell align="right">Heredar</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {CHANNELS.map(({ id, label }) => {
                const ef = efectivo(id);
                const opciones = data?.capabilities?.[id] ?? ['aws'];
                const soloUno = opciones.length <= 1;
                return (
                  <TableRow key={id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{label}</TableCell>
                    <TableCell>
                      <TextField
                        select size="small" value={ef.provider} sx={{ minWidth: 260 }}
                        disabled={saving === id || soloUno}
                        onChange={(e) => void cambiar(id, e.target.value)}
                        helperText={id === 'WSP'
                          ? 'El número de WhatsApp está registrado ante Meta con un solo proveedor; cambiarlo exige re-registrarlo.'
                          : undefined}
                      >
                        {opciones.map((p) => (
                          <MenuItem key={p} value={p}>{labels[p] ?? p}</MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      {/* De dónde sale el valor: propio del cliente, global, o el default. */}
                      <Chip size="small" variant="outlined"
                        label={ef.origen === 'cliente' ? 'De este cliente'
                          : ef.origen === 'global' ? 'Global' : 'Por defecto (AWS)'}
                        color={ef.origen === 'cliente' ? 'info' : 'default'} />
                    </TableCell>
                    <TableCell align="right">
                      {/* Solo tiene sentido si HAY una fila propia que quitar. */}
                      {((selected && ef.origen === 'cliente') || (!selected && ef.origen === 'global')) && (
                        <Tooltip title={selected ? 'Quitar el proveedor propio (hereda el global)' : 'Volver al proveedor por defecto (AWS)'}>
                          <IconButton size="small" disabled={saving === id} onClick={() => void heredar(id)}>
                            <RestartAltIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {!selected && overrides.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Clientes con proveedor propio ({overrides.length})
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Cliente</TableCell><TableCell>Canal</TableCell>
                <TableCell>Proveedor</TableCell><TableCell>Desde</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {overrides.map((o) => (
                <TableRow key={`${o.customerId}-${o.channel}`} hover
                  onClick={() => setSelected(o.customerId)} sx={{ cursor: 'pointer' }}>
                  <TableCell>{nombreCliente(o.customerId)}</TableCell>
                  <TableCell>{CHANNELS.find((c) => c.id === o.channel)?.label ?? o.channel}</TableCell>
                  <TableCell>{labels[o.provider] ?? o.provider}</TableCell>
                  <TableCell>{o.updatedAt}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {FeedbackSnackbar}
    </Box>
  );
};
