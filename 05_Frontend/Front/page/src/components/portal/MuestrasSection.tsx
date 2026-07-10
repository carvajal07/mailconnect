import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Avatar,
  Chip,
  Alert,
  InputAdornment,
  Divider,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CampaignIcon from '@mui/icons-material/Campaign';
import TuneIcon from '@mui/icons-material/Tune';
import GroupIcon from '@mui/icons-material/Group';
import CasinoIcon from '@mui/icons-material/Casino';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import BadgeIcon from '@mui/icons-material/Badge';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import ApartmentIcon from '@mui/icons-material/Apartment';
import MenuItem from '@mui/material/MenuItem';
import { getUser } from '../../services/authService';
import { campaignsService, MAX_SAMPLE_SENDS } from '../../services/campaignsService';
import type { CampaignSummary } from '../../services/campaignsService';
import { templatesService } from '../../services/templatesService';
import type { TemplateSummary } from '../../services/templatesService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { CostEstimate } from './CostEstimate';

type TipoMuestra = 'aleatorias' | 'selectivas';
type EstadoLote = 'enviada' | 'aprobada' | 'rechazada' | 'enviada_real';

interface Recipient {
  email: string;
  identificacion: string;
}

interface Lote {
  id: string;
  cliente: string;
  campaign: string;
  template: string;
  version: number;
  tipo: TipoMuestra;
  recipients: Recipient[];
  estado: EstadoLote;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = 5;

const emptyRecipients = (n: number): Recipient[] =>
  Array.from({ length: n }, () => ({ email: '', identificacion: '' }));

const estadoChip: Record<EstadoLote, { label: string; color: 'info' | 'success' | 'error' | 'default' }> = {
  enviada: { label: 'Enviada · pendiente de aprobación', color: 'info' },
  aprobada: { label: 'Aprobada · lista para envío real', color: 'success' },
  rechazada: { label: 'Rechazada', color: 'error' },
  enviada_real: { label: 'Campaña real enviada', color: 'success' },
};

export const MuestrasSection = () => {
  const user = getUser();
  const { notify, FeedbackSnackbar } = useFeedback();

  // El cliente (empresa) se toma de la sesión, no se captura en el formulario.
  const cliente = user?.customer ?? '';
  const customerId = user?.customerId ?? '';
  const [campaign, setCampaign] = useState('');
  const [template, setTemplate] = useState('');
  const [version, setVersion] = useState(1);

  // Listas del backend: la campaña SE SELECCIONA (no se escribe a mano).
  const [campaignOptions, setCampaignOptions] = useState<CampaignSummary[]>([]);
  const [templateOptions, setTemplateOptions] = useState<TemplateSummary[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);

  const loadLists = useCallback(async () => {
    if (!customerId && !cliente) return;
    setLoadingLists(true);
    const [resCampaigns, resTemplates] = await Promise.all([
      customerId ? campaignsService.list(customerId) : Promise.resolve(null),
      templatesService.list(cliente, customerId),
    ]);
    setLoadingLists(false);
    if (resCampaigns && isOk(resCampaigns) && resCampaigns.data?.campaigns) {
      setCampaignOptions(resCampaigns.data.campaigns);
    }
    if (isOk(resTemplates) && resTemplates.data?.templates) {
      setTemplateOptions(resTemplates.data.templates);
    }
  }, [customerId, cliente]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  /** Solo se pueden probar campañas en estado Pendiente o Muestras (regla del backend). */
  const isSendable = (c: CampaignSummary) => c.campaignState === 'Pendiente' || c.campaignState === 'Muestras';

  const selectCampaign = (name: string) => {
    setCampaign(name);
    const found = campaignOptions.find((c) => c.campaignName === name);
    if (found?.template) setTemplate(found.template);
  };

  // Campaña seleccionada + límite de envíos de muestras (máx. MAX_SAMPLE_SENDS por campaña).
  const selectedCampaign = campaignOptions.find((c) => c.campaignName === campaign);
  const samplesSent = selectedCampaign?.samplesSentCount ?? 0;
  const samplesRemaining = Math.max(0, MAX_SAMPLE_SENDS - samplesSent);
  const samplesLimitReached = !!campaign && samplesRemaining <= 0;

  // ¿El cliente tiene habilitados los envíos reales? (lo define el admin; el backend
  // también lo bloquea). Si falta el dato en la sesión se asume habilitado.
  const realSendEnabled = user?.realSendEnabled !== false;

  // Canal de la campaña seleccionada → parámetros del estimador de costo.
  const selectedChannel = selectedCampaign?.channel ?? 'EM';
  const estimatorChannel =
    selectedChannel === 'SMS' ? 'SMS' : selectedChannel === 'WSP' ? 'WHATSAPP' : selectedChannel === 'VOZ' ? 'VOICE' : 'EMAIL';
  const estimatorMode = (['EM', 'EAU', 'EAP'].includes(selectedChannel) ? selectedChannel : 'EM') as 'EM' | 'EAU' | 'EAP';

  const [tipo, setTipo] = useState<TipoMuestra>('aleatorias');
  const [quantity, setQuantity] = useState(1);
  const [recipients, setRecipients] = useState<Recipient[]>(emptyRecipients(1));
  const [sending, setSending] = useState(false);
  const [sendingRealId, setSendingRealId] = useState<string | null>(null);
  const [lotes, setLotes] = useState<Lote[]>([]);

  const selective = tipo === 'selectivas';

  const changeQuantity = (n: number) => {
    setQuantity(n);
    setRecipients((prev) => {
      const next = [...prev];
      if (n > prev.length) while (next.length < n) next.push({ email: '', identificacion: '' });
      else next.length = n;
      return next;
    });
  };

  const updateRecipient = (i: number, field: keyof Recipient, value: string) => {
    setRecipients((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  const handleSend = async () => {
    if (!cliente.trim()) {
      return notify('Tu sesión no tiene una empresa asociada. Vuelve a iniciar sesión.', 'warning');
    }
    if (!campaign.trim()) {
      return notify('Indica la campaña a probar.', 'warning');
    }
    if (samplesLimitReached) {
      return notify(`Alcanzaste el máximo de ${MAX_SAMPLE_SENDS} envíos de muestras para esta campaña.`, 'warning');
    }
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      if (!EMAIL_RE.test(r.email.trim())) return notify(`El correo de la muestra ${i + 1} no es válido.`, 'warning');
      if (selective && !r.identificacion.trim()) return notify(`Falta la identificación de la muestra ${i + 1}.`, 'warning');
    }

    setSending(true);
    const res = await campaignsService.sendSamples({
      customerName: cliente.trim(),
      campaignName: campaign.trim(),
      userId: user?.userId ?? '',
      template: template.trim(),
      templateVersion: version,
      quantitySamples: quantity,
      selectiveSamples: selective,
      recipients: recipients.map((r) => r.email.trim()),
      identifications: selective ? recipients.map((r) => r.identificacion.trim()) : [],
    });
    setSending(false);

    // Solo registramos el lote para aprobación si el backend aceptó las muestras.
    // Guardamos los datos de la campaña para poder disparar el envío real luego.
    if (isOk(res)) {
      setLotes((prev) => [
        {
          id: `${Date.now()}`,
          cliente: cliente.trim(),
          campaign: campaign.trim(),
          template: template.trim(),
          version,
          tipo,
          recipients: recipients.map((r) => ({ ...r })),
          estado: 'enviada',
        },
        ...prev,
      ]);
      notify('Muestras enviadas correctamente. Revísalas y aprueba para el envío real.', 'success');
      loadLists(); // refresca el contador de muestras usadas de la campaña
    } else {
      notify(res.description || 'No se pudieron enviar las muestras. Revisa los datos e intenta de nuevo.', 'error');
    }
  };

  const setEstado = (id: string, estado: EstadoLote) =>
    setLotes((prev) => prev.map((l) => (l.id === id ? { ...l, estado } : l)));

  /** Dispara el envío REAL de la campaña aprobada (ruta /Email/Send-batch-template). */
  const handleSendReal = async (l: Lote) => {
    if (!realSendEnabled) {
      return notify('Los envíos reales están deshabilitados para tu cuenta.', 'warning');
    }
    setSendingRealId(l.id);
    const res = await campaignsService.sendReal({
      customerName: l.cliente,
      campaignName: l.campaign,
      userId: user?.userId ?? '',
      template: l.template,
      templateVersion: l.version,
    });
    setSendingRealId(null);

    if (isOk(res)) {
      setEstado(l.id, 'enviada_real');
      notify(`Campaña "${l.campaign}" enviada. La base completa entró al proceso de envío.`, 'success');
    } else {
      notify(res.description || 'No se pudo iniciar el envío real de la campaña.', 'error');
    }
  };

  return (
    <Box>
      <Typography variant="h4">Muestras</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Envía correos de prueba de la campaña, revísalos y apruébalos antes del envío real.
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Flujo: <strong>configurar → enviar muestras → revisar → aprobar → envío real</strong>. Las
        muestras usan <code>/Email/Send-batch-template-samples</code> (reemplaza el correo real por
        el de prueba) y, al aprobar, el envío real usa <code>/Email/Send-batch-template</code> sobre
        toda la base. La campaña debe estar en estado <em>Pendiente</em> o <em>Muestras</em>.
      </Alert>

      {!realSendEnabled && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Los <strong>envíos reales están deshabilitados</strong> para tu cuenta. Puedes enviar y
          revisar muestras, pero el envío a toda la base está bloqueado. Contacta al administrador de
          MailConnect para habilitarlo.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        {/* Campaña a probar */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <SectionTitle icon={<CampaignIcon color="primary" />} title="Campaña a probar" />
          <Stack spacing={2} sx={{ mt: 2 }}>
            <ClienteSesion cliente={cliente} />
            <TextField
              select
              label="Campaña"
              value={campaign}
              onChange={(e) => selectCampaign(e.target.value)}
              fullWidth
              size="small"
              helperText={
                loadingLists
                  ? 'Cargando campañas…'
                  : campaignOptions.length === 0
                    ? 'No hay campañas registradas; crea una en la pestaña Campañas.'
                    : 'Solo se pueden probar campañas en estado Pendiente o Muestras.'
              }
            >
              {campaignOptions.length === 0 && (
                <MenuItem value="" disabled>
                  {loadingLists ? 'Cargando…' : 'Sin campañas'}
                </MenuItem>
              )}
              {campaignOptions.map((c) => (
                <MenuItem key={c.campaignId} value={c.campaignName} disabled={!isSendable(c)}>
                  {c.campaignName} — {c.channel} · {c.campaignState}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Plantilla (SES)"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                fullWidth
                size="small"
              >
                {template && !templateOptions.some((t) => t.name === template) && (
                  <MenuItem value={template}>{template}</MenuItem>
                )}
                {templateOptions.length === 0 && !template && (
                  <MenuItem value="" disabled>
                    {loadingLists ? 'Cargando…' : 'Sin plantillas'}
                  </MenuItem>
                )}
                {templateOptions.map((t) => (
                  <MenuItem key={t.name} value={t.name}>
                    {t.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Versión de plantilla"
                type="number"
                value={version}
                onChange={(e) => setVersion(Math.max(1, parseInt(e.target.value) || 1))}
                sx={{ width: { sm: 180 } }}
                size="small"
              />
            </Stack>
          </Stack>
        </Paper>

        {/* Tipo y cantidad */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <SectionTitle icon={<TuneIcon color="primary" />} title="Tipo y cantidad" />
          <Stack spacing={2.5} sx={{ mt: 2 }}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={tipo}
              onChange={(_, v) => v && setTipo(v)}
              size="small"
            >
              <ToggleButton value="aleatorias">
                <CasinoIcon fontSize="small" sx={{ mr: 1 }} /> Aleatorias
              </ToggleButton>
              <ToggleButton value="selectivas">
                <PlaylistAddCheckIcon fontSize="small" sx={{ mr: 1 }} /> Selectivas
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              {selective
                ? 'Selectivas: eliges registros específicos de la base por su identificación.'
                : 'Aleatorias: el sistema toma registros al azar de la base para la prueba.'}
            </Typography>

            <Box sx={{ px: 1 }}>
              <Typography variant="body2" gutterBottom>
                Cantidad de muestras: <strong>{quantity}</strong>
              </Typography>
              <Slider
                value={quantity}
                onChange={(_, v) => changeQuantity(v as number)}
                min={1}
                max={MAX}
                step={1}
                marks={Array.from({ length: MAX }, (_, i) => ({ value: i + 1, label: `${i + 1}` }))}
                valueLabelDisplay="auto"
              />
            </Box>
          </Stack>
        </Paper>
      </Box>

      {/* Destinatarios de la muestra */}
      <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
        <SectionTitle
          icon={<GroupIcon color="primary" />}
          title={`Destinatarios de la muestra (${quantity})`}
          subtitle={selective ? 'Correo que recibe la prueba + identificación del registro de la base.' : 'Correos que recibirán la muestra para aprobación.'}
        />
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {recipients.map((r, i) => (
            <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
              <Avatar sx={{ width: 30, height: 30, bgcolor: '#0075be', color: '#fff', fontSize: 14, flexShrink: 0 }}>
                {i + 1}
              </Avatar>
              <TextField
                label={`Correo de la muestra ${i + 1}`}
                value={r.email}
                onChange={(e) => updateRecipient(i, 'email', e.target.value)}
                fullWidth
                size="small"
                type="email"
                InputProps={{ startAdornment: (<InputAdornment position="start"><AlternateEmailIcon fontSize="small" /></InputAdornment>) }}
              />
              {selective && (
                <TextField
                  label="Identificación"
                  value={r.identificacion}
                  onChange={(e) => updateRecipient(i, 'identificacion', e.target.value)}
                  sx={{ width: { sm: 220 } }}
                  size="small"
                  InputProps={{ startAdornment: (<InputAdornment position="start"><BadgeIcon fontSize="small" /></InputAdornment>) }}
                />
              )}
            </Stack>
          ))}
        </Stack>

        <Divider sx={{ my: 2.5 }} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <Button
            variant="contained"
            startIcon={sending ? undefined : <SendIcon />}
            onClick={handleSend}
            disabled={sending || samplesLimitReached}
          >
            {sending ? <CircularProgress size={22} /> : 'Enviar muestras'}
          </Button>
          {campaign && (
            <Chip
              size="small"
              variant="outlined"
              color={samplesLimitReached ? 'error' : samplesRemaining <= 1 ? 'warning' : 'default'}
              label={
                samplesLimitReached
                  ? `Límite alcanzado (${MAX_SAMPLE_SENDS}/${MAX_SAMPLE_SENDS})`
                  : `Envíos de muestra: ${samplesSent}/${MAX_SAMPLE_SENDS} · quedan ${samplesRemaining}`
              }
            />
          )}
        </Stack>
        {samplesLimitReached && (
          <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
            Alcanzaste el máximo de {MAX_SAMPLE_SENDS} envíos de muestras para esta campaña. Aprueba y
            envía la campaña real, o crea una nueva campaña.
          </Typography>
        )}
      </Paper>

      {/* Estimador de costo (antes de aprobar y enviar la campaña real) */}
      <Box sx={{ mb: 2 }}>
        <CostEstimate channel={estimatorChannel} emailMode={estimatorMode} />
      </Box>

      {/* Aprobación */}
      {lotes.length > 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <SectionTitle icon={<CheckCircleIcon color="primary" />} title="Muestras enviadas y aprobación" />
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            {lotes.map((l) => (
              <Paper key={l.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }}>
                  <Box>
                    <Typography fontWeight={600}>{l.campaign}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center" mt={0.5} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={l.tipo === 'aleatorias' ? 'Aleatorias' : 'Selectivas'} variant="outlined" />
                      <Chip size="small" label={`${l.recipients.length} destinatario(s)`} variant="outlined" />
                      <Chip size="small" color={estadoChip[l.estado].color} label={estadoChip[l.estado].label} variant="outlined" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {l.recipients.map((r) => r.email).join(', ')}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexShrink={0}>
                    {l.estado === 'enviada' ? (
                      <>
                        <Button size="small" color="success" variant="outlined" startIcon={<CheckCircleIcon />} onClick={() => setEstado(l.id, 'aprobada')}>
                          Aprobar
                        </Button>
                        <Button size="small" color="error" variant="outlined" startIcon={<CancelIcon />} onClick={() => setEstado(l.id, 'rechazada')}>
                          Rechazar
                        </Button>
                      </>
                    ) : l.estado === 'aprobada' ? (
                      <Tooltip title={realSendEnabled ? 'Envía la campaña a TODA la base de datos (envío real).' : 'Envíos reales deshabilitados para tu cuenta.'}>
                        <span>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={sendingRealId === l.id ? <CircularProgress size={16} color="inherit" /> : <RocketLaunchIcon />}
                            disabled={sendingRealId !== null || !realSendEnabled}
                            onClick={() => handleSendReal(l)}
                          >
                            {sendingRealId === l.id ? 'Enviando…' : 'Enviar campaña real'}
                          </Button>
                        </span>
                      </Tooltip>
                    ) : l.estado === 'enviada_real' ? (
                      <Chip size="small" color="success" icon={<RocketLaunchIcon />} label="En proceso de envío" />
                    ) : (
                      <Button size="small" variant="text" onClick={() => setEstado(l.id, 'enviada')}>
                        Reabrir
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Paper>
      )}

      {FeedbackSnackbar}
    </Box>
  );
};

/** Muestra la empresa activa de la sesión (el "customer" ya no se captura a mano). */
const ClienteSesion = ({ cliente }: { cliente: string }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <ApartmentIcon fontSize="small" color="action" />
    <Typography variant="body2" color="text.secondary">
      Empresa:&nbsp;
    </Typography>
    <Chip
      size="small"
      label={cliente || 'sin empresa en la sesión'}
      color={cliente ? 'primary' : 'default'}
      variant="outlined"
    />
  </Box>
);

const SectionTitle = ({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) => (
  <Box>
    <Stack direction="row" spacing={1} alignItems="center">
      {icon}
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
    </Stack>
    {subtitle && (
      <Typography variant="caption" color="text.secondary">
        {subtitle}
      </Typography>
    )}
  </Box>
);
