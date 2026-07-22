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
  ListSubheader,
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
import DeleteIcon from '@mui/icons-material/Delete';
import StorageIcon from '@mui/icons-material/Storage';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import type { CampaignSummary } from '../../services/campaignsService';
import { readPdfDrafts } from '../../services/pdfTemplatesService';
import { templatesService } from '../../services/templatesService';
import type { TemplateSummary } from '../../services/templatesService';
import { domainsService, senderKindOf } from '../../services/domainsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { usePortalData } from '../../context/PortalDataContext';
import { formatDateTime } from '../../utils/datetime';

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

/** Dominio de la plataforma (remitente por defecto, siempre disponible). */
export const PLATFORM_DOMAIN = 'mailconnect.com.co';
/** Nombre de correo por defecto del remitente. */
export const DEFAULT_MAILBOX = 'notificaciones';
/** Remitente por defecto de las campañas ({mailbox}@{dominio}). El nombre y el dominio se
 *  eligen por separado en el formulario; el dominio puede ser uno propio del cliente
 *  (verificado en la pestaña Dominios) o el de la plataforma. */
export const DEFAULT_FROM = `${DEFAULT_MAILBOX}@${PLATFORM_DOMAIN}`;

const emptyForm = (from = DEFAULT_FROM): CampaignForm => ({
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

/** Estado de aprobación (maker-checker): chip complementario al estado de la campaña. */
const APPROVAL_META: Record<string, { label: string; color: 'info' | 'warning' | 'success' | 'error' }> = {
  pending: { label: 'En aprobación', color: 'warning' },
  approved: { label: 'Aprobada', color: 'success' },
  rejected: { label: 'Rechazada', color: 'error' },
};

export const CampanasSection = () => {
  // El cliente (empresa) se toma de la sesión, no se captura en formularios.
  const customer = getUser()?.customer ?? '';
  const customerId = getUser()?.customerId ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Campañas, bases y plantillas de mensaje precargadas al entrar al portal (contexto compartido).
  const { campaigns: campaignsCtx, databases, messageTemplates: msgTemplatesCtx, refreshCampaigns, refreshStats } = usePortalData();
  const campanas = campaignsCtx.items;
  const loadingList = campaignsCtx.loading;
  // Plantillas SMS/WSP: se toman del contexto (ya precargadas), no se re-piden al abrir el diálogo.
  const msgTemplates = msgTemplatesCtx.items;

  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = crear, id = editar
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<CampaignForm>(emptyForm());

  // Plantillas SES del cliente (para el selector del formulario).
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  // Evita re-pedir las plantillas SES cada vez que se abre el diálogo (se cargan una vez).
  const templatesLoadedRef = useRef(false);
  // Remitentes VERIFICADOS del cliente (para el selector del remitente). El dominio de la
  // plataforma va siempre; los propios del cliente se cargan al abrir. Se separan por tipo:
  // dominios (habilitan cualquier {nombre}@dominio) y correos (dirección exacta y completa).
  const [senderDomains, setSenderDomains] = useState<string[]>([]);
  const [senderEmails, setSenderEmails] = useState<string[]>([]);
  const domainsLoadedRef = useRef(false);

  // Documento adjunto (solo EAU/EAP): se sube a S3 y se pasa su ruta a la campaña.
  const [attachmentPath, setAttachmentPath] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  // EAP-PDF: nombre de la plantilla del editor (mc_pdf_drafts) elegida como adjunto.
  const [pdfTemplateName, setPdfTemplateName] = useState('');

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

  // Dominios de envío del cliente: solo los VERIFICADOS se pueden elegir como remitente.
  // Se cargan una vez al abrir el diálogo (como las plantillas).
  const loadDomains = useCallback(async () => {
    if (domainsLoadedRef.current) return;
    domainsLoadedRef.current = true;
    const res = await domainsService.list();
    if (isOk(res) && res.data?.domains) {
      const verified = res.data.domains.filter((d) => d.status === 'verified');
      setSenderDomains(verified.filter((d) => senderKindOf(d) === 'domain').map((d) => d.domain));
      setSenderEmails(verified.filter((d) => senderKindOf(d) === 'email').map((d) => d.domain));
    }
  }, []);

  const resetAttachment = () => {
    setAttachmentPath('');
    setAttachmentName('');
    setPdfTemplateName('');
  };

  const handleOpenDialog = () => {
    setEditingId(null);
    setFormData(emptyForm());
    resetAttachment();
    setOpenDialog(true);
    loadTemplates();
    loadDomains();
  };

  /** Abre el diálogo precargado con los datos de una campaña para editarla. */
  const handleEdit = (c: CampaignSummary) => {
    setEditingId(c.campaignId);
    setFormData({
      campaignName: c.campaignName ?? '',
      channelName: c.channel ?? 'EM',
      attachmentType: 'NONE',
      template: c.template ?? '',
      from: c.originEmail ?? DEFAULT_FROM,
      dataPath: c.dataPath ?? '',
      documentFormat: (c.documentFormat as EapDocFormat) ?? 'DOCX',
    });
    resetAttachment();
    setOpenDialog(true);
    loadTemplates();
    loadDomains();
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingId(null);
  };

  /** Elimina una campaña (con confirmación). Verifica el tenant en el backend. */
  const handleDelete = async (c: CampaignSummary) => {
    const ok = await confirm({
      title: 'Eliminar campaña',
      message: `¿Eliminar la campaña "${c.campaignName}"? Se quita del listado. No borra el CSV de la base ni el historial de envíos. Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeletingId(c.campaignId);
    const res = await campaignsService.delete(c.campaignId);
    setDeletingId(null);
    if (isOk(res)) {
      notify('Campaña eliminada.', 'success');
      refreshCampaigns();
      refreshStats();
    } else {
      notify(res.description || 'No se pudo eliminar la campaña.', 'error');
    }
  };

  const isSms = formData.channelName === 'SMS';
  const isWsp = formData.channelName === 'WSP';
  const isVoice = formData.channelName === 'VOZ';
  const isEap = formData.channelName === 'EAP';
  // Solo EAU/EAP llevan documento adjunto (el resto no).
  const isAttachment = formData.channelName === 'EAU' || formData.channelName === 'EAP';
  // EAP con PDF usa una plantilla del editor (no archivo); EAP-DOCX acepta Word, EAU ofimáticos.
  const isEapPdf = isEap && formData.documentFormat === 'PDF';
  const attachmentAccept = isEap ? '.docx,.doc' : '.pdf,.docx,.doc,.xlsx';
  // Plantillas disponibles por canal (SMS/WSP se eligen de estas; sin texto libre).
  const smsTemplates = msgTemplates.filter((t) => t.channel === 'SMS');
  const wspTemplates = msgTemplates.filter((t) => t.channel === 'WSP');
  const pdfTemplates = msgTemplates.filter((t) => t.channel === 'PDF');
  // EAP-PDF: opciones del selector = plantillas del backend (c:{id}) + borradores locales
  // que aún no están en el backend (l:{name}), como respaldo.
  const pdfTemplateChoices = [
    ...pdfTemplates.map((t) => ({ key: `c:${t.messageTemplateId}`, label: t.name })),
    ...Object.keys(readPdfDrafts())
      .filter((n) => !pdfTemplates.some((t) => t.name === n))
      .map((n) => ({ key: `l:${n}`, label: `${n} (local)` })),
  ];

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
    // Adjunto de campaña EAU/EAP → prefijo público `attachment/`.
    const presign = await campaignsService.presignUrl({ customer, nit: getUser()?.nit ?? '', documentName: file.name, documentType: 'attachment' });
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

  /**
   * EAP-PDF: elige una plantilla PDF (del BACKEND `messageTemplate` canal PDF, o un borrador
   * local de respaldo) y sube su HTML a S3 como el adjunto de la campaña. El combinador
   * EAP-PDF baja ese HTML y renderiza un PDF por destinatario. Reutiliza attachmentPath/Name
   * (y su validación) igual que el .docx. La `key` codifica la fuente: `c:{id}` backend, `l:{name}` local.
   */
  const selectPdfTemplate = async (key: string) => {
    setPdfTemplateName(key);
    if (!key) { resetAttachment(); setPdfTemplateName(''); return; }
    if (!customer) {
      notify('Tu sesión no tiene una empresa asociada. Vuelve a iniciar sesión.', 'warning');
      return;
    }
    let html = '';
    let label = 'plantilla';
    if (key.startsWith('c:')) {
      const tpl = msgTemplates.find((t) => t.messageTemplateId === key.slice(2));
      html = tpl?.html ?? '';
      label = tpl?.name ?? 'plantilla';
    } else if (key.startsWith('l:')) {
      label = key.slice(2);
      html = readPdfDrafts()[label] ?? '';
    }
    if (!html) { notify('No se encontró la plantilla PDF seleccionada.', 'error'); return; }
    setAttachmentUploading(true);
    const safe = label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'plantilla';
    const fileName = `plantilla-pdf-${safe}-${Date.now()}.html`;
    const file = new File([html], fileName, { type: 'text/html' });
    const presign = await campaignsService.presignUrl({ customer, nit: getUser()?.nit ?? '', documentName: fileName, documentType: 'attachment' });
    if (!isOk(presign) || !presign.data?.url || !presign.data?.path) {
      setAttachmentUploading(false);
      setPdfTemplateName('');
      return notify(presign.description || 'No se pudo crear la URL para la plantilla PDF.', 'error');
    }
    const ok = await campaignsService.uploadToS3(presign.data.url, file);
    setAttachmentUploading(false);
    if (ok) {
      setAttachmentPath(presign.data.path);
      setAttachmentName(`${label} (plantilla PDF)`);
      notify('Plantilla PDF lista para la campaña.', 'success');
    } else {
      setPdfTemplateName('');
      notify('No se pudo subir la plantilla PDF a S3.', 'error');
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
      notify(isEapPdf
        ? 'Selecciona una plantilla PDF del editor antes de crear la campaña.'
        : 'Para EAU/EAP debes subir el documento adjunto antes de crear la campaña.', 'warning');
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
              <TableCell>Canal</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Campaña</TableCell>
              <TableCell>Consecutivo</TableCell>
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
              <TableRow key={campana.campaignId} hover>
                <TableCell>
                  <Chip label={campana.channel} size="small" color="primary" variant="outlined" sx={{ fontWeight: 600 }} />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      label={campana.campaignState || '—'}
                      size="small"
                      color={ESTADO_COLOR[campana.campaignState] ?? 'default'}
                    />
                    {/* Estado de aprobación (si la campaña entró al flujo maker-checker). */}
                    {campana.approvalStatus && campana.approvalStatus !== 'none' && APPROVAL_META[campana.approvalStatus] && (
                      <Chip
                        label={APPROVAL_META[campana.approvalStatus].label}
                        size="small"
                        variant="outlined"
                        color={APPROVAL_META[campana.approvalStatus].color}
                      />
                    )}
                  </Stack>
                </TableCell>
                <TableCell><Typography fontWeight={600}>{campana.campaignName}</Typography></TableCell>
                <TableCell>{campana.consecutive ?? '—'}</TableCell>
                <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {campana.template || '—'}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(campana.date)}</TableCell>
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
                  <Tooltip title="Eliminar campaña">
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(campana)}
                        disabled={deletingId === campana.campaignId}
                      >
                        {deletingId === campana.campaignId ? <CircularProgress size={18} /> : <DeleteIcon fontSize="small" />}
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

              {/* Documento adjunto (solo EAU/EAP). El backend exige el adjunto para estos canales.
                  EAP-PDF: se elige una plantilla del editor (mc_pdf_drafts) y se sube su HTML.
                  EAU / EAP-DOCX: se sube el archivo (docx/pdf). */}
              {isAttachment && !editingId && isEapPdf && (
                <Box sx={{ p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                  <FormControl fullWidth disabled={attachmentUploading}>
                    <InputLabel>Plantilla PDF (del editor)</InputLabel>
                    <Select
                      value={pdfTemplateName}
                      label="Plantilla PDF (del editor)"
                      onChange={(e) => selectPdfTemplate(e.target.value)}
                    >
                      <MenuItem value=""><em>— Selecciona una plantilla —</em></MenuItem>
                      {pdfTemplateChoices.map((c) => (
                        <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    {attachmentUploading && <CircularProgress size={16} />}
                    {attachmentName ? (
                      <Chip color="success" label={attachmentName} onDelete={resetAttachment} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Diseña y guarda tu plantilla en la pestaña <strong>Plantillas PDF</strong>; aquí se
                        renderiza un PDF por destinatario sustituyendo las variables <code>{'{{campo}}'}</code>.
                      </Typography>
                    )}
                  </Stack>
                </Box>
              )}
              {isAttachment && !editingId && !isEapPdf && (
                <Box sx={{ p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                    <Button
                      variant="outlined"
                      component="label"
                      startIcon={attachmentUploading ? <CircularProgress size={16} /> : <UploadFileIcon />}
                      disabled={attachmentUploading}
                    >
                      {attachmentName ? 'Cambiar documento' : 'Subir documento adjunto'}
                      <input hidden type="file" accept={attachmentAccept} onChange={handleUploadAttachment} />
                    </Button>
                    {attachmentName ? (
                      <Chip color="success" label={attachmentName} onDelete={resetAttachment} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {isEap
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
                  {/* Remitente = un correo verificado completo (dirección fija) o nombre del
                      correo + dominio. El dominio/correo puede ser el de la plataforma o uno
                      propio del cliente (verificado en la pestaña Dominios). */}
                  {(() => {
                    // ¿El remitente actual es uno de los correos verificados completos?
                    const fromIsEmail = senderEmails.includes(formData.from);
                    return (
                      <>
                        <TextField
                          fullWidth
                          label="Nombre del correo"
                          value={formData.from.split('@')[0] || ''}
                          onChange={(e) => {
                            const mailbox = e.target.value.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
                            const domain = formData.from.split('@')[1] || PLATFORM_DOMAIN;
                            handleInputChange('from', `${mailbox}@${domain}`);
                          }}
                          placeholder="comunicaciones"
                          disabled={fromIsEmail}
                          helperText={fromIsEmail
                            ? 'Estás usando un correo verificado completo; la dirección es fija.'
                            : 'Ej.: comunicaciones, avisos, notificaciones'}
                        />
                        <FormControl fullWidth>
                          <InputLabel>Dominio o correo</InputLabel>
                          <Select
                            value={fromIsEmail ? `email:${formData.from}` : (formData.from.split('@')[1] || PLATFORM_DOMAIN)}
                            label="Dominio o correo"
                            onChange={(e) => {
                              const v = String(e.target.value);
                              if (v.startsWith('email:')) {
                                // Correo verificado completo: fija la dirección exacta como remitente.
                                handleInputChange('from', v.slice(6));
                              } else {
                                const mailbox = formData.from.split('@')[0] || DEFAULT_MAILBOX;
                                handleInputChange('from', `${mailbox}@${v}`);
                              }
                            }}
                          >
                            <MenuItem value={PLATFORM_DOMAIN}>{PLATFORM_DOMAIN} (MailConnect)</MenuItem>
                            {senderDomains.map((d) => (
                              <MenuItem key={d} value={d}>{d}</MenuItem>
                            ))}
                            {senderEmails.length > 0 && <ListSubheader>Correos verificados</ListSubheader>}
                            {senderEmails.map((em) => (
                              <MenuItem key={em} value={`email:${em}`}>{em}</MenuItem>
                            ))}
                            {/* Conserva un remitente previo (al editar) que ya no esté en la lista. */}
                            {(() => {
                              const curDomain = formData.from.split('@')[1] || '';
                              const known = curDomain === PLATFORM_DOMAIN || senderDomains.includes(curDomain) || fromIsEmail;
                              return !known && curDomain ? (
                                <MenuItem value={curDomain}>{curDomain} (actual)</MenuItem>
                              ) : null;
                            })()}
                          </Select>
                        </FormControl>
                      </>
                    );
                  })()}
                </Stack>
              )}
              {formData.channelName !== 'SMS' && formData.channelName !== 'WSP' && formData.channelName !== 'VOZ' && senderDomains.length === 0 && senderEmails.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                  ¿Quieres enviar desde tu propio dominio o correo? Configúralo en la pestaña <strong>Dominios</strong>;
                  cuando quede verificado aparecerá aquí.
                </Typography>
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
      {ConfirmDialog}
    </Box>
  );
};
