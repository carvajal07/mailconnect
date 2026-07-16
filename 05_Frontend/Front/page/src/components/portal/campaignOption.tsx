import { Box, Chip, Typography } from '@mui/material';
import type { CampaignSummary } from '../../services/campaignsService';

/**
 * Fila "tipo tabla" para los desplegables de campaña (Muestras, Reportes, …):
 *   [Canal]  [Estado]  Nombre de la campaña
 * Canal y Estado como chips de ancho fijo (alineados en columnas), nombre en negrita.
 */
const STATE_COLOR: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  Pendiente: 'default',
  Muestras: 'warning',
  Enviando: 'info',
  Procesando: 'info',
  Terminada: 'success',
  Error: 'error',
};

/** Contenido de un <MenuItem> de campaña (alineado en columnas). */
export const CampaignOption = ({ c }: { c: CampaignSummary }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 0 }}>
    <Chip
      size="small"
      variant="outlined"
      color="primary"
      label={c.channel}
      sx={{ minWidth: 56, flexShrink: 0, fontWeight: 600 }}
    />
    <Chip
      size="small"
      variant="outlined"
      color={STATE_COLOR[c.campaignState] ?? 'default'}
      label={c.campaignState}
      sx={{ minWidth: 96, flexShrink: 0 }}
    />
    <Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
      {c.campaignName}
    </Typography>
  </Box>
);

/** Texto compacto para el valor seleccionado (Select cerrado). */
export const campaignOptionText = (c?: CampaignSummary): string =>
  c ? `${c.channel} · ${c.campaignState} — ${c.campaignName}` : '';
