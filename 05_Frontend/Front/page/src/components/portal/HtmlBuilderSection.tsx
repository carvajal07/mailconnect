import { Fragment, useMemo, useRef, useState, useEffect } from 'react';
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
import ViewQuiltIcon from '@mui/icons-material/ViewQuilt';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import GridViewIcon from '@mui/icons-material/GridView';
import AddIcon from '@mui/icons-material/Add';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import ForwardToInboxIcon from '@mui/icons-material/ForwardToInbox';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RestoreIcon from '@mui/icons-material/Restore';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import type { ReactNode } from 'react';
import { getUser } from '../../services/authService';
import { templatesService, sendTestEmail } from '../../services/templatesService';
import type { TemplateSummary } from '../../services/templatesService';
import { campaignsService } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { allPresets, customPresets, cloneBlocks, type TemplatePreset } from './templatePresets';
import { emailDesigns } from '../../services/messageTemplatesService';
import { DatabaseFieldPicker } from './DatabaseFieldPicker';
import {
  BLOCK_LABELS,
  VARIABLES,
  PALETTE_GROUPS,
  DEFAULT_SETTINGS,
  COLUMN_RATIOS,
  NESTABLE_TYPES,
  createBlock,
  generateHtml,
  analyzeTemplate,
  htmlBytes,
  GMAIL_CLIP_BYTES,
  drafts,
  type Block,
  type BlockType,
  type ColumnRatio,
  type EmailSettings,
  type ProductItem,
} from './htmlBuilder';
import { RichTextEditor } from './RichTextEditor';
import { blockContentHtml, variableToken, richToPlain, sanitizeBlockHtml } from './richText';

/** Autoguardado del constructor (red de seguridad ante un cierre accidental). */
const AUTOSAVE_KEY = 'mc_html_autosave';

const BLOCK_ICONS: Record<BlockType, ReactNode> = {
  heading: <TitleIcon fontSize="small" />,
  text: <NotesIcon fontSize="small" />,
  image: <ImageIcon fontSize="small" />,
  button: <SmartButtonIcon fontSize="small" />,
  logo: <BrandingWatermarkIcon fontSize="small" />,
  columns: <ViewColumnIcon fontSize="small" />,
  social: <ShareIcon fontSize="small" />,
  html: <CodeIcon fontSize="small" />,
  imageText: <ViewQuiltIcon fontSize="small" />,
  textImage: <ViewSidebarIcon fontSize="small" />,
  textButton: <SmartButtonIcon fontSize="small" />,
  buttonTextRow: <SmartButtonIcon fontSize="small" />,
  products: <GridViewIcon fontSize="small" />,
  divider: <HorizontalRuleIcon fontSize="small" />,
  spacer: <HeightIcon fontSize="small" />,
};

/**
 * SES solo admite [A-Za-z0-9_-] en el TemplateName. Se sanea el nombre EN VIVO
 * (los espacios pasan a guion medio `-`, el resto se elimina) para que "Publicar"
 * no falle en SES (antes: un nombre con espacios rompía la creación). El backend
 * aplica el mismo saneo como defensa adicional.
 */
const sanitizeTemplateName = (s: string) => s.replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '');

/** Línea indicadora de dónde caerá el bloque al arrastrarlo (tipo MailPro/Topol). */
const DropLine = () => (
  <Box sx={{ height: 4, mx: 2, my: 0.5, borderRadius: 2, bgcolor: 'primary.main', boxShadow: '0 0 0 3px rgba(0,117,190,.18)' }} />
);

