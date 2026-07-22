import { useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Tooltip, Divider, MenuItem,
  TextField, Menu, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from '@mui/material';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CodeIcon from '@mui/icons-material/Code';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import FormatColorTextIcon from '@mui/icons-material/FormatColorText';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter';
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight';
import FormatAlignJustifyIcon from '@mui/icons-material/FormatAlignJustify';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import LinkIcon from '@mui/icons-material/Link';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DataObjectIcon from '@mui/icons-material/DataObject';
import TableChartIcon from '@mui/icons-material/TableChart';
import type { ReactNode } from 'react';
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';

/**
 * Editor de PLANTILLAS PDF tipo "documento" (a lo Word): barra de formato de texto arriba,
 * herramientas a la izquierda, y un lienzo con REGLAS (hoja A4/Carta). Muy sencillo: usa un
 * `contentEditable` + document.execCommand (sin librerías extra). El contenido se guarda como
 * borrador en localStorage; el envío EAP-PDF que lo consuma queda para una fase posterior.
 */

const CM = 37.8; // 1 cm ≈ 37.8 px a 96 dpi
const RULER = 22; // grosor de la regla (px)
const PAGE_SIZES = { A4: { w: 794, h: 1123 }, Carta: { w: 816, h: 1056 } } as const;
const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma'];
const VARIABLES = ['nombre', 'email', 'empresa', 'ciudad'];
const DRAFTS_KEY = 'mc_pdf_drafts';

const readDrafts = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}'); } catch { return {}; }
};
const writeDrafts = (d: Record<string, string>) => localStorage.setItem(DRAFTS_KEY, JSON.stringify(d));

/** Regla horizontal con marcas de centímetro. */
const HRuler = ({ width }: { width: number }) => (
  <Box sx={{ display: 'flex', height: RULER, bgcolor: '#fff', borderBottom: '1px solid #dfe5ee', color: '#9aa6b6', fontSize: 8, userSelect: 'none' }}>
    {Array.from({ length: Math.ceil(width / CM) }).map((_, i) => (
      <Box key={i} sx={{ width: CM, flexShrink: 0, borderRight: '1px solid #edf1f6', pl: '2px', lineHeight: `${RULER}px` }}>{i || ''}</Box>
    ))}
  </Box>
);

/** Regla vertical con marcas de centímetro. */
const VRuler = ({ height }: { height: number }) => (
  <Box sx={{ width: RULER, bgcolor: '#fff', borderRight: '1px solid #dfe5ee', color: '#9aa6b6', fontSize: 8, userSelect: 'none', flexShrink: 0 }}>
    {Array.from({ length: Math.ceil(height / CM) }).map((_, i) => (
      <Box key={i} sx={{ height: CM, borderBottom: '1px solid #edf1f6', textAlign: 'center', pt: '1px', lineHeight: '9px' }}>{i || ''}</Box>
    ))}
  </Box>
);

