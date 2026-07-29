import { Fragment, useMemo, useRef, useState, useEffect, useCallback } from 'react';
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
  Slider,
  LinearProgress,
  Chip,
  Alert,
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
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import type { ReactNode } from 'react';
import { getUser } from '../../services/authService';
import { formatDateTime } from '../../utils/datetime';
import { templatesService, sendTestEmail } from '../../services/templatesService';
import type { TemplateSummary } from '../../services/templatesService';
import { campaignsService } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { allPresets, customPresets, cloneBlocks, type TemplatePreset } from './templatePresets';
import { emailDesigns } from '../../services/messageTemplatesService';
import { DatabaseFieldPicker } from './DatabaseFieldPicker';
import { ImageLibraryDialog } from './ImageLibraryDialog';
import { SocialIconPackDialog } from './SocialIconPackDialog';
import { AlignPicker } from './AlignPicker';
import {
  BLOCK_LABELS,
  VARIABLES,
  PALETTE_GROUPS,
  DEFAULT_SETTINGS,
  COLUMN_LAYOUTS,
  MAX_COLUMNS,
  SOCIAL_NETWORKS,
  DEFAULT_SOCIAL_MONO,
  socialMonoColor,
  isHexColor,
  videoThumbnail,
  youtubeId,
  columnWidths,
  NESTABLE_TYPES,
  createBlock,
  generateHtml,
  generatePlainText,
  renderBlock,
  analyzeTemplate,
  htmlBytes,
  GMAIL_CLIP_BYTES,
  drafts,
  type Block,
  type BlockType,
  type EmailSettings,
  type ProductItem,
  type SocialStyle,
  type SocialShape,
  type SocialLinks,
} from './htmlBuilder';
import { RichTextEditor } from './RichTextEditor';
import { blockContentHtml, variableToken, richToPlain } from './richText';

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
  video: <PlayCircleOutlineIcon fontSize="small" />,
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

/* ---- Recorrido del árbol de bloques (un bloque de COLUMNAS contiene otros) ---- */

/** Busca un bloque por id en cualquier nivel. */
const findBlockDeep = (list: Block[], id: string | null): Block | null => {
  if (!id) return null;
  for (const b of list) {
    if (b.id === id) return b;
    for (const col of b.cols || []) {
      const hit = findBlockDeep(col, id);
      if (hit) return hit;
    }
  }
  return null;
};

/** Aplica un parche (objeto o función del bloque actual) al bloque con ese id. */
const patchBlockDeep = (
  list: Block[],
  id: string,
  patch: Partial<Block> | ((b: Block) => Partial<Block>),
): Block[] =>
  list.map((b) => {
    const next = b.id === id ? { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } : b;
    return next.cols ? { ...next, cols: next.cols.map((c) => patchBlockDeep(c, id, patch)) } : next;
  });

