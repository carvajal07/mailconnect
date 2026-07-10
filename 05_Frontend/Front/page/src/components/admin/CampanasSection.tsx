import { useState, useCallback } from 'react';
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
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import ApartmentIcon from '@mui/icons-material/Apartment';
import EditIcon from '@mui/icons-material/Edit';
import StorageIcon from '@mui/icons-material/Storage';
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import type { CampaignSummary } from '../../services/campaignsService';
import { templatesService } from '../../services/templatesService';
import type { TemplateSummary } from '../../services/templatesService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { usePortalData } from '../../context/PortalDataContext';

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
  // Campañas y bases precargadas al entrar al portal (contexto compartido).
  const { campaigns: campaignsCtx, databases, refreshCampaigns } = usePortalData();
  const campanas = campaignsCtx.items;
  const loadingList = campaignsCtx.loading;

  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = crear, id = editar
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<CampaignForm>(emptyForm(sessionEmail));

  // Plantillas SES del cliente (para el selector del formulario).
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Plantillas de mensaje guardadas (SMS/WSP) para prellenar el campo del canal.
  const [msgTemplates, setMsgTemplates] = useState<MessageTemplate[]>([]);

  const loadCampaigns = refreshCampaigns;

  const loadTemplates = useCallback(async () => {
    if (!customer && !customerId) return;
    setLoadingTemplates(true);
    const res = await templatesService.list(customer, customerId);
    setLoadingTemplates(false);
    if (isOk(res) && res.data?.templates) setTemplates(res.data.templates);
  }, [customer, customerId]);

  // Carga las plantillas SMS + WhatsApp guardadas (para reutilizarlas en la campaña).
  const loadMsgTemplates = useCallback(async () => {
    if (!customerId) return;
    const res = await messageTemplatesService.list(customerId);
    if (isOk(res) && res.data?.templates) setMsgTemplates(res.data.templates);
  }, [customerId]);

  const handleOpenDialog = () => {
    setEditingId(null);
    setFormData(emptyForm(sessionEmail));
    setOpenDialog(true);
    loadTemplates();
    loadMsgTemplates();
  };

  /** Abre el diálogo precargado con los datos de una campaña para editarla. */
  const handleEdit = (c: CampaignSummary) => {
    setEditingId(c.campaignId);
    setFormData({
      campaignName: c.campaignName ?? '',
      channelName: c.channel ?? 'EM',
      attachmentType: 'NONE',
      template: c.template ?? '',
      from: c.originEmail ?? sessionEmail,
      dataPath: c.dataPath ?? '',
    });
    setOpenDialog(true);
    loadTemplates();
    loadMsgTemplates();
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingId(null);
  };

  const isSms = formData.channelName === 'SMS';
  const isWsp = formData.channelName === 'WSP';
  // SMS y WhatsApp no usan adjunto ni plantilla SES.
  const isMessaging = isSms || isWsp;

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
    const res = editingId
      ? await campaignsService.update({
          campaignId: editingId,
          campaignName: formData.campaignName,
          channelName: formData.channelName,
          attachmentType: formData.attachmentType,
          dataPath: formData.dataPath,
          template: formData.template,
          from: formData.from,
        })
      : await campaignsService.create({
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
      notify(editingId ? 'Campaña actualizada correctamente.' : 'Campaña creada correctamente.', 'success');
      handleCloseDialog();
      loadCampaigns();
    } else {
      notify(res.description || `No se pudo ${editingId ? 'actualizar' : 'crear'} la campaña.`, 'error');
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
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenDialog}>
            Crear Campaña
          </Button>
        </Stack>
      </Stack>

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
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {campanas.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
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
                <TableCell align="right">
                  <Tooltip title={campana.campaignState === 'Pendiente' ? 'Editar campaña' : 'Solo se pueden editar campañas en estado Pendiente'}>
                    <span>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => handleEdit(campana)}
                        disabled={campana.campaignState !== 'Pendiente'}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialog para crear campaña */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>{editingId ? 'Editar Campaña' : 'Crear Campaña'}</DialogTitle>
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
                    <MenuItem value="SMS">SMS — Mensaje de texto</MenuItem>
                    <MenuItem value="WSP">WSP — WhatsApp (plantilla)</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth disabled={isMessaging}>
                  <InputLabel>Tipo de Adjunto</InputLabel>
                  <Select
                    value={isMessaging ? 'NONE' : formData.attachmentType}
                    label="Tipo de Adjunto"
                    onChange={(e) => handleInputChange('attachmentType', e.target.value)}
                  >
                    <MenuItem value="NONE">NONE</MenuItem>
                    <MenuItem value="ONFILE">ONFILE</MenuItem>
                    <MenuItem value="ONLINE">ONLINE</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              {isSms ? (
                <>
                  {msgTemplates.some((t) => t.channel === 'SMS') && (
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Usar plantilla SMS guardada (opcional)"
                      value=""
                      onChange={(e) => {
                        const t = msgTemplates.find((m) => m.messageTemplateId === e.target.value);
                        if (t?.body) handleInputChange('template', t.body);
                      }}
                    >
                      {msgTemplates.filter((t) => t.channel === 'SMS').map((t) => (
                        <MenuItem key={t.messageTemplateId} value={t.messageTemplateId}>{t.name}</MenuItem>
                      ))}
                    </TextField>
                  )}
                  <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    label="Texto del SMS"
                    value={formData.template}
                    onChange={(e) => handleInputChange('template', e.target.value)}
                    placeholder="Hola {{Nombre}}, tu mensaje aquí…"
                    helperText={`Admite variables {{columna}} del CSV. ${formData.template.length} caracteres (~${Math.max(1, Math.ceil(formData.template.length / 160))} segmento(s)). En SMS la columna 2 del CSV es el celular (E.164, +57…).`}
                  />
                </>
              ) : isWsp ? (
                <>
                  {msgTemplates.some((t) => t.channel === 'WSP') && (
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Usar plantilla WhatsApp guardada (opcional)"
                      value=""
                      onChange={(e) => {
                        const t = msgTemplates.find((m) => m.messageTemplateId === e.target.value);
                        if (t?.hsmName) handleInputChange('template', t.hsmName);
                      }}
                    >
                      {msgTemplates.filter((t) => t.channel === 'WSP').map((t) => (
                        <MenuItem key={t.messageTemplateId} value={t.messageTemplateId}>{t.name} · {t.hsmName}</MenuItem>
                      ))}
                    </TextField>
                  )}
                  <TextField
                    fullWidth
                    label="Plantilla de WhatsApp (HSM)"
                    value={formData.template}
                    onChange={(e) => handleInputChange('template', e.target.value)}
                    placeholder="nombre_de_la_plantilla_aprobada"
                    helperText="Nombre exacto de la plantilla de marketing pre-aprobada por Meta. Los parámetros {{1}}, {{2}}… se toman de las columnas del CSV desde 'Nombre' en adelante. La columna 2 del CSV es el celular (E.164, +57…)."
                  />
                </>
              ) : (
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
              )}
              <FormControl fullWidth>
                <InputLabel>Base de datos</InputLabel>
                <Select
                  value={databases.items.some((d) => d.s3Path === formData.dataPath) ? formData.dataPath : (formData.dataPath || '')}
                  label="Base de datos"
                  onChange={(e) => handleInputChange('dataPath', e.target.value)}
                >
                  {/* Conserva una ruta previa que ya no esté en la lista (ej. al editar). */}
                  {formData.dataPath && !databases.items.some((d) => d.s3Path === formData.dataPath) && (
                    <MenuItem value={formData.dataPath}>{formData.dataPath} (actual)</MenuItem>
                  )}
                  {databases.items.length === 0 && (
                    <MenuItem value="" disabled>
                      {databases.loading ? 'Cargando bases…' : 'No hay bases; cárgalas en "Bases de datos"'}
                    </MenuItem>
                  )}
                  {databases.items.map((d) => (
                    <MenuItem key={d.databaseFileId} value={d.s3Path}>
                      <StorageIcon fontSize="small" sx={{ mr: 1, verticalAlign: 'middle', color: 'text.secondary' }} />
                      {d.fileName} — {d.totalRecords?.toLocaleString('es-CO')} registros
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <CircularProgress size={22} /> : editingId ? 'Guardar cambios' : 'Crear Campaña'}
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
