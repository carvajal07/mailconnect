import { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Paper, Stack, Tooltip, IconButton, Divider, Popover, TextField, Button, MenuItem, Select } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatColorTextIcon from '@mui/icons-material/FormatColorText';
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import { sanitizeInlineHtml } from './richText';

/**
 * Editor de TEXTO ENRIQUECIDO en línea para los bloques del constructor de correos.
 *
 * `contentEditable` + `document.execCommand` — el mismo enfoque que ya usa el editor de
 * "Plantillas PDF", sin dependencias nuevas. Lo que se guarda pasa SIEMPRE por
 * `sanitizeInlineHtml`, así que el modelo nunca contiene markup que no se pueda enviar
 * por correo (ni lo que pega Word, ni un `<script>`).
 *
 * La barra aparece al enfocar y solo mientras se edita: en el lienzo el bloque se ve tal
 * como saldrá, sin cromo encima.
 */

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Estilo base del párrafo en el lienzo (para que el WYSIWYG sea fiel). */
  style?: React.CSSProperties;
  placeholder?: string;
  /** Campos de la base para el menú "insertar variable". */
  variables?: string[];
  /** Inserta el token de variable ya formado (con respaldo si lo definieron). */
  onRequestVariable?: () => void;
  /**
   * El bloque está SELECCIONADO. La barra se muestra también en ese caso, no solo al
   * enfocar: con "solo al enfocar" había que adivinar que hacía falta hacer clic DENTRO
   * del texto, y las opciones de formato parecían no existir.
   */
  active?: boolean;
}

const FONT_SIZES = [
  { label: 'Pequeño', px: '13px' },
  { label: 'Normal', px: '15px' },
  { label: 'Mediano', px: '18px' },
  { label: 'Grande', px: '22px' },
  { label: 'Enorme', px: '28px' },
];

/**
 * Fuentes SEGURAS para correo: las que están instaladas en la mayoría de sistemas. Una
 * fuente web (Google Fonts) no se puede cargar en Gmail/Outlook, así que ofrecer más
 * variedad solo produciría correos que se ven distintos de como se diseñaron.
 */
const FONT_FAMILIES = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Tahoma, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
];

/** Comandos cuyo estado se refleja en la barra (botón resaltado = ya está aplicado). */
const TOGGLES = ['bold', 'italic', 'underline', 'strikeThrough'] as const;
type Toggle = (typeof TOGGLES)[number];

/**
 * Botón que abre el selector de color NATIVO del sistema.
 *
 * ⚠️ El `<input type="color">` NO puede llevar `hidden` ni `display:none`: sin caja en el
 * layout, el navegador abre su paleta anclada al origen de la página — o sea allá arriba
 * a la izquierda, lejos del botón que se acaba de pulsar. Se deja ocupando el botón
 * entero, transparente: la paleta sale justo debajo, que es donde se la espera.
 */
const ColorTool = ({ title, inicial, onPick, children }: {
  title: string;
  inicial?: string;
  onPick: (valor: string) => void;
  children: React.ReactNode;
}) => (
  <Tooltip title={title}>
    <IconButton size="small" component="label" sx={{ position: 'relative' }}>
      {children}
      <Box
        component="input" type="color" defaultValue={inicial}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPick(e.target.value)}
        sx={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: 0, border: 0, padding: 0, cursor: 'pointer',
        }}
      />
    </IconButton>
  </Tooltip>
);

