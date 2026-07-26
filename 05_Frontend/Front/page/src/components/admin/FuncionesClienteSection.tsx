import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import { customerService, type CustomerSummary } from '../../services/customerService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { FEATURE_CATALOG, FEATURE_GROUPS, featureEnabled } from '../../config/features';

/**
 * Panel ADMIN "Funciones por cliente": enciende/apaga cada tab y función del portal
 * por cliente. Un Switch verde/gris por función (verde = habilitada). Los cambios se
 * guardan al instante (Customer/Update con `features`, merge por clave) y se reflejan
 * en el portal del cliente en su próximo inicio de sesión.
 */
export const FuncionesClienteSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  // Banderas EDITABLES del cliente seleccionado (se mergean sobre lo guardado).
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadCustomers = async () => {
    setLoading(true);
    const res = await customerService.list();
    setLoading(false);
    if (isOk(res)) {
      const list = res.data?.customers ?? [];
      setCustomers(list);
      // Re-sincroniza la selección con la lista fresca.
      setSelected((prev) => (prev ? list.find((c) => c.customerId === prev.customerId) ?? null : null));
    } else {
      notify(res.description || 'No se pudieron cargar los clientes.', 'error');
    }
  };

  useEffect(() => { void loadCustomers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar de cliente, precarga sus banderas guardadas.
  useEffect(() => {
    setFlags(selected?.featureFlags ?? {});
  }, [selected]);

  const enabledCount = useMemo(
    () => FEATURE_CATALOG.filter((f) => featureEnabled(flags, f.key)).length,
    [flags],
  );

  const toggle = async (key: string, enabled: boolean) => {
    if (!selected) return;
    const prevFlags = flags;
    const nextFlags = { ...flags, [key]: enabled };
    setFlags(nextFlags); // optimista
    setSavingKey(key);
    const res = await customerService.setFeatures(selected.customerId, { [key]: enabled });
    setSavingKey(null);
    if (isOk(res)) {
      const merged = res.data?.featureFlags ?? nextFlags;
      setFlags(merged);
      // Refleja en la lista para conservar el estado si se re-selecciona.
      setCustomers((list) => list.map((c) =>
        c.customerId === selected.customerId ? { ...c, featureFlags: merged } : c));
      setSelected((c) => (c ? { ...c, featureFlags: merged } : c));
    } else {
      setFlags(prevFlags); // revertir
      notify(res.description || 'No se pudo actualizar la función.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <TuneIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Funciones por cliente</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Habilita o deshabilita los tabs y funciones del portal para cada cliente. Verde =
        habilitada, gris = deshabilitada. Los cambios aplican en el próximo inicio de sesión
        del cliente.
      </Typography>

      <Autocomplete
        options={customers}
        loading={loading}
        value={selected}
        onChange={(_, v) => setSelected(v)}
        getOptionLabel={(c) => c.company || c.customerId}
        isOptionEqualToValue={(a, b) => a.customerId === b.customerId}
        sx={{ maxWidth: 480, mb: 2 }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Cliente"
            placeholder="Busca y elige un cliente"
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress size={18} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />

      {!selected ? (
        <Alert severity="info">Elige un cliente para configurar sus funciones.</Alert>
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{selected.company}</Typography>
            <Chip size="small" variant="outlined"
                  label={`${enabledCount}/${FEATURE_CATALOG.length} habilitadas`} />
          </Stack>

          {FEATURE_GROUPS.map((group) => (
            <Box key={group} sx={{ mb: 1.5 }}>
              <Typography variant="overline" color="text.secondary">{group}</Typography>
              <Divider sx={{ mb: 0.5 }} />
              {FEATURE_CATALOG.filter((f) => f.group === group).map((f) => {
                const on = featureEnabled(flags, f.key);
                return (
                  <Stack key={f.key} direction="row" spacing={2} alignItems="center"
                         sx={{ py: 0.75 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                      <Typography variant="caption" color="text.secondary">{f.description}</Typography>
                    </Box>
                    <Chip size="small" label={on ? 'Habilitada' : 'Deshabilitada'}
                          color={on ? 'success' : 'default'}
                          variant={on ? 'filled' : 'outlined'}
                          sx={{ minWidth: 108 }} />
                    <Switch
                      color="success"
                      checked={on}
                      disabled={savingKey === f.key}
                      onChange={(e) => void toggle(f.key, e.target.checked)}
                      inputProps={{ 'aria-label': f.label }}
                    />
                  </Stack>
                );
              })}
            </Box>
          ))}
        </Paper>
      )}
      {FeedbackSnackbar}
    </Box>
  );
};
