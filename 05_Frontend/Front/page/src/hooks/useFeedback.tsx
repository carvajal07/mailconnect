import { useCallback, useState } from 'react';
import { Snackbar, Alert } from '@mui/material';
import type { AlertColor } from '@mui/material';

/**
 * Hook de feedback ligero para las secciones del panel.
 * Devuelve `notify(mensaje, severidad)` y el elemento `<FeedbackSnackbar />`
 * listo para renderizar. Reemplaza los `alert()`/`console.log` sueltos.
 */
export function useFeedback() {
  const [state, setState] = useState<{ open: boolean; msg: string; severity: AlertColor }>({
    open: false,
    msg: '',
    severity: 'info',
  });

  const notify = useCallback((msg: string, severity: AlertColor = 'info') => {
    setState({ open: true, msg, severity });
  }, []);

  const handleClose = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const FeedbackSnackbar = (
    <Snackbar
      open={state.open}
      autoHideDuration={5000}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={handleClose} severity={state.severity} variant="filled" sx={{ width: '100%' }}>
        {state.msg}
      </Alert>
    </Snackbar>
  );

  return { notify, FeedbackSnackbar };
}
