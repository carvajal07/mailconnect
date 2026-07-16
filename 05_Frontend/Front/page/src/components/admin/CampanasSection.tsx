import { useState, useCallback, useRef } from 'react';
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
  IconButton,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import ApartmentIcon from '@mui/icons-material/Apartment';
import EditIcon from '@mui/icons-material/Edit';
import StorageIcon from '@mui/icons-material/Storage';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import type { CampaignSummary } from '../../services/campaignsService';
import { templatesService } from '../../services/templatesService';
import type { TemplateSummary } from '../../services/templatesService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { usePortalData } from '../../context/PortalDataContext';

type EapDocFormat = 'DOCX' | 'PDF';

interface CampaignForm {
  campaignName: string;
  channelName: string;
  attachmentType: string;
  template: string;
  from: string;
  dataPath: string;
  // Solo EAP: formato del documento (DOCX = combinación Word, PDF = campos personalizados).
  documentFormat: EapDocFormat;
}

const emptyForm = (from = ''): CampaignForm => ({
  campaignName: '',
  channelName: 'EM',
  attachmentType: 'NONE',
  template: '',
  from,
  dataPath: '',
  documentFormat: 'DOCX',
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
  // Campañas, bases y plantillas de mensaje precargadas al entrar al portal (contexto compartido).
  const { campaigns: campaignsCtx, databases, messageTemplates: msgTemplatesCtx, refreshCampaigns, refreshStats } = usePortalData();
  const campanas = campaignsCtx.items;
  const loadingList = campaignsCtx.loading;
  // Plantillas SMS/WSP: se toman del contexto (ya precargadas), no se re-piden al abrir el diálogo.
  const msgTemplates = msgTemplatesCtx.items;

  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = crear, id = editar
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<CampaignForm>(emptyForm(sessionEmail));

  // Plantillas SES del cliente (para el selector del formulario).
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  // Evita re-pedir las plantillas SES cada vez que se abre el diálogo (se cargan una vez).
  const templatesLoadedRef = useRef(false);

  // Documento adjunto (solo EAU/EAP): se sube a S3 y se pasa su ruta a la campaña.
  const [attachmentPath, setAttachmentPath] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  const loadCampaigns = refreshCampaigns;

  // Plantillas SES: se cargan UNA vez (la primera vez que se abre el diálogo) y se
  // cachean en el componente; abrir/cerrar el diálogo no las vuelve a pedir. Pasar
  // `force` (tras publicar una plantilla nueva) obliga a refrescar.
  const loadTemplates = useCallback(async (force = false) => {
    if (!customer && !customerId) return;
    if (templatesLoadedRef.current && !force) return;
    templatesLoadedRef.current = true;
    setLoadingTemplates(true);
    const res = await templatesService.list(customer, customerId);
    setLoadingTemplates(false);
    if (isOk(res) && res.data?.templates) setTemplates(res.data.templates);
  }, [customer, customerId]);

  const resetAttachment = () => {
    setAttachmentPath('');
    setAttachmentName('');
  };

  const handleOpenDialog = () => {
    setEditingId(null);
    setFormData(emptyForm(sessionEmail));
    resetAttachment();
    setOpenDialog(true);
    loadTemplates();
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
      documentFormat: (c.documentFormat as EapDocFormat) ?? 'DOCX',
    });
    resetAttachment();
    setOpenDialog(true);
    loadTemplates();
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingId(null);
  };

  const isSms = formData.channelName === 'SMS';
  const isWsp = formData.channelName === 'WSP';
  const isVoice = formData.channelName === 'VOZ';
  const isEap = formData.channelName === 'EAP';
  // Solo EAU/EAP llevan documento adjunto (el resto no).
  const isAttachment = formData.channelName === 'EAU' || formData.channelName === 'EAP';
  // EAP con PDF acepta .pdf; EAP con DOCX (o EAU) acepta documentos ofimáticos.
  const isEapPdf = isEap && formData.documentFormat === 'PDF';
  const attachmentAccept = isEapPdf ? '.pdf' : isEap ? '.docx,.doc' : '.pdf,.docx,.doc,.xlsx';
  // Plantillas disponibles por canal (SMS/WSP se eligen de estas; sin texto libre).
  const smsTemplates = msgTemplates.filter((t) => t.channel === 'SMS');
  const wspTemplates = msgTemplates.filter((t) => t.channel === 'WSP');

  /** Id de la plantilla que corresponde al contenido actual de la campaña (para el selector).
   *  Se deriva del template guardado: SMS compara por texto (body), WSP por nombre HSM.
   *  '' si no coincide con ninguna guardada (p. ej. al editar una plantilla ya borrada). */
  const currentMsgTemplateId = isSms
    ? smsTemplates.find((t) => t.body === formData.template)?.messageTemplateId ?? ''
    : isWsp
      ? wspTemplates.find((t) => t.hsmName === formData.template)?.messageTemplateId ?? ''
      : '';

  /** Elige una plantilla guardada (SMS/WSP) → fija el contenido de la campaña. */
  const selectMsgTemplate = (id: string) => {
    const t = msgTemplates.find((m) => m.messageTemplateId === id);
    if (!t) return;
    // SMS guarda el texto (body); WSP guarda el nombre de la plantilla HSM.
    handleInputChange('template', t.channel === 'WSP' ? (t.hsmName ?? '') : (t.body ?? ''));
  };

  const handleInputChange = (field: keyof CampaignForm, value: string) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Al pasar a EAU/EAP, propone "Archivo adjunto" (antes quedaba en "Sin adjunto");
      // al salir de esos canales, vuelve a "Sin adjunto".
      if (field === 'channelName') {
        const attach = value === 'EAU' || value === 'EAP';
        next.attachmentType = attach ? (prev.attachmentType === 'NONE' ? 'ONFILE' : prev.attachmentType) : 'NONE';
        // Al salir de EAP, el formato de documento vuelve al default.
        if (value !== 'EAP') next.documentFormat = 'DOCX';
        // Cada canal usa un tipo de plantilla distinto (SES / body SMS / HSM / texto voz):
        // al cambiar de canal se limpia para no arrastrar un valor incompatible.
        if (value !== prev.channelName) next.template = '';
      }
      return next;
    });
    // Cambiar de canal o de formato invalida el adjunto ya subido (cambia el tipo de archivo).
    if (field === 'channelName' || field === 'documentFormat') resetAttachment();
  };

  /** Sube el documento adjunto (EAU/EAP) a S3 y guarda su ruta. */
  const handleUploadAttachment = async (fileEvent: React.ChangeEvent<HTMLInputElement>) => {
    const file = fileEvent.target.files?.[0];
    fileEvent.target.value = ''; // permite re-seleccionar el mismo archivo
    if (!file) return;
    if (!customer) {
      notify('Tu sesión no tiene una empresa asociada. Vuelve a iniciar sesión.', 'warning');
      return;
    }
    setAttachmentUploading(true);
    const presign = await campaignsService.presignUrl({ customer, nit: getUser()?.nit ?? '', documentName: file.name, documentType: 'document' });
    if (!isOk(presign) || !presign.data?.url || !presign.data?.path) {
      setAttachmentUploading(false);
      return notify(presign.description || 'No se pudo crear la URL para el adjunto.', 'error');
    }
    const ok = await campaignsService.uploadToS3(presign.data.url, file);
    setAttachmentUploading(false);
    if (ok) {
      setAttachmentPath(presign.data.path);
      setAttachmentName(file.name);
      notify('Documento adjunto subido.', 'success');
    } else {
      notify('No se pudo subir el documento adjunto a S3.', 'error');
    }
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
    // SMS/WSP: la plantilla se ELIGE de las guardadas del canal (obligatoria).
    if ((isSms || isWsp) && !formData.template) {
      notify(`Selecciona una plantilla de ${isSms ? 'SMS' : 'WhatsApp'} guardada para este canal.`, 'warning');
      return;
    }
    // EAU/EAP exigen un documento adjunto (el backend lo valida y devuelve 400 sin él).
    if (!editingId && isAttachment && !attachmentPath) {
      notify('Para EAU/EAP debes subir el documento adjunto antes de crear la campaña.', 'warning');
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
          documentFormat: isEap ? formData.documentFormat : undefined,
        })
      : await campaignsService.create({
          customerId,
          campaignName: formData.campaignName,
          channelName: formData.channelName,
          attachmentType: formData.attachmentType,
          dataPath: formData.dataPath,
          template: formData.template,
          from: formData.from,
          // Documento adjunto (solo EAU/EAP): el backend espera una lista de { path }.
          attachment: isAttachment && attachmentPath ? [{ path: attachmentPath }] : undefined,
          // Formato del documento EAP (DOCX combinación Word / PDF campos personalizados).
          documentFormat: isEap ? formData.documentFormat : undefined,
          // EAP siempre es personalizado por destinatario.
          variableDocument: isEap || undefined,
        });
    setSubmitting(false);

    if (isOk(res)) {
      notify(editingId ? 'Campaña actualizada correctamente.' : 'Campaña creada correctamente.', 'success');
      handleCloseDialog();
      loadCampaigns();
      // Refresca también Estadísticas para que la campaña nueva aparezca sin darle "Actualizar".
      refreshStats();
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
              <Alert severity="info" icon={<InfoOutlinedIcon />}>
                <Typography variant="body2" component="div">
                  <strong>Canal</strong> — cómo se envía:
                </Typography>
                <Box component="ul" sx={{ m: 0.5, pl: 2.5 }}>
                  <li><strong>EM</strong>: correo con plantilla HTML, sin adjunto.</li>
                  <li><strong>EAU</strong>: correo con un <em>adjunto único</em> (el mismo archivo para todos).</li>
                  <li><strong>EAP</strong>: correo con <em>adjunto personalizado</em> por destinatario. Dos tipos: <strong>Word (.docx)</strong> combinación de correspondencia, o <strong>PDF</strong> con campos personalizados.</li>
                  <li><strong>SMS</strong> / <strong>WSP</strong>: mensaje de texto / plantilla de WhatsApp (sin adjunto).</li>
                  <li><strong>VOZ</strong>: llamada telefónica que lee un mensaje por texto a voz (sin adjunto).</li>
                </Box>
                <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
                  <strong>Entrega del adjunto</strong> (solo EAU/EAP):
                </Typography>
                <Box component="ul" sx={{ m: 0.5, pl: 2.5 }}>
                  <li><strong>Archivo adjunto en el correo</strong>: el documento viaja pegado al correo.</li>
                  <li><strong>Enlace / botón de descarga</strong>: el correo lleva un enlace para descargarlo (no lo adjunta).</li>
                </Box>
              </Alert>
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
                    <MenuItem value="VOZ">VOZ — Llamada con mensaje de voz</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth disabled={!isAttachment}>
                  <InputLabel>Entrega del adjunto</InputLabel>
                  <Select
                    value={isAttachment ? formData.attachmentType : 'NONE'}
                    label="Entrega del adjunto"
                    onChange={(e) => handleInputChange('attachmentType', e.target.value)}
                  >
                    <MenuItem value="NONE">Sin adjunto</MenuItem>
                    <MenuItem value="ONFILE">Archivo adjunto en el correo</MenuItem>
                    <MenuItem value="ONLINE">Enlace / botón de descarga</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              {/* Solo EAP: tipo de documento (combinación Word vs campos en PDF). Cada uno
                  tiene distinto flujo/costo y una lambda distinta que arma el archivo. */}
              {isEap && !editingId && (
                <FormControl fullWidth>
                  <InputLabel>Tipo de documento (EAP)</InputLabel>
                  <Select
                    value={formData.documentFormat}
                    label="Tipo de documento (EAP)"
                    onChange={(e) => handleInputChange('documentFormat', e.target.value)}
                  >
                    <MenuItem value="DOCX">Word (.docx) — combinación de correspondencia</MenuItem>
                    <MenuItem value="PDF">PDF — personalización de campos</MenuItem>
                  </Select>
                </FormControl>
              )}
              {isEap && editingId && (
                <Alert severity="info">
                  Tipo de documento EAP: <strong>{formData.documentFormat === 'PDF' ? 'PDF (campos personalizados)' : 'Word (.docx) combinación'}</strong>.
                  El documento se define al crear la campaña; para cambiarlo, crea una nueva.
                </Alert>
              )}

              {/* Documento adjunto (solo EAU/EAP). El backend exige el adjunto para estos canales. */}
              {isAttachment && !editingId && (
                <Box sx={{ p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                    <Button
                      variant="outlined"
                      component="label"
                      startIcon={attachmentUploading ? <CircularProgress size={16} /> : <UploadFileIcon />}
                      disabled={attachmentUploading}
                    >
                      {attachmentName ? 'Cambiar documento' : (isEapPdf ? 'Subir PDF plantilla' : 'Subir documento adjunto')}
                      <input hidden type="file" accept={attachmentAccept} onChange={handleUploadAttachment} />
                    </Button>
                    {attachmentName ? (
                      <Chip color="success" label={attachmentName} onDelete={resetAttachment} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {isEapPdf
                          ? 'Sube el PDF plantilla con los campos a personalizar por destinatario.'
                          : isEap
                            ? 'Sube el .docx de combinación (adjunto personalizado por destinatario).'
                            : 'Sube el documento que se adjuntará a todos (PDF/Word).'}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              )}
              {isAttachment && editingId && (
                <Alert severity="info">El documento adjunto se define al crear la campaña; para cambiarlo, crea una nueva.</Alert>
              )}

              {isSms ? (
                <>
                  <FormControl fullWidth>
                    <InputLabel>Plantilla SMS</InputLabel>
                    <Select
                      value={currentMsgTemplateId}
                      label="Plantilla SMS"
                      onChange={(e) => selectMsgTemplate(e.target.value)}
                    >
                      {smsTemplates.length === 0 && (
                        <MenuItem value="" disabled>No hay plantillas SMS; créalas en "Plantillas SMS"</MenuItem>
                      )}
                      {smsTemplates.map((t) => (
                        <MenuItem key={t.messageTemplateId} value={t.messageTemplateId}>{t.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {formData.template && (
                    <TextField
                      fullWidth
                      multiline
                      minRows={3}
                      label="Texto de la plantilla (solo lectura)"
                      value={formData.template}
                      InputProps={{ readOnly: true }}
                      helperText={`~${Math.max(1, Math.ceil(formData.template.length / 160))} segmento(s). En SMS la columna 2 del CSV es el celular (E.164, +57…). Edita el texto en "Plantillas SMS".`}
                    />
                  )}
                </>
              ) : isWsp ? (
                <>
                  <FormControl fullWidth>
                    <InputLabel>Plantilla WhatsApp</InputLabel>
                    <Select
                      value={currentMsgTemplateId}
                      label="Plantilla WhatsApp"
                      onChange={(e) => selectMsgTemplate(e.target.value)}
                    >
                      {wspTemplates.length === 0 && (
                        <MenuItem value="" disabled>No hay plantillas WhatsApp; créalas en "Plantillas WhatsApp"</MenuItem>
                      )}
                      {wspTemplates.map((t) => (
                        <MenuItem key={t.messageTemplateId} value={t.messageTemplateId}>{t.name} · {t.hsmName}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {formData.template && (
                    <TextField
                      fullWidth
                      label="Plantilla HSM seleccionada (solo lectura)"
                      value={formData.template}
                      InputProps={{ readOnly: true }}
                      helperText="Nombre de la plantilla de Meta. Los parámetros {{1}}, {{2}}… salen de las columnas del CSV desde 'Nombre'. La columna 2 es el celular (E.164, +57…)."
                    />
                  )}
                </>
              ) : isVoice ? (
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label="Mensaje de voz (se lee por teléfono)"
                  value={formData.template}
                  onChange={(e) => handleInputChange('template', e.target.value)}
                  placeholder="Hola {{Nombre}}, le recordamos que…"
                  helperText="Texto que se convierte a voz (TTS) y se reproduce en la llamada. Admite variables {{columna}} del CSV. En Voz la columna 2 del CSV es el celular (E.164, +57…)."
                />
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
