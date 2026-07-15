import { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import SmsIcon from '@mui/icons-material/Sms';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { getUser } from '../../services/authService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { isOk } from '../../services/apiClient';
import { usePortalData } from '../../context/PortalDataContext';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { DatabaseFieldPicker } from './DatabaseFieldPicker';

/**
 * Sección de plantillas de mensaje para SMS y WhatsApp (WSP). Un mismo componente
 * parametrizado por canal:
 *  - SMS: nombre + texto con {{variables}} (contador de segmentos).
 *  - WSP: nombre + plantilla HSM (Meta) + idioma + parámetros {{1}},{{2}}…
 *
 * Los CAMPOS DE COMBINACIÓN (parámetros) NO se escriben a mano: solo se eligen desde una
 * base de datos (DatabaseFieldPicker). Se puede crear y EDITAR (upsert por id).
 */
export const MessageTemplatesSection = ({ channel }: { channel: 'SMS' | 'WSP' }) => {
  const isSms = channel === 'SMS';
  const user = getUser();
  const customerId = user?.customerId ?? '';
  const customer = user?.customer ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();

  // Datos del contexto precargado del portal (Capa 1), filtrados por el canal de esta sección.
  const { messageTemplates: mt, refreshMessageTemplates } = usePortalData();
  const templates = mt.items.filter((t) => t.channel === channel);
  const loading = mt.loading;
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Campos del formulario.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [hsmName, setHsmName] = useState('');
  const [language, setLanguage] = useState('es');
  // Parámetros (campos de combinación): SOLO se agregan desde la base (no texto libre).
  const [params, setParams] = useState<string[]>([]);

  const load = useCallback(() => refreshMessageTemplates(), [refreshMessageTemplates]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setBody('');
    setHsmName('');
    setLanguage('es');
    setParams([]);
  };

  const addParam = (f: string) => setParams((p) => (p.includes(f) ? p : [...p, f]));
  const removeParam = (f: string) => setParams((p) => p.filter((x) => x !== f));

  const handleEdit = (t: MessageTemplate) => {
    setEditingId(t.messageTemplateId);
    setName(t.name ?? '');
    setBody(t.body ?? '');
    setHsmName(t.hsmName ?? '');
    setLanguage(t.language ?? 'es');
    setParams(t.params ?? []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async () => {
    if (!customerId) return notify('Tu sesión no tiene cliente asociado. Vuelve a iniciar sesión.', 'warning');
    if (!name.trim()) return notify('Indica el nombre de la plantilla.', 'warning');
    if (isSms && !body.trim()) return notify('Escribe el texto del SMS.', 'warning');
    if (!isSms && !hsmName.trim()) return notify('Indica el nombre de la plantilla HSM de WhatsApp.', 'warning');

    setSaving(true);
    const res = await messageTemplatesService.create({
      customerId,
      customer,
      channel,
      name: name.trim(),
      body: isSms ? body : undefined,
      hsmName: isSms ? undefined : hsmName.trim(),
      language: isSms ? undefined : language.trim() || 'es',
      params: isSms ? undefined : params,
      messageTemplateId: editingId ?? undefined, // upsert al editar
    });
    setSaving(false);
    if (isOk(res)) {
      notify(editingId ? 'Plantilla actualizada correctamente.' : 'Plantilla guardada correctamente.', 'success');
      resetForm();
      load();
    } else {
      notify(res.description || 'No se pudo guardar la plantilla.', 'error');
    }
  };

  const handleDelete = async (t: MessageTemplate) => {
    const ok = await confirm({
      title: 'Eliminar plantilla',
      message: `¿Eliminar la plantilla "${t.name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeletingId(t.messageTemplateId);
    const res = await messageTemplatesService.delete(t.messageTemplateId);
    setDeletingId(null);
    if (isOk(res)) {
      refreshMessageTemplates();
      if (editingId === t.messageTemplateId) resetForm();
      notify('Plantilla eliminada.', 'success');
    } else {
      notify(res.description || 'No se pudo eliminar.', 'error');
    }
  };

  const segments = Math.max(1, Math.ceil(body.length / 160));

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
        {isSms ? <SmsIcon color="primary" /> : <WhatsAppIcon sx={{ color: '#25D366' }} />}
        <Typography variant="h4">{isSms ? 'Plantillas SMS' : 'Plantillas WhatsApp'}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {isSms
          ? 'Guarda textos reutilizables para tus campañas de SMS. Inserta variables {{Columna}} desde tu base.'
          : 'Registra tus plantillas de WhatsApp (HSM) aprobadas por Meta. Los parámetros {{1}}, {{2}}… se toman de los campos de tu base.'}
      </Typography>

      {!isSms && (
        <Alert severity="info" sx={{ mb: 2 }}>
          WhatsApp de marketing exige una <strong>plantilla pre-aprobada por Meta</strong>. Aquí solo
          guardas su <strong>nombre</strong>, idioma y el mapeo de parámetros; el contenido real vive en Meta.
        </Alert>
      )}

      {/* Formulario de creación / edición */}
      <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            {editingId ? 'Editar plantilla' : 'Nueva plantilla'}
          </Typography>
          {editingId && (
            <Button size="small" onClick={resetForm}>Cancelar edición</Button>
          )}
        </Stack>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nombre de la plantilla" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />

          {isSms ? (
            <>
              <TextField
                label="Texto del SMS"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                multiline
                minRows={3}
                fullWidth
                placeholder="Hola {{Nombre}}, tu mensaje aquí…"
                helperText={`${body.length} caracteres · ~${segments} segmento(s). Inserta variables con el selector de la base.`}
              />
              <DatabaseFieldPicker compact onInsert={(f) => setBody((b) => `${b}{{${f}}}`)} />
            </>
          ) : (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Nombre HSM (Meta)"
                  value={hsmName}
                  onChange={(e) => setHsmName(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder="nombre_de_la_plantilla_aprobada"
                />
                <TextField
                  label="Idioma"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  size="small"
                  sx={{ width: { sm: 160 } }}
                  placeholder="es"
                />
              </Stack>
              {/* Parámetros SOLO por selección desde la base (no texto libre). */}
              <ParamsSelector params={params} onAdd={addParam} onRemove={removeParam} />
            </>
          )}

          <Box>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : (editingId ? <EditIcon /> : <AddIcon />)}
              onClick={handleSave}
              disabled={saving}
            >
              {editingId ? 'Guardar cambios' : 'Guardar plantilla'}
            </Button>
          </Box>
        </Stack>
      </Paper>

      {/* Listado */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={700}>
          Mis plantillas {loading && <CircularProgress size={16} sx={{ ml: 1 }} />}
        </Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refrescar
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell>
              <TableCell>{isSms ? 'Texto' : 'HSM · idioma'}</TableCell>
              <TableCell>{isSms ? 'Segmentos' : 'Parámetros'}</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                  Aún no tienes plantillas de {isSms ? 'SMS' : 'WhatsApp'}.
                </TableCell>
              </TableRow>
            )}
            {templates.map((t) => (
              <TableRow key={t.messageTemplateId} hover selected={editingId === t.messageTemplateId}>
                <TableCell><Typography fontWeight={600}>{t.name}</Typography></TableCell>
                <TableCell sx={{ maxWidth: 360 }}>
                  {isSms ? (
                    <Typography variant="body2" color="text.secondary" noWrap title={t.body}>{t.body}</Typography>
                  ) : (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip size="small" label={t.hsmName} variant="outlined" />
                      <Chip size="small" label={t.language || 'es'} />
                    </Stack>
                  )}
                </TableCell>
                <TableCell>
                  {isSms
                    ? `~${Math.max(1, Math.ceil((t.body?.length ?? 0) / 160))}`
                    : (t.params && t.params.length ? t.params.join(', ') : '—')}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Editar">
                    <IconButton color="primary" size="small" onClick={() => handleEdit(t)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Eliminar">
                    <span>
                      <IconButton color="error" size="small" onClick={() => handleDelete(t)} disabled={deletingId === t.messageTemplateId}>
                        {deletingId === t.messageTemplateId ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {FeedbackSnackbar}
      {ConfirmDialog}
    </Box>
  );
};

/** Parámetros de combinación: chips (removibles) que SOLO se agregan desde la base. */
const ParamsSelector = ({ params, onAdd, onRemove }: { params: string[]; onAdd: (f: string) => void; onRemove: (f: string) => void }) => (
  <Box>
    <Typography variant="subtitle2" fontWeight={700} gutterBottom>
      Parámetros del cuerpo (en orden {'{{1}}'}, {'{{2}}'}…)
    </Typography>
    {params.length > 0 ? (
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
        {params.map((p, i) => (
          <Chip key={p} label={`${i + 1}. ${p}`} onDelete={() => onRemove(p)} color="primary" variant="outlined" size="small" />
        ))}
      </Stack>
    ) : (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Aún no agregas parámetros. Elígelos de una base abajo (no se escriben a mano).
      </Typography>
    )}
    <DatabaseFieldPicker compact onInsert={onAdd} />
  </Box>
);
