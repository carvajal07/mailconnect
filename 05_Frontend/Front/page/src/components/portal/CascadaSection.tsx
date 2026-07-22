import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Tooltip, Chip, Divider, MenuItem,
  TextField, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, FormControl, InputLabel, Select, RadioGroup,
  FormControlLabel, Radio, CircularProgress, Alert, LinearProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { usePortalData } from '../../context/PortalDataContext';
import { isOk } from '../../services/apiClient';
import {
  cascadeService, CHANNEL_LABEL,
} from '../../services/cascadeService';
import type {
  CascadeChannel, CascadeStep, ConfirmOn, CascadeRunSummary, CascadeStatusData,
} from '../../services/cascadeService';
import { useFeedback } from '../../hooks/useFeedback';
import { formatDateTime } from '../../utils/datetime';

const CHANNELS: CascadeChannel[] = ['EM', 'WSP', 'SMS', 'VOZ'];

const STATUS_COLOR: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  draft: 'default', running: 'info', paused: 'warning', done: 'success', canceled: 'error',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador', running: 'En curso', paused: 'Pausada (saldo)', done: 'Terminada', canceled: 'Cancelada',
};

/** Adivina el índice de columna por el nombre del encabezado. */
const guessCol = (columns: string[], keys: string[]): number => {
  const idx = columns.findIndex((c) => keys.some((k) => c.toLowerCase().includes(k)));
  return idx;
};

const emptyStep = (channel: CascadeChannel): CascadeStep => ({ channel });

