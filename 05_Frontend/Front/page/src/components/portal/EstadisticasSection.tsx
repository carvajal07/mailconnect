import { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Chip,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Divider,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import DraftsIcon from '@mui/icons-material/Drafts';
import SendIcon from '@mui/icons-material/Send';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { StatTile, Donut, Funnel, useStatusColors } from './charts';

type Estado = 'pendiente' | 'creada' | 'enviada';

interface CampaignStat {
  id: string;
  name: string;
  estado: Estado;
  enviados: number;
  entregados: number;
  abiertos: number;
  clics: number;
  rebotes: number;
  quejas: number;
}

// Datos ILUSTRATIVOS (demo). Se reemplazarán por la respuesta del backend cuando
// exista el endpoint de métricas (p. ej. Api_V1_Reports_state-report / agregados).
const DEMO: CampaignStat[] = [
  { id: '1', name: 'Bienvenida Julio', estado: 'enviada', enviados: 12450, entregados: 12010, abiertos: 5220, clics: 1310, rebotes: 440, quejas: 12 },
  { id: '2', name: 'Promo Aniversario', estado: 'enviada', enviados: 8300, entregados: 8110, abiertos: 3980, clics: 990, rebotes: 190, quejas: 6 },
  { id: '3', name: 'Newsletter Agosto', estado: 'enviada', enviados: 15600, entregados: 15020, abiertos: 6110, clics: 1420, rebotes: 580, quejas: 21 },
  { id: '4', name: 'Reactivación clientes', estado: 'creada', enviados: 0, entregados: 0, abiertos: 0, clics: 0, rebotes: 0, quejas: 0 },
  { id: '5', name: 'Encuesta satisfacción', estado: 'creada', enviados: 0, entregados: 0, abiertos: 0, clics: 0, rebotes: 0, quejas: 0 },
  { id: '6', name: 'Lanzamiento producto', estado: 'pendiente', enviados: 0, entregados: 0, abiertos: 0, clics: 0, rebotes: 0, quejas: 0 },
];

const estadoLabel: Record<Estado, string> = { pendiente: 'Pendiente', creada: 'Creada', enviada: 'Enviada' };
const estadoColor: Record<Estado, 'warning' | 'info' | 'success'> = { pendiente: 'warning', creada: 'info', enviada: 'success' };

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

export const EstadisticasSection = () => {
  const status = useStatusColors();
  const [detail, setDetail] = useState<CampaignStat | null>(null);
  const campaigns = DEMO;

  const kpis = useMemo(() => {
    const by = (e: Estado) => campaigns.filter((c) => c.estado === e).length;
    const enviadas = campaigns.filter((c) => c.estado === 'enviada');
    const totalEnvios = enviadas.reduce((s, c) => s + c.enviados, 0);
    const totalEntregados = enviadas.reduce((s, c) => s + c.entregados, 0);
    const totalAbiertos = enviadas.reduce((s, c) => s + c.abiertos, 0);
    return {
      total: campaigns.length,
      pendientes: by('pendiente'),
      creadas: by('creada'),
      enviadas: by('enviada'),
      totalEnvios,
      aperturaProm: rate(totalAbiertos, totalEntregados),
    };
  }, [campaigns]);

  const donutData = [
    { label: 'Pendientes', value: kpis.pendientes, color: status.pendiente },
    { label: 'Creadas', value: kpis.creadas, color: status.creada },
    { label: 'Enviadas', value: kpis.enviadas, color: status.enviada },
  ];

  const aggFunnel = useMemo(() => {
    const enviadas = campaigns.filter((c) => c.estado === 'enviada');
    const sum = (k: keyof CampaignStat) => enviadas.reduce((s, c) => s + (c[k] as number), 0);
    return [
      { label: 'Enviados', value: sum('enviados') },
      { label: 'Entregados', value: sum('entregados') },
      { label: 'Abiertos', value: sum('abiertos') },
      { label: 'Clics', value: sum('clics') },
    ];
  }, [campaigns]);

  return (
    <Box>
      <Typography variant="h4" mb={2}>
        Estadísticas
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Datos <strong>ilustrativos (demo)</strong>. El tablero está listo para conectarse cuando el
        backend exponga las métricas agregadas por campaña (envíos, entregas, aperturas, clics,
        rebotes). La estructura y los cálculos ya funcionan con datos reales.
      </Alert>

      {/* KPIs */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', lg: 'repeat(6,1fr)' }, gap: 2, mb: 3 }}>
        <StatTile label="Campañas" value={kpis.total} icon={<CampaignIcon />} />
        <StatTile label="Pendientes" value={kpis.pendientes} color={status.pendiente} icon={<HourglassEmptyIcon />} sublabel="por aprobar" />
        <StatTile label="Creadas" value={kpis.creadas} color={status.creada} icon={<DraftsIcon />} sublabel="borradores" />
        <StatTile label="Enviadas" value={kpis.enviadas} color={status.enviada} icon={<SendIcon />} />
        <StatTile label="Total envíos" value={kpis.totalEnvios.toLocaleString('es-CO')} icon={<MarkEmailReadIcon />} />
        <StatTile label="Apertura prom." value={`${kpis.aperturaProm}%`} icon={<VisibilityIcon />} sublabel="de entregados" />
      </Box>

      {/* Gráficos */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 3 }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} mb={2}>
            Campañas por estado
          </Typography>
          <Donut data={donutData} />
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} mb={2}>
            Embudo de envío (campañas enviadas)
          </Typography>
          <Funnel steps={aggFunnel} />
        </Paper>
      </Box>

      {/* Tabla de campañas (también sirve como "vista de tabla" accesible) */}
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Campaña</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell align="right">Envíos</TableCell>
              <TableCell align="right">Entregas</TableCell>
              <TableCell align="right">Aperturas</TableCell>
              <TableCell align="right">Clics</TableCell>
              <TableCell align="right">Rebotes</TableCell>
              <TableCell align="right">Apertura</TableCell>
              <TableCell align="right">Detalle</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell>{c.name}</TableCell>
                <TableCell>
                  <Chip label={estadoLabel[c.estado]} size="small" color={estadoColor[c.estado]} variant="outlined" />
                </TableCell>
                <TableCell align="right">{c.enviados.toLocaleString('es-CO')}</TableCell>
                <TableCell align="right">{c.entregados.toLocaleString('es-CO')}</TableCell>
                <TableCell align="right">{c.abiertos.toLocaleString('es-CO')}</TableCell>
                <TableCell align="right">{c.clics.toLocaleString('es-CO')}</TableCell>
                <TableCell align="right">{c.rebotes.toLocaleString('es-CO')}</TableCell>
                <TableCell align="right">{c.estado === 'enviada' ? `${rate(c.abiertos, c.entregados)}%` : '—'}</TableCell>
                <TableCell align="right">
                  <IconButton color="info" onClick={() => setDetail(c)} disabled={c.estado !== 'enviada'}>
                    <VisibilityIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Detalle de una campaña */}
      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detail?.name}</DialogTitle>
        <DialogContent>
          {detail && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Apertura ${rate(detail.abiertos, detail.entregados)}%`} color="success" variant="outlined" />
                <Chip label={`Clics ${rate(detail.clics, detail.entregados)}%`} color="info" variant="outlined" />
                <Chip label={`Rebote ${rate(detail.rebotes, detail.enviados)}%`} color="error" variant="outlined" />
                <Chip label={`Quejas ${detail.quejas}`} variant="outlined" />
              </Stack>
              <Divider />
              <Typography variant="subtitle2" color="text.secondary">
                Embudo de la campaña
              </Typography>
              <Funnel
                steps={[
                  { label: 'Enviados', value: detail.enviados },
                  { label: 'Entregados', value: detail.entregados },
                  { label: 'Abiertos', value: detail.abiertos },
                  { label: 'Clics', value: detail.clics },
                ]}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail(null)}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
