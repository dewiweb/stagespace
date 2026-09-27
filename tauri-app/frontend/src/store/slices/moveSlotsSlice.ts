import { StateCreator } from 'zustand';
import { safeInvoke as invoke, feLog } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { computeCentroid } from '../utils/geometryUtils';
import type { Node, Edge } from 'reactflow';
import type { HolProject } from '../types/index';
import type { Animation, TrackAssignment, AudioMod } from '../useAnimationStore';
import { safeSetItem, safeParseStoredJson, debouncedSetItem } from '../../utils/safeStorage';
import { throttleTrailingKeyed } from '../../utils/throttle';
import { SHAPE_PRESETS } from '../../utils/shapePresets';

/// Extrait la duration d'un graphe (node Duration) — fallback 4.0s
function extractDuration(nodes: Node[]): number {
  const durNode = nodes.find((n: any) => (n.data as any)?.type === 'Duration');
  return (durNode?.data as any)?.params?.duration ?? 4.0;
}

/// Track IDs déjà signalés comme non résolubles (anti-spam de toasts)
const _warnedTrackIds = new Set<string>();

/// Calcule les track_indices (index 0-based dans le projet hol ou manualOscIds)
/// à partir des trackIds (osc_ids) du slot.
/// ATTENTION : ne JAMAIS deviner `tid - 1` quand l'id est introuvable — ça mappe
/// silencieusement sur la mauvaise track en live. On skip + on warn une fois.
/// (exporté — réutilisé par drawModeSlice)
export function computeTrackIndices(trackIds: number[], holProject: any, manualOscIds: number[]): number[] {
  const indices: number[] = [];
  if (holProject) {
    trackIds.forEach((tid) => {
      const idx = holProject.tracks.findIndex((t: any) => t.id === tid);
      if (idx >= 0) indices.push(idx);
      else if (!_warnedTrackIds.has(`hol:${tid}`)) {
        _warnedTrackIds.add(`hol:${tid}`);
        toast.warning(`Track ${tid} not found in .hol project — skipped`);
      }
    });
  } else {
    trackIds.forEach((tid) => {
      const idx = manualOscIds.indexOf(tid);
      if (idx >= 0) {
        indices.push(idx);
      } else if (!_warnedTrackIds.has(`manual:${tid}`)) {
        _warnedTrackIds.add(`manual:${tid}`);
        toast.warning(`Track ${tid} not in manual OSC IDs — skipped (no silent fallback)`);
      }
    });
  }
  return indices;
}

/// Construit le graphe d'un slot depuis son templateId.
/// Utilisé à la création du slot et en fallback dans selectSlotForEditing
/// (slots persistés avant que graphJson ne soit construit à la création).
function buildGraphForSlot(templateId: string, nTracks: number): { nodes: Node[]; edges: Edge[] } | null {
  const preset = SHAPE_PRESETS.find((p) => p.id === templateId) ?? SHAPE_PRESETS[0];
  if (!preset) return null;
  const built = preset.build(nTracks);
  return { nodes: built.nodes, edges: built.edges };
}

/// MoveSlot — un move = une configuration persistante (graphe + tracks + macros)
/// Tout est un Move. Certains moves sont dans la setlist (l'ordre du spectacle).
/// Un Move peut être lancé indépendamment (live) ou rappelé via GO (spectacle).
export interface MoveSlot {
  id: string;
  name: string;
  /// Graphe sauvegardé pour ce slot (construit depuis un template, puis éditable)
  graphJson: { nodes: Node[]; edges: Edge[] } | null;
  /// Template d'origine (pour affichage dans l'UI)
  templateId: string;
  /// Track IDs ciblées par ce slot
  trackIds: number[];
  /// ID du movement actif (null = arrêté). Source de vérité = backend.
  movementId: string | null;
  /// Mode preview ou live
  isPreview: boolean;
  /// Macros sauvegardées (appliquées au lancement et au GO)
  macros: MoveMacros;
  /// Durée du fade pour les transitions (GO, stop avec fade)
  fadeDuration: number;
  /// Loop mode : "loop" (défaut) ou "oneshot"
  loopMode: 'loop' | 'oneshot';
  /// Direction : "forward" (défaut), "backward", ou "ping_pong"
  direction: 'forward' | 'backward' | 'ping_pong';
  /// Enveloppe de fade du cycle worker (début/fin de boucle) — distinct de
  /// fadeDuration (fade d'activation/désactivation du move, wall-clock).
  fadeIn: number;
  fadeOut: number;
  /// Répartition uniforme des phases des tracks sur le cycle (0 = groupé)
  phaseSpread: number;
  /// Depth + phase offset par track (matché par track_id à l'activation)
  assignments: TrackAssignment[];
  /// Modulations audio-réactives (AudioModSource → AudioModTarget)
  audioMods: AudioMod[];
}

/// Macros d'un move — équivalent des macros du cue
export interface MoveMacros {
  speed: number;
  scale: number;
  shiftX: number;
  shiftY: number;
  shiftZ: number;
  yaw: number;
  pitch: number;
  roll: number;
}

function defaultMacros(): MoveMacros {
  return { speed: 1.0, scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 };
}

