import { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, TextField, MenuItem, IconButton, Chip, Alert,
  Divider, CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, FormControl, InputLabel, Select, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewListIcon from '@mui/icons-material/ViewList';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { usePortalData } from '../../context/PortalDataContext';
import { useFeedback } from '../../hooks/useFeedback';
import { isOk } from '../../services/apiClient';
import { cascadeService } from '../../services/cascadeService';
import type { CascadeChannel, CascadeStep, CascadeRun, SuccessCriterion } from '../../services/cascadeService';
import { CascadaFlowBuilder, toMinutes } from './CascadaFlowBuilder';
import type { WaitUnit } from './CascadaFlowBuilder';
import { formatDateTime } from '../../utils/datetime';

const CHANNEL_LABEL: Record<CascadeChannel, string> = { EM: 'Correo', SMS: 'SMS', WSP: 'WhatsApp', VOZ: 'Voz' };
const CHANNELS: CascadeChannel[] = ['EM', 'WSP', 'SMS', 'VOZ'];
const CRITERION_LABEL: Record<SuccessCriterion, string> = {
  sent: 'Enviado', delivered: 'Entregado', read: 'Leído / abierto',
};

/**
 * CASCADA omnicanal (Opción A). El cliente define un mensaje lógico + un ORDEN de canales;
 * la plataforma escala automáticamente hasta confirmar la entrega/lectura o agotar los canales.
 * Ver PLAN_CASCADA.md. RBAC: owner/approver (es un envío real).
 */
export const CascadaSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { databases, messageTemplates } = usePortalData();
  const smsTemplates = messageTemplates.items.filter((t) => t.channel === 'SMS');
  const wspTemplates = messageTemplates.items.filter((t) => t.channel === 'WSP');

  const [name, setName] = useState('');
  const [dataPath, setDataPath] = useState('');
  // Ventana de espera del run: el usuario elige unidad (min/horas/días) + número;
  // al backend siempre va en minutos (waitMinutes). Default 1 hora.
  const [waitValue, setWaitValue] = useState('1');
  const [waitUnit, setWaitUnit] = useState<WaitUnit>('hora');
  const waitMinutes = toMinutes(waitValue, waitUnit) ?? 60;
  const [criterion, setCriterion] = useState<SuccessCriterion>('delivered');
  const [steps, setSteps] = useState<CascadeStep[]>([
    { channel: 'WSP', content: '' },
    { channel: 'SMS', content: '' },
  ]);
  // Modo de definición: 'basico' (lista ordenada) o 'flujo' (editor de nodos tipo React Flow).
  const [mode, setMode] = useState<'basico' | 'flujo'>('basico');
  const [submitting, setSubmitting] = useState(false);

  const [runs, setRuns] = useState<CascadeRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const selectedBase = databases.items.find((d) => d.s3Path === dataPath);
  const contacts = selectedBase?.totalRecords ?? 0;

  const loadRuns = async () => {
    setLoadingRuns(true);
    const res = await cascadeService.list();
    setLoadingRuns(false);
    if (isOk(res) && res.data?.runs) setRuns(res.data.runs);
  };
  useEffect(() => { loadRuns(); }, []);

  const setStep = (i: number, patch: Partial<CascadeStep>) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const addStep = () => setSteps((s) => [...s, { channel: 'VOZ', content: '' }]);
  const removeStep = (i: number) => setSteps((s) => (s.length <= 2 ? s : s.filter((_, idx) => idx !== i)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  /** Control de contenido por canal (plantilla o texto). */
  const contentControl = (st: CascadeStep, i: number) => {
    if (st.channel === 'SMS') {
      return (
        <TextField select size="small" fullWidth label="Plantilla SMS" value={st.content}
          onChange={(e) => setStep(i, { content: e.target.value })}>
          {smsTemplates.length === 0 && <MenuItem value="" disabled>No hay plantillas SMS</MenuItem>}
          {smsTemplates.map((t) => <MenuItem key={t.messageTemplateId} value={t.body ?? ''}>{t.name}</MenuItem>)}
        </TextField>
      );
    }
    if (st.channel === 'WSP') {
      return (
        <TextField select size="small" fullWidth label="Plantilla WhatsApp (HSM)" value={st.content}
          onChange={(e) => setStep(i, { content: e.target.value })}>
          {wspTemplates.length === 0 && <MenuItem value="" disabled>No hay plantillas WhatsApp</MenuItem>}
          {wspTemplates.map((t) => <MenuItem key={t.messageTemplateId} value={t.hsmName ?? ''}>{t.name} · {t.hsmName}</MenuItem>)}
        </TextField>
      );
    }
    if (st.channel === 'EM') {
      return (
        <TextField size="small" fullWidth label="Plantilla de correo (nombre SES)" value={st.content}
          onChange={(e) => setStep(i, { content: e.target.value })} placeholder="empresa_0001_bienvenida" />
      );
    }
    return (
      <TextField size="small" fullWidth label="Mensaje de voz (texto a voz)" value={st.content}
        onChange={(e) => setStep(i, { content: e.target.value })} placeholder="Hola {{Nombre}}, le recordamos…" />
    );
  };

  const launch = async () => {
    if (!name.trim()) return notify('Ponle un nombre a la cascada.', 'warning');
    if (!dataPath) return notify('Elige la base de contactos.', 'warning');
    if (steps.length < 2) return notify('La cascada necesita al menos 2 canales en orden.', 'warning');
    if (steps.some((s) => !s.content.trim())) return notify('Cada canal necesita su contenido/plantilla.', 'warning');
    setSubmitting(true);
    const res = await cascadeService.dispatch({ name: name.trim(), dataPath, waitMinutes, successCriterion: criterion, steps });
    setSubmitting(false);
    if (isOk(res)) {
      notify(`Cascada lanzada: ${res.data?.contacts ?? 0} contactos por ${CHANNEL_LABEL[steps[0].channel]}.`, 'success');
      setName('');
      loadRuns();
    } else {
      notify(res.description || 'No se pudo lanzar la cascada.', 'error');
    }
  };

  const progress = useMemo(() => (r: CascadeRun) => {
    const c = r.counts || { total: 0, confirmed: 0, exhausted: 0, inFlight: 0, budget: 0 };
    return c;
  }, []);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
        <AltRouteIcon color="primary" />
        <Typography variant="h4">Cascada omnicanal</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Define <strong>un mensaje</strong> y el <strong>orden de canales</strong>. Enviamos por el
        primero y <strong>escalamos automáticamente</strong> al siguiente hasta confirmar la entrega
        o agotar los canales — respetando consentimiento y saldo. <em>Defines el mensaje, no el canal.</em>
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" fullWidth label="Nombre de la cascada" value={name} onChange={(e) => setName(e.target.value)} placeholder="Recordatorio de pago mayo" />
            <FormControl size="small" fullWidth>
              <InputLabel>Base de contactos</InputLabel>
              <Select value={dataPath} label="Base de contactos" onChange={(e) => setDataPath(e.target.value)}>
                {databases.items.length === 0 && <MenuItem value="" disabled>No hay bases; cárgalas en "Bases de datos"</MenuItem>}
                {databases.items.map((d) => (
                  <MenuItem key={d.databaseFileId} value={d.s3Path}>{d.fileName} — {d.totalRecords?.toLocaleString('es-CO')} contactos</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <Typography variant="caption" color="text.secondary" fontWeight={800} sx={{ letterSpacing: 0.4 }}>
              ORDEN DE CANALES (PRIORIDAD)
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, m) => m && setMode(m)}>
              <ToggleButton value="basico"><ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />Básico</ToggleButton>
              <ToggleButton value="flujo"><AccountTreeIcon fontSize="small" sx={{ mr: 0.5 }} />Flujo</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {mode === 'basico' ? (
            <>
              {steps.map((st, i) => (
                <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <Chip label={i + 1} size="small" color="primary" sx={{ fontWeight: 700 }} />
                  <TextField select size="small" label="Canal" value={st.channel} onChange={(e) => setStep(i, { channel: e.target.value as CascadeChannel, content: '' })} sx={{ minWidth: 130 }}>
                    {CHANNELS.map((ch) => <MenuItem key={ch} value={ch}>{CHANNEL_LABEL[ch]}</MenuItem>)}
                  </TextField>
                  <Box sx={{ flex: 1, width: '100%' }}>{contentControl(st, i)}</Box>
                  <Stack direction="row">
                    <Tooltip title="Subir"><span><IconButton size="small" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="Bajar"><span><IconButton size="small" onClick={() => move(i, 1)} disabled={i === steps.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="Quitar"><span><IconButton size="small" color="error" onClick={() => removeStep(i)} disabled={steps.length <= 2}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip>
                  </Stack>
                </Stack>
              ))}
              <Box><Button size="small" startIcon={<AddIcon />} onClick={addStep}>Agregar canal</Button></Box>
            </>
          ) : (
            <CascadaFlowBuilder initialSteps={steps} onStepsChange={setSteps} smsTemplates={smsTemplates} wspTemplates={wspTemplates} />
          )}

          <Divider />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField select size="small" label="Confirmar cuando esté" value={criterion} onChange={(e) => setCriterion(e.target.value as SuccessCriterion)} sx={{ minWidth: 200 }} helperText="Si no se cumple, escala">
              {(Object.keys(CRITERION_LABEL) as SuccessCriterion[]).map((c) => <MenuItem key={c} value={c}>{CRITERION_LABEL[c]}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField size="small" type="number" label="Ventana de espera" value={waitValue} onChange={(e) => setWaitValue(e.target.value)} sx={{ width: 130 }} helperText="Antes de escalar" inputProps={{ min: 1, step: 1 }} />
              <TextField select size="small" label="Unidad" value={waitUnit} onChange={(e) => setWaitUnit(e.target.value as WaitUnit)} sx={{ width: 120 }}>
                <MenuItem value="min">Minutos</MenuItem>
                <MenuItem value="hora">Horas</MenuItem>
                <MenuItem value="dia">Días</MenuItem>
              </TextField>
            </Stack>
            {selectedBase && <Chip variant="outlined" label={`${contacts.toLocaleString('es-CO')} contactos`} />}
          </Stack>

          <Alert severity="info" sx={{ py: 0.5 }}>
            Se cobra el <strong>{steps[0] ? CHANNEL_LABEL[steps[0].channel] : 'primer canal'}</strong> (primer
            canal del flujo) al lanzar; cada escalamiento se cobra <strong>solo por los contactos que realmente
            escalan</strong>. Los canales con adjunto (EAU/EAP) no aplican en la cascada por ahora.
          </Alert>

          <Box>
            <Button variant="contained" startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <SendIcon />} onClick={launch} disabled={submitting}>
              {submitting ? 'Lanzando…' : 'Lanzar cascada'}
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={700}>Cascadas {loadingRuns && <CircularProgress size={16} sx={{ ml: 1 }} />}</Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={loadRuns} disabled={loadingRuns}>Refrescar</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Cascada</TableCell>
              <TableCell>Canales</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell align="right">Confirmados</TableCell>
              <TableCell align="right">En vuelo</TableCell>
              <TableCell align="right">Agotados</TableCell>
              <TableCell>Creada</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.length === 0 && (
              <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>Aún no has lanzado cascadas.</TableCell></TableRow>
            )}
            {runs.map((r) => {
              const c = progress(r);
              return (
                <TableRow key={r.cascadeRunId} hover>
                  <TableCell><Typography fontWeight={600}>{r.name}</Typography></TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {r.steps.map((s, i) => <Chip key={i} size="small" variant="outlined" label={`${i + 1}·${CHANNEL_LABEL[s.channel]}`} />)}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={r.status === 'done' ? 'success' : r.status === 'running' ? 'info' : 'default'}
                      label={r.status === 'done' ? 'Completada' : r.status === 'running' ? 'En curso' : r.status} />
                  </TableCell>
                  <TableCell align="right">{c.confirmed}</TableCell>
                  <TableCell align="right">{c.inFlight}</TableCell>
                  <TableCell align="right">{c.exhausted + (c.budget || 0)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.createdAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {FeedbackSnackbar}
    </Box>
  );
};
