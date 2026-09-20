import { StateCreator } from 'zustand';

/// Modes d'interaction du 3D — manipuler (drag objets/handle) et assigner
/// (clic pour toggle une track). Mutual exclusion entre eux + avec drawMode
/// (slice voisin) est gérée par les setters.
///
/// Vivant dans le store (et non en state local Scene3D) pour que le handler
/// clavier global puisse les annuler via Esc AVANT de tomber sur le panic.
export interface InteractionModesSlice {
  manipulateMode: boolean;
  assignMode: boolean;
  setManipulateMode: (v: boolean) => void;
  setAssignMode: (v: boolean) => void;
  /// Annule draw/manipulate/assign. Retourne true si un mode était actif
  /// (Esc consommé — ne doit PAS déclencher le panic).
  cancelInteractionModes: () => boolean;
}

type Store = InteractionModesSlice & { drawMode: boolean };

export const createInteractionModesSlice: StateCreator<Store, [], [], InteractionModesSlice> = (set, get) => ({
  manipulateMode: false,
  assignMode: false,
  setManipulateMode: (v) =>
    set(v ? { manipulateMode: true, assignMode: false, drawMode: false } : { manipulateMode: false }),
  setAssignMode: (v) =>
    set(v ? { assignMode: true, manipulateMode: false, drawMode: false } : { assignMode: false }),
  cancelInteractionModes: () => {
    const { drawMode, manipulateMode, assignMode } = get();
    if (!drawMode && !manipulateMode && !assignMode) return false;
    set({ drawMode: false, manipulateMode: false, assignMode: false });
    return true;
  },
});
