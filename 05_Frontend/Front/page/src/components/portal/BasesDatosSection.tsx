import { useState } from 'react';
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
  Tooltip,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  Switch,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ApartmentIcon from '@mui/icons-material/Apartment';
import RefreshIcon from '@mui/icons-material/Refresh';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { campaignsService } from '../../services/campaignsService';
import { databaseService, type DatabaseFile, type HygieneReport } from '../../services/databaseService';
import { getUser } from '../../services/authService';
import { isOk } from '../../services/apiClient';
import { usePortalData } from '../../context/PortalDataContext';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { analyzeCsv, DELIMITER_LABELS, requiredColumns, channelContactType, isSpreadsheetFile, readSpreadsheet, isJsonFile, jsonToRows, rowsToCsv, detectDelimiter, detectMultiRecord, type CsvAnalysis, type ContactType, type Delimiter } from './csv';
import MultiRecordWizard, { type MultiRecordResult } from './MultiRecordWizard';
import { featureEnabled, FEATURE_CSV_MULTIRECORD, FEATURE_JSON_IMPORT } from '../../config/features';
import { formatDateTime } from '../../utils/datetime';

interface BaseDatos {
  id: string;
  name: string;
  customer: string;
  path: string;
  totalRecords: number;
  validEmails: number;
  invalidEmails: number;
  duplicates: number;
  channel: string;
  uploadDate: string;
  delimiter: string;
  // Encabezados + primeras filas persistidos en el backend (vista previa aunque la base
  // no se haya cargado en esta sesión).
  columns?: string[];
  previewRows?: string[][];
  // Solo presente para las bases cargadas en esta sesión (para la vista previa completa).
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
  duplicates: f.duplicates ?? 0,
  channel: f.channel ?? 'EMAIL',
  uploadDate: f.uploadDate ?? '',
  delimiter: f.delimiter ?? ';',
  columns: f.columns,
  previewRows: f.previewRows,
});

