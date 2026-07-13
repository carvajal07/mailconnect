import { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Button,
  TextField,
  MenuItem,
  Alert,
  Collapse,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Tooltip,
  CircularProgress,
  Divider,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import TableViewIcon from '@mui/icons-material/TableView';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ApartmentIcon from '@mui/icons-material/Apartment';
import RefreshIcon from '@mui/icons-material/Refresh';
import MailIcon from '@mui/icons-material/Mail';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import UnsubscribeIcon from '@mui/icons-material/Unsubscribe';
import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';
import { isOk } from '../../services/apiClient';
import { getUser } from '../../services/authService';
import { useFeedback } from '../../hooks/useFeedback';
import { usePortalData } from '../../context/PortalDataContext';
import { reportsService, downloadBase64Csv, downloadCsv, toCsv } from '../../services/reportsService';
import { statsService } from '../../services/statsService';
import { ESTADO_LABEL, rate } from './campaignData';

/**
 * Estado de cada envío (número del backend) → etiqueta ES + color (verde/amarillo/rojo) +
 * icono de "carta". Verde = entregado/abierto/clic; amarillo = enviado/en tránsito;
 * rojo = rechazado/rebote/queja/filtrado.
 */
type Sev = 'success' | 'warning' | 'error';
const ESTADO_ENVIO: Record<string, { label: string; sev: Sev }> = {
  '1': { label: 'Enviado', sev: 'warning' },
  '2': { label: 'Entregado', sev: 'success' },
  '3': { label: 'Rechazado', sev: 'error' },
  '4': { label: 'Abierto', sev: 'success' },
  '5': { label: 'Clic', sev: 'success' },
  '6': { label: 'Rebote', sev: 'error' },
  '7': { label: 'Queja', sev: 'error' },
  '8': { label: 'Fallo de renderizado', sev: 'error' },
  '9': { label: 'Entrega demorada', sev: 'warning' },
  '10': { label: 'Suscripción', sev: 'success' },
  '11': { label: 'Correo inválido', sev: 'error' },
  '12': { label: 'Desuscrito', sev: 'error' },
  '13': { label: 'Lista negra', sev: 'error' },
};

const estadoInfo = (state: string) => ESTADO_ENVIO[String(state).trim()] ?? { label: state || '—', sev: 'warning' as Sev };

/** Icono de "carta" por severidad del estado. */
const EstadoIcon = ({ state }: { state: string }) => {
  const { label, sev } = estadoInfo(state);
  const color = `${sev}.main`;
  const Icon = sev === 'success' ? MarkEmailReadIcon : sev === 'error' ? (['12', '13'].includes(String(state).trim()) ? UnsubscribeIcon : ReportGmailerrorredIcon) : MailIcon;
  return (
    <Tooltip title={label}>
      <Icon sx={{ color, verticalAlign: 'middle' }} />
    </Tooltip>
  );
};

/** Parser CSV (delimitador ';', con comillas) del reporte de estado. */
const parseCsv = (text: string, delim = ';'): string[][] => {
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.length) continue;
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    out.push(cells);
  }
  return out;
};

/** base64 (UTF-8) → texto. */
const decodeB64 = (b64: string): string => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
};

interface SendRow {
  uniqueId: string;
  email: string;
  nombre: string;
  date: string;
  state: string;
  stateDesc: string;
}

