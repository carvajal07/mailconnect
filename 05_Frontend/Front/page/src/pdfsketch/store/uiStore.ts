import { create } from 'zustand';

interface Panels {
  leftRail: boolean;
  leftPanel: boolean;
  formatToolbar: boolean;
  statusBar: boolean;
}

interface UIState {
  theme: 'dark' | 'light';
  /** Unidad de medida de reglas/cursor/tamaño de hoja (como el Diseñador PDF). */
  unit: 'mm' | 'cm' | 'pt' | 'px' | 'in';
  panels: Panels;
  zoom: number;
  showGrid: boolean;
  showSnap: boolean;
  cursor: { x: number; y: number };
  previewOpen: boolean;

  setTheme: (t: 'dark' | 'light') => void;
  setUnit: (u: 'mm' | 'cm' | 'pt' | 'px' | 'in') => void;
  /** Contador que el Canvas observa para hacer zoom-ajustar a la ventana. */
  fitTick: number;
  requestFit: () => void;
  togglePanel: (key: keyof Panels) => void;
  setZoom: (z: number) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  setCursor: (x: number, y: number) => void;
  setPreviewOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  unit: 'mm',
  fitTick: 0,
  panels: { leftRail: true, leftPanel: true, formatToolbar: true, statusBar: true },
  zoom: 1,
  showGrid: false,
  showSnap: true,
  cursor: { x: 0, y: 0 },
  previewOpen: false,

  setPreviewOpen: (v) => set({ previewOpen: v }),
  // El tema se aplica como clase del wrapper `.mc-sketch` (SketchEditor lee
  // `theme` del store) — NO se toca document.documentElement, para no
  // interferir con el resto del portal MailConnect.
  setTheme: (t) => set({ theme: t }),
  setUnit: (u) => set({ unit: u }),
  requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  togglePanel: (key) => set((s) => ({ panels: { ...s.panels, [key]: !s.panels[key] } })),
  setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(5, z)) }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSnap: () => set((s) => ({ showSnap: !s.showSnap })),
  setCursor: (x, y) => set({ cursor: { x, y } }),
}));
