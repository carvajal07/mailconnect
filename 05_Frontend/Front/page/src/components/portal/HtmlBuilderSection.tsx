import { useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Button,
  IconButton,
  TextField,
  MenuItem,
  Menu,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tooltip,
  CircularProgress,
  ListItemText,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CodeIcon from '@mui/icons-material/Code';
import SaveIcon from '@mui/icons-material/Save';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import FolderIcon from '@mui/icons-material/Folder';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import EditNoteIcon from '@mui/icons-material/EditNote';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DataObjectIcon from '@mui/icons-material/DataObject';
import TuneIcon from '@mui/icons-material/Tune';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import TitleIcon from '@mui/icons-material/Title';
import NotesIcon from '@mui/icons-material/Notes';
import ImageIcon from '@mui/icons-material/Image';
import SmartButtonIcon from '@mui/icons-material/SmartButton';
import BrandingWatermarkIcon from '@mui/icons-material/BrandingWatermark';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import ShareIcon from '@mui/icons-material/Share';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import HeightIcon from '@mui/icons-material/Height';
import type { ReactNode } from 'react';
import { getUser } from '../../services/authService';
import { templatesService } from '../../services/templatesService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import {
  BLOCK_LABELS,
  VARIABLES,
  PALETTE_GROUPS,
  DEFAULT_SETTINGS,
  createBlock,
  generateHtml,
  drafts,
  type Block,
  type BlockType,
  type EmailSettings,
} from './htmlBuilder';

const BLOCK_ICONS: Record<BlockType, ReactNode> = {
  heading: <TitleIcon fontSize="small" />,
  text: <NotesIcon fontSize="small" />,
  image: <ImageIcon fontSize="small" />,
  button: <SmartButtonIcon fontSize="small" />,
  logo: <BrandingWatermarkIcon fontSize="small" />,
  columns: <ViewColumnIcon fontSize="small" />,
  social: <ShareIcon fontSize="small" />,
  html: <CodeIcon fontSize="small" />,
  divider: <HorizontalRuleIcon fontSize="small" />,
  spacer: <HeightIcon fontSize="small" />,
};

