import { Suspense, lazy } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

// El Estudio PDF (editor pdfsketch + Konva) se carga en un CHUNK aparte:
// el portal no paga su peso hasta que el usuario abre este tab.
const SketchStudio = lazy(() => import('./SketchStudio'));

/** Nivel MEDIO de plantillas PDF: editor de lienzo (pdfsketch) + motor estándar. */
export function PdfStudioSection() {
  return (
    <Suspense
      fallback={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 4 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">Cargando el Estudio PDF…</Typography>
        </Box>
      )}
    >
      <SketchStudio />
    </Suspense>
  );
}
