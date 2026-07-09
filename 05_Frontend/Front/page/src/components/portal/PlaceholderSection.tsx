import { Box, Paper, Typography, Chip, Stack } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';
import type { ReactNode } from 'react';

interface PlaceholderSectionProps {
  title: string;
  description: string;
  icon?: ReactNode;
}

/**
 * Sección "próximamente" para los tabs del portal cuyo backend aún no existe.
 * Deja el espacio reservado y explica qué hará, sin fingir datos.
 */
export const PlaceholderSection = ({ title, description, icon }: PlaceholderSectionProps) => (
  <Box>
    <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
      <Typography variant="h4">{title}</Typography>
      <Chip label="Próximamente" color="warning" size="small" variant="outlined" />
    </Stack>

    <Paper
      variant="outlined"
      sx={{
        p: 6,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Box sx={{ color: 'text.secondary', fontSize: 56, display: 'flex' }}>
        {icon ?? <ConstructionIcon fontSize="inherit" />}
      </Box>
      <Typography variant="h6" color="text.secondary">
        Estamos preparando esta sección
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
        {description}
      </Typography>
    </Paper>
  </Box>
);
