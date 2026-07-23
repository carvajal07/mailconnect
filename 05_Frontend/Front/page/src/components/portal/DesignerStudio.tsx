import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Dialog, DialogActions,
  DialogContent, DialogTitle, Grid, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useFeedback } from '../../hooks/useFeedback';
import { isOk } from '../../services/apiClient';
import { getUser } from '../../services/authService';
import { databaseService } from '../../services/databaseService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { pdfEngineService } from '../../services/pdfEngineService';
import { base64ToPdfBlob } from '../../services/pdfTemplatesService';
// El editor es JSX (copiado de workflow-doc-studio); allowJs está activo en tsconfig.
import DocumentDesignerEditor from '../../designer/DocumentDesigner/editor/DocumentDesignerEditor.jsx';
import '../../designer/tokens.css';

type TemplateJson = Record<string, unknown> | null;

interface DesignerField {
  path: string;
  name: string;
}

/**
 * DISEÑADOR PDF (nivel FULL de plantillas PDF) — el DocumentDesigner de
 * workflow-doc-studio montado en el portal:
 *   - Lanzador: lista las plantillas guardadas (messageTemplate channel=PDF,
 *     campo `templateJson`) + "Nuevo diseño".
 *   - El editor abre como overlay full-screen (su propio diseño); Guardar
 *     persiste el templateJson en el backend; el botón "Vista previa PDF"
 *     (headerActions) renderiza con el MOTOR ESTÁNDAR (/Template/Render-engine).
 *   - Las variables {{campo}} se alimentan con las COLUMNAS de las bases de
 *     datos del cliente (mismas variables del envío real).
 *
 * Componente lazy (chunk aparte): el portal no paga el peso del editor.
 */
