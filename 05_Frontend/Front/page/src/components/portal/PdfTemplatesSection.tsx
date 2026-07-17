import { Box, Paper, Typography, Stack, Chip } from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';

/**
 * Tablero de PLANTILLAS PDF (por ahora VACÍO — scaffold).
 *
 * Reservado para el flujo de plantillas PDF (mapeo de campos personalizados para el envío
 * EAP con documentFormat=PDF). El envío ya existe en el backend; aquí irá el diseño/carga de
 * la plantilla y el mapeo de campos desde la base. Se deja el tablero montado y vacío para
 * construir encima sin re-cablear el portal.
 */
export const PdfTemplatesSection = () => (
  <Box>
    <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
      <Typography variant="h4">Plantillas PDF</Typography>
      <Chip label="En construcción" color="warning" size="small" variant="outlined" />
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
      Aquí podrás crear y administrar tus plantillas PDF con campos personalizados.
    </Typography>

    <Paper
      variant="outlined"
      sx={{ p: 8, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
    >
      <PictureAsPdfIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
      <Typography variant="h6" color="text.secondary">Aún no hay plantillas PDF</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
        Esta sección está reservada para las plantillas PDF. Pronto podrás cargarlas y usarlas en
        tus campañas.
      </Typography>
    </Paper>
  </Box>
);
