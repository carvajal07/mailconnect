import { useState } from 'react';
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
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

type TipoMuestra = 'aleatorias' | 'selectivas';
type EstadoLote = 'enviada' | 'aprobada' | 'rechazada';

interface Recipient {
  email: string;
  identificacion: string;
}

interface Lote {
  id: string;
  campaign: string;
  tipo: TipoMuestra;
  recipients: Recipient[];
  estado: EstadoLote;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = 5;

const emptyRecipients = (n: number): Recipient[] =>
  Array.from({ length: n }, () => ({ email: '', identificacion: '' }));

const estadoChip: Record<EstadoLote, { label: string; color: 'info' | 'success' | 'error' }> = {
  enviada: { label: 'Enviada · pendiente de aprobación', color: 'info' },
  aprobada: { label: 'Aprobada', color: 'success' },
  rechazada: { label: 'Rechazada', color: 'error' },
};

export const MuestrasSection = () => {
  const user = getUser();
  const { notify, FeedbackSnackbar } = useFeedback();

  const [cliente, setCliente] = useState(user?.customer ?? '');
  const [campaign, setCampaign] = useState('');
  const [template, setTemplate] = useState('');
  const [version, setVersion] = useState(1);

  const [tipo, setTipo] = useState<TipoMuestra>('aleatorias');
  const [quantity, setQuantity] = useState(1);
  const [recipients, setRecipients] = useState<Recipient[]>(emptyRecipients(1));
  const [sending, setSending] = useState(false);
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
    if (!cliente.trim() || !campaign.trim()) {
      return notify('Indica el cliente y la campaña a probar.', 'warning');
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

    // Registramos el lote localmente para el flujo de aprobación (el backend de
    // envío de muestras aún no está expuesto; si responde OK, mejor).
    setLotes((prev) => [
      { id: `${Date.now()}`, campaign: campaign.trim(), tipo, recipients: recipients.map((r) => ({ ...r })), estado: 'enviada' },
      ...prev,
    ]);
    notify(
      isOk(res) ? 'Muestras enviadas correctamente.' : 'Muestra registrada para aprobación (envío real pendiente del backend).',
      isOk(res) ? 'success' : 'info',
    );
  };

  const setEstado = (id: string, estado: EstadoLote) =>
    setLotes((prev) => prev.map((l) => (l.id === id ? { ...l, estado } : l)));

  return (
    <Box>
      <Typography variant="h4">Muestras</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Envía correos de prueba de la campaña, revísalos y apruébalos antes del envío real.
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Flujo de muestras: configurar → enviar → aprobar. El envío usa la ruta real{' '}
        <code>/Email/Send-batch-template-samples</code>; si el backend responde, se envían, y de
        todas formas la muestra queda registrada aquí para gestionar su aprobación.
      </Alert>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        {/* Campaña a probar */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <SectionTitle icon={<CampaignIcon color="primary" />} title="Campaña a probar" />
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} fullWidth size="small" />
              <TextField label="Campaña" value={campaign} onChange={(e) => setCampaign(e.target.value)} fullWidth size="small" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Plantilla" value={template} onChange={(e) => setTemplate(e.target.value)} fullWidth size="small" />
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
        <Button variant="contained" startIcon={sending ? undefined : <SendIcon />} onClick={handleSend} disabled={sending}>
          {sending ? <CircularProgress size={22} /> : 'Enviar muestras'}
        </Button>
      </Paper>

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
                      <Tooltip title="Disponible cuando el backend exponga el envío real">
                        <span>
                          <Button size="small" variant="contained" startIcon={<RocketLaunchIcon />} disabled>
                            Enviar campaña real
                          </Button>
                        </span>
                      </Tooltip>
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