export const HtmlBuilderSection = ({ allowSavePreset = false }: { allowSavePreset?: boolean } = {}) => {
  const sessionUserId = getUser()?.userId ?? '';
  const sessionCustomer = getUser()?.customer ?? '';
  const sessionNit = getUser()?.nit ?? '';
  // customerId (uuid) para create-template: viene de la sesión, no se pide en el formulario.
  const sessionCustomerId = getUser()?.customerId ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [settings, setSettings] = useState<EmailSettings>({ ...DEFAULT_SETTINGS });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'editor' | 'preview'>('editor');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [draftName, setDraftName] = useState('');
  // Campos de la base seleccionada (para las variables {{campo}}). Vacío = usa las por defecto.
  const [dbFields, setDbFields] = useState<string[]>([]);
  // DnD unificado tipo MailPro/Topol: arrastrar DESDE la paleta (inserta un bloque nuevo) o
  // REORDENAR un bloque existente, soltando en una posición del lienzo con línea indicadora.
  const dragSource = useRef<{ kind: 'palette'; type: BlockType } | { kind: 'block'; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // ── Deshacer / rehacer ──────────────────────────────────────────────────────
  // Se lleva por SNAPSHOTS con debounce en vez de envolver cada setBlocks: así no hay
  // que tocar los ~15 puntos que mutan el estado (y escribir en un campo de texto no
  // genera un paso de historial por tecla).
  const history = useRef<{ blocks: Block[]; settings: EmailSettings }[]>([]);
  const histIndex = useRef(-1);
  const restoring = useRef(false);
  const [histFlags, setHistFlags] = useState({ canUndo: false, canRedo: false });

  const syncHistFlags = () => setHistFlags({
    canUndo: histIndex.current > 0,
    canRedo: histIndex.current < history.current.length - 1,
  });

  useEffect(() => {
    if (restoring.current) { restoring.current = false; return; }
    const t = setTimeout(() => {
      const snap = { blocks: cloneBlocks(blocks), settings: { ...settings } };
      // Se descarta lo que hubiera "adelante": editar tras deshacer abre una rama nueva.
      history.current = history.current.slice(0, histIndex.current + 1);
      history.current.push(snap);
      if (history.current.length > 60) history.current.shift();
      histIndex.current = history.current.length - 1;
      syncHistFlags();
    }, 400);
    return () => clearTimeout(t);
  }, [blocks, settings]);

  const travel = (delta: number) => {
    const next = histIndex.current + delta;
    const snap = history.current[next];
    if (!snap) return;
    histIndex.current = next;
    restoring.current = true;
    setBlocks(cloneBlocks(snap.blocks));
    setSettings({ ...snap.settings });
    syncHistFlags();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      // No se secuestra el atajo mientras se escribe: el navegador ya deshace el texto.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); travel(-1); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); travel(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Autoguardado ────────────────────────────────────────────────────────────
  // Los borradores con nombre siguen siendo manuales; esto es la red de seguridad para
  // no perder el trabajo si se cierra la pestaña por accidente.
  const [autosavedAt, setAutosavedAt] = useState<string>('');
  useEffect(() => {
    if (!blocks.length) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ blocks, settings, at: new Date().toISOString() }));
        setAutosavedAt(new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }));
      } catch { /* cuota llena: el autoguardado es best-effort */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [blocks, settings]);

  const [recoverOpen, setRecoverOpen] = useState(false);
  const recovered = useRef<{ blocks: Block[]; settings: EmailSettings; at: string } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.blocks?.length) { recovered.current = parsed; setRecoverOpen(true); }
    } catch { /* ignorar */ }
  }, []);

  // ── Chequeo previo de entregabilidad ────────────────────────────────────────
  const [checkOpen, setCheckOpen] = useState(false);
  // ── Prueba de envío ─────────────────────────────────────────────────────────
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState(getUser()?.email ?? '');
  const [testing, setTesting] = useState(false);
  // ── Variable con valor por defecto ──────────────────────────────────────────
  const [varDialog, setVarDialog] = useState<{ field: string; fallback: string } | null>(null);

  // Menú del botón "Agregar bloque" de la zona final del lienzo.
  const [appendAnchor, setAppendAnchor] = useState<null | HTMLElement>(null);
  const [draftsAnchor, setDraftsAnchor] = useState<null | HTMLElement>(null);
  const [showHtml, setShowHtml] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadName, setLoadName] = useState('');
  const [sesTemplates, setSesTemplates] = useState<TemplateSummary[]>([]);
  const [loadingSesList, setLoadingSesList] = useState(false);

  /** Abre el diálogo de carga y trae la lista de plantillas SES del cliente. */
  const openLoadDialog = async () => {
    setLoadOpen(true);
    if (!sessionCustomer && !sessionCustomerId) return;
    setLoadingSesList(true);
    const res = await templatesService.list(sessionCustomer, sessionCustomerId);
    setLoadingSesList(false);
    if (isOk(res) && res.data?.templates) setSesTemplates(res.data.templates);
  };
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ templateName: '', subject: '' });
  const [draftsVersion, setDraftsVersion] = useState(0);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetsVersion, setPresetsVersion] = useState(0);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetMeta, setPresetMeta] = useState({ name: '', description: '' });

  const html = useMemo(() => generateHtml(blocks, settings), [blocks, settings]);
  // Chequeo previo de entregabilidad (peso, alt, enlaces vacíos, imagen/texto…).
  const issues = useMemo(() => analyzeTemplate(blocks, settings, html), [blocks, settings, html]);
  const bytes = useMemo(() => htmlBytes(html), [html]);
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
      // Copia PROFUNDA de items/links para que el duplicado no comparta referencias.
      const src = prev[i];
      const copy: Block = {
        ...src,
        id: createBlock('text').id,
        links: { ...src.links },
        items: src.items ? src.items.map((it) => ({ ...it })) : undefined,
      };
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

  /** Inserta (paleta) o mueve (bloque existente) en la posición `index` del lienzo. */
  const insertAt = (index: number) => {
    const src = dragSource.current;
    endDrag();
    if (!src) return;
    if (src.kind === 'palette') {
      const nb = createBlock(src.type);
      setBlocks((prev) => {
        const next = [...prev];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, nb);
        return next;
      });
      setSelectedId(nb.id);
    } else {
      setBlocks((prev) => {
        const from = src.index;
        if (from < 0 || from >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        const target = from < index ? index - 1 : index; // ajusta por el hueco que dejó
        next.splice(Math.max(0, Math.min(target, next.length)), 0, moved);
        return next;
      });
    }
  };

  const endDrag = () => {
    dragSource.current = null;
    setDragging(false);
    setDropIndex(null);
  };

  /** Actualiza el índice de inserción según si el cursor está en la mitad superior/inferior. */
  const onBlockDragOver = (e: React.DragEvent, index: number) => {
    if (!dragSource.current) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setDropIndex(e.clientY < r.top + r.height / 2 ? index : index + 1);
  };

  /** Inserta una variable en el bloque seleccionado. Acepta el NOMBRE del campo o un
   *  token ya formado (el de "valor por defecto" viene como `{{#if …}}`). */
  const insertVariable = (v: string) => {
    if (!selected) {
      notify('Selecciona un bloque de texto para insertar la variable.', 'info');
      return;
    }
    const token = v.includes('{{') ? v : `{{${v}}}`;
    updateSelected({ text: `${selected.text}${token}` });
  };

  /** Prueba de envío a un correo del propio equipo (ver el correo REAL en la bandeja). */
  const sendTest = async () => {
    setTesting(true);
    const res = await sendTestEmail(html, testEmail.trim(), `[Prueba] ${meta.templateName || 'Plantilla'}`);
    setTesting(false);
    if (isOk(res)) {
      notify(`Prueba enviada a ${res.data?.to || testEmail}. Revisa la bandeja (y spam).`, 'success');
      setTestOpen(false);
    } else {
      notify(res.description || 'No se pudo enviar la prueba.', 'error');
    }
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
    if (!meta.templateName || !meta.subject) {
      return notify('Nombre y Asunto son obligatorios.', 'warning');
    }
    if (!sessionCustomerId) {
      return notify('Tu sesión no tiene un cliente asociado. Vuelve a iniciar sesión.', 'warning');
    }
    if (blocks.length === 0) return notify('Agrega al menos un bloque antes de guardar.', 'warning');
    setSaving(true);
    const res = await templatesService.create({
      userId: sessionUserId,
      customerId: sessionCustomerId,
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
  /** Diseños compartidos del equipo (backend). Se cargan al abrir la galería. */
  const [sharedDesigns, setSharedDesigns] = useState<TemplatePreset[]>([]);

  const presetList = useMemo(() => {
    const local = allPresets();
    const names = new Set(local.map((p) => p.name));
    return [...local, ...sharedDesigns.filter((d) => !names.has(d.name))];
  }, [presetsVersion, presetsOpen, sharedDesigns]);

  /* ---------------- Imágenes → S3 ---------------- */
  const uploadImage = async (file: File): Promise<string | null> => {
    if (!sessionCustomer) {
      notify('Tu sesión no tiene un cliente asociado para el bucket de imágenes.', 'warning');
      return null;
    }
    const presign = await campaignsService.presignUrl({
      customer: sessionCustomer,
      nit: sessionNit,
      documentName: file.name,
      // Imágenes de plantilla → prefijo público `resources/`.
      documentType: 'resources',
    });
    if (!isOk(presign) || !presign.data?.url) {
      notify(presign.description || 'No se pudo obtener la URL de carga.', 'error');
      return null;
    }
    const ok = await campaignsService.uploadToS3(presign.data.url, file);
    if (!ok) {
      notify('No se pudo subir la imagen a S3.', 'error');
      return null;
    }
    notify('Imagen subida a S3.', 'success');
    return campaignsService.publicUrl(sessionNit, presign.data.path ?? '');
  };

  /* ---------------- Plantillas prediseñadas ---------------- */
  const loadPreset = (p: TemplatePreset) => {
    setBlocks(cloneBlocks(p.blocks));
    setSettings({ ...p.settings });
    setSelectedId(null);
    setPresetsOpen(false);
    notify(`Plantilla "${p.name}" cargada.`, 'success');
  };

  const deleteCustomPreset = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    customPresets.remove(name);
    setPresetsVersion((v) => v + 1);
    notify(`Plantilla "${name}" eliminada.`, 'info');
  };

  /**
   * Guarda el diseño como prediseñado. Va al BACKEND (canal `HTML` de `messageTemplate`)
   * para que lo vea todo el equipo; el espejo en localStorage queda como respaldo para
   * seguir trabajando si la API no responde.
   */
  const savePreset = async () => {
    const name = presetMeta.name.trim();
    if (!name) return notify('Escribe un nombre para la plantilla.', 'warning');
    if (blocks.length === 0) return notify('Agrega bloques antes de guardar la plantilla.', 'warning');
    customPresets.save(name, blocks, settings, presetMeta.description.trim());
    setPresetsVersion((v) => v + 1);
    setSavePresetOpen(false);
    setPresetMeta({ name: '', description: '' });

    const res = await emailDesigns.save(sessionCustomerId, name, {
      blocks, settings, description: presetMeta.description.trim(),
    });
    if (isOk(res)) {
      notify(`Plantilla "${name}" guardada y compartida con tu equipo.`, 'success');
    } else {
      notify(`Plantilla "${name}" guardada solo en este navegador (no se pudo compartir: ${res.description || 'error'}).`, 'warning');
    }
  };

  useEffect(() => {
    if (!presetsOpen || !sessionCustomerId) return;
    let cancelled = false;
    (async () => {
      const res = await emailDesigns.list(sessionCustomerId);
      if (cancelled || !isOk(res)) return;
      const parsed: TemplatePreset[] = (res.data?.templates ?? []).flatMap((t) => {
        try {
          const d = JSON.parse(t.designJson || '{}');
          if (!d?.blocks?.length) return [];
          return [{
            name: t.name,
            description: d.description || 'Compartida con el equipo',
            blocks: d.blocks as Block[],
            settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
            custom: true,
          } as TemplatePreset];
        } catch { return []; }
      });
      setSharedDesigns(parsed);
    })();
    return () => { cancelled = true; };
  }, [presetsOpen, sessionCustomerId]);

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
          <Button size="small" startIcon={<ViewQuiltIcon />} onClick={() => setPresetsOpen(true)}>
            Plantillas
          </Button>
          {allowSavePreset && (
            <Button size="small" startIcon={<BookmarkAddIcon />} onClick={() => setSavePresetOpen(true)} disabled={blocks.length === 0}>
              Guardar plantilla
            </Button>
          )}
          <Button size="small" startIcon={<FolderIcon />} onClick={(e) => setDraftsAnchor(e.currentTarget)}>
            Borradores
          </Button>
          <Button size="small" startIcon={<CloudDownloadIcon />} onClick={openLoadDialog}>
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
          <Tooltip title="Deshacer (Ctrl+Z)">
            <span>
              <IconButton size="small" onClick={() => travel(-1)} disabled={!histFlags.canUndo}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Rehacer (Ctrl+Shift+Z)">
            <span>
              <IconButton size="small" onClick={() => travel(1)} disabled={!histFlags.canRedo}>
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Button size="small" variant="outlined" startIcon={<CodeIcon />} onClick={() => setShowHtml(true)}>
            Ver HTML
          </Button>
          {/* Chequeo previo: las causas típicas de que un correo bien diseñado llegue
              roto o a spam. Es más barato verlas aquí que en el reporte de rebotes. */}
          <Button
            size="small" variant="outlined"
            color={issues.some((i) => i.level === 'error') ? 'error' : 'primary'}
            startIcon={<FactCheckIcon />} onClick={() => setCheckOpen(true)}
            disabled={blocks.length === 0}
          >
            Revisar{issues.length ? ` (${issues.length})` : ''}
          </Button>
          <Button size="small" variant="outlined" startIcon={<ForwardToInboxIcon />} onClick={() => setTestOpen(true)} disabled={blocks.length === 0}>
            Enviarme una prueba
          </Button>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => setSaveOpen(true)} disabled={blocks.length === 0}>
            Publicar
          </Button>
          {autosavedAt && (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Guardado automático {autosavedAt}
            </Typography>
          )}
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
                      draggable
                      onDragStart={() => { dragSource.current = { kind: 'palette', type }; setDragging(true); }}
                      onDragEnd={endDrag}
                      onClick={() => addBlock(type)}
                      title="Arrástralo al lienzo o haz clic para agregarlo"
                      sx={{
                        flexDirection: 'column',
                        gap: 0.25,
                        py: 1,
                        textTransform: 'none',
                        fontSize: 11,
                        lineHeight: 1.2,
                        cursor: 'grab',
                        color: 'text.primary',
                        borderColor: 'divider',
                        '&:active': { cursor: 'grabbing' },
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
                <Box
                  onDragOver={(e) => { if (dragSource.current) { e.preventDefault(); setDropIndex(0); } }}
                  onDrop={(e) => { e.preventDefault(); insertAt(0); }}
                  sx={{
                    textAlign: 'center', py: 10, px: 3, transition: 'background .15s',
                    ...(dragging && { bgcolor: 'rgba(0,117,190,.06)', outline: '2px dashed rgba(0,117,190,.5)', outlineOffset: '-10px' }),
                  }}
                >
                  <Typography sx={{ color: '#334155', fontWeight: 700 }}>
                    {dragging ? 'Suelta aquí para agregarlo' : 'Tu correo está vacío'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                    Arrastra bloques desde la paleta hasta aquí, o haz clic en un bloque para agregarlo.
                  </Typography>
                </Box>
              ) : (
                <Box
                  onDragOver={(e) => { if (dragSource.current) { e.preventDefault(); setDropIndex(blocks.length); } }}
                  onDrop={(e) => { e.preventDefault(); insertAt(dropIndex ?? blocks.length); }}
                >
                {blocks.map((b, index) => (
                  <Fragment key={b.id}>
                    {dragging && dropIndex === index && <DropLine />}
                  <Box
                    draggable
                    onDragStart={() => { dragSource.current = { kind: 'block', index }; setDragging(true); }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => onBlockDragOver(e, index)}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); insertAt(dropIndex ?? index); }}
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
                      <BlockPreview
                        block={b}
                        onEditText={selectedId === b.id ? (patch) => updateSelected(patch) : undefined}
                        variables={dbFields.length ? dbFields : VARIABLES}
                        onRequestVariable={() => setVarDialog({ field: (dbFields[0] || VARIABLES[0]), fallback: '' })}
                      />
                    </Box>
                  </Box>
                  </Fragment>
                ))}
                {dragging && dropIndex === blocks.length && <DropLine />}

                {/* ZONA FINAL del lienzo. Sin ella, en cuanto se agrega el primer bloque
                    los bloques cubren toda la hoja y para soltar AL FINAL hay que apuntar
                    a la franja de pocos píxeles que queda debajo del último. Esta área
                    siempre está disponible como destino cómodo (y como botón). */}
                <Box
                  onDragOver={(e) => { if (dragSource.current) { e.preventDefault(); e.stopPropagation(); setDropIndex(blocks.length); } }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); insertAt(blocks.length); }}
                  onClick={() => setSelectedId(null)}
                  sx={{
                    m: 1.5, py: 3, px: 2, borderRadius: 1.5, textAlign: 'center',
                    border: '2px dashed',
                    borderColor: dragging && dropIndex === blocks.length ? 'primary.main' : '#dbe3ec',
                    bgcolor: dragging && dropIndex === blocks.length ? 'rgba(0,117,190,.08)' : 'transparent',
                    transition: 'background .15s, border-color .15s',
                    cursor: 'default',
                  }}
                >
                  <Typography variant="body2" sx={{ color: '#94a3b8', mb: 1 }}>
                    {dragging ? 'Suelta aquí para agregarlo al final' : 'Arrastra un bloque aquí para agregarlo al final'}
                  </Typography>
                  <Button
                    size="small" variant="outlined" startIcon={<AddIcon />}
                    onClick={(e) => { e.stopPropagation(); setAppendAnchor(e.currentTarget); }}
                  >
                    Agregar bloque
                  </Button>
                </Box>
                </Box>
              )}
            </Box>
          </Box>

          {/* Menú del botón "Agregar bloque" de la zona final: agrega SIEMPRE al final,
              sin tener que arrastrar ni acertarle a la franja de abajo. */}
          <Menu anchorEl={appendAnchor} open={Boolean(appendAnchor)} onClose={() => setAppendAnchor(null)}>
            {PALETTE_GROUPS.map((g) => [
              <MenuItem key={g.label} disabled sx={{ opacity: 1 }}>
                <Typography variant="overline" color="text.secondary">{g.label}</Typography>
              </MenuItem>,
              ...g.types.map((t) => (
                <MenuItem key={t} onClick={() => { addBlock(t); setAppendAnchor(null); }} sx={{ pl: 3 }}>
                  <Box sx={{ mr: 1, display: 'flex', color: 'primary.main' }}>{BLOCK_ICONS[t]}</Box>
                  {BLOCK_LABELS[t]}
                </MenuItem>
              )),
            ])}
          </Menu>

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
                <BlockEditor block={selected} onChange={updateSelected} onInsertVariable={insertVariable} onUploadImage={uploadImage} variableFields={dbFields} />
              </Box>
            )}
            {/* Campos desde una base: alimentan el menú "Insertar variable" y permiten
                insertar directamente en el bloque de texto seleccionado. */}
            <Box sx={{ mt: 2 }}>
              <DatabaseFieldPicker compact onFieldsChange={setDbFields} onInsert={insertVariable} />
            </Box>
          </Paper>
        </Stack>
      )}

      {/* Galería de plantillas prediseñadas */}
      <Dialog open={presetsOpen} onClose={() => setPresetsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Plantillas prediseñadas</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Elige una plantilla para empezar. Reemplaza el contenido del lienzo actual.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            {presetList.map((p) => (
              <Paper
                key={p.id}
                variant="outlined"
                onClick={() => loadPreset(p)}
                sx={{ overflow: 'hidden', cursor: 'pointer', transition: 'all .2s', '&:hover': { borderColor: 'primary.main', boxShadow: 3 } }}
              >
                <Box sx={{ height: 170, bgcolor: '#eef2f7', overflow: 'hidden', position: 'relative' }}>
                  <iframe
                    title={p.id}
                    srcDoc={generateHtml(p.blocks, p.settings)}
                    tabIndex={-1}
                    style={{ width: '166%', height: '270px', border: 0, transform: 'scale(0.6)', transformOrigin: 'top left', pointerEvents: 'none' }}
                  />
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
                      {p.name}
                    </Typography>
                    {p.custom && (
                      <>
                        <Box component="span" sx={{ fontSize: 11, color: 'primary.main', border: '1px solid', borderColor: 'primary.main', borderRadius: 1, px: 0.5 }}>
                          Personalizada
                        </Box>
                        <IconButton size="small" color="error" onClick={(e) => deleteCustomPreset(p.name, e)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {p.description}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPresetsOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Guardar como plantilla prediseñada (admin) */}
      <Dialog open={savePresetOpen} onClose={() => setSavePresetOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Guardar como plantilla prediseñada</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nombre de la plantilla" value={presetMeta.name} onChange={(e) => setPresetMeta((m) => ({ ...m, name: e.target.value }))} fullWidth />
            <TextField label="Descripción" value={presetMeta.description} onChange={(e) => setPresetMeta((m) => ({ ...m, description: e.target.value }))} fullWidth multiline minRows={2} />
            <Typography variant="caption" color="text.secondary">
              Quedará disponible en "Plantillas" para todos en este navegador. Persistir/compartir
              entre usuarios requerirá backend.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSavePresetOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={savePreset}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>

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
            <TextField
              select label="Modo oscuro" value={settings.darkMode ? 'yes' : 'no'}
              onChange={(e) => setSetting('darkMode', e.target.value === 'yes')} fullWidth size="small"
              helperText="Sin estas reglas, Apple Mail y Outlook invierten los colores por su cuenta y suelen romper el contraste."
            >
              <MenuItem value="yes">Adaptar el correo al modo oscuro</MenuItem>
              <MenuItem value="no">No adaptarlo</MenuItem>
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
              select
              label="Plantilla del cliente en SES"
              value={loadName}
              onChange={(e) => setLoadName(e.target.value)}
              fullWidth
              helperText={loadingSesList ? 'Cargando plantillas…' : undefined}
            >
              {loadName && !sesTemplates.some((t) => t.name === loadName) && (
                <MenuItem value={loadName}>{loadName}</MenuItem>
              )}
              {sesTemplates.length === 0 && !loadName && (
                <MenuItem value="" disabled>
                  {loadingSesList ? 'Cargando…' : 'No hay plantillas del cliente en SES'}
                </MenuItem>
              )}
              {sesTemplates.map((t) => (
                <MenuItem key={t.name} value={t.name}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
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
            <TextField
              label="Nombre de la plantilla"
              value={meta.templateName}
              onChange={(e) => setMeta((m) => ({ ...m, templateName: sanitizeTemplateName(e.target.value) }))}
              fullWidth
              helperText="Solo letras, números, guion (-) y guion bajo (_). Los espacios se convierten en guion (-)."
            />
            <TextField label="Asunto" value={meta.subject} onChange={(e) => setMeta((m) => ({ ...m, subject: e.target.value }))} fullWidth />
            <Divider />
            <Typography variant="caption" color="text.secondary">
              Se publica con el endpoint real create-template (canal Email) para{' '}
              <strong>{sessionCustomer || 'tu empresa'}</strong>. El cliente se toma de tu sesión
              {sessionCustomerId ? '' : ' (no disponible: vuelve a iniciar sesión)'}.
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

      {/* Chequeo previo de entregabilidad */}
      <Dialog open={checkOpen} onClose={() => setCheckOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Revisión de la plantilla</DialogTitle>
        <DialogContent dividers>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Peso del correo: <strong>{(bytes / 1024).toFixed(1)} KB</strong>
            </Typography>
            <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
              <Box sx={{
                width: `${Math.min(100, (bytes / GMAIL_CLIP_BYTES) * 100)}%`, height: '100%',
                bgcolor: bytes > GMAIL_CLIP_BYTES ? 'error.main' : bytes > GMAIL_CLIP_BYTES * 0.8 ? 'warning.main' : 'success.main',
              }} />
            </Box>
            <Typography variant="caption" color="text.secondary">límite 102 KB</Typography>
          </Stack>

          {issues.length === 0 ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 3 }}>
              <CheckCircleOutlineIcon color="success" />
              <Typography variant="body2">Todo en orden. La plantilla no tiene problemas conocidos de entregabilidad.</Typography>
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              {issues.map((it, i) => (
                <Stack key={i} direction="row" spacing={1.25} alignItems="flex-start">
                  {it.level === 'error' ? <ErrorOutlineIcon color="error" fontSize="small" />
                    : it.level === 'warning' ? <WarningAmberIcon color="warning" fontSize="small" />
                    : <InfoOutlinedIcon color="info" fontSize="small" />}
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{it.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{it.detail}</Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCheckOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Prueba de envío: el correo real a la bandeja propia, sin salir del editor */}
      <Dialog open={testOpen} onClose={() => setTestOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Enviarme una prueba</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Se envía el correo tal como quedó, con valores de ejemplo en las variables. No
            consume saldo ni cuenta como muestra de una campaña.
          </Typography>
          <TextField
            fullWidth size="small" label="Correo de destino" value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)} placeholder="tu@empresa.com"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={sendTest} disabled={testing || !testEmail.includes('@')}>
            {testing ? <CircularProgress size={22} /> : 'Enviar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Recuperar el autoguardado tras un cierre accidental */}
      <Dialog open={recoverOpen} onClose={() => setRecoverOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Recuperar trabajo sin guardar</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Quedó una plantilla sin publicar de tu última sesión
            {recovered.current?.at ? ` (${new Date(recovered.current.at).toLocaleString('es-CO')})` : ''}. ¿La recuperas?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { localStorage.removeItem(AUTOSAVE_KEY); setRecoverOpen(false); }}>Descartar</Button>
          <Button
            variant="contained" startIcon={<RestoreIcon />}
            onClick={() => {
              const r = recovered.current;
              if (r) { setBlocks(cloneBlocks(r.blocks)); setSettings({ ...DEFAULT_SETTINGS, ...r.settings }); }
              setRecoverOpen(false);
            }}
          >
            Recuperar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Variable con VALOR POR DEFECTO: evita el "Hola ," cuando el dato viene vacío */}
      <Dialog open={Boolean(varDialog)} onClose={() => setVarDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Variable con valor por defecto</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Si el campo viene vacío en la base, se usa el texto de respaldo en lugar de
            dejar un hueco.
          </Typography>
          <Stack spacing={2}>
            <TextField
              select fullWidth size="small" label="Campo"
              value={varDialog?.field ?? ''}
              onChange={(e) => setVarDialog((v) => (v ? { ...v, field: e.target.value } : v))}
            >
              {(dbFields.length ? dbFields : VARIABLES).map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField
              fullWidth size="small" label="Si viene vacío, usar…" placeholder="estimado cliente"
              value={varDialog?.fallback ?? ''}
              onChange={(e) => setVarDialog((v) => (v ? { ...v, fallback: e.target.value } : v))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVarDialog(null)}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (varDialog) insertVariable(variableToken(varDialog.field, varDialog.fallback));
              setVarDialog(null);
            }}
          >
            Insertar
          </Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
    </Box>
  );
};

/* --------- Render de un bloque en el lienzo (aproximado al email) --------- */

/** Texto del bloque tal como saldrá: HTML en línea saneado, o texto plano escapado. */
const Rich = ({ b, field = 'text', sx }: { b: Block; field?: 'text' | 'heading'; sx?: object }) => (
  <Box
    sx={{ '& a': { color: '#0075be' }, '& ul, & ol': { m: '0 0 0 20px', p: 0 }, ...sx }}
    dangerouslySetInnerHTML={{ __html: blockContentHtml(field === 'text' ? b.text : b.heading || '', b.rich) }}
  />
);

/** Marcador de imagen sin definir. Antes se pintaba una imagen de via.placeholder.com,
 *  que podía terminar EN EL CORREO REAL; ahora el hueco es evidente en el lienzo y el
 *  chequeo previo lo reporta como error. */
const ImageSlot = ({ label = 'Sin imagen', height = 120 }: { label?: string; height?: number }) => (
  <Box sx={{
    height, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
    border: '1px dashed #cbd5e1', borderRadius: 1, bgcolor: '#f8fafc', color: '#94a3b8', fontSize: 13,
  }}>
    <AddPhotoAlternateIcon fontSize="small" /> {label}
  </Box>
);

interface PreviewProps {
  block: Block;
  /** Si viene, el bloque está seleccionado y su texto se edita EN EL LIENZO. */
  onEditText?: (patch: Partial<Block>) => void;
  variables?: string[];
  onRequestVariable?: () => void;
}

const BlockPreview = ({ block: b, onEditText, variables = [], onRequestVariable }: PreviewProps) => {
  const align = b.align;
  const editable = Boolean(onEditText);

  /** Campo de texto: editor inline cuando el bloque está seleccionado, si no, estático. */
  const field = (which: 'text' | 'heading', sx: object) =>
    editable ? (
      <RichTextEditor
        value={blockContentHtml(which === 'text' ? b.text : b.heading || '', b.rich)}
        onChange={(html) => onEditText!(which === 'text' ? { text: html, rich: true } : { heading: html, rich: true })}
        style={sx as React.CSSProperties}
        variables={variables}
        onRequestVariable={onRequestVariable}
      />
    ) : (
      <Rich b={b} field={which} sx={sx} />
    );

  switch (b.type) {
    case 'heading':
      return field('text', { fontSize: b.fontSize || 24, fontWeight: 700, color: b.color || '#16233f', textAlign: align });
    case 'text':
      return field('text', { fontSize: b.fontSize || 15, color: b.color || '#333', textAlign: align });
    case 'image':
    case 'logo':
      return b.url ? (
        <Box
          component="img" src={b.url} alt={richToPlain(b.text || '') || 'logo'}
          sx={{
            display: 'block',
            maxWidth: b.imageWidth ? `${b.imageWidth}px` : b.type === 'logo' ? 180 : '100%',
            width: '100%', borderRadius: b.imageRadius ? `${b.imageRadius}px` : 0,
            mx: align === 'center' ? 'auto' : 0,
          }}
        />
      ) : (
        <ImageSlot label={b.type === 'logo' ? 'Sin logo' : 'Sin imagen'} height={b.type === 'logo' ? 54 : 120} />
      );
    case 'button':
      return (
        <Box sx={{ textAlign: align }}>
          <Box component="span" sx={{ display: 'inline-block', px: 2.5, py: 1.2, borderRadius: 1.5, bgcolor: b.color || '#0075be', color: '#fff', fontSize: 15 }}>
            {richToPlain(blockContentHtml(b.text, b.rich)) || b.text}
          </Box>
        </Box>
      );
    case 'columns': {
      const ratio = COLUMN_RATIOS.find((r) => r.value === (b.ratio || '50-50')) || COLUMN_RATIOS[0];
      // Modelo LEGADO (text/textRight sin `cols`): se sigue dibujando para no romper las
      // plantillas guardadas antes de las columnas anidadas.
      const cols: Block[][] = b.cols?.length
        ? b.cols
        : [[{ ...b, type: 'text' as BlockType, cols: undefined }], [{ ...b, type: 'text' as BlockType, text: b.textRight, cols: undefined }]];
      return (
        <Box sx={{ display: 'grid', gridTemplateColumns: ratio.widths.map((w) => `${w}fr`).join(' '), gap: 1.5 }}>
          {ratio.widths.map((_, i) => (
            <Box key={i} sx={{ minHeight: 24 }}>
              {(cols[i] || []).map((child) => (
                <Box key={child.id} sx={{ mb: 1 }}><BlockPreview block={child} /></Box>
              ))}
              {!(cols[i] || []).length && (
                <Box sx={{ border: '1px dashed #cbd5e1', borderRadius: 1, p: 1, color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>
                  Columna vacía
                </Box>
              )}
            </Box>
          ))}
        </Box>
      );
    }
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
    case 'imageText':
    case 'textImage': {
      const img = b.imageUrl
        ? <Box component="img" src={b.imageUrl} alt={richToPlain(b.heading || '')} sx={{ width: '42%', maxWidth: 220, borderRadius: b.imageRadius ? `${b.imageRadius}px` : 1, display: 'block' }} />
        : <Box sx={{ width: '42%' }}><ImageSlot height={140} /></Box>;
      const txt = (
        <Box sx={{ flex: 1 }}>
          {b.heading !== undefined && field('heading', { fontSize: 17, fontWeight: 700, color: '#16233f', marginBottom: '4px' })}
          {field('text', { fontSize: 14, color: '#333' })}
          {b.buttonText && (
            <Box component="span" sx={{ display: 'inline-block', mt: 1, px: 2, py: 0.75, borderRadius: 1.5, bgcolor: b.color || '#0075be', color: '#fff', fontSize: 13 }}>{b.buttonText}</Box>
          )}
        </Box>
      );
      return (
        <Stack direction="row" spacing={2} alignItems="flex-start">
          {b.type === 'imageText' ? <>{img}{txt}</> : <>{txt}{img}</>}
        </Stack>
      );
    }
    case 'textButton':
    case 'buttonTextRow': {
      const btnEl = b.buttonText ? (
        <Box component="span" sx={{ display: 'inline-block', px: 2.5, py: 1.1, borderRadius: 1.5, bgcolor: b.color || '#0075be', color: '#fff', fontSize: 14, whiteSpace: 'nowrap' }}>{b.buttonText}</Box>
      ) : null;
      const txtEl = (
        <Box sx={{ flex: 1 }}>
          {b.heading !== undefined && field('heading', { fontSize: 17, fontWeight: 700, color: '#16233f', marginBottom: '2px' })}
          {field('text', { fontSize: 14, color: '#333' })}
        </Box>
      );
      const btnLeft = b.type === 'buttonTextRow';
      return (
        <Stack direction="row" spacing={2} alignItems="center">
          {btnLeft ? <>{btnEl}{txtEl}</> : <>{txtEl}{btnEl}</>}
        </Stack>
      );
    }
    case 'products': {
      const cols = Math.min(Math.max(b.columns || 3, 1), 4);
      return (
        <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 1.5 }}>
          {(b.items || []).map((it, i) => (
            <Box key={i} sx={{ textAlign: 'center' }}>
              {it.image
                ? <Box component="img" src={it.image} alt={it.title} sx={{ width: '100%', borderRadius: 1, display: 'block', mb: 0.5 }} />
                : <Box sx={{ mb: 0.5 }}><ImageSlot label="" height={90} /></Box>}
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#16233f' }}>{it.title}</Typography>
              <Typography sx={{ fontSize: 12, color: '#555' }}>{it.text}</Typography>
            </Box>
          ))}
        </Box>
      );
    }
    case 'html':
      return <Box sx={{ fontSize: 13, color: '#555555' }} dangerouslySetInnerHTML={{ __html: sanitizeBlockHtml(b.text) }} />;
    case 'divider':
      return <Box sx={{ borderTop: `1px solid ${b.color || '#e4ebf3'}` }} />;
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
  onUploadImage,
  variableFields,
}: {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
  onInsertVariable: (v: string) => void;
  onUploadImage: (file: File) => Promise<string | null>;
  /** Campos de la base seleccionada; si hay, reemplazan a las variables por defecto. */
  variableFields: string[];
}) => {
  const [varAnchor, setVarAnchor] = useState<null | HTMLElement>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [uploadingItem, setUploadingItem] = useState<number | null>(null);
  const isImage = b.type === 'image' || b.type === 'logo';
  const hasText = b.type === 'heading' || b.type === 'text' || b.type === 'button';
  const hasUrl = b.type === 'image' || b.type === 'button' || b.type === 'logo';
  const isCombo = b.type === 'imageText' || b.type === 'textImage';
  const isCta = b.type === 'textButton' || b.type === 'buttonTextRow';
  const isProducts = b.type === 'products';

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingImg(true);
    const url = await onUploadImage(file);
    setUploadingImg(false);
    if (url) onChange(isCombo ? { imageUrl: url } : { url });
  };
  const hasAlign = !['divider', 'spacer', 'html', 'products'].includes(b.type);
  const hasColor = b.type === 'heading' || b.type === 'button';

  /* --- Productos (items) --- */
  const items: ProductItem[] = b.items ?? [];
  const updateItem = (i: number, patch: Partial<ProductItem>) =>
    onChange({ items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const addItem = () =>
    onChange({ items: [...items, { image: '', title: 'Producto', text: 'Descripción breve', url: '' }] });
  const removeItem = (i: number) => onChange({ items: items.filter((_, j) => j !== i) });
  const uploadItemImage = async (i: number, file: File | null) => {
    if (!file) return;
    setUploadingItem(i);
    const url = await onUploadImage(file);
    setUploadingItem(null);
    if (url) updateItem(i, { image: url });
  };

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
              {(variableFields.length ? variableFields : VARIABLES).map((v) => (
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

      {isCombo && (
        <>
          <TextField label="Título" value={b.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} fullWidth size="small" />
          <TextField label="Texto" value={b.text} onChange={(e) => onChange({ text: e.target.value })} fullWidth multiline minRows={3} size="small" />
          <TextField label="URL de la imagen" value={b.imageUrl ?? ''} onChange={(e) => onChange({ imageUrl: e.target.value })} fullWidth size="small" />
          <Button component="label" size="small" variant="outlined" disabled={uploadingImg} startIcon={uploadingImg ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />}>
            {uploadingImg ? 'Subiendo…' : 'Subir imagen a S3'}
            <input type="file" accept="image/*" hidden onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
          </Button>
          <TextField label="Texto del botón (opcional)" value={b.buttonText ?? ''} onChange={(e) => onChange({ buttonText: e.target.value })} fullWidth size="small" placeholder="Ver más" />
          <TextField label="Enlace del botón" value={b.buttonUrl ?? ''} onChange={(e) => onChange({ buttonUrl: e.target.value })} fullWidth size="small" placeholder="https://" />
        </>
      )}

      {isCta && (
        <>
          <TextField label="Título" value={b.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} fullWidth size="small" />
          <TextField label="Texto" value={b.text} onChange={(e) => onChange({ text: e.target.value })} fullWidth multiline minRows={2} size="small" />
          <TextField label="Texto del botón" value={b.buttonText ?? ''} onChange={(e) => onChange({ buttonText: e.target.value })} fullWidth size="small" placeholder="Ver más" />
          <TextField label="Enlace del botón" value={b.buttonUrl ?? ''} onChange={(e) => onChange({ buttonUrl: e.target.value })} fullWidth size="small" placeholder="https://" />
          <TextField label="Color del botón" type="color" value={b.color || '#0075be'} onChange={(e) => onChange({ color: e.target.value })} fullWidth size="small" />
        </>
      )}

      {isProducts && (
        <>
          <TextField select label="Columnas" value={b.columns ?? 3} onChange={(e) => onChange({ columns: parseInt(e.target.value) || 3 })} fullWidth size="small">
            <MenuItem value={2}>2 columnas</MenuItem>
            <MenuItem value={3}>3 columnas</MenuItem>
          </TextField>
          {items.map((it, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>Producto {i + 1}</Typography>
                  <IconButton size="small" color="error" onClick={() => removeItem(i)} disabled={items.length <= 1}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <TextField label="Título" size="small" value={it.title} onChange={(e) => updateItem(i, { title: e.target.value })} fullWidth />
                <TextField label="Texto" size="small" value={it.text} onChange={(e) => updateItem(i, { text: e.target.value })} fullWidth multiline minRows={2} />
                <TextField label="Imagen (URL)" size="small" value={it.image} onChange={(e) => updateItem(i, { image: e.target.value })} fullWidth />
                <TextField label="Enlace (opcional)" size="small" value={it.url ?? ''} onChange={(e) => updateItem(i, { url: e.target.value })} fullWidth placeholder="https://" />
                <Button component="label" size="small" variant="outlined" disabled={uploadingItem === i} startIcon={uploadingItem === i ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />}>
                  {uploadingItem === i ? 'Subiendo…' : 'Subir imagen'}
                  <input type="file" accept="image/*" hidden onChange={(e) => uploadItemImage(i, e.target.files?.[0] ?? null)} />
                </Button>
              </Stack>
            </Paper>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={addItem}>Agregar producto</Button>
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

      {isImage && (
        <Button
          component="label"
          size="small"
          variant="outlined"
          disabled={uploadingImg}
          startIcon={uploadingImg ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />}
        >
          {uploadingImg ? 'Subiendo…' : 'Subir imagen a S3'}
          <input type="file" accept="image/*" hidden onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
        </Button>
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

      {/* ── Opciones de IMAGEN ── */}
      {isImage && (
        <>
          <Divider textAlign="left"><Typography variant="caption" color="text.secondary">Imagen</Typography></Divider>
          <TextField
            label="Al hacer clic, ir a" placeholder="https://…" value={b.imageHref ?? ''}
            onChange={(e) => onChange({ imageHref: e.target.value })} fullWidth size="small"
            helperText="Una imagen de promoción que no es clicable pierde conversiones."
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="Ancho (px)" type="number" value={b.imageWidth ?? ''} placeholder="auto"
              onChange={(e) => onChange({ imageWidth: parseInt(e.target.value) || undefined })}
              fullWidth size="small"
            />
            <TextField
              label="Esquinas" type="number" value={b.imageRadius ?? ''} placeholder="0"
              onChange={(e) => onChange({ imageRadius: parseInt(e.target.value) || undefined })}
              fullWidth size="small"
            />
          </Stack>
        </>
      )}

      {/* ── COLUMNAS: proporción + bloques anidados por columna ── */}
      {b.type === 'columns' && (
        <ColumnsEditor block={b} onChange={onChange} />
      )}

      {/* ── Estilo del bloque (antes TODO compartía padding:10px 24px fijo) ── */}
      <Divider textAlign="left"><Typography variant="caption" color="text.secondary">Estilo del bloque</Typography></Divider>
      <Stack direction="row" spacing={1}>
        <TextField
          label="Relleno ↕" type="number" value={b.padY ?? ''} placeholder="10"
          onChange={(e) => onChange({ padY: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0) })}
          fullWidth size="small"
        />
        <TextField
          label="Relleno ↔" type="number" value={b.padX ?? ''} placeholder="24"
          onChange={(e) => onChange({ padX: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0) })}
          fullWidth size="small"
        />
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          label="Fondo del bloque" type="color" value={b.bgColor || '#ffffff'}
          onChange={(e) => onChange({ bgColor: e.target.value })} fullWidth size="small"
        />
        {b.bgColor && (
          <Tooltip title="Quitar el fondo">
            <IconButton size="small" onClick={() => onChange({ bgColor: undefined })}><FormatClearIcon fontSize="small" /></IconButton>
          </Tooltip>
        )}
      </Stack>
      {(b.type === 'text' || b.type === 'heading') && (
        <TextField
          label="Tamaño de fuente (px)" type="number" value={b.fontSize ?? ''}
          placeholder={b.type === 'heading' ? '26' : '15'}
          onChange={(e) => onChange({ fontSize: parseInt(e.target.value) || undefined })}
          fullWidth size="small"
          helperText="Aplica a todo el bloque; para una palabra suelta usa la barra del editor."
        />
      )}
    </Stack>
  );
};

/* --------- Editor de COLUMNAS: proporción + bloques dentro de cada columna --------- */
const ColumnsEditor = ({ block: b, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) => {
  const ratio = COLUMN_RATIOS.find((r) => r.value === (b.ratio || '50-50')) || COLUMN_RATIOS[0];
  // Migración del modelo LEGADO (text/textRight) al de bloques anidados, en el momento
  // en que el usuario toca las columnas por primera vez.
  const cols: Block[][] = b.cols?.length
    ? b.cols
    : [[{ ...createBlock('text'), text: b.text }], [{ ...createBlock('text'), text: b.textRight }]];

  const setCols = (next: Block[][]) => onChange({ cols: next });

  const changeRatio = (value: ColumnRatio) => {
    const target = COLUMN_RATIOS.find((r) => r.value === value)!;
    const next = target.widths.map((_, i) => cols[i] || []);
    onChange({ ratio: value, cols: next });
  };

  return (
    <>
      <Divider textAlign="left"><Typography variant="caption" color="text.secondary">Columnas</Typography></Divider>
      <TextField
        select label="Proporción" value={b.ratio || '50-50'} size="small" fullWidth
        onChange={(e) => changeRatio(e.target.value as ColumnRatio)}
      >
        {COLUMN_RATIOS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
      </TextField>

      {ratio.widths.map((w, i) => (
        <Box key={i} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
          <Typography variant="caption" color="text.secondary">Columna {i + 1} ({w}%)</Typography>
          <Stack spacing={0.75} sx={{ mt: 0.75 }}>
            {(cols[i] || []).map((child, j) => (
              <Stack key={child.id} direction="row" spacing={0.5} alignItems="center">
                <Typography variant="body2" sx={{ flex: 1 }}>{BLOCK_LABELS[child.type]}</Typography>
                <IconButton
                  size="small" color="error"
                  onClick={() => setCols(cols.map((c, ci) => (ci === i ? c.filter((_, cj) => cj !== j) : c)))}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            {(cols[i] || []).map((child, j) => (
              child.type === 'text' || child.type === 'heading' || child.type === 'button' ? (
                <TextField
                  key={`t${child.id}`} size="small" fullWidth multiline minRows={2}
                  label={`${BLOCK_LABELS[child.type]} ${j + 1}`}
                  value={richToPlain(blockContentHtml(child.text, child.rich))}
                  onChange={(e) => setCols(cols.map((c, ci) => (
                    ci === i ? c.map((cc, cj) => (cj === j ? { ...cc, text: e.target.value, rich: false } : cc)) : c
                  )))}
                />
              ) : null
            ))}
            <TextField
              select size="small" fullWidth value="" label="Agregar bloque"
              onChange={(e) => {
                const t = e.target.value as BlockType;
                if (!t) return;
                setCols(cols.map((c, ci) => (ci === i ? [...c, createBlock(t)] : c)));
              }}
            >
              {NESTABLE_TYPES.map((t) => <MenuItem key={t} value={t}>{BLOCK_LABELS[t]}</MenuItem>)}
            </TextField>
          </Stack>
        </Box>
      ))}
    </>
  );
};