export const CascadaSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { databases } = usePortalData();
  const [runs, setRuns] = useState<CascadeRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');            // id en operación (start/cancel)
  const [openCreate, setOpenCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // --- formulario de creación ---
  const [name, setName] = useState('');
  const [databaseFileId, setDatabaseFileId] = useState('');
  const [emailCol, setEmailCol] = useState(-1);
  const [phoneCol, setPhoneCol] = useState(-1);
  const [nameCol, setNameCol] = useState(-1);
  const [steps, setSteps] = useState<CascadeStep[]>([{ channel: 'EM' }, { channel: 'WSP' }]);
  const [confirmOn, setConfirmOn] = useState<ConfirmOn>('delivered');
  const [timeoutMin, setTimeoutMin] = useState(60);
  const [budget, setBudget] = useState('');

  // --- monitor ---
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusData, setStatusData] = useState<CascadeStatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const selectedBase = databases.items.find((d) => d.databaseFileId === databaseFileId);
  const columns = useMemo(() => selectedBase?.columns ?? [], [selectedBase]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await cascadeService.list();
    setLoading(false);
    if (isOk(res) && res.data?.runs) setRuns(res.data.runs);
    else notify(res.description || 'No se pudieron cargar las cascadas.', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Al elegir base, fija la base y autodetecta las columnas (email/celular/nombre). */
  const onSelectBase = (id: string) => {
    setDatabaseFileId(id);
    const cols = databases.items.find((d) => d.databaseFileId === id)?.columns ?? [];
    setEmailCol(guessCol(cols, ['correo', 'email', 'mail']));
    setPhoneCol(guessCol(cols, ['celular', 'telefono', 'teléfono', 'phone', 'movil', 'móvil']));
    setNameCol(guessCol(cols, ['nombre', 'name']));
  };

  const resetForm = () => {
    setName(''); setDatabaseFileId(''); setSteps([{ channel: 'EM' }, { channel: 'WSP' }]);
    setConfirmOn('delivered'); setTimeoutMin(60); setBudget('');
  };

  const addStep = (channel: CascadeChannel) => setSteps((s) => [...s, emptyStep(channel)]);
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) => setSteps((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const copy = [...s]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });
  const setStepField = (i: number, field: keyof CascadeStep, value: string) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, [field]: value } : st)));

  const needsEmail = steps.some((s) => s.channel === 'EM');
  const needsPhone = steps.some((s) => s.channel !== 'EM');

  const validate = (): string => {
    if (!name.trim()) return 'Ponle un nombre a la cascada.';
    if (!databaseFileId) return 'Elige la base de contactos.';
    if (!steps.length) return 'Agrega al menos un canal.';
    if (needsEmail && emailCol < 0) return 'Indica la columna de correo.';
    if (needsPhone && phoneCol < 0) return 'Indica la columna de celular.';
    for (const s of steps) {
      if (s.channel === 'EM' && (!s.template?.trim() || !s.from?.trim())) return 'El paso de Correo necesita plantilla y remitente.';
      if (s.channel === 'SMS' && !s.body?.trim()) return 'El paso de SMS necesita el texto.';
      if (s.channel === 'WSP' && !s.hsm?.trim()) return 'El paso de WhatsApp necesita el nombre de la plantilla HSM.';
      if (s.channel === 'VOZ' && !s.voiceText?.trim()) return 'El paso de Voz necesita el texto a leer.';
    }
    return '';
  };

  const submit = async () => {
    const err = validate();
    if (err) { notify(err, 'warning'); return; }
    setSubmitting(true);
    const res = await cascadeService.create({
      name: name.trim(), databaseFileId, emailCol, phoneCol, nameCol, steps, confirmOn,
      stepTimeoutMin: timeoutMin, budgetCap: budget ? Number(budget) : undefined,
    });
    setSubmitting(false);
    if (!isOk(res)) { notify(res.description || 'No se pudo crear la cascada.', 'error'); return; }
    notify(`Cascada creada (${res.data?.total ?? 0} contactos).${res.data?.truncated ? ' Se truncó al máximo permitido.' : ''}`, 'success');
    setOpenCreate(false); resetForm(); load();
  };

  const doStart = async (id: string) => {
    setBusy(id);
    const res = await cascadeService.start(id);
    setBusy('');
    if (isOk(res)) { notify('Cascada iniciada.', 'success'); load(); }
    else notify(res.description || 'No se pudo iniciar.', 'error');
  };
  const doCancel = async (id: string) => {
    setBusy(id);
    const res = await cascadeService.cancel(id);
    setBusy('');
    if (isOk(res)) { notify('Cascada cancelada.', 'info'); load(); }
    else notify(res.description || 'No se pudo cancelar.', 'error');
  };
  const openStatus = async (id: string) => {
    setStatusOpen(true); setStatusData(null); setStatusLoading(true);
    const res = await cascadeService.status(id);
    setStatusLoading(false);
    if (isOk(res) && res.data) setStatusData(res.data);
    else notify(res.description || 'No se pudo cargar el detalle.', 'error');
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Entrega garantizada</Typography>
          <Typography variant="body2" color="text.secondary">
            Cascada omnicanal: defines el mensaje y el orden de canales; la plataforma intenta el más
            barato y escala (Correo → WhatsApp → SMS → Voz) hasta confirmar la entrega, al menor costo.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setOpenCreate(true); }}>
            Nueva cascada
          </Button>
        </Stack>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell>
              <TableCell>Canales</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell align="right">Confirmados</TableCell>
              <TableCell align="right">Costo (COP)</TableCell>
              <TableCell>Creada</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.length === 0 && !loading && (
              <TableRow><TableCell colSpan={7}><Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                Aún no has creado cascadas. Crea una para garantizar la entrega al menor costo.
              </Typography></TableCell></TableRow>
            )}
            {runs.map((r) => {
              const c = r.counts || {};
              const canStart = r.status === 'draft' || r.status === 'paused';
              const canCancel = r.status === 'running' || r.status === 'paused' || r.status === 'draft';
              return (
                <TableRow key={r.cascadeRunId} hover>
                  <TableCell><strong>{r.name}</strong></TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {r.channels.map((ch, i) => (
                        <Chip key={i} label={`${i + 1}. ${CHANNEL_LABEL[ch]}`} size="small" variant="outlined" />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLOR[r.status] || 'default'} label={STATUS_LABEL[r.status] || r.status} /></TableCell>
                  <TableCell align="right">{c.confirmed ?? 0}/{c.total ?? 0}</TableCell>
                  <TableCell align="right">{(c.spent ?? 0).toLocaleString('es-CO')}</TableCell>
                  <TableCell>{r.createdAt ? formatDateTime(r.createdAt) : '—'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Ver detalle"><IconButton size="small" onClick={() => openStatus(r.cascadeRunId)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                    {canStart && (
                      <Tooltip title="Iniciar"><span><IconButton size="small" color="success" disabled={busy === r.cascadeRunId} onClick={() => doStart(r.cascadeRunId)}><PlayArrowIcon fontSize="small" /></IconButton></span></Tooltip>
                    )}
                    {canCancel && (
                      <Tooltip title="Cancelar"><span><IconButton size="small" color="error" disabled={busy === r.cascadeRunId} onClick={() => doCancel(r.cascadeRunId)}><CancelIcon fontSize="small" /></IconButton></span></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ---- Crear ---- */}
      <Dialog open={openCreate} onClose={() => setOpenCreate(false)} maxWidth="md" fullWidth>
        <DialogTitle>Nueva cascada — entrega garantizada</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" />

            <FormControl fullWidth size="small">
              <InputLabel>Base de contactos</InputLabel>
              <Select value={databaseFileId} label="Base de contactos" onChange={(e) => onSelectBase(e.target.value)}>
                <MenuItem value=""><em>— Elige una base —</em></MenuItem>
                {databases.items.map((d) => (
                  <MenuItem key={d.databaseFileId} value={d.databaseFileId}>{d.fileName} ({d.totalRecords} reg.)</MenuItem>
                ))}
              </Select>
            </FormControl>

            {databaseFileId && !columns.length && (
              <Alert severity="warning">Esta base no tiene columnas registradas; vuelve a subirla en «Bases de datos» para mapear correo/celular.</Alert>
            )}

            {columns.length > 0 && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                {([['Correo', emailCol, setEmailCol], ['Celular', phoneCol, setPhoneCol], ['Nombre', nameCol, setNameCol]] as const).map(([label, val, setter]) => (
                  <FormControl key={label} fullWidth size="small">
                    <InputLabel>{`Columna ${label}`}</InputLabel>
                    <Select value={String(val)} label={`Columna ${label}`} onChange={(e) => setter(Number(e.target.value))}>
                      <MenuItem value="-1"><em>(ninguna)</em></MenuItem>
                      {columns.map((c, i) => <MenuItem key={i} value={String(i)}>{c}</MenuItem>)}
                    </Select>
                  </FormControl>
                ))}
              </Stack>
            )}

            <Divider textAlign="left"><Typography variant="overline">Orden de canales (se intentan en este orden)</Typography></Divider>

            {steps.map((s, i) => (
              <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <Chip label={`${i + 1}`} size="small" color="primary" />
                  <Typography variant="subtitle2" sx={{ flex: 1 }}>{CHANNEL_LABEL[s.channel]}</Typography>
                  <IconButton size="small" disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => removeStep(i)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                {s.channel === 'EM' && (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField label="Plantilla SES" value={s.template ?? ''} onChange={(e) => setStepField(i, 'template', e.target.value)} size="small" fullWidth />
                    <TextField label="Remitente (correo verificado)" value={s.from ?? ''} onChange={(e) => setStepField(i, 'from', e.target.value)} size="small" fullWidth />
                  </Stack>
                )}
                {s.channel === 'SMS' && (
                  <TextField label="Texto del SMS ({{nombre}}…)" value={s.body ?? ''} onChange={(e) => setStepField(i, 'body', e.target.value)} size="small" fullWidth multiline minRows={2} />
                )}
                {s.channel === 'WSP' && (
                  <TextField label="Plantilla HSM aprobada" value={s.hsm ?? ''} onChange={(e) => setStepField(i, 'hsm', e.target.value)} size="small" fullWidth />
                )}
                {s.channel === 'VOZ' && (
                  <TextField label="Texto a leer (voz)" value={s.voiceText ?? ''} onChange={(e) => setStepField(i, 'voiceText', e.target.value)} size="small" fullWidth multiline minRows={2} />
                )}
              </Paper>
            ))}

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {CHANNELS.map((ch) => (
                <Button key={ch} size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addStep(ch)}>{CHANNEL_LABEL[ch]}</Button>
              ))}
            </Stack>

            <Divider />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <FormControl>
                <Typography variant="caption" color="text.secondary">Confirmar con</Typography>
                <RadioGroup row value={confirmOn} onChange={(e) => setConfirmOn(e.target.value as ConfirmOn)}>
                  <FormControlLabel value="delivered" control={<Radio size="small" />} label="Entregado" />
                  <FormControlLabel value="read" control={<Radio size="small" />} label="Leído" />
                </RadioGroup>
              </FormControl>
              <TextField label="Espera por paso (min)" type="number" value={timeoutMin} onChange={(e) => setTimeoutMin(Math.max(1, Number(e.target.value) || 60))} size="small" sx={{ width: 170 }} />
              <TextField label="Tope de presupuesto (COP, opcional)" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} size="small" sx={{ width: 240 }} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              La plataforma cobra por cada intento de envío (el más barato primero) y para en cuanto confirma.
              Respeta tu saldo y tu lista negra/desuscritos. El envío avanza cada pocos minutos.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreate(false)}>Cancelar</Button>
          <Button variant="contained" onClick={submit} disabled={submitting} startIcon={submitting ? <CircularProgress size={16} /> : undefined}>
            {submitting ? 'Creando…' : 'Crear cascada'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Monitor ---- */}
      <Dialog open={statusOpen} onClose={() => setStatusOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Detalle de la cascada</DialogTitle>
        <DialogContent dividers>
          {statusLoading && <LinearProgress />}
          {statusData && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip color={STATUS_COLOR[statusData.run.status]} label={STATUS_LABEL[statusData.run.status] || statusData.run.status} />
                <Chip variant="outlined" label={`Confirmados ${statusData.run.counts.confirmed ?? 0}/${statusData.run.counts.total ?? 0}`} color="success" />
                <Chip variant="outlined" label={`En curso ${statusData.run.counts.inProgress ?? 0}`} color="info" />
                <Chip variant="outlined" label={`Agotados ${statusData.run.counts.exhausted ?? 0}`} />
                <Chip variant="outlined" label={`Costo ${(statusData.run.counts.spent ?? 0).toLocaleString('es-CO')} COP`} />
              </Stack>

              <Box>
                <Typography variant="overline" color="text.secondary">Por canal (intentos → confirmados)</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {Object.entries(statusData.byChannel).map(([ch, b]) => (
                    <Chip key={ch} label={`${CHANNEL_LABEL[ch as CascadeChannel] || ch}: ${b.attempts} → ${b.confirmed}`} size="small" />
                  ))}
                  {Object.keys(statusData.byChannel).length === 0 && <Typography variant="body2" color="text.secondary">Aún sin intentos.</Typography>}
                </Stack>
              </Box>

              <Box>
                <Typography variant="overline" color="text.secondary">Muestra de contactos</Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Contacto</TableCell><TableCell>Estado</TableCell>
                        <TableCell>Canal actual</TableCell><TableCell align="right">Intentos</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {statusData.contacts.map((c) => (
                        <TableRow key={c.cascadeContactId}>
                          <TableCell>{c.name || c.contactId}<br /><Typography variant="caption" color="text.secondary">{c.email || c.phone}</Typography></TableCell>
                          <TableCell>{c.status}</TableCell>
                          <TableCell>{c.currentChannel ? (CHANNEL_LABEL[c.currentChannel as CascadeChannel] || c.currentChannel) : '—'}</TableCell>
                          <TableCell align="right">{c.attempts?.length ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