/// Sync visuel du node Objects SANS hot-swap backend.
/// Utilisé quand on switch de slot pour édition — on veut juste mettre à jour
/// l'affichage du node Objects sans affecter les moves en cours de lecture.
function syncObjectsNodeNoHotSwap(get: () => any) {
  const s = get();
  const ids = Array.from(s.selectedTrackIds as Set<number>).sort((a: number, b: number) => a - b);
  if (ids.length === 0 && !s.nodes.find((n: any) => (n.data as any)?.type === 'Objects')) return;

  const ENGINE_TYPES = new Set([
    'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
    'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
    'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
    'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField',
    'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
    'Mix', 'Group', 'Sequence', 'Crossfade',
  ]);

  const objectsNode = s.nodes.find((n: any) => (n.data as any)?.type === 'Objects');
  if (objectsNode) {
    const newParams = { ...(objectsNode.data as any).params, n_objects: ids.length, track_ids: ids };
    s.updateNodeData(objectsNode.id, { params: newParams });
  }

  // Sync n_objects sur tous les nodes engines
  const currentNodes = get().nodes;
  currentNodes.forEach((node: any) => {
    const nodeType = (node.data as any)?.type as string;
    if (ENGINE_TYPES.has(nodeType)) {
      const params = (node.data as any)?.params ?? {};
      if (params.n_objects !== ids.length) {
        s.updateNodeData(node.id, { params: { ...params, n_objects: ids.length } });
      }
    }
  });
  // PAS de hot-swap — on ne veut pas affecter les moves en cours
}

export interface MoveSlotsSlice {
  /// Tous les moves — persistés dans localStorage
  moveSlots: MoveSlot[];
  /// Setlist = ordre des moves pour le spectacle (liste de slot IDs)
  setlistOrder: string[];
  /// Index du move courant dans la setlist (-1 = aucun)
  currentSetlistIndex: number;
  /// ID du slot actuellement sélectionné pour édition (source de vérité pour l'UI)
  editingSlotId: string | null;
  /// Slot IDs avec une activation en cours (anti double-clic, non persisté)
  pendingPlays: string[];

  // ─── CRUD moves ───
  addMoveSlot: () => void;
  removeMoveSlot: (id: string) => void;
  renameMoveSlot: (id: string, name: string) => void;
  setSlotTemplate: (id: string, templateId: string) => void;
  setSlotTracks: (id: string, trackIds: number[]) => void;
  setSlotMacros: (id: string, macros: Partial<MoveMacros>) => void;
  setSlotFadeDuration: (id: string, fade: number) => void;
  setSlotLoopMode: (id: string, mode: 'loop' | 'oneshot') => void;
  setSlotDirection: (id: string, direction: 'forward' | 'backward' | 'ping_pong') => void;
  /// Champs "animation" du slot (fade cycle, phase spread, assignments, audio mods)
  /// — write-through depuis l'Inspector (updateCurrent → ici).
  updateSlotAnimationFields: (id: string, fields: Partial<Pick<MoveSlot, 'fadeIn' | 'fadeOut' | 'phaseSpread' | 'assignments' | 'audioMods'>>) => void;
  /// Bascule le mode preview (pas d'OSC out) / live (OSC out)
  toggleSlotPreview: (id: string) => void;
  /// Sélectionne un slot pour édition — sync selectedTrackIds + charge le graphe dans l'éditeur
  selectSlotForEditing: (id: string | null) => void;

  // ─── Live (lancer/arrêter) ───
  /// Retourne true si le move est (ou sera) en lecture — false si l'activation a échoué.
  /// Un slot déjà playing/pending retourne true (objectif atteint).
  playSlot: (id: string) => Promise<boolean>;
  stopSlot: (id: string) => Promise<void>;
  stopSlotWithFade: (id: string, fadeDuration: number) => Promise<void>;
  goAllSlots: () => Promise<void>;
  stopAllSlots: () => Promise<void>;

  // ─── Édition graphe ───
  editSlotGraph: (id: string) => void;
  saveEditorToSlot: (id: string) => void;

  // ─── Setlist (spectacle) ───
  addToSetlist: (slotId: string) => void;
  removeFromSetlist: (slotId: string) => void;
  moveSetlistItem: (index: number, direction: 'up' | 'down') => void;
  /// GO = stoppe tous les moves actifs + lance le prochain move de la setlist
  goToNextMove: () => Promise<string | null>;

  // ─── Sync ───
  syncSlotMovements: () => void;
}

type MoveSlotsStore = MoveSlotsSlice & {
  // Dépendances
  holProject: HolProject | null;
  manualOscIds: number[];
  movements: any[];
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  stopMovement: (movementId: string) => Promise<void>;
  stopMovementWithFade: (movementId: string, fadeDuration: number) => Promise<void>;
  stopAllMovements: () => Promise<void>;
  refreshMovements: () => Promise<void>;
  // OSC config globale
  oscAddress: string;
  oscPort: number;
  oscProfile: string;
  // Pour sync selectedTrackIds quand on sélectionne un slot
  setSelectedTrackIds: (ids: Set<number>) => void;
  selectedTrackIds: Set<number>;
};

const SLOTS_STORAGE_KEY = 'stagespace-move-slots';
const SETLIST_STORAGE_KEY = 'stagespace-move-setlist';

/// Types de nodes qui ont un paramètre n_objects à sync avec le node Objects
const ENGINE_TYPES_WITH_N_OBJECTS = new Set([
  'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
  'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
  'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
  'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField',
  'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
  'Mix', 'Group', 'Sequence', 'Crossfade',
]);

