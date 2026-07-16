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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CampaignIcon from '@mui/icons-material/Campaign';
import TuneIcon from '@mui/icons-material/Tune';
import GroupIcon from '@mui/icons-material/Group';
import CasinoIcon from '@mui/icons-material/Casino';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import BadgeIcon from '@mui/icons-material/Badge';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import ApartmentIcon from '@mui/icons-material/Apartment';
import MenuItem from '@mui/material/MenuItem';
import { getUser, canApprove } from '../../services/authService';
import { campaignsService, MAX_SAMPLE_SENDS } from '../../services/campaignsService';
import type { CampaignSummary, ApprovalStatus } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { CostEstimate } from './CostEstimate';
import { usePortalData } from '../../context/PortalDataContext';
import { costService, formatCOP, type EstimateResult, type Channel, type EmailMode } from '../../services/costService';
import { isValidPhone } from './csv';
import { formatDateTime } from '../../utils/datetime';
import { CampaignOption, campaignOptionText } from './campaignOption';

type TipoMuestra = 'aleatorias' | 'selectivas';

interface Recipient {
  email: string;
  identificacion: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = 5;

const emptyRecipients = (n: number): Recipient[] =>
  Array.from({ length: n }, () => ({ email: '', identificacion: '' }));

/** Metadatos del estado de aprobación (chip + color). */
const APPROVAL_META: Record<ApprovalStatus, { label: string; color: 'default' | 'info' | 'success' | 'error' | 'warning' }> = {
  none: { label: 'Sin solicitar', color: 'default' },
  pending: { label: 'Pendiente de aprobación', color: 'warning' },
  approved: { label: 'Aprobada · lista para envío real', color: 'success' },
  rejected: { label: 'Rechazada', color: 'error' },
};

export const MuestrasSection = () => {
  const user = getUser();
  const { notify, FeedbackSnackbar } = useFeedback();
  // Saldo del monedero (precargado): gate del "Enviar campaña real" (cobro PREPAGO).
  // `databases` → tamaño de la base (destinatarios reales) para el modal de confirmación.
  // `refreshCampaigns` mantiene sincronizado el estado de aprobación con los otros tabs.
  const { balance, refreshBalance, databases, refreshCampaigns } = usePortalData();
  // Último estimado calculado (lo reporta CostEstimate): permite avisar y bloquear el
  // envío real si el saldo no alcanza (gate del front; el backend igual valida con 402).
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const insufficientBalance = estimate != null && balance.value < estimate.estimatedCost;

  // El cliente (empresa) se toma de la sesión, no se captura en el formulario.
  const cliente = user?.customer ?? '';
  const customerId = user?.customerId ?? '';
  const [campaign, setCampaign] = useState('');
  const [template, setTemplate] = useState('');
  // Versión de plantilla fija: el selector se quitó (por ahora no se necesita elegirla).
  const version = 1;

  // Listas del backend: la campaña SE SELECCIONA (no se escribe a mano). La plantilla NO
  // se elige aquí: ya viene configurada en la campaña (al seleccionarla se conoce todo).
  const [campaignOptions, setCampaignOptions] = useState<CampaignSummary[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);

  const loadLists = useCallback(async () => {
    if (!customerId && !cliente) return;
    setLoadingLists(true);
    const resCampaigns = customerId ? await campaignsService.list(customerId) : null;
    setLoadingLists(false);
    if (resCampaigns && isOk(resCampaigns) && resCampaigns.data?.campaigns) {
      setCampaignOptions(resCampaigns.data.campaigns);
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
    else setTemplate('');
  };

  // Campaña seleccionada + límite de envíos de muestras (máx. MAX_SAMPLE_SENDS por campaña).
  const selectedCampaign = campaignOptions.find((c) => c.campaignName === campaign);
  const selectedCampaignId = selectedCampaign?.campaignId ?? '';
  const samplesSent = selectedCampaign?.samplesSentCount ?? 0;
  const samplesRemaining = Math.max(0, MAX_SAMPLE_SENDS - samplesSent);
  const samplesLimitReached = !!campaign && samplesRemaining <= 0;
  // Estado de aprobación persistido de la campaña seleccionada.
  const approval: ApprovalStatus = (selectedCampaign?.approvalStatus as ApprovalStatus) ?? 'none';
  const isSending = selectedCampaign
    ? ['Enviando', 'Procesando', 'Terminada'].includes(selectedCampaign.campaignState)
    : false;

  // ¿El cliente tiene habilitados los envíos reales? (lo define el admin; el backend
  // también lo bloquea). Si falta el dato en la sesión se asume habilitado.
  const realSendEnabled = user?.realSendEnabled !== false;
  // RBAC: solo owner/approver aprueban/rechazan y disparan el envío real. El operator
  // solo envía muestras y solicita la aprobación (el envío real está en tab Aprobaciones).
  const canApproveActions = canApprove(user);

  // Canal de la campaña seleccionada → parámetros del estimador de costo.
  const selectedChannel = selectedCampaign?.channel ?? 'EM';
  const estimatorChannel =
    selectedChannel === 'SMS' ? 'SMS' : selectedChannel === 'WSP' ? 'WHATSAPP' : selectedChannel === 'VOZ' ? 'VOICE' : 'EMAIL';
  const estimatorMode = (['EM', 'EAU', 'EAP'].includes(selectedChannel) ? selectedChannel : 'EM') as 'EM' | 'EAU' | 'EAP';

  // Tipo de contacto de la muestra según el canal de la campaña: SMS/WhatsApp/Voz reciben
  // CELULAR (E.164), el resto (correo). Define el label, ícono y la validación del input.
  const sampleContact: 'email' | 'phone' =
    selectedChannel === 'SMS' || selectedChannel === 'WSP' || selectedChannel === 'VOZ' ? 'phone' : 'email';
  const contactLabel = sampleContact === 'phone' ? 'Celular' : 'Correo';
  const contactValid = (v: string) => (sampleContact === 'phone' ? isValidPhone(v) : EMAIL_RE.test(v));

  const [tipo, setTipo] = useState<TipoMuestra>('aleatorias');
  const [quantity, setQuantity] = useState(1);
  const [recipients, setRecipients] = useState<Recipient[]>(emptyRecipients(1));
  const [sending, setSending] = useState(false);
  // Acciones de aprobación (solicitar/aprobar/rechazar) y envío real, sobre la campaña.
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [sendingReal, setSendingReal] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Modal de confirmación del envío real: estimado exacto sobre el tamaño de la base +
  // casilla de responsabilidad (obligatoria para poder enviar).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAccepted, setConfirmAccepted] = useState(false);
  const [confirmEstimate, setConfirmEstimate] = useState<EstimateResult | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const selective = tipo === 'selectivas';

  /** Nº de destinatarios reales = filas de la base asociada a la campaña (por su dataPath). */
  const baseRowsForCampaign = (c?: CampaignSummary): number | null => {
    if (!c?.dataPath) return null;
    const db = databases.items.find((f) => f.s3Path === c.dataPath);
    return db ? db.totalRecords : null;
  };

  /** Canal/submodo del estimador para una campaña (por su canal). */
  const estimatorFor = (c?: CampaignSummary): { channel: Channel; emailMode: EmailMode } => {
    const ch = c?.channel ?? 'EM';
    const channel: Channel = ch === 'SMS' ? 'SMS' : ch === 'WSP' ? 'WHATSAPP' : ch === 'VOZ' ? 'VOICE' : 'EMAIL';
    const emailMode = (['EM', 'EAU', 'EAP'].includes(ch) ? ch : 'EM') as EmailMode;
    return { channel, emailMode };
  };

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

  /** Refresca la lista local (estado de aprobación de la campaña) y la del contexto. */
  const refreshAll = useCallback(async () => {
    await loadLists();
    refreshCampaigns();
  }, [loadLists, refreshCampaigns]);

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
      if (!contactValid(r.email.trim())) {
        return notify(
          sampleContact === 'phone'
            ? `El celular de la muestra ${i + 1} no es válido (usa formato E.164, ej. +57…).`
            : `El correo de la muestra ${i + 1} no es válido.`,
          'warning',
        );
      }
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

    if (isOk(res)) {
      notify('Muestras enviadas correctamente. Revísalas y solicita la aprobación.', 'success');
      refreshAll(); // refresca el contador de muestras y el estado de aprobación persistido
    } else {
      notify(res.description || 'No se pudieron enviar las muestras. Revisa los datos e intenta de nuevo.', 'error');
    }
  };

  /** El funcional SOLICITA la aprobación de la campaña (requiere ≥1 muestra enviada). */
  const handleRequestApproval = async () => {
    if (!selectedCampaignId) return;
    setApprovalBusy(true);
    const res = await campaignsService.requestApproval(selectedCampaignId);
    setApprovalBusy(false);
    if (isOk(res)) {
      notify('Aprobación solicitada. Un aprobador debe revisarla antes del envío real.', 'success');
      refreshAll();
    } else {
      notify(res.description || 'No se pudo solicitar la aprobación.', 'error');
    }
  };

  /** Aprueba la campaña (en Fase 1 disponible aquí; en Fase 2 vive en el tab Aprobaciones). */
  const handleApprove = async () => {
    if (!selectedCampaignId) return;
    setApprovalBusy(true);
    const res = await campaignsService.approve(selectedCampaignId);
    setApprovalBusy(false);
    if (isOk(res)) {
      notify('Campaña aprobada. Ya puedes enviarla a toda la base.', 'success');
      refreshAll();
    } else {
      notify(res.description || 'No se pudo aprobar la campaña.', 'error');
    }
  };

  /** Rechaza la campaña con un motivo (obligatorio). */
  const handleReject = async () => {
    if (!selectedCampaignId) return;
    if (!rejectReason.trim()) return notify('Indica el motivo del rechazo.', 'warning');
    setApprovalBusy(true);
    const res = await campaignsService.reject(selectedCampaignId, rejectReason.trim());
    setApprovalBusy(false);
    if (isOk(res)) {
      notify('Campaña rechazada. El motivo quedó registrado.', 'success');
      setRejectOpen(false);
      setRejectReason('');
      refreshAll();
    } else {
      notify(res.description || 'No se pudo rechazar la campaña.', 'error');
    }
  };

  /**
   * Abre el MODAL de confirmación del envío real. Solo procede con la campaña APROBADA
   * (approvalStatus === 'approved'). El modal calcula el estimado exacto sobre el tamaño
   * de la base y pide aceptar responsabilidad.
   */
  const openRealConfirm = async () => {
    if (!realSendEnabled) {
      return notify('Los envíos reales están deshabilitados para tu cuenta.', 'warning');
    }
    setConfirmAccepted(false);
    setConfirmEstimate(null);
    setConfirmOpen(true);
    const recipientsCount = baseRowsForCampaign(selectedCampaign);
    if (recipientsCount && recipientsCount > 0) {
      setConfirmLoading(true);
      const { channel, emailMode } = estimatorFor(selectedCampaign);
      const res = await costService.estimate({
        customerId,
        channel,
        recipients: recipientsCount,
        emailMode: channel === 'EMAIL' ? emailMode : undefined,
      });
      setConfirmLoading(false);
      if (isOk(res) && res.data) setConfirmEstimate(res.data);
    }
  };

  const closeRealConfirm = () => {
    if (sendingReal) return; // no cerrar mientras se envía
    setConfirmOpen(false);
    setConfirmAccepted(false);
    setConfirmEstimate(null);
  };

  /** Dispara el envío REAL de la campaña aprobada (ruta /Email/Send-batch-template). */
  const handleSendReal = async () => {
    if (!selectedCampaign) return;
    if (!realSendEnabled) {
      return notify('Los envíos reales están deshabilitados para tu cuenta.', 'warning');
    }
    setSendingReal(true);
    const res = await campaignsService.sendReal({
      customerName: cliente,
      campaignName: selectedCampaign.campaignName,
      userId: user?.userId ?? '',
      template: selectedCampaign.template ?? template,
      templateVersion: version,
    });
    setSendingReal(false);

    if (isOk(res)) {
      notify(`Campaña "${selectedCampaign.campaignName}" enviada. La base completa entró al proceso de envío.`, 'success');
      setConfirmOpen(false);
      setConfirmAccepted(false);
      // El envío real debitó el saldo: refréscalo para que el gate refleje el saldo nuevo.
      refreshBalance();
      refreshAll();
    } else {
      notify(res.description || 'No se pudo iniciar el envío real de la campaña.', 'error');
    }
  };

  // Nº de destinatarios y saldo insuficiente para la campaña en confirmación.
  const confirmRecipients = baseRowsForCampaign(selectedCampaign);
  const confirmCost = confirmEstimate?.estimatedCost ?? null;
  const confirmInsufficient = confirmCost != null && balance.value < confirmCost;

  return (
    <Box>
      <Typography variant="h4">Muestras</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Envía correos de prueba de la campaña, revísalos y apruébalos antes del envío real.
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Flujo: <strong>configurar → enviar muestras → solicitar aprobación → aprobar → envío real</strong>.
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
              SelectProps={{ renderValue: (v) => campaignOptionText(campaignOptions.find((c) => c.campaignName === v)) || String(v) }}
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
                  <CampaignOption c={c} />
                </MenuItem>
              ))}
            </TextField>
            {/* La plantilla NO se elige aquí: es la que quedó configurada en la campaña.
                Al seleccionar la campaña se conoce el canal, la plantilla y el resto. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <TextField
                label={selectedChannel === 'SMS' || selectedChannel === 'VOZ' ? 'Mensaje de la campaña' : selectedChannel === 'WSP' ? 'Plantilla WhatsApp (HSM)' : 'Plantilla de la campaña'}
                value={template || (campaign ? '—' : '')}
                fullWidth
                size="small"
                InputProps={{ readOnly: true }}
                placeholder={campaign ? '' : 'Selecciona una campaña'}
                helperText="Definida en la campaña; no se cambia desde muestras."
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
          subtitle={
            selective
              ? `${contactLabel} que recibe la prueba + identificación del registro de la base.`
              : `${sampleContact === 'phone' ? 'Celulares' : 'Correos'} que recibirán la muestra para aprobación.`
          }
        />
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {recipients.map((r, i) => (
            <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
              <Avatar sx={{ width: 30, height: 30, bgcolor: '#0075be', color: '#fff', fontSize: 14, flexShrink: 0 }}>
                {i + 1}
              </Avatar>
              <TextField
                label={`${contactLabel} de la muestra ${i + 1}`}
                value={r.email}
                onChange={(e) => updateRecipient(i, 'email', e.target.value)}
                fullWidth
                size="small"
                type={sampleContact === 'phone' ? 'tel' : 'email'}
                placeholder={sampleContact === 'phone' ? '+573001234567' : ''}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      {sampleContact === 'phone' ? <SmartphoneIcon fontSize="small" /> : <AlternateEmailIcon fontSize="small" />}
                    </InputAdornment>
                  ),
                }}
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

      {/* Estimador de costo + saldo (antes de aprobar y enviar la campaña real) */}
      <Box sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            variant="outlined"
            color={balance.value <= 0 ? 'error' : 'default'}
            label={`Saldo disponible: ${formatCOP(balance.value)}`}
          />
          {insufficientBalance && (
            <Chip size="small" color="error" label="Saldo insuficiente para el envío estimado" />
          )}
        </Stack>
        <CostEstimate channel={estimatorChannel} emailMode={estimatorMode} balance={balance.value} onResult={setEstimate} />
      </Box>

