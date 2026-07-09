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
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import type { CampaignPayload } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

interface Campana extends CampaignPayload {
  campaignId?: string;
}

const emptyForm = (from = ''): Campana => ({
  customerId: '',
  campaignName: '',
  channelName: 'EM',
  attachmentType: 'NONE',
  template: '',
  from,
  dataPath: '',
});

export const CampanasSection = () => {
  const sessionEmail = getUser()?.email ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();

  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [openUploadDialog, setOpenUploadDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState<Campana>(emptyForm(sessionEmail));

  // Carga de CSV / documento a S3 (URL prefirmada).
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvCustomer, setCsvCustomer] = useState('');
  const [csvDocumentType, setCsvDocumentType] = useState<'database' | 'document'>('database');
  const [lastUploadPath, setLastUploadPath] = useState('');

  const handleOpenDialog = () => {
    setFormData(emptyForm(sessionEmail));
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setOpenUploadDialog(false);
  };

  const handleInputChange = (field: keyof Campana, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.customerId || !formData.campaignName || !formData.channelName) {
      notify('Customer ID, Nombre de la campaña y Canal son obligatorios.', 'warning');
      return;
    }
    setSubmitting(true);
    const res = await campaignsService.create({
      customerId: formData.customerId,
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
      setCampanas((prev) => [{ ...formData, campaignId }, ...prev]);
      handleCloseDialog();
    } else {
      notify(res.description || 'No se pudo crear la campaña.', 'error');
    }
  };

  const handleUploadCSV = async () => {
    if (!csvFile || !csvCustomer) {
      notify('Selecciona un archivo y el nombre del cliente.', 'warning');
      return;
    }
    setUploading(true);
    // 1) Pedir URL prefirmada al backend.
    const presign = await campaignsService.presignUrl({
      customer: csvCustomer,
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
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Campañas</Typography>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => setOpenUploadDialog(true)}>
            Cargar CSV
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenDialog}>
            Crear Campaña
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Conectado a los endpoints reales de <strong>crear campaña</strong> y{' '}
        <strong>cargar archivo</strong> (URL prefirmada de S3). El listado global, el envío de
        muestras y el envío real aún no están expuestos como endpoints, por eso la tabla muestra
        las campañas creadas en esta sesión.
      </Alert>

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
              <TableCell>Customer ID</TableCell>
              <TableCell>Canal</TableCell>
              <TableCell>Plantilla</TableCell>
              <TableCell>De</TableCell>
              <TableCell>ID</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {campanas.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  Aún no hay campañas creadas en esta sesión.
                </TableCell>
              </TableRow>
            )}
            {campanas.map((campana, index) => (
              <TableRow key={`${campana.campaignName}-${index}`}>
                <TableCell>{campana.campaignName}</TableCell>
                <TableCell>{campana.customerId}</TableCell>
                <TableCell>
                  <Chip label={campana.channelName} size="small" />
                </TableCell>
                <TableCell>{campana.template}</TableCell>
                <TableCell>{campana.from}</TableCell>
                <TableCell>{campana.campaignId ?? '—'}</TableCell>
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
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Customer ID"
                  value={formData.customerId}
                  onChange={(e) => handleInputChange('customerId', e.target.value)}
                />
                <TextField
                  fullWidth
                  label="Nombre de la Campaña"
                  value={formData.campaignName}
                  onChange={(e) => handleInputChange('campaignName', e.target.value)}
                />
              </Stack>
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
                <TextField
                  fullWidth
                  label="Plantilla"
                  value={formData.template}
                  onChange={(e) => handleInputChange('template', e.target.value)}
                  placeholder="Nombre de la plantilla (SES)"
                />
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
                helperText="Usa la ruta que devuelve 'Cargar CSV'"
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
              <TextField
                fullWidth
                label="Nombre del Cliente"
                value={csvCustomer}
                onChange={(e) => setCsvCustomer(e.target.value)}
                placeholder="Ej: merkacaldas"
                helperText="Se usa para el bucket: {cliente}.{tipo}"
              />
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
          <Button variant="contained" onClick={handleUploadCSV} disabled={!csvFile || !csvCustomer || uploading}>
            {uploading ? <CircularProgress size={22} /> : 'Subir Archivo'}
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
