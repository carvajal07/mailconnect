import { useState, useEffect, useCallback } from 'react';
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
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import SmsIcon from '@mui/icons-material/Sms';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { getUser } from '../../services/authService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

/**
 * Sección de plantillas de mensaje para SMS y WhatsApp (WSP). Un mismo componente
 * parametrizado por canal:
 *  - SMS: nombre + texto con {{variables}} (contador de segmentos).
 *  - WSP: nombre + plantilla HSM (Meta) + idioma + etiquetas de parámetros {{1}},{{2}}…
 */
export const MessageTemplatesSection = ({ channel }: { channel: 'SMS' | 'WSP' }) => {
  const isSms = channel === 'SMS';
  const user = getUser();
  const customerId = user?.customerId ?? '';
  const customer = user?.customer ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Campos del formulario.
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [hsmName, setHsmName] = useState('');
  const [language, setLanguage] = useState('es');
  const [paramsText, setParamsText] = useState('');

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const res = await messageTemplatesService.list(customerId, channel);
    setLoading(false);
    if (isOk(res) && res.data?.templates) setTemplates(res.data.templates);
  }, [customerId, channel]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setName('');
    setBody('');
    setHsmName('');
    setLanguage('es');
    setParamsText('');
  };

  const handleCreate = async () => {
    if (!customerId) return notify('Tu sesión no tiene cliente asociado. Vuelve a iniciar sesión.', 'warning');
    if (!name.trim()) return notify('Indica el nombre de la plantilla.', 'warning');
    if (isSms && !body.trim()) return notify('Escribe el texto del SMS.', 'warning');
    if (!isSms && !hsmName.trim()) return notify('Indica el nombre de la plantilla HSM de WhatsApp.', 'warning');

    const params = paramsText.split(',').map((p) => p.trim()).filter(Boolean);
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
    });
    setSaving(false);
    if (isOk(res)) {
      notify('Plantilla guardada correctamente.', 'success');
      resetForm();
      load();
    } else {
      notify(res.description || 'No se pudo guardar la plantilla.', 'error');
    }
  };

  const handleDelete = async (t: MessageTemplate) => {
    if (!window.confirm(`¿Eliminar la plantilla "${t.name}"?`)) return;
    setDeletingId(t.messageTemplateId);
    const res = await messageTemplatesService.delete(t.messageTemplateId);
    setDeletingId(null);
    if (isOk(res)) {
      setTemplates((prev) => prev.filter((x) => x.messageTemplateId !== t.messageTemplateId));
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
          ? 'Guarda textos reutilizables para tus campañas de SMS. Usa {{Columna}} para personalizar con la base.'
          : 'Registra tus plantillas de WhatsApp (HSM) aprobadas por Meta para reutilizarlas en campañas. Los parámetros {{1}}, {{2}}… se toman de las columnas del CSV.'}
      </Typography>

      {!isSms && (
        <Alert severity="info" sx={{ mb: 2 }}>
          WhatsApp de marketing exige una <strong>plantilla pre-aprobada por Meta</strong>. Aquí solo
          guardas su <strong>nombre</strong>, idioma y las etiquetas de los parámetros para mapear el CSV;
          el contenido real vive en Meta.
        </Alert>
      )}

      {/* Formulario de creación */}
      <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Nueva plantilla
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nombre de la plantilla" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />

          {isSms ? (
            <TextField
              label="Texto del SMS"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              placeholder="Hola {{Nombre}}, tu mensaje aquí…"
              helperText={`${body.length} caracteres · ~${segments} segmento(s). Admite variables {{Columna}}.`}
            />
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
              <TextField
                label="Parámetros del cuerpo (separados por coma)"
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
                size="small"
                fullWidth
                placeholder="Nombre, Empresa, Valor"
                helperText="Etiquetas para {{1}}, {{2}}… en orden. Se toman de las columnas del CSV desde 'Nombre'."
              />
            </>
          )}

          <Box>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
              onClick={handleCreate}
              disabled={saving}
            >
              Guardar plantilla
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
              <TableRow key={t.messageTemplateId} hover>
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
    </Box>
  );
};
