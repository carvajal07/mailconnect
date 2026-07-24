import { create } from 'zustand';

/**
 * API del editor de texto ACTIVO (el `TextEditorOverlay` abierto).
 *
 * Permite que la barra de formato de ARRIBA aplique formato a la SELECCIÓN del
 * texto que se está editando (negrita/cursiva/subrayado/tachado/color/tamaño a
 * una palabra suelta) y que el panel de Datos inserte una variable en el cursor.
 * Así hay UNA sola barra (sin la flotante) y se conserva el formato por palabra.
 *
 * Vive FUERA del store del documento (no es historial undo/redo).
 */
export interface EditorApi {
  /** Inserta la variable `{{binding}}` en el cursor. */
  insertBinding: (binding: string) => void;
  /** Ejecuta un comando de formato inline sobre la selección. */
  exec: (cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') => void;
  /** Color de la selección. */
  setColor: (hex: string) => void;
  /** Tamaño (pt) de la selección. */
  setFontSize: (pt: number) => void;
}

interface ActiveEditorState {
  api: EditorApi | null;
  setApi: (api: EditorApi | null) => void;
}

export const useActiveEditorStore = create<ActiveEditorState>((set) => ({
  api: null,
  setApi: (api) => set({ api }),
}));
