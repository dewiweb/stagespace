import { StateCreator } from 'zustand';

/// Modes d'interaction du 3D — manipuler (drag objets/handle), dessiner,
/// assigner (clic objet → toggleTrackSelection). L'assign 3D avait été
/// retiré pour bugs de sync — il est revenu en passant par la même source
/// de vérité que la TrackGrid (`toggleTrackSelection`), pas un chemin
/// parallèle : la sélection ne peut plus diverger.
///
/// Vivant dans le store (et non en state local Scene3D) pour que le handler
/// clavier global puisse les annuler via Esc AVANT de tomber sur le panic.
export interface InteractionModesSlice {
  manipulateMode: boolean;
  setManipulateMode: (v: boolean) => void;
  assignMode: boolean;
  setAssignMode: (v: boolean) => void;
  /// Place-on-scene : le panel FX arme le mode, le clic au sol enregistre
  /// le point (coords backend Z-up) dans `pendingZonePoint` que le panel
  /// consomme — le centre de la zone se place à la souris, pas au clavier.
  zonePlaceMode: boolean;
  setZonePlaceMode: (v: boolean) => void;
  pendingZonePoint: [number, number, number] | null;
  setPendingZonePoint: (p: [number, number, number] | null) => void;
  /// Annule draw/manipulate/assign/zone-place. Retourne true si un mode
  /// était actif (Esc consommé — ne doit PAS déclencher le panic).
  cancelInteractionModes: () => boolean;
}

type Store = InteractionModesSlice & { drawMode: boolean };

export const createInteractionModesSlice: StateCreator<Store, [], [], InteractionModesSlice> = (set, get) => ({
  manipulateMode: false,
  setManipulateMode: (v) =>
    set(v ? { manipulateMode: true, drawMode: false, assignMode: false } : { manipulateMode: false }),
  assignMode: false,
  setAssignMode: (v) =>
    set(v ? { assignMode: true, drawMode: false, manipulateMode: false, zonePlaceMode: false } : { assignMode: false }),
  zonePlaceMode: false,
  setZonePlaceMode: (v) =>
    set(v ? { zonePlaceMode: true, drawMode: false, manipulateMode: false, assignMode: false } : { zonePlaceMode: false }),
  pendingZonePoint: null,
  setPendingZonePoint: (p) => set({ pendingZonePoint: p }),
  cancelInteractionModes: () => {
    const { drawMode, manipulateMode, assignMode, zonePlaceMode } = get();
    if (!drawMode && !manipulateMode && !assignMode && !zonePlaceMode) return false;
    set({ drawMode: false, manipulateMode: false, assignMode: false, zonePlaceMode: false });
    return true;
  },
});
