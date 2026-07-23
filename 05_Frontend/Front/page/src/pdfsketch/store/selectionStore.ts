import { create } from 'zustand';

interface SelectionState {
  selectedIds: string[];
  editingId: string | null;
  select: (ids: string[]) => void;
  add: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  setEditing: (id: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: [],
  editingId: null,
  select: (ids) => set({ selectedIds: ids }),
  add: (id) => set((s) => (s.selectedIds.includes(id) ? s : { selectedIds: [...s.selectedIds, id] })),
  toggle: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  clear: () => set({ selectedIds: [], editingId: null }),
  isSelected: (id) => get().selectedIds.includes(id),
  setEditing: (id) => set({ editingId: id }),
}));
