import { Box, Paper, Typography, Stack, Chip } from '@mui/material';
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend';

/**
 * Tab PROGRAMAR ENVÍOS (por ahora scaffold — sin backend).
 *
 * Reservado para agendar el envío real de una campaña a una fecha/hora futura (hoy todo es
 * on-demand). Ubicado junto a "Campañas"/"Muestras" en el flujo de envío. Requiere, cuando se
 * implemente: una tabla de envíos programados + un disparador (EventBridge Scheduler) que
 * invoque Prepare-batch a la hora indicada. Se deja montado y vacío para construir encima.
 */
export const ProgramarEnviosSection = () => (
  <Box>
    <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
      <Typography variant="h4">Programar envíos</Typography>
      <Chip label="Próximamente" color="warning" size="small" variant="outlined" />
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
      Agenda el envío real de una campaña aprobada para una fecha y hora futura.
    </Typography>

    <Paper
      variant="outlined"
      sx={{ p: 8, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
    >
      <ScheduleSendIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
      <Typography variant="h6" color="text.secondary">Estamos preparando esta sección</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
        Pronto podrás elegir una campaña aprobada y programar su envío para el día y la hora que
        prefieras. Por ahora, los envíos se disparan al momento desde <strong>Muestras</strong>.
      </Typography>
    </Paper>
  </Box>
);
