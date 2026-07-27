import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  MenuItem,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  IconButton,
  InputAdornment,
  Chip,
  Alert,
  Tooltip,
  CircularProgress,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import { supportService } from '../../services/supportService';
import type { SesTemplateRow } from '../../services/supportService';
import { customerService } from '../../services/customerService';
import type { CustomerSummary } from '../../services/customerService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { formatDateTime } from '../../utils/datetime';

/**
 * Sección admin: PLANTILLAS DE CORREO (SES) — inventario GLOBAL de la plataforma.
 *
 * Qué es: las plantillas HTML que viven en Amazon SES y que las campañas de correo
 * (EM/EAU/EAP) referencian por nombre. Las CREAN los clientes desde el portal
 * ("Plantillas HTML"), que genera el nombre con la convención
 * `{cliente}_{consecutivo}_{nombre}` — de ahí que el prefijo identifique al dueño.
 *
 * Para qué sirve este tab (soporte/operación): ver TODAS las plantillas de todos los
 * clientes, filtrarlas, inspeccionar su contenido real (asunto + HTML) y borrar las que
 * sobren (duplicadas, de pruebas o de un cliente dado de baja).
 *
 * ⚠️ No se crean plantillas desde aquí a propósito: el nombre debe seguir la convención
 * del builder para que la campaña pueda seleccionarla; una plantilla creada a mano con
 * IDs escritos a dedo no aparecería en el portal del cliente. Para diseñar plantillas
 * está el tab "Plantillas prediseñadas".
 */