export const ReportesSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { campaigns, refreshCampaigns } = usePortalData();

  const cliente = getUser()?.customer ?? '';
  const customerId = getUser()?.customerId ?? '';

  const [exporting, setExporting] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [overrideId, setOverrideId] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rows, setRows] = useState<SendRow[]>([]);
  const [csvBase64, setCsvBase64] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const selected = campaigns.items.find((c) => c.campaignName === campaignName);
  const processId = (overrideId.trim() || selected?.sendProcessId || '').trim();

  /* ------- Exportar resumen de campañas (métricas agregadas) ------- */
  const exportResumen = async () => {
    if (!customerId || !cliente) {
      notify('Tu sesión no tiene una empresa asociada. Vuelve a iniciar sesión.', 'warning');
      return;
    }
    setExporting(true);
    const res = await statsService.statistics(customerId, cliente);
    setExporting(false);
    if (!isOk(res) || !res.data?.campaigns) {
      notify(res.description || 'No se pudieron obtener las campañas para el resumen.', 'error');
      return;
    }
    const list = res.data.campaigns;
    if (list.length === 0) return notify('Aún no hay campañas para exportar.', 'info');
    const headers = ['Campaña', 'Estado', 'Envíos', 'Entregas', 'Aperturas', 'Clics', 'Rebotes', 'Quejas', 'Apertura %'];
    const body = list.map((c) => [c.name, c.rawState || ESTADO_LABEL[c.estado], c.enviados, c.entregados, c.abiertos, c.clics, c.rebotes, c.quejas, rate(c.abiertos, c.entregados)]);
    downloadCsv('resumen_campanas.csv', toCsv(headers, body));
    notify(`Resumen de ${list.length} campaña(s) descargado.`, 'success');
  };

  /* ------- Detalle de envíos por campaña (state-report) ------- */
  const generar = async () => {
    if (!cliente.trim()) return notify('Tu sesión no tiene una empresa asociada.', 'warning');
    if (!campaignName && !overrideId.trim()) return notify('Selecciona una campaña.', 'warning');
    if (!processId) {
      return notify('Esta campaña aún no tiene un envío real (sin ID de proceso). Envíala primero o usa el ID manual.', 'warning');
    }
    setGenerating(true);
    setRows([]);
    setCsvBase64(null);
    const res = await reportsService.stateReport({ cliente: cliente.trim(), idProceso: processId });
    setGenerating(false);
    if (!isOk(res) || !res.data) {
      return notify(res.description || 'No se pudo generar el reporte. Verifica el backend/ruta.', 'error');
    }
    const b64 = res.data.csv_base64;
    if (!b64) {
      notify(`El reporte quedó en S3: ${res.data.s3_key ?? '(sin clave)'}.`, 'info');
      return;
    }
    const parsed = parseCsv(decodeB64(b64));
    // header: uniqueId; email; nombre; date; state; state_desc; type1; type2
    const data = parsed.slice(1).map((r) => ({
      uniqueId: r[0] ?? '', email: r[1] ?? '', nombre: r[2] ?? '',
      date: r[3] ?? '', state: r[4] ?? '', stateDesc: r[5] ?? '',
    }));
    setRows(data);
    setCsvBase64(b64);
    setPage(0);
    notify(`Reporte generado: ${data.length} envío(s).`, 'success');
  };

  const pageRows = useMemo(
    () => rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [rows, page, rowsPerPage],
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Reportes</Typography>
        <Button variant="outlined" startIcon={exporting ? <CircularProgress size={16} /> : <TableViewIcon />} onClick={exportResumen} disabled={exporting}>
          Exportar resumen (CSV)
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Selecciona una campaña y genera el <strong>detalle de envíos</strong>: una fila por
        destinatario con su estado (la primera columna es una <strong>carta de color</strong> —
        verde entregado/abierto, amarillo enviado, rojo rechazado/rebote/filtrado).
      </Alert>

      {/* Selector de campaña + generar */}
      <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ApartmentIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">Empresa:&nbsp;</Typography>
            <Chip size="small" label={cliente || 'sin empresa'} color={cliente ? 'primary' : 'default'} variant="outlined" />
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField
              select
              label="Campaña"
              value={campaignName}
              onChange={(e) => { setCampaignName(e.target.value); setOverrideId(''); }}
              fullWidth
              size="small"
              helperText={
                campaigns.loading ? 'Cargando campañas…'
                  : campaigns.items.length === 0 ? 'No hay campañas; crea una en la pestaña Campañas.'
                    : selected && !selected.sendProcessId ? 'Esta campaña aún no tiene envío real.'
                      : 'Muestra el estado de cada envío de la campaña.'
              }
            >
              {campaigns.items.length === 0 && <MenuItem value="" disabled>Sin campañas</MenuItem>}
              {campaigns.items.map((c) => (
                <MenuItem key={c.campaignId} value={c.campaignName}>
                  {c.campaignName} — {c.channel} · {c.campaignState}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={refreshCampaigns} disabled={campaigns.loading} sx={{ whiteSpace: 'nowrap' }}>
              Actualizar
            </Button>
            <Button variant="contained" startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <AssessmentIcon />} onClick={generar} disabled={generating} sx={{ whiteSpace: 'nowrap' }}>
              Generar
            </Button>
          </Stack>
          <Button size="small" endIcon={<ExpandMoreIcon sx={{ transform: advanced ? 'rotate(180deg)' : 'none', transition: '.2s' }} />} onClick={() => setAdvanced((a) => !a)} sx={{ alignSelf: 'flex-start' }}>
            ID de proceso manual (opcional)
          </Button>
          <Collapse in={advanced}>
            <TextField label="ID de proceso" value={overrideId} onChange={(e) => setOverrideId(e.target.value)} fullWidth size="small" placeholder="uuid del envío real" helperText="Sobrescribe el de la campaña seleccionada." />
          </Collapse>
        </Stack>
      </Paper>

      {/* Tabla paginada del detalle de envíos */}
      {rows.length > 0 && (
        <Paper variant="outlined">
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, pt: 1.5 }} flexWrap="wrap" gap={1}>
            <Chip label={`${rows.length} envío(s)`} size="small" color="primary" variant="outlined" />
            {csvBase64 && (
              <Button size="small" startIcon={<DownloadIcon />} onClick={() => downloadBase64Csv(`reporte_${cliente}_${processId}.csv`, csvBase64)}>
                Descargar CSV
              </Button>
            )}
          </Stack>
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell align="center" sx={{ width: 56 }}>Estado</TableCell>
                  <TableCell>Identificación</TableCell>
                  <TableCell>Correo</TableCell>
                  <TableCell>Nombre</TableCell>
                  <TableCell>Fecha</TableCell>
                  <TableCell>Detalle</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((r, i) => (
                  <TableRow key={`${r.uniqueId}-${i}`} hover>
                    <TableCell align="center"><EstadoIcon state={r.state} /></TableCell>
                    <TableCell>{r.uniqueId || '—'}</TableCell>
                    <TableCell>{r.email || '—'}</TableCell>
                    <TableCell>{r.nombre || '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.date || '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" color={estadoInfo(r.state).sev} label={estadoInfo(r.state).label} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={rows.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="Filas por página"
          />
        </Paper>
      )}

      {rows.length === 0 && !generating && (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="caption" color="text.secondary">
            Elige una campaña ya enviada y pulsa <strong>Generar</strong> para ver el estado de cada
            envío. El estado sale de los eventos de entrega (SES / End User Messaging).
          </Typography>
        </>
      )}

      {FeedbackSnackbar}
    </Box>
  );
};