/// Movement IDs en cours de fade-out côté backend.
/// deactivate_move(fade>0) retourne immédiatement mais le move reste dans
/// list_active_moves jusqu'à la fin du fade — syncSlotMovements ne doit pas
/// les flagger comme orphelins pendant ce laps de temps.
const _fadingMoveIds = new Set<string>();

/// Movement IDs orphelins déjà signalés (une seule alerte par id)
const _orphanWarnedIds = new Set<string>();

function markFading(movementId: string, fadeDuration: number) {
  _fadingMoveIds.add(movementId);
  // La marge couvre la latence IPC + le jitter du thread de fade côté backend
  setTimeout(() => _fadingMoveIds.delete(movementId), fadeDuration * 1000 + 1500);
}

/// Backfill des champs ajoutés après coup — utilisé par le load localStorage
/// ET le restore .hfg (un slot sérialisé par une ancienne version n'a pas les
/// nouveaux champs ; sans ça ils arrivent undefined dans le store).
export function normalizeSlot(s: any): MoveSlot {
  return {
    ...s,
    macros: s.macros ?? defaultMacros(),
    fadeDuration: s.fadeDuration ?? 2.0,
    loopMode: s.loopMode ?? 'loop',
    direction: s.direction ?? 'forward',
    fadeIn: s.fadeIn ?? 0.5,
    fadeOut: s.fadeOut ?? 0.5,
    phaseSpread: s.phaseSpread ?? 0,
    assignments: s.assignments ?? [],
    audioMods: s.audioMods ?? [],
  };
}

function loadSlotsFromStorage(): MoveSlot[] {
  const slots = safeParseStoredJson<any[]>(SLOTS_STORAGE_KEY, []);
  if (!Array.isArray(slots)) return [];
  return slots.map(normalizeSlot);
}

/// Projette un slot en `Animation` — la forme que l'Inspector édite via
/// `current`. La source de vérité reste le slot : `current` est une vue
/// mutable, write-through vers le slot (updateCurrent → setSlot*).
function slotToAnimation(raw: MoveSlot): Animation {
  // Défensif : des slots peuvent arriver sans les champs récents (setState
  // direct dans les tests, restaurations partielles) — normalizeSlot backfill.
  const slot = normalizeSlot(raw);
  const duration = slot.graphJson ? extractDuration(slot.graphJson.nodes) : 4.0;
  // Reconstruire les assignments complets : les trackIds sans entrée
  // sauvegardée obtiennent les défauts (depth 1, phase 0).
  const assignments = slot.trackIds.map(
    (tid) =>
      slot.assignments.find((a) => a.track_id === tid) ??
      { track_id: tid, depth: 1.0, phase_offset: 0 },
  );
  return {
    id: `slot-${slot.id}`,
    name: slot.name,
    speed: slot.macros.speed,
    duration,
    direction: slot.direction,
    loop_mode: slot.loopMode === 'oneshot' ? 'one_shot' : 'loop',
    scale: slot.macros.scale,
    yaw: slot.macros.yaw,
    pitch: slot.macros.pitch,
    roll: slot.macros.roll,
    offset_x: slot.macros.shiftX,
    offset_y: slot.macros.shiftY,
    offset_z: slot.macros.shiftZ,
    assignments,
    phase_spread: slot.phaseSpread,
    audio_mods: slot.audioMods,
    graph_json: slot.graphJson ?? undefined,
    fade_in: slot.fadeIn,
    fade_out: slot.fadeOut,
  };
}

/// (exporté — drawModeSlice persiste aussi les slots après un dessin)
export function saveSlotsToStorage(slots: MoveSlot[]) {
  safeSetItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
}

/// Variante debounced pour les hot paths (sliders → pointermove à 60Hz) :
/// stringify+setItem synchrone de toute la librairie de slots à chaque pixel
/// de drag = jank. Trailing edge — la dernière valeur est toujours écrite.
function saveSlotsToStorageDebounced(slots: MoveSlot[]) {
  debouncedSetItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
}

// Throttle des push live — un slider en drag ne doit pas spammer l'IPC.
// Keyed par movementId : deux slots draggés en parallèle gardent chacun
// leur trailing call.
const throttledMoveSpeed = throttleTrailingKeyed((movementId: string, speed: number) => {
  invoke('set_move_speed', { movementId, speed })
    .catch((e) => console.warn('[setSlotMacros] set_move_speed failed:', e));
}, 33);

