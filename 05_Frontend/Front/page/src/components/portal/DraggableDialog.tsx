import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, Box, Typography, IconButton, Tooltip } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import CloseIcon from '@mui/icons-material/Close';
import type { ReactNode } from 'react';

/**
 * Diálogo que se puede ARRASTRAR y que deja ver el lienzo de atrás.
 *
 * Para qué: los diálogos que cambian el aspecto del documento (configurar página,
 * tabla…) tapaban justo lo que estaban modificando, así que había que aceptar, mirar,
 * y volver a abrir para corregir. Arrastrándolo a un lado se ve el efecto en vivo.
 *
 * ⚠️ Sin `react-draggable`: el repo no la trae y no vale una dependencia por esto. El
 * arrastre se sigue con **eventos de puntero en el document**, no en la barra: si se
 * siguiera en la barra, al mover rápido el puntero se sale de ella y el diálogo se
 * queda atrás. `setPointerCapture` no basta porque el nodo se re-renderiza al moverse.
 *
 * ⚠️ Es NO MODAL a propósito (`hideBackdrop` + `disableEnforceFocus` +
 * `disableScrollLock`): con el fondo oscurecido no se vería el lienzo, y con el foco
 * atrapado no se podría escribir en él. El precio es que un clic fuera no cierra —por
 * eso lleva su ✕ y responde a Escape.
 */
export interface DraggableDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Ancho máximo en px del panel. */
  width?: number;
}

export const DraggableDialog = ({
  open, onClose, title, children, actions, width = 520,
}: DraggableDialogProps) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const arrastre = useRef<{ dx: number; dy: number } | null>(null);
  const cajaRef = useRef<HTMLDivElement | null>(null);

  /**
   * Posición ACOTADA a la ventana, calculada al dibujar.
   *
   * ⚠️ Se acota aquí y no solo al arrastrar: si la ventana se achica (o se rota el móvil)
   * con el diálogo movido, la posición guardada lo dejaría fuera de la pantalla y no
   * habría forma de recuperarlo — no hay nada de qué agarrarlo. Siempre quedan visibles
   * al menos 80 px de la barra de título.
   */
  const posSegura = pos ? {
    x: Math.min(Math.max(pos.x, 8 - width + 80), window.innerWidth - 80),
    y: Math.min(Math.max(pos.y, 8), window.innerHeight - 44),
  } : null;

  const onPointerDown = (e: React.PointerEvent) => {
    const caja = cajaRef.current;
    if (!caja) return;
    const r = caja.getBoundingClientRect();
    arrastre.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPos({ x: r.left, y: r.top });
    e.preventDefault();
  };

  const mover = useCallback((e: PointerEvent) => {
    const d = arrastre.current;
    if (!d) return;
    // El acotado a la ventana se aplica al DIBUJAR (`posSegura`), así que aquí se
    // guarda la posición cruda del puntero.
    setPos({ x: e.clientX - d.dx, y: e.clientY - d.dy });
  }, []);

  const soltar = useCallback(() => { arrastre.current = null; }, []);

  useEffect(() => {
    document.addEventListener('pointermove', mover);
    document.addEventListener('pointerup', soltar);
    return () => {
      document.removeEventListener('pointermove', mover);
      document.removeEventListener('pointerup', soltar);
    };
  }, [mover, soltar]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      hideBackdrop
      disableEnforceFocus
      disableScrollLock
      /**
       * ⚠️ Se estiliza el Paper por `slotProps`, NO con un `PaperComponent` propio.
       * Un componente definido dentro del cuerpo es una identidad NUEVA en cada render:
       * MUI desmonta y vuelve a montar el panel, eso dispara otro render, y el diálogo
       * entra en bucle ("Maximum update depth exceeded"). Con `slotProps` se usa el Paper
       * de siempre y solo cambian sus props.
       */
      slotProps={{
        paper: {
          ref: cajaRef,
          elevation: 8,
          sx: {
            width, maxWidth: '96vw', maxHeight: '88vh',
            display: 'flex', flexDirection: 'column',
            // Con posición propia sale del centrado de MUI; sin ella, se centra igual.
            ...(posSegura ? { position: 'fixed', top: posSegura.y, left: posSegura.x, m: 0 } : {}),
          },
        },
      }}
      // El contenedor deja pasar los clics al lienzo; el panel los vuelve a capturar.
      sx={{ pointerEvents: 'none', '& .MuiPaper-root': { pointerEvents: 'auto' } }}
    >
      <Box
        onPointerDown={onPointerDown}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1,
          cursor: 'move', userSelect: 'none', borderBottom: '1px solid',
          borderColor: 'divider', bgcolor: 'action.hover', touchAction: 'none',
        }}
      >
        <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled' }} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>{title}</Typography>
        <Tooltip title="Cerrar">
          <IconButton size="small" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>{children}</Box>
      {actions && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          {actions}
        </Box>
      )}
    </Dialog>
  );
};
