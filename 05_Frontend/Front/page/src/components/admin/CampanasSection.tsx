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
  IconButton,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Chip,
  Divider
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EmailIcon from '@mui/icons-material/Email';
import { API_CONFIG, buildUrl } from '../../config/api';

interface Campana {
  id?: string;
  customerId: string;
  customerName: string;
  campaignName: string;
  channelName: string;
  attachmentType: string;
  template: string;
  from: string;
  dataPath: string;
  variableDocument: boolean;
  mask: string;
  attachment?: { path: string }[];
}

export const CampanasSection = () => {
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [openUploadDialog, setOpenUploadDialog] = useState(false);
  const [openSamplesDialog, setOpenSamplesDialog] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');

  // Form data para crear campaña
  const [formData, setFormData] = useState<Campana>({
    customerId: '',
    customerName: '',
    campaignName: '',
    channelName: '',
    attachmentType: 'ONFILE',
    template: '',
    from: '',
    dataPath: '',
    variableDocument: false,
    mask: '',
    attachment: [],
  });

  // Upload CSV
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvCustomer, setCsvCustomer] = useState('');
  const [csvDocumentType, setCsvDocumentType] = useState<'database' | 'document'>('database');

  // Adjuntos
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>(['']);

  // Envío de muestras
  const [samplesData, setSamplesData] = useState({
    customerName: '',
    campaignName: '',
    userId: '',
    template: '',
    templateVersion: 1,
    quantitySamples: 1,
    selectiveSamples: false,
    recipients: [''],
    identifications: [''],
  });

  const handleOpenDialog = () => {
    setFormData({
      customerId: '',
      customerName: '',
      campaignName: '',
      channelName: '',
      attachmentType: 'ONFILE',
      template: '',
      from: '',
      dataPath: '',
      variableDocument: false,
      mask: '',
      attachment: [],
    });
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setOpenUploadDialog(false);
    setOpenSamplesDialog(false);
  };

  const handleInputChange = (field: keyof Campana, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        ...formData,
        attachment: attachmentPaths
          .filter(path => path.trim() !== '')
          .map(path => ({ path })),
      };

      const response = await fetch(buildUrl(API_CONFIG.CAMPAIGNS.CREATE), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log('Campaña creada exitosamente');
        handleCloseDialog();
        loadCampanas();
      } else {
        console.error('Error al crear campaña');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const loadCampanas = async () => {
    try {
      const response = await fetch(buildUrl(API_CONFIG.CAMPAIGNS.LIST));
      if (response.ok) {
        const data = await response.json();
        setCampanas(data);
      }
    } catch (error) {
      console.error('Error al cargar campañas:', error);
    }
  };

  const loadCampanasByClient = async (clientId: string) => {
    try {
      const response = await fetch(
        buildUrl(API_CONFIG.CAMPAIGNS.GET_BY_CLIENT, { clientId })
      );
      if (response.ok) {
        const data = await response.json();
        setCampanas(data);
      }
    } catch (error) {
      console.error('Error al cargar campañas del cliente:', error);
    }
  };

  // Manejo de carga de CSV
  const handleUploadCSV = async () => {
    if (!csvFile || !csvCustomer) {
      alert('Por favor complete todos los campos');
      return;
    }

    try {
      // 1. Obtener URL prefirmada
      const presignResponse = await fetch(buildUrl(API_CONFIG.FILES.PRESIGN_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer: csvCustomer,
          documentType: csvDocumentType,
          documentName: csvFile.name,
        }),
      });

      if (!presignResponse.ok) {
        throw new Error('Error al obtener URL prefirmada');
      }

      const { uploadUrl } = await presignResponse.json();

      // 2. Subir archivo usando la URL prefirmada
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: csvFile,
        headers: {
          'Content-Type': 'text/csv',
        },
      });

      if (uploadResponse.ok) {
        console.log('Archivo CSV subido exitosamente');
        alert('Archivo CSV subido exitosamente');
        handleCloseDialog();
      } else {
        console.error('Error al subir archivo');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error al subir el archivo');
    }
  };

  // Manejo de envío de muestras
  const handleSendSamples = async () => {
    try {
      const payload = {
        ...samplesData,
        recipients: samplesData.recipients.filter(r => r.trim() !== ''),
        identifications: samplesData.selectiveSamples
          ? samplesData.identifications.filter(i => i.trim() !== '')
          : [],
      };

      const response = await fetch(buildUrl(API_CONFIG.CAMPAIGNS.SEND_SAMPLES), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log('Muestras enviadas exitosamente');
        alert('Muestras enviadas exitosamente');
        handleCloseDialog();
      } else {
        console.error('Error al enviar muestras');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Manejo de envío real
  const handleSendReal = async (campana: Campana) => {
    if (!window.confirm('¿Está seguro de enviar la campaña real?')) {
      return;
    }

    try {
      const payload = {
        customerName: campana.customerName,
        campaignName: campana.campaignName,
        userId: campana.customerId,
        template: campana.template,
        templateVersion: 1,
      };

      const response = await fetch(buildUrl(API_CONFIG.CAMPAIGNS.SEND_REAL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log('Campaña enviada exitosamente');
        alert('Campaña enviada exitosamente');
      } else {
        console.error('Error al enviar campaña');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Agregar/Eliminar correos de muestras
  const addRecipient = () => {
    setSamplesData(prev => ({
      ...prev,
      recipients: [...prev.recipients, ''],
    }));
  };

  const removeRecipient = (index: number) => {
    setSamplesData(prev => ({
      ...prev,
      recipients: prev.recipients.filter((_, i) => i !== index),
    }));
  };

  const updateRecipient = (index: number, value: string) => {
    setSamplesData(prev => ({
      ...prev,
      recipients: prev.recipients.map((r, i) => (i === index ? value : r)),
    }));
  };

  // Agregar/Eliminar identificaciones
  const addIdentification = () => {
    setSamplesData(prev => ({
      ...prev,
      identifications: [...prev.identifications, ''],
    }));
  };

  const removeIdentification = (index: number) => {
    setSamplesData(prev => ({
      ...prev,
      identifications: prev.identifications.filter((_, i) => i !== index),
    }));
  };

  const updateIdentification = (index: number, value: string) => {
    setSamplesData(prev => ({
      ...prev,
      identifications: prev.identifications.map((id, i) => (i === index ? value : id)),
    }));
  };

  // Agregar/Eliminar rutas de adjuntos
  const addAttachmentPath = () => {
    setAttachmentPaths(prev => [...prev, '']);
  };

  const removeAttachmentPath = (index: number) => {
    setAttachmentPaths(prev => prev.filter((_, i) => i !== index));
  };

  const updateAttachmentPath = (index: number, value: string) => {
    setAttachmentPaths(prev => prev.map((path, i) => (i === index ? value : path)));
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Campañas</Typography>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={<CloudUploadIcon />}
            onClick={() => setOpenUploadDialog(true)}
          >
            Cargar CSV
          </Button>
          <Button
            variant="outlined"
            startIcon={<EmailIcon />}
            onClick={() => setOpenSamplesDialog(true)}
          >
            Enviar Muestras
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenDialog}
          >
            Crear Campaña
          </Button>
        </Stack>
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField
            fullWidth
            label="Customer ID"
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
            placeholder="Ingrese el ID del cliente"
            sx={{ flex: { md: 2 } }}
          />
          <Button
            variant="outlined"
            onClick={() => loadCampanasByClient(selectedCustomerId)}
            sx={{ minWidth: 140 }}
          >
            Listar por Cliente
          </Button>
          <Button variant="outlined" onClick={loadCampanas} sx={{ minWidth: 120 }}>
            Listar Todas
          </Button>
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Campaña</TableCell>
              <TableCell>Cliente</TableCell>
              <TableCell>Canal</TableCell>
              <TableCell>Plantilla</TableCell>
              <TableCell>De</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {campanas.map((campana, index) => (
              <TableRow key={index}>
                <TableCell>{campana.campaignName}</TableCell>
                <TableCell>{campana.customerName}</TableCell>
                <TableCell>
                  <Chip label={campana.channelName} size="small" />
                </TableCell>
                <TableCell>{campana.template}</TableCell>
                <TableCell>{campana.from}</TableCell>
                <TableCell align="right">
                  <IconButton
                    color="primary"
                    onClick={() => handleSendReal(campana)}
                    title="Enviar campaña real"
                  >
                    <SendIcon />
                  </IconButton>
                  <IconButton color="error" title="Eliminar">
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
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
                  label="Nombre del Cliente"
                  value={formData.customerName}
                  onChange={(e) => handleInputChange('customerName', e.target.value)}
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Nombre de la Campaña"
                  value={formData.campaignName}
                  onChange={(e) => handleInputChange('campaignName', e.target.value)}
                />
                <TextField
                  fullWidth
                  label="Canal"
                  value={formData.channelName}
                  onChange={(e) => handleInputChange('channelName', e.target.value)}
                  placeholder="Ej: EAU, SMS, WhatsApp"
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Plantilla"
                  value={formData.template}
                  onChange={(e) => handleInputChange('template', e.target.value)}
                />
                <TextField
                  fullWidth
                  label="De (From)"
                  value={formData.from}
                  onChange={(e) => handleInputChange('from', e.target.value)}
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Data Path"
                  value={formData.dataPath}
                  onChange={(e) => handleInputChange('dataPath', e.target.value)}
                  placeholder="Ej: 2025-10-17/archivo.csv"
                />
                <TextField
                  fullWidth
                  label="Máscara"
                  value={formData.mask}
                  onChange={(e) => handleInputChange('mask', e.target.value)}
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                <FormControl fullWidth>
                  <InputLabel>Tipo de Adjunto</InputLabel>
                  <Select
                    value={formData.attachmentType}
                    label="Tipo de Adjunto"
                    onChange={(e) => handleInputChange('attachmentType', e.target.value)}
                  >
                    <MenuItem value="ONFILE">ONFILE</MenuItem>
                    <MenuItem value="ONLINE">ONLINE</MenuItem>
                    <MenuItem value="NONE">NONE</MenuItem>
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formData.variableDocument}
                      onChange={(e) => handleInputChange('variableDocument', e.target.checked)}
                    />
                  }
                  label="Documento Variable"
                />
              </Stack>

              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle1" gutterBottom>
                Adjuntos
              </Typography>
              {attachmentPaths.map((path, index) => (
                <Stack key={index} direction="row" spacing={1}>
                  <TextField
                    fullWidth
                    size="small"
                    label={`Ruta del adjunto ${index + 1}`}
                    value={path}
                    onChange={(e) => updateAttachmentPath(index, e.target.value)}
                    placeholder="Ej: 2025-10-17/archivo.pdf"
                  />
                  <IconButton
                    color="error"
                    onClick={() => removeAttachmentPath(index)}
                    disabled={attachmentPaths.length === 1}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={addAttachmentPath}
              >
                Agregar Adjunto
              </Button>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancelar</Button>
          <Button variant="contained" onClick={handleSubmit}>
            Crear Campaña
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog para cargar CSV */}
      <Dialog open={openUploadDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Cargar Archivo CSV</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Stack spacing={2}>
              <TextField
                fullWidth
                label="Nombre del Cliente"
                value={csvCustomer}
                onChange={(e) => setCsvCustomer(e.target.value)}
                placeholder="Ej: merkacaldas"
              />
              <FormControl fullWidth>
                <InputLabel>Tipo de Documento</InputLabel>
                <Select
                  value={csvDocumentType}
                  label="Tipo de Documento"
                  onChange={(e) => setCsvDocumentType(e.target.value as 'database' | 'document')}
                >
                  <MenuItem value="database">Database</MenuItem>
                  <MenuItem value="document">Document</MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                component="label"
                fullWidth
                startIcon={<CloudUploadIcon />}
              >
                Seleccionar Archivo CSV
                <input
                  type="file"
                  accept=".csv"
                  hidden
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                />
              </Button>
              {csvFile && (
                <Typography variant="body2">
                  Archivo seleccionado: {csvFile.name}
                </Typography>
              )}
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleUploadCSV}
            disabled={!csvFile || !csvCustomer}
          >
            Subir Archivo
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog para envío de muestras */}
      <Dialog open={openSamplesDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Enviar Muestras</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Nombre del Cliente"
                  value={samplesData.customerName}
                  onChange={(e) =>
                    setSamplesData(prev => ({ ...prev, customerName: e.target.value }))
                  }
                />
                <TextField
                  fullWidth
                  label="Nombre de la Campaña"
                  value={samplesData.campaignName}
                  onChange={(e) =>
                    setSamplesData(prev => ({ ...prev, campaignName: e.target.value }))
                  }
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="User ID"
                  value={samplesData.userId}
                  onChange={(e) =>
                    setSamplesData(prev => ({ ...prev, userId: e.target.value }))
                  }
                />
                <TextField
                  fullWidth
                  label="Plantilla"
                  value={samplesData.template}
                  onChange={(e) =>
                    setSamplesData(prev => ({ ...prev, template: e.target.value }))
                  }
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Versión de Plantilla"
                  type="number"
                  value={samplesData.templateVersion}
                  onChange={(e) =>
                    setSamplesData(prev => ({
                      ...prev,
                      templateVersion: parseInt(e.target.value) || 1,
                    }))
                  }
                />
                <TextField
                  fullWidth
                  label="Cantidad de Muestras"
                  type="number"
                  value={samplesData.quantitySamples}
                  onChange={(e) =>
                    setSamplesData(prev => ({
                      ...prev,
                      quantitySamples: parseInt(e.target.value) || 1,
                    }))
                  }
                />
              </Stack>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={samplesData.selectiveSamples}
                    onChange={(e) =>
                      setSamplesData(prev => ({
                        ...prev,
                        selectiveSamples: e.target.checked,
                      }))
                    }
                  />
                }
                label="Muestras Selectivas"
              />

              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle1" gutterBottom>
                Correos para Muestras
              </Typography>
              {samplesData.recipients.map((email, index) => (
                <Stack key={index} direction="row" spacing={1}>
                  <TextField
                    fullWidth
                    size="small"
                    type="email"
                    label={`Correo ${index + 1}`}
                    value={email}
                    onChange={(e) => updateRecipient(index, e.target.value)}
                    placeholder="correo@ejemplo.com"
                  />
                  <IconButton
                    color="error"
                    onClick={() => removeRecipient(index)}
                    disabled={samplesData.recipients.length === 1}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={addRecipient}>
                Agregar Correo
              </Button>

              {samplesData.selectiveSamples && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle1" gutterBottom>
                    Identificaciones (Muestras Selectivas)
                  </Typography>
                  {samplesData.identifications.map((id, index) => (
                    <Stack key={index} direction="row" spacing={1}>
                      <TextField
                        fullWidth
                        size="small"
                        label={`Identificación ${index + 1}`}
                        value={id}
                        onChange={(e) => updateIdentification(index, e.target.value)}
                        placeholder="Ingrese identificación"
                      />
                      <IconButton
                        color="error"
                        onClick={() => removeIdentification(index)}
                        disabled={samplesData.identifications.length === 1}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Stack>
                  ))}
                  <Button size="small" startIcon={<AddIcon />} onClick={addIdentification}>
                    Agregar Identificación
                  </Button>
                </>
              )}
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancelar</Button>
          <Button variant="contained" onClick={handleSendSamples}>
            Enviar Muestras
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