      {/* Estado de aprobación de la campaña seleccionada (PERSISTIDO) */}
      {selectedCampaign && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <SectionTitle icon={<HowToRegIcon color="primary" />} title="Aprobación de la campaña" />
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography fontWeight={600}>{selectedCampaign.campaignName}</Typography>
              <Chip size="small" variant="outlined" color={APPROVAL_META[approval].color} label={APPROVAL_META[approval].label} />
              {samplesSent > 0 && (
                <Chip size="small" variant="outlined" label={`${samplesSent} envío(s) de muestra`} />
              )}
            </Stack>

            {/* Trazabilidad de la solicitud/revisión */}
            {(selectedCampaign.approvalRequestedAt || selectedCampaign.approvalReviewedAt) && (
              <Typography variant="caption" color="text.secondary">
                {selectedCampaign.approvalRequestedAt &&
                  `Solicitada por ${selectedCampaign.approvalRequestedByName || '—'} el ${formatDateTime(selectedCampaign.approvalRequestedAt)}. `}
                {selectedCampaign.approvalReviewedAt &&
                  `Revisada por ${selectedCampaign.approvalReviewedByName || '—'} el ${formatDateTime(selectedCampaign.approvalReviewedAt)}.`}
              </Typography>
            )}

            {approval === 'rejected' && selectedCampaign.approvalRejectReason && (
              <Alert severity="error" variant="outlined">
                <strong>Motivo del rechazo:</strong> {selectedCampaign.approvalRejectReason}
              </Alert>
            )}

            {isSending ? (
              <Chip size="small" color="success" icon={<RocketLaunchIcon />} label="En proceso de envío real" sx={{ alignSelf: 'flex-start' }} />
            ) : (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {/* none / rejected → solicitar (o re-solicitar) aprobación */}
                {(approval === 'none' || approval === 'rejected') && (
                  <Tooltip title={samplesSent <= 0 ? 'Envía al menos una muestra antes de solicitar la aprobación.' : ''}>
                    <span>
                      <Button
                        variant="contained"
                        startIcon={approvalBusy ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                        disabled={approvalBusy || samplesSent <= 0}
                        onClick={handleRequestApproval}
                      >
                        {approval === 'rejected' ? 'Solicitar aprobación de nuevo' : 'Solicitar aprobación'}
                      </Button>
                    </span>
                  </Tooltip>
                )}

                {/* pending → aprobar / rechazar (solo owner/approver; también en Aprobaciones) */}
                {approval === 'pending' && canApproveActions && (
                  <>
                    <Button color="success" variant="outlined" startIcon={<CheckCircleIcon />} disabled={approvalBusy} onClick={handleApprove}>
                      Aprobar
                    </Button>
                    <Button color="error" variant="outlined" startIcon={<CancelIcon />} disabled={approvalBusy} onClick={() => { setRejectReason(''); setRejectOpen(true); }}>
                      Rechazar
                    </Button>
                  </>
                )}
                {approval === 'pending' && !canApproveActions && (
                  <Typography variant="caption" color="text.secondary">
                    Un aprobador de tu empresa debe revisarla en el tab <strong>Aprobaciones</strong>.
                  </Typography>
                )}

                {/* approved → envío real (solo owner/approver) */}
                {approval === 'approved' && canApproveActions && (
                  <Tooltip title={!realSendEnabled ? 'Envíos reales deshabilitados para tu cuenta.' : insufficientBalance ? 'Saldo insuficiente: recarga tu monedero para enviar.' : 'Envía la campaña a TODA la base de datos (envío real).'}>
                    <span>
                      <Button
                        variant="contained"
                        color="success"
                        startIcon={<RocketLaunchIcon />}
                        disabled={sendingReal || !realSendEnabled || insufficientBalance}
                        onClick={openRealConfirm}
                      >
                        Enviar campaña real
                      </Button>
                    </span>
                  </Tooltip>
                )}
                {approval === 'approved' && !canApproveActions && (
                  <Typography variant="caption" color="success.main">
                    Aprobada. Un aprobador puede enviarla desde el tab <strong>Aprobaciones</strong>.
                  </Typography>
                )}
              </Stack>
            )}
          </Stack>
        </Paper>
      )}

