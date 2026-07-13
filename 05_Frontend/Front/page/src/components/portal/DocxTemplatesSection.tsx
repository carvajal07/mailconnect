import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Chip,
  Tooltip,
  Link,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import DescriptionIcon from '@mui/icons-material/Description';
import { getUser } from '../../services/authService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { campaignsService } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { DatabaseFieldPicker } from './DatabaseFieldPicker';

/**
 * Plantillas DOCX (combinación de correspondencia) para el canal de adjunto
 * personalizado (EAP). El cliente sube un .docx con campos de combinación; se guarda
 * en S3 (documentType=document) y se registra su metadata en `messageTemplate`
 * (channel=DOCX) para reutilizarlo. La combinación real la hace el backend
 * (Template_Combination) al enviar la campaña.
 */
export const DocxTemplatesSection = () => {
  const user = getUser();
  const customerId = user?.customerId ?? '';
  const customer = user?.customer ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  // Campos de combinación: SOLO se agregan desde la base (no texto libre).
  const [params, setParams] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const addParam = (f: string) => setParams((p) => (p.includes(f) ? p : [...p, f]));
  const removeParam = (f: string) => setParams((p) => p.filter((x) => x !== f));

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const res = await messageTemplatesService.list(customerId, 'DOCX');
    setLoading(false);
    if (isOk(res) && res.data?.templates) setTemplates(res.data.templates);
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !name.trim()) setName(f.name.replace(/\.docx$/i, ''));
  };

  const handleUpload = async () => {
    if (!customer) return notify('Tu sesión no tiene empresa asociada. Vuelve a iniciar sesión.', 'warning');
    if (!name.trim()) return notify('Indica el nombre de la plantilla.', 'warning');
    if (!file) return notify('Selecciona un archivo .docx.', 'warning');
    if (!/\.docx$/i.test(file.name)) return notify('El archivo debe ser .docx.', 'warning');

    setUploading(true);
    try {
      // 1) URL prefirmada para el documento.
      const presign = await campaignsService.presignUrl({ customer, nit: getUser()?.nit ?? '', documentName: file.name, documentType: 'document' });
      if (!isOk(presign) || !presign.data?.url || !presign.data?.path) {
        setUploading(false);
        return notify(presign.description || 'No se pudo crear la URL de subida.', 'error');
      }
      // 2) Subida directa a S3.
      const uploaded = await campaignsService.uploadToS3(presign.data.url, file);
      if (!uploaded) {
        setUploading(false);
        return notify('No se pudo subir el archivo a S3.', 'error');
      }
      // 3) Registrar la metadata de la plantilla DOCX.
      const res = await messageTemplatesService.create({
        customerId,
        customer,
        channel: 'DOCX',
        name: name.trim(),
        s3Path: presign.data.path,
        params,
      });
      setUploading(false);
      if (isOk(res)) {
        notify('Plantilla DOCX guardada correctamente.', 'success');
        setName('');
        setParams([]);
        setFile(null);
        load();
      } else {
        notify(res.description || 'Se subió el archivo pero no se pudo registrar la plantilla.', 'error');
      }
    } catch {
      setUploading(false);
      notify('Error inesperado durante la subida.', 'error');
    }
  };

  const handleDelete = async (t: MessageTemplate) => {
    const ok = await confirm({
      title: 'Eliminar plantilla DOCX',
      message: `¿Eliminar la plantilla "${t.name}"? Se quita del listado (el archivo en S3 no se borra).`,
      confirmText: 'Eliminar',
      confirmColor: 'error',
    });
    if (!ok) return;
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

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
        <DescriptionIcon color="primary" />
        <Typography variant="h4">Plantillas DOCX</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Documentos Word para <strong>combinación de correspondencia</strong> (adjunto personalizado, canal EAP).
        Sube un <code>.docx</code> con campos de combinación y reutilízalo en tus campañas.
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        La combinación real (reemplazo de campos por destinatario y generación del PDF/adjunto) la hace
        el backend al enviar la campaña. Aquí guardas el documento base y sus campos.
      </Alert>

      <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Nueva plantilla DOCX
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nombre de la plantilla" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />
          {/* Campos de combinación: SOLO por selección desde la base (no texto libre). */}
          <Box>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Campos de combinación
            </Typography>
            {params.length > 0 ? (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                {params.map((p) => (
                  <Chip key={p} label={p} onDelete={() => removeParam(p)} color="primary" variant="outlined" size="small" />
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Aún no agregas campos. Elígelos de una base abajo (no se escriben a mano).
              </Typography>
            )}
            <DatabaseFieldPicker compact onInsert={addParam} />
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
              {file ? 'Cambiar archivo' : 'Seleccionar .docx'}
              <input hidden type="file" accept=".docx" onChange={pickFile} />
            </Button>
            {file && <Chip label={file.name} onDelete={() => setFile(null)} />}
          </Stack>
          <Box>
            <Button
              variant="contained"
              startIcon={uploading ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
              onClick={handleUpload}
              disabled={uploading}
            >
              Subir y guardar
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={700}>
          Mis plantillas DOCX {loading && <CircularProgress size={16} sx={{ ml: 1 }} />}
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
              <TableCell>Archivo</TableCell>
              <TableCell>Campos</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                  Aún no tienes plantillas DOCX.
                </TableCell>
              </TableRow>
            )}
            {templates.map((t) => (
              <TableRow key={t.messageTemplateId} hover>
                <TableCell><Typography fontWeight={600}>{t.name}</Typography></TableCell>
                <TableCell sx={{ maxWidth: 320 }}>
                  {t.s3Path ? (
                    <Link href={campaignsService.publicUrl(getUser()?.nit ?? '', 'document', t.s3Path)} target="_blank" rel="noopener" underline="hover" sx={{ display: 'inline-block', maxWidth: '100%' }} noWrap>
                      {t.s3Path.split('/').pop()}
                    </Link>
                  ) : '—'}
                </TableCell>
                <TableCell>{t.params && t.params.length ? t.params.join(', ') : '—'}</TableCell>
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
      {ConfirmDialog}
    </Box>
  );
};
