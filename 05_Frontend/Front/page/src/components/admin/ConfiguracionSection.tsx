import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { configService } from '../../services/configService';
import type { ConfigSetting } from '../../services/configService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

/**
 * Sección admin: CONFIGURACIÓN de plataforma. Edita ajustes globales (tabla
 * platformConfig) que las lambdas consumen con fallback a su variable de entorno.
 */
export const ConfiguracionSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const [settings, setSettings] = useState<ConfigSetting[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await configService.get();
    setLoading(false);
    if (isOk(res) && res.data?.settings) {
      setSettings(res.data.settings);
      setDraft(Object.fromEntries(res.data.settings.map((s) => [s.key, String(s.value)])));
    } else {
      setError(res.description || 'No se pudo cargar la configuración.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (s: ConfigSetting) => {
    const raw = draft[s.key] ?? '';
    const value: string | number = s.type === 'number' ? Number(raw) : raw;
    if (s.type === 'number' && (raw === '' || Number.isNaN(Number(raw)))) {
      return notify('Ingresa un número válido.', 'warning');
    }
    if (s.type === 'email' && !raw.includes('@')) {
      return notify('Ingresa un correo válido.', 'warning');
    }
    setSavingKey(s.key);
    const res = await configService.set(s.key, value);
    setSavingKey(null);
    if (isOk(res)) {
      notify('Ajuste guardado.', 'success');
      load();
    } else {
      notify(res.description || 'No se pudo guardar el ajuste.', 'error');
    }
  };

  const groups = Array.from(new Set(settings.map((s) => s.group)));

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <SettingsIcon color="primary" />
          <Typography variant="h4">Configuración</Typography>
        </Stack>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ajustes globales de la plataforma. Cada uno lo leen las lambdas indicadas (con
        respaldo en su variable de entorno), así que un cambio aquí aplica sin redesplegar.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {loading && settings.length === 0 && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {groups.map((group) => (
        <Paper key={group} variant="outlined" sx={{ p: 2.5, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>{group}</Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack spacing={2.5}>
            {settings.filter((s) => s.group === group).map((s) => (
              <Box key={s.key}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
                  <TextField
                    size="small"
                    label={s.label}
                    type={s.type === 'number' ? 'number' : 'text'}
                    value={draft[s.key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                    fullWidth
                    helperText={s.help}
                    InputProps={{
                      endAdornment: s.isOverridden
                        ? <Chip size="small" color="primary" variant="outlined" label="personalizado" sx={{ height: 20 }} />
                        : <Tooltip title={`Usando el valor por defecto: ${s.default}`}><Chip size="small" variant="outlined" label="por defecto" sx={{ height: 20 }} /></Tooltip>,
                    }}
                  />
                  <Button
                    variant="contained"
                    startIcon={savingKey === s.key ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                    onClick={() => save(s)}
                    disabled={savingKey !== null}
                    sx={{ mt: { xs: 0, sm: 0.25 }, minWidth: 120 }}
                  >
                    Guardar
                  </Button>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                  <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                  <Typography variant="caption" color="text.secondary">
                    Lo consumen: {s.consumers.join(', ')}
                  </Typography>
                </Stack>
              </Box>
            ))}
          </Stack>
        </Paper>
      ))}

      {FeedbackSnackbar}
    </Box>
  );
};
