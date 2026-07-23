import { create } from 'zustand';

export type Tool =
  | 'select'
  | 'hand'
  | 'text'
  | 'rect'
  | 'circle'
  | 'line'
  | 'pen'
  | 'image'
  | 'table'
  | 'qr'
  | 'dataField'
  | 'frame';

interface ToolState {
  active: Tool;
  setActive: (t: Tool) => void;
  /** Si true, al terminar de crear un elemento vuelve a `select`. */
  autoReturnToSelect: boolean;
  setAutoReturn: (v: boolean) => void;
}

export const useToolStore = create<ToolState>((set) => ({
  active: 'select',
  setActive: (t) => set({ active: t }),
  autoReturnToSelect: false,
  setAutoReturn: (v) => set({ autoReturnToSelect: v }),
}));
