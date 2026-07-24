import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, Grid, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import { useFeedback } from '../../hooks/useFeedback';
import { isOk } from '../../services/apiClient';
import { getUser } from '../../services/authService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { pdfEngineService } from '../../services/pdfEngineService';
import { base64ToPdfBlob } from '../../services/pdfTemplatesService';
import { databaseService } from '../../services/databaseService';
import { campaignsService } from '../../services/campaignsService';
import SketchEditor from '../../pdfsketch/SketchEditor';
import { useDocumentStore, emptyDocument } from '../../pdfsketch/store/documentStore';
import { useDataSourceStore, type SketchDataSource } from '../../pdfsketch/store/dataSourceStore';
import { toEnvelope, serializeToJson, deserializeFromJson } from '../../pdfsketch/json/documentJson';

/**
 * ESTUDIO PDF (nivel MEDIO de plantillas PDF) — editor de lienzo pdfsketch.
 *
 * Igual que el Diseñador PDF (nivel full): la sección es un LANZADOR con las
 * plantillas guardadas (messageTemplate channel=PDF, campo `sketchJson`), y el
 * editor abre a PANTALLA COMPLETA (overlay) para tener todo el espacio, con una
 * barra MailConnect arriba: Guardar · Vista previa PDF (motor estándar) · Cerrar.
 *
 * Chunk lazy: el portal no paga el peso de Konva hasta abrir este tab.
 */
