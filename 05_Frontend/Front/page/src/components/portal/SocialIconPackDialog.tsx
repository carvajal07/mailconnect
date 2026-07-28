import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Stack, TextField, MenuItem, Alert, CircularProgress, LinearProgress,
} from '@mui/material';
import { SOCIAL_NETWORKS, type SocialLinks, type SocialShape } from './htmlBuilder';
import {
  renderIconPreview, renderIconFile, DEFAULT_ICON_PACK, type IconPackStyle,
} from './socialIconPack';

/**
 * Aplica los LOGOS REALES de las redes con los colores de la marca del cliente.
 *
 * Los PNG del repo son máscaras alfa (silueta negra sobre transparente), así que se
 * recolorean en el navegador y se suben ya con el color horneado: un cliente de correo no
 * aplica `filter` de CSS, de modo que el color no se puede cambiar en el envío.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Redes que hoy tienen enlace: solo a esas se les genera icono. */
  activas: (keyof SocialLinks)[];
  /** Sube el PNG generado y devuelve su URL pública (bucket del propio cliente). */
  onUpload: (file: File) => Promise<string | null>;
  /** Recibe el mapa {red: url} ya subido. */
  onApply: (icons: Partial<Record<keyof SocialLinks, string>>) => void;
  /** Tamaño de insignia y forma que ya tiene el bloque, para arrancar coherente. */
  size?: number;
  shape?: SocialShape;
}

const PRESETS: { label: string; style: Partial<IconPackStyle> }[] = [
  { label: 'Oscuro (como el ejemplo)', style: { glyph: '#ffffff', background: '#111111', shape: 'rounded' } },
  { label: 'Marca MailConnect', style: { glyph: '#ffffff', background: '#0075be', shape: 'circle' } },
  { label: 'Contorno claro', style: { glyph: '#16233f', background: '#eef2f7', shape: 'circle' } },
  { label: 'Solo el logo (sin fondo)', style: { glyph: '#16233f', background: '' } },
];

export const SocialIconPackDialog = ({
  open, onClose, activas, onUpload, onApply, size, shape,
}: Props) => {
  const [style, setStyle] = useState<IconPackStyle>({
    ...DEFAULT_ICON_PACK,
    size: size || DEFAULT_ICON_PACK.size,
    shape: shape || DEFAULT_ICON_PACK.shape,
  });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [aplicando, setAplicando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState('');

  const set = <K extends keyof IconPackStyle>(k: K, v: IconPackStyle[K]) =>
    setStyle((s) => ({ ...s, [k]: v }));

  // Vista previa de TODAS las redes: se ve el set completo antes de subir nada.
  const pintar = useCallback(async () => {
    const out: Record<string, string> = {};
    for (const n of SOCIAL_NETWORKS) {
      try { out[n.key] = await renderIconPreview(n.key, { ...style, size: 44 }); } catch { /* sigue */ }
    }
    setPreviews(out);
  }, [style]);

  useEffect(() => { if (open) void pintar(); }, [open, pintar]);

  const aplicar = async () => {
    if (!activas.length) return;
    setAplicando(true);
    setError('');
    setProgreso(0);
    const icons: Partial<Record<keyof SocialLinks, string>> = {};
    for (let i = 0; i < activas.length; i += 1) {
      const red = activas[i];
      try {
        const url = await onUpload(await renderIconFile(red, style));
        if (url) icons[red] = url;
      } catch (e) {
        setError(`No se pudo generar el icono de ${red}: ${(e as Error).message}`);
      }
      setProgreso(Math.round(((i + 1) / activas.length) * 100));
    }
    setAplicando(false);
    if (Object.keys(icons).length) {
      onApply(icons);
      onClose();
    } else if (!error) {
      setError('No se pudo subir ningún icono.');
    }
  };

  return (
    <Dialog open={open} onClose={aplicando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Logos reales de las redes</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Los logos se recolorean aquí y se suben a TU bucket con el color ya aplicado: un
          cliente de correo no puede recolorear una imagen, así que el color queda horneado
          en el archivo. Cambiarlo después es volver a aplicar el paquete.
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          {PRESETS.map((p) => (
            <Button
              key={p.label} size="small" variant="outlined"
              onClick={() => setStyle((s) => ({ ...s, ...p.style }))}
            >
              {p.label}
            </Button>
          ))}
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <TextField
            label="Color del logo" type="color" size="small" sx={{ width: 110 }}
            value={style.glyph} onChange={(e) => set('glyph', e.target.value)}
          />
          <TextField
            select label="Fondo" size="small" sx={{ minWidth: 150 }}
            value={style.background ? 'color' : 'none'}
            onChange={(e) => set('background', e.target.value === 'none' ? '' : (style.background || '#111111'))}
          >
            <MenuItem value="color">Con insignia</MenuItem>
            <MenuItem value="none">Solo el logo</MenuItem>
          </TextField>
          {style.background && (
            <>
              <TextField
                label="Color del fondo" type="color" size="small" sx={{ width: 110 }}
                value={style.background} onChange={(e) => set('background', e.target.value)}
              />
              <TextField
                select label="Forma" size="small" sx={{ minWidth: 150 }}
                value={style.shape || 'rounded'}
                onChange={(e) => set('shape', e.target.value as SocialShape)}
              >
                <MenuItem value="circle">Círculo</MenuItem>
                <MenuItem value="rounded">Cuadrado redondeado</MenuItem>
                <MenuItem value="square">Cuadrado</MenuItem>
              </TextField>
            </>
          )}
        </Stack>

        <Typography variant="overline" color="text.secondary">Vista previa</Typography>
        <Box sx={{
          display: 'flex', gap: 1.5, flexWrap: 'wrap', p: 2, mt: 0.5, borderRadius: 1,
          bgcolor: (t) => (t.palette.mode === 'dark' ? '#0b1220' : '#f6f8fb'),
        }}>
          {SOCIAL_NETWORKS.map((n) => (
            <Box key={n.key} sx={{ textAlign: 'center', opacity: activas.includes(n.key) ? 1 : 0.35 }}>
              {previews[n.key]
                ? <Box component="img" src={previews[n.key]} alt={n.label} sx={{ width: 44, height: 44, display: 'block' }} />
                : <Box sx={{ width: 44, height: 44 }} />}
              <Typography variant="caption" sx={{ fontSize: 9 }}>{n.label}</Typography>
            </Box>
          ))}
        </Box>

        <Alert severity="info" sx={{ mt: 2 }}>
          {activas.length
            ? `Se generarán ${activas.length} icono(s): solo las redes que ya tienen enlace. Las demás siguen con su insignia.`
            : 'Primero pon el enlace de al menos una red; solo se generan iconos para las que tienen enlace.'}
        </Alert>
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        {aplicando && <LinearProgress variant="determinate" value={progreso} sx={{ mt: 2 }} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={aplicando}>Cancelar</Button>
        <Button
          variant="contained" onClick={aplicar}
          disabled={aplicando || activas.length === 0}
          startIcon={aplicando ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {aplicando ? `Subiendo… ${progreso}%` : 'Aplicar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