export const HtmlBuilderSection = () => {
  const sessionUserId = getUser()?.userId ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [settings, setSettings] = useState<EmailSettings>({ ...DEFAULT_SETTINGS });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'editor' | 'preview'>('editor');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [draftName, setDraftName] = useState('');
  const dragIndex = useRef<number | null>(null);

  const [draftsAnchor, setDraftsAnchor] = useState<null | HTMLElement>(null);
  const [showHtml, setShowHtml] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadName, setLoadName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ templateName: '', customerId: '', subject: '' });
  const [draftsVersion, setDraftsVersion] = useState(0);

  const html = useMemo(() => generateHtml(blocks, settings), [blocks, settings]);
  const selected = blocks.find((b) => b.id === selectedId) ?? null;

  const setSetting = <K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  /* ---------------- Bloques ---------------- */
  const addBlock = (type: BlockType) => {
    const b = createBlock(type);
    setBlocks((prev) => [...prev, b]);
    setSelectedId(b.id);
  };

  const updateSelected = (patch: Partial<Block>) => {
    if (!selectedId) return;
    setBlocks((prev) => prev.map((b) => (b.id === selectedId ? { ...b, ...patch } : b)));
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateBlock = (id: string) => {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      if (i < 0) return prev;
      const copy = { ...prev[i], id: createBlock('text').id };
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    setBlocks((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const onDrop = (targetIndex: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === targetIndex) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const insertVariable = (v: string) => {
    if (!selected) {
      notify('Selecciona un bloque de texto para insertar la variable.', 'info');
      return;
    }
    updateSelected({ text: `${selected.text}{{${v}}}` });
  };

  /* ---------------- Borradores (localStorage) ---------------- */
  const handleSaveDraft = () => {
    const name = draftName.trim();
    if (!name) return notify('Escribe un nombre para el borrador.', 'warning');
    drafts.save(name, blocks, settings);
    setDraftsVersion((v) => v + 1);
    notify(`Borrador "${name}" guardado.`, 'success');
    setDraftsAnchor(null);
  };

  const handleLoadDraft = (name: string) => {
    const loaded = drafts.load(name);
    if (loaded) {
      setBlocks(loaded.blocks);
      setSettings(loaded.settings);
      setSelectedId(null);
      setDraftName(name);
      notify(`Borrador "${name}" cargado.`, 'success');
    }
    setDraftsAnchor(null);
  };

  const handleDeleteDraft = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    drafts.remove(name);
    setDraftsVersion((v) => v + 1);
    notify(`Borrador "${name}" eliminado.`, 'info');
  };

  const handleNew = () => {
    if (blocks.length && !window.confirm('¿Vaciar el lienzo actual?')) return;
    setBlocks([]);
    setSettings({ ...DEFAULT_SETTINGS });
    setSelectedId(null);
    setDraftName('');
  };

  /* ---------------- Cargar desde SES (get-template) ---------------- */
  const handleLoadFromSes = async () => {
    const name = loadName.trim();
    if (!name) return;
    setLoading(true);
    const res = await templatesService.get(sessionUserId, name);
    setLoading(false);
    if (isOk(res) && res.template) {
      const rawHtml = res.template.HtmlPart ?? '';
      const block = { ...createBlock('html'), text: rawHtml };
      setBlocks([block]);
      setSelectedId(block.id);
      setMeta((m) => ({ ...m, templateName: res.template?.TemplateName || name, subject: res.template?.SubjectPart || '' }));
      notify('Plantilla cargada como bloque HTML para editar.', 'success');
      setLoadOpen(false);
      setLoadName('');
    } else {
      notify(res.description || 'No se encontró la plantilla en SES.', 'error');
    }
  };

  /* ---------------- Publicar (create-template) ---------------- */
  const handleSave = async () => {
    if (!meta.templateName || !meta.customerId || !meta.subject) {
      return notify('Nombre, Customer ID y Asunto son obligatorios.', 'warning');
    }
    if (blocks.length === 0) return notify('Agrega al menos un bloque antes de guardar.', 'warning');
    setSaving(true);
    const res = await templatesService.create({
      userId: sessionUserId,
      customerId: meta.customerId,
      channel: 1,
      templateName: meta.templateName,
      subject: meta.subject,
      htmlBody: html,
      textBody: blocks
        .filter((b) => b.type === 'text' || b.type === 'heading')
        .map((b) => b.text)
        .join('\n'),
    });
    setSaving(false);
    if (isOk(res)) {
      notify('Plantilla publicada correctamente (create-template).', 'success');
      setSaveOpen(false);
    } else {
      notify(res.description || 'No se pudo publicar la plantilla.', 'error');
    }
  };

  const draftList = useMemo(() => drafts.list(), [draftsVersion]);

  return (
    <Box>
      {/* Barra de herramientas */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h4">Plantillas HTML</Typography>
          <TextField
            size="small"
            placeholder="Nombre del borrador"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            sx={{ width: 200 }}
          />
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
          <Button size="small" startIcon={<NoteAddIcon />} onClick={handleNew}>
            Nuevo
          </Button>
          <Button size="small" startIcon={<FolderIcon />} onClick={(e) => setDraftsAnchor(e.currentTarget)}>
            Borradores
          </Button>
          <Button size="small" startIcon={<CloudDownloadIcon />} onClick={() => setLoadOpen(true)}>
            Cargar de SES
          </Button>
          <Button size="small" startIcon={<TuneIcon />} onClick={() => setSettingsOpen(true)}>
            Ajustes
          </Button>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="editor">
              <EditNoteIcon fontSize="small" sx={{ mr: 0.5 }} /> Editor
            </ToggleButton>
            <ToggleButton value="preview">
              <VisibilityIcon fontSize="small" sx={{ mr: 0.5 }} /> Vista previa
            </ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" variant="outlined" startIcon={<CodeIcon />} onClick={() => setShowHtml(true)}>
            Ver HTML
          </Button>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => setSaveOpen(true)} disabled={blocks.length === 0}>
            Publicar
          </Button>
        </Stack>
      </Stack>

      {/* Menú de borradores */}
      <Menu anchorEl={draftsAnchor} open={Boolean(draftsAnchor)} onClose={() => setDraftsAnchor(null)}>
        <MenuItem onClick={handleSaveDraft}>
          <SaveIcon fontSize="small" sx={{ mr: 1 }} /> Guardar borrador actual
        </MenuItem>
        <Divider />
        {draftList.length === 0 && (
          <MenuItem disabled>
            <Typography variant="body2">Sin borradores guardados</Typography>
          </MenuItem>
        )}
        {draftList.map((name) => (
          <MenuItem key={name} onClick={() => handleLoadDraft(name)}>
            <ListItemText primary={name} />
            <IconButton size="small" color="error" onClick={(e) => handleDeleteDraft(name, e)} sx={{ ml: 2 }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </MenuItem>
        ))}
      </Menu>

      {view === 'preview' ? (
        <Box>
          <Stack direction="row" justifyContent="center" mb={1.5}>
            <ToggleButtonGroup size="small" exclusive value={device} onChange={(_, v) => v && setDevice(v)}>
              <ToggleButton value="desktop">
                <DesktopWindowsIcon fontSize="small" sx={{ mr: 0.5 }} /> Escritorio
              </ToggleButton>
              <ToggleButton value="mobile">
                <PhoneAndroidIcon fontSize="small" sx={{ mr: 0.5 }} /> Móvil
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: settings.pageBg, display: 'flex', justifyContent: 'center' }}>
            <Box
              sx={{
                width: device === 'mobile' ? 375 : '100%',
                maxWidth: device === 'mobile' ? 375 : settings.contentWidth + 48,
                transition: 'width .3s',
                boxShadow: device === 'mobile' ? 3 : 0,
                borderRadius: device === 'mobile' ? 2 : 0,
                overflow: 'hidden',
                bgcolor: '#fff',
              }}
            >
              <iframe title="preview" srcDoc={html} style={{ width: '100%', height: '70vh', border: 0, display: 'block' }} />
            </Box>
          </Paper>
        </Box>
      ) : (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
          {/* Paleta agrupada (con icono por bloque) */}
          <Paper variant="outlined" sx={{ p: 1.5, width: { md: 200 }, flexShrink: 0, position: { md: 'sticky' }, top: { md: 88 } }}>
            {PALETTE_GROUPS.map((group) => (
              <Box key={group.label} sx={{ mb: 1.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ px: 0.5, letterSpacing: 0.6 }}>
                  {group.label}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, mt: 0.5 }}>
                  {group.types.map((type) => (
                    <Button
                      key={type}
                      variant="outlined"
                      onClick={() => addBlock(type)}
                      sx={{
                        flexDirection: 'column',
                        gap: 0.25,
                        py: 1,
                        textTransform: 'none',
                        fontSize: 11,
                        lineHeight: 1.2,
                        color: 'text.primary',
                        borderColor: 'divider',
                        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                      }}
                    >
                      {BLOCK_ICONS[type]}
                      {BLOCK_LABELS[type]}
                    </Button>
                  ))}
                </Box>
              </Box>
            ))}
          </Paper>

          {/* Lienzo: hoja de correo centrada sobre un backdrop (theme-aware) */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              borderRadius: 2,
              p: { xs: 1.5, md: 3 },
              minHeight: '72vh',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              bgcolor: (t) => (t.palette.mode === 'dark' ? '#0b1220' : '#eef2f7'),
            }}
          >
            <Box
              sx={{
                width: settings.contentWidth,
                maxWidth: '100%',
                bgcolor: settings.emailBg,
                color: '#333333',
                borderRadius: settings.rounded ? 2 : 0,
                boxShadow: '0 8px 30px rgba(16,35,63,.16)',
                overflow: 'hidden',
              }}
            >
              {blocks.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 10, px: 3 }}>
                  <Typography sx={{ color: '#334155', fontWeight: 700 }}>Tu correo está vacío</Typography>
                  <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                    Agrega bloques desde la paleta. Arrástralos o usa las flechas para ordenarlos.
                  </Typography>
                </Box>
              ) : (
                blocks.map((b, index) => (
                  <Box
                    key={b.id}
                    draggable
                    onDragStart={() => (dragIndex.current = index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(index)}
                    onClick={() => setSelectedId(b.id)}
                    sx={{
                      position: 'relative',
                      cursor: 'pointer',
                      outline: '2px solid',
                      outlineOffset: '-2px',
                      outlineColor: selectedId === b.id ? 'primary.main' : 'transparent',
                      transition: 'outline-color .15s',
                      '&:hover': { outlineColor: selectedId === b.id ? 'primary.main' : 'rgba(0,117,190,.35)' },
                      '&:hover .block-tools': { opacity: 1 },
                    }}
                  >
                    <Stack
                      direction="row"
                      className="block-tools"
                      sx={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        opacity: selectedId === b.id ? 1 : 0,
                        transition: 'opacity .2s',
                        bgcolor: '#ffffff',
                        color: '#0075be',
                        border: '1px solid #e4ebf3',
                        borderRadius: 1,
                        boxShadow: 3,
                        zIndex: 2,
                      }}
                    >
                      <Tooltip title="Arrastra para reordenar">
                        <IconButton size="small" color="inherit" sx={{ cursor: 'grab' }}>
                          <DragIndicatorIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" color="inherit" onClick={(e) => { e.stopPropagation(); move(index, -1); }} disabled={index === 0}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="inherit" onClick={(e) => { e.stopPropagation(); move(index, 1); }} disabled={index === blocks.length - 1}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="inherit" onClick={(e) => { e.stopPropagation(); duplicateBlock(b.id); }}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); removeBlock(b.id); }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <Box sx={{ p: 2 }}>
                      <BlockPreview block={b} />
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>

          {/* Propiedades */}
          <Paper variant="outlined" sx={{ p: 2, width: { md: 300 }, flexShrink: 0, position: { md: 'sticky' }, top: { md: 88 } }}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
              Propiedades
            </Typography>
            {!selected ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Selecciona un bloque en el lienzo para editar sus propiedades.
              </Typography>
            ) : (
              <Box sx={{ mt: 1 }}>
                <BlockEditor block={selected} onChange={updateSelected} onInsertVariable={insertVariable} />
              </Box>
            )}
          </Paper>
        </Stack>
      )}

      {/* Ver HTML */}
      <Dialog open={showHtml} onClose={() => setShowHtml(false)} maxWidth="md" fullWidth>
        <DialogTitle>HTML generado</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={16}
            value={html}
            InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { navigator.clipboard?.writeText(html); notify('HTML copiado.', 'info'); }}>Copiar</Button>
          <Button onClick={() => setShowHtml(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Ajustes globales del correo */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Ajustes del correo</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Ancho del contenido (px)"
              type="number"
              value={settings.contentWidth}
              onChange={(e) => setSetting('contentWidth', parseInt(e.target.value) || 600)}
              fullWidth
              size="small"
              helperText="Estándar de email: 600 px"
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Fondo de página" type="color" value={settings.pageBg} onChange={(e) => setSetting('pageBg', e.target.value)} fullWidth size="small" />
              <TextField label="Fondo del correo" type="color" value={settings.emailBg} onChange={(e) => setSetting('emailBg', e.target.value)} fullWidth size="small" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Color de texto" type="color" value={settings.textColor} onChange={(e) => setSetting('textColor', e.target.value)} fullWidth size="small" />
              <TextField label="Color de enlaces" type="color" value={settings.linkColor} onChange={(e) => setSetting('linkColor', e.target.value)} fullWidth size="small" />
            </Stack>
            <TextField select label="Fuente" value={settings.fontFamily} onChange={(e) => setSetting('fontFamily', e.target.value)} fullWidth size="small">
              <MenuItem value="Arial, 'Helvetica Neue', Helvetica, sans-serif">Arial / Helvetica</MenuItem>
              <MenuItem value="Georgia, 'Times New Roman', serif">Georgia / Times</MenuItem>
              <MenuItem value="'Trebuchet MS', Tahoma, sans-serif">Trebuchet / Tahoma</MenuItem>
              <MenuItem value="Verdana, Geneva, sans-serif">Verdana</MenuItem>
            </TextField>
            <TextField select label="Esquinas del contenedor" value={settings.rounded ? 'yes' : 'no'} onChange={(e) => setSetting('rounded', e.target.value === 'yes')} fullWidth size="small">
              <MenuItem value="yes">Redondeadas</MenuItem>
              <MenuItem value="no">Rectas</MenuItem>
            </TextField>
            <TextField
              label="Texto de vista previa (preheader)"
              value={settings.preheader}
              onChange={(e) => setSetting('preheader', e.target.value)}
              fullWidth
              size="small"
              helperText="Se muestra en la bandeja junto al asunto (oculto en el correo)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>Restablecer</Button>
          <Button variant="contained" onClick={() => setSettingsOpen(false)}>
            Listo
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cargar de SES */}
      <Dialog open={loadOpen} onClose={() => setLoadOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cargar plantilla de SES</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Nombre exacto de la plantilla en SES"
              value={loadName}
              onChange={(e) => setLoadName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadFromSes()}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary">
              La plantilla se importa como un bloque <strong>HTML crudo</strong> para poder editarla
              y volver a publicarla.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoadOpen(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleLoadFromSes} disabled={loading || !loadName.trim()}>
            {loading ? <CircularProgress size={22} /> : 'Cargar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Publicar */}
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Publicar plantilla</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nombre de la plantilla" value={meta.templateName} onChange={(e) => setMeta((m) => ({ ...m, templateName: e.target.value }))} fullWidth />
            <TextField label="Customer ID" value={meta.customerId} onChange={(e) => setMeta((m) => ({ ...m, customerId: e.target.value }))} fullWidth />
            <TextField label="Asunto" value={meta.subject} onChange={(e) => setMeta((m) => ({ ...m, subject: e.target.value }))} fullWidth />
            <Divider />
            <Typography variant="caption" color="text.secondary">
              Se publica con el endpoint real create-template (canal Email). userId: {sessionUserId || '—'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={22} /> : 'Publicar'}
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};

/* --------- Render de un bloque en el lienzo (aproximado al email) --------- */
const BlockPreview = ({ block: b }: { block: Block }) => {
  const align = b.align;
  switch (b.type) {
    case 'heading':
      return <Typography sx={{ fontSize: 24, fontWeight: 700, color: b.color || '#16233f', textAlign: align }}>{b.text}</Typography>;
    case 'text':
      return <Typography sx={{ fontSize: 15, color: '#333', textAlign: align, whiteSpace: 'pre-wrap' }}>{b.text}</Typography>;
    case 'image':
    case 'logo':
      return <Box component="img" src={b.url} alt={b.text || 'logo'} sx={{ display: 'block', maxWidth: b.type === 'logo' ? 180 : '100%', mx: align === 'center' ? 'auto' : 0 }} />;
    case 'button':
      return (
        <Box sx={{ textAlign: align }}>
          <Box component="span" sx={{ display: 'inline-block', px: 2.5, py: 1.2, borderRadius: 1.5, bgcolor: b.color || '#0075be', color: '#fff', fontSize: 15 }}>
            {b.text}
          </Box>
        </Box>
      );
    case 'columns':
      return (
        <Stack direction="row" spacing={2}>
          <Typography sx={{ flex: 1, fontSize: 15, color: '#333', whiteSpace: 'pre-wrap' }}>{b.text}</Typography>
          <Typography sx={{ flex: 1, fontSize: 15, color: '#333', whiteSpace: 'pre-wrap' }}>{b.textRight}</Typography>
        </Stack>
      );
    case 'social': {
      const items = [
        ['Facebook', b.links.facebook],
        ['Instagram', b.links.instagram],
        ['X', b.links.x],
        ['LinkedIn', b.links.linkedin],
      ].filter(([, v]) => v && String(v).trim());
      return (
        <Typography sx={{ textAlign: 'center', color: '#0075be', fontSize: 14 }}>
          {items.length ? items.map(([l]) => l).join('  ·  ') : '(configura tus redes)'}
        </Typography>
      );
    }
    case 'html':
      return <Box sx={{ fontSize: 13, color: '#555555' }} dangerouslySetInnerHTML={{ __html: b.text }} />;
    case 'divider':
      return <Box sx={{ borderTop: '1px solid #e4ebf3' }} />;
    case 'spacer':
      return <Box sx={{ height: b.height, bgcolor: '#eef2f7', border: '1px dashed #cbd5e1', borderRadius: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>{b.height}px</Box>;
    default:
      return null;
  }
};

/* --------- Panel de edición de propiedades del bloque --------- */
const BlockEditor = ({
  block: b,
  onChange,
  onInsertVariable,
}: {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
  onInsertVariable: (v: string) => void;
}) => {
  const [varAnchor, setVarAnchor] = useState<null | HTMLElement>(null);
  const hasText = b.type === 'heading' || b.type === 'text' || b.type === 'button';
  const hasUrl = b.type === 'image' || b.type === 'button' || b.type === 'logo';
  const hasAlign = b.type !== 'divider' && b.type !== 'spacer' && b.type !== 'html';
  const hasColor = b.type === 'heading' || b.type === 'button';

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="primary" fontWeight={600}>
        {BLOCK_LABELS[b.type]}
      </Typography>

      {hasText && (
        <>
          <TextField
            label={b.type === 'button' ? 'Texto del botón' : 'Texto'}
            value={b.text}
            onChange={(e) => onChange({ text: e.target.value })}
            fullWidth
            multiline={b.type === 'text'}
            minRows={b.type === 'text' ? 3 : 1}
            size="small"
          />
          <Box>
            <Button size="small" startIcon={<DataObjectIcon />} onClick={(e) => setVarAnchor(e.currentTarget)}>
              Insertar variable
            </Button>
            <Menu anchorEl={varAnchor} open={Boolean(varAnchor)} onClose={() => setVarAnchor(null)}>
              {VARIABLES.map((v) => (
                <MenuItem key={v} onClick={() => { onInsertVariable(v); setVarAnchor(null); }}>
                  {`{{${v}}}`}
                </MenuItem>
              ))}
            </Menu>
          </Box>
        </>
      )}

      {b.type === 'columns' && (
        <>
          <TextField label="Columna izquierda" value={b.text} onChange={(e) => onChange({ text: e.target.value })} fullWidth multiline minRows={2} size="small" />
          <TextField label="Columna derecha" value={b.textRight} onChange={(e) => onChange({ textRight: e.target.value })} fullWidth multiline minRows={2} size="small" />
        </>
      )}

      {b.type === 'html' && (
        <TextField
          label="HTML"
          value={b.text}
          onChange={(e) => onChange({ text: e.target.value })}
          fullWidth
          multiline
          minRows={6}
          size="small"
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
        />
      )}

      {b.type === 'social' && (
        <>
          {(['facebook', 'instagram', 'x', 'linkedin'] as const).map((net) => (
            <TextField
              key={net}
              label={net.charAt(0).toUpperCase() + net.slice(1)}
              value={b.links[net] ?? ''}
              onChange={(e) => onChange({ links: { ...b.links, [net]: e.target.value } })}
              fullWidth
              size="small"
              placeholder="https://"
            />
          ))}
        </>
      )}

      {hasUrl && (
        <TextField
          label={b.type === 'button' ? 'Enlace (href)' : 'URL de la imagen'}
          value={b.url}
          onChange={(e) => onChange({ url: e.target.value })}
          fullWidth
          size="small"
        />
      )}

      {hasAlign && (
        <TextField select label="Alineación" value={b.align} onChange={(e) => onChange({ align: e.target.value as Block['align'] })} fullWidth size="small">
          <MenuItem value="left">Izquierda</MenuItem>
          <MenuItem value="center">Centro</MenuItem>
          <MenuItem value="right">Derecha</MenuItem>
        </TextField>
      )}

      {hasColor && (
        <TextField
          label={b.type === 'button' ? 'Color de fondo' : 'Color del texto'}
          type="color"
          value={b.color || (b.type === 'button' ? '#0075be' : '#16233f')}
          onChange={(e) => onChange({ color: e.target.value })}
          fullWidth
          size="small"
        />
      )}

      {b.type === 'spacer' && (
        <TextField label="Alto (px)" type="number" value={b.height} onChange={(e) => onChange({ height: parseInt(e.target.value) || 0 })} fullWidth size="small" />
      )}
    </Stack>
  );
};