      {/* Diálogo de rechazo (motivo obligatorio) */}
      <Dialog open={rejectOpen} onClose={() => !approvalBusy && setRejectOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Rechazar campaña</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            El motivo se le mostrará al funcional para que corrija la campaña.
          </Typography>
          <TextField
            label="Motivo del rechazo"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)} disabled={approvalBusy}>Cancelar</Button>
          <Button
            color="error"
            variant="contained"
            startIcon={approvalBusy ? <CircularProgress size={16} color="inherit" /> : <CancelIcon />}
            disabled={approvalBusy || !rejectReason.trim()}
            onClick={handleReject}
          >
            Rechazar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal de confirmación del ENVÍO REAL (cuántos envíos + costo estimado + responsabilidad) */}
      <Dialog open={confirmOpen} onClose={closeRealConfirm} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RocketLaunchIcon color="success" /> Confirmar envío real
        </DialogTitle>
        <DialogContent dividers>
          {selectedCampaign && (
            <Stack spacing={2}>
              <Typography variant="body2">
                Vas a enviar la campaña <strong>{selectedCampaign.campaignName}</strong> a <strong>toda la
                base de datos</strong>. Esta acción es <strong>irreversible</strong> y debita tu
                saldo.
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 1.5,
                  p: 2,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
              >
                <StatLine
                  label="Envíos a realizar"
                  value={confirmRecipients != null ? confirmRecipients.toLocaleString('es-CO') : 'No disponible'}
                />
                <StatLine
                  label="Costo estimado"
                  value={confirmLoading ? '…' : confirmCost != null ? formatCOP(confirmCost) : 'No disponible'}
                />
                <StatLine label="Saldo disponible" value={formatCOP(balance.value)} />
                <StatLine
                  label="Saldo tras el envío"
                  value={confirmCost != null ? formatCOP(balance.value - confirmCost) : '—'}
                />
              </Box>

              {confirmRecipients == null && (
                <Alert severity="warning">
                  No se pudo determinar el tamaño de la base asociada a esta campaña (puede que la
                  base no esté registrada). El backend validará el saldo al enviar.
                </Alert>
              )}
              {confirmInsufficient && (
                <Alert severity="error">
                  Tu <strong>saldo no alcanza</strong> para este envío. Recarga tu monedero antes de
                  continuar.
                </Alert>
              )}
              {confirmEstimate?.isEstimate && (
                <Typography variant="caption" color="text.secondary">
                  El valor es un <strong>estimado</strong>; el cobro definitivo lo calcula el sistema
                  al procesar el envío.
                </Typography>
              )}

              <FormControlLabel
                control={
                  <Checkbox
                    checked={confirmAccepted}
                    onChange={(e) => setConfirmAccepted(e.target.checked)}
                    color="success"
                  />
                }
                label={
                  <Typography variant="body2">
                    Confirmo que revisé las muestras y <strong>autorizo el envío real</strong> a toda
                    la base, asumiendo la responsabilidad y el cobro correspondiente.
                  </Typography>
                }
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRealConfirm} disabled={sendingReal}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={sendingReal ? <CircularProgress size={16} color="inherit" /> : <RocketLaunchIcon />}
            disabled={!selectedCampaign || !confirmAccepted || sendingReal || confirmLoading || confirmInsufficient}
            onClick={handleSendReal}
          >
            {sendingReal ? 'Enviando…' : 'Enviar campaña real'}
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};

/** Par etiqueta/valor para el resumen del modal de confirmación. */
const StatLine = ({ label, value }: { label: string; value: string }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography variant="subtitle2" fontWeight={700}>
      {value}
    </Typography>
  </Box>
);

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
