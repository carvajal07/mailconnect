import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Button, Chip, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Accordion,
  AccordionSummary, AccordionDetails, Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { deploymentHealthService } from '../../services/deploymentHealthService';
import type { DeploymentHealthData, HealthItemStatus, SectionLevel } from '../../services/deploymentHealthService';
import { isOk } from '../../services/apiClient';

const STATUS_META: Record<HealthItemStatus, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
  ok: { label: 'OK', color: 'success' },
  missing: { label: 'No existe', color: 'error' },
  inactive: { label: 'Inactiva', color: 'error' },
  unwired: { label: 'Sin trigger', color: 'warning' },
  'no-secret': { label: 'Falta SECRET_KEY', color: 'warning' },
  unknown: { label: 'Sin verificar', color: 'default' },
};

const LEVEL_ICON: Record<SectionLevel, React.ReactNode> = {
  ok: <CheckCircleIcon color="success" />,
  warning: <WarningAmberIcon color="warning" />,
  error: <ErrorIcon color="error" />,
};

/**
 * Sección admin: PANEL DE SALUD DE DESPLIEGUE (Bloque K). Verifica contra AWS si los
 * recursos [J] (lambdas, tablas, colas, SECRET_KEY, triggers) existen de verdad.
 */
export const DespliegueSection = () => {
  const [data, setData] = useState<DeploymentHealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await deploymentHealthService.check();
    setLoading(false);
    if (isOk(res) && res.data) setData(res.data);
    else setError(res.description || 'No se pudo verificar el despliegue.');
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <HealthAndSafetyIcon color="primary" />
          <Typography variant="h4">Salud de despliegue</Typography>
        </Stack>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Verificar
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Verifica contra AWS si los recursos que el proyecto declara desplegar (lambdas, tablas,
        colas, <code>SECRET_KEY</code>, triggers) existen de verdad — detecta lo "construido pero
        no desplegado". {data?.generatedAt && `Verificado ${data.generatedAt} UTC.`}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}

      {loading && !data && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {s && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <SummaryChip icon={<CheckCircleIcon fontSize="small" />} label={`${s.ok} OK`} color="success" />
          <SummaryChip icon={<ErrorIcon fontSize="small" />} label={`${s.error} faltantes`} color="error" active={s.error > 0} />
          <SummaryChip icon={<WarningAmberIcon fontSize="small" />} label={`${s.warning} con aviso`} color="warning" active={s.warning > 0} />
          <SummaryChip icon={<HelpOutlineIcon fontSize="small" />} label={`${s.unknown} sin verificar`} color="default" />
        </Stack>
      )}

      {data?.sections.map((sec) => (
        <Accordion key={sec.key} defaultExpanded={sec.level !== 'ok'} variant="outlined" sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
              {LEVEL_ICON[sec.level]}
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{sec.title}</Typography>
              <Chip size="small" label={`${sec.ok}/${sec.total}`}
                color={sec.level === 'ok' ? 'success' : sec.level === 'warning' ? 'warning' : 'error'}
                variant="outlined" />
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Recurso</TableCell>
                    <TableCell>Estado</TableCell>
                    <TableCell>Detalle</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sec.items.map((it) => {
                    const meta = STATUS_META[it.status] ?? STATUS_META.unknown;
                    return (
                      <TableRow key={it.name} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{it.name}</TableCell>
                        <TableCell>
                          <Chip size="small" label={meta.label} color={meta.color}
                            variant={meta.color === 'default' ? 'outlined' : 'filled'} />
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>{it.detail}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>
      ))}

      {data && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Los ítems "Sin verificar" indican que a esta lambda le falta el permiso IAM de solo
          lectura para el chequeo (p. ej. <code>lambda:GetFunctionConfiguration</code>), no que el
          recurso falte. Cubre el conjunto crítico (seguridad, admin, pipeline y features
          recientes), no las 90+ rutas.
        </Alert>
      )}
    </Box>
  );
};

const SummaryChip = ({ icon, label, color, active = true }: {
  icon: React.ReactNode; label: string; color: 'success' | 'error' | 'warning' | 'default'; active?: boolean;
}) => (
  <Tooltip title={label}>
    <Chip icon={active ? (icon as React.ReactElement) : undefined} label={label}
      color={active ? color : 'default'} variant={active ? 'filled' : 'outlined'} />
  </Tooltip>
);
