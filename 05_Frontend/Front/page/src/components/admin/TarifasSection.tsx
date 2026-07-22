import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  MenuItem,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  InputAdornment,
  Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import PaidIcon from '@mui/icons-material/Paid';
import { pricingService } from '../../services/pricingService';
import type {
  PricingChannel,
  PricingUpdateChannel,
  RatesByChannel,
  ChannelRates,
} from '../../services/pricingService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { usePortalData } from '../../context/PortalDataContext';

/**
 * Sección admin: TARIFAS por canal (tabla pricingRate). Permite editar la tarifa
 * GLOBAL ('*') o el override de un cliente. Consistente con el estimador de costos.
 */

// Campos específicos por canal (taxRate/minCampaign van aparte, en "Comunes").
const CHANNEL_FIELDS: Record<PricingChannel, { key: string; label: string; step?: number }[]> = {
  EMAIL: [
    { key: 'baseEM', label: 'Correo sin adjunto (EM)' },
    { key: 'baseEAU', label: 'Correo con adjunto único (EAU)' },
    { key: 'baseEAP', label: 'Correo con adjunto personalizado (EAP)' },
    { key: 'attachmentPerMB', label: 'Recargo por MB de adjunto' },
    { key: 'personalizedPdf', label: 'Personalización PDF (EAP)' },
    { key: 'personalizedDocx', label: 'Personalización Word (EAP)' },
  ],
  SMS: [{ key: 'baseSms', label: 'Por SMS (por segmento)' }],
  WHATSAPP: [{ key: 'baseMarketing', label: 'Por mensaje (plantilla marketing)' }],
  VOICE: [
    { key: 'basePerMinute', label: 'Por minuto de llamada' },
    { key: 'avgMinutes', label: 'Minutos promedio por llamada', step: 0.1 },
  ],
};

const CHANNEL_LABEL: Record<PricingChannel, string> = {
  EMAIL: 'Correo',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  VOICE: 'Voz',
};

const CHANNELS = Object.keys(CHANNEL_FIELDS) as PricingChannel[];
const GLOBAL = '*';

// Claves de TRAMO por canal (el precio base es escalonado por volumen; email tiene 3).
const TIER_KEYS: Record<PricingChannel, string[]> = {
  EMAIL: ['EM', 'EAU', 'EAP'], SMS: ['SMS'], WHATSAPP: ['WHATSAPP'], VOICE: ['VOICE'],
};
const TIER_LABEL: Record<string, string> = { EM: 'EM', EAU: 'EAU', EAP: 'EAP', SMS: 'SMS', WHATSAPP: 'WSP', VOICE: 'Voz/min' };

