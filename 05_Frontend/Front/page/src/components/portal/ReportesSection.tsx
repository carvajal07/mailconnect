import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Button,
  TextField,
  Alert,
  Divider,
  Collapse,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  CircularProgress,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import AssessmentIcon from '@mui/icons-material/Assessment';
import TableViewIcon from '@mui/icons-material/TableView';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import {
  reportsService,
  downloadCsv,
  downloadBase64Csv,
  toCsv,
  type StateReportResult,
} from '../../services/reportsService';
import { DEMO_CAMPAIGNS, ESTADO_LABEL, rate } from './campaignData';

interface GeneratedReport {
  id: string;
  cliente: string;
  idProceso: string;
  count: number;
  filename: string;
  csvBase64: string | null;
  s3Key: string | null;
}

export const ReportesSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();

  // Reporte de estado (backend).
  const [cliente, setCliente] = useState('');
  const [idProceso, setIdProceso] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Prefix, setS3Prefix] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [last, setLast] = useState<{ result: StateReportResult; filename: string } | null>(null);
  const [reports, setReports] = useState<GeneratedReport[]>([]);

  /* ------- Exportar resumen de campañas (local, sin backend) ------- */
  const exportResumen = () => {
    const headers = ['Campaña', 'Estado', 'Envíos', 'Entregas', 'Aperturas', 'Clics', 'Rebotes', 'Quejas', 'Apertura %'];
    const rows = DEMO_CAMPAIGNS.map((c) => [
      c.name,
      ESTADO_LABEL[c.estado],
      c.enviados,
      c.entregados,
      c.abiertos,
      c.clics,
      c.rebotes,
      c.quejas,
      c.estado === 'enviada' ? rate(c.abiertos, c.entregados) : 0,
    ]);
    downloadCsv('resumen_campanas.csv', toCsv(headers, rows));
    notify('Resumen de campañas descargado.', 'success');
  };

  /* ------- Reporte de estado por campaña (backend state-report) ------- */
  const generarReporte = async () => {
    if (!cliente.trim() || !idProceso.trim()) {
      notify('Indica el cliente y el ID de proceso de la campaña.', 'warning');
      return;
    }
    setGenerating(true);
    const res = await reportsService.stateReport({
      cliente: cliente.trim(),
      idProceso: idProceso.trim(),
      s3_bucket: advanced && s3Bucket.trim() ? s3Bucket.trim() : undefined,
      s3_prefix: advanced && s3Prefix.trim() ? s3Prefix.trim() : undefined,
    });
    setGenerating(false);

    if (isOk(res) && res.data) {
      const result = res.data;
      const filename = `reporte_${cliente.trim()}_${idProceso.trim()}.csv`;
      setLast({ result, filename });
      setReports((prev) => [
        { id: `${Date.now()}`, cliente: cliente.trim(), idProceso: idProceso.trim(), count: result.count, filename, csvBase64: result.csv_base64, s3Key: result.s3_key },
        ...prev,
      ]);
      notify(`Reporte generado: ${result.count} registros.`, 'success');
    } else {
      notify(res.description || 'No se pudo generar el reporte. Verifica el backend/ruta.', 'error');
    }
  };

  const downloadReport = (r: GeneratedReport) => {
    if (r.csvBase64) downloadBase64Csv(r.filename, r.csvBase64);
    else notify(`El reporte quedó en S3: ${r.s3Key ?? '(sin clave)'}. Descárgalo desde S3.`, 'info');
  };

  return (
    <Box>
      <Typography variant="h4" mb={2}>
        Reportes
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Puedes <strong>exportar el resumen de campañas</strong> al instante (CSV) y generar el{' '}
        <strong>reporte de estado por campaña</strong> (detalle por destinatario) con el backend.
        El reporte de estado usa el endpoint real <code>state-report</code>; si aún no está
        desplegado/enrutado, verás un aviso.
      </Alert>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 3 }}>
        {/* Exportar resumen (local) */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={1}>
            <TableViewIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Resumen de campañas
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Descarga un CSV con las métricas agregadas de tus campañas (envíos, entregas,
            aperturas, clics, rebotes y tasa de apertura). Disponible al instante.
          </Typography>
          <Button variant="contained" startIcon={<DownloadIcon />} onClick={exportResumen}>
            Descargar resumen (CSV)
          </Button>
        </Paper>

        {/* Reporte de estado por campaña (backend) */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={1}>
            <AssessmentIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Reporte de estado por campaña
            </Typography>
          </Stack>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} fullWidth size="small" placeholder="Ej: merkacaldas" />
              <TextField label="ID de proceso" value={idProceso} onChange={(e) => setIdProceso(e.target.value)} fullWidth size="small" placeholder="Ej: 0001" />
            </Stack>
            <Button size="small" endIcon={<ExpandMoreIcon sx={{ transform: advanced ? 'rotate(180deg)' : 'none', transition: '.2s' }} />} onClick={() => setAdvanced((a) => !a)} sx={{ alignSelf: 'flex-start' }}>
              Opciones de S3 (opcional)
            </Button>
            <Collapse in={advanced}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="S3 bucket" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} fullWidth size="small" helperText="Vacío = recibir el CSV directo" />
                <TextField label="S3 prefix" value={s3Prefix} onChange={(e) => setS3Prefix(e.target.value)} fullWidth size="small" />
              </Stack>
            </Collapse>
            <Box>
              <Button variant="contained" startIcon={generating ? undefined : <AssessmentIcon />} onClick={generarReporte} disabled={generating}>
                {generating ? <CircularProgress size={22} /> : 'Generar reporte'}
              </Button>
            </Box>
          </Stack>
        </Paper>
      </Box>

      {/* Vista previa del último reporte */}
      {last && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                Vista previa
              </Typography>
              <Chip label={`${last.result.count} registros`} size="small" color="primary" variant="outlined" />
            </Stack>
            {last.result.csv_base64 ? (
              <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadBase64Csv(last.filename, last.result.csv_base64 as string)}>
                Descargar CSV
              </Button>
            ) : (
              <Chip label={`Guardado en S3: ${last.result.s3_key ?? ''}`} size="small" />
            )}
          </Stack>
          <Box
            component="pre"
            sx={{ m: 0, p: 2, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: 12, fontFamily: 'monospace' }}
          >
            {last.result.csv_preview || '(sin datos)'}
          </Box>
        </Paper>
      )}

      {/* Historial de reportes generados en la sesión */}
      {reports.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Cliente</TableCell>
                <TableCell>ID proceso</TableCell>
                <TableCell align="right">Registros</TableCell>
                <TableCell>Archivo</TableCell>
                <TableCell align="right">Descargar</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reports.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>{r.cliente}</TableCell>
                  <TableCell>{r.idProceso}</TableCell>
                  <TableCell align="right">{r.count}</TableCell>
                  <TableCell>{r.filename}</TableCell>
                  <TableCell align="right">
                    <IconButton color="primary" onClick={() => downloadReport(r)}>
                      <DownloadIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Divider sx={{ my: 3 }} />
      <Typography variant="caption" color="text.secondary">
        El reporte de estado detalla, por destinatario, el último estado de envío (enviado,
        entregado, abierto, clic, rebote…). Columnas: uniqueId; email; nombre; date; state;
        state_desc; type1; type2.
      </Typography>

      {FeedbackSnackbar}
    </Box>
  );
};
