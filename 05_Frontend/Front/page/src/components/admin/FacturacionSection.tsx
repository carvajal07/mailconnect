import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  MenuItem,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Collapse,
  Chip,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowRight';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { billingService } from '../../services/billingService';
import type { BillingCustomerRow, BillingSummaryData } from '../../services/billingService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { usePortalData } from '../../context/PortalDataContext';

const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat('es-CO').format(n || 0);

const KpiCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 180 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="h5" fontWeight={800} sx={{ mt: 0.5 }}>{value}</Typography>
    {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
  </Paper>
);

const CustomerRow = ({ row }: { row: BillingCustomerRow }) => {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <TableRow hover>
        <TableCell sx={{ width: 40 }}>
          <IconButton size="small" onClick={() => setOpen((o) => !o)}>
            {open ? <KeyboardArrowDownIcon /> : <KeyboardArrowUpIcon />}
          </IconButton>
        </TableCell>
        <TableCell><Typography fontWeight={600}>{row.company || '—'}</Typography></TableCell>
        <TableCell align="right">{num(row.totalSent)}</TableCell>
        <TableCell align="right">{cop(row.subtotal)}</TableCell>
        <TableCell align="right">{cop(row.tax)}</TableCell>
        <TableCell align="right"><Typography fontWeight={700}>{cop(row.total)}</Typography></TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, border: 0 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ m: 1, ml: 5 }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>Desglose por canal</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Canal</TableCell>
                    <TableCell align="right">Envíos</TableCell>
                    <TableCell align="right">Costo unitario</TableCell>
                    <TableCell align="right">Subtotal</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(row.byChannel ?? []).map((ch) => (
                    <TableRow key={ch.channel}>
                      <TableCell><Chip size="small" variant="outlined" label={ch.label} /></TableCell>
                      <TableCell align="right">{num(ch.sent)}</TableCell>
                      <TableCell align="right">{cop(ch.unitCost)}</TableCell>
                      <TableCell align="right">{cop(ch.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  );
};

/**
 * Sección admin: FACTURACIÓN / consumo. Muestra cuánto facturar por cliente y canal
 * a partir de los envíos reales y las tarifas configuradas. Filtrable por mes.
 */
export const FacturacionSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  // Clientes precargados en el login (contexto admin), no se re-piden al entrar al tab.
  const { customers: customersCtx } = usePortalData();
  const customers = customersCtx.items;
  const [month, setMonth] = useState('');           // 'YYYY-MM' o '' (todo)
  const [customerId, setCustomerId] = useState(''); // '' = todos
  const [data, setData] = useState<BillingSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await billingService.summary(month, customerId);
    setLoading(false);
    if (isOk(res) && res.data) setData(res.data);
    else setError(res.description || 'No se pudo cargar la facturación.');
  }, [month, customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    if (!data || (data.customers?.length ?? 0) === 0) return notify('No hay datos para exportar.', 'warning');
    const header = ['Cliente', 'NIT', 'Canal', 'Envios', 'CostoUnitario', 'Subtotal'];
    const lines = [header.join(',')];
    (data.customers ?? []).forEach((c) => {
      (c.byChannel ?? []).forEach((ch) => {
        lines.push([`"${c.company}"`, c.companyTin ?? '', ch.label, ch.sent, ch.unitCost, ch.amount].join(','));
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturacion_${month || 'todo'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <ReceiptLongIcon color="primary" />
          <Typography variant="h4">Facturación</Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={!data || (data.customers?.length ?? 0) === 0}>
            Exportar CSV
          </Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            Refrescar
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Consumo estimado por cliente y canal a partir de los <strong>envíos reales</strong> y las
        tarifas configuradas. Es un resumen operativo, no una factura fiscal.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            type="month"
            size="small"
            label="Mes"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Vacío = todo el histórico"
          />
          <TextField
            select
            size="small"
            label="Cliente"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            sx={{ minWidth: 260 }}
          >
            <MenuItem value="">Todos los clientes</MenuItem>
            {customers.map((c) => (
              <MenuItem key={c.customerId} value={c.customerId}>{c.company}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {data?.truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Resumen parcial: se alcanzó el tope de procesos agregados. Acota por mes o por cliente para un cálculo completo.
        </Alert>
      )}

      {data && (
        <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <KpiCard label="Total a facturar" value={cop(data.totals?.total ?? 0)} hint="IVA incluido" />
          <KpiCard label="Subtotal" value={cop(data.totals?.subtotal ?? 0)} />
          <KpiCard label="IVA" value={cop(data.totals?.tax ?? 0)} />
          <KpiCard label="Envíos" value={num(data.totals?.totalSent ?? 0)} hint={`${data.customers?.length ?? 0} cliente(s) con actividad`} />
        </Stack>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Cliente</TableCell>
              <TableCell align="right">Envíos</TableCell>
              <TableCell align="right">Subtotal</TableCell>
              <TableCell align="right">IVA</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && !data && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {!loading && data && (data.customers?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No hay envíos en el periodo seleccionado.
                </TableCell>
              </TableRow>
            )}
            {(data?.customers ?? []).map((row) => <CustomerRow key={row.customerId} row={row} />)}
          </TableBody>
        </Table>
      </TableContainer>

      {data?.note && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">{data.note}</Typography>
        </>
      )}

      {FeedbackSnackbar}
    </Box>
  );
};
