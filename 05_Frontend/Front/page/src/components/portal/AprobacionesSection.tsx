import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Button,
  Chip,
  Alert,
  Divider,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import type { CampaignSummary } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { usePortalData } from '../../context/PortalDataContext';
import { costService, formatCOP, type EstimateResult, type Channel, type EmailMode } from '../../services/costService';
import { formatDateTime } from '../../utils/datetime';

/** Bandeja de APROBACIONES (checker): campañas pendientes de revisar y aprobadas listas
 *  para el envío real. Solo owner/approver (gating de tab en el sidebar). Ver
 *  PLAN_APROBACIONES.md. */
export const AprobacionesSection = () => {
  const user = getUser();
  const customerId = user?.customerId ?? '';
  const cliente = user?.customer ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();
  const { campaigns, databases, balance, refreshCampaigns, refreshBalance } = usePortalData();

  const realSendEnabled = user?.realSendEnabled !== false;

  const items = campaigns.items;
  const pending = items.filter((c) => c.approvalStatus === 'pending');
  const approved = items.filter(
    (c) => c.approvalStatus === 'approved' && !['Enviando', 'Procesando', 'Terminada'].includes(c.campaignState),
  );

  const [busyId, setBusyId] = useState<string | null>(null);

  // Rechazo
  const [rejectFor, setRejectFor] = useState<CampaignSummary | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Envío real
  const [confirmFor, setConfirmFor] = useState<CampaignSummary | null>(null);
  const [confirmAccepted, setConfirmAccepted] = useState(false);
  const [confirmEstimate, setConfirmEstimate] = useState<EstimateResult | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [sendingReal, setSendingReal] = useState(false);

  const baseRows = (c: CampaignSummary): number | null => {
    if (!c.dataPath) return null;
    const db = databases.items.find((f) => f.s3Path === c.dataPath);
    return db ? db.totalRecords : null;
  };

  const estimatorFor = (c: CampaignSummary): { channel: Channel; emailMode: EmailMode } => {
    const ch = c.channel ?? 'EM';
    const channel: Channel = ch === 'SMS' ? 'SMS' : ch === 'WSP' ? 'WHATSAPP' : ch === 'VOZ' ? 'VOICE' : 'EMAIL';
    const emailMode = (['EM', 'EAU', 'EAP'].includes(ch) ? ch : 'EM') as EmailMode;
    return { channel, emailMode };
  };

  const handleApprove = async (c: CampaignSummary) => {
    setBusyId(c.campaignId);
    const res = await campaignsService.approve(c.campaignId);
    setBusyId(null);
    if (isOk(res)) {
      notify(`Campaña "${c.campaignName}" aprobada.`, 'success');
      refreshCampaigns();
    } else {
      notify(res.description || 'No se pudo aprobar la campaña.', 'error');
    }
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    if (!rejectReason.trim()) return notify('Indica el motivo del rechazo.', 'warning');
    setBusyId(rejectFor.campaignId);
    const res = await campaignsService.reject(rejectFor.campaignId, rejectReason.trim());
    setBusyId(null);
    if (isOk(res)) {
      notify('Campaña rechazada. El motivo quedó registrado.', 'success');
      setRejectFor(null);
      setRejectReason('');
      refreshCampaigns();
    } else {
      notify(res.description || 'No se pudo rechazar la campaña.', 'error');
    }
  };

  const openConfirm = async (c: CampaignSummary) => {
    if (!realSendEnabled) return notify('Los envíos reales están deshabilitados para tu cuenta.', 'warning');
    setConfirmAccepted(false);
    setConfirmEstimate(null);
    setConfirmFor(c);
    const recipients = baseRows(c);
    if (recipients && recipients > 0) {
      setConfirmLoading(true);
      const { channel, emailMode } = estimatorFor(c);
      const res = await costService.estimate({
        customerId,
        channel,
        recipients,
        emailMode: channel === 'EMAIL' ? emailMode : undefined,
      });
      setConfirmLoading(false);
      if (isOk(res) && res.data) setConfirmEstimate(res.data);
    }
  };

  const closeConfirm = () => {
    if (sendingReal) return;
    setConfirmFor(null);
    setConfirmAccepted(false);
    setConfirmEstimate(null);
  };

  const submitSendReal = async () => {
    if (!confirmFor) return;
    setSendingReal(true);
    const res = await campaignsService.sendReal({
      customerName: cliente,
      campaignName: confirmFor.campaignName,
      userId: user?.userId ?? '',
      template: confirmFor.template ?? '',
      templateVersion: 1,
    });
    setSendingReal(false);
    if (isOk(res)) {
      notify(`Campaña "${confirmFor.campaignName}" enviada. La base completa entró al proceso de envío.`, 'success');
      setConfirmFor(null);
      setConfirmAccepted(false);
      refreshBalance();
      refreshCampaigns();
    } else {
      notify(res.description || 'No se pudo iniciar el envío real de la campaña.', 'error');
    }
  };

  const confirmRecipients = confirmFor ? baseRows(confirmFor) : null;
  const confirmCost = confirmEstimate?.estimatedCost ?? null;
  const confirmInsufficient = confirmCost != null && balance.value < confirmCost;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Aprobaciones</Typography>
          <Typography variant="body2" color="text.secondary">
            Revisa las muestras, aprueba o rechaza, y dispara el envío real de las campañas aprobadas.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={campaigns.loading ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={refreshCampaigns}
          disabled={campaigns.loading}
        >
          Actualizar
        </Button>
      </Stack>

      <Chip
        size="small"
        variant="outlined"
        color={balance.value <= 0 ? 'error' : 'default'}
        label={`Saldo disponible: ${formatCOP(balance.value)}`}
        sx={{ mb: 2 }}
      />

      {/* Pendientes de aprobación */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        Pendientes de aprobación ({pending.length})
      </Typography>
      {pending.length === 0 ? (
        <Alert severity="info" sx={{ mb: 3 }} variant="outlined">
          No hay campañas esperando aprobación.
        </Alert>
      ) : (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {pending.map((c) => (
            <Paper key={c.campaignId} variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={600}>{c.campaignName}</Typography>
                    <Chip size="small" variant="outlined" color="primary" label={c.channel} />
                    <Chip size="small" variant="outlined" label={`${c.samplesSentCount ?? 0} muestra(s)`} />
                  </Stack>
                  {c.approvalRequestedAt && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Solicitada por {c.approvalRequestedByName || '—'} el {formatDateTime(c.approvalRequestedAt)}
                    </Typography>
                  )}
                  {c.sampleBatches && c.sampleBatches.length > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Muestras enviadas a: {c.sampleBatches.flatMap((b) => b.recipients).join(', ')}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={1} flexShrink={0}>
                  <Button
                    color="success"
                    variant="outlined"
                    startIcon={busyId === c.campaignId ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
                    disabled={busyId !== null}
                    onClick={() => handleApprove(c)}
                  >
                    Aprobar
                  </Button>
                  <Button
                    color="error"
                    variant="outlined"
                    startIcon={<CancelIcon />}
                    disabled={busyId !== null}
                    onClick={() => { setRejectFor(c); setRejectReason(''); }}
                  >
                    Rechazar
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Aprobadas · listas para envío */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        Aprobadas · listas para envío ({approved.length})
      </Typography>
      {approved.length === 0 ? (
        <Alert severity="info" variant="outlined">
          No hay campañas aprobadas pendientes de envío.
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          {approved.map((c) => (
            <Paper key={c.campaignId} variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={600}>{c.campaignName}</Typography>
                    <Chip size="small" variant="outlined" color="primary" label={c.channel} />
                    <Chip size="small" color="success" variant="outlined" icon={<HowToRegIcon />} label="Aprobada" />
                  </Stack>
                  {c.approvalReviewedAt && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Aprobada por {c.approvalReviewedByName || '—'} el {formatDateTime(c.approvalReviewedAt)}
                    </Typography>
                  )}
                </Box>
                <Tooltip title={!realSendEnabled ? 'Envíos reales deshabilitados para tu cuenta.' : 'Envía la campaña a TODA la base de datos.'}>
                  <span>
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={<RocketLaunchIcon />}
                      disabled={!realSendEnabled}
                      onClick={() => openConfirm(c)}
                    >
                      Enviar campaña real
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Diálogo de rechazo */}
      <Dialog open={!!rejectFor} onClose={() => busyId === null && setRejectFor(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Rechazar campaña</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            El motivo se le mostrará al funcional para que corrija la campaña <strong>{rejectFor?.campaignName}</strong>.
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
          <Button onClick={() => setRejectFor(null)} disabled={busyId !== null}>Cancelar</Button>
          <Button
            color="error"
            variant="contained"
            startIcon={busyId !== null ? <CircularProgress size={16} color="inherit" /> : <CancelIcon />}
            disabled={busyId !== null || !rejectReason.trim()}
            onClick={submitReject}
          >
            Rechazar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal de confirmación del envío real */}
      <Dialog open={!!confirmFor} onClose={closeConfirm} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RocketLaunchIcon color="success" /> Confirmar envío real
        </DialogTitle>
        <DialogContent dividers>
          {confirmFor && (
            <Stack spacing={2}>
              <Typography variant="body2">
                Vas a enviar la campaña <strong>{confirmFor.campaignName}</strong> a <strong>toda la base
                de datos</strong>. Esta acción es <strong>irreversible</strong> y debita tu saldo.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
                <StatLine label="Envíos a realizar" value={confirmRecipients != null ? confirmRecipients.toLocaleString('es-CO') : 'No disponible'} />
                <StatLine label="Costo estimado" value={confirmLoading ? '…' : confirmCost != null ? formatCOP(confirmCost) : 'No disponible'} />
                <StatLine label="Saldo disponible" value={formatCOP(balance.value)} />
                <StatLine label="Saldo tras el envío" value={confirmCost != null ? formatCOP(balance.value - confirmCost) : '—'} />
              </Box>
              {confirmRecipients == null && (
                <Alert severity="warning">
                  No se pudo determinar el tamaño de la base asociada. El backend validará el saldo al enviar.
                </Alert>
              )}
              {confirmInsufficient && (
                <Alert severity="error">Tu <strong>saldo no alcanza</strong> para este envío. Recarga tu monedero.</Alert>
              )}
              <FormControlLabel
                control={<Checkbox checked={confirmAccepted} onChange={(e) => setConfirmAccepted(e.target.checked)} color="success" />}
                label={
                  <Typography variant="body2">
                    Confirmo que revisé las muestras y <strong>autorizo el envío real</strong> a toda la base,
                    asumiendo la responsabilidad y el cobro correspondiente.
                  </Typography>
                }
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirm} disabled={sendingReal}>Cancelar</Button>
          <Button
            variant="contained"
            color="success"
            startIcon={sendingReal ? <CircularProgress size={16} color="inherit" /> : <RocketLaunchIcon />}
            disabled={!confirmFor || !confirmAccepted || sendingReal || confirmLoading || confirmInsufficient}
            onClick={submitSendReal}
          >
            {sendingReal ? 'Enviando…' : 'Enviar campaña real'}
          </Button>
        </DialogActions>
      </Dialog>

      <Divider sx={{ mt: 3 }} />
      {FeedbackSnackbar}
    </Box>
  );
};

const StatLine = ({ label, value }: { label: string; value: string }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
    <Typography variant="subtitle2" fontWeight={700}>{value}</Typography>
  </Box>
);
