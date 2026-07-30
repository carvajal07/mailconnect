import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Tooltip, Divider, MenuItem,
  TextField, Menu, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from '@mui/material';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CodeIcon from '@mui/icons-material/Code';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
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
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SettingsIcon from '@mui/icons-material/Settings';
import type { ReactNode } from 'react';
import { getUser } from '../../services/authService';
import { campaignsService } from '../../services/campaignsService';
import { isOk } from '../../services/apiClient';
import { pdfTemplatesService, base64ToPdfBlob, readPdfDrafts, writePdfDrafts } from '../../services/pdfTemplatesService';
import { messageTemplatesService } from '../../services/messageTemplatesService';
import type { MessageTemplate } from '../../services/messageTemplatesService';
import { useFeedback } from '../../hooks/useFeedback';
import { usePortalData } from '../../context/PortalDataContext';
// Se reutiliza el criterio de URL segura del constructor de correos en vez de duplicarlo.
import { isSafeHref, escapeText, escapeAttr } from './richText';
import { DatabaseFieldPicker } from './DatabaseFieldPicker';
import { DraggableDialog } from './DraggableDialog';
import {
  DEFAULT_TABLE, TABLE_MAX_COLS, TABLE_MAX_ROWS, buildTableHtml, readTableConfig,
  applyTableConfig, joinPages, splitPages,
} from './pdfDocument';
import type { TableConfig } from './pdfDocument';

/**
 * Editor de PLANTILLAS PDF tipo "documento" (a lo Word): barra de formato de texto arriba,
 * herramientas a la izquierda, y un lienzo con REGLAS (hoja A4/Carta). Muy sencillo: usa un
 * `contentEditable` + document.execCommand (sin librerías extra). El contenido se guarda como
 * borrador en localStorage (compartido con el form de campaña para elegir la plantilla del
 * envío EAP-PDF) y el botón "Vista previa PDF" lo renderiza vía la lambda Render-pdf.
 */

const CM = 37.8; // 1 cm ≈ 37.8 px a 96 dpi
const RULER = 22; // grosor de la regla (px)
const PAGE_SIZES = { A4: { w: 794, h: 1123 }, Carta: { w: 816, h: 1056 } } as const;

/**
 * ── Fidelidad lienzo ↔ PDF ────────────────────────────────────────────────────
 * Estos valores son ESPEJO de los que la lambda `Api_V1_Template_Render-pdf` mete en
 * `wrap_html`. Si cambian allá, cambian aquí, o el editor vuelve a mentir: antes el lienzo
 * usaba 64 px de margen (≈1,7 cm) contra los 2 cm del PDF, y 15 px de cuerpo contra 12 pt
 * (=16 px), así que lo que se veía cabiendo en el renglón no cabía en el documento real.
 */
const PAGE_MARGIN_CM = 2;                       // margen por defecto de @page
const PT = 96 / 72;                             // 1 pt = 1.333 px a 96 dpi
const BODY_PT = 12;                             // body { font-size: 12pt }
const HEADING_PT = { h1: 22, h2: 18, h3: 15 };  // h1/h2/h3 de wrap_html
/** Alto de la banda de encabezado/pie + su aire: espejo de BAND_CM/BAND_GAP_CM. */
const BAND_CM = 1;
const BAND_GAP_CM = 0.3;

/** Configuración de página del documento. Viaja en los `data-*` del envoltorio. */
interface PageSetup {
  size: 'A4' | 'Carta';
  landscape: boolean;
  margin: { top: number; right: number; bottom: number; left: number }; // cm
  header: string;
  footer: string;
}
const DEFAULT_SETUP: PageSetup = {
  size: 'A4',
  landscape: false,
  margin: { top: PAGE_MARGIN_CM, right: PAGE_MARGIN_CM, bottom: PAGE_MARGIN_CM, left: PAGE_MARGIN_CM },
  header: '',
  footer: '',
};

/** Medidas de la hoja en px, ya con la orientación aplicada. */
const sheetPx = (s: PageSetup) => {
  const { w, h } = PAGE_SIZES[s.size];
  return s.landscape ? { w: h, h: w } : { w, h };
};

/**
 * Tokens de numeración. ⚠️ Van en CORCHETES y no en `{{…}}` a propósito: las llaves son
 * el formato de las variables de la BASE DE DATOS y en el envío real la sustitución de
 * datos corre ANTES, así que una columna del CSV llamada "pagina" habría pisado el número
 * de página. El backend los convierte a las etiquetas de xhtml2pdf.
 */
const PAGE_TOKENS = [
  { token: '[[pagina]]', label: 'Número de página' },
  { token: '[[paginas]]', label: 'Total de páginas' },
];

/**
 * Fuentes que el PDF puede entregar DE VERDAD.
 *
 * ⚠️ La lambda no registra ninguna tipografía (`registerFont`), así que xhtml2pdf solo
 * dispone de las base-14 del estándar PDF. Se comprobó renderizando: `arial`→Helvetica,
 * `times new roman`/`georgia`→Times-Roman, `courier new`→Courier, y **`verdana` y `tahoma`
 * caen a Helvetica** (idénticas a Arial). Ofrecer las seis de antes era prometer seis
 * resultados y entregar tres: quien elegía Tahoma veía el lienzo cambiar y el PDF salía
 * igual que con Arial, sin que nada lo avisara.
 *
 * Las plantillas ya guardadas con Georgia/Verdana/Tahoma siguen renderizando como siempre
 * (esto solo acota lo que se puede ELEGIR de aquí en adelante).
 */
const FONTS: { value: string; label: string }[] = [
  { value: 'Arial', label: 'Arial · sin serifa' },
  { value: 'Times New Roman', label: 'Times New Roman · con serifa' },
  { value: 'Courier New', label: 'Courier New · monoespaciada' },
];
const DEFAULT_FONT = FONTS[0].value;

/** Marca del contenedor de documento, para no anidar un envoltorio por cada guardado. */
const DOC_WRAPPER_ATTR = 'data-mc-doc';

/** Variables {{campo}} presentes en el HTML. */
const usedVariables = (html: string): string[] => {
  const out: string[] = [];
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = m[1].trim();
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
};