/** Elimina el bloque con ese id, esté donde esté. */
const removeBlockDeep = (list: Block[], id: string): Block[] =>
  list
    .filter((b) => b.id !== id)
    .map((b) => (b.cols ? { ...b, cols: b.cols.map((c) => removeBlockDeep(c, id)) } : b));

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

  /**
   * Ventana de edición APARTE (overlay a pantalla completa), igual que el Estudio y el
   * Diseñador de PDF. El menú lateral del portal se lleva ~240 px que en un editor de tres
   * paneles salen del lienzo, que es lo único que de verdad importa aquí.
   */
  const [fullscreen, setFullscreen] = useState(false);

  // Sin esto, la página que queda DEBAJO del overlay sigue scrolleando (y deja su barra a
  // la derecha), que es justo el ruido que la ventana aparte viene a quitar.
  useEffect(() => {
    if (!fullscreen) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previo; };
  }, [fullscreen]);

  /**
   * El armazón es una COLUMNA FLEX de alto acotado: la barra arriba y, debajo, la fila de
   * paneles que se reparte el resto. Cada panel hace su propio scroll (`minHeight:0` es
   * obligatorio: sin él un hijo flex crece en vez de desbordar) en vez de arrastrar toda
   * la página, que era lo que hacía que la paleta y las propiedades se fueran de vista al
   * bajar por un correo largo. En móvil se apila y vuelve al scroll normal de la página:
   * acotar el alto en una pantalla estrecha deja tres cajitas inservibles.
   */
  const shellSx = fullscreen
    ? {
      position: 'fixed' as const, inset: 0, zIndex: 1300,
      bgcolor: 'background.default', p: 2,
      display: 'flex', flexDirection: 'column' as const,
    }
    : {
      display: 'flex', flexDirection: 'column' as const,
      height: { md: 'calc(100vh - 168px)' },
      minHeight: { md: 520 },
    };
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
      // Nunca se secuestra un atajo mientras se escribe: dentro de un campo o del editor
      // de texto, Ctrl+Z y Supr son del navegador y hacen falta.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;

      const k = e.key.toLowerCase();

      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); travel(-1); }
        else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); travel(1); }
        else if (k === 'd' && selectedIdRef.current) {
          e.preventDefault();
          duplicateBlock(selectedIdRef.current);
        }
        return;
      }

      // Esc: primero suelta la selección y, si no hay nada seleccionado, cierra la ventana
      // de edición. Es lo que espera quien abrió una pantalla completa.
      if (e.key === 'Escape') {
        if (selectedIdRef.current) setSelectedId(null);
        else setFullscreen(false);
        return;
      }

      const id = selectedIdRef.current;
      if (!id) return;

      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeBlock(id); return; }
      // Alt+flechas mueve el bloque; las flechas solas se dejan al desplazamiento normal.
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const idx = blocksRef.current.findIndex((b) => b.id === id);
        if (idx >= 0) move(idx, e.key === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Referencias vivas para el manejador de teclado: se registra UNA vez, así que sin
  // ellas leería el estado del primer render.
  const selectedIdRef = useRef<string | null>(null);
  const blocksRef = useRef<Block[]>([]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

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
  // Menú del "+" de una columna vacía: qué bloque meter y en qué columna.
  const [columnAdd, setColumnAdd] = useState<{ blockId: string; colIndex: number; anchor: HTMLElement } | null>(null);
  // Columna sobre la que se está arrastrando algo (para resaltar su "+").
  const [columnHover, setColumnHover] = useState<{ blockId: string; colIndex: number } | null>(null);
  const [draftsAnchor, setDraftsAnchor] = useState<null | HTMLElement>(null);
  const [showHtml, setShowHtml] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadName, setLoadName] = useState('');
  const [sesTemplates, setSesTemplates] = useState<TemplateSummary[]>([]);
  const [loadingSesList, setLoadingSesList] = useState(false);

  /** Abre el diálogo de carga y trae la lista de plantillas SES del cliente. */
  /** Abre el diálogo y trae las DOS fuentes: diseños editables y plantillas de SES. */
  const openLoadDialog = async () => {
    setLoadOpen(true);
    if (!sessionCustomer && !sessionCustomerId) return;
    setLoadingSesList(true);
    const res = await templatesService.list(sessionCustomer, sessionCustomerId);
    setLoadingSesList(false);
    if (isOk(res) && res.data?.templates) setSesTemplates(res.data.templates);
    void cargarDisenos();
  };

  /** Carga un diseño editable en el lienzo (bloques + ajustes, tal cual se guardaron). */
  const loadDesign = (d: TemplatePreset) => {
    setBlocks(cloneBlocks(d.blocks));
    setSettings({ ...d.settings });
    setSelectedId(null);
    setDesignId(d.messageTemplateId ?? null);
    setDesignName(d.name);
    // Republicar debe apuntar a la MISMA plantilla de SES, no crear otra con nombre nuevo.
    setMeta({ templateName: d.name, subject: d.subject || '' });
    setLoadOpen(false);
    notify(`Diseño "${d.name}" cargado. Puedes editarlo bloque a bloque.`, 'success');
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
  /** Diseño editable que se está trabajando: al republicar se VERSIONA en vez de duplicar. */
  const [designId, setDesignId] = useState<string | null>(null);
  const [designName, setDesignName] = useState('');
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  /** Diseños editables del equipo (backend). */
  const [sharedDesigns, setSharedDesigns] = useState<TemplatePreset[]>([]);

  /**
   * Plantillas que SOLO existen en SES (sin diseño editable): las creadas antes de esta
   * función o fuera del constructor. Son las únicas para las que tiene sentido importar
   * HTML crudo.
   */
  const sesOnly = useMemo(() => {
    const publicadas = new Set(sharedDesigns.map((d) => d.sesTemplate).filter(Boolean));
    return sesTemplates.filter((t) => !publicadas.has(t.name));
  }, [sesTemplates, sharedDesigns]);

  const html = useMemo(() => generateHtml(blocks, settings), [blocks, settings]);
  // Chequeo previo de entregabilidad (peso, alt, enlaces vacíos, imagen/texto…).
  const issues = useMemo(() => analyzeTemplate(blocks, settings, html), [blocks, settings, html]);
  const bytes = useMemo(() => htmlBytes(html), [html]);
  const plainText = useMemo(() => generatePlainText(blocks, settings), [blocks, settings]);
  // La selección puede apuntar a un bloque ANIDADO dentro de una columna, así que la
  // búsqueda y las mutaciones recorren el árbol, no solo el primer nivel.
  const selected = findBlockDeep(blocks, selectedId) ?? null;

  const setSetting = <K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  /* ---------------- Bloques ---------------- */
  /**
   * Agrega un bloque por CLIC (sin arrastrar). Va justo DEBAJO del bloque seleccionado:
   * al final del todo obligaba a arrastrarlo de vuelta por medio correo, que es lo que
   * uno acaba de evitar al hacer clic en vez de arrastrar. Sin selección, al final.
   *
   * ⚠️ Solo se inserta al lado de un bloque del nivel SUPERIOR: si el seleccionado está
   * dentro de una columna, `findIndex` no lo encuentra y cae al final — meterlo en la
   * celda por clic sería ambiguo (¿en la celda o después de las columnas?); para eso está
   * el "+" de cada celda.
   */
  const addBlock = (type: BlockType, alFinal = false) => {
    const b = createBlock(type);
    setBlocks((prev) => {
      const i = alFinal || !selectedId ? -1 : prev.findIndex((x) => x.id === selectedId);
      if (i < 0) return [...prev, b];
      const next = [...prev];
      next.splice(i + 1, 0, b);
      return next;
    });
    setSelectedId(b.id);
  };

  const updateSelected = (patch: Partial<Block>) => {
    if (!selectedId) return;
    setBlocks((prev) => patchBlockDeep(prev, selectedId, patch));
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => removeBlockDeep(prev, id));
    if (selectedId === id) setSelectedId(null);
  };

  /**
   * ¿El arrastre actual se puede soltar DENTRO de una columna? Solo los tipos anidables:
   * meter una tabla ancha (columnas, productos, redes) en una celda estrecha la desarma.
   */
  const dragFitsColumn = (): boolean => {
    const src = dragSource.current;
    if (!src) return false;
    const type = src.kind === 'palette' ? src.type : blocks[src.index]?.type;
    return Boolean(type && NESTABLE_TYPES.includes(type));
  };

  /** Suelta el arrastre en curso dentro de una columna. */
  const dropInColumn = (columnsId: string, colIndex: number) => {
    const src = dragSource.current;
    endDrag();
    setColumnHover(null);
    if (!src) return;

    if (src.kind === 'palette') {
      addToColumn(columnsId, colIndex, src.type);
      return;
    }
    // Mover un bloque que ya estaba en el lienzo: sale del nivel superior y entra a la
    // columna, en una sola actualización para no dejar un estado intermedio inconsistente.
    const moved = blocks[src.index];
    if (!moved || !NESTABLE_TYPES.includes(moved.type)) return;
    setBlocks((prev) => patchBlockDeep(removeBlockDeep(prev, moved.id), columnsId, (b) => ({
      cols: (b.cols || []).map((c, i) => (i === colIndex ? [...c, moved] : c)),
    })));
    setSelectedId(moved.id);
  };

  /** Agrega un bloque DENTRO de una columna (el "+" del lienzo). */
  const addToColumn = (columnsId: string, colIndex: number, type: BlockType) => {
    const child = createBlock(type);
    setBlocks((prev) => patchBlockDeep(prev, columnsId, (b) => ({
      cols: (b.cols || []).map((c, i) => (i === colIndex ? [...c, child] : c)),
    })));
    setSelectedId(child.id);
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
    setColumnHover(null);   // si el arrastre terminó fuera, el "+" no debe quedar resaltado
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
    // Se sueltan DESPUÉS de confirmar: si se soltaran antes, cancelar el diálogo dejaría
    // el lienzo intacto pero sin saber a qué diseño pertenece, y el siguiente Publicar
    // crearía una plantilla nueva en vez de actualizar la que se estaba editando.
    setDesignId(null);
    setDesignName('');
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
      // Alternativa de texto plano completa (recorre TODO, incluidas las columnas, y
      // lleva el enlace de baja). Antes emitía el HTML crudo de los bloques enriquecidos
      // y se saltaba botones/columnas/productos.
      textBody: plainText,
    });
    if (!isOk(res)) {
      setSaving(false);
      return notify(res.description || 'No se pudo publicar la plantilla.', 'error');
    }

    // SES guarda el HTML ya renderizado: eso es lo que se ENVÍA, pero no se puede volver a
    // convertir en bloques. Así que al publicar se guarda además el MODELO editable, con
    // el nombre de la plantilla SES dentro para dejarlos emparejados. Sin esto, "cargar"
    // solo podía devolver HTML crudo y el diseño quedaba perdido.
    const sesName = (res.data as { templateName?: string } | undefined)?.templateName || meta.templateName;
    const guardado = await emailDesigns.save(
      sessionCustomerId,
      meta.templateName,
      { blocks, settings, sesTemplate: sesName, subject: meta.subject },
      designId ?? sharedDesigns.find((d) => d.name === meta.templateName)?.messageTemplateId,
    );
    setSaving(false);
    setSaveOpen(false);
    if (isOk(guardado)) {
      if (guardado.data?.messageTemplateId) setDesignId(guardado.data.messageTemplateId);
      setDesignName(meta.templateName);
      notify('Plantilla publicada en SES y guardada como diseño editable.', 'success');
    } else {
      notify('Publicada en SES, pero el diseño editable no se pudo guardar: '
        + (guardado.description || 'error') + '. Guárdalo con "Guardar plantilla".', 'warning');
    }
  };

  const draftList = useMemo(() => drafts.list(), [draftsVersion]);

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
    // Una prediseñada INTEGRADA es un punto de partida, no un diseño guardado: solo se
    // adopta la identidad cuando viene del backend (tiene id).
    setDesignId(p.messageTemplateId ?? null);
    setDesignName(p.messageTemplateId ? p.name : '');
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
   * DUPLICAR una plantilla: la copia queda con nombre propio, así se puede partir de un
   * diseño aprobado sin arriesgarse a pisarlo (guardar con el MISMO nombre versiona el
   * original). Se guarda en backend y en el espejo local, como el resto de la galería.
   */
  const duplicatePreset = async (p: TemplatePreset, e: React.MouseEvent) => {
    e.stopPropagation();
    const usados = new Set(presetList.map((x) => x.name));
    let name = `${p.name} (copia)`;
    for (let i = 2; usados.has(name); i += 1) name = `${p.name} (copia ${i})`;
    const description = p.description || 'Copia';
    customPresets.save(name, cloneBlocks(p.blocks), p.settings, description);
    setPresetsVersion((v) => v + 1);

    // Sin messageTemplateId → el backend CREA una plantilla nueva (no versiona el original).
    const res = await emailDesigns.save(sessionCustomerId, name, {
      blocks: p.blocks, settings: p.settings, description,
    });
    if (isOk(res)) {
      setSharedDesigns((prev) => [
        ...prev,
        { ...p, id: `shared:${res.data?.messageTemplateId ?? name}`, name, description, custom: true, messageTemplateId: res.data?.messageTemplateId, history: [] },
      ]);
      notify(`Se creó "${name}".`, 'success');
    } else {
      notify(`"${name}" quedó solo en este navegador (${res.description || 'error'}).`, 'warning');
    }
  };

  /** Historial de versiones del diseño abierto en el diálogo (null = cerrado). */
  const [historyOf, setHistoryOf] = useState<TemplatePreset | null>(null);

  /** Carga una versión anterior en el lienzo. No la publica: hay que guardar para fijarla. */
  const restoreVersion = (raw: string, at: string) => {
    try {
      const d = JSON.parse(raw || '{}');
      if (!d?.blocks?.length) throw new Error('vacío');
      setBlocks(cloneBlocks(d.blocks as Block[]));
      setSettings({ ...DEFAULT_SETTINGS, ...(d.settings || {}) });
      setSelectedId(null);
      setHistoryOf(null);
      setPresetsOpen(false);
      notify(`Versión del ${formatDateTime(at)} cargada. Guárdala para dejarla como la vigente.`, 'success');
    } catch {
      notify('Esa versión no se pudo leer.', 'error');
    }
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

    // Si ya existe un diseño con ESE nombre se actualiza (el backend guarda la versión
    // anterior en el historial); si no, se crea. Así "guardar" no llena la galería de
    // copias y sí deja rastro de los cambios.
    const previo = sharedDesigns.find((d) => d.name === name)?.messageTemplateId;
    const res = await emailDesigns.save(sessionCustomerId, name, {
      blocks, settings, description: presetMeta.description.trim(),
    }, previo);
    if (isOk(res)) {
      if (res.data?.messageTemplateId) setDesignId(res.data.messageTemplateId);
      setDesignName(name);
      notify(`Plantilla "${name}" guardada y compartida con tu equipo.`, 'success');
    } else {
      notify(`Plantilla "${name}" guardada solo en este navegador (no se pudo compartir: ${res.description || 'error'}).`, 'warning');
    }
  };

  /** Trae los diseños editables del equipo (canal HTML de `messageTemplate`). */
  const cargarDisenos = useCallback(async () => {
    if (!sessionCustomerId) return;
    setLoadingDesigns(true);
    const res = await emailDesigns.list(sessionCustomerId);
    setLoadingDesigns(false);
    if (!isOk(res)) return;
    setSharedDesigns((res.data?.templates ?? []).flatMap((t) => {
      try {
        const d = JSON.parse(t.designJson || '{}');
        if (!d?.blocks?.length) return [];
        return [{
          id: `shared:${t.messageTemplateId}`,
          name: t.name,
          description: d.description || 'Compartida con el equipo',
          blocks: d.blocks as Block[],
          settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
          custom: true,
          messageTemplateId: t.messageTemplateId,
          history: t.designHistory ?? [],
          sesTemplate: d.sesTemplate,
          subject: d.subject,
        } as TemplatePreset];
      } catch { return []; }
    }));
  }, [sessionCustomerId]);

  useEffect(() => { if (presetsOpen) void cargarDisenos(); }, [presetsOpen, cargarDisenos]);

  return (
    <Box sx={shellSx}>
      {/* Barra de herramientas */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}
        sx={{ flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant={fullscreen ? 'h6' : 'h4'}>Plantillas HTML</Typography>
          {designName && (
            <Tooltip title="Diseño editable abierto. Al publicar se actualiza este mismo.">
              <Chip size="small" color="primary" variant="outlined" label={designName} />
            </Tooltip>
          )}
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
            Cargar
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
          {/* Los atajos no se descubren solos: sin esta ayuda nadie sabría que existen. */}
          <Tooltip
            title={
              <Box sx={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                {'Atajos de teclado\n'
                  + 'Ctrl+Z / Ctrl+Shift+Z · deshacer / rehacer\n'
                  + 'Ctrl+D · duplicar el bloque seleccionado\n'
                  + 'Supr · eliminar el bloque seleccionado\n'
                  + 'Alt+↑ / Alt+↓ · mover el bloque\n'
                  + 'Esc · quitar la selección (y cerrar la ventana de edición)'}
              </Box>
            }
          >
            <IconButton size="small"><KeyboardIcon fontSize="small" /></IconButton>
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
          {/* Ventana aparte: el menú lateral del portal se lleva ~240 px que en un editor
              de 3 paneles se notan en el lienzo, que es lo único que importa aquí. */}
          <Tooltip title={fullscreen ? 'Salir de la ventana de edición (Esc)' : 'Abrir el editor en una ventana aparte'}>
            <IconButton size="small" onClick={() => setFullscreen((f) => !f)}>
              {fullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
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

      {/* Campos de la base: alimentan el menú "Insertar variable" y permiten insertar en
          el bloque seleccionado. Va ARRIBA (no al fondo del panel de propiedades, donde
          quedaba fuera de vista en cuanto el bloque tenía muchas opciones). */}
      {view === 'editor' && (
        <Box sx={{ mb: 2, flexShrink: 0 }}>
          <DatabaseFieldPicker compact onFieldsChange={setDbFields} onInsert={insertVariable} />
        </Box>
      )}

      {view === 'preview' ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: { md: 'auto' } }}>
          {/* Lo que realmente decide si abren el correo es la terna remitente + asunto +
              preheader, y hasta ahora no había forma de verla junta: el asunto vivía en el
              diálogo de publicar y el preheader en ajustes. */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2, maxWidth: 720, mx: 'auto' }}>
            <Typography variant="overline" color="text.secondary">Así llega a la bandeja</Typography>
            <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mt: 1 }}>
              <Box sx={{
                width: 40, height: 40, borderRadius: '50%', bgcolor: 'primary.main', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0,
              }}>
                {(sessionCustomer || 'M').charAt(0).toUpperCase()}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={700} noWrap>
                  {sessionCustomer || 'Tu empresa'}
                </Typography>
                <Typography variant="body2" fontWeight={600} noWrap sx={{ color: meta.subject ? 'text.primary' : 'error.main' }}>
                  {meta.subject || '(sin asunto — lo pide el diálogo de Publicar)'}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {settings.preheader || '(sin texto de vista previa — el cliente de correo mostrará el primer texto que encuentre)'}
                </Typography>
              </Box>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
              <TextField
                size="small" fullWidth label="Asunto" value={meta.subject}
                onChange={(e) => setMeta((m) => ({ ...m, subject: e.target.value }))}
                helperText={`${meta.subject.length} caracteres · a partir de ~45 se recorta en móvil`}
                error={meta.subject.length > 70}
              />
              <TextField
                size="small" fullWidth label="Texto de vista previa" value={settings.preheader}
                onChange={(e) => setSetting('preheader', e.target.value)}
                helperText={`${settings.preheader.length} caracteres · se ve junto al asunto`}
              />
            </Stack>
          </Paper>

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
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch"
          sx={{ flex: 1, minHeight: 0 }}>
          {/* Paleta agrupada (con icono por bloque). Queda FIJA: solo hace scroll si su
              propio contenido no cabe, nunca por lo largo que sea el correo. */}
          <Paper variant="outlined" sx={{
            p: 1.5, width: { md: 200 }, flexShrink: 0,
            overflowY: { md: 'auto' }, minHeight: 0,
          }}>
            {PALETTE_GROUPS.map((group) => (
              <Box key={group.label} sx={{ mb: 1 }}>
                <Typography variant="overline" color="text.secondary"
                  sx={{ px: 0.5, letterSpacing: 0.6, fontSize: 10, lineHeight: 1.8 }}>
                  {group.label}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 0.25 }}>
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
                        gap: 0.15,
                        py: 0.6,
                        px: 0.5,
                        minWidth: 0,
                        textTransform: 'none',
                        fontSize: 10.5,
                        lineHeight: 1.15,
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

          {/* Lienzo: hoja de correo centrada sobre un backdrop (theme-aware). Es el único
              panel que suele desbordar, y ahora hace SU scroll sin mover a los otros dos. */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: { xs: '72vh', md: 0 },
              overflowY: { md: 'auto' },
              borderRadius: 2,
              p: { xs: 1.5, md: 3 },
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              // El FONDO DE PÁGINA de Ajustes, igual que en la vista previa y en el correo.
              // Antes era un gris fijo, así que el ajuste "no hacía nada" en el editor.
              bgcolor: settings.pageBg,
            }}
          >
            <Box
              sx={{
                width: settings.contentWidth,
                maxWidth: '100%',
                bgcolor: settings.emailBg,
                color: settings.textColor,
                fontFamily: settings.fontFamily,
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
                  // Aire arriba para que la barra de herramientas del PRIMER bloque (que
                  // flota por encima de él) no la recorte el borde de la hoja.
                  sx={{ pt: 5 }}
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
                        // COMPLETAMENTE por encima del bloque, no montada sobre su borde:
                        // la barra mide ~30 px, así que se sube su alto entero (con -16
                        // seguía tapando la primera línea del bloque seleccionado).
                        top: -34,
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
                    {/* El lienzo refleja el relleno y el fondo PROPIOS del bloque: antes
                        eran fijos (p:2), así que configurabas un fondo de sección y no se
                        veía nada hasta la vista previa. */}
                    <Box sx={{
                      py: `${b.padY ?? 10}px`,
                      px: `${b.padX ?? 24}px`,
                      bgcolor: b.bgColor || 'transparent',
                    }}>
                      <BlockPreview
                        block={b}
                        settings={settings}
                        selectedId={selectedId}
                        onEditText={selectedId === b.id ? (patch) => updateSelected(patch) : undefined}
                        onSelectChild={setSelectedId}
                        onEditChild={(id, patch) => setBlocks((prev) => patchBlockDeep(prev, id, patch))}
                        onAddToColumn={(colIndex, anchor) => setColumnAdd({ blockId: b.id, colIndex, anchor })}
                        dragging={dragging}
                        canDropInColumn={dragFitsColumn()}
                        hoverColumn={columnHover?.blockId === b.id ? columnHover.colIndex : null}
                        onColumnDragOver={(colIndex) => setColumnHover({ blockId: b.id, colIndex })}
                        onColumnDragLeave={() => setColumnHover(null)}
                        onDropInColumn={(colIndex) => dropInColumn(b.id, colIndex)}
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

          {/* Menú del "+" de una columna vacía: los tipos ANIDABLES (nada que ya sea una
              tabla ancha, que dentro de una celda estrecha se desarma). */}
          <Menu
            anchorEl={columnAdd?.anchor ?? null} open={Boolean(columnAdd)}
            onClose={() => setColumnAdd(null)}
          >
            {NESTABLE_TYPES.map((t) => (
              <MenuItem
                key={t}
                onClick={() => {
                  if (columnAdd) addToColumn(columnAdd.blockId, columnAdd.colIndex, t);
                  setColumnAdd(null);
                }}
              >
                <Box sx={{ mr: 1, display: 'flex', color: 'primary.main' }}>{BLOCK_ICONS[t]}</Box>
                {BLOCK_LABELS[t]}
              </MenuItem>
            ))}
          </Menu>

          {/* Menú del botón "Agregar bloque" de la zona final: agrega SIEMPRE al final,
              sin tener que arrastrar ni acertarle a la franja de abajo. */}
          <Menu anchorEl={appendAnchor} open={Boolean(appendAnchor)} onClose={() => setAppendAnchor(null)}>
            {PALETTE_GROUPS.map((g) => [
              <MenuItem key={g.label} disabled sx={{ opacity: 1 }}>
                <Typography variant="overline" color="text.secondary">{g.label}</Typography>
              </MenuItem>,
              ...g.types.map((t) => (
                <MenuItem key={t} onClick={() => { addBlock(t, true); setAppendAnchor(null); }} sx={{ pl: 3 }}>
                  <Box sx={{ mr: 1, display: 'flex', color: 'primary.main' }}>{BLOCK_ICONS[t]}</Box>
                  {BLOCK_LABELS[t]}
                </MenuItem>
              )),
            ])}
          </Menu>

          {/* Propiedades: su propio scroll — un bloque con muchas opciones (redes,
              productos) es más alto que la pantalla y antes empujaba la página entera. */}
          <Paper variant="outlined" sx={{
            p: 2, width: { md: 300 }, flexShrink: 0,
            overflowY: { md: 'auto' }, minHeight: 0,
          }}>
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
                      <Box component="span" sx={{ fontSize: 11, color: 'primary.main', border: '1px solid', borderColor: 'primary.main', borderRadius: 1, px: 0.5 }}>
                        Personalizada
                      </Box>
                    )}
                    <Tooltip title="Duplicar">
                      <IconButton size="small" onClick={(e) => duplicatePreset(p, e)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {!!p.history?.length && (
                      <Tooltip title={`${p.history.length} versión(es) anterior(es)`}>
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setHistoryOf(p); }}>
                          <RestoreIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {p.custom && (
                      <Tooltip title="Eliminar">
                        <IconButton size="small" color="error" onClick={(e) => deleteCustomPreset(p.name, e)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
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

      {/* Versiones anteriores de una plantilla compartida */}
      <Dialog open={!!historyOf} onClose={() => setHistoryOf(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Versiones de "{historyOf?.name}"</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Cada vez que alguien guarda con este nombre, la versión anterior queda aquí
            (se conservan las 10 más recientes). Restaurar la carga en el lienzo; para
            dejarla como la vigente hay que volver a guardar.
          </Typography>
          <Stack spacing={1}>
            {(historyOf?.history ?? []).map((v, i) => (
              <Paper key={`${v.at}-${i}`} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={600}>{formatDateTime(v.at)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {i === 0 ? 'Versión anterior más reciente' : `${i + 1}ª versión hacia atrás`}
                      {' · '}{(new Blob([v.designJson || '']).size / 1024).toFixed(1)} KB
                    </Typography>
                  </Box>
                  <Button size="small" startIcon={<RestoreIcon />} onClick={() => restoreVersion(v.designJson, v.at)}>
                    Restaurar
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOf(null)}>Cerrar</Button>
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
              Queda disponible en "Plantillas" para todo tu equipo. Si ya existe una con el
              mismo nombre, se actualiza y la versión anterior se guarda en su historial;
              usa "Duplicar" en la galería si prefieres no tocar el original.
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
            <Divider textAlign="left" sx={{ gridColumn: '1 / -1' }}>
              <Typography variant="caption" color="text.secondary">Seguimiento (UTM)</Typography>
            </Divider>
            <TextField
              select label="Etiquetar los enlaces" size="small" fullWidth
              value={settings.utm?.enabled ? 'yes' : 'no'}
              onChange={(e) => setSetting('utm', { ...settings.utm, enabled: e.target.value === 'yes' })}
              helperText="Sin UTM, el tráfico del correo llega a Analytics como “directo” y la campaña no se puede medir."
            >
              <MenuItem value="yes">Sí, agregar UTM</MenuItem>
              <MenuItem value="no">No etiquetar</MenuItem>
            </TextField>
            {settings.utm?.enabled && (
              <>
                <TextField
                  label="utm_source" size="small" fullWidth value={settings.utm.source}
                  onChange={(e) => setSetting('utm', { ...settings.utm, source: e.target.value })}
                />
                <TextField
                  label="utm_medium" size="small" fullWidth value={settings.utm.medium}
                  onChange={(e) => setSetting('utm', { ...settings.utm, medium: e.target.value })}
                />
                <TextField
                  label="utm_campaign" size="small" fullWidth value={settings.utm.campaign}
                  onChange={(e) => setSetting('utm', { ...settings.utm, campaign: e.target.value })}
                  placeholder="boletin-agosto"
                  helperText="Los enlaces que ya traigan utm_source a mano no se tocan."
                />
              </>
            )}
            <Divider textAlign="left" sx={{ gridColumn: '1 / -1' }}>
              <Typography variant="caption" color="text.secondary">Apariencia</Typography>
            </Divider>
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

      {/* Cargar: diseño EDITABLE (preferido) o plantilla de SES (HTML crudo) */}
      <Dialog open={loadOpen} onClose={() => setLoadOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cargar una plantilla</DialogTitle>
        <DialogContent dividers>
          {/* Los diseños editables van PRIMERO porque son los que se pueden seguir
              trabajando bloque a bloque. El HTML de SES solo vuelve como un bloque crudo:
              es lo que se envía, no el modelo con el que se construyó. */}
          <Typography variant="overline" color="text.secondary">Diseños editables</Typography>
          {loadingDesigns && <LinearProgress sx={{ my: 1 }} />}
          {!loadingDesigns && sharedDesigns.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Todavía no tienes diseños guardados. Al publicar se guarda uno automáticamente.
            </Typography>
          )}
          <Stack spacing={1} sx={{ mt: 1, mb: 2 }}>
            {sharedDesigns.map((d) => (
              <Paper key={d.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{d.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {d.sesTemplate ? `Publicada en SES como ${d.sesTemplate}` : 'Sin publicar en SES'}
                    </Typography>
                  </Box>
                  {d.sesTemplate && <Chip size="small" color="success" variant="outlined" label="publicada" />}
                  <Button size="small" variant="contained" onClick={() => loadDesign(d)}>Abrir</Button>
                </Stack>
              </Paper>
            ))}
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Typography variant="overline" color="text.secondary">Solo en SES (HTML)</Typography>
          <TextField
            select
            label="Plantilla del cliente en SES"
            value={loadName}
            onChange={(e) => setLoadName(e.target.value)}
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            helperText={loadingSesList ? 'Cargando plantillas…' : undefined}
          >
            {loadName && !sesOnly.some((t) => t.name === loadName) && (
              <MenuItem value={loadName}>{loadName}</MenuItem>
            )}
            {sesOnly.length === 0 && !loadName && (
              <MenuItem value="" disabled>
                {loadingSesList ? 'Cargando…' : 'Todas tus plantillas de SES tienen su diseño editable'}
              </MenuItem>
            )}
            {sesOnly.map((t) => (
              <MenuItem key={t.name} value={t.name}>{t.name}</MenuItem>
            ))}
          </TextField>
          <Alert severity="info" sx={{ mt: 1.5 }}>
            Estas entran como un bloque de <strong>HTML crudo</strong>: SES guarda el correo ya
            armado, no los bloques con los que se hizo, así que no se puede deshacer a piezas.
            Sirve para retocar y republicar; para editar cómodo, usa un diseño editable.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoadOpen(false)} disabled={loading}>Cancelar</Button>
          <Button variant="outlined" onClick={handleLoadFromSes} disabled={loading || !loadName.trim()}>
            {loading ? <CircularProgress size={22} /> : 'Cargar el HTML de SES'}
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

/**
 * Imagen del lienzo con TIRADOR de redimensionado. Antes el ancho solo se podía cambiar
 * por un campo numérico en el panel, que es justo lo contrario de lo que se espera al
 * ver una imagen seleccionada.
 *
 * El tirador aparece solo cuando el bloque está seleccionado (`onResize` definido) y el
 * ancho se acota al del contenedor: una imagen más ancha que el correo se recorta.
 */
const ResizableImage = ({
  block: b, maxWidth, onResize,
}: { block: Block; maxWidth: number; onResize?: (w: number) => void }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dragW, setDragW] = useState<number | null>(null);

  const ancho = dragW ?? b.imageWidth ?? (b.type === 'logo' ? 180 : maxWidth);

  const startResize = (e: React.MouseEvent) => {
    if (!onResize) return;
    e.preventDefault();
    e.stopPropagation();
    const inicioX = e.clientX;
    const inicioW = ancho;

    const mover = (ev: MouseEvent) => {
      // Se redimensiona desde el borde derecho; con la imagen centrada el ancho crece al
      // doble de rápido que el cursor (crece por los dos lados), y así se siente natural.
      const factor = b.align === 'center' ? 2 : 1;
      setDragW(Math.max(40, Math.min(maxWidth, Math.round(inicioW + (ev.clientX - inicioX) * factor))));
    };
    const soltar = () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      setDragW((w) => { if (w != null) onResize(w); return null; });
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  };

  return (
    <Box
      ref={wrapRef}
      sx={{
        position: 'relative', display: 'inline-block', maxWidth: '100%',
        width: `${ancho}px`,
        ...(b.align === 'center' ? { display: 'block', mx: 'auto' } : {}),
        ...(b.align === 'right' ? { display: 'block', ml: 'auto' } : {}),
      }}
    >
      <Box
        component="img" src={b.url} alt={richToPlain(b.text || '') || 'imagen'}
        sx={{ display: 'block', width: '100%', borderRadius: b.imageRadius ? `${b.imageRadius}px` : 0 }}
      />
      {onResize && (
        <>
          <Box
            onMouseDown={startResize}
            sx={{
              position: 'absolute', top: '50%', right: -7, transform: 'translateY(-50%)',
              width: 14, height: 34, borderRadius: 1, cursor: 'ew-resize',
              bgcolor: 'primary.main', border: '2px solid #fff', boxShadow: 2, zIndex: 3,
            }}
          />
          <Box sx={{
            position: 'absolute', bottom: 4, right: 4, px: 0.75, borderRadius: 0.5,
            bgcolor: 'rgba(16,35,63,.75)', color: '#fff', fontSize: 11, zIndex: 3,
          }}>
            {Math.round(ancho)} px
          </Box>
        </>
      )}
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
  /** Selección actual (para resaltar el hijo activo dentro de una columna). */
  selectedId?: string | null;
  /** Selecciona un bloque ANIDADO dentro de una columna. */
  onSelectChild?: (id: string) => void;
  /** Edita el texto de un bloque anidado. */
  onEditChild?: (id: string, patch: Partial<Block>) => void;
  /** Ajustes del correo: el lienzo dibuja el HTML REAL, así que los necesita. */
  settings: EmailSettings;
  /** Abre el menú para agregar un bloque a la columna `i` (el "+" del lienzo). */
  onAddToColumn?: (colIndex: number, anchor: HTMLElement) => void;
  /** Hay un arrastre en curso en el lienzo. */
  dragging?: boolean;
  /** Lo que se arrastra CABE dentro de una columna (tipo anidable). */
  canDropInColumn?: boolean;
  /** Índice de la columna bajo el cursor (para resaltarla). */
  hoverColumn?: number | null;
  onColumnDragOver?: (colIndex: number) => void;
  onColumnDragLeave?: () => void;
  onDropInColumn?: (colIndex: number) => void;
}

const BlockPreview = ({
  block: b, onEditText, variables = [], onRequestVariable, settings: st,
  selectedId, onSelectChild, onEditChild, onAddToColumn,
  dragging, canDropInColumn, hoverColumn, onColumnDragOver, onColumnDragLeave, onDropInColumn,
}: PreviewProps) => {
  const align = b.align;
  const editable = Boolean(onEditText);

  /**
   * Render FIEL: el mismo HTML que va a viajar en el correo. Se usa para todo lo que no
   * necesita interacción propia en el lienzo, así que lo que se ve al editar es
   * literalmente lo que se envía — no una aproximación que puede divergir.
   */
  const Fiel = () => (
    <Box
      sx={{ '& img': { maxWidth: '100%' } }}
      dangerouslySetInnerHTML={{ __html: renderBlock(b, st) }}
    />
  );

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
      return field('text', {
        fontSize: b.fontSize || 24, fontWeight: 700, textAlign: align,
        fontFamily: st.fontFamily, color: b.color || st.textColor,
      });
    case 'text':
      return field('text', {
        fontSize: b.fontSize || 15, textAlign: align,
        fontFamily: st.fontFamily, color: b.color || st.textColor,
      });
    case 'image':
    case 'logo':
      return b.url ? (
        <ResizableImage
          block={b}
          maxWidth={st.contentWidth - (b.padX ?? 24) * 2}
          onResize={onEditText ? (w) => onEditText({ imageWidth: w }) : undefined}
        />
      ) : (
        <ImageSlot label={b.type === 'logo' ? 'Sin logo' : 'Sin imagen'} height={b.type === 'logo' ? 54 : 120} />
      );
    // Botón, redes, productos, divisor y HTML crudo se dibujan con el HTML REAL: no
    // tienen interacción propia en el lienzo y así no hay dos versiones que mantener.
    case 'button':
    case 'social':
    case 'products':
    case 'divider':
    case 'html':
      return <Fiel />;
    case 'video': {
      const thumb = videoThumbnail(b);
      if (!thumb || !b.videoUrl?.trim()) {
        return (
          <Box sx={{
            border: '2px dashed #cbd5e1', borderRadius: 1.5, py: 4,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5,
            color: '#94a3b8',
          }}>
            <PlayCircleOutlineIcon sx={{ fontSize: 40 }} />
            <Typography variant="caption">Pega el enlace del vídeo en el panel derecho</Typography>
          </Box>
        );
      }
      return <Fiel />;
    }
    case 'columns': {
      const widths = columnWidths(b);
      // Modelo LEGADO (text/textRight sin `cols`): se sigue dibujando para no romper las
      // plantillas guardadas antes de las columnas anidadas.
      const cols: Block[][] = b.cols?.length
        ? b.cols
        : [[{ ...b, type: 'text' as BlockType, cols: undefined }], [{ ...b, type: 'text' as BlockType, text: b.textRight, cols: undefined }]];
      return (
        <Box sx={{ display: 'grid', gridTemplateColumns: widths.map((w) => `${w}fr`).join(' '), gap: 1.5 }}>
          {widths.map((_, i) => (
            <Box key={i} sx={{ minHeight: 24 }}>
              {(cols[i] || []).map((child) => (
                <Box
                  key={child.id}
                  onClick={(e) => { if (onSelectChild) { e.stopPropagation(); onSelectChild(child.id); } }}
                  sx={{
                    mb: 1, borderRadius: 1,
                    outline: selectedId === child.id ? '2px solid #0075be' : '2px solid transparent',
                    outlineOffset: 2,
                    '&:hover': onSelectChild ? { outline: '2px dashed rgba(0,117,190,.45)' } : undefined,
                  }}
                >
                  <BlockPreview
                    block={child}
                    settings={st}
                    selectedId={selectedId}
                    onEditText={selectedId === child.id && onEditChild ? (patch) => onEditChild(child.id, patch) : undefined}
                    variables={variables}
                    onRequestVariable={onRequestVariable}
                  />
                </Box>
              ))}
              {/* Columna VACÍA: el "+" es el destino para poner lo que se quiera. Antes
                  las columnas nacían con texto de relleno que casi siempre se borraba. */}
              {!(cols[i] || []).length && (() => {
                const activo = Boolean(dragging && canDropInColumn && hoverColumn === i);
                return (
                  <Box
                    onClick={(e) => { if (onAddToColumn) { e.stopPropagation(); onAddToColumn(i, e.currentTarget); } }}
                    // Además de botón, el "+" es DESTINO de arrastre: se puede soltar aquí
                    // un bloque de la paleta o mover uno que ya esté en el lienzo.
                    onDragOver={(e) => {
                      if (!canDropInColumn || !onColumnDragOver) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onColumnDragOver(i);
                    }}
                    onDragLeave={() => onColumnDragLeave?.()}
                    onDrop={(e) => {
                      if (!canDropInColumn || !onDropInColumn) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onDropInColumn(i);
                    }}
                    sx={{
                      border: '2px dashed', borderRadius: 1.5, minHeight: 84,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderColor: activo ? 'primary.main' : '#cbd5e1',
                      bgcolor: activo ? 'rgba(0,117,190,.10)' : 'transparent',
                      color: activo ? 'primary.main' : '#94a3b8',
                      cursor: onAddToColumn ? 'pointer' : 'default',
                      transition: 'border-color .15s, color .15s, background .15s',
                      '&:hover': onAddToColumn ? { borderColor: 'primary.main', color: 'primary.main' } : undefined,
                    }}
                  >
                    <AddIcon sx={{ fontSize: activo ? 36 : 30, transition: 'font-size .15s' }} />
                  </Box>
                );
              })()}
            </Box>
          ))}
        </Box>
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
  // Campo del bloque al que va la imagen elegida en la biblioteca ('url' | 'imageUrl'),
  // o el índice del producto cuando se abre desde la grilla.
  const [libraryFor, setLibraryFor] = useState<'url' | 'imageUrl' | 'videoThumb' | number | null>(null);
  /** Red a la que se le está eligiendo un logo propio (bloque de redes sociales). */
  const [iconFor, setIconFor] = useState<keyof SocialLinks | null>(null);
  /** Diálogo del paquete de logos reales (recolorea y sube el set completo). */
  const [packOpen, setPackOpen] = useState(false);
  const [uploadingItem, setUploadingItem] = useState<number | null>(null);
  const isImage = b.type === 'image' || b.type === 'logo';
  const hasText = b.type === 'heading' || b.type === 'text' || b.type === 'button';
  const hasUrl = b.type === 'image' || b.type === 'button' || b.type === 'logo';
  // Los COMBINADOS salieron de la paleta (el bloque de columnas los cubre mejor), pero su
  // edición se conserva: una plantilla ya guardada con estos bloques tiene que seguir
  // siendo editable, no solo renderizable.
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
          <TextField
            select label="Estilo" size="small" fullWidth
            value={b.socialStyle || 'badge'}
            onChange={(e) => onChange({ socialStyle: e.target.value as SocialStyle })}
          >
            <MenuItem value="badge">Colores de cada red</MenuItem>
            <MenuItem value="mono">Un solo color (tu marca)</MenuItem>
            <MenuItem value="text">Enlaces de texto</MenuItem>
          </TextField>
          {(b.socialStyle || 'badge') !== 'text' && (
            <>
              {/* Un manual de marca serio no admite los colores ajenos de cada red. Se
                  ofrecen el selector Y el hex escribible: el manual de marca da el código
                  exacto (#0075BE), y acertarlo con el cuentagotas es imposible. */}
              {b.socialStyle === 'mono' && (
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Color" type="color" size="small"
                    // El input de color EXIGE un #rrggbb válido: mientras se escribe el
                    // hex a mano ("#01") se le pasa el último válido para que no salte.
                    value={socialMonoColor(b.socialColor)}
                    onChange={(e) => onChange({ socialColor: e.target.value })}
                    sx={{ width: 92, flexShrink: 0 }}
                  />
                  <TextField
                    label="Código HTML" size="small" fullWidth placeholder="#16233f"
                    value={b.socialColor ?? DEFAULT_SOCIAL_MONO}
                    onChange={(e) => onChange({ socialColor: e.target.value })}
                    error={!!b.socialColor && !isHexColor(b.socialColor)}
                    helperText={b.socialColor && !isHexColor(b.socialColor) ? 'Formato #rrggbb' : ' '}
                  />
                </Stack>
              )}
              <Stack direction="row" spacing={1}>
                <TextField
                  select label="Forma" size="small" fullWidth
                  value={b.socialShape || 'circle'}
                  onChange={(e) => onChange({ socialShape: e.target.value as SocialShape })}
                >
                  <MenuItem value="circle">Círculo</MenuItem>
                  <MenuItem value="rounded">Cuadrado redondeado</MenuItem>
                  <MenuItem value="square">Cuadrado</MenuItem>
                </TextField>
                <TextField
                  label="Tamaño (px)" type="number" size="small" sx={{ width: 120 }}
                  value={b.socialSize ?? 34}
                  onChange={(e) => onChange({ socialSize: Math.max(20, Math.min(64, parseInt(e.target.value) || 34)) })}
                />
              </Stack>
            </>
          )}
          <Button
            size="small" variant="outlined" startIcon={<AutoAwesomeIcon />}
            onClick={() => setPackOpen(true)}
          >
            Usar los logos reales
          </Button>
          <Typography variant="caption" color="text.secondary">
            Deja vacía la red que no uses. "Usar los logos reales" pone los logos de cada
            red con los colores que elijas; el botón de imagen de cada fila cambia una sola.
          </Typography>
          {SOCIAL_NETWORKS.map((n) => {
            const propio = b.icons?.[n.key];
            const forma = b.socialShape === 'square' ? 0
              : b.socialShape === 'rounded' ? '22%' : '50%';
            return (
              <Stack key={n.key} direction="row" spacing={1} alignItems="center">
                <Box sx={{
                  width: 26, height: 26, borderRadius: forma, color: '#fff', overflow: 'hidden',
                  bgcolor: propio ? 'transparent'
                    : b.socialStyle === 'mono' ? socialMonoColor(b.socialColor) : n.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {propio
                    ? <Box component="img" src={propio} alt={n.label} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : n.initial}
                </Box>
                <TextField
                  label={n.label}
                  value={b.links?.[n.key] ?? ''}
                  onChange={(e) => onChange({ links: { ...b.links, [n.key]: e.target.value } })}
                  fullWidth size="small" placeholder="https://"
                />
                <Tooltip title={propio ? `Cambiar el icono de ${n.label}` : `Usar el logo real de ${n.label} (imagen propia)`}>
                  <IconButton size="small" onClick={() => setIconFor(n.key)}>
                    <PhotoLibraryIcon fontSize="small" color={propio ? 'primary' : 'inherit'} />
                  </IconButton>
                </Tooltip>
                {propio && (
                  <Tooltip title="Volver a la insignia de color">
                    <IconButton size="small" onClick={() => onChange({ icons: { ...b.icons, [n.key]: '' } })}>
                      <FormatClearIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            );
          })}
          {/* Los logos REALES tienen que ser IMÁGENES: el correo no admite SVG en línea
              (Gmail lo elimina) ni `data:` URI, así que el icono se sube al bucket del
              propio cliente — nunca a un CDN ajeno, que es lo que rompe los correos ya
              enviados si ese dominio cae. */}
          <ImageLibraryDialog
            open={!!iconFor}
            onClose={() => setIconFor(null)}
            onUpload={onUploadImage}
            onSelect={(url) => { if (iconFor) onChange({ icons: { ...b.icons, [iconFor]: url } }); setIconFor(null); }}
          />
          <SocialIconPackDialog
            open={packOpen}
            onClose={() => setPackOpen(false)}
            activas={SOCIAL_NETWORKS
              .filter((n) => { const v = b.links?.[n.key]; return v && v.trim() && v !== 'https://'; })
              .map((n) => n.key)}
            size={b.socialSize ?? 34}
            shape={b.socialShape}
            onUpload={onUploadImage}
            onApply={(icons) => onChange({ icons: { ...b.icons, ...icons } })}
          />
        </>
      )}

      {isCombo && (
        <>
          <TextField label="Título" value={b.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} fullWidth size="small" />
          <TextField label="Texto" value={b.text} onChange={(e) => onChange({ text: e.target.value })} fullWidth multiline minRows={3} size="small" />
          <TextField label="URL de la imagen" value={b.imageUrl ?? ''} onChange={(e) => onChange({ imageUrl: e.target.value })} fullWidth size="small" />
          <Stack direction="row" spacing={1}>
            <Button component="label" size="small" variant="outlined" fullWidth disabled={uploadingImg} startIcon={uploadingImg ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />}>
              {uploadingImg ? 'Subiendo…' : 'Subir'}
              <input type="file" accept="image/*" hidden onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
            </Button>
            <Button size="small" variant="outlined" fullWidth startIcon={<PhotoLibraryIcon />} onClick={() => setLibraryFor('imageUrl')}>
              Mis imágenes
            </Button>
          </Stack>
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
                <Button size="small" variant="outlined" startIcon={<PhotoLibraryIcon />} onClick={() => setLibraryFor(i)} sx={{ mr: 1 }}>
                  Mis imágenes
                </Button>
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
        <Stack direction="row" spacing={1}>
          <Button
            component="label" size="small" variant="outlined" fullWidth
            disabled={uploadingImg}
            startIcon={uploadingImg ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />}
          >
            {uploadingImg ? 'Subiendo…' : 'Subir'}
            <input type="file" accept="image/*" hidden onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
          </Button>
          {/* Reutilizar algo ya subido, en vez de volver a subir el mismo logo. */}
          <Button size="small" variant="outlined" fullWidth startIcon={<PhotoLibraryIcon />} onClick={() => setLibraryFor('url')}>
            Mis imágenes
          </Button>
        </Stack>
      )}

      {/* Tres casillas con el bloque DENTRO de la elegida: se ve dónde va a quedar, que es
          la pregunta real. Un desplegable obliga a leer tres palabras e imaginárselo. */}
      {hasAlign && (
        <AlignPicker value={b.align} blockType={b.type} onChange={(v) => onChange({ align: v })} />
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

      {b.type === 'video' && (
        <>
          <TextField
            label="Enlace del vídeo" size="small" fullWidth
            value={b.videoUrl ?? ''} placeholder="https://youtube.com/watch?v=…"
            onChange={(e) => onChange({ videoUrl: e.target.value })}
            helperText="Ningún cliente de correo reproduce vídeo: se envía una miniatura que lleva al vídeo."
          />
          <TextField
            label="Texto del botón" size="small" fullWidth
            value={b.videoLabel ?? ''} placeholder="Ver el vídeo"
            onChange={(e) => onChange({ videoLabel: e.target.value })}
          />
          <TextField
            label="Miniatura propia (opcional)" size="small" fullWidth
            value={b.videoThumb ?? ''}
            onChange={(e) => onChange({ videoThumb: e.target.value })}
            helperText={youtubeId(b.videoUrl || '')
              ? 'Con un enlace de YouTube se usa su miniatura automáticamente. Sube una propia si quieres que lleve el botón de play dibujado.'
              : 'Obligatoria si el vídeo no es de YouTube.'}
          />
          <Stack direction="row" spacing={1}>
            <Button component="label" size="small" variant="outlined" fullWidth disabled={uploadingImg} startIcon={<AddPhotoAlternateIcon />}>
              Subir
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploadingImg(true);
                const url = await onUploadImage(f);
                setUploadingImg(false);
                if (url) onChange({ videoThumb: url });
              }} />
            </Button>
            <Button size="small" variant="outlined" fullWidth startIcon={<PhotoLibraryIcon />} onClick={() => setLibraryFor('videoThumb')}>
              Mis imágenes
            </Button>
          </Stack>
        </>
      )}

      {/* ── Botón: lo que genera las conversiones, y era lo menos configurable ── */}
      {b.type === 'button' && (
        <>
          <Divider textAlign="left"><Typography variant="caption" color="text.secondary">Botón</Typography></Divider>
          <TextField
            select label="Ancho" size="small" fullWidth
            value={b.buttonFullWidth ? 'full' : 'auto'}
            onChange={(e) => onChange({ buttonFullWidth: e.target.value === 'full' })}
            helperText="El ancho completo es lo que más convierte en móvil."
          >
            <MenuItem value="auto">Ajustado al texto</MenuItem>
            <MenuItem value="full">Ancho completo</MenuItem>
          </TextField>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Esquinas" type="number" size="small" fullWidth placeholder="6"
              value={b.buttonRadius ?? ''}
              onChange={(e) => onChange({ buttonRadius: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0) })}
            />
            <TextField
              label="Texto (px)" type="number" size="small" fullWidth placeholder="15"
              value={b.buttonFontSize ?? ''}
              onChange={(e) => onChange({ buttonFontSize: parseInt(e.target.value) || undefined })}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Relleno ↕" type="number" size="small" fullWidth placeholder="12"
              value={b.buttonPadY ?? ''}
              onChange={(e) => onChange({ buttonPadY: parseInt(e.target.value) || undefined })}
            />
            <TextField
              label="Relleno ↔" type="number" size="small" fullWidth placeholder="26"
              value={b.buttonPadX ?? ''}
              onChange={(e) => onChange({ buttonPadX: parseInt(e.target.value) || undefined })}
            />
          </Stack>
        </>
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
      <TextField
        select label="Visibilidad" size="small" fullWidth
        value={b.hideMobile ? 'desktop' : b.hideDesktop ? 'mobile' : 'all'}
        onChange={(e) => onChange({
          hideMobile: e.target.value === 'desktop',
          hideDesktop: e.target.value === 'mobile',
        })}
      >
        <MenuItem value="all">En todos los dispositivos</MenuItem>
        <MenuItem value="desktop">Solo en escritorio</MenuItem>
        <MenuItem value="mobile">Solo en móvil</MenuItem>
      </TextField>

      {(b.type === 'text' || b.type === 'heading') && (
        <TextField
          label="Tamaño de fuente (px)" type="number" value={b.fontSize ?? ''}
          placeholder={b.type === 'heading' ? '26' : '15'}
          onChange={(e) => onChange({ fontSize: parseInt(e.target.value) || undefined })}
          fullWidth size="small"
          helperText="Aplica a todo el bloque; para una palabra suelta usa la barra del editor."
        />
      )}

      <ImageLibraryDialog
        open={libraryFor !== null}
        onClose={() => setLibraryFor(null)}
        onUpload={onUploadImage}
        onSelect={(url) => {
          if (libraryFor === 'url') onChange({ url });
          else if (libraryFor === 'imageUrl') onChange({ imageUrl: url });
          else if (libraryFor === 'videoThumb') onChange({ videoThumb: url });
          else if (typeof libraryFor === 'number') updateItem(libraryFor, { image: url });
        }}
      />
    </Stack>
  );
};

/* --------- Editor de COLUMNAS: nº de columnas + distribución de anchos --------- */

/** Miniatura de una distribución (como las tarjetas de layout de un constructor serio). */
const LayoutThumb = ({ widths, active }: { widths: number[]; active: boolean }) => (
  <Box
    sx={{
      display: 'flex', gap: '3px', p: '5px', borderRadius: 1, height: 42,
      border: '2px solid', borderColor: active ? 'primary.main' : 'divider',
      bgcolor: active ? 'rgba(0,117,190,.08)' : 'transparent',
      cursor: 'pointer', transition: 'border-color .15s, background .15s',
      '&:hover': { borderColor: 'primary.main' },
    }}
  >
    {widths.map((w, i) => (
      <Box key={i} sx={{ flex: `${w} 0 0`, borderRadius: '3px', border: '1px dashed', borderColor: active ? 'primary.main' : '#9aa7b8' }} />
    ))}
  </Box>
);

const ColumnsEditor = ({ block: b, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) => {
  const widths = columnWidths(b);
  const count = widths.length;
  const cols: Block[][] = b.cols?.length ? b.cols : [[], []];

  /**
   * Cambiar el NÚMERO de columnas conserva el contenido de las que siguen existiendo.
   * Al reducir, lo que había en las columnas que desaparecen se MUEVE a la última que
   * queda, en vez de borrarse en silencio.
   */
  const setCount = (n: number) => {
    const layout = (COLUMN_LAYOUTS[n] || [[100]])[0];
    const next: Block[][] = layout.map((_, i) => cols[i] || []);
    if (cols.length > n) {
      const sobrantes = cols.slice(n).flat();
      next[n - 1] = [...next[n - 1], ...sobrantes];
    }
    onChange({ widths: layout, cols: next });
  };

  return (
    <>
      <Divider textAlign="left"><Typography variant="caption" color="text.secondary">Columnas</Typography></Divider>

      <Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Número de columnas: <strong>{count}</strong>
        </Typography>
        <Slider
          value={count} min={1} max={MAX_COLUMNS} step={1} marks
          valueLabelDisplay="auto" size="small"
          onChange={(_, v) => setCount(v as number)}
        />
      </Box>

      <Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>Distribución</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          {(COLUMN_LAYOUTS[count] || [[100]]).map((layout) => (
            <Box key={layout.join('-')} onClick={() => onChange({ widths: layout })}>
              <LayoutThumb widths={layout} active={layout.join('-') === widths.join('-')} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
                {layout.map((w) => `${w}%`).join(' · ')}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary">
        Usa el <strong>+</strong> de cada columna en el lienzo para poner dentro lo que
        quieras (texto, imagen, botón…). Haz clic en un elemento para editarlo.
      </Typography>
    </>
  );
};
