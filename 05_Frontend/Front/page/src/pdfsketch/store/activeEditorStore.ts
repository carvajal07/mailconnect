import { create } from 'zustand';

/**
 * Registro del editor de texto ACTIVO (el `TextEditorOverlay` que está abierto).
 *
 * Permite que el panel de Datos inserte una variable `{{campo}}` justo en la
 * posición del cursor del texto que se está editando (doble clic o arrastre),
 * sin acoplar el panel con el overlay. Vive FUERA del store del documento (no
 * es parte del historial undo/redo).
 */
interface ActiveEditorState {
  /** Inserta el binding en el cursor del editor activo; null si no hay editor abierto. */
  insertBinding: ((binding: string) => void) | null;
  setInsertBinding: (fn: ((binding: string) => void) | null) => void;
}

export const useActiveEditorStore = create<ActiveEditorState>((set) => ({
  insertBinding: null,
  setInsertBinding: (fn) => set({ insertBinding: fn }),
}));
