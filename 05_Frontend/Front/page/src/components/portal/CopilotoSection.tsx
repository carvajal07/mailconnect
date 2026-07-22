import { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, TextField, MenuItem, Chip, Alert, Divider,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem,
  ListItemIcon, ListItemText, LinearProgress, Tooltip,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import GavelIcon from '@mui/icons-material/Gavel';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { getUser } from '../../services/authService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { copilotService } from '../../services/copilotService';
import type { AnalyzeResult, CopilotChannel } from '../../services/copilotService';

const CHANNELS: { ch: CopilotChannel; label: string }[] = [
  { ch: 'EM', label: 'Correo' }, { ch: 'SMS', label: 'SMS' }, { ch: 'WSP', label: 'WhatsApp' }, { ch: 'VOZ', label: 'Voz' },
];
const EMAIL = (ch: CopilotChannel) => ch === 'EM' || ch === 'EAU' || ch === 'EAP';
const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = { ok: 'success', warning: 'warning', critical: 'error' };
const SEV_ICON: Record<string, React.ReactNode> = {
  critical: <ErrorOutlineIcon color="error" fontSize="small" />,
  warning: <WarningAmberIcon color="warning" fontSize="small" />,
  info: <InfoOutlinedIcon color="info" fontSize="small" />,
};

/**
 * COPILOTO de campañas (Opción B). Antes de enviar: analiza spam/entregabilidad, valida
 * cumplimiento Ley 1581 (Habeas Data), sugiere hora óptima y redacta/mejora el copy con IA.
 * El análisis y el checklist son DETERMINISTAS (sin costo); solo redactar/mejorar usa IA.
 */
export const CopilotoSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const company = getUser()?.customer ?? '';

  const [channel, setChannel] = useState<CopilotChannel>('EM');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('b2c');

  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [draftOpen, setDraftOpen] = useState(false);
  const [objective, setObjective] = useState('');
  const [tone, setTone] = useState('cercano y profesional');
  const [drafting, setDrafting] = useState(false);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);

  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [goal, setGoal] = useState('menos riesgo de spam y más claro');
  const [rewriting, setRewriting] = useState(false);

  const analyze = async () => {
    if (!body.trim()) return notify('Escribe (o genera) el mensaje antes de analizar.', 'warning');
    setAnalyzing(true);
    const res = await copilotService.analyze({ channel, subject, body, company, audience });
    setAnalyzing(false);
    if (isOk(res) && res.data) setAnalysis(res.data);
    else notify(res.description || 'No se pudo analizar.', 'error');
  };

  const runDraft = async () => {
    if (!objective.trim()) return notify('Describe el objetivo de la campaña.', 'warning');
    setDrafting(true);
    const res = await copilotService.draft({ objective, channel, audience, tone });
    setDrafting(false);
    if (isOk(res) && res.data) {
      setBody(res.data.body || '');
      setSubjectOptions(res.data.subjects ?? []);
      if (res.data.subjects && res.data.subjects.length) setSubject(res.data.subjects[0]);
      setDraftOpen(false);
      setAnalysis(null);
      notify('Borrador generado. Revísalo y analízalo antes de enviar.', 'success');
    } else {
      notify(res.description || 'No se pudo generar el borrador (¿IA desplegada?).', 'error');
    }
  };

  const runRewrite = async () => {
    if (!body.trim()) return notify('No hay texto para mejorar.', 'warning');
    setRewriting(true);
    const res = await copilotService.rewrite({ text: body, channel, goal });
    setRewriting(false);
    if (isOk(res) && res.data) {
      setBody(res.data.text || body);
      setRewriteOpen(false);
      setAnalysis(null);
      notify('Texto mejorado con IA.', 'success');
    } else {
      notify(res.description || 'No se pudo mejorar el texto.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
        <AutoAwesomeIcon color="primary" />
        <Typography variant="h4">Copiloto de campañas</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Revisa tu mensaje <strong>antes de enviar</strong>: análisis de spam/entregabilidad, cumplimiento
        de la <strong>Ley 1581 (Habeas Data)</strong> y hora óptima. También puede <strong>redactar o
        mejorar</strong> el copy con IA. El análisis es gratuito e instantáneo; la redacción usa IA.
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        {/* Editor */}
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField select size="small" label="Canal" value={channel} onChange={(e) => setChannel(e.target.value as CopilotChannel)} sx={{ minWidth: 130 }}>
                {CHANNELS.map((c) => <MenuItem key={c.ch} value={c.ch}>{c.label}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Audiencia" value={audience} onChange={(e) => setAudience(e.target.value)} sx={{ minWidth: 150 }}>
                <MenuItem value="b2c">Público general (B2C)</MenuItem>
                <MenuItem value="b2b">Empresas (B2B)</MenuItem>
              </TextField>
            </Stack>
            {EMAIL(channel) && (
              <>
                <TextField size="small" fullWidth label="Asunto" value={subject} onChange={(e) => setSubject(e.target.value)} />
                {subjectOptions.length > 0 && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Typography variant="caption" color="text.secondary" sx={{ width: '100%' }}>Opciones de asunto (IA):</Typography>
                    {subjectOptions.map((s, i) => (
                      <Chip key={i} label={s} size="small" variant={subject === s ? 'filled' : 'outlined'} color="primary" onClick={() => setSubject(s)} />
                    ))}
                  </Stack>
                )}
              </>
            )}
            <TextField label="Mensaje" value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={8} fullWidth
              placeholder="Escribe tu mensaje, o genéralo con «Redactar con IA»…" />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="contained" onClick={analyze} disabled={analyzing} startIcon={analyzing ? <CircularProgress size={16} color="inherit" /> : <GavelIcon />}>
                Analizar
              </Button>
              <Button variant="outlined" onClick={() => setDraftOpen(true)} startIcon={<AutoAwesomeIcon />}>Redactar con IA</Button>
              <Button variant="outlined" onClick={() => setRewriteOpen(true)} startIcon={<EditNoteIcon />} disabled={!body.trim()}>Mejorar con IA</Button>
            </Stack>
          </Stack>
        </Paper>

        {/* Resultado del análisis */}
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          {!analysis ? (
            <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', color: 'text.secondary', py: 4 }} spacing={1}>
              <GavelIcon sx={{ fontSize: 40, opacity: 0.4 }} />
              <Typography variant="body2">Pulsa «Analizar» para revisar tu mensaje.</Typography>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h3" fontWeight={800} color={`${LEVEL_COLOR[analysis.level]}.main`}>{analysis.score}</Typography>
                  <Typography variant="caption" color="text.secondary">/ 100</Typography>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <LinearProgress variant="determinate" value={analysis.score} color={LEVEL_COLOR[analysis.level]} sx={{ height: 8, borderRadius: 4, mb: 0.5 }} />
                  <Chip size="small" color={LEVEL_COLOR[analysis.level]} label={analysis.level === 'ok' ? 'Buena entregabilidad' : analysis.level === 'warning' ? 'Revisa algunos puntos' : 'Alto riesgo de spam'} />
                </Box>
              </Stack>

              {analysis.issues.length > 0 && (
                <List dense disablePadding>
                  {analysis.issues.map((it, i) => (
                    <ListItem key={i} disableGutters sx={{ alignItems: 'flex-start' }}>
                      <ListItemIcon sx={{ minWidth: 30, mt: 0.3 }}>{SEV_ICON[it.severity]}</ListItemIcon>
                      <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={it.message} />
                    </ListItem>
                  ))}
                </List>
              )}
              {analysis.suggestions.length > 0 && (
                <Alert severity="info" sx={{ py: 0.5 }} icon={<AutoAwesomeIcon fontSize="small" />}>
                  {analysis.suggestions.join(' ')}
                </Alert>
              )}

              <Divider textAlign="left"><Stack direction="row" spacing={0.5} alignItems="center"><GavelIcon fontSize="small" /><Typography variant="caption">Ley 1581 (Habeas Data)</Typography></Stack></Divider>
              <List dense disablePadding>
                {analysis.habeasData.present.map((p) => (
                  <ListItem key={p} disableGutters><ListItemIcon sx={{ minWidth: 30 }}><CheckCircleIcon color="success" fontSize="small" /></ListItemIcon><ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={p} /></ListItem>
                ))}
                {analysis.habeasData.missing.map((m) => {
                  const required = analysis.habeasData.requiredMissing.includes(m);
                  return (
                    <ListItem key={m} disableGutters>
                      <ListItemIcon sx={{ minWidth: 30 }}>{required ? <CancelIcon color="error" fontSize="small" /> : <WarningAmberIcon color="warning" fontSize="small" />}</ListItemIcon>
                      <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={m} secondary={required ? 'Obligatorio' : 'Recomendado'} secondaryTypographyProps={{ variant: 'caption' }} />
                    </ListItem>
                  );
                })}
              </List>
              {!analysis.habeasData.ok && (
                <Alert severity="warning" sx={{ py: 0.5 }}>Faltan elementos <strong>obligatorios</strong> de Habeas Data antes de enviar.</Alert>
              )}

              <Divider textAlign="left"><Stack direction="row" spacing={0.5} alignItems="center"><ScheduleIcon fontSize="small" /><Typography variant="caption">Hora óptima</Typography></Stack></Divider>
              <Tooltip title={analysis.sendTime.rationale}>
                <Chip icon={<ScheduleIcon />} label={analysis.sendTime.suggestion} variant="outlined" sx={{ cursor: 'help', alignSelf: 'flex-start' }} />
              </Tooltip>
            </Stack>
          )}
        </Paper>
      </Box>

      {/* Diálogo: redactar con IA */}
      <Dialog open={draftOpen} onClose={() => setDraftOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Redactar con IA</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="¿Cuál es el objetivo de la campaña?" value={objective} onChange={(e) => setObjective(e.target.value)} multiline minRows={2} fullWidth placeholder="Ej. Invitar a mis clientes al lanzamiento del nuevo plan con 15% de descuento el 5 de junio." autoFocus />
            <TextField label="Tono" value={tone} onChange={(e) => setTone(e.target.value)} size="small" fullWidth placeholder="cercano y profesional" />
            <Alert severity="info" sx={{ py: 0.5 }}>La IA respeta el canal ({CHANNELS.find((c) => c.ch === channel)?.label}) y evita palabras de spam. Revisa siempre el resultado.</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraftOpen(false)} disabled={drafting}>Cancelar</Button>
          <Button variant="contained" onClick={runDraft} disabled={drafting} startIcon={drafting ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}>Generar</Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo: mejorar con IA */}
      <Dialog open={rewriteOpen} onClose={() => setRewriteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Mejorar con IA</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="¿Qué quieres lograr?" value={goal} onChange={(e) => setGoal(e.target.value)} fullWidth>
              <MenuItem value="menos riesgo de spam y más claro">Menos riesgo de spam</MenuItem>
              <MenuItem value="más formal">Más formal</MenuItem>
              <MenuItem value="más cercano y cálido">Más cercano</MenuItem>
              <MenuItem value="más corto y directo">Más corto</MenuItem>
              <MenuItem value="con una llamada a la acción más clara">Mejor llamada a la acción</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRewriteOpen(false)} disabled={rewriting}>Cancelar</Button>
          <Button variant="contained" onClick={runRewrite} disabled={rewriting} startIcon={rewriting ? <CircularProgress size={16} color="inherit" /> : <EditNoteIcon />}>Mejorar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