export default function DesignerStudio() {
  const { notify, FeedbackSnackbar } = useFeedback();
  const user = getUser();
  const customerId = user?.customerId ?? '';

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [fields, setFields] = useState<DesignerField[]>([]);

  // Edición en curso
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>('');
  const [initialTemplate, setInitialTemplate] = useState<TemplateJson>(null);
  const currentTemplateRef = useRef<TemplateJson>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const pendingTemplateRef = useRef<TemplateJson>(null);

  const [previewUrl, setPreviewUrl] = useState('');
  const [rendering, setRendering] = useState(false);

  const refreshList = async () => {
    setLoadingList(true);
    try {
      const res = await messageTemplatesService.list(customerId, 'PDF');
      const all = res.data?.templates ?? [];
      setTemplates(all.filter((t) => (t.templateJson ?? '').toString().trim() !== ''));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void refreshList();
    // Variables: columnas de todas las bases del cliente (deduplicadas).
    void databaseService.list(customerId).then((res) => {
      const cols = new Set<string>();
      (res.data?.files ?? []).forEach((f) => (f.columns ?? []).forEach((c) => cols.add(c)));
      setFields([...cols].map((c) => ({ path: c, name: c })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const openNew = () => {
    setEditingId('');
    setInitialTemplate(null);
    currentTemplateRef.current = null;
    setSaveName('');
    setEditorOpen(true);
  };

  const openEdit = (t: MessageTemplate) => {
    try {
      const parsed = JSON.parse(t.templateJson ?? '') as Record<string, unknown>;
      setEditingId(t.messageTemplateId);
      setInitialTemplate(parsed);
      currentTemplateRef.current = parsed;
      setSaveName(t.name);
      setEditorOpen(true);
    } catch {
      notify('La plantilla guardada no es JSON válido.', 'error');
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

  // onSave del editor → pedir nombre (si es nueva) y persistir.
  const handleEditorSave = (templateJson: TemplateJson) => {
    pendingTemplateRef.current = templateJson;
    setSaveOpen(true);
  };

  const persist = async () => {
    const name = saveName.trim();
    const templateJson = pendingTemplateRef.current ?? currentTemplateRef.current;
    if (!name || !templateJson) return;
    setSaving(true);
    try {
      const res = await messageTemplatesService.create({
        customerId,
        channel: 'PDF',
        name,
        templateJson: templateJson as Record<string, unknown>,
        ...(editingId ? { messageTemplateId: editingId } : {}),
      });
      if (isOk(res) && res.data?.messageTemplateId) {
        setEditingId(res.data.messageTemplateId);
        notify('Plantilla guardada.', 'success');
        setSaveOpen(false);
        setEditorOpen(false);
        void refreshList();
      } else {
        notify(res.description || 'No se pudo guardar la plantilla.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    const templateJson = currentTemplateRef.current;
    if (!templateJson) return;
    setRendering(true);
    try {
      const res = await pdfEngineService.render({
        templateJson: templateJson as Record<string, unknown>,
        filename: `${saveName || 'diseno'}.pdf`,
      });
      if (isOk(res) && res.data?.pdfBase64) {
        setPreviewUrl(URL.createObjectURL(base64ToPdfBlob(res.data.pdfBase64)));
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
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Diseñador PDF</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={() => void refreshList()} title="Refrescar">
          <RefreshIcon fontSize="small" />
        </IconButton>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openNew}>
          Nuevo diseño
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Diseñador de documentos avanzado (páginas en mm, tablas con secciones, áreas de
        contenido con variables, QR y códigos de barras). Las variables «{'{{campo}}'}»
        salen de las columnas de tus bases de datos.
      </Alert>

      {templates.length === 0 && !loadingList ? (
        <Typography variant="body2" color="text.secondary">
          No hay diseños guardados todavía. Crea el primero con «Nuevo diseño».
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {templates.map((t) => (
            <Grid key={t.messageTemplateId} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card variant="outlined">
                <CardActionArea onClick={() => openEdit(t)}>
                  <CardContent>
                    <Typography sx={{ fontWeight: 600 }} noWrap>{t.name}</Typography>
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

      {/* Editor full-screen (overlay propio del DocumentDesigner) */}
      {editorOpen && (
        <DocumentDesignerEditor
          templateJson={initialTemplate}
          availableFields={fields}
          onSave={handleEditorSave}
          onClose={() => setEditorOpen(false)}
          onTemplateChange={(t: TemplateJson) => { currentTemplateRef.current = t; }}
          assets={null}
          headerActions={(
            <Tooltip title="Genera el PDF real con el motor del backend">
              <button type="button" onClick={() => void handlePreview()} disabled={rendering}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                         borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff',
                         cursor: 'pointer', fontSize: 12 }}>
                <PictureAsPdfIcon sx={{ fontSize: 14 }} />
                {rendering ? 'Generando…' : 'Vista previa PDF'}
              </button>
            </Tooltip>
          )}
        />
      )}

      {/* Nombre al guardar — por encima del overlay del editor (z-index 9999) */}
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="xs" fullWidth
        sx={{ zIndex: 10000 }}>
        <DialogTitle>{editingId ? 'Actualizar plantilla' : 'Guardar diseño'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth size="small" sx={{ mt: 1 }} label="Nombre de la plantilla"
            value={saveName} onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void persist(); }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={() => void persist()}
            disabled={saving || !saveName.trim()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Vista previa PDF — también por encima del overlay */}
      <Dialog open={!!previewUrl} onClose={closePreview} maxWidth="md" fullWidth
        sx={{ zIndex: 10000 }}>
        <DialogTitle>Vista previa PDF</DialogTitle>
        <DialogContent>
          <Box component="iframe" src={previewUrl} title="Vista previa PDF"
            sx={{ width: '100%', height: '70vh', border: 0 }} />
        </DialogContent>
        <DialogActions>
          <Button component="a" href={previewUrl} download={`${saveName || 'diseno'}.pdf`}>
            Descargar
          </Button>
          <Button onClick={closePreview}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
}
