import { StateCreator } from 'zustand';
import { safeSetItem, safeParseStoredJson } from '../../utils/safeStorage';

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
  const parsed = safeParseStoredJson<unknown>(STORAGE_KEY, []);
  return Array.isArray(parsed) ? (parsed as SavedSpline[]) : [];
}

function saveSplinesToStorage(splines: SavedSpline[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(splines));
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