export default function SketchStudio() {
  const { notify, FeedbackSnackbar } = useFeedback();
  const user = getUser();
  const customerId = user?.customerId ?? '';
  const sessionCustomer = user?.customer ?? '';
  const sessionNit = user?.nit ?? '';

  // Subida de imágenes a S3 (bucket del cliente, prefijo público `resources/`) → URL
  // pública que el motor de PDF puede descargar. Se inyecta al editor (uploadStore).
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    if (!sessionCustomer) {
      notify('Tu sesión no tiene un cliente asociado para subir imágenes.', 'warning');
      return null;
    }
    const presign = await campaignsService.presignUrl({
      customer: sessionCustomer,
      nit: sessionNit,
      documentName: file.name,
      documentType: 'resources',
    });
    if (!isOk(presign) || !presign.data?.url) {
      notify(presign.description || 'No se pudo obtener la URL de carga de la imagen.', 'error');
      return null;
    }
    const ok = await campaignsService.uploadToS3(presign.data.url, file);
    if (!ok) {
      notify('No se pudo subir la imagen a S3.', 'error');
      return null;
    }
    return campaignsService.publicUrl(sessionNit, presign.data.path ?? '');
  }, [sessionCustomer, sessionNit, notify]);

  const setDoc = useDocumentStore((s) => s.setDoc);
  const markSaved = useDocumentStore((s) => s.markSaved);

  // Import de JSON (archivo local) — el input está oculto y lo dispara el botón.
  const importInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Bases de datos del cliente (fuente de variables {{campo}} en el editor).
  const [databases, setDatabases] = useState<SketchDataSource[]>([]);

  const loadDatabases = useCallback(async () => {
    useDataSourceStore.getState().setLoading(true);
    try {
      const res = await databaseService.list(customerId, user?.customer);
      const files = res.data?.files ?? [];
      setDatabases(
        files.map((f) => ({
          id: f.databaseFileId,
          name: f.fileName,
          columns: f.columns ?? [],
          previewRows: f.previewRows,
        })),
      );
    } finally {
      useDataSourceStore.getState().setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // Edición en curso (overlay full-screen)
  const [editorOpen, setEditorOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>('');

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [rendering, setRendering] = useState(false);

  const refreshList = async () => {
    setLoadingList(true);
    try {
      const res = await messageTemplatesService.list(customerId, 'PDF');
      const all = res.data?.templates ?? [];
      // Solo las de este editor (tienen sketchJson); las HTML/full van en sus tabs.
      setTemplates(all.filter((t) => (t.sketchJson ?? '').toString().trim() !== ''));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void refreshList();
    void loadDatabases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // Permite al panel de Datos del editor recargar las bases (botón refrescar).
  useEffect(() => {
    useDataSourceStore.getState().setReload(() => { void loadDatabases(); });
    return () => useDataSourceStore.getState().setReload(null);
  }, [loadDatabases]);

  const openNew = () => {
    setDoc(emptyDocument());
    setTemplateId('');
    setSaveName('');
    setEditorOpen(true);
  };

  // ── Importar un diseño desde un archivo .json (envelope pdfsketch@1 o
  //    DocumentModel pelado). Abre el editor con el documento cargado; queda
  //    como diseño NUEVO (sin messageTemplateId) hasta que se guarde. ──
  const importFromFile = () => importInputRef.current?.click();

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reimportar el mismo archivo
    if (!file) return;
    // Si ya hay un diseño con cambios sin guardar, confirmar antes de reemplazarlo.
    if (editorOpen && useDocumentStore.getState().dirty
      && !window.confirm('Hay cambios sin guardar. ¿Reemplazar el diseño actual con el archivo importado?')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const doc = deserializeFromJson(String(ev.target?.result ?? ''));
        setDoc(doc);
        setTemplateId('');
        setSaveName(doc.name && doc.name !== 'Untitled' ? doc.name : file.name.replace(/\.json$/i, ''));
        setEditorOpen(true);
        notify('Diseño importado. Revísalo y guárdalo para conservarlo.', 'success');
      } catch (err) {
        notify(err instanceof Error ? err.message : 'No se pudo importar el JSON.', 'error');
      }
    };
    reader.onerror = () => notify('No se pudo leer el archivo.', 'error');
    reader.readAsText(file);
  };

  // ── Exportar el documento en edición a un archivo .json descargable. ──
  const exportToFile = () => {
    const doc = useDocumentStore.getState().doc;
    const json = serializeToJson({ ...doc, name: saveName || doc.name });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${saveName || doc.name || 'documento'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openEdit = (t: MessageTemplate) => {
    try {
      const loaded = deserializeFromJson(t.sketchJson ?? '');
      setDoc(loaded);
      setTemplateId(t.messageTemplateId);
      setSaveName(t.name);
      setEditorOpen(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'La plantilla guardada no es válida.', 'error');
    }
  };

  const handleDelete = async (t: MessageTemplate) => {
    if (!window.confirm(`¿Eliminar la plantilla "${t.name}"?`)) return;
    const res = await messageTemplatesService.delete(t.messageTemplateId);
    if (isOk(res)) {
      notify('Plantilla eliminada.', 'success');
      void refreshList();
    } else {
      notify(res.description || 'No se pudo eliminar.', 'error');
    }
  };

  const handleClose = () => {
    if (useDocumentStore.getState().dirty
      && !window.confirm('Hay cambios sin guardar. ¿Cerrar de todos modos?')) {
      return;
    }
    setEditorOpen(false);
    void refreshList();
  };

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const doc = useDocumentStore.getState().doc;
      const res = await messageTemplatesService.create({
        customerId,
        channel: 'PDF',
        name,
        sketchJson: toEnvelope({ ...doc, name }) as unknown as Record<string, unknown>,
        ...(templateId ? { messageTemplateId: templateId } : {}),
      });
      if (isOk(res) && res.data?.messageTemplateId) {
        setTemplateId(res.data.messageTemplateId);
        markSaved();
        notify(templateId ? 'Plantilla actualizada.' : 'Plantilla guardada.', 'success');
        setSaveOpen(false);
      } else {
        notify(res.description || 'No se pudo guardar la plantilla.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setRendering(true);
    try {
      const doc = useDocumentStore.getState().doc;
      const res = await pdfEngineService.render({
        sketch: toEnvelope(doc) as unknown as Record<string, unknown>,
        filename: `${saveName || doc.name || 'documento'}.pdf`,
      });
      if (isOk(res) && res.data?.pdfBase64) {
        const blob = base64ToPdfBlob(res.data.pdfBase64);
        setPreviewWarnings(res.data.warnings ?? []);
        setPreviewUrl(URL.createObjectURL(blob));
      } else if (res.statusCode === 404 || res.statusCode === 403 || res.statusCode === 0) {
        // El motor del Estudio PDF usa /Template/Render-engine (ReportLab), que es
        // DISTINTO de /Template/Render-pdf (xhtml2pdf, editor tipo Word). Si aún no
        // está desplegado, el mensaje lo deja claro (es un pendiente de despliegue).
        notify('La vista previa usa el motor /Template/Render-engine, que aún no está disponible. Pídele a tu administrador que despliegue esa ruta (es distinta de /Template/Render-pdf).', 'error');
      } else {
        notify(res.description || 'No se pudo generar el PDF.', 'error');
      }
    } finally {
      setRendering(false);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewWarnings([]);
  };

  return (
    <Box>
      {/* ── Lanzador: plantillas guardadas ── */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Estudio PDF</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={() => void refreshList()} title="Refrescar">
          <RefreshIcon fontSize="small" />
        </IconButton>
        <Button size="small" variant="outlined" startIcon={<FileUploadIcon />} onClick={importFromFile}>
          Importar JSON
        </Button>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openNew}>
          Nuevo diseño
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Editor de lienzo con formas, texto, imágenes, tablas, QR y campos de datos
        «{'{{campo}}'}». El editor abre a pantalla completa; guarda para que la plantilla
        quede disponible en tus campañas.
      </Alert>

      {templates.length === 0 && !loadingList ? (
        <Typography variant="body2" color="text.secondary">
          No hay diseños del Estudio PDF guardados todavía. Crea el primero con «Nuevo diseño».
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {templates.map((t) => (
            <Grid key={t.messageTemplateId} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card variant="outlined">
                <CardActionArea onClick={() => openEdit(t)}>
                  <CardContent>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <FolderOpenIcon fontSize="small" color="action" />
                      <Typography sx={{ fontWeight: 600 }} noWrap>{t.name}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t.created ?? ''}
                    </Typography>
                  </CardContent>
                </CardActionArea>
                <Stack direction="row" justifyContent="flex-end" sx={{ px: 1, pb: 1 }}>
                  <IconButton size="small" onClick={() => void handleDelete(t)} title="Eliminar">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* ── Editor a PANTALLA COMPLETA (overlay, como el Diseñador PDF) ── */}
      {editorOpen && (
        <Box sx={{
          position: 'fixed', inset: 0, zIndex: 1300,
          display: 'flex', flexDirection: 'column',
          bgcolor: 'background.default',
        }}>
          {/* Barra MailConnect */}
          <Stack direction="row" spacing={1} alignItems="center"
            sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Estudio PDF</Typography>
            {saveName && <Chip size="small" variant="outlined" label={saveName} />}
            {templateId && <Chip size="small" color="info" variant="outlined" label="guardada" />}
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Cargar un diseño desde un archivo .json (reemplaza el actual)">
              <span>
                <Button size="small" variant="text" startIcon={<FileUploadIcon />}
                  onClick={importFromFile}>
                  Importar
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Descargar el diseño actual como archivo .json">
              <span>
                <Button size="small" variant="text" startIcon={<FileDownloadIcon />}
                  onClick={exportToFile}>
                  Exportar
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Genera el PDF real con el motor del backend">
              <span>
                <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />}
                  onClick={() => void handlePreview()} disabled={rendering}>
                  {rendering ? 'Generando…' : 'Vista previa PDF'}
                </Button>
              </span>
            </Tooltip>
            <Button size="small" variant="contained" startIcon={<SaveIcon />}
              onClick={() => setSaveOpen(true)}>
              Guardar
            </Button>
            <IconButton size="small" onClick={handleClose} title="Cerrar el editor">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          {/* Editor pdfsketch (ocupa el resto de la pantalla) */}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <SketchEditor databases={databases} uploadImage={uploadImage} />
          </Box>
        </Box>
      )}

      {/* Guardar — por encima del overlay */}
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="xs" fullWidth
        sx={{ zIndex: 1400 }}>
        <DialogTitle>{templateId ? 'Actualizar plantilla' : 'Guardar plantilla'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth size="small" sx={{ mt: 1 }} label="Nombre de la plantilla"
            value={saveName} onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }} />
          {templateId && (
            <Button size="small" sx={{ mt: 1 }} onClick={() => setTemplateId('')}>
              Guardar como una plantilla NUEVA en su lugar
            </Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={() => void handleSave()}
            disabled={saving || !saveName.trim()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Vista previa PDF — por encima del overlay */}
      <Dialog open={!!previewUrl} onClose={closePreview} maxWidth="md" fullWidth
        sx={{ zIndex: 1400 }}>
        <DialogTitle>Vista previa PDF</DialogTitle>
        <DialogContent>
          {previewWarnings.length > 0 && (
            <Box sx={{ mb: 1 }}>
              {previewWarnings.map((w) => (
                <Typography key={w} variant="caption" color="warning.main" display="block">⚠️ {w}</Typography>
              ))}
            </Box>
          )}
          <Box component="iframe" src={previewUrl} title="Vista previa PDF"
            sx={{ width: '100%', height: '70vh', border: 0 }} />
        </DialogContent>
        <DialogActions>
          <Button component="a" href={previewUrl} download={`${saveName || 'documento'}.pdf`}>
            Descargar
          </Button>
          <Button onClick={closePreview}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Input oculto para importar JSON (lo disparan los botones «Importar») */}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {FeedbackSnackbar}
    </Box>
  );
}
