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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import RefreshIcon from '@mui/icons-material/Refresh';
import ApartmentIcon from '@mui/icons-material/Apartment';
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import type { CampaignSummary } from '../../services/campaignsService';
import { templatesService } from '../../services/templatesService';
import type { TemplateSummary } from '../../services/templatesService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

interface CampaignForm {
  campaignName: string;
  channelName: string;
  attachmentType: string;
  template: string;
  from: string;
  dataPath: string;
}

const emptyForm = (from = ''): CampaignForm => ({
  campaignName: '',
  channelName: 'EM',
  attachmentType: 'NONE',
  template: '',
  from,
  dataPath: '',
});

/** Color del chip según el estado de la campaña. */
const ESTADO_COLOR: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  Pendiente: 'default',
  Muestras: 'warning',
  Enviando: 'info',
  Procesando: 'info',
  Terminada: 'success',
  Error: 'error',
};

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export const CampanasSection = () => {
  const sessionEmail = getUser()?.email ?? '';
  // El cliente (empresa) se toma de la sesión, no se captura en formularios.
  const customer = getUser()?.customer ?? '';
  const customerId = getUser()?.customerId ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();

  const [campanas, setCampanas] = useState<CampaignSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [openUploadDialog, setOpenUploadDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState<CampaignForm>(emptyForm(sessionEmail));

  // Plantillas SES del cliente (para el selector del formulario).
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Carga de CSV / documento a S3 (URL prefirmada).
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvDocumentType, setCsvDocumentType] = useState<'database' | 'document'>('database');
  const [lastUploadPath, setLastUploadPath] = useState('');

  const loadCampaigns = useCallback(async () => {
    if (!customerId) return;
    setLoadingList(true);
    const res = await campaignsService.list(customerId);
    setLoadingList(false);
    if (isOk(res) && res.data?.campaigns) setCampanas(res.data.campaigns);
  }, [customerId]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const loadTemplates = useCallback(async () => {
    if (!customer && !customerId) return;
    setLoadingTemplates(true);
    const res = await templatesService.list(customer, customerId);
    setLoadingTemplates(false);
    if (isOk(res) && res.data?.templates) setTemplates(res.data.templates);
  }, [customer, customerId]);

  const handleOpenDialog = () => {
    setFormData(emptyForm(sessionEmail));
    setOpenDialog(true);
    loadTemplates();
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setOpenUploadDialog(false);
  };

  const handleInputChange = (field: keyof CampaignForm, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!customerId) {
      notify('Tu sesión no tiene un cliente asociado. Vuelve a iniciar sesión.', 'warning');
      return;
    }
    if (!formData.campaignName || !formData.channelName) {
      notify('Nombre de la campaña y Canal son obligatorios.', 'warning');
      return;
    }
    setSubmitting(true);
    const res = await campaignsService.create({
      customerId,
      campaignName: formData.campaignName,
      channelName: formData.channelName,
      attachmentType: formData.attachmentType,
      dataPath: formData.dataPath,
      template: formData.template,
      from: formData.from,
    });
    setSubmitting(false);

    if (isOk(res)) {
      const campaignId = res.data?.campaignId;
      notify(`Campaña creada correctamente${campaignId ? ` (ID ${campaignId})` : ''}.`, 'success');
      handleCloseDialog();
      loadCampaigns();
    } else {
      notify(res.description || 'No se pudo crear la campaña.', 'error');
    }
  };

  const handleUploadCSV = async () => {
    if (!customer) {
      notify('Tu sesión no tiene una empresa asociada. Vuelve a iniciar sesión.', 'warning');
      return;
    }
    if (!csvFile) {
      notify('Selecciona un archivo.', 'warning');
      return;
    }
    setUploading(true);
    // 1) Pedir URL prefirmada al backend.
    const presign = await campaignsService.presignUrl({
      customer,
      documentName: csvFile.name,
      documentType: csvDocumentType,
    });
    if (!isOk(presign) || !presign.data?.url) {
      setUploading(false);
      notify(presign.description || 'No se pudo obtener la URL de carga.', 'error');
      return;
    }
    // 2) Subir el archivo directo a S3 con PUT.
    const ok = await campaignsService.uploadToS3(presign.data.url, csvFile);
    setUploading(false);
    if (ok) {
      const path = presign.data.path ?? '';
      setLastUploadPath(path);
      notify(`Archivo subido a S3${path ? `: ${path}` : ''}. Usa esa ruta como "Data Path".`, 'success');
      setCsvFile(null);
    } else {
      notify('El archivo no se pudo subir a S3.', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Campañas</Typography>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={loadingList ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={loadCampaigns}
            disabled={loadingList}
          >
            Actualizar
          </Button>
          <Button variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => setOpenUploadDialog(true)}>
            Cargar CSV
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenDialog}>
            Crear Campaña
          </Button>
        </Stack>
      </Stack>

      {lastUploadPath && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setLastUploadPath('')}>
          Último archivo subido: <strong>{lastUploadPath}</strong>
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Campaña</TableCell>
              <TableCell>Consecutivo</TableCell>
              <TableCell>Canal</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Plantilla</TableCell>
              <TableCell>Fecha</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {campanas.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {loadingList ? 'Cargando…' : 'Aún no hay campañas registradas para tu empresa.'}
                </TableCell>
              </TableRow>
            )}
            {campanas.map((campana) => (
              <TableRow key={campana.campaignId}>
                <TableCell>{campana.campaignName}</TableCell>
                <TableCell>{campana.consecutive ?? '—'}</TableCell>
                <TableCell>
                  <Chip label={campana.channel} size="small" />
                </TableCell>
                <TableCell>
                  <Chip
                    label={campana.campaignState || '—'}
                    size="small"
                    color={ESTADO_COLOR[campana.campaignState] ?? 'default'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {campana.template || '—'}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(campana.date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialog para crear campaña */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Crear Campaña</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ApartmentIcon fontSize="small" color="action" />
                <Typography variant="body2" color="text.secondary">Empresa:&nbsp;</Typography>
                <Chip
                  size="small"
                  label={customer || 'sin empresa en la sesión'}
                  color={customer ? 'primary' : 'default'}
                  variant="outlined"
                />
              </Box>
              <TextField
                fullWidth
                label="Nombre de la Campaña"
                value={formData.campaignName}
                onChange={(e) => handleInputChange('campaignName', e.target.value)}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Canal</InputLabel>
                  <Select
                    value={formData.channelName}
                    label="Canal"
                    onChange={(e) => handleInputChange('channelName', e.target.value)}
                  >
                    <MenuItem value="EM">EM — Email marketing</MenuItem>
                    <MenuItem value="EAU">EAU — Adjunto único</MenuItem>
                    <MenuItem value="EAP">EAP — Adjunto personalizado</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Tipo de Adjunto</InputLabel>
                  <Select
                    value={formData.attachmentType}
                    label="Tipo de Adjunto"
                    onChange={(e) => handleInputChange('attachmentType', e.target.value)}
                  >
                    <MenuItem value="NONE">NONE</MenuItem>
                    <MenuItem value="ONFILE">ONFILE</MenuItem>
                    <MenuItem value="ONLINE">ONLINE</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Plantilla (SES)</InputLabel>
                  <Select
                    value={formData.template}
                    label="Plantilla (SES)"
                    onChange={(e) => handleInputChange('template', e.target.value)}
                    endAdornment={loadingTemplates ? <CircularProgress size={16} sx={{ mr: 3 }} /> : undefined}
                  >
                    {templates.length === 0 && (
                      <MenuItem value="" disabled>
                        {loadingTemplates ? 'Cargando plantillas…' : 'No hay plantillas del cliente'}
                      </MenuItem>
                    )}
                    {templates.map((t) => (
                      <MenuItem key={t.name} value={t.name}>
                        {t.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  label="De (From)"
                  value={formData.from}
                  onChange={(e) => handleInputChange('from', e.target.value)}
                />
              </Stack>
              <TextField
                fullWidth
                label="Data Path"
                value={formData.dataPath}
                onChange={(e) => handleInputChange('dataPath', e.target.value)}
                placeholder="Ruta del CSV en S3 (ej: 2025-10-17/archivo.csv)"
                helperText="Usa la ruta que devuelve 'Cargar CSV' o la de Bases de datos"
              />
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <CircularProgress size={22} /> : 'Crear Campaña'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog para cargar CSV */}
      <Dialog open={openUploadDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Cargar Archivo</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Stack spacing={2}>
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
                    → bucket <code>{customer.toLowerCase()}.{csvDocumentType}</code>
                  </Typography>
                )}
              </Box>
              <FormControl fullWidth>
                <InputLabel>Tipo de Documento</InputLabel>
                <Select
                  value={csvDocumentType}
                  label="Tipo de Documento"
                  onChange={(e) => setCsvDocumentType(e.target.value as 'database' | 'document')}
                >
                  <MenuItem value="database">Database (CSV de destinatarios)</MenuItem>
                  <MenuItem value="document">Document (adjunto)</MenuItem>
                </Select>
              </FormControl>
              <Button variant="outlined" component="label" fullWidth startIcon={<CloudUploadIcon />}>
                Seleccionar Archivo
                <input
                  type="file"
                  accept=".csv,.pdf,.docx,.xlsx"
                  hidden
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                />
              </Button>
              {csvFile && <Typography variant="body2">Archivo seleccionado: {csvFile.name}</Typography>}
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={uploading}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleUploadCSV} disabled={!csvFile || uploading}>
            {uploading ? <CircularProgress size={22} /> : 'Subir Archivo'}
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
