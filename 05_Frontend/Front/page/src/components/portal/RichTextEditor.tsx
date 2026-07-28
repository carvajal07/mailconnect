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
}

const FONT_SIZES = [
  { label: 'Pequeño', px: '13px' },
  { label: 'Normal', px: '15px' },
  { label: 'Mediano', px: '18px' },
  { label: 'Grande', px: '22px' },
  { label: 'Enorme', px: '28px' },
];

export const RichTextEditor = ({ value, onChange, style, placeholder, variables = [], onRequestVariable }: Props) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const savedRange = useRef<Range | null>(null);

  // El HTML entra por prop pero el nodo es contentEditable: solo se reescribe cuando el
  // valor EXTERNO difiere del que ya hay en el DOM. Sin esa guarda, cada tecla movería
  // el cursor al final (React re-renderiza con el valor que acaba de emitir).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value || '';
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (el) onChange(sanitizeInlineHtml(el.innerHTML));
  }, [onChange]);

  /** Guarda la selección: al tocar un botón de la barra el foco sale del editable. */
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
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

  return (
    <Box sx={{ position: 'relative' }}>
      {focused && (
        <Paper
          elevation={4}
          // `onMouseDown preventDefault` evita que el clic en la barra saque el foco del
          // editable (y con él, la selección que se va a formatear).
          onMouseDown={(e) => e.preventDefault()}
          sx={{
            position: 'absolute', bottom: '100%', left: 0, mb: 0.5, zIndex: 20,
            p: 0.5, borderRadius: 1.5, maxWidth: '100%', overflowX: 'auto',
          }}
        >
          <Stack direction="row" spacing={0.25} alignItems="center">
            <Tooltip title="Negrita"><IconButton size="small" onClick={() => exec('bold')}><FormatBoldIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Cursiva"><IconButton size="small" onClick={() => exec('italic')}><FormatItalicIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Subrayado"><IconButton size="small" onClick={() => exec('underline')}><FormatUnderlinedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Tachado"><IconButton size="small" onClick={() => exec('strikeThrough')}><StrikethroughSIcon fontSize="small" /></IconButton></Tooltip>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />

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
              sx={{ minWidth: 92, fontSize: 13, px: 0.5 }}
              renderValue={() => 'Tamaño'}
            >
              {FONT_SIZES.map((s) => (
                <MenuItem key={s.px} value={s.px} sx={{ fontSize: s.px }}>{s.label}</MenuItem>
              ))}
            </Select>

            <Tooltip title="Color del texto">
              <IconButton size="small" component="label">
                <FormatColorTextIcon fontSize="small" />
                <input
                  type="color" hidden
                  onChange={(e) => exec('foreColor', e.target.value)}
                />
              </IconButton>
            </Tooltip>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />

            <Tooltip title="Viñetas"><IconButton size="small" onClick={() => exec('insertUnorderedList')}><FormatListBulletedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Lista numerada"><IconButton size="small" onClick={() => exec('insertOrderedList')}><FormatListNumberedIcon fontSize="small" /></IconButton></Tooltip>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />

            <Tooltip title="Insertar enlace">
              <IconButton size="small" onClick={(e) => { saveRange(); setLinkAnchor(e.currentTarget); }}>
                <LinkIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Quitar enlace"><IconButton size="small" onClick={() => exec('unlink')}><LinkOffIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Quitar formato"><IconButton size="small" onClick={() => exec('removeFormat')}><FormatClearIcon fontSize="small" /></IconButton></Tooltip>

            {(variables.length > 0 || onRequestVariable) && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
                <Select
                  size="small" value="" displayEmpty variant="standard" disableUnderline
                  onChange={(e) => {
                    const v = String(e.target.value);
                    if (v === '__custom__') onRequestVariable?.();
                    else if (v) insertVariable(v);
                  }}
                  sx={{ minWidth: 96, fontSize: 13, px: 0.5 }}
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
