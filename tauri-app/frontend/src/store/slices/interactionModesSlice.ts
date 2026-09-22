import { StateCreator } from 'zustand';

/// Modes d'interaction du 3D — manipuler (drag objets/handle) et dessiner.
/// L'assignation de tracks se fait via la TrackGrid (drawer Perform /
/// Inspector) — le mode assign 3D a été retiré (surface redondante,
/// source de bugs de sync sélection↔store).
///
/// Vivant dans le store (et non en state local Scene3D) pour que le handler
/// clavier global puisse les annuler via Esc AVANT de tomber sur le panic.
export interface InteractionModesSlice {
  manipulateMode: boolean;
  setManipulateMode: (v: boolean) => void;
  /// Annule draw/manipulate. Retourne true si un mode était actif
  /// (Esc consommé — ne doit PAS déclencher le panic).
  cancelInteractionModes: () => boolean;
}

type Store = InteractionModesSlice & { drawMode: boolean };

export const createInteractionModesSlice: StateCreator<Store, [], [], InteractionModesSlice> = (set, get) => ({
  manipulateMode: false,
  setManipulateMode: (v) =>
    set(v ? { manipulateMode: true, drawMode: false } : { manipulateMode: false }),
  cancelInteractionModes: () => {
    const { drawMode, manipulateMode } = get();
    if (!drawMode && !manipulateMode) return false;
    set({ drawMode: false, manipulateMode: false });
    return true;
  },
});