/** Texto del tooltip de duplicados según el canal de la base (correo o celular). */
const duplicatesTooltip = (channel: string): string =>
  channelContactType(channel) === 'phone'
    ? 'Registros con el mismo celular repetido en la base.'
    : 'Registros con el mismo correo repetido en la base.';

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export const BasesDatosSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  // Bases precargadas al entrar al portal (contexto compartido).
  const { databases, refreshDatabases } = usePortalData();
  // Análisis local (vista previa) de las bases cargadas en esta sesión, por id.
  const [analysisById, setAnalysisById] = useState<Record<string, CsvAnalysis>>({});

  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewBase, setViewBase] = useState<BaseDatos | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Higiene de listas (verificación previa): reporte + diálogo.
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [hygiene, setHygiene] = useState<HygieneReport | null>(null);
  const [hygieneOpen, setHygieneOpen] = useState(false);

  const loadingList = databases.loading;
  const bases: BaseDatos[] = databases.items.map((f) => {
    const b = fromApi(f);
    const a = analysisById[b.id];
    return a ? { ...b, analysis: a } : b;
  });

  // El cliente (empresa) se toma de la sesión; define el bucket {customer}.database.
  const customer = getUser()?.customer ?? '';
  const customerId = getUser()?.customerId ?? '';
  const userId = getUser()?.userId ?? '';
  // Funciones que el admin puede apagar por cliente (feature flags de la sesión).
  const featureFlags = getUser()?.featureFlags;
  const jsonImportEnabled = featureEnabled(featureFlags, FEATURE_JSON_IMPORT);
  const csvMultiEnabled = featureEnabled(featureFlags, FEATURE_CSV_MULTIRECORD);
  const [file, setFile] = useState<File | null>(null);
  // Archivo que realmente se sube a S3: para CSV es el mismo; para Excel es el CSV convertido.
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isSpreadsheet, setIsSpreadsheet] = useState(false);
  const [fileText, setFileText] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter>(';');
  const [analysis, setAnalysis] = useState<CsvAnalysis | null>(null);
  const [uploading, setUploading] = useState(false);
  // Canal para el que se valida la base: define si la columna 2 es correo o celular.
  const [channel, setChannel] = useState('EMAIL');
  const contact = channelContactType(channel);
  // ¿Permitir duplicados? Si el cliente lo marca, no se filtran contactos repetidos en
  // el envío real: se envía el total de comunicaciones de la base aunque vayan al mismo
  // destinatario (lo respeta Prepare-batch, que por defecto deduplica).
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  // CSV MULTIREGISTRO (sin encabezado; columna = tipo de registro): el archivo crudo se
  // conserva y el ASISTENTE (MultiRecordWizard) lo mapea; su resultado llega por onConfig.
  const [multiMode, setMultiMode] = useState(false);
  const [multiConfig, setMultiConfig] = useState<MultiRecordResult | null>(null);
  const [rawCsv, setRawCsv] = useState<{ text: string; delimiter: Delimiter; name: string; file: File } | null>(null);

  // Modal de progreso de la subida (2 pasos).
  type StepState = 'pending' | 'loading' | 'done' | 'error';
  const [progressOpen, setProgressOpen] = useState(false);
  const [stepPresign, setStepPresign] = useState<StepState>('pending');
  const [stepUpload, setStepUpload] = useState<StepState>('pending');
  const [stepRegister, setStepRegister] = useState<StepState>('pending');
  const [progressMsg, setProgressMsg] = useState('');

  const resetUpload = () => {
    setFile(null);
    setUploadFile(null);
    setIsSpreadsheet(false);
    setFileText('');
    setAnalysis(null);
    setDelimiter(';');
    setChannel('EMAIL');
    setAllowDuplicates(false);
    setMultiMode(false);
    setMultiConfig(null);
    setRawCsv(null);
  };

  // ── CSV multiregistro: el asistente emite la configuración; aquí se aterriza ──

  /** Resultado del asistente → CSV generado listo para subir + análisis para las señales
   *  de validación. Una configuración inválida (nombres repetidos) deshabilita la subida. */
  const handleMultiConfig = (res: MultiRecordResult | null) => {
    setMultiConfig(res);
    if (!res) {
      setUploadFile(null);
      setAnalysis(null);
      return;
    }
    setFileText(res.csvText);
    setIsSpreadsheet(true); // delimitador fijo ';' (archivo generado), como Excel/JSON
    setDelimiter(';');
    setAnalysis(analyzeCsv(res.csvText, ';', contact));
    const base = (rawCsv?.name ?? 'base').replace(/\.(csv|txt)$/i, '');
    setUploadFile(res.valid ? new File([res.csvText], `${base}-registros.csv`, { type: 'text/csv' }) : null);
  };

  /** Activa/desactiva el modo multiregistro sobre el CSV cargado. */
  const toggleMulti = (on: boolean) => {
    if (!rawCsv) return;
    if (on) {
      setMultiMode(true); // el asistente se monta y emite la configuración por onConfig
    } else {
      setMultiMode(false);
      setMultiConfig(null);
      setIsSpreadsheet(false);
      setFileText(rawCsv.text);
      setUploadFile(rawCsv.file);
      const a = analyzeCsv(rawCsv.text, rawCsv.delimiter, contact);
      setDelimiter(a.delimiter);
      setAnalysis(a);
    }
  };

  /** Verificación de HIGIENE de la base (Database/Verify): sintaxis, duplicados,
   *  desechables, cuentas de rol y dominios no resolubles. Abre el reporte. */
  const handleVerify = async (b: BaseDatos) => {
    setVerifyingId(b.id);
    const res = await databaseService.verify(b.id);
    setVerifyingId(null);
    if (isOk(res) && res.data) {
      setHygiene(res.data);
      setHygieneOpen(true);
    } else {
      notify(res.description || 'No se pudo verificar la base (¿la ruta /Database/Verify está desplegada?).', 'error');
    }
  };

  const handleDelete = async (b: BaseDatos) => {
    const ok = await confirm({
      title: 'Eliminar base de datos',
      message: `¿Eliminar la base "${b.name}"? Se quita del listado y se borra el archivo CSV de S3. Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeletingId(b.id);
    const res = await databaseService.delete(b.id);
    setDeletingId(null);
    if (isOk(res)) {
      notify('Base de datos eliminada.', 'success');
      refreshDatabases();
    } else {
      notify(res.description || 'No se pudo eliminar la base de datos.', 'error');
    }
  };

  const handleFile = async (f: File | null) => {
    setFile(f);
    setAnalysis(null);
    setIsSpreadsheet(false);
    setUploadFile(null);
    setMultiMode(false);
    setMultiConfig(null);
    setRawCsv(null);
    if (!f) return;

    // Excel: se lee la primera hoja y se CONVIERTE a CSV en el navegador; a S3 sube el CSV
    // (el backend sigue leyendo CSV). El delimitador queda fijo en ';' para el archivo generado.
    if (isSpreadsheetFile(f)) {
      try {
        const rows = await readSpreadsheet(f);
        const csv = rowsToCsv(rows, ';');
        setFileText(csv);
        setIsSpreadsheet(true);
        setDelimiter(';');
        setAnalysis(analyzeCsv(csv, ';', contact));
        const csvName = f.name.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, '') + '.csv';
        setUploadFile(new File([csv], csvName, { type: 'text/csv' }));
      } catch {
        notify('No se pudo leer el Excel. Verifica que sea un .xlsx válido y con datos en la primera hoja.', 'error');
      }
      return;
    }

    // JSON: array de objetos → se CONVIERTE a CSV en el navegador (a S3 sube el CSV;
    // el backend no cambia). Los campos anidados (arrays/objetos) quedan como JSON
    // DENTRO de la celda — alimentan tablas con repetición en el Estudio PDF.
    if (isJsonFile(f)) {
      if (!jsonImportEnabled) {
        notify('La importación de bases en JSON no está habilitada para tu cuenta.', 'warning');
        setFile(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = jsonToRows(String(reader.result ?? ''), contact);
          const csv = rowsToCsv(rows, ';');
          setFileText(csv);
          setIsSpreadsheet(true); // delimitador fijo ';' (archivo generado), como el Excel
          setDelimiter(';');
          setAnalysis(analyzeCsv(csv, ';', contact));
          const csvName = f.name.replace(/\.json$/i, '') + '.csv';
          setUploadFile(new File([csv], csvName, { type: 'text/csv' }));
        } catch (e) {
          notify(e instanceof Error ? e.message : 'No se pudo leer el JSON.', 'error');
        }
      };
      reader.readAsText(f);
      return;
    }

    // CSV: se lee como texto. Si parece MULTIREGISTRO (sin encabezado; la columna 1 es
    // el tipo de registro y se repite entre líneas), se convierte al modelo interno; si
    // no, se analiza y sube tal cual (comportamiento de siempre). El switch del diálogo
    // permite corregir la detección en ambos sentidos.
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const d = detectDelimiter(text);
      setRawCsv({ text, delimiter: d, name: f.name, file: f });
      // Solo se activa el mapeo multiregistro si la función está habilitada para el cliente.
      if (csvMultiEnabled && detectMultiRecord(text, d)) {
        // El asistente (montado por multiMode) hace la detección/mapeo y emite el CSV.
        setMultiMode(true);
        return;
      }
      setFileText(text);
      setUploadFile(f);
      const a = analyzeCsv(text, d, contact);
      setDelimiter(a.delimiter);
      setAnalysis(a);
    };
    reader.readAsText(f);
  };

  // Al cambiar el canal, re-analiza con el tipo de contacto correspondiente. En modo
  // multiregistro el asistente reacciona solo al nuevo `contact` (prop) y re-emite la
  // configuración (el placeholder de la columna de contacto cambia Correo↔Celular).
  const changeChannel = (ch: string) => {
    setChannel(ch);
    if (multiMode) return;
    if (fileText) setAnalysis(analyzeCsv(fileText, delimiter, channelContactType(ch)));
  };

  const changeDelimiter = (d: Delimiter) => {
    setDelimiter(d);
    if (fileText) setAnalysis(analyzeCsv(fileText, d, contact));
  };

  const handleUpload = async () => {
    if (!customer.trim()) {
      notify('Tu sesión no tiene una empresa asociada. Vuelve a iniciar sesión.', 'warning');
      return;
    }
    if (!uploadFile || !analysis) {
      notify('Selecciona un archivo CSV, Excel o JSON.', 'warning');
      return;
    }

    // Abrir el modal de progreso con los 3 pasos.
    setProgressOpen(true);
    setProgressMsg('');
    setStepPresign('loading');
    setStepUpload('pending');
    setStepRegister('pending');
    setUploading(true);

    // Paso 1: URL prefirmada.
    const presign = await campaignsService.presignUrl({
      customer: customer.trim(),
      nit: getUser()?.nit ?? '',
      documentName: uploadFile.name,
      documentType: 'database',
    });
    if (!isOk(presign) || !presign.data?.url) {
      setStepPresign('error');
      setProgressMsg(presign.description || 'No se pudo obtener la URL de carga.');
      setUploading(false);
      return;
    }
    setStepPresign('done');

    // Paso 2: carga a S3 (el CSV; para Excel, el CSV ya convertido).
    setStepUpload('loading');
    const ok = await campaignsService.uploadToS3(presign.data.url, uploadFile);
    if (!ok) {
      setStepUpload('error');
      setProgressMsg('El archivo no se pudo subir a S3.');
      setUploading(false);
      return;
    }
    setStepUpload('done');
    const path = presign.data.path ?? '';

    // Paso 3: registrar la metadata en el sistema (tabla databaseFile). Es lo que hace
    // que la base APAREZCA en este tab y en los selectores; si falla, la base quedó en
    // S3 pero NO registrada. Se muestra como 3er check para que el error sea visible.
    setStepRegister('loading');
    const reg = await databaseService.registerFile({
      customerId,
      customer: customer.trim(),
      fileName: uploadFile.name,
      s3Path: path,
      totalRecords: analysis.totalRows,
      validEmails: analysis.validEmails,
      invalidEmails: analysis.invalidEmails,
      duplicates: analysis.duplicateEmails,
      allowDuplicates,
      delimiter,
      channel,
      // Encabezados del CSV → campos usables como {{variables}} en las plantillas.
      columns: analysis.headers,
      // Primeras filas → vista previa persistente del "ver detalle" (aunque no sea esta sesión).
      previewRows: analysis.sample.slice(0, 5),
      uploadedBy: userId,
    });
    setUploading(false);

    // Guardamos el análisis local (vista previa) y refrescamos el contexto.
    const newId = reg.data?.databaseFileId;
    if (newId) setAnalysisById((prev) => ({ ...prev, [newId]: analysis }));
    if (isOk(reg)) {
      setStepRegister('done');
      refreshDatabases();
    } else {
      setStepRegister('error');
      setProgressMsg(
        reg.description
          ? `La base se subió a S3 pero NO se registró en el sistema: ${reg.description}`
          : 'La base se subió a S3 pero NO se registró en el sistema (revisa la ruta /Database/Register-file y los permisos de la Lambda).',
      );
    }
  };

  /** Cierra el modal de progreso y el diálogo de carga (botón Aceptar). */
  const closeProgress = () => {
    setProgressOpen(false);
    setStepPresign('pending');
    setStepUpload('pending');
    setStepRegister('pending');
    setProgressMsg('');
    // Solo se cierra el diálogo de carga si la base quedó REGISTRADA (todo el flujo OK).
    // Si el registro falló, se deja abierto para reintentar sin volver a elegir el archivo.
    if (stepRegister === 'done') {
      setUploadOpen(false);
      resetUpload();
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Bases de datos</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={loadingList ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={refreshDatabases} disabled={loadingList}>
            Actualizar
          </Button>
          <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={() => setUploadOpen(true)}>
            Cargar base de datos
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Sube tus listas de destinatarios (<strong>CSV, Excel .xlsx{jsonImportEnabled ? ' o JSON' : ''}</strong>
        {jsonImportEnabled
          ? <> — el Excel y el JSON se convierten a CSV automáticamente; en el JSON, un campo con una
              LISTA — p.&nbsp;ej. los movimientos de un extracto — se conserva y alimenta las tablas con
              repetición del Estudio PDF)</>
          : <> — el Excel se convierte a CSV automáticamente)</>}.
        {csvMultiEnabled && <> También se acepta el <strong>CSV multiregistro</strong> (sin
          encabezado, con la columna 1 como tipo de registro): se detecta solo y se agrupan los
          sub-registros por destinatario.</>} Antes de subir, validamos el archivo en tu
        navegador y contamos: <strong>Válidos</strong> (contacto de la columna 2 con formato
        correcto y sin duplicar) e <strong>Inválidos</strong> (contacto vacío o con formato
        inválido para el canal: correo mal escrito, o celular que no es E.164). La subida va a S3
        vía URL prefirmada y su <strong>metadata queda registrada</strong> para verla en el
        historial. Se guarda una <strong>vista previa</strong> (encabezado y primeras filas) para
        consultarla en "ver detalle" cuando quieras.
      </Alert>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Archivo</TableCell>
              <TableCell align="right">Registros</TableCell>
              <TableCell align="right">
                <Tooltip title="Filas con un contacto (correo o celular, según el canal) con formato correcto y sin duplicar.">
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
                    Válidos <InfoOutlinedIcon sx={{ fontSize: 15 }} color="disabled" />
                  </Box>
                </Tooltip>
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Filas cuyo contacto (columna 2) está vacío o tiene formato inválido para el canal (correo mal escrito, o celular que no es E.164 +57…). Los duplicados se cuentan aparte y no entran aquí.">
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
                    Inválidos <InfoOutlinedIcon sx={{ fontSize: 15 }} color="disabled" />
                  </Box>
                </Tooltip>
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Cantidad de registros con el contacto repetido en la base. Pasa el cursor sobre el valor de cada base para ver si el duplicado se detectó sobre el correo o sobre el celular.">
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
                    Duplicados <InfoOutlinedIcon sx={{ fontSize: 15 }} color="disabled" />
                  </Box>
                </Tooltip>
              </TableCell>
              <TableCell>Cargada</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bases.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {loadingList ? 'Cargando…' : 'Aún no hay bases de datos registradas para tu empresa.'}
                </TableCell>
              </TableRow>
            )}
            {bases.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.name}</TableCell>
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
                <TableCell align="right">
                  {b.duplicates > 0 ? (
                    <Tooltip title={duplicatesTooltip(b.channel)}>
                      <Chip label={b.duplicates} size="small" color="warning" variant="outlined" sx={{ cursor: 'help' }} />
                    </Tooltip>
                  ) : (
                    0
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(b.uploadDate)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Ver detalle">
                    <IconButton color="info" onClick={() => setViewBase(b)}>
                      <VisibilityIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Verificar higiene (sintaxis, duplicados, dominios desechables o inexistentes)">
                    <span>
                      <IconButton color="success" onClick={() => handleVerify(b)} disabled={verifyingId === b.id}>
                        {verifyingId === b.id ? <CircularProgress size={20} /> : <HealthAndSafetyIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Eliminar base">
                    <span>
                      <IconButton color="error" onClick={() => handleDelete(b)} disabled={deletingId === b.id}>
                        {deletingId === b.id ? <CircularProgress size={20} /> : <DeleteIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
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
            <StructureGuide structure={analysis?.structure} contact={contact} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                  → prefijo <code>database/</code> del bucket del cliente
                </Typography>
              )}
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Canal"
                value={channel}
                onChange={(e) => changeChannel(e.target.value)}
                fullWidth
                helperText={contact === 'phone' ? 'La columna 2 debe ser el celular (E.164)' : 'La columna 2 debe ser el correo'}
              >
                <MenuItem value="EMAIL">Correo (email)</MenuItem>
                <MenuItem value="SMS">SMS</MenuItem>
                <MenuItem value="WHATSAPP">WhatsApp</MenuItem>
                <MenuItem value="VOICE">Voz</MenuItem>
              </TextField>
              <TextField
                select
                label="Delimitador"
                value={delimiter}
                onChange={(e) => changeDelimiter(e.target.value as Delimiter)}
                sx={{ minWidth: 200 }}
                disabled={!fileText || isSpreadsheet}
                helperText={isSpreadsheet ? 'El Excel se convierte a CSV (;)' : undefined}
              >
                {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((d) => (
                  <MenuItem key={d} value={d}>
                    {DELIMITER_LABELS[d]}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            {/* Permitir duplicados: si se marca, el envío real NO filtra contactos repetidos. */}
            <Box>
              <FormControlLabel
                control={<Checkbox checked={allowDuplicates} onChange={(e) => setAllowDuplicates(e.target.checked)} />}
                label={`Permitir duplicados (${contact === 'phone' ? 'celulares' : 'correos'} repetidos)`}
              />
              {allowDuplicates && (
                <Alert severity="warning" sx={{ mt: 0.5 }}>
                  No se validarán duplicados en el {contact === 'phone' ? 'celular' : 'correo'}: se
                  enviará el <strong>total de comunicaciones</strong> de la base aunque varias vayan
                  al <strong>mismo destinatario</strong>. Cada envío repetido se cobra igual.
                </Alert>
              )}
            </Box>

            <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />}>
              {file ? `Archivo: ${file.name} (${formatBytes(file.size)})`
                : `Seleccionar archivo CSV, Excel${jsonImportEnabled ? ' o JSON' : ''}`}
              <input
                type="file"
                accept={'.csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'
                  + (jsonImportEnabled ? ',.json,application/json' : '')}
                hidden
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
            </Button>
            {isSpreadsheet && !multiMode && (
              <Typography variant="caption" color="text.secondary">
                Excel detectado: se leyó la <strong>primera hoja</strong> y se convirtió a CSV para subirla.
                Si un celular o identificación sale como inválido, formatéalo como <strong>Texto</strong> en Excel
                (para no perder el <code>+</code> ni los ceros a la izquierda).
              </Typography>
            )}

            {rawCsv && csvMultiEnabled && (
              <FormControlLabel
                control={<Switch checked={multiMode} onChange={(e) => toggleMulti(e.target.checked)} />}
                label={
                  <Typography variant="body2">
                    Archivo <strong>multiregistro</strong> (sin encabezado; una columna de cada línea es el
                    <strong> tipo de registro</strong>)
                  </Typography>
                }
              />
            )}
            {multiMode && rawCsv && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <MultiRecordWizard
                  rawText={rawCsv.text}
                  delimiter={rawCsv.delimiter}
                  contact={contact}
                  onConfig={handleMultiConfig}
                />
              </Paper>
            )}
            {multiMode && multiConfig && !multiConfig.valid && (
              <Alert severity="error">
                Hay <strong>nombres de columna repetidos</strong> dentro de un canal. Corrígelos en el
                asistente para poder subir la base.
              </Alert>
            )}

            {analysis && (
              <>
                <Divider />
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip icon={<StorageIcon />} label={`${analysis.totalRows} registros`} />
                  <Chip label={`${analysis.headers.length} columnas`} variant="outlined" />
                  <Chip label={`${analysis.validEmails} ${contact === 'phone' ? 'celulares' : 'correos'} válidos`} color="success" variant="outlined" />
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
                    <strong> Identificación, {contact === 'phone' ? 'Celular' : 'Correo'} y Nombre</strong> en ese
                    orden (el backend las lee por posición). Corrige el archivo, el canal o el delimitador antes de subir.
                  </Alert>
                )}

                {/* En multiregistro el asistente ya muestra su propia vista previa en vivo. */}
                {!multiMode && (
                  <>
                    <Typography variant="subtitle2" color="text.secondary">
                      Vista previa (primeras filas)
                    </Typography>
                    <PreviewTable analysis={analysis} />
                  </>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setUploadOpen(false); resetUpload(); }} disabled={uploading}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleUpload} disabled={uploading || !uploadFile || !customer.trim()}>
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
                {viewBase.duplicates > 0 && (
                  <Tooltip title={duplicatesTooltip(viewBase.channel)}>
                    <Chip label={`${viewBase.duplicates} duplicados`} color="warning" variant="outlined" sx={{ cursor: 'help' }} />
                  </Tooltip>
                )}
                <Chip label={`Cargada: ${formatDateTime(viewBase.uploadDate)}`} variant="outlined" />
              </Stack>
              <Typography variant="body2">
                <strong>Ruta S3:</strong> <code>{viewBase.path}</code>
              </Typography>
              <Divider />
              {viewBase.analysis ? (
                <PreviewTable analysis={viewBase.analysis} />
              ) : (viewBase.previewRows && viewBase.previewRows.length && viewBase.columns && viewBase.columns.length) ? (
                <>
                  <Typography variant="subtitle2" color="text.secondary">
                    Vista previa (primeras filas)
                  </Typography>
                  <SimplePreviewTable headers={viewBase.columns} rows={viewBase.previewRows} />
                </>
              ) : (viewBase.columns && viewBase.columns.length) ? (
                <>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Columnas de la base
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {viewBase.columns.map((c, i) => <Chip key={i} label={c || `col ${i + 1}`} size="small" variant="outlined" />)}
                  </Stack>
                  <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
                    Esta base se registró antes de guardar la muestra de filas. Vuelve a subirla para
                    ver las primeras filas aquí; su archivo sigue en S3.
                  </Alert>
                </>
              ) : (
                <Alert severity="info" variant="outlined">
                  La vista previa del contenido no está disponible para esta base (se registró
                  previamente). Su archivo está en S3.
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewBase(null)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Modal de progreso de la subida (2 pasos) */}
      <Dialog open={progressOpen} onClose={() => {}} maxWidth="xs" fullWidth disableEscapeKeyDown>
        <DialogTitle>Subiendo base de datos</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <ProgressStep state={stepPresign} label="Crear URL prefirmada" />
            <ProgressStep state={stepUpload} label="Cargar el archivo a S3" />
            <ProgressStep state={stepRegister} label="Registrar la base en el sistema" />
            {progressMsg && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {progressMsg}
              </Alert>
            )}
            {stepRegister === 'done' && (
              <Alert severity="success" sx={{ mt: 1 }}>
                Base registrada. Ya aparece en la lista y en los selectores de campaña/plantilla.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={closeProgress} disabled={uploading}>
            {uploading ? <CircularProgress size={20} color="inherit" /> : 'Aceptar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reporte de HIGIENE de la base (verificación previa al envío real) */}
      <Dialog open={hygieneOpen} onClose={() => setHygieneOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Higiene de la base{hygiene ? ` — ${hygiene.fileName}` : ''}</DialogTitle>
        <DialogContent dividers>
          {hygiene && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography variant="h3" fontWeight={800} color={
                  hygiene.level === 'ok' ? 'success.main' : hygiene.level === 'warning' ? 'warning.main' : 'error.main'
                }>
                  {hygiene.hygieneScore}%
                </Typography>
                <Box>
                  <Chip
                    size="small"
                    color={hygiene.level === 'ok' ? 'success' : hygiene.level === 'warning' ? 'warning' : 'error'}
                    label={hygiene.level === 'ok' ? 'Saludable' : hygiene.level === 'warning' ? 'Atención' : 'Crítica'}
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    {hygiene.counts.valid.toLocaleString('es-CO')} de {hygiene.analyzed.toLocaleString('es-CO')} contactos limpios
                    {hygiene.truncated ? ` (analizados los primeros ${hygiene.analyzed.toLocaleString('es-CO')} de ${hygiene.total.toLocaleString('es-CO')})` : ''}
                  </Typography>
                </Box>
              </Stack>

              {hygiene.level !== 'ok' && (
                <Alert severity={hygiene.level === 'warning' ? 'warning' : 'error'}>
                  Enviar a contactos inválidos, desechables o de dominios inexistentes dispara los
                  rebotes y daña la reputación del remitente. Depura la base antes del envío real.
                </Alert>
              )}

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" variant="outlined" color="error" label={`Sintaxis inválida: ${hygiene.counts.invalidSyntax}`} />
                <Chip size="small" variant="outlined" color="warning" label={`Duplicados: ${hygiene.counts.duplicates}`} />
                {hygiene.contactType === 'correo' && (
                  <>
                    <Chip size="small" variant="outlined" color="error" label={`Desechables: ${hygiene.counts.disposable}`} />
                    <Chip size="small" variant="outlined" color="error" label={`Dominio inexistente: ${hygiene.counts.unresolvableDomains}`} />
                    <Chip size="small" variant="outlined" label={`Cuentas de rol: ${hygiene.counts.roleAccounts}`} />
                  </>
                )}
              </Stack>

              {(['invalidSyntax', 'duplicates', 'disposable', 'unresolvableDomains', 'roleAccounts'] as const)
                .filter((k) => (hygiene.samples[k] || []).length > 0)
                .map((k) => (
                  <Box key={k}>
                    <Typography variant="subtitle2" gutterBottom>
                      {{
                        invalidSyntax: 'Ejemplos con sintaxis inválida',
                        duplicates: 'Ejemplos duplicados',
                        disposable: 'Ejemplos en dominios desechables',
                        unresolvableDomains: 'Ejemplos con dominio inexistente',
                        roleAccounts: 'Cuentas de rol (advertencia: apertura baja, más quejas)',
                      }[k]}
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1, maxHeight: 120, overflow: 'auto' }}>
                      <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                        {(hygiene.samples[k] || []).join('\n')}
                      </Typography>
                    </Paper>
                  </Box>
                ))}

              {hygiene.contactType === 'correo' && hygiene.domains && hygiene.domains.skipped > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Se consultaron {hygiene.domains.checked} dominios; {hygiene.domains.skipped} quedaron
                  sin consultar por el tope por verificación (no penalizan el puntaje).
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHygieneOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
      {ConfirmDialog}
    </Box>
  );
};

/** Un paso del modal de progreso con su check / spinner / error. */
const ProgressStep = ({ state, label }: { state: 'pending' | 'loading' | 'done' | 'error'; label: string }) => (
  <Stack direction="row" spacing={1.5} alignItems="center">
    {state === 'loading' ? (
      <CircularProgress size={22} />
    ) : state === 'done' ? (
      <CheckCircleIcon color="success" />
    ) : state === 'error' ? (
      <CancelIcon color="error" />
    ) : (
      <RadioButtonUncheckedIcon color="disabled" />
    )}
    <Typography variant="body2" color={state === 'pending' ? 'text.secondary' : 'text.primary'}>
      {label}
    </Typography>
  </Stack>
);

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

/* Vista previa persistida (encabezados + filas guardadas en el backend), sin análisis en vivo. */
const SimplePreviewTable = ({ headers, rows }: { headers: string[]; rows: string[][] }) => (
  <Box sx={{ overflowX: 'auto' }}>
    <Table size="small">
      <TableHead>
        <TableRow>
          {headers.map((h, i) => (
            <TableCell key={i} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h || `col ${i + 1}`}</TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, r) => (
          <TableRow key={r}>
            {headers.map((_, c) => (
              <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{row[c] ?? ''}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Box>
);

/* Guía de la estructura obligatoria del CSV. Si se pasa `structure`, marca por
   posición si cada columna esperada coincide con el archivo cargado. */
const StructureGuide = ({ structure, contact }: { structure?: CsvAnalysis['structure']; contact: ContactType }) => (
  <Alert severity="info" icon={false} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
    <Typography variant="subtitle2" gutterBottom>
      Estructura requerida del CSV — primeras columnas, en este orden:
    </Typography>
    <Stack spacing={0.5}>
      {requiredColumns(contact).map((col, i) => {
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
      Luego puedes añadir columnas opcionales. La Identificación debe ser numérica.
      {contact === 'phone' && ' El celular debe ir en formato E.164 (+57…).'}
    </Typography>
  </Alert>
);