/** Botón de barra: preventDefault en mousedown conserva la selección del lienzo. */
const TB = ({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) => (
  <Tooltip title={title}>
    <IconButton size="small" onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{icon}</IconButton>
  </Tooltip>
);

export const PdfTemplatesSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const pageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<'A4' | 'Carta'>('A4');
  const [font, setFont] = useState('Arial');
  const [format, setFormat] = useState('p');
  const [uploading, setUploading] = useState(false);
  const [varAnchor, setVarAnchor] = useState<null | HTMLElement>(null);
  const [loadAnchor, setLoadAnchor] = useState<null | HTMLElement>(null);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [htmlView, setHtmlView] = useState('');
  const dims = PAGE_SIZES[size];

  useEffect(() => {
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* noop */ }
    if (pageRef.current && !pageRef.current.innerHTML.trim()) {
      pageRef.current.innerHTML =
        '<h1>Título del documento</h1><p>Escribe aquí el contenido de tu plantilla. Usa la barra de arriba para dar formato y las herramientas de la izquierda para insertar imágenes, tablas o variables como {{nombre}}.</p>';
    }
  }, []);

  /** Ejecuta un comando de edición sobre la selección actual del lienzo. */
  const exec = (cmd: string, value?: string) => {
    pageRef.current?.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* noop */ }
    document.execCommand(cmd, false, value);
  };
  const insertHtml = (html: string) => { pageRef.current?.focus(); document.execCommand('insertHTML', false, html); };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    const user = getUser();
    if (!user?.customer) { notify('Tu sesión no tiene un cliente para el bucket de imágenes.', 'warning'); return; }
    setUploading(true);
    const presign = await campaignsService.presignUrl({ customer: user.customer, nit: user.nit, documentName: file.name, documentType: 'resources' });
    if (!isOk(presign) || !presign.data?.url) { setUploading(false); notify(presign.description || 'No se pudo obtener la URL de carga.', 'error'); return; }
    const ok = await campaignsService.uploadToS3(presign.data.url, file);
    setUploading(false);
    if (!ok) { notify('No se pudo subir la imagen a S3.', 'error'); return; }
    insertHtml(`<img src="${campaignsService.publicUrl(user.nit ?? '', presign.data.path ?? '')}" alt="" style="max-width:100%;height:auto;" />`);
    notify('Imagen insertada.', 'success');
  };

  const insertTable = () => insertHtml(
    '<table style="width:100%;border-collapse:collapse;margin:8px 0;">' +
    Array.from({ length: 2 }).map(() => '<tr>' + Array.from({ length: 2 }).map(() => '<td style="border:1px solid #cbd5e1;padding:8px;">&nbsp;</td>').join('') + '</tr>').join('') +
    '</table><p></p>',
  );

  const saveDraft = () => {
    const name = window.prompt('Nombre de la plantilla:');
    if (!name || !name.trim()) return;
    const d = readDrafts();
    d[name.trim()] = pageRef.current?.innerHTML || '';
    writeDrafts(d);
    notify(`Plantilla "${name.trim()}" guardada.`, 'success');
  };
  const loadDraft = (name: string) => {
    const d = readDrafts();
    if (pageRef.current) pageRef.current.innerHTML = d[name] || '';
    setLoadAnchor(null);
    notify(`Plantilla "${name}" cargada.`, 'info');
  };
  const newDoc = () => { if (pageRef.current) pageRef.current.innerHTML = '<p><br></p>'; };
  const showHtml = () => { setHtmlView(pageRef.current?.innerHTML || ''); setHtmlOpen(true); };
  const download = () => {
    const blob = new Blob(['<!doctype html><meta charset="utf-8">' + (pageRef.current?.innerHTML || '')], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plantilla-pdf.html';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const drafts = readDrafts();

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Plantillas PDF</Typography>
          <Typography variant="body2" color="text.secondary">
            Editor de documento tipo Word: da formato al texto, inserta imágenes, tablas y variables.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button size="small" startIcon={<NoteAddIcon />} onClick={newDoc}>Nueva</Button>
          <Button size="small" startIcon={<FolderOpenIcon />} onClick={(e) => setLoadAnchor(e.currentTarget)}>Cargar</Button>
          <Button size="small" startIcon={<CodeIcon />} onClick={showHtml}>Ver HTML</Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={download}>Descargar</Button>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={saveDraft}>Guardar</Button>
        </Stack>
      </Stack>

      {/* Barra de formato (arriba, tipo Word) */}
      <Paper variant="outlined" sx={{ p: 0.75, mb: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
        <TextField select size="small" value={format} onChange={(e) => { setFormat(e.target.value); exec('formatBlock', e.target.value); }} sx={{ width: 120 }}>
          <MenuItem value="p">Normal</MenuItem>
          <MenuItem value="h1">Título 1</MenuItem>
          <MenuItem value="h2">Título 2</MenuItem>
          <MenuItem value="h3">Título 3</MenuItem>
          <MenuItem value="blockquote">Cita</MenuItem>
        </TextField>
        <TextField select size="small" value={font} onChange={(e) => { setFont(e.target.value); exec('fontName', e.target.value); }} sx={{ width: 150 }}>
          {FONTS.map((f) => <MenuItem key={f} value={f} sx={{ fontFamily: f }}>{f}</MenuItem>)}
        </TextField>
        <TextField select size="small" defaultValue="3" onChange={(e) => exec('fontSize', e.target.value)} sx={{ width: 120 }}>
          <MenuItem value="1">Muy pequeño</MenuItem>
          <MenuItem value="2">Pequeño</MenuItem>
          <MenuItem value="3">Normal</MenuItem>
          <MenuItem value="5">Grande</MenuItem>
          <MenuItem value="6">Muy grande</MenuItem>
        </TextField>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <TB title="Negrita" icon={<FormatBoldIcon fontSize="small" />} onClick={() => exec('bold')} />
        <TB title="Cursiva" icon={<FormatItalicIcon fontSize="small" />} onClick={() => exec('italic')} />
        <TB title="Subrayado" icon={<FormatUnderlinedIcon fontSize="small" />} onClick={() => exec('underline')} />
        <Tooltip title="Color del texto">
          <IconButton size="small" component="label">
            <FormatColorTextIcon fontSize="small" />
            <input type="color" hidden onChange={(e) => exec('foreColor', e.target.value)} />
          </IconButton>
        </Tooltip>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <TB title="Alinear a la izquierda" icon={<FormatAlignLeftIcon fontSize="small" />} onClick={() => exec('justifyLeft')} />
        <TB title="Centrar" icon={<FormatAlignCenterIcon fontSize="small" />} onClick={() => exec('justifyCenter')} />
        <TB title="Alinear a la derecha" icon={<FormatAlignRightIcon fontSize="small" />} onClick={() => exec('justifyRight')} />
        <TB title="Justificar" icon={<FormatAlignJustifyIcon fontSize="small" />} onClick={() => exec('justifyFull')} />
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <TB title="Lista con viñetas" icon={<FormatListBulletedIcon fontSize="small" />} onClick={() => exec('insertUnorderedList')} />
        <TB title="Lista numerada" icon={<FormatListNumberedIcon fontSize="small" />} onClick={() => exec('insertOrderedList')} />
        <TB title="Insertar enlace" icon={<LinkIcon fontSize="small" />} onClick={() => { const u = window.prompt('URL del enlace:', 'https://'); if (u) exec('createLink', u); }} />
        <TB title="Quitar formato" icon={<FormatClearIcon fontSize="small" />} onClick={() => exec('removeFormat')} />
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <TB title="Deshacer" icon={<UndoIcon fontSize="small" />} onClick={() => exec('undo')} />
        <TB title="Rehacer" icon={<RedoIcon fontSize="small" />} onClick={() => exec('redo')} />
      </Paper>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
        {/* Herramientas a la izquierda */}
        <Paper variant="outlined" sx={{ p: 1.5, width: { md: 190 }, flexShrink: 0 }}>
          <Typography variant="overline" color="text.secondary">Insertar</Typography>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            <Button component="label" size="small" variant="outlined" disabled={uploading} startIcon={uploading ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />}>
              {uploading ? 'Subiendo…' : 'Imagen'}
              <input type="file" accept="image/*" hidden onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
            </Button>
            <Button size="small" variant="outlined" startIcon={<DataObjectIcon />} onClick={(e) => setVarAnchor(e.currentTarget)}>Variable</Button>
            <Button size="small" variant="outlined" startIcon={<TableChartIcon />} onClick={insertTable}>Tabla</Button>
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="overline" color="text.secondary">Hoja</Typography>
          <TextField select size="small" fullWidth value={size} onChange={(e) => setSize(e.target.value as 'A4' | 'Carta')} sx={{ mt: 0.5 }}>
            <MenuItem value="A4">A4</MenuItem>
            <MenuItem value="Carta">Carta</MenuItem>
          </TextField>
        </Paper>

        {/* Lienzo con reglas (hoja) */}
        <Box sx={{ flex: 1, minWidth: 0, bgcolor: (t) => (t.palette.mode === 'dark' ? '#0b1220' : '#e9edf3'), borderRadius: 2, p: 2, overflow: 'auto', maxHeight: '80vh' }}>
          <Box sx={{ display: 'inline-block' }}>
            <Box sx={{ display: 'flex' }}>
              <Box sx={{ width: RULER, height: RULER, bgcolor: '#fff', borderRight: '1px solid #dfe5ee', borderBottom: '1px solid #dfe5ee' }} />
              <HRuler width={dims.w} />
            </Box>
            <Box sx={{ display: 'flex' }}>
              <VRuler height={dims.h} />
              <Box
                ref={pageRef}
                contentEditable
                suppressContentEditableWarning
                sx={{
                  width: dims.w, minHeight: dims.h, boxSizing: 'border-box', p: '64px',
                  bgcolor: '#fff', color: '#111', fontFamily: font, fontSize: 15, lineHeight: 1.6,
                  boxShadow: '0 8px 30px rgba(16,35,63,.18)', outline: 'none',
                  '& h1': { fontSize: 26 }, '& h2': { fontSize: 21 }, '& h3': { fontSize: 18 },
                  '& img': { maxWidth: '100%' }, '& blockquote': { borderLeft: '3px solid #cbd5e1', margin: '8px 0', paddingLeft: 2, color: '#555' },
                }}
              />
            </Box>
          </Box>
        </Box>
      </Stack>

      <Menu anchorEl={varAnchor} open={Boolean(varAnchor)} onClose={() => setVarAnchor(null)}>
        {VARIABLES.map((v) => (
          <MenuItem key={v} onClick={() => { insertHtml(`{{${v}}}`); setVarAnchor(null); }}>{`{{${v}}}`}</MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={loadAnchor} open={Boolean(loadAnchor)} onClose={() => setLoadAnchor(null)}>
        {Object.keys(drafts).length === 0
          ? <MenuItem disabled>No hay plantillas guardadas</MenuItem>
          : Object.keys(drafts).sort().map((n) => <MenuItem key={n} onClick={() => loadDraft(n)}>{n}</MenuItem>)}
      </Menu>

      <Dialog open={htmlOpen} onClose={() => setHtmlOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>HTML de la plantilla</DialogTitle>
        <DialogContent dividers>
          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, fontFamily: 'monospace', m: 0 }}>{htmlView}</Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { navigator.clipboard?.writeText(htmlView); notify('HTML copiado.', 'info'); }}>Copiar</Button>
          <Button onClick={() => setHtmlOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};
