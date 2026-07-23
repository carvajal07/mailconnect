import { useMemo, useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  List, ListItemButton, ListItemText, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useFeedback } from '../../hooks/useFeedback';
import { isOk } from '../../services/apiClient';
import { getUser } from '../../services/authService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { pdfEngineService } from '../../services/pdfEngineService';
import { base64ToPdfBlob } from '../../services/pdfTemplatesService';
import SketchEditor from '../../pdfsketch/SketchEditor';
import { useDocumentStore } from '../../pdfsketch/store/documentStore';
import { toEnvelope, deserializeFromJson } from '../../pdfsketch/json/documentJson';

/**
 * ESTUDIO PDF (nivel MEDIO de plantillas PDF) — editor de lienzo pdfsketch
 * (Konva) montado dentro del portal + barra MailConnect para:
 *   - Guardar/actualizar la plantilla en el backend (messageTemplate channel=PDF,
 *     campo `sketchJson` = JSON del documento, formato estándar pdfsketch@1).
 *   - Cargar una plantilla guardada.
 *   - Vista previa PDF real vía el MOTOR ESTÁNDAR (/Template/Render-engine).
 *
 * Este componente se carga LAZY (chunk aparte) desde PdfStudioSection: Konva y
 * el editor no engordan el bundle del resto del portal.
 */
export default function SketchStudio() {
  const { notify, FeedbackSnackbar } = useFeedback();
  const user = getUser();
  const customerId = user?.customerId ?? '';

  const doc = useDocumentStore((s) => s.doc);
  const setDoc = useDocumentStore((s) => s.setDoc);

  // Id de la plantilla del backend sobre la que se está trabajando (upsert al guardar).
  const [templateId, setTemplateId] = useState<string>('');

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const [loadOpen, setLoadOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);

  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [rendering, setRendering] = useState(false);

  const sketchCount = useMemo(
    () => doc.pages.reduce((n, p) => n + (p.elements?.length ?? 0), 0),
    [doc],
  );

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await messageTemplatesService.create({
        customerId,
        channel: 'PDF',
        name,
        sketchJson: toEnvelope({ ...doc, name }) as unknown as Record<string, unknown>,
        ...(templateId ? { messageTemplateId: templateId } : {}),
      });
      if (isOk(res) && res.data?.messageTemplateId) {
        setTemplateId(res.data.messageTemplateId);
        notify(templateId ? 'Plantilla actualizada.' : 'Plantilla guardada.', 'success');
        setSaveOpen(false);
      } else {
        notify(res.description || 'No se pudo guardar la plantilla.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const openLoad = async () => {
    setLoadOpen(true);
    setLoading(true);
    try {
      const res = await messageTemplatesService.list(customerId, 'PDF');
      const all = res.data?.templates ?? [];
      // Solo las de este editor (tienen sketchJson); las HTML/full van en sus tabs.
      setTemplates(all.filter((t) => (t.sketchJson ?? '').toString().trim() !== ''));
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = (t: MessageTemplate) => {
    try {
      const loaded = deserializeFromJson(t.sketchJson ?? '');
      setDoc(loaded);
      setTemplateId(t.messageTemplateId);
      setSaveName(t.name);
      setLoadOpen(false);
      notify(`Plantilla "${t.name}" cargada.`, 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'La plantilla guardada no es válida.', 'error');
    }
  };

  const handlePreview = async () => {
    setRendering(true);
    try {
      const res = await pdfEngineService.render({
        sketch: toEnvelope(doc) as unknown as Record<string, unknown>,
        filename: `${doc.name || 'documento'}.pdf`,
      });
      if (isOk(res) && res.data?.pdfBase64) {
        const blob = base64ToPdfBlob(res.data.pdfBase64);
        setPreviewWarnings(res.data.warnings ?? []);
        setPreviewUrl(URL.createObjectURL(blob));
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
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mr: 1 }}>
          Estudio PDF
        </Typography>
        <Chip size="small" variant="outlined" label={`${sketchCount} elemento${sketchCount === 1 ? '' : 's'}`} />
        {templateId && <Chip size="small" color="info" variant="outlined" label="editando plantilla guardada" />}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Genera el PDF real con el motor del backend">
          <span>
            <Button size="small" variant="contained" startIcon={<PictureAsPdfIcon />}
              onClick={handlePreview} disabled={rendering}>
              {rendering ? 'Generando…' : 'Vista previa PDF'}
            </Button>
          </span>
        </Tooltip>
        <Button size="small" variant="outlined" startIcon={<FolderOpenIcon />} onClick={openLoad}>
          Cargar
        </Button>
        <Button size="small" variant="outlined" startIcon={<SaveIcon />}
          onClick={() => setSaveOpen(true)}>
          Guardar
        </Button>
      </Stack>

      {/* Editor pdfsketch (todo su CSS/tema vive scopeado bajo .mc-sketch) */}
      <Box sx={{ height: 'calc(100vh - 190px)', minHeight: 480, borderRadius: 1,
                 overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <SketchEditor />
      </Box>

      {/* Guardar */}
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="xs" fullWidth>
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

      {/* Cargar */}
      <Dialog open={loadOpen} onClose={() => setLoadOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Cargar plantilla del Estudio PDF</DialogTitle>
        <DialogContent>
          {loading ? (
            <Typography variant="body2" color="text.secondary">Cargando…</Typography>
          ) : templates.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No hay plantillas del Estudio PDF guardadas todavía.
            </Typography>
          ) : (
            <List dense>
              {templates.map((t) => (
                <ListItemButton key={t.messageTemplateId} onClick={() => handleLoad(t)}>
                  <ListItemText primary={t.name} secondary={t.created} />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoadOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Vista previa PDF */}
      <Dialog open={!!previewUrl} onClose={closePreview} maxWidth="md" fullWidth>
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
          <Button component="a" href={previewUrl} download={`${doc.name || 'documento'}.pdf`}>
            Descargar
          </Button>
          <Button onClick={closePreview}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
}
