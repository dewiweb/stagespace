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
  /// Cible du place-on-scene : null = le formulaire de nouvelle zone
  /// (remplit le champ centre), index = re-place la zone existante i via
  /// updateZone (édition en place — ordre préservé).
  zonePlaceTarget: number | null;
  setZonePlaceTarget: (i: number | null) => void;
  /// Édition en place des zones : drag = déplace le centre, molette =
  /// radius (sphere) / moitié-extent (box). Raycast sur les meshes tagués
  /// userData.isZone — les zones du graph global ne sont pas concernées.
  zoneEditMode: boolean;
  setZoneEditMode: (v: boolean) => void;
  /// Annule draw/manipulate/assign/zone-place. Retourne true si un mode
  /// était actif (Esc consommé — ne doit PAS déclencher le panic).
  cancelInteractionModes: () => boolean;
}

type Store = InteractionModesSlice & {
  drawMode: boolean;
  // Brouillon spline studio — purgé à toute sortie de drawMode (Esc,
  // bascule vers un autre mode) : sans ça des CPs stale ressurgissent.
  drawnPoints: Array<[number, number, number]>;
  controlPoints: Array<[number, number, number]>;
  cpHistory: Array<{ cps: Array<[number, number, number]>; closed: boolean }>;
  splineClosed: boolean;
  splineTool: 'freehand' | 'place' | 'edit';
  drawView: 'free' | 'top' | 'front' | 'side';
  // Multi-sélection manipulate — purge à la sortie du mode comme le
  // brouillon spline (sinon une sélection stale survivrait).
  manipSelection: Set<number>;
};

// Purge du brouillon spline — ajouté à toute transition drawMode → false.
const CLEAR_SPLINE_DRAFT = {
  drawnPoints: [] as Array<[number, number, number]>,
  controlPoints: [] as Array<[number, number, number]>,
  cpHistory: [] as Array<{ cps: Array<[number, number, number]>; closed: boolean }>,
  splineClosed: false,
  splineTool: 'freehand' as const,
  drawView: 'free' as const,
};

export const createInteractionModesSlice: StateCreator<Store, [], [], InteractionModesSlice> = (set, get) => ({
  manipulateMode: false,
  // Chaque setter purge TOUS les autres modes — sinon deux modes armés
  // empilent leurs overlays : celui peint au-dessus capture les events et
  // l'autre reste "actif" (banner) mais mort. zoneEdit l'avait, pas les
  // autres (bug : zoneEdit + manipulate coexistaient).
  setManipulateMode: (v) =>
    set(v ? { manipulateMode: true, drawMode: false, assignMode: false, zonePlaceMode: false, zoneEditMode: false, ...CLEAR_SPLINE_DRAFT } : { manipulateMode: false, manipSelection: new Set() }),
  assignMode: false,
  setAssignMode: (v) =>
    set(v ? { assignMode: true, drawMode: false, manipulateMode: false, zonePlaceMode: false, zoneEditMode: false, ...CLEAR_SPLINE_DRAFT } : { assignMode: false }),
  zonePlaceMode: false,
  setZonePlaceMode: (v) =>
    set(v ? { zonePlaceMode: true, drawMode: false, manipulateMode: false, assignMode: false, zoneEditMode: false, ...CLEAR_SPLINE_DRAFT } : { zonePlaceMode: false }),
  pendingZonePoint: null,
  setPendingZonePoint: (p) => set({ pendingZonePoint: p }),
  zonePlaceTarget: null,
  setZonePlaceTarget: (i) => set({ zonePlaceTarget: i }),
  zoneEditMode: false,
  setZoneEditMode: (v) =>
    set(v
      ? { zoneEditMode: true, drawMode: false, manipulateMode: false, assignMode: false, zonePlaceMode: false, ...CLEAR_SPLINE_DRAFT }
      : { zoneEditMode: false }),
  cancelInteractionModes: () => {
    const { drawMode, manipulateMode, assignMode, zonePlaceMode, zoneEditMode } = get();
    if (!drawMode && !manipulateMode && !assignMode && !zonePlaceMode && !zoneEditMode) return false;
    set({ drawMode: false, manipulateMode: false, assignMode: false, zonePlaceMode: false, zoneEditMode: false, manipSelection: new Set(), ...CLEAR_SPLINE_DRAFT });
    return true;
  },
});