/**
 * Valores para la VISTA PREVIA, tomados de la base elegida (primera fila real).
 *
 * ⚠️ Antes había 4 valores inventados y, para cualquier otra variable, se devolvía **el
 * nombre de la variable** como si fuera su valor: `{{saldo}}` se previsualizaba como la
 * palabra "saldo", que se lee como contenido de verdad. Ahora lo que no tiene dato se manda
 * como `{{campo}}` para que se VEA sin resolver — es el mismo criterio del Estudio PDF.
 */
const previewVariables = (
  html: string,
  columns: string[],
  row: string[],
): Record<string, string> => {
  const out: Record<string, string> = {};
  columns.forEach((col, i) => { if (col) out[col] = row[i] ?? `{{${col}}}`; });
  for (const v of usedVariables(html)) if (!(v in out)) out[v] = `{{${v}}}`;
  return out;
};

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
  // Al guardar una plantilla PDF se refresca el contexto del portal para que aparezca de
  // inmediato en el selector de "crear campaña" (canal EAP-PDF) sin recargar.
  const { refreshMessageTemplates } = usePortalData();

  /**
   * ── Modelo de PÁGINAS ─────────────────────────────────────────────────────────
   * El documento es una lista de hojas, cada una con su propio `contentEditable`.
   *
   * ⚠️ Antes era UNA tira continua con "saltos de página" y unas guías de corte que el
   * propio editor admitía como aproximadas: en el PDF cada hoja vuelve a empezar con su
   * margen, y esa franja en blanco no se podía reproducir en una tira. Con hojas de verdad
   * el lienzo deja de aproximar — lo que se ve es lo que sale.
   *
   * ⚠️ El costo del cambio: el texto NO fluye de una hoja a la siguiente. Si el contenido
   * de una página se desborda, se marca en rojo y se avisa (ver `desbordadas`), en vez de
   * pasar solo a la hoja siguiente. Es el intercambio correcto para documentos de página
   * fija (un certificado, un extracto), que es lo que arma este editor.
   *
   * El contenido vive en el DOM, no en el estado: un `contentEditable` controlado por React
   * reescribe el nodo en cada tecla y manda el cursor al principio (mismo problema que ya
   * apareció en `RichTextEditor`).
   */
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(0);
  const [desbordadas, setDesbordadas] = useState<number[]>([]);
  /** La hoja donde está trabajando el usuario: destino de todo lo que se inserta. */
  const pageRef = { get current() { return pageRefs.current[activePage] ?? pageRefs.current[0] ?? null; } };
  const [setup, setSetup] = useState<PageSetup>({ ...DEFAULT_SETUP });
  const [setupOpen, setSetupOpen] = useState(false);
  // Se incrementa al escribir: dispara el chequeo de desbordes.
  const [guiasTick, setGuiasTick] = useState(0);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableCfg, setTableCfg] = useState<TableConfig>({ ...DEFAULT_TABLE });
  /** Tabla que se está editando (null = insertar una nueva). */
  const editingTable = useRef<HTMLTableElement | null>(null);
  const [font, setFont] = useState(DEFAULT_FONT);
  const [format, setFormat] = useState('p');
  // Campos y filas de la base elegida: alimentan el menú de variables y la vista previa.
  const [dbFields, setDbFields] = useState<string[]>([]);
  const [dbRow, setDbRow] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [varAnchor, setVarAnchor] = useState<null | HTMLElement>(null);
  const [loadAnchor, setLoadAnchor] = useState<null | HTMLElement>(null);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [htmlView, setHtmlView] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [linkText, setLinkText] = useState('');
  const [cloudTemplates, setCloudTemplates] = useState<MessageTemplate[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const dims = sheetPx(setup);
  const marginPx = {
    top: setup.margin.top * CM, right: setup.margin.right * CM,
    bottom: setup.margin.bottom * CM, left: setup.margin.left * CM,
  };

  useEffect(() => {
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* noop */ }
    // El contenido de arranque va a la PRIMERA hoja explícitamente (no a "la hoja activa"):
    // en el montaje siempre es la 0, y así el efecto no depende del estado de foco.
    const primera = pageRefs.current[0];
    if (primera && !primera.innerHTML.trim()) {
      primera.innerHTML =
        '<h1>Título del documento</h1><p>Escribe aquí el contenido de tu plantilla. Usa la barra de arriba para dar formato y las herramientas de la izquierda para insertar imágenes, tablas o variables de tu base de datos.</p>';
    }
  }, []);

  /**
   * HTML del documento tal como debe viajar al PDF: el contenido del lienzo envuelto en un
   * `<div>` que lleva la fuente elegida.
   *
   * ⚠️ Sin este envoltorio la fuente NO llegaba al PDF. El desplegable hacía dos cosas a
   * medias: teñía el lienzo entero (estado `font`, que no sale en el `innerHTML`) y hacía
   * `execCommand('fontName')`, que solo etiqueta **lo que estuviera seleccionado**. Con el
   * cursor suelto no marcaba nada → el lienzo se veía en Times y el PDF salía en Helvetica,
   * porque `wrap_html` fija `body { font-family: Arial… }`. Se comprobó que xhtml2pdf sí
   * hereda `font-family` de un div a párrafos, títulos y celdas de tabla.
   *
   * El envoltorio lleva además la CONFIGURACIÓN DE PÁGINA en `data-*` (tamaño,
   * orientación, márgenes) y, si los hay, el encabezado y el pie. ⚠️ Va dentro del
   * documento y no como parámetro del endpoint porque en el envío real el combinador
   * recibe la plantilla por SQS y no conoce nada de lo que se configuró en el editor:
   * guardándolo aquí, la vista previa y el envío real usan lo mismo.
   */
  const documentHtml = (): string => {
    // Las hojas se unen con el mismo separador `page-break-before:always` que ya emitía el
    // salto manual → el HTML que recibe el motor es idéntico y el backend NO cambia.
    const inner = joinPages(pageRefs.current.slice(0, pageCount).map((el) => el?.innerHTML || ''));
    if (!inner.trim()) return '';
    const m = setup.margin;
    const bandas =
      (setup.header.trim() ? `<div data-mc-header>${escapeText(setup.header)}</div>` : '') +
      (setup.footer.trim() ? `<div data-mc-footer>${escapeText(setup.footer)}</div>` : '');
    return `<div ${DOC_WRAPPER_ATTR}="1" data-mc-size="${setup.size}"`
      + ` data-mc-orientation="${setup.landscape ? 'landscape' : 'portrait'}"`
      + ` data-mc-margin="${m.top} ${m.right} ${m.bottom} ${m.left}"`
      + ` style="font-family:${font}">${bandas}${inner}</div>`;
  };

  /**
   * Carga HTML en el lienzo deshaciendo el envoltorio (fuente + configuración de página).
   * Sin esto, cada guardado anidaría un div más dentro del anterior.
   */
  const setDocumentHtml = (html: string) => {
    /** Reparte el contenido en hojas. Una plantilla vieja sin separadores entra como una. */
    const repartir = (interno: string) => {
      const hojas = splitPages(interno);
      setPageCount(hojas.length);
      setActivePage(0);
      // El render de las hojas nuevas ocurre en el siguiente ciclo, así que el contenido
      // se vuelca cuando ya existen los nodos.
      requestAnimationFrame(() => {
        hojas.forEach((h, i) => { const el = pageRefs.current[i]; if (el) el.innerHTML = h; });
        setGuiasTick((n) => n + 1);
      });
    };

    const cont = document.createElement('div');
    cont.innerHTML = html || '';
    const root = cont.children.length === 1 ? (cont.firstElementChild as HTMLElement | null) : null;
    if (!root || !root.hasAttribute(DOC_WRAPPER_ATTR)) {
      // Plantilla anterior a la configuración de página: entra tal cual, con los valores
      // por defecto (que son exactamente los que tenía el editor antes).
      setSetup({ ...DEFAULT_SETUP });
      repartir(html || '');
      return;
    }
    const guardada = root.style.fontFamily.replace(/['"]/g, '');
    if (guardada) setFont(guardada);

    const enc = root.querySelector('[data-mc-header]');
    const pie = root.querySelector('[data-mc-footer]');
    const partes = (root.getAttribute('data-mc-margin') || '').trim().split(/[\s,]+/)
      .map((n) => Number(n)).filter((n) => Number.isFinite(n));
    const [t, r, b, l] = partes.length === 4
      ? partes
      : [PAGE_MARGIN_CM, PAGE_MARGIN_CM, PAGE_MARGIN_CM, PAGE_MARGIN_CM];
    setSetup({
      size: root.getAttribute('data-mc-size') === 'Carta' ? 'Carta' : 'A4',
      landscape: root.getAttribute('data-mc-orientation') === 'landscape',
      margin: { top: t, right: r, bottom: b, left: l },
      header: enc?.textContent ?? '',
      footer: pie?.textContent ?? '',
    });
    // Las bandas se editan en el diálogo de página, no en el lienzo: salen del contenido.
    enc?.remove();
    pie?.remove();
    repartir(root.innerHTML);
  };

  /**
   * Última selección conocida DENTRO del lienzo.
   *
   * ⚠️ Hace falta para el diálogo de enlace: al abrir un `Dialog` de MUI el foco se va al
   * diálogo y la selección del `contentEditable` se pierde, así que `createLink` no tendría
   * sobre qué aplicarse. Guardando el `Range` antes de abrir y restaurándolo al aceptar, el
   * enlace cae sobre el texto que el usuario había seleccionado. Mismo patrón que
   * `RichTextEditor`.
   */
  const savedRange = useRef<Range | null>(null);

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && pageRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreRange = () => {
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    pageRef.current?.focus();
  };

  /** Ejecuta un comando de edición sobre la selección actual del lienzo. */
  const exec = (cmd: string, value?: string) => {
    pageRef.current?.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* noop */ }
    document.execCommand(cmd, false, value);
    saveRange();
  };
  const insertHtml = (html: string) => {
    pageRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    saveRange();
  };

  /**
   * ¿Hay texto REAL seleccionado en el lienzo?
   *
   * ⚠️ No basta con `!sel.isCollapsed`: al hacer clic en un `<h1>` a la derecha de donde
   * termina su texto, la selección existe pero vale `"\n"`. Con esa comprobación el diálogo
   * anunciaba "se va a enlazar el texto seleccionado" y después `createLink` no hacía nada
   * — el clic parecía no responder. Un espacio en blanco se trata como "sin selección".
   */
  const seleccionDelLienzo = (): string => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !pageRef.current?.contains(sel.anchorNode)) return '';
    return sel.toString().trim();
  };

  /** Abre el diálogo del enlace, recordando antes qué había seleccionado. */
  const openLink = () => {
    saveRange();
    setLinkText(seleccionDelLienzo());
    setLinkUrl('https://');
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    // Se valida con el MISMO criterio del constructor de correos (`isSafeHref`): http(s),
    // mailto, tel, ancla o una variable de plantilla. `javascript:` y `data:` quedan fuera.
    if (!isSafeHref(url)) {
      notify('Ese enlace no es válido. Usa http://, https://, mailto: o tel:.', 'warning');
      return;
    }
    setLinkOpen(false);
    restoreRange();
    if (seleccionDelLienzo()) {
      document.execCommand('createLink', false, url);
    } else {
      // Sin texto seleccionado `createLink` no hace NADA (queda el cursor y ningún enlace).
      // Se inserta el enlace completo usando el texto que el usuario escribió, o la propia
      // URL si lo dejó vacío — más útil que un clic que aparenta no responder.
      const etiqueta = escapeText(linkText.trim() || url);
      document.execCommand('insertHTML', false, `<a href="${escapeAttr(url)}">${etiqueta}</a>`);
    }
    saveRange();
  };

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

  /** Agrega una hoja al final y lleva el foco a ella. */
  const addPage = () => {
    const nueva = pageCount;
    setPageCount(nueva + 1);
    setActivePage(nueva);
    requestAnimationFrame(() => pageRefs.current[nueva]?.focus());
  };

  /**
   * Elimina una hoja. Si tiene contenido pide confirmación: al no haber flujo entre hojas,
   * lo que se borra no reaparece en ninguna otra.
   */
  const removePage = (i: number) => {
    if (pageCount <= 1) return;
    const el = pageRefs.current[i];
    const tieneAlgo = Boolean(el?.textContent?.trim() || el?.querySelector('img, table'));
    if (tieneAlgo && !window.confirm(`¿Eliminar la página ${i + 1} y todo su contenido?`)) return;
    // El contenido vive en el DOM, así que hay que correr las hojas siguientes a mano.
    const restante = pageRefs.current.slice(0, pageCount).map((p) => p?.innerHTML || '');
    restante.splice(i, 1);
    setPageCount(pageCount - 1);
    setActivePage(Math.max(0, i - 1));
    requestAnimationFrame(() => {
      restante.forEach((h, k) => { const p = pageRefs.current[k]; if (p) p.innerHTML = h; });
      setGuiasTick((n) => n + 1);
    });
  };

  /**
   * Qué hojas tienen MÁS contenido del que cabe.
   *
   * ⚠️ Es la contrapartida de que el texto no fluya entre hojas: si el usuario escribe de
   * más, el sobrante se saldría del área imprimible y en el PDF quedaría cortado. Sin este
   * aviso, el defecto solo se descubriría al generar la vista previa.
   */
  const revisarDesbordes = useCallback(() => {
    const hoja = sheetPx(setup);
    const bandaSup = setup.header.trim() ? (BAND_CM + BAND_GAP_CM) * CM : 0;
    const bandaInf = setup.footer.trim() ? (BAND_CM + BAND_GAP_CM) * CM : 0;
    const util = hoja.h
      - Math.max(setup.margin.top * CM, bandaSup)
      - Math.max(setup.margin.bottom * CM, bandaInf);
    const malas: number[] = [];
    pageRefs.current.slice(0, pageCount).forEach((el, i) => {
      if (!el) return;
      const contenido = el.scrollHeight - (setup.margin.top + setup.margin.bottom) * CM;
      // 2 px de tolerancia: el redondeo del layout no debe disparar el aviso.
      if (contenido > util + 2) malas.push(i);
    });
    setDesbordadas(malas);
  }, [setup, pageCount]);

  // Se revisa al escribir (con respiro) y cuando cambia la configuración de página.
  useEffect(() => {
    const t = setTimeout(revisarDesbordes, 250);
    return () => clearTimeout(t);
  }, [revisarDesbordes, guiasTick]);

  /** ¿El cursor está dentro de una tabla? Decide si el botón inserta o edita. */
  const tablaEnFoco = (): HTMLTableElement | null => {
    const sel = window.getSelection();
    const nodo = sel?.anchorNode ?? null;
    if (!nodo || !pageRef.current?.contains(nodo)) return null;
    const desde = nodo.nodeType === 1 ? (nodo as Element) : nodo.parentElement;
    return (desde?.closest('table') as HTMLTableElement | null) ?? null;
  };

  /** Abre el diálogo de tabla: con los ajustes de la que está bajo el cursor, o los nuevos. */
  const openTable = () => {
    saveRange();
    const actual = tablaEnFoco();
    editingTable.current = actual;
    setTableCfg(actual ? readTableConfig(actual) : { ...DEFAULT_TABLE });
    setTableOpen(true);
  };

  const applyTable = () => {
    setTableOpen(false);
    const destino = editingTable.current;
    if (destino) {
      // Editar mantiene lo escrito en las celdas (ver `applyTableConfig`).
      applyTableConfig(destino, tableCfg);
      editingTable.current = null;
      setGuiasTick((n) => n + 1);
      return;
    }
    restoreRange();
    insertHtml(buildTableHtml(tableCfg));
    setGuiasTick((n) => n + 1);
  };

  /** Abre el diálogo para nombrar la plantilla (antes usaba window.prompt, feo). */
  const saveTemplate = () => {
    const html = documentHtml();
    if (!html.trim()) { notify('El documento está vacío.', 'warning'); return; }
    setNameValue('');
    setNameOpen(true);
  };

  /** Guarda la plantilla EN EL SISTEMA (backend, compartida) y la refleja en localStorage. */
  const confirmSave = async () => {
    const clean = nameValue.trim();
    if (!clean) return;
    const html = documentHtml();
    setNameOpen(false);
    setSaving(true);
    const res = await messageTemplatesService.create({
      customerId: getUser()?.customerId ?? '', channel: 'PDF', name: clean, html,
    });
    setSaving(false);
    // Espejo local (respaldo/offline + el form de campaña lo tiene aunque no recargue).
    const d = readPdfDrafts(); d[clean] = html; writePdfDrafts(d);
    if (isOk(res)) {
      notify(`Plantilla "${clean}" guardada en el sistema.`, 'success');
      // Refresca la lista compartida del portal → aparece ya en "crear campaña" (EAP-PDF).
      refreshMessageTemplates();
    } else {
      notify(res.description || 'Se guardó localmente; el guardado en el sistema falló.', 'warning');
    }
  };

  /** Abre el menú "Cargar" y trae las plantillas PDF del backend (compartidas). */
  const openLoad = async (el: HTMLElement) => {
    setLoadAnchor(el);
    setCloudLoading(true);
    const res = await messageTemplatesService.list(getUser()?.customerId ?? '', 'PDF');
    setCloudLoading(false);
    setCloudTemplates(isOk(res) && res.data?.templates ? res.data.templates : []);
  };
  const loadTemplate = (t: MessageTemplate) => {
    setDocumentHtml(t.html || '');
    setLoadAnchor(null);
    notify(`Plantilla "${t.name}" cargada.`, 'info');
  };
  const loadDraft = (name: string) => {
    const d = readPdfDrafts();
    setDocumentHtml(d[name] || '');
    setLoadAnchor(null);
    notify(`Plantilla "${name}" cargada (local).`, 'info');
  };
  const newDoc = () => { if (pageRef.current) pageRef.current.innerHTML = '<p><br></p>'; };
  const showHtml = () => { setHtmlView(documentHtml()); setHtmlOpen(true); };

  /** Genera el PDF REAL desde el backend (lambda Render-pdf) con datos de muestra y lo previsualiza. */
  const previewPdf = async () => {
    const html = documentHtml();
    if (!html.trim()) { notify('El documento está vacío.', 'warning'); return; }
    setPdfLoading(true);
    const res = await pdfTemplatesService.render({
      html,
      variables: previewVariables(html, dbFields, dbRow),
      // Redundante: la configuración va DENTRO del html y manda sobre esto. Se envía
      // igual como respaldo por si la lambda todavía no tiene el motor de página.
      pageSize: setup.size,
      filename: 'plantilla-pdf.pdf',
    });
    setPdfLoading(false);
    if (!isOk(res) || !res.data?.pdfBase64) {
      notify(res.description || 'No se pudo generar el PDF. ¿El servicio de PDF está desplegado?', 'error');
      return;
    }
    const url = URL.createObjectURL(base64ToPdfBlob(res.data.pdfBase64));
    setPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    setPdfOpen(true);
  };
  const closePdf = () => { setPdfOpen(false); if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(''); } };
  const download = () => {
    const blob = new Blob(['<!doctype html><meta charset="utf-8">' + documentHtml()], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plantilla-pdf.html';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const drafts = readPdfDrafts();

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button size="small" startIcon={<NoteAddIcon />} onClick={newDoc}>Nueva</Button>
          <Button size="small" startIcon={<FolderOpenIcon />} onClick={(e) => openLoad(e.currentTarget)}>Cargar</Button>
          <Button size="small" startIcon={<CodeIcon />} onClick={showHtml}>Ver HTML</Button>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            disabled={pdfLoading}
            startIcon={pdfLoading ? <CircularProgress size={16} /> : <PictureAsPdfIcon />}
            onClick={previewPdf}
          >
            {pdfLoading ? 'Generando…' : 'Vista previa PDF'}
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={download}>Descargar HTML</Button>
          <Button size="small" variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />} onClick={saveTemplate}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
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
        {/* La fuente es del DOCUMENTO: se aplica al lienzo y viaja al PDF en el envoltorio
            de `documentHtml()`. Ya no se hace `execCommand('fontName')`, que solo marcaba la
            selección y dejaba el resto del documento con otra fuente en el PDF. */}
        <Tooltip title="Fuente de todo el documento">
          <TextField select size="small" value={font} onChange={(e) => setFont(e.target.value)} sx={{ width: 210 }}>
            {FONTS.map((f) => (
              <MenuItem key={f.value} value={f.value} sx={{ fontFamily: f.value }}>{f.label}</MenuItem>
            ))}
          </TextField>
        </Tooltip>
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
        <TB title="Insertar enlace" icon={<LinkIcon fontSize="small" />} onClick={openLink} />
        <TB title="Quitar formato" icon={<FormatClearIcon fontSize="small" />} onClick={() => exec('removeFormat')} />
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <TB title="Deshacer" icon={<UndoIcon fontSize="small" />} onClick={() => exec('undo')} />
        <TB title="Rehacer" icon={<RedoIcon fontSize="small" />} onClick={() => exec('redo')} />
      </Paper>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
        {/* Herramientas a la izquierda */}
        {/* 240 px: el selector de base en modo compacto pide 210 y con los 190 de antes se
            salía del panel (el nombre del archivo quedaba cortado por fuera del borde). */}
        <Paper variant="outlined" sx={{ p: 1.5, width: { md: 240 }, flexShrink: 0 }}>
          <Typography variant="overline" color="text.secondary">Insertar</Typography>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            <Button component="label" size="small" variant="outlined" disabled={uploading} startIcon={uploading ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />}>
              {uploading ? 'Subiendo…' : 'Imagen'}
              <input type="file" accept="image/*" hidden onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
            </Button>
            <Button size="small" variant="outlined" startIcon={<DataObjectIcon />} onClick={(e) => setVarAnchor(e.currentTarget)}>Variable</Button>
            <Button size="small" variant="outlined" startIcon={<TableChartIcon />} onClick={openTable}>
              Tabla
            </Button>
            {/* "Agregar página" en vez de "salto de página": este editor arma documentos de
                página fija, no un flujo continuo donde uno inserta cortes. */}
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addPage}>
              Agregar página
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {pageCount === 1 ? '1 página' : `${pageCount} páginas`}
            {' · '}con el cursor dentro de una tabla, "Tabla" edita esa.
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="overline" color="text.secondary">Hoja</Typography>
          <Button size="small" variant="outlined" fullWidth startIcon={<SettingsIcon />}
            onClick={() => setSetupOpen(true)} sx={{ mt: 0.5 }}>
            Configurar página
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {setup.size} {setup.landscape ? 'horizontal' : 'vertical'}
            {(setup.header.trim() || setup.footer.trim()) ? ' · con membrete' : ''}
          </Typography>

          <Divider sx={{ my: 1.5 }} />
          {/* La base manda dos cosas: qué variables se pueden insertar y con qué datos se
              previsualiza. Sin ella el menú de variables no tiene nada real que ofrecer. */}
          <Typography variant="overline" color="text.secondary">Datos</Typography>
          <Box sx={{ mt: 0.5 }}>
            <DatabaseFieldPicker
              compact
              onInsert={(f) => insertHtml(`{{${f}}}`)}
              onFieldsChange={setDbFields}
              onDatabaseChange={(db) => setDbRow(db?.previewRows?.[0] ?? [])}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {dbFields.length
              ? (dbRow.length
                ? 'La vista previa usa la primera fila real de esta base.'
                : 'Esta base no tiene filas de muestra: las variables se verán sin resolver.')
              : 'Elige una base para insertar sus columnas como variables.'}
          </Typography>
        </Paper>

        {/* Lienzo con reglas (hoja) */}
        <Box sx={{ flex: 1, minWidth: 0, bgcolor: (t) => (t.palette.mode === 'dark' ? '#0b1220' : '#e9edf3'), borderRadius: 2, p: 2, overflow: 'auto', maxHeight: '80vh' }}>
          <Box sx={{ display: 'inline-block' }}>
            <Box sx={{ display: 'flex' }}>
              <Box sx={{ width: RULER, height: RULER, bgcolor: '#fff', borderRight: '1px solid #dfe5ee', borderBottom: '1px solid #dfe5ee' }} />
              <HRuler width={dims.w} />
            </Box>
            {/* Una hoja INDEPENDIENTE por página: lo que se ve es lo que sale. */}
            {Array.from({ length: pageCount }).map((_, i) => (
            <Box key={i} sx={{ display: 'flex', mb: i < pageCount - 1 ? 2.5 : 0 }}>
              <VRuler height={dims.h} />
              <Box sx={{ position: 'relative' }}>
                {/* Cabecera de la hoja: número y, si hay más de una, botón de eliminar. */}
                <Stack direction="row" alignItems="center" justifyContent="space-between"
                  sx={{ position: 'absolute', top: -20, left: 0, right: 0, height: 18 }}>
                  <Typography sx={{ fontSize: 10, color: desbordadas.includes(i) ? '#e5484d' : '#64748b' }}>
                    Página {i + 1} de {pageCount}
                    {desbordadas.includes(i) ? ' · el contenido no cabe' : ''}
                  </Typography>
                  {pageCount > 1 && (
                    <Tooltip title={`Eliminar la página ${i + 1}`}>
                      <IconButton size="small" sx={{ p: 0.25 }} onClick={() => removePage(i)}>
                        <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
                <Box
                  ref={(el: HTMLDivElement | null) => { pageRefs.current[i] = el; }}
                  contentEditable
                  suppressContentEditableWarning
                  onFocus={() => setActivePage(i)}
                  onInput={() => setGuiasTick((n) => n + 1)}
                  sx={{
                    // Medidas ESPEJO de `wrap_html` (ver el bloque de fidelidad arriba):
                    // márgenes del documento, cuerpo de 12 pt y títulos de 22/18/15 pt. Con
                    // los valores viejos (64 px y 15 px) el texto cabía distinto acá que en
                    // el PDF.
                    // Alto FIJO (no `minHeight`): la hoja ya no crece, es una página real.
                    width: dims.w, height: dims.h, boxSizing: 'border-box',
                    pt: `${marginPx.top}px`, pr: `${marginPx.right}px`,
                    pb: `${marginPx.bottom}px`, pl: `${marginPx.left}px`,
                    bgcolor: '#fff', color: '#111', fontFamily: font,
                    fontSize: `${BODY_PT * PT}px`, lineHeight: 1.5,
                    boxShadow: '0 8px 30px rgba(16,35,63,.18)', outline: 'none',
                    // El desborde se VE (no se recorta) y la hoja se marca en rojo, para
                    // que el problema no se descubra al generar el PDF.
                    overflow: 'visible',
                    ...(desbordadas.includes(i)
                      ? { boxShadow: '0 8px 30px rgba(16,35,63,.18), 0 0 0 2px #e5484d' }
                      : null),
                    '& h1': { fontSize: `${HEADING_PT.h1 * PT}px` },
                    '& h2': { fontSize: `${HEADING_PT.h2 * PT}px` },
                    '& h3': { fontSize: `${HEADING_PT.h3 * PT}px` },
                    /**
                     * ⚠️ El margen del PRIMER elemento se anula, o el lienzo miente.
                     *
                     * Medido contra el PDF real: xhtml2pdf NO aplica el `margin-top` del
                     * primer bloque al inicio de una página (el texto arranca exactamente
                     * en el margen, en la hoja 1 y en todas). El navegador sí lo aplica,
                     * así que un `<h1>` sumaba sus 0,52 cm por dentro: con 1,5 cm
                     * configurados el texto se veía en 2 cm, y con 2 en 2,5. Igual con el
                     * último elemento y el margen inferior.
                     */
                    '& > *:first-of-type': { marginTop: 0 },
                    '& > *:last-child': { marginBottom: 0 },
                    '& table': { borderCollapse: 'collapse', width: '100%' },
                    '& td, & th': { border: '1px solid #cbd5e1', padding: '6px' },
                    '& img': { maxWidth: '100%' }, '& blockquote': { borderLeft: '3px solid #cbd5e1', margin: '8px 0', paddingLeft: '10px', color: '#555' },
                    // El salto de página se ve como lo que es: una línea de corte.
                    '& [data-mc-break]': {
                      height: 0, borderTop: '2px dashed #0075be', position: 'relative',
                      margin: '14px 0', '&::after': {
                        content: '"salto de página"', position: 'absolute', right: 0, top: 2,
                        fontSize: 10, color: '#0075be', background: '#fff', padding: '0 4px',
                      },
                    },
                  }}
                />
                {/* Línea del área imprimible: debajo de ella el contenido ya no cabe. */}
                {desbordadas.includes(i) && (
                  <Box sx={{
                    position: 'absolute', left: 0, right: 0, bottom: 0,
                    borderTop: '1px dashed #e5484d', pointerEvents: 'none',
                  }} />
                )}
              </Box>
            </Box>
            ))}
            <Button size="small" startIcon={<AddIcon />} onClick={addPage}
              sx={{ mt: 1.5, ml: `${RULER}px` }}>
              Agregar página
            </Button>
            {desbordadas.length > 0 && (
              <Typography variant="caption" sx={{ display: 'block', mt: 1, ml: `${RULER}px`, color: '#e5484d' }}>
                {desbordadas.length === 1
                  ? `El contenido de la página ${desbordadas[0] + 1} no cabe en la hoja.`
                  : `El contenido de ${desbordadas.length} páginas no cabe en la hoja.`}
                {' '}En el PDF quedaría cortado: agrega una página y pasa allí lo que sobra,
                o reduce los márgenes desde "Configurar página".
              </Typography>
            )}
          </Box>
        </Box>
      </Stack>

      {/* Las variables salen de los encabezados REALES de la base elegida. Antes había una
          lista inventada (nombre/email/empresa/ciudad) y, si el CSV del cliente no traía esa
          columna exacta, el documento salía con el dato en blanco — y en un PDF
          personalizado (un certificado, un extracto) eso se ve mucho más que en un correo. */}
      <Menu anchorEl={varAnchor} open={Boolean(varAnchor)} onClose={() => setVarAnchor(null)}>
        {dbFields.length === 0 && (
          <MenuItem disabled sx={{ whiteSpace: 'normal', maxWidth: 300 }}>
            <Typography variant="body2">
              Elige una base de datos abajo para usar sus columnas como variables.
            </Typography>
          </MenuItem>
        )}
        {dbFields.map((v) => (
          <MenuItem key={v} onClick={() => { insertHtml(`{{${v}}}`); setVarAnchor(null); }}>{`{{${v}}}`}</MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={loadAnchor} open={Boolean(loadAnchor)} onClose={() => setLoadAnchor(null)}>
        {cloudLoading && <MenuItem disabled>Cargando del sistema…</MenuItem>}
        {!cloudLoading && cloudTemplates.map((t) => (
          <MenuItem key={t.messageTemplateId} onClick={() => loadTemplate(t)}>{t.name}</MenuItem>
        ))}
        {!cloudLoading && Object.keys(drafts).sort()
          .filter((n) => !cloudTemplates.some((t) => t.name === n))
          .map((n) => <MenuItem key={`local-${n}`} onClick={() => loadDraft(n)}>{n} (local)</MenuItem>)}
        {!cloudLoading && cloudTemplates.length === 0 && Object.keys(drafts).length === 0 && (
          <MenuItem disabled>No hay plantillas guardadas</MenuItem>
        )}
      </Menu>

      <Dialog open={pdfOpen} onClose={closePdf} maxWidth="md" fullWidth>
        <DialogTitle>Vista previa del PDF (datos de muestra)</DialogTitle>
        <DialogContent dividers sx={{ p: 0, height: '75vh' }}>
          {pdfUrl && <Box component="iframe" src={pdfUrl} title="Vista previa PDF" sx={{ width: '100%', height: '100%', border: 0 }} />}
        </DialogContent>
        <DialogActions>
          <Button
            component="a"
            href={pdfUrl}
            download="plantilla-pdf.pdf"
            startIcon={<DownloadIcon />}
          >
            Descargar PDF
          </Button>
          <Button onClick={closePdf}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={nameOpen} onClose={() => setNameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Guardar plantilla PDF</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Nombre de la plantilla"
            placeholder="Ej. Certificado laboral"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && nameValue.trim()) confirmSave(); }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNameOpen(false)}>Cancelar</Button>
          <Button variant="contained" disabled={!nameValue.trim()} onClick={confirmSave}>Guardar</Button>
        </DialogActions>
      </Dialog>

      {/* Configuración de página: hoja, orientación, márgenes y membrete. Todo se guarda
          DENTRO del documento, así que el envío real usa exactamente lo mismo. */}
      {/* MOVIBLE y sin fondo oscurecido: los cambios de márgenes, orientación y membrete
          se ven en el lienzo mientras se tocan. Antes el diálogo tapaba justo lo que
          estaba modificando, así que había que aceptar, mirar y volver a abrir. */}
      <DraggableDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        title="Configurar página"
        width={560}
        actions={(
          <>
            <Button onClick={() => setSetup({ ...DEFAULT_SETUP })}>Restablecer</Button>
            <Button variant="contained" onClick={() => setSetupOpen(false)}>Listo</Button>
          </>
        )}
      >
          <Stack spacing={2.5} sx={{ mt: 0.5 }}>
            <Stack direction="row" spacing={2}>
              <TextField select size="small" label="Hoja" fullWidth value={setup.size}
                onChange={(e) => setSetup((s) => ({ ...s, size: e.target.value as 'A4' | 'Carta' }))}>
                <MenuItem value="A4">A4 (21 × 29,7 cm)</MenuItem>
                <MenuItem value="Carta">Carta (21,6 × 27,9 cm)</MenuItem>
              </TextField>
              <TextField select size="small" label="Orientación" fullWidth
                value={setup.landscape ? 'landscape' : 'portrait'}
                onChange={(e) => setSetup((s) => ({ ...s, landscape: e.target.value === 'landscape' }))}>
                <MenuItem value="portrait">Vertical</MenuItem>
                <MenuItem value="landscape">Horizontal</MenuItem>
              </TextField>
            </Stack>

            <Box>
              <Typography variant="subtitle2" gutterBottom>Márgenes (cm)</Typography>
              <Stack direction="row" spacing={1.5}>
                {(['top', 'right', 'bottom', 'left'] as const).map((lado) => (
                  <TextField
                    key={lado} size="small" type="number" fullWidth
                    label={{ top: 'Arriba', right: 'Derecha', bottom: 'Abajo', left: 'Izquierda' }[lado]}
                    value={setup.margin[lado]}
                    inputProps={{ min: 0, max: 10, step: 0.5 }}
                    onChange={(e) => {
                      // El backend acota igual; aquí se evita que el lienzo se vuelva
                      // inservible mientras se escribe.
                      const v = Math.max(0, Math.min(10, Number(e.target.value) || 0));
                      setSetup((s) => ({ ...s, margin: { ...s.margin, [lado]: v } }));
                    }}
                  />
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>Membrete</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Se repiten en TODAS las hojas. Admiten variables de tu base
                (<code>{'{{Nombre}}'}</code>) y los botones de numeración.
              </Typography>
              <Stack spacing={1.5}>
                {(['header', 'footer'] as const).map((banda) => (
                  <Box key={banda}>
                    <TextField
                      size="small" fullWidth
                      label={banda === 'header' ? 'Encabezado' : 'Pie de página'}
                      placeholder={banda === 'header'
                        ? 'ACME S.A.S · Extracto de cuenta'
                        : 'Página [[pagina]] de [[paginas]]'}
                      value={setup[banda]}
                      onChange={(e) => setSetup((s) => ({ ...s, [banda]: e.target.value }))}
                    />
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                      {PAGE_TOKENS.map((t) => (
                        <Button key={t.token} size="small" variant="text"
                          onClick={() => setSetup((s) => ({ ...s, [banda]: `${s[banda]}${t.token}` }))}>
                          + {t.label}
                        </Button>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Puedes arrastrar esta ventana por su barra para ver el documento mientras
              ajustas los valores.
            </Typography>
          </Stack>
      </DraggableDialog>

      {/* Enlace. Antes era `window.prompt`, que además de feo no dejaba corregir el texto
          del enlace ni avisaba de una URL inválida. */}
      {/* Tabla: inserta una nueva o edita la que está bajo el cursor (conservando lo
          escrito en las celdas). Todos los estilos salen EN LÍNEA porque xhtml2pdf no
          aplica selectores CSS de forma fiable — ver `pdfDocument.ts`. */}
      <Dialog open={tableOpen} onClose={() => setTableOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingTable.current ? 'Editar tabla' : 'Insertar tabla'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Stack direction="row" spacing={2}>
              <TextField label="Filas" type="number" size="small" fullWidth
                helperText={`Sin contar el encabezado · máx. ${TABLE_MAX_ROWS}`}
                value={tableCfg.rows}
                inputProps={{ min: 1, max: TABLE_MAX_ROWS }}
                onChange={(e) => setTableCfg({ ...tableCfg, rows: Number(e.target.value) })} />
              <TextField label="Columnas" type="number" size="small" fullWidth
                helperText={`Máx. ${TABLE_MAX_COLS}`}
                value={tableCfg.cols}
                inputProps={{ min: 1, max: TABLE_MAX_COLS }}
                onChange={(e) => setTableCfg({ ...tableCfg, cols: Number(e.target.value) })} />
            </Stack>

            <Divider textAlign="left"><Typography variant="caption">Borde</Typography></Divider>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField select label="Estilo" size="small" sx={{ flex: 1 }}
                value={tableCfg.borderStyle}
                onChange={(e) => setTableCfg({ ...tableCfg, borderStyle: e.target.value as TableConfig['borderStyle'] })}>
                <MenuItem value="solid">Continuo</MenuItem>
                <MenuItem value="dashed">Discontinuo</MenuItem>
                <MenuItem value="dotted">Punteado</MenuItem>
                <MenuItem value="none">Sin borde</MenuItem>
              </TextField>
              <TextField label="Grosor (px)" type="number" size="small" sx={{ width: 120 }}
                value={tableCfg.borderWidth} inputProps={{ min: 0, max: 10 }}
                disabled={tableCfg.borderStyle === 'none'}
                onChange={(e) => setTableCfg({ ...tableCfg, borderWidth: Number(e.target.value) })} />
              <Stack alignItems="center" spacing={0.25}>
                <Typography variant="caption" color="text.secondary">Color</Typography>
                <input type="color" value={tableCfg.borderColor}
                  disabled={tableCfg.borderStyle === 'none'}
                  onChange={(e) => setTableCfg({ ...tableCfg, borderColor: e.target.value })}
                  style={{ width: 44, height: 32, border: 'none', background: 'none', padding: 0 }} />
              </Stack>
            </Stack>

            <Divider textAlign="left"><Typography variant="caption">Relleno</Typography></Divider>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField select label="Fila de encabezado" size="small" sx={{ flex: 1 }}
                value={tableCfg.header ? 'si' : 'no'}
                onChange={(e) => setTableCfg({ ...tableCfg, header: e.target.value === 'si' })}>
                <MenuItem value="si">Sí, la primera fila</MenuItem>
                <MenuItem value="no">Sin encabezado</MenuItem>
              </TextField>
              <Stack alignItems="center" spacing={0.25}>
                <Typography variant="caption" color="text.secondary">Fondo</Typography>
                <input type="color" value={tableCfg.headerBg} disabled={!tableCfg.header}
                  onChange={(e) => setTableCfg({ ...tableCfg, headerBg: e.target.value })}
                  style={{ width: 44, height: 32, border: 'none', background: 'none', padding: 0 }} />
              </Stack>
              <Stack alignItems="center" spacing={0.25}>
                <Typography variant="caption" color="text.secondary">Texto</Typography>
                <input type="color" value={tableCfg.headerColor} disabled={!tableCfg.header}
                  onChange={(e) => setTableCfg({ ...tableCfg, headerColor: e.target.value })}
                  style={{ width: 44, height: 32, border: 'none', background: 'none', padding: 0 }} />
              </Stack>
            </Stack>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField select label="Filas alternas" size="small" sx={{ flex: 1 }}
                helperText="Colorea una fila sí y otra no (más fácil de leer)"
                value={tableCfg.zebra ? 'si' : 'no'}
                onChange={(e) => setTableCfg({ ...tableCfg, zebra: e.target.value === 'si' })}>
                <MenuItem value="si">Sí</MenuItem>
                <MenuItem value="no">No</MenuItem>
              </TextField>
              <Stack alignItems="center" spacing={0.25}>
                <Typography variant="caption" color="text.secondary">Color</Typography>
                <input type="color" value={tableCfg.zebraBg} disabled={!tableCfg.zebra}
                  onChange={(e) => setTableCfg({ ...tableCfg, zebraBg: e.target.value })}
                  style={{ width: 44, height: 32, border: 'none', background: 'none', padding: 0 }} />
              </Stack>
            </Stack>

            <Divider textAlign="left"><Typography variant="caption">Medidas</Typography></Divider>
            <Stack direction="row" spacing={2}>
              <TextField label="Relleno de celda (px)" type="number" size="small" fullWidth
                value={tableCfg.cellPadding} inputProps={{ min: 0, max: 40 }}
                onChange={(e) => setTableCfg({ ...tableCfg, cellPadding: Number(e.target.value) })} />
              <TextField select label="Ancho" size="small" fullWidth value={tableCfg.width}
                onChange={(e) => setTableCfg({ ...tableCfg, width: e.target.value as TableConfig['width'] })}>
                <MenuItem value="full">Todo el ancho</MenuItem>
                <MenuItem value="auto">Según el contenido</MenuItem>
              </TextField>
              <TextField select label="Alineación" size="small" fullWidth value={tableCfg.align}
                disabled={tableCfg.width === 'full'}
                onChange={(e) => setTableCfg({ ...tableCfg, align: e.target.value as TableConfig['align'] })}>
                <MenuItem value="left">Izquierda</MenuItem>
                <MenuItem value="center">Centro</MenuItem>
                <MenuItem value="right">Derecha</MenuItem>
              </TextField>
            </Stack>

            {/* Vista previa en vivo: el MISMO HTML que se va a insertar. */}
            <Box>
              <Typography variant="caption" color="text.secondary">Vista previa</Typography>
              <Box sx={{ mt: 0.5, p: 1.5, bgcolor: '#fff', color: '#111', borderRadius: 1, border: '1px solid #e0e6ef', overflowX: 'auto' }}
                dangerouslySetInnerHTML={{ __html: buildTableHtml(tableCfg) }} />
            </Box>

            {editingTable.current && (
              <Typography variant="caption" color="text.secondary">
                Al reducir filas o columnas se quitan por el final. El texto que ya
                escribiste en las celdas que quedan se conserva.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setTableOpen(false); editingTable.current = null; }}>Cancelar</Button>
          <Button variant="contained" onClick={applyTable}>
            {editingTable.current ? 'Aplicar' : 'Insertar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Insertar enlace</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus fullWidth label="Dirección (URL)" placeholder="https://…"
              value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); }}
              helperText="Acepta http://, https://, mailto: y tel:"
            />
            {/* Solo tiene sentido cuando NO hay texto seleccionado: si lo hay, el enlace se
                aplica sobre esa selección y este campo no participa. */}
            {!linkText && (
              <TextField
                fullWidth label="Texto que se ve (opcional)" placeholder="Ver el documento"
                value={linkText} onChange={(e) => setLinkText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); }}
                helperText="Si lo dejas vacío se muestra la dirección completa."
              />
            )}
            {linkText && (
              <Typography variant="body2" color="text.secondary">
                Se va a enlazar el texto seleccionado: <strong>{linkText}</strong>
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>Cancelar</Button>
          <Button variant="contained" disabled={!linkUrl.trim()} onClick={applyLink}>Insertar</Button>
        </DialogActions>
      </Dialog>

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