function loadSetlistFromStorage(): string[] {
  const parsed = safeParseStoredJson<string[]>(SETLIST_STORAGE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveSetlistToStorage(setlist: string[]) {
  safeSetItem(SETLIST_STORAGE_KEY, JSON.stringify(setlist));
}

export const createMoveSlotsSlice: StateCreator<MoveSlotsStore, [], [], MoveSlotsSlice> = (set, get) => ({
  moveSlots: loadSlotsFromStorage(),
  setlistOrder: loadSetlistFromStorage(),
  currentSetlistIndex: -1,
  editingSlotId: null,
  pendingPlays: [],

  selectSlotForEditing: (id) => {
    // L'auto-save (useGraphStore) a déjà sauvegardé le slot précédent
    // à chaque mutation. On n'a qu'à charger le nouveau slot.
    set({ editingSlotId: id });
    if (!id) return;
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot) return;
    // Fallback : slots persistés avec graphJson:null (créés avant que le graphe
    // ne soit construit à la création) — reconstruire depuis le template pour
    // ne pas hériter visuellement du graphe du slot précédent.
    let graphJson = slot.graphJson;
    if (!graphJson) {
      graphJson = buildGraphForSlot(slot.templateId, slot.trackIds.length);
      if (graphJson) {
        set((s) => {
          const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, graphJson } : sl);
          saveSlotsToStorage(newSlots);
          return { moveSlots: newSlots };
        });
      }
    }
    // Charger le graphe du slot dans l'éditeur AVANT de sync les tracks,
    // pour que syncObjectsNode mette à jour le BON Objects node.
    if (graphJson) {
      get().setNodes(JSON.parse(JSON.stringify(graphJson.nodes)));
      get().setEdges(JSON.parse(JSON.stringify(graphJson.edges)));
    }
    // Reset undo/redo — l'historique appartient au slot précédent.
    // Sans ça, un undo après switch restaurerait le graphe d'un autre slot.
    set({ _history: [], _historyIndex: -1, canUndo: false, canRedo: false } as any);
    // Baseline : le graphe du slot devient l'entrée 0 — sinon le premier
    // edit après un switch n'était jamais undoable (undo bloque à index 0).
    (get() as any).pushHistory?.();
    // Sync selectedTrackIds avec les tracks du slot.
    // IMPORTANT: on met à jour selectedTrackIds SANS appeler syncObjectsNode
    // (qui ferait un hot-swap sur TOUS les moves actifs).
    // On sync juste le node Objects visuellement, sans hot-swap backend.
    set({ selectedTrackIds: new Set(slot.trackIds) });
    // Sync visuel du node Objects (sans hot-swap)
    syncObjectsNodeNoHotSwap(get);
    // Projeter le slot dans `current` — l'Inspector édite `current`, qui est
    // write-through vers ce slot. Import deferred : cycle useGraphStore ↔
    // useAnimationStore (même pattern que les autres call-sites du store).
    import('../useAnimationStore').then(({ useAnimationStore }) => {
      useAnimationStore.getState().setCurrent(slotToAnimation(get().moveSlots.find((s) => s.id === id) ?? slot));
    });
  },

  addMoveSlot: () => {
    const { holProject, manualOscIds, moveSlots } = get();
    // Tracks par défaut: toutes les tracks disponibles
    const defaultTrackIds = holProject
      ? holProject.tracks.map((t) => t.id)
      : manualOscIds;
    const idx = moveSlots.length + 1;
    const newSlotId = `slot-${Date.now()}`;
    // Construire le graphe depuis le template IMMÉDIATEMENT — sinon le nouveau
    // slot garde graphJson:null et l'éditeur montre le graphe du slot précédent
    // (les edits iraient ensuite dans le mauvais graphe).
    const graphJson = buildGraphForSlot('circle', defaultTrackIds.length);
    set((s) => {
      const newSlots = [...s.moveSlots, {
        id: newSlotId,
        name: `Move ${idx}`,
        graphJson,
        templateId: 'circle',
        trackIds: defaultTrackIds,
        movementId: null,
        isPreview: false,
        macros: defaultMacros(),
        fadeDuration: 2.0,
        loopMode: 'loop' as const,
        direction: 'forward' as const,
        fadeIn: 0.5,
        fadeOut: 0.5,
        phaseSpread: 0,
        assignments: [],
        audioMods: [],
      }];
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
    // Sélectionner automatiquement le nouveau slot pour édition
    get().selectSlotForEditing(newSlotId);
  },

  removeMoveSlot: (id) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    // Arrêter le movement si actif — avec catch, sinon le move backend
    // devient orphelin (joue sans qu'aucun slot ne le contrôle).
    if (slot?.movementId) {
      const mvId = slot.movementId;
      get().stopMovement(mvId).catch((e) => {
        console.error('[removeMoveSlot] stopMovement failed:', e);
        toast.warning(`Move "${slot.name}" deleted but its backend movement "${mvId}" may still be running (orphan): ${e}`);
      });
    }
    set((s) => {
      const newSlots = s.moveSlots.filter((sl) => sl.id !== id);
      const newSetlist = s.setlistOrder.filter((sid) => sid !== id);
      saveSlotsToStorage(newSlots);
      saveSetlistToStorage(newSetlist);
      // Ajuster l'index courant si nécessaire
      const newIdx = s.currentSetlistIndex >= newSetlist.length ? -1 : s.currentSetlistIndex;
      // Désélectionner si on supprime le slot édité
      const newEditingSlotId = s.editingSlotId === id ? null : s.editingSlotId;
      return { moveSlots: newSlots, setlistOrder: newSetlist, currentSetlistIndex: newIdx, editingSlotId: newEditingSlotId };
    });
  },

  renameMoveSlot: (id, name) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, name } : sl);
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
  },

  setSlotTemplate: (id, templateId) => {
    // Construire le graphe depuis le template
    import('../../utils/shapePresets').then(({ SHAPE_PRESETS }) => {
      const preset = SHAPE_PRESETS.find((p) => p.id === templateId);
      if (!preset) return;
      const slot = get().moveSlots.find((s) => s.id === id);
      if (!slot) return;
      const { nodes, edges } = preset.build(slot.trackIds.length);
      set((s) => {
        const newSlots = s.moveSlots.map((sl) =>
          sl.id === id ? { ...sl, templateId, graphJson: { nodes, edges }, name: preset.name } : sl
        );
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots };
      });
      // Si le slot est le slot édité, mettre à jour le node editor
      if (get().editingSlotId === id) {
        get().setNodes(JSON.parse(JSON.stringify(nodes)));
        get().setEdges(JSON.parse(JSON.stringify(edges)));
      }
      // Si le slot est en cours de lecture, hot-swap
      if (slot.movementId) {
        const { holProject, manualOscIds } = get();
        const trackIndices = computeTrackIndices(slot.trackIds, holProject, manualOscIds);
        import('../../components/nodeParamSchema').then(({ prepareGraphForSave }) => {
          const graphData = prepareGraphForSave(nodes, edges);
          invoke('update_move_graph_merged', {
            movementId: slot.movementId,
            graphJson: graphData,
            fadeDuration: 0.5,
            duration: extractDuration(nodes),
            oscIds: slot.trackIds,
            trackIndices,
          }).catch((e) => {
            console.error('[applyShapePreset] update_move_graph_merged failed:', e);
            toast.error(`Graph hot-swap failed: ${e}`);
          });
        });
      }
    });
  },

  setSlotTracks: (id, trackIds) => {
    const sortedIds = [...trackIds].sort((a, b) => a - b);
    // Mettre à jour le graphJson du slot : sync n_objects sur tous les nodes
    // pour éviter CountMismatch quand les tracks changent
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => {
        if (sl.id !== id) return sl;
        let graphJson = sl.graphJson;
        if (graphJson) {
          graphJson = {
            nodes: graphJson.nodes.map((n) => {
              const nodeType = (n.data as any)?.type as string;
              const params = (n.data as any)?.params ?? {};
              if (nodeType === 'Objects' || ENGINE_TYPES_WITH_N_OBJECTS.has(nodeType)) {
                return {
                  ...n,
                  data: { ...n.data, params: { ...params, n_objects: sortedIds.length } },
                };
              }
              return n;
            }),
            edges: graphJson.edges,
          };
        }
        return { ...sl, trackIds: sortedIds, graphJson };
      });
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
    // Sync selectedTrackIds si c'est le slot édité ET si les tracks sont différentes
    // (évite le cycle : toggleTrackSelection → setSlotTracks → setSelectedTrackIds → ...)
    if (get().editingSlotId === id) {
      const currentSelected = get().selectedTrackIds;
      const newSet = new Set(sortedIds);
      let same = currentSelected.size === newSet.size;
      if (same) {
        for (const t of newSet) {
          if (!currentSelected.has(t)) { same = false; break; }
        }
      }
      if (!same) {
        get().setSelectedTrackIds(newSet);
      }
    }
    // Hot-swap si le slot est en lecture (édité ou non)
    const slot = get().moveSlots.find((s) => s.id === id);
    if (slot?.movementId) {
      const { holProject, manualOscIds } = get();
      const trackIndices = computeTrackIndices(slot.trackIds, holProject, manualOscIds);
      // Si c'est le slot édité, utiliser le graphe courant (nodes/edges) qui est
      // plus à jour que slot.graphJson (syncObjectsNode vient de modifier les nodes
      // mais autoSave n'a pas encore tourné).
      const isEditing = get().editingSlotId === id;
      const graphSource = isEditing
        ? { nodes: (get() as any).nodes, edges: (get() as any).edges }
        : slot.graphJson;
      if (graphSource?.nodes && graphSource?.edges) {
        import('../../components/nodeParamSchema').then(({ prepareGraphForSave }) => {
          const graphData = prepareGraphForSave(graphSource.nodes, graphSource.edges);
          invoke('update_move_graph_merged', {
            movementId: slot.movementId,
            graphJson: graphData,
            fadeDuration: 0.3,
            duration: extractDuration(graphSource.nodes),
            oscIds: slot.trackIds,
            trackIndices,
          }).catch((e) => {
            console.error('[setSlotTracks] update_move_graph_merged failed:', e);
            toast.error(`Graph hot-swap failed: ${e}`);
          });
        });
      }
    }
  },

  playSlot: async (id) => {
    const found = get().moveSlots.find((s) => s.id === id);
    if (!found) return false;
    // Défensif : backfill des champs récents si le slot est arrivé brut
    // dans le store (tests, restauration partielle).
    const slot = normalizeSlot(found);
    // Anti double-clic : déjà en lecture ou activation en cours → objectif atteint
    if (slot.movementId || get().pendingPlays.includes(id)) {
      return true;
    }

    const { holProject, manualOscIds } = get();
    const movementId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Setter movementId ET pendingPlays IMMÉDIATEMENT (avant tout await).
    // - movementId permet à stopSlot de fonctionner tout de suite
    // - pendingPlays empêche syncSlotMovements de nettoyer le movementId
    //   pendant que activate_move est en cours
    set((s) => ({
      moveSlots: s.moveSlots.map((sl) => sl.id === id ? { ...sl, movementId } : sl),
      pendingPlays: [...s.pendingPlays, id],
    }));
    feLog(`[playSlot] START slot=${id} movementId=${movementId}`);

    try {
      let graphJson = slot.graphJson;
      if (!graphJson) {
        const { SHAPE_PRESETS } = await import('../../utils/shapePresets');
        const preset = SHAPE_PRESETS.find((p) => p.id === slot.templateId) ?? SHAPE_PRESETS[0];
        const built = preset.build(slot.trackIds.length);
        graphJson = { nodes: built.nodes, edges: built.edges };
        set((s) => {
          const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, graphJson } : sl);
          saveSlotsToStorage(newSlots);
          return { moveSlots: newSlots };
        });
      }

      // Si c'est le slot édité, utiliser les nodes/edges courants du store
      // (plus à jour que slot.graphJson — ex: après un dessin de spline,
      // l'auto-save n'a pas forcément encore synchronisé slot.graphJson)
      const isEditing = get().editingSlotId === id;
      if (isEditing) {
        const currentNodes = (get() as any).nodes;
        const currentEdges = (get() as any).edges;
        if (currentNodes?.length > 0) {
          graphJson = { nodes: currentNodes, edges: currentEdges };
        }
      }

      const { prepareGraphForSave } = await import('../../components/nodeParamSchema');
      const graphData = prepareGraphForSave(graphJson.nodes, graphJson.edges);
      feLog(`[DBG-playSlot] graphJson nodes=${graphJson.nodes.length} edges=${graphJson.edges.length} types=${graphJson.nodes.map((n: any) => n.data?.type).join(',')} isEditing=${isEditing}`);
      // Log spécifique pour les nodes spline
      const evalNode = graphJson.nodes.find((n: any) => (n.data as any)?.type === 'EvaluateSpline');
      const drawNode = graphJson.nodes.find((n: any) => (n.data as any)?.type === 'DrawSpline');
      feLog(`[DBG-playSlot] DrawSpline points=${((drawNode?.data as any)?.params?.points ?? 'NOT SET').slice(0, 120)}`);
      feLog(`[DBG-playSlot] EvaluateSpline points=${((evalNode?.data as any)?.params?.points ?? 'NOT SET').slice(0, 120)}`);

      // Lire la duration depuis le node Duration du graphe
      const durationNode = graphJson.nodes.find((n: any) => (n.data as any)?.type === 'Duration');
      const duration = (durationNode?.data as any)?.params?.duration ?? 4.0;

      const trackIndices = computeTrackIndices(slot.trackIds, holProject, manualOscIds);
      if (trackIndices.length === 0) {
        throw new Error(
          `No track indices — the slot's track selection doesn't map to current OSC ids (check OSC ids / selection).`,
        );
      }

      const origin = computeCentroid(holProject, trackIndices, manualOscIds);

      // Payload animation complet — le backend en extrait fade (cycle),
      // speed (worker) et AnimationState (depths, phase offsets, audio mods).
      // NB: les macros spatiales scale/shift/rotation de l'animation ne sont
      // PAS reprises dans le spec backend — elles restent globales (merge)
      // via set_global_macro ci-dessous, sinon double-application.
      const animation = {
        id: slot.id,
        name: slot.name,
        speed: slot.macros.speed,
        duration,
        direction: slot.direction,
        loop_mode: slot.loopMode === 'oneshot' ? 'one_shot' : 'loop',
        scale: slot.macros.scale,
        yaw: slot.macros.yaw,
        pitch: slot.macros.pitch,
        roll: slot.macros.roll,
        offset_x: slot.macros.shiftX,
        offset_y: slot.macros.shiftY,
        offset_z: slot.macros.shiftZ,
        assignments: slot.assignments,
        phase_spread: slot.phaseSpread,
        audio_mods: slot.audioMods,
        graph_json: graphData,
        fade_in: slot.fadeIn,
        fade_out: slot.fadeOut,
      };

      await invoke('activate_move', {
        request: {
          movement_id: movementId,
          name: slot.name,
          graph_json: graphData,
          osc_ids: slot.trackIds,
          track_indices: trackIndices,
          is_preview: slot.isPreview,
          origin,
          duration,
          loop_mode: slot.loopMode,
          direction: slot.direction,
          animation,
        },
      });
      if (slot.macros) {
        // Macros du slot : speed est per-move (worker — posée via spec.speed
        // dans l'animation payload), les macros spatiales (scale/shift/rotation)
        // sont GLOBALES — appliquées au MergeRuntime via set_global_macro.
        // ⚠ Elles écrasent les macros globales — c'est voulu : l'UI annonce
        // « appliquées au lancement et au GO ».
        // Non-fatal : un échec ici ne doit pas faire échouer le play.
        try {
          await invoke('set_global_macro', {
            request: {
              scale: slot.macros.scale,
              shiftX: slot.macros.shiftX,
              shiftY: slot.macros.shiftY,
              shiftZ: slot.macros.shiftZ,
              yaw: slot.macros.yaw,
              pitch: slot.macros.pitch,
              roll: slot.macros.roll,
            },
          });
        } catch (e) {
          console.warn('[playSlot] set_global_macro failed:', e);
          toast.warning(`"${slot.name}": spatial macros not applied (${e})`);
        }
      }
      // Succès : retirer du pending — movementId est déjà setté
      set((s) => ({
        pendingPlays: s.pendingPlays.filter((pid) => pid !== id),
      }));
      saveSlotsToStorage(get().moveSlots);
      feLog(`[playSlot] DONE slot=${id} movementId=${movementId}`);
      // Fire-and-forget : le movementId est déjà setté sur le slot,
      // refreshMovements sert seulement à mettre à jour le panneau d'inspection
      get().refreshMovements();
      return true;
    } catch (e) {
      console.error(`[playSlot] FAILED slot=${id}:`, e);
      toast.error('Move failed: ' + e);
      // Reset movementId (setté optimistement) + pending — sinon le slot
      // afficherait "playing" pour toujours alors que rien ne tourne.
      set((s) => {
        const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, movementId: null } : sl);
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots, pendingPlays: s.pendingPlays.filter((pid) => pid !== id) };
      });
      return false;
    }
  },

  stopSlot: async (id) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot?.movementId) return;
    const movementId = slot.movementId;
    try {
      await get().stopMovement(movementId);
    } catch (e) {
      // NE PAS clearer movementId — le move backend tourne probablement encore.
      // Garder le lien permet retry + reconcile via syncSlotMovements.
      console.error(`[stopSlot] FAILED slot=${id}:`, e);
      toast.error(`Stop failed for "${slot.name}" — movement may still be running: ${e}`);
      return;
    }
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, movementId: null } : sl);
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
  },

  stopSlotWithFade: async (id, fadeDuration) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot?.movementId) return;
    const movementId = slot.movementId;
    feLog(`[stopSlotWithFade] slot=${id} movementId=${movementId} fade=${fadeDuration}`);
    try {
      await get().stopMovementWithFade(movementId, fadeDuration);
    } catch (e) {
      // NE PAS clearer movementId — même raison que stopSlot.
      console.error(`[stopSlotWithFade] FAILED slot=${id}:`, e);
      toast.error(`Fade-out failed for "${slot.name}" — movement may still be running: ${e}`);
      return;
    }
    // Succès : le fade tourne en arrière-plan côté backend — clearer le lien
    // tout de suite pour permettre de re-jouer pendant le fade, et marquer
    // l'id comme "en fade" pour que syncSlotMovements ne le flagge pas orphelin.
    markFading(movementId, fadeDuration);
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, movementId: null } : sl);
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
  },

  goAllSlots: async () => {
    const pending = get().pendingPlays;
    const slots = get().moveSlots.filter((s) => !s.movementId && !pending.includes(s.id));
    for (const slot of slots) {
      await get().playSlot(slot.id);
    }
  },

  stopAllSlots: async () => {
    const slots = get().moveSlots.filter((s) => s.movementId);
    await Promise.all(slots.map((s) => get().stopSlot(s.id)));
  },

  editSlotGraph: (id) => {
    // Sélectionner le slot pour édition (sync tracks + graphe)
    get().selectSlotForEditing(id);
  },

  saveEditorToSlot: (id) => {
    // Le graphe est déjà auto-sauvé dans le slot par autoSaveToEditingSlot
    // (useGraphStore.ts). Cette fonction ne fait que le hot-swap si le slot
    // est en cours de lecture.
    const slot = get().moveSlots.find((s) => s.id === id);
    if (slot?.movementId && slot?.graphJson) {
      const { holProject, manualOscIds } = get();
      const trackIndices = computeTrackIndices(slot.trackIds, holProject, manualOscIds);
      import('../../components/nodeParamSchema').then(({ prepareGraphForSave }) => {
        const graphData = prepareGraphForSave(slot.graphJson!.nodes, slot.graphJson!.edges);
        invoke('update_move_graph_merged', {
          movementId: slot.movementId,
          graphJson: graphData,
          fadeDuration: 0.3,
          duration: extractDuration(slot.graphJson!.nodes),
          oscIds: slot.trackIds,
          trackIndices,
        }).catch((e) => {
          console.error('[saveEditorToSlot] update_move_graph_merged failed:', e);
          toast.error(`Hot-swap failed for "${slot.name}": ${e}`);
        });
      });
    }
  },

  setSlotMacros: (id, macros) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) =>
        sl.id === id ? { ...sl, macros: { ...sl.macros, ...macros } } : sl
      );
      // Slider-driven → debounced (écriture synchrone de tous les slots par
      // pointermove = jank).
      saveSlotsToStorageDebounced(newSlots);
      return { moveSlots: newSlots };
    });
    // Appliquer en live si le slot est en lecture
    const slot = get().moveSlots.find((s) => s.id === id);
    if (slot?.movementId) {
      // Speed = per-move (worker) — poussé au backend, throttlé à ~30Hz.
      throttledMoveSpeed(slot.movementId, slot.macros.speed ?? 1.0);
      // Note: les macros spatiales (scale, shift, rotation) sont globales (MergeRuntime).
      // Elles ne sont PAS poussées ici — utiliser les macros globales de l'Inspector pour ça.
      // Les macros spatiales du slot sont appliquées au lancement (playSlot) via set_global_macro.
    }
  },

  setSlotFadeDuration: (id, fade) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, fadeDuration: fade } : sl);
      saveSlotsToStorageDebounced(newSlots);
      return { moveSlots: newSlots };
    });
  },

  setSlotLoopMode: (id, mode) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, loopMode: mode } : sl);
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
    // Live update si le move est actif
    const slot = get().moveSlots.find((sl) => sl.id === id);
    if (slot?.movementId) {
      invoke('set_move_playback_mode', { movementId: slot.movementId, loopMode: mode })
        .catch((e) => {
          console.error('[setSlotLoopMode] failed:', e);
          toast.error(`Loop mode change failed for "${slot.name}": ${e}`);
        });
    }
  },

  setSlotDirection: (id, direction) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, direction } : sl);
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
    // Live update si le move est actif
    const slot = get().moveSlots.find((sl) => sl.id === id);
    if (slot?.movementId) {
      invoke('set_move_playback_mode', { movementId: slot.movementId, direction })
        .catch((e) => {
          console.error('[setSlotDirection] failed:', e);
          toast.error(`Direction change failed for "${slot.name}": ${e}`);
        });
    }
  },

  updateSlotAnimationFields: (id, fields) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, ...fields } : sl);
      // Chemin slider (fade/phase_spread) → debounced comme setSlotMacros.
      saveSlotsToStorageDebounced(newSlots);
      return { moveSlots: newSlots };
    });
  },

  toggleSlotPreview: (id) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) =>
        sl.id === id ? { ...sl, isPreview: !sl.isPreview } : sl
      );
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
  },

  // ─── Setlist (spectacle) ───
  addToSetlist: (slotId) => {
    set((s) => {
      if (s.setlistOrder.includes(slotId)) return s;
      const newSetlist = [...s.setlistOrder, slotId];
      saveSetlistToStorage(newSetlist);
      return { setlistOrder: newSetlist };
    });
  },

  removeFromSetlist: (slotId) => {
    set((s) => {
      const idx = s.setlistOrder.indexOf(slotId);
      const newSetlist = s.setlistOrder.filter((id) => id !== slotId);
      // Ajuster l'index courant
      let newIdx = s.currentSetlistIndex;
      if (idx < s.currentSetlistIndex) newIdx--;
      if (newIdx >= newSetlist.length) newIdx = -1;
      saveSetlistToStorage(newSetlist);
      return { setlistOrder: newSetlist, currentSetlistIndex: newIdx };
    });
  },

  moveSetlistItem: (index, direction) => {
    set((s) => {
      const newSetlist = [...s.setlistOrder];
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= newSetlist.length) return s;
      [newSetlist[index], newSetlist[target]] = [newSetlist[target], newSetlist[index]];
      saveSetlistToStorage(newSetlist);
      return { setlistOrder: newSetlist };
    });
  },

  goToNextMove: async () => {
    const { setlistOrder, currentSetlistIndex, moveSlots } = get();
    if (setlistOrder.length === 0) return 'Empty setlist — add moves to the setlist';

    const nextIndex = currentSetlistIndex + 1;
    if (nextIndex >= setlistOrder.length) return 'Fin de la setlist atteinte';

    const nextSlotId = setlistOrder[nextIndex];
    const nextSlot = moveSlots.find((s) => s.id === nextSlotId);
    if (!nextSlot) return `Move "${nextSlotId}" introuvable`;

    // 1. Stopper tous les moves actifs avec fade
    //    Le backend attend la fin du fade avant de résoudre la promesse
    const activeSlots = moveSlots.filter((s) => s.movementId);
    if (activeSlots.length > 0) {
      const fadeDur = nextSlot.fadeDuration ?? 2.0;
      await Promise.all(activeSlots.map((s) => get().stopSlotWithFade(s.id, fadeDur)));
    }

    // 2. Ne pas avancer si le slot cible a une activation en cours (anti double-GO)
    if (get().pendingPlays.includes(nextSlotId)) {
      return `Move "${nextSlot.name}" is already activating — wait`;
    }

    // 3. Lancer le prochain move — n'avancer l'index QUE sur succès,
    //    sinon le GO suivant skipperait un move jamais lancé.
    const ok = await get().playSlot(nextSlotId);
    if (!ok) {
      return `GO FAILED: "${nextSlot.name}" did not start (see error above)`;
    }

    // 4. Avancer l'index
    set({ currentSetlistIndex: nextIndex });

    const total = setlistOrder.length;
    return `GO: "${nextSlot.name}" (${nextIndex + 1}/${total})`;
  },

  syncSlotMovements: () => {
    // Nettoyer les movementIds qui ne sont plus actifs côté backend.
    // Ignore les slots en pending (pendingPlays) car leur move n'est pas encore créé.
    const { movements, moveSlots, pendingPlays } = get();
    const activeIds = new Set(movements.map((m) => m.id));
    const hasStale = moveSlots.some(
      (s) => s.movementId && !pendingPlays.includes(s.id) && !activeIds.has(s.movementId)
    );
    if (hasStale) {
      set((s) => {
        const newSlots = s.moveSlots.map((sl) =>
          sl.movementId && !s.pendingPlays.includes(sl.id) && !activeIds.has(sl.movementId)
            ? { ...sl, movementId: null }
            : sl
        );
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots };
      });
    }
    // Direction inverse : moves backend (mv-*) que plus aucun slot ne track.
    // Orphelins typiques : deactivate IPC échoué, crash du watcher.
    // On ne les touche PAS automatiquement (risque de tuer un move voulu) —
    // on les signale une fois par id, et seul STOP ALL peut les arrêter.
    const trackedIds = new Set(
      get().moveSlots.map((s) => s.movementId).filter(Boolean)
    );
    const orphans = movements.filter(
      (m) => m.id.startsWith('mv-')
        && !trackedIds.has(m.id)
        && !_fadingMoveIds.has(m.id)
        && !_orphanWarnedIds.has(m.id)
    );
    if (orphans.length > 0) {
      orphans.forEach((o) => _orphanWarnedIds.add(o.id));
      toast.warning(`${orphans.length} orphan move(s) running without a slot — use STOP ALL to clear`);
      console.warn('[syncSlotMovements] orphan movements:', orphans.map((o) => o.id));
    }
  },
});
