import { create } from 'zustand';

/**
 * Base de datos del cliente disponible como fuente de variables `{{campo}}`.
 * (Se alimenta desde `SketchStudio`, que las lee del backend con databaseService;
 * pdfsketch no conoce la capa de servicios de MailConnect.)
 *
 * `columns` son los encabezados del CSV (variables planas). `previewRows` da un
 * valor de muestra por columna. El modelo admite fuentes NO planas a futuro
 * (JSON con objetos/arrays): el árbol del panel de Datos es recursivo.
 */
export interface SketchDataSource {
  id: string;
  name: string;
  columns: string[];
  previewRows?: string[][];
}

interface DataSourceState {
  sources: SketchDataSource[];
  selectedId: string | null;
  loading: boolean;
  /** Recarga las bases desde el backend (lo inyecta SketchStudio). */
  reload: (() => void) | null;
  setSources: (s: SketchDataSource[]) => void;
  setSelected: (id: string | null) => void;
  setLoading: (v: boolean) => void;
  setReload: (fn: (() => void) | null) => void;
}

export const useDataSourceStore = create<DataSourceState>((set) => ({
  sources: [],
  selectedId: null,
  loading: false,
  reload: null,
  setSources: (sources) =>
    set((st) => ({
      sources,
      // conserva la selección si sigue existiendo; si no, toma la primera.
      selectedId: sources.some((s) => s.id === st.selectedId)
        ? st.selectedId
        : (sources[0]?.id ?? null),
    })),
  setSelected: (selectedId) => set({ selectedId }),
  setLoading: (loading) => set({ loading }),
  setReload: (reload) => set({ reload }),
}));
