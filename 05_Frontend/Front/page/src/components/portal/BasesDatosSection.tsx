import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
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
  Stack,
  Chip,
  Alert,
  MenuItem,
  IconButton,
  Divider,
  CircularProgress,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VisibilityIcon from '@mui/icons-material/Visibility';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ApartmentIcon from '@mui/icons-material/Apartment';
import RefreshIcon from '@mui/icons-material/Refresh';
import { campaignsService } from '../../services/campaignsService';
import { databaseService, type DatabaseFile } from '../../services/databaseService';
import { getUser } from '../../services/authService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { analyzeCsv, DELIMITER_LABELS, REQUIRED_COLUMNS, type CsvAnalysis, type Delimiter } from './csv';

interface BaseDatos {
  id: string;
  name: string;
  customer: string;
  path: string;
  totalRecords: number;
  validEmails: number;
  invalidEmails: number;
  uploadDate: string;
  delimiter: string;
  // Solo presente para las bases cargadas en esta sesión (para la vista previa).
  analysis?: CsvAnalysis;
}

/** Adapta la metadata del backend (DatabaseFile) al modelo de la tabla. */
const fromApi = (f: DatabaseFile): BaseDatos => ({
  id: f.databaseFileId,
  name: f.fileName,
  customer: f.customer,
  path: f.s3Path,
  totalRecords: f.totalRecords ?? 0,
  validEmails: f.validEmails ?? 0,
  invalidEmails: f.invalidEmails ?? 0,
  uploadDate: f.uploadDate ?? '',
  delimiter: f.delimiter ?? ';',
});

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export const BasesDatosSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();

  const [bases, setBases] = useState<BaseDatos[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewBase, setViewBase] = useState<BaseDatos | null>(null);

  // El cliente (empresa) se toma de la sesión; define el bucket {customer}.database.
  const customer = getUser()?.customer ?? '';
  const customerId = getUser()?.customerId ?? '';
  const userId = getUser()?.userId ?? '';
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter>(';');
  const [analysis, setAnalysis] = useState<CsvAnalysis | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  // Carga el historial de bases del cliente desde el backend.
  const loadBases = useCallback(async () => {
    if (!customerId && !customer) return;
    setLoadingList(true);
    const res = await databaseService.list(customerId, customer);
    setLoadingList(false);
    if (isOk(res) && res.data?.files) {
      setBases(res.data.files.map(fromApi));
    }
  }, [customerId, customer]);

  useEffect(() => {
    loadBases();
  }, [loadBases]);

  const resetUpload = () => {
    setFile(null);
    setFileText('');
    setAnalysis(null);
    setDelimiter(';');
  };

  const handleFile = (f: File | null) => {
    setFile(f);
    setAnalysis(null);
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setFileText(text);
      const a = analyzeCsv(text);
      setDelimiter(a.delimiter);
      setAnalysis(a);
    };
    reader.readAsText(f);
  };

  const changeDelimiter = (d: Delimiter) => {
    setDelimiter(d);
    if (fileText) setAnalysis(analyzeCsv(fileText, d));
  };

  const handleUpload = async () => {
    if (!customer.trim()) {
      notify('Tu sesión no tiene una empresa asociada. Vuelve a iniciar sesión.', 'warning');
      return;
    }
    if (!file) {
      notify('Selecciona un archivo CSV.', 'warning');
      return;
    }
    setUploading(true);
    const presign = await campaignsService.presignUrl({
      customer: customer.trim(),
      documentName: file.name,
      documentType: 'database',
    });
    if (!isOk(presign) || !presign.data?.url) {
      setUploading(false);
      notify(presign.description || 'No se pudo obtener la URL de carga.', 'error');
      return;
    }
    const ok = await campaignsService.uploadToS3(presign.data.url, file);
    if (!ok || !analysis) {
      setUploading(false);
      notify('La base no se pudo subir a S3.', 'error');
      return;
    }
    const path = presign.data.path ?? '';

    // Registrar la metadata en el backend (tabla databaseFile).
    const reg = await databaseService.registerFile({
      customerId,
      customer: customer.trim(),
      fileName: file.name,
      s3Path: path,
      totalRecords: analysis.totalRows,
      validEmails: analysis.validEmails,
      invalidEmails: analysis.invalidEmails,
      duplicates: analysis.duplicateEmails,
      delimiter,
      uploadedBy: userId,
    });
    setUploading(false);

    // Mostramos la base recién cargada de inmediato (con su análisis para la vista
    // previa), aunque el registro de metadata falle; luego refrescamos del backend.
    const nowIso = new Date().toISOString();
    setBases((prev) => [
      {
        id: reg.data?.databaseFileId ?? `${Date.now()}`,
        name: file.name,
        customer: customer.trim(),
        path,
        totalRecords: analysis.totalRows,
        validEmails: analysis.validEmails,
        invalidEmails: analysis.invalidEmails,
        uploadDate: nowIso,
        delimiter,
        analysis,
      },
      ...prev,
    ]);
    notify(
      isOk(reg) ? `Base subida y registrada: ${path}` : `Base subida a S3 (${path}). No se pudo registrar su metadata.`,
      isOk(reg) ? 'success' : 'warning',
    );
    setUploadOpen(false);
    resetUpload();
    if (isOk(reg)) loadBases();
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Bases de datos</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={loadingList ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={loadBases} disabled={loadingList}>
            Actualizar
          </Button>
          <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={() => setUploadOpen(true)}>
            Cargar base de datos
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Sube tus listas de destinatarios (CSV). Antes de subir, validamos el archivo en tu
        navegador (columnas, total de registros, correos válidos/duplicados). La subida va a S3 vía
        URL prefirmada y su <strong>metadata queda registrada</strong> (nombre, ruta, registros,
        fecha) para verla en el historial. La vista previa solo está disponible para las bases
        cargadas en esta sesión.
      </Alert>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Archivo</TableCell>
              <TableCell>Cliente</TableCell>
              <TableCell align="right">Registros</TableCell>
              <TableCell align="right">Válidos</TableCell>
              <TableCell align="right">Inválidos</TableCell>
              <TableCell>Cargada</TableCell>
              <TableCell>Ruta S3</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bases.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {loadingList ? 'Cargando…' : 'Aún no hay bases de datos registradas para tu empresa.'}
                </TableCell>
              </TableRow>
            )}
            {bases.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.name}</TableCell>
                <TableCell>{b.customer}</TableCell>
                <TableCell align="right">{b.totalRecords}</TableCell>
                <TableCell align="right">
                  <Chip label={b.validEmails} size="small" color="success" variant="outlined" />
                </TableCell>
                <TableCell align="right">
                  {b.invalidEmails > 0 ? (
                    <Chip label={b.invalidEmails} size="small" color="error" variant="outlined" />
                  ) : (
                    0
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(b.uploadDate)}</TableCell>
                <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <code>{b.path}</code>
                </TableCell>
                <TableCell align="right">
                  <IconButton color="info" onClick={() => setViewBase(b)}>
                    <VisibilityIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Diálogo de carga con vista previa/validación */}
      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Cargar base de datos</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <StructureGuide structure={analysis?.structure} />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                <ApartmentIcon fontSize="small" color="action" />
                <Typography variant="body2" color="text.secondary">Empresa:&nbsp;</Typography>
                <Chip
                  size="small"
                  label={customer || 'sin empresa en la sesión'}
                  color={customer ? 'primary' : 'default'}
                  variant="outlined"
                />
                {customer && (
                  <Typography variant="caption" color="text.secondary">
                    → bucket <code>{customer.toLowerCase()}.database</code>
                  </Typography>
                )}
              </Box>
              <TextField
                select
                label="Delimitador"
                value={delimiter}
                onChange={(e) => changeDelimiter(e.target.value as Delimiter)}
                sx={{ minWidth: 200 }}
                disabled={!fileText}
              >
                {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((d) => (
                  <MenuItem key={d} value={d}>
                    {DELIMITER_LABELS[d]}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />}>
              {file ? `Archivo: ${file.name} (${formatBytes(file.size)})` : 'Seleccionar archivo CSV'}
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => handleFile(e.target.files?.[0] || null)} />
            </Button>

            {analysis && (
              <>
                <Divider />
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip icon={<StorageIcon />} label={`${analysis.totalRows} registros`} />
                  <Chip label={`${analysis.headers.length} columnas`} variant="outlined" />
                  <Chip label={`${analysis.validEmails} correos válidos`} color="success" variant="outlined" />
                  {analysis.invalidEmails > 0 && (
                    <Chip label={`${analysis.invalidEmails} inválidos`} color="error" variant="outlined" />
                  )}
                  {analysis.duplicateEmails > 0 && (
                    <Chip label={`${analysis.duplicateEmails} duplicados`} color="warning" variant="outlined" />
                  )}
                </Stack>

                {!analysis.structureOk && (
                  <Alert severity="warning">
                    La estructura no cumple el orden requerido. Las 3 primeras columnas deben ser
                    <strong> Identificación, Correo y Nombre</strong> en ese orden (el backend las
                    lee por posición). Corrige el archivo o el delimitador antes de subir.
                  </Alert>
                )}

                <Typography variant="subtitle2" color="text.secondary">
                  Vista previa (primeras filas)
                </Typography>
                <PreviewTable analysis={analysis} />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setUploadOpen(false); resetUpload(); }} disabled={uploading}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleUpload} disabled={uploading || !file || !customer.trim()}>
            {uploading ? <CircularProgress size={22} /> : 'Subir a S3'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo de vista de una base ya cargada */}
      <Dialog open={!!viewBase} onClose={() => setViewBase(null)} maxWidth="md" fullWidth>
        <DialogTitle>{viewBase?.name}</DialogTitle>
        <DialogContent>
          {viewBase && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Cliente: ${viewBase.customer}`} variant="outlined" />
                <Chip icon={<StorageIcon />} label={`${viewBase.totalRecords} registros`} />
                <Chip label={`${viewBase.validEmails} válidos`} color="success" variant="outlined" />
                {viewBase.invalidEmails > 0 && (
                  <Chip label={`${viewBase.invalidEmails} inválidos`} color="error" variant="outlined" />
                )}
                <Chip label={`Cargada: ${fmtDate(viewBase.uploadDate)}`} variant="outlined" />
              </Stack>
              <Typography variant="body2">
                <strong>Ruta S3:</strong> <code>{viewBase.path}</code>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Usa esta ruta como <strong>Data Path</strong> al crear la campaña.
              </Typography>
              <Divider />
              {viewBase.analysis ? (
                <PreviewTable analysis={viewBase.analysis} />
              ) : (
                <Alert severity="info" variant="outlined">
                  La vista previa del contenido solo está disponible para las bases cargadas en
                  esta sesión. Esta base se registró previamente; su archivo está en S3.
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewBase(null)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};

/* Tabla de vista previa (con scroll horizontal si hay muchas columnas). */
const PreviewTable = ({ analysis }: { analysis: CsvAnalysis }) => (
  <Box sx={{ overflowX: 'auto' }}>
    <Table size="small">
      <TableHead>
        <TableRow>
          {analysis.headers.map((h, i) => (
            <TableCell key={i} sx={{ fontWeight: 700, color: i === analysis.emailColumnIndex ? 'primary.main' : undefined, whiteSpace: 'nowrap' }}>
              {h || `col ${i + 1}`}
              {i === analysis.emailColumnIndex && ' ✉'}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {analysis.sample.map((row, r) => (
          <TableRow key={r}>
            {analysis.headers.map((_, c) => (
              <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>
                {row[c] ?? ''}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Box>
);

/* Guía de la estructura obligatoria del CSV. Si se pasa `structure`, marca por
   posición si cada columna esperada coincide con el archivo cargado. */
const StructureGuide = ({ structure }: { structure?: CsvAnalysis['structure'] }) => (
  <Alert severity="info" icon={false} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
    <Typography variant="subtitle2" gutterBottom>
      Estructura requerida del CSV — primeras columnas, en este orden:
    </Typography>
    <Stack spacing={0.5}>
      {REQUIRED_COLUMNS.map((col, i) => {
        const check = structure?.[i];
        return (
          <Stack key={col.label} direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 18, fontWeight: 700 }}>{i + 1}.</Box>
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 108 }}>
              {col.label}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              ({col.hint})
            </Typography>
            {check &&
              (check.ok ? (
                <CheckCircleIcon color="success" fontSize="small" />
              ) : (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <CancelIcon color="error" fontSize="small" />
                  <Typography variant="caption" color="error">
                    {check.actualHeader ? `hay: "${check.actualHeader}"` : 'falta'}
                  </Typography>
                </Stack>
              ))}
          </Stack>
        );
      })}
    </Stack>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
      Luego puedes añadir columnas opcionales (celular, factura, etc.). Separador: “;”. La
      Identificación debe ser numérica.
    </Typography>
  </Alert>
);
