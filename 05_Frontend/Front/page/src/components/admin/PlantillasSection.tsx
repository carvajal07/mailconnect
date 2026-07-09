import { useMemo, useState } from 'react';
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
  InputLabel,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { getUser } from '../../services/authService';
import { templatesService } from '../../services/templatesService';
import type { TemplatePayload } from '../../services/templatesService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

interface Plantilla extends TemplatePayload {
  source: 'created' | 'fetched';
}

const emptyForm = (userId = ''): Plantilla => ({
  userId,
  customerId: '',
  channel: 1,
  templateName: '',
  subject: '',
  htmlBody: '',
  textBody: '',
  source: 'created',
});

export const PlantillasSection = () => {
  const sessionUserId = getUser()?.userId ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();

  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [openViewDialog, setOpenViewDialog] = useState(false);
  const [selectedPlantilla, setSelectedPlantilla] = useState<Plantilla | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [queryName, setQueryName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingName, setLoadingName] = useState('');
  const [formData, setFormData] = useState<Plantilla>(emptyForm(sessionUserId));

  const handleOpenDialog = () => {
    setFormData(emptyForm(sessionUserId));
    setOpenDialog(true);
  };

  const handleOpenViewDialog = async (plantilla: Plantilla) => {
    // Si aún no tenemos el contenido real, lo pedimos al backend (get-template).
    if (!plantilla.htmlBody && plantilla.templateName) {
      setLoadingName(plantilla.templateName);
      const res = await templatesService.get(plantilla.userId || sessionUserId, plantilla.templateName);
      setLoadingName('');
      if (isOk(res) && res.template) {
        plantilla = {
          ...plantilla,
          subject: res.template.SubjectPart ?? plantilla.subject,
          htmlBody: res.template.HtmlPart ?? '',
          textBody: res.template.TextPart ?? '',
        };
        setPlantillas((prev) =>
          prev.map((p) => (p.templateName === plantilla.templateName ? plantilla : p)),
        );
      } else {
        notify(res.description || 'No se pudo obtener la plantilla del backend.', 'error');
      }
    }
    setSelectedPlantilla(plantilla);
    setOpenViewDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setOpenViewDialog(false);
    setSelectedPlantilla(null);
  };

  const handleInputChange = (field: keyof Plantilla, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.userId || !formData.customerId || !formData.templateName) {
      notify('User ID, Customer ID y Nombre de la plantilla son obligatorios.', 'warning');
      return;
    }
    setSubmitting(true);
    const res = await templatesService.create({
      userId: formData.userId,
      customerId: formData.customerId,
      channel: Number(formData.channel),
      templateName: formData.templateName,
      subject: formData.subject,
      htmlBody: formData.htmlBody,
      textBody: formData.textBody,
    });
    setSubmitting(false);

    if (isOk(res)) {
      notify(
        'Plantilla creada. El backend generó el nombre final con el formato cliente_consecutivo_canal_nombre.',
        'success',
      );
      setPlantillas((prev) => [{ ...formData, source: 'created' }, ...prev]);
      handleCloseDialog();
    } else {
      notify(res.description || 'No se pudo crear la plantilla.', 'error');
    }
  };

  const handleQueryByName = async () => {
    const name = queryName.trim();
    if (!name) return;
    setLoadingName(name);
    const res = await templatesService.get(sessionUserId, name);
    setLoadingName('');
    if (isOk(res) && res.template) {
      const fetched: Plantilla = {
        userId: sessionUserId,
        customerId: '',
        channel: 1,
        templateName: res.template.TemplateName || name,
        subject: res.template.SubjectPart ?? '',
        htmlBody: res.template.HtmlPart ?? '',
        textBody: res.template.TextPart ?? '',
        source: 'fetched',
      };
      setPlantillas((prev) => {
        const rest = prev.filter((p) => p.templateName !== fetched.templateName);
        return [fetched, ...rest];
      });
      notify('Plantilla consultada correctamente.', 'success');
      setQueryName('');
    } else {
      notify(res.description || 'No se encontró la plantilla con ese nombre.', 'error');
    }
  };

  const handleDelete = async (plantilla: Plantilla) => {
    if (!window.confirm(`¿Eliminar la plantilla "${plantilla.templateName}"?`)) return;
    const res = await templatesService.remove(plantilla.userId || sessionUserId, plantilla.templateName);
    if (isOk(res)) {
      notify('Plantilla eliminada correctamente.', 'success');
      setPlantillas((prev) => prev.filter((p) => p.templateName !== plantilla.templateName));
    } else {
      notify(res.description || 'No se pudo eliminar la plantilla.', 'error');
    }
  };

  const getChannelName = (channel: number) => {
    const channels: Record<number, string> = { 1: 'Email', 2: 'SMS', 3: 'WhatsApp' };
    return channels[channel] || `Canal ${channel}`;
  };

  // Búsqueda del lado del cliente sobre la lista local (el backend no expone listar/buscar).
  const visibles = useMemo(() => {
    const t = searchTerm.trim().toLowerCase();
    if (!t) return plantillas;
    return plantillas.filter(
      (p) =>
        p.templateName.toLowerCase().includes(t) ||
        p.subject.toLowerCase().includes(t) ||
        p.customerId.toLowerCase().includes(t),
    );
  }, [plantillas, searchTerm]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Plantillas</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenDialog}>
          Crear Plantilla
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        El backend soporta <strong>crear</strong>, <strong>consultar por nombre</strong> y{' '}
        <strong>eliminar</strong> plantillas. Aún no expone un listado global, por eso la tabla
        muestra lo que creas o consultas en esta sesión.
      </Alert>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField
            fullWidth
            placeholder="Filtrar la lista actual..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ flex: { md: 1 } }}
          />
          <TextField
            fullWidth
            placeholder="Nombre exacto en SES para consultar..."
            value={queryName}
            onChange={(e) => setQueryName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQueryByName()}
            sx={{ flex: { md: 1 } }}
          />
          <Button
            variant="outlined"
            onClick={handleQueryByName}
            disabled={!queryName.trim() || !!loadingName}
            sx={{ minWidth: 160 }}
          >
            {loadingName ? <CircularProgress size={20} /> : 'Consultar por nombre'}
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
              <TableCell>Origen</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibles.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  Aún no hay plantillas. Crea una o consúltala por su nombre exacto.
                </TableCell>
              </TableRow>
            )}
            {visibles.map((plantilla, index) => (
              <TableRow key={`${plantilla.templateName}-${index}`}>
                <TableCell>{plantilla.templateName}</TableCell>
                <TableCell>{getChannelName(plantilla.channel)}</TableCell>
                <TableCell>{plantilla.subject}</TableCell>
                <TableCell>
                  <Chip
                    label={plantilla.source === 'created' ? 'Creada' : 'Consultada'}
                    size="small"
                    color={plantilla.source === 'created' ? 'primary' : 'info'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton color="info" onClick={() => handleOpenViewDialog(plantilla)}>
                    <VisibilityIcon />
                  </IconButton>
                  <IconButton color="error" onClick={() => handleDelete(plantilla)}>
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialog para crear */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="lg" fullWidth>
        <DialogTitle>Crear Plantilla</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="User ID"
                  value={formData.userId}
                  onChange={(e) => handleInputChange('userId', e.target.value)}
                  helperText="Prellenado desde tu sesión"
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
          <Button onClick={handleCloseDialog} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <CircularProgress size={22} /> : 'Crear'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog para ver */}
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
              <Paper variant="outlined" sx={{ p: 2, maxHeight: 300, overflow: 'auto' }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {selectedPlantilla.htmlBody || '(sin contenido)'}
                </pre>
              </Paper>
              {selectedPlantilla.textBody && (
                <>
                  <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
                    <strong>Text Body:</strong>
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2 }}>
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

      {FeedbackSnackbar}
    </Box>
  );
};
