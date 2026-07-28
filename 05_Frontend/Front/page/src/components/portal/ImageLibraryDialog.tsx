import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Stack, CircularProgress, Alert, TextField, InputAdornment, Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import { resourcesService, type StoredImage } from '../../services/resourcesService';
import { isOk } from '../../services/apiClient';

/**
 * BIBLIOTECA de imágenes del cliente: lo que ya subió, para volver a usarlo.
 *
 * Antes cada imagen se subía a S3 y ahí se perdía: no había forma de reutilizarla, así
 * que el mismo logo se volvía a subir en cada plantilla. Este diálogo lista el prefijo
 * público `resources/` del bucket del propio tenant.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Devuelve la URL pública de la imagen elegida. */
  onSelect: (url: string) => void;
  /** Sube una imagen nueva (reusa el mismo camino a S3 del constructor). */
  onUpload?: (file: File) => Promise<string | null>;
}

export const ImageLibraryDialog = ({ open, onClose, onSelect, onUpload }: Props) => {
  const [images, setImages] = useState<StoredImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await resourcesService.list();
    setLoading(false);
    if (isOk(res)) setImages(res.data?.images ?? []);
    else setError(res.description || 'No se pudieron cargar tus imágenes.');
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const handleUpload = async (file: File | null) => {
    if (!file || !onUpload) return;
    setUploading(true);
    const url = await onUpload(file);
    setUploading(false);
    if (url) {
      onSelect(url);
      onClose();
    }
  };

  const filtradas = q.trim()
    ? images.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()))
    : images;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Tus imágenes</DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small" placeholder="Buscar por nombre" value={q}
            onChange={(e) => setQ(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
          {onUpload && (
            <Button
              size="small" variant="contained" component="label"
              startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <AddPhotoAlternateIcon />}
              disabled={uploading}
            >
              Subir nueva
              <input hidden type="file" accept="image/*" onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
            </Button>
          )}
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && <Box sx={{ textAlign: 'center', py: 5 }}><CircularProgress /></Box>}

        {!loading && filtradas.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
            <AddPhotoAlternateIcon sx={{ fontSize: 44, opacity: 0.4 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {images.length === 0
                ? 'Todavía no has subido imágenes. Las que subas quedarán aquí para reutilizarlas.'
                : 'Ninguna imagen coincide con la búsqueda.'}
            </Typography>
          </Box>
        )}

        {!loading && filtradas.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
            {filtradas.map((img) => (
              <Tooltip key={img.key} title={`${img.name} · ${(img.size / 1024).toFixed(0)} KB`}>
                <Box
                  onClick={() => { onSelect(img.url); onClose(); }}
                  sx={{
                    border: '2px solid', borderColor: 'divider', borderRadius: 1.5,
                    p: 0.5, cursor: 'pointer', transition: 'border-color .15s',
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                >
                  <Box
                    component="img" src={img.url} alt={img.name}
                    sx={{ width: '100%', height: 96, objectFit: 'contain', display: 'block', bgcolor: 'action.hover', borderRadius: 1 }}
                  />
                  <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}>
                    {img.name}
                  </Typography>
                </Box>
              </Tooltip>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
};