export const TarifasSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const [scope, setScope] = useState<string>(GLOBAL);
  // Clientes precargados en el login (contexto admin) para el selector de alcance.
  const { customers: customersCtx } = usePortalData();
  const customers = customersCtx.items;
  const [overrides, setOverrides] = useState<RatesByChannel | null>(null);
  const [form, setForm] = useState<RatesByChannel | null>(null);
  const [tiers, setTiers] = useState<Record<string, { min: number; unit: number }[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingChannel, setSavingChannel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await pricingService.list(scope);
    setLoading(false);
    if (isOk(res) && res.data) {
      setOverrides(res.data.overrides);
      setTiers(res.data.tiers ?? {});
      // El formulario arranca desde los valores efectivos (editable).
      setForm(JSON.parse(JSON.stringify(res.data.effective)));
    } else {
      setError(res.description || 'No se pudieron cargar las tarifas.');
      setForm(null);
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (channel: PricingChannel, key: string, value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      // Vacío = SIN override plano (se cobra por tramos): se guarda null, no 0.
      return { ...prev, [channel]: { ...prev[channel], [key]: value === '' ? null : Number(value) } };
    });
  };

  const isOverridden = (channel: PricingChannel, key: string) =>
    overrides ? Object.prototype.hasOwnProperty.call(overrides[channel] ?? {}, key) : false;

  const save = async (channel: PricingUpdateChannel, fields: ChannelRates) => {
    setSavingChannel(channel);
    const res = await pricingService.update(scope, channel, fields);
    setSavingChannel(null);
    if (isOk(res)) {
      notify('Tarifa guardada.', 'success');
      load();
    } else {
      notify(res.description || 'No se pudo guardar la tarifa.', 'error');
    }
  };

  const saveChannel = (channel: PricingChannel) => {
    if (!form) return;
    const fields: ChannelRates = {};
    CHANNEL_FIELDS[channel].forEach(({ key }) => {
      const v = form[channel]?.[key];
      // Solo se envían los campos con valor (override plano). Los vacíos quedan por TRAMOS.
      if (v !== null && v !== undefined && String(v) !== '') fields[key] = Number(v);
    });
    save(channel, fields);
  };

  const saveCommon = () => {
    if (!form) return;
    // taxRate/minCampaign están replicados en todos los canales; tomo los de EMAIL.
    save('COMMON', {
      taxRate: Number(form.EMAIL?.taxRate ?? 0),
      minCampaign: Number(form.EMAIL?.minCampaign ?? 0),
    });
  };

  const scopeLabel = scope === GLOBAL ? 'Tarifa global (por defecto)' :
    customers.find((c) => c.customerId === scope)?.company || scope;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <PaidIcon color="primary" />
          <Typography variant="h4">Tarifas</Typography>
        </Stack>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refrescar
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        El precio base es <strong>escalonado por volumen</strong> (ver la tabla de cada canal).
        Dejá el campo <strong>vacío</strong> para cobrar por esos tramos, o escribí un valor para
        fijar un <strong>precio plano</strong> (override) global o por cliente. Alimenta el
        estimador y el cobro real.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          select
          size="small"
          label="Alcance de la tarifa"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          sx={{ minWidth: 320 }}
        >
          <MenuItem value={GLOBAL}>★ Tarifa global (por defecto)</MenuItem>
          {customers.map((c) => (
            <MenuItem key={c.customerId} value={c.customerId}>
              {c.company} {c.companyTin ? `· NIT ${c.companyTin}` : ''}
            </MenuItem>
          ))}
        </TextField>
        {scope !== GLOBAL && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Editando el <strong>override</strong> de {scopeLabel}. Los campos que no toques
            seguirán heredando la tarifa global.
          </Typography>
        )}
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}

      {loading && !form && (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      )}

      {form && (
        <Grid container spacing={2}>
          {CHANNELS.map((channel) => (
            <Grid key={channel} size={{ xs: 12, md: 6 }}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  {CHANNEL_LABEL[channel]}
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 1 }}>
                  {CHANNEL_FIELDS[channel].map(({ key, label, step }) => (
                    <TextField
                      key={key}
                      size="small"
                      type="number"
                      label={label}
                      value={form[channel]?.[key] ?? ''}
                      placeholder="Por volumen"
                      onChange={(e) => setField(channel, key, e.target.value)}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        endAdornment: isOverridden(channel, key) ? (
                          <Chip size="small" color="primary" variant="outlined" label="propio" sx={{ height: 20 }} />
                        ) : scope !== GLOBAL ? (
                          <Chip size="small" variant="outlined" label="heredado" sx={{ height: 20 }} />
                        ) : undefined,
                      }}
                      inputProps={{ step: step ?? 1, min: 0 }}
                    />
                  ))}
                </Stack>
                {tiers[TIER_KEYS[channel][0]] && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      Precio por volumen (COP/u) — aplica cuando el campo de arriba está vacío:
                    </Typography>
                    <Box
                      component="table"
                      sx={{
                        width: '100%', mt: 0.5, borderCollapse: 'collapse', fontSize: 11,
                        '& th, & td': { border: '1px solid', borderColor: 'divider', px: 0.5, py: 0.25, textAlign: 'right' },
                        '& th:first-of-type, & td:first-of-type': { textAlign: 'left' },
                      }}
                    >
                      <Box component="thead">
                        <Box component="tr">
                          <Box component="th">Desde (envíos/mes)</Box>
                          {TIER_KEYS[channel].map((k) => <Box component="th" key={k}>{TIER_LABEL[k]}</Box>)}
                        </Box>
                      </Box>
                      <Box component="tbody">
                        {tiers[TIER_KEYS[channel][0]].map((row, i) => (
                          <Box component="tr" key={row.min}>
                            <Box component="td">{row.min.toLocaleString('es-CO')}</Box>
                            {TIER_KEYS[channel].map((k) => <Box component="td" key={k}>${tiers[k]?.[i]?.unit ?? '—'}</Box>)}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  </Box>
                )}
                <Box sx={{ mt: 2, textAlign: 'right' }}>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={savingChannel === channel ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                    onClick={() => saveChannel(channel)}
                    disabled={savingChannel !== null}
                  >
                    Guardar {CHANNEL_LABEL[channel]}
                  </Button>
                </Box>
              </Paper>
            </Grid>
          ))}

          {/* Comunes: IVA + mínimo por campaña (se escriben en todos los canales). */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Comunes (todos los canales)
              </Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack spacing={1.5}>
                <TextField
                  size="small"
                  type="number"
                  label="IVA (0.19 = 19%)"
                  value={form.EMAIL?.taxRate ?? 0}
                  onChange={(e) => setField('EMAIL', 'taxRate', e.target.value)}
                  inputProps={{ step: 0.01, min: 0, max: 1 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Mínimo por campaña"
                  value={form.EMAIL?.minCampaign ?? 0}
                  onChange={(e) => setField('EMAIL', 'minCampaign', e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  inputProps={{ step: 100, min: 0 }}
                />
              </Stack>
              <Box sx={{ mt: 2, textAlign: 'right' }}>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={savingChannel === 'COMMON' ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                  onClick={saveCommon}
                  disabled={savingChannel !== null}
                >
                  Guardar comunes
                </Button>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

      {FeedbackSnackbar}
    </Box>
  );
};
