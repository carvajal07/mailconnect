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
  InputAdornment,
  Select,
  MenuItem,
  FormControl,
  InputLabel
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { API_CONFIG, buildUrl } from '../../config/api';

interface Plantilla {
  id?: string;
  userId: string;
  customerId: string;
  channel: number;
  templateName: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

export const PlantillasSection = () => {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [openViewDialog, setOpenViewDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [selectedPlantilla, setSelectedPlantilla] = useState<Plantilla | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<Plantilla>({
    userId: '',
    customerId: '',
    channel: 1,
    templateName: '',
    subject: '',
    htmlBody: '',
    textBody: '',
  });

  const handleOpenDialog = (mode: 'create' | 'edit', plantilla?: Plantilla) => {
    setDialogMode(mode);
    if (mode === 'edit' && plantilla) {
      setSelectedPlantilla(plantilla);
      setFormData(plantilla);
    } else {
      setFormData({
        userId: '',
        customerId: '',
        channel: 1,
        templateName: '',
        subject: '',
        htmlBody: '',
        textBody: '',
      });
    }
    setOpenDialog(true);
  };

  const handleOpenViewDialog = (plantilla: Plantilla) => {
    setSelectedPlantilla(plantilla);
    setOpenViewDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setOpenViewDialog(false);
    setSelectedPlantilla(null);
  };

  const handleInputChange = (field: keyof Plantilla, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    try {
      const url = dialogMode === 'create'
        ? buildUrl(API_CONFIG.TEMPLATES.CREATE)
        : buildUrl(API_CONFIG.TEMPLATES.UPDATE);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        console.log('Plantilla guardada exitosamente');
        handleCloseDialog();
        loadPlantillas();
      } else {
        console.error('Error al guardar plantilla');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const loadPlantillas = async () => {
    try {
      const response = await fetch(buildUrl(API_CONFIG.TEMPLATES.LIST));
      if (response.ok) {
        const data = await response.json();
        setPlantillas(data);
      }
    } catch (error) {
      console.error('Error al cargar plantillas:', error);
    }
  };

  const handleDelete = async (userId: string, templateName: string) => {
    if (window.confirm('¿Está seguro de eliminar esta plantilla?')) {
      try {
        const response = await fetch(buildUrl(API_CONFIG.TEMPLATES.DELETE), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId, templateName }),
        });

        if (response.ok) {
          console.log('Plantilla eliminada exitosamente');
          loadPlantillas();
        }
      } catch (error) {
        console.error('Error al eliminar plantilla:', error);
      }
    }
  };

  const handleSearch = async () => {
    try {
      const url = `${buildUrl(API_CONFIG.TEMPLATES.SEARCH)}?term=${searchTerm}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setPlantillas(data);
      }
    } catch (error) {
      console.error('Error en búsqueda:', error);
    }
  };

  const getChannelName = (channel: number) => {
    const channels: Record<number, string> = {
      1: 'Email',
      2: 'SMS',
      3: 'WhatsApp',
    };
    return channels[channel] || 'Desconocido';
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Plantillas</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog('create')}
        >
          Crear Plantilla
        </Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField
            fullWidth
            placeholder="Buscar plantillas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ flex: { md: 2 } }}
          />
          <Button variant="outlined" onClick={handleSearch} sx={{ minWidth: 120 }}>
            Buscar
          </Button>
          <Button variant="outlined" onClick={loadPlantillas} sx={{ minWidth: 120 }}>
            Listar Todas
          </Button>
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell>
              <TableCell>Canal</TableCell>
              <TableCell>Asunto</TableCell>
              <TableCell>Customer ID</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plantillas.map((plantilla, index) => (
              <TableRow key={index}>
                <TableCell>{plantilla.templateName}</TableCell>
                <TableCell>{getChannelName(plantilla.channel)}</TableCell>
                <TableCell>{plantilla.subject}</TableCell>
                <TableCell>{plantilla.customerId}</TableCell>
                <TableCell align="right">
                  <IconButton
                    color="info"
                    onClick={() => handleOpenViewDialog(plantilla)}
                  >
                    <VisibilityIcon />
                  </IconButton>
                  <IconButton
                    color="primary"
                    onClick={() => handleOpenDialog('edit', plantilla)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    color="error"
                    onClick={() => handleDelete(plantilla.userId, plantilla.templateName)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialog para crear/editar */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="lg" fullWidth>
        <DialogTitle>
          {dialogMode === 'create' ? 'Crear Plantilla' : 'Editar Plantilla'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="User ID"
                  value={formData.userId}
                  onChange={(e) => handleInputChange('userId', e.target.value)}
                />
                <TextField
                  fullWidth
                  label="Customer ID"
                  value={formData.customerId}
                  onChange={(e) => handleInputChange('customerId', e.target.value)}
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Nombre de la Plantilla"
                  value={formData.templateName}
                  onChange={(e) => handleInputChange('templateName', e.target.value)}
                />
                <FormControl fullWidth>
                  <InputLabel>Canal</InputLabel>
                  <Select
                    value={formData.channel}
                    label="Canal"
                    onChange={(e) => handleInputChange('channel', e.target.value as number)}
                  >
                    <MenuItem value={1}>Email</MenuItem>
                    <MenuItem value={2}>SMS</MenuItem>
                    <MenuItem value={3}>WhatsApp</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <TextField
                fullWidth
                label="Asunto"
                value={formData.subject}
                onChange={(e) => handleInputChange('subject', e.target.value)}
              />
              <TextField
                fullWidth
                label="HTML Body"
                multiline
                rows={8}
                value={formData.htmlBody}
                onChange={(e) => handleInputChange('htmlBody', e.target.value)}
              />
              <TextField
                fullWidth
                label="Text Body"
                multiline
                rows={4}
                value={formData.textBody}
                onChange={(e) => handleInputChange('textBody', e.target.value)}
              />
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancelar</Button>
          <Button variant="contained" onClick={handleSubmit}>
            {dialogMode === 'create' ? 'Crear' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog para ver plantilla */}
      <Dialog open={openViewDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Ver Plantilla</DialogTitle>
        <DialogContent>
          {selectedPlantilla && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                <strong>Nombre:</strong> {selectedPlantilla.templateName}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                <strong>Canal:</strong> {getChannelName(selectedPlantilla.channel)}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                <strong>Asunto:</strong> {selectedPlantilla.subject}
              </Typography>
              <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
                <strong>HTML Body:</strong>
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'grey.100', maxHeight: 300, overflow: 'auto' }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {selectedPlantilla.htmlBody}
                </pre>
              </Paper>
              {selectedPlantilla.textBody && (
                <>
                  <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
                    <strong>Text Body:</strong>
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                    <Typography>{selectedPlantilla.textBody}</Typography>
                  </Paper>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
