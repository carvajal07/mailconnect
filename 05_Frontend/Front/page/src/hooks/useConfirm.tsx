import { useCallback, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Color del botón de confirmación (usa 'error' para acciones destructivas). */
  confirmColor?: 'primary' | 'error' | 'warning' | 'success';
}

/**
 * Hook de confirmación con un diálogo MUI (reemplaza los `window.confirm` "feos").
 * Devuelve `confirm(opts)` que abre el diálogo y resuelve a `true`/`false`, y el
 * elemento `<ConfirmDialog />` para renderizar. Mismo patrón que useFeedback.
 *
 *   const { confirm, ConfirmDialog } = useConfirm();
 *   if (await confirm({ message: '¿Eliminar?', confirmColor: 'error' })) { ... }
 *   // ...y renderizar {ConfirmDialog}
 */
export function useConfirm() {
  const [state, setState] = useState<{ open: boolean; opts: ConfirmOptions }>({
    open: false,
    opts: { message: '' },
  });
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setState({ open: true, opts });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setState((s) => ({ ...s, open: false }));
    resolver.current?.(result);
    resolver.current = null;
  }, []);

  const { opts } = state;
  const ConfirmDialog = (
    <Dialog open={state.open} onClose={() => close(false)} maxWidth="xs" fullWidth>
      {opts.title && <DialogTitle>{opts.title}</DialogTitle>}
      <DialogContent>
        <DialogContentText sx={{ pt: opts.title ? 0 : 1 }}>{opts.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => close(false)}>{opts.cancelText ?? 'Cancelar'}</Button>
        <Button variant="contained" color={opts.confirmColor ?? 'primary'} onClick={() => close(true)} autoFocus>
          {opts.confirmText ?? 'Confirmar'}
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { confirm, ConfirmDialog };
}
