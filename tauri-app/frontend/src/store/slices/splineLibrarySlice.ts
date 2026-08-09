import { StateCreator } from 'zustand';

export interface SavedSpline {
  id: string;
  name: string;
  points: string; // JSON string: [[x,y,z], ...]
  createdAt: number;
}

export interface SplineLibrarySlice {
  savedSplines: SavedSpline[];
  saveSpline: (name: string, points: string) => string;
  deleteSpline: (id: string) => void;
  renameSpline: (id: string, name: string) => void;
}

const STORAGE_KEY = 'stagespace-spline-library';

function loadSplines(): SavedSpline[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSplinesToStorage(splines: SavedSpline[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(splines));
  } catch {}
}

export const createSplineLibrarySlice: StateCreator<
  SplineLibrarySlice,
  [],
  [],
  SplineLibrarySlice
> = (set, get) => ({
  savedSplines: loadSplines(),

  saveSpline: (name, points) => {
    const id = `spline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const spline: SavedSpline = { id, name, points, createdAt: Date.now() };
    const newSplines = [...get().savedSplines, spline];
    saveSplinesToStorage(newSplines);
    set({ savedSplines: newSplines });
    return id;
  },

  deleteSpline: (id) => {
    const newSplines = get().savedSplines.filter((s) => s.id !== id);
    saveSplinesToStorage(newSplines);
    set({ savedSplines: newSplines });
  },

  renameSpline: (id, name) => {
    const newSplines = get().savedSplines.map((s) =>
      s.id === id ? { ...s, name } : s
    );
    saveSplinesToStorage(newSplines);
    set({ savedSplines: newSplines });
  },
});
