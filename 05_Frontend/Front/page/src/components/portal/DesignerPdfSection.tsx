import { Suspense, lazy } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

// El Diseñador PDF (DocumentDesigner de workflow-doc-studio) va en un CHUNK
// aparte: el portal no paga su peso hasta que el usuario abre este tab.
const DesignerStudio = lazy(() => import('./DesignerStudio'));

/** Nivel FULL de plantillas PDF: DocumentDesigner + motor estándar. */
export function DesignerPdfSection() {
  return (
    <Suspense
      fallback={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 4 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">Cargando las plantillas PDF profesionales…</Typography>
        </Box>
      )}
    >
      <DesignerStudio />
    </Suspense>
  );
}