export const PlantillasSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();

  const [templates, setTemplates] = useState<SesTemplateRow[] | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');

  const [customerFilter, setCustomerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Vista del contenido real (se pide a SES bajo demanda: get-template).
  const [viewing, setViewing] = useState<{ name: string; subject: string; html: string; text: string } | null>(null);
  const [loadingName, setLoadingName] = useState('');
  const [preview, setPreview] = useState<'render' | 'code'>('render');
  const [deleting, setDeleting] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    const res = await supportService.listTemplates();
    setLoading(false);
    if (isOk(res)) {
      setTemplates(res.data?.templates ?? []);
      setTruncated(Boolean(res.data?.truncated));
    } else {
      setError(res.description || 'No se pudieron cargar las plantillas.');
    }
    setPage(0);
  };

  useEffect(() => {
    void load();
    void (async () => {
      const res = await customerService.list();
      if (isOk(res)) setCustomers(res.data?.customers ?? []);
    })();
  }, []);

  /** Prefijos de cliente presentes (el nombre SES es {prefijo}_{consecutivo}_{nombre}). */
  const prefixes = useMemo(() => {
    const set = new Set((templates ?? []).map((t) => t.customerPrefix).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [templates]);

  /** Nombre de empresa para un prefijo (si coincide con un cliente registrado). */
  const companyFor = (prefix: string) => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return customers.find((c) => norm(c.company) === norm(prefix))?.company;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = templates ?? [];
    if (customerFilter) list = list.filter((t) => t.customerPrefix === customerFilter);
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q));
    return list;
  }, [templates, customerFilter, search]);

  const pageRows = useMemo(
    () => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filtered, page, rowsPerPage],
  );

  const view = async (t: SesTemplateRow) => {
    setLoadingName(t.name);
    // Ruta ADMIN (no /Template/Get-template): esa exige que la plantilla sea del tenant
    // del token, así que el admin recibía "no pertenece a tu cuenta" con las de otros.
    const res = await supportService.getTemplate(t.name);
    setLoadingName('');
    if (isOk(res) && res.data?.template) {
      setPreview('render');
      const tpl = res.data.template;
      setViewing({ name: tpl.name || t.name, subject: tpl.subject, html: tpl.html, text: tpl.text });
    } else {
      notify(res.description || 'No se pudo obtener el contenido de la plantilla.', 'error');
    }
  };

  const remove = async (t: SesTemplateRow) => {
    const ok = await confirm({
      title: 'Eliminar plantilla',
      message: `¿Eliminar "${t.name}" de SES? Las campañas que la referencien dejarán de poder `
        + 'enviarse con ella. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeleting(t.name);
    const res = await supportService.deleteTemplate(t.name);
    setDeleting('');
    if (isOk(res)) {
      notify('Plantilla eliminada.', 'success');
      setTemplates((prev) => (prev ?? []).filter((x) => x.name !== t.name));
    } else {
      notify(res.description || 'No se pudo eliminar la plantilla.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <DescriptionIcon color="primary" />
          <Typography variant="h4">Plantillas de correo (SES)</Typography>
        </Stack>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refrescar
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Inventario <strong>global</strong> de las plantillas HTML que viven en Amazon SES y que
        usan las campañas de correo. Las crean los clientes desde el portal (que genera el nombre
        <code> cliente_consecutivo_nombre</code>); aquí puedes consultarlas, ver su contenido real
        y eliminar las que sobren.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      {truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Listado parcial: SES devolvió el tope de plantillas. Usa el filtro por cliente para acotar.
        </Alert>
      )}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField
            select
            size="small"
            label="Cliente"
            value={customerFilter}
            onChange={(e) => { setCustomerFilter(e.target.value); setPage(0); }}
            sx={{ minWidth: 260 }}
          >
            <MenuItem value="">Todos los clientes</MenuItem>
            {prefixes.map((p) => {
              const company = companyFor(p);
              return <MenuItem key={p} value={p}>{company ? `${company} (${p})` : p}</MenuItem>;
            })}
          </TextField>
          <TextField
            size="small"
            label="Buscar por nombre"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            sx={{ minWidth: 260 }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
          />
          <Chip variant="outlined" label={`${filtered.length} plantilla(s)`} sx={{ alignSelf: 'center' }} />
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Cliente</TableCell>
              <TableCell>Plantilla</TableCell>
              <TableCell>Creada</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templates === null && loading && (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {templates !== null && filtered.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                No hay plantillas para el filtro.
              </TableCell></TableRow>
            )}
            {pageRows.map((t) => {
              const company = companyFor(t.customerPrefix);
              return (
                <TableRow key={t.name} hover>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={company || t.customerPrefix || '—'} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{t.name}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="caption">{t.createdAt ? formatDateTime(t.createdAt) : '—'}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Ver contenido">
                      <span>
                        <IconButton color="info" onClick={() => view(t)} disabled={loadingName === t.name}>
                          {loadingName === t.name ? <CircularProgress size={18} /> : <VisibilityIcon />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Eliminar de SES">
                      <span>
                        <IconButton color="error" onClick={() => remove(t)} disabled={deleting === t.name}>
                          {deleting === t.name ? <CircularProgress size={18} /> : <DeleteIcon />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          labelRowsPerPage="Filas por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
        />
      </TableContainer>

      {/* Contenido real de la plantilla (asunto + HTML), con vista renderizada o código. */}
      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: 'monospace' }}>{viewing?.name}</Typography>
          <Typography variant="body2" color="text.secondary">Asunto: {viewing?.subject || '(sin asunto)'}</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <ToggleButtonGroup
            size="small" exclusive value={preview}
            onChange={(_, v) => v && setPreview(v)}
            sx={{ mb: 1.5 }}
          >
            <ToggleButton value="render">Vista previa</ToggleButton>
            <ToggleButton value="code">HTML</ToggleButton>
          </ToggleButtonGroup>
          {preview === 'render' ? (
            // sandbox vacío: el HTML del cliente se renderiza SIN scripts ni navegación.
            <Box component="iframe" title="Vista previa de la plantilla" sandbox=""
              srcDoc={viewing?.html || '<p style="font-family:sans-serif;color:#888">(sin contenido)</p>'}
              sx={{ width: '100%', height: 420, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }} />
          ) : (
            <Paper variant="outlined" sx={{ p: 2, maxHeight: 420, overflow: 'auto' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                {viewing?.html || '(sin contenido)'}
              </pre>
            </Paper>
          )}
          {viewing?.text && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 2 }}>Versión de texto</Typography>
              <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }}>
                <Typography variant="body2">{viewing.text}</Typography>
              </Paper>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewing(null)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
      {ConfirmDialog}
    </Box>
  );
};