export const RichTextEditor = ({
  value, onChange, style, placeholder, variables = [], onRequestVariable, active,
}: Props) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const savedRange = useRef<Range | null>(null);
  /** Qué formato tiene la selección actual, para pintar los botones activos. */
  const [estado, setEstado] = useState<Record<Toggle, boolean>>({
    bold: false, italic: false, underline: false, strikeThrough: false,
  });
  /**
   * La barra va ARRIBA del texto salvo que no quepa, y entonces baja.
   *
   * ⚠️ Hace falta porque el PRIMER bloque del lienzo está pegado al borde del panel, que
   * hace su propio scroll con `overflow`: una barra colocada arriba se recortaba y solo se
   * veía media fila de botones — justo el caso más común, un correo que empieza con texto.
   */
  const [abajo, setAbajo] = useState(false);

  /** Último HTML que EMITIMOS nosotros. Ver la guarda del efecto de abajo. */
  const lastEmitted = useRef<string | null>(null);

  /**
   * El HTML entra por prop pero el nodo es contentEditable, así que reescribir su
   * `innerHTML` manda el cursor AL INICIO del texto.
   *
   * ⚠️ No basta con comparar `el.innerHTML !== value`: `sanitizeInlineHtml` **normaliza**
   * el markup (`<b>`→`<strong>`, los `<div>` del contentEditable→`<br>`, escapes…), así
   * que lo que vuelve por prop casi nunca es idéntico byte a byte a lo que hay en el DOM.
   * Con esa sola comparación, cada tecla reescribía el nodo y el cursor saltaba al
   * principio. Por eso se ignora el ECO de nuestro propio `emit` y solo se aplica un
   * valor que venga de FUERA (cargar una plantilla, insertar variable desde el panel…).
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastEmitted.current !== null && value === lastEmitted.current) return;
    if (el.innerHTML !== value) el.innerHTML = value || '';
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const limpio = sanitizeInlineHtml(el.innerHTML);
    lastEmitted.current = limpio;
    onChange(limpio);
  }, [onChange]);

  /** Alto de la barra + el aire que hay que dejarle por encima del bloque. */
  const ALTO_BARRA = 84;

  useEffect(() => {
    if (!focused && !active) return;
    const el = ref.current;
    if (!el) return;
    // Se mide contra el contenedor que hace scroll (el panel del lienzo); si no hay,
    // contra la ventana.
    let cont: HTMLElement | null = el.parentElement;
    while (cont && getComputedStyle(cont).overflowY === 'visible') cont = cont.parentElement;
    const limite = cont ? cont.getBoundingClientRect().top : 0;
    setAbajo(el.getBoundingClientRect().top - limite < ALTO_BARRA);
  }, [focused, active, value]);

  /** Lee del documento qué formato tiene la selección (negrita, cursiva…). */
  const refreshEstado = useCallback(() => {
    try {
      setEstado({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
      });
    } catch { /* queryCommandState no es universal; sin estado la barra sigue sirviendo */ }
  }, []);

  /** Guarda la selección: al tocar un botón de la barra el foco sale del editable. */
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
    refreshEstado();
  };

  const restoreRange = () => {
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    ref.current?.focus();
  };

  const exec = (command: string, arg?: string) => {
    restoreRange();
    document.execCommand(command, false, arg);
    emit();
    saveRange();
  };

  /**
   * Envuelve la selección en un `<span>` con el estilo dado. `execCommand` no tiene
   * comando para `font-family` ni para el resaltado en todos los navegadores, y su
   * `fontName` emite `<font face>` (que el saneamiento descarta).
   *
   * Sin selección no hace nada: aplicar un estilo a un cursor colapsado dejaría un span
   * vacío que confunde más de lo que ayuda.
   */
  const wrapStyle = (prop: 'fontFamily' | 'backgroundColor', valor: string) => {
    restoreRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style[prop] = valor;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // Deja la selección sobre lo que se acaba de formatear (se puede seguir aplicando).
      sel.removeAllRanges();
      const nuevo = document.createRange();
      nuevo.selectNodeContents(span);
      sel.addRange(nuevo);
    } catch { /* selección que cruza nodos de forma no envolvible: se deja como estaba */ }
    emit();
    saveRange();
  };

  /** Pegado SIEMPRE como texto plano: pegar de Word arrastra estilos que rompen el correo. */
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    setLinkAnchor(null);
    if (!url) return;
    exec('createLink', url);
    setLinkUrl('');
  };

  const insertVariable = (field: string) => {
    restoreRange();
    document.execCommand('insertText', false, `{{${field}}}`);
    emit();
  };

  /** Botón de formato que se pinta ACTIVO cuando ya está aplicado a la selección. */
  const Toggle = ({ cmd, title, children }: { cmd: Toggle; title: string; children: React.ReactNode }) => (
    <Tooltip title={title}>
      <IconButton
        size="small" onClick={() => exec(cmd)}
        sx={{
          color: estado[cmd] ? 'primary.main' : 'inherit',
          bgcolor: estado[cmd] ? 'action.selected' : 'transparent',
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box sx={{ position: 'relative' }}>
      {(focused || active) && (
        <Paper
          elevation={6}
          // `onMouseDown preventDefault` evita que el clic en la barra saque el foco del
          // editable (y con él, la selección que se va a formatear).
          onMouseDown={(e) => e.preventDefault()}
          // El clic en la barra no debe llegar al lienzo (deseleccionaría el bloque).
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: 'absolute', left: 0, zIndex: 30,
            // ⚠️ Arriba: la barra de ORDENAR el bloque (arrastrar/subir/bajar/copiar/
            // eliminar) vive en `top:-34` del contenedor, o sea justo en esta franja; sin
            // el margen las dos se montaban. Abajo no hay nada con qué chocar.
            ...(abajo
              ? { top: '100%', mt: 0.75 }
              : { bottom: '100%', mb: 4.75 }),
            // Envuelve a una segunda fila en vez de hacer scroll horizontal: con scroll,
            // las últimas herramientas (enlace, listas, quitar formato) quedaban fuera de
            // vista sin ninguna señal de que estaban ahí.
            p: 0.75, borderRadius: 1.5, maxWidth: '100%', minWidth: 320,
          }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap rowGap={0.75}>
            <Toggle cmd="bold" title="Negrita"><FormatBoldIcon fontSize="small" /></Toggle>
            <Toggle cmd="italic" title="Cursiva"><FormatItalicIcon fontSize="small" /></Toggle>
            <Toggle cmd="underline" title="Subrayado"><FormatUnderlinedIcon fontSize="small" /></Toggle>
            <Toggle cmd="strikeThrough" title="Tachado"><StrikethroughSIcon fontSize="small" /></Toggle>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            <Select
              size="small" value="" displayEmpty variant="standard" disableUnderline
              onChange={(e) => wrapStyle('fontFamily', String(e.target.value))}
              sx={{ minWidth: 104, fontSize: 13, px: 0.75 }}
              renderValue={() => 'Fuente'}
            >
              {FONT_FAMILIES.map((f) => (
                <MenuItem key={f.label} value={f.value} sx={{ fontFamily: f.value || 'inherit' }}>
                  {f.label}
                </MenuItem>
              ))}
            </Select>

            <Select
              size="small" value="" displayEmpty variant="standard" disableUnderline
              onChange={(e) => {
                // execCommand fontSize solo acepta 1..7; se aplica el px real con un span.
                restoreRange();
                document.execCommand('fontSize', false, '7');
                const el = ref.current;
                el?.querySelectorAll('font[size="7"]').forEach((f) => {
                  const span = document.createElement('span');
                  span.style.fontSize = String(e.target.value);
                  span.innerHTML = f.innerHTML;
                  f.replaceWith(span);
                });
                emit();
              }}
              sx={{ minWidth: 92, fontSize: 13, px: 0.75 }}
              renderValue={() => 'Tamaño'}
            >
              {FONT_SIZES.map((s) => (
                <MenuItem key={s.px} value={s.px} sx={{ fontSize: s.px }}>{s.label}</MenuItem>
              ))}
            </Select>

            <ColorTool title="Color del texto" onPick={(v) => exec('foreColor', v)}>
              <FormatColorTextIcon fontSize="small" />
            </ColorTool>
            {/* `hiliteColor`/`backColor` se comportan distinto en cada navegador (y en
                algunos pintan TODO el bloque). Envolver en un span es predecible y es
                exactamente lo que el correo necesita: estilo en línea. */}
            <ColorTool title="Resaltar (fondo del texto)" inicial="#fff3a3"
              onPick={(v) => wrapStyle('backgroundColor', v)}>
              <FormatColorFillIcon fontSize="small" />
            </ColorTool>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            <Tooltip title="Viñetas"><IconButton size="small" onClick={() => exec('insertUnorderedList')}><FormatListBulletedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Lista numerada"><IconButton size="small" onClick={() => exec('insertOrderedList')}><FormatListNumberedIcon fontSize="small" /></IconButton></Tooltip>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            <Tooltip title="Insertar enlace">
              <IconButton size="small" onClick={(e) => { saveRange(); setLinkAnchor(e.currentTarget); }}>
                <LinkIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Quitar enlace"><IconButton size="small" onClick={() => exec('unlink')}><LinkOffIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Quitar formato"><IconButton size="small" onClick={() => exec('removeFormat')}><FormatClearIcon fontSize="small" /></IconButton></Tooltip>

            {(variables.length > 0 || onRequestVariable) && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <Select
                  size="small" value="" displayEmpty variant="standard" disableUnderline
                  onChange={(e) => {
                    const v = String(e.target.value);
                    if (v === '__custom__') onRequestVariable?.();
                    else if (v) insertVariable(v);
                  }}
                  sx={{ minWidth: 96, fontSize: 13, px: 0.75 }}
                  renderValue={() => 'Variable'}
                >
                  {variables.map((v) => <MenuItem key={v} value={v}>{`{{${v}}}`}</MenuItem>)}
                  {onRequestVariable && <MenuItem value="__custom__">Con valor por defecto…</MenuItem>}
                </Select>
              </>
            )}
          </Stack>
        </Paper>
      )}

      <Box
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={() => { emit(); setFocused(false); }}
        onFocus={() => setFocused(true)}
        onKeyUp={saveRange}
        onMouseUp={saveRange}
        onPaste={onPaste}
        data-placeholder={placeholder || 'Escribe aquí…'}
        sx={{
          outline: 'none',
          minHeight: 24,
          cursor: 'text',
          '&:empty:before': { content: 'attr(data-placeholder)', color: '#9aa7b8' },
          '& ul, & ol': { margin: '0 0 0 20px', padding: 0 },
          '& a': { color: '#0075be' },
          ...style,
        }}
      />

      <Popover
        open={Boolean(linkAnchor)} anchorEl={linkAnchor} onClose={() => setLinkAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack direction="row" spacing={1} sx={{ p: 1.5 }} alignItems="center">
          <TextField
            size="small" autoFocus placeholder="https://…" value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); }}
            sx={{ minWidth: 260 }}
          />
          <Button size="small" variant="contained" onClick={applyLink}>Aplicar</Button>
        </Stack>
      </Popover>
    </Box>
  );
};
