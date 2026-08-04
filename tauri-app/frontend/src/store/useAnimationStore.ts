import { create } from 'zustand';
import { safeInvoke as invoke } from '../utils/tauri';
import { safeListen as listen } from '../utils/tauri';
import { useGraphStore, HolProject } from './useGraphStore';

// ── Types miroir du backend ──

// ShapeType est déprécié — tout est un graphe maintenant.
// Gardé pour la compatibilité avec les animations sauvegardées dans localStorage.
export type ShapeType = string;

export type Direction = 'forward' | 'backward' | 'ping_pong';
export type AnimationLoopMode = 'loop' | 'one_shot';

export type AudioModSource =
  | 'bpm' | 'amplitude_rms' | 'amplitude_bass'
  | 'amplitude_mid' | 'amplitude_high'
  | { spectrum_band: number };

export type AudioModTarget =
  | 'speed' | 'scale' | 'radius' | 'height' | 'turns'
  | 'offset_x' | 'offset_y' | 'offset_z'
  | 'yaw' | 'pitch' | 'roll'
  | { custom: string };

export interface AudioMod {
  source: AudioModSource;
  target: AudioModTarget;
  amount: number;
  base_value: number;
  smoothing: number;
}

export interface TrackAssignment {
  track_id: number;
  depth: number;
  phase_offset: number;
}

export interface Animation {
  id: string;
  name: string;
  /** @deprecated — tout est un graphe maintenant, utiliser graph_json */
  shape?: ShapeType;
  /** @deprecated — tout est un graphe maintenant, utiliser graph_json */
  shape_params?: Record<string, number>;
  speed: number;
  duration: number;
  direction: Direction;
  loop_mode: AnimationLoopMode;
  scale: number;
  yaw: number;
  pitch: number;
  roll: number;
  offset_x: number;
  offset_y: number;
  offset_z: number;
  assignments: TrackAssignment[];
  phase_spread: number;
  audio_mods: AudioMod[];
  graph_json?: any;
  fade_in: number;
  fade_out: number;
}

// ── SHAPE_LIST et SHAPE_PARAMS supprimés — tout est un graphe maintenant ──
// Les templates de graphs sont dans utils/shapePresets.ts (catégorie "basic" = anciens shapes)

// ── Store ──

interface AnimationStore {
  // Liste des animations sauvegardées
  animations: Animation[];
  // Animation en cours d'édition dans l'inspector
  current: Animation;
  // IDs des movements actifs
  activeMovementIds: string[];
  // Movement actuellement sélectionné (pour stop/hot-swap individuel)
  selectedMovementId: string | null;
  setSelectedMovementId: (id: string | null) => void;
  launchFlash: number; // timestamp du dernier launch (pour feedback visuel)
  needsRelaunch: boolean; // true si shape_params ont changé depuis le dernier launch
  // Mode Expert (node editor) — partagé pour que MovesPanel puisse l'activer via [edit]
  showExpert: boolean;
  setShowExpert: (show: boolean) => void;

  // Actions
  setCurrent: (anim: Animation) => void;
  updateCurrent: (patch: Partial<Animation>) => void;
  updateAssignment: (trackId: number, patch: Partial<TrackAssignment>) => void;
  addAudioMod: (mod: AudioMod) => void;
  removeAudioMod: (index: number) => void;
  saveAnimation: () => Promise<void>;
  deleteAnimation: (id: string) => void;
  loadAnimation: (anim: Animation) => void;
  renameAnimation: (id: string, name: string) => void;

  // Launch
  launchAnimation: (isPreview: boolean, oscAddress?: string, oscPort?: number, oscProfile?: string) => Promise<string | null>;
  updateLiveAnimation: () => Promise<void>;

  // Helpers
  computeCentroid: () => [number, number, number] | null;
  getTargetOscIds: () => number[];
}

function defaultAnimation(): Animation {
  // Graphe par défaut: Circle (Objects → Circular → Output)
  // Construit dynamiquement pour éviter une dépendance circulaire avec shapePresets
  const defaultGraph = {
    nodes: [
      { id: 'obj-default', type: 'custom', position: { x: 50, y: 250 }, data: { label: 'Objects', type: 'Objects', params: { n_objects: 8 } } },
      { id: 'dur-default', type: 'custom', position: { x: 50, y: 80 }, data: { label: 'Duration', type: 'Duration', params: { duration: 4.0 } } },
      { id: 'engine-default', type: 'custom', position: { x: 300, y: 180 }, data: { label: 'Circular', type: 'Circular', params: { radius: 2.0 } } },
      { id: 'out-default', type: 'custom', position: { x: 550, y: 180 }, data: { label: 'Output', type: 'Output', params: {} } },
    ],
    edges: [
      { id: 'e-obj-engine', source: 'obj-default', target: 'engine-default', sourceHandle: 'output', targetHandle: 'input' },
      { id: 'e-dur-engine', source: 'dur-default', target: 'engine-default', sourceHandle: 'output', targetHandle: 'duration' },
      { id: 'e-engine-out', source: 'engine-default', target: 'out-default', sourceHandle: 'output', targetHandle: 'input' },
    ],
  };
  return {
    id: `anim-${Date.now()}`,
    name: 'Nouvelle animation',
    speed: 1.0,
    duration: 4.0,
    direction: 'forward',
    loop_mode: 'loop',
    scale: 1.0,
    yaw: 0, pitch: 0, roll: 0,
    offset_x: 0, offset_y: 0, offset_z: 0,
    assignments: [],
    phase_spread: 0,
    audio_mods: [],
    graph_json: defaultGraph,
    fade_in: 0.5,
    fade_out: 0.5,
  };
}

// ── localStorage persistence ──
const STORAGE_KEY = 'stagespace-animations';
const STORAGE_VERSION = 2; // bump quand les presets changent

function loadAnimationsFromStorage(): Animation[] {
  try {
    const version = localStorage.getItem(STORAGE_KEY + '-version');
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || version !== String(STORAGE_VERSION)) {
      // First launch ou version obsolète — seed with default presets
      const defaults = defaultPresets();
      saveAnimationsToStorage(defaults);
      localStorage.setItem(STORAGE_KEY + '-version', String(STORAGE_VERSION));
      return defaults;
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function defaultPresets(): Animation[] {
  // Les presets sont maintenant des templates de graphs (voir utils/shapePresets.ts)
  // On ne seed plus le localStorage avec des presets hardcoded — les templates sont dans le panneau gauche
  return [];
}

function saveAnimationsToStorage(animations: Animation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(animations));
  } catch {}
}

export const useAnimationStore = create<AnimationStore>((set, get) => ({
  animations: loadAnimationsFromStorage(),
  current: defaultAnimation(),
  activeMovementIds: [],
  selectedMovementId: null,
  setSelectedMovementId: (id) => set({ selectedMovementId: id }),
  launchFlash: 0,
  needsRelaunch: false,
  showExpert: false,
  setShowExpert: (show) => set({ showExpert: show }),

  setCurrent: (anim) => set({ current: anim }),

  updateCurrent: (patch) => {
    set((s) => ({ current: { ...s.current, ...patch } }));
    const { activeMovementIds } = get();
    if (activeMovementIds.length > 0) {
      // graph_json est géré par useGraphStore.updateGraphLive() — pas besoin de needsRelaunch
      // Les autres params (speed, scale, offset, etc.) sont mis à jour en live
      if ('graph_json' in patch) {
        set({ needsRelaunch: true });
      } else {
        get().updateLiveAnimation();
      }
    }
  },

  updateAssignment: (trackId, patch) => {
    set((s) => {
      const assignments = [...s.current.assignments];
      const idx = assignments.findIndex((a) => a.track_id === trackId);
      if (idx >= 0) {
        assignments[idx] = { ...assignments[idx], ...patch };
      } else {
        assignments.push({ track_id: trackId, depth: 1.0, phase_offset: 0, ...patch });
      }
      return { current: { ...s.current, assignments } };
    });
    const { activeMovementIds } = get();
    if (activeMovementIds.length > 0) {
      get().updateLiveAnimation();
    }
  },

  addAudioMod: (mod) => {
    set((s) => ({ current: { ...s.current, audio_mods: [...s.current.audio_mods, mod] } }));
    const { activeMovementIds } = get();
    if (activeMovementIds.length > 0) {
      get().updateLiveAnimation();
    }
  },

  removeAudioMod: (index) => {
    set((s) => ({
      current: {
        ...s.current,
        audio_mods: s.current.audio_mods.filter((_, i) => i !== index),
      },
    }));
    const { activeMovementIds } = get();
    if (activeMovementIds.length > 0) {
      get().updateLiveAnimation();
    }
  },

  saveAnimation: async () => {
    const { current } = get();
    const updated = [...get().animations.filter((a) => a.id !== current.id), current];
    set({ animations: updated });
    saveAnimationsToStorage(updated);
  },

  deleteAnimation: (id) => {
    const updated = get().animations.filter((a) => a.id !== id);
    set({ animations: updated });
    saveAnimationsToStorage(updated);
  },

  loadAnimation: (anim) => {
    set({ current: { ...anim } });
    // Toujours charger le graphe dans le Node Editor
    if (anim.graph_json && anim.graph_json.nodes && anim.graph_json.edges) {
      const graphStore = useGraphStore.getState();
      graphStore.setNodes(JSON.parse(JSON.stringify(anim.graph_json.nodes)));
      graphStore.setEdges(JSON.parse(JSON.stringify(anim.graph_json.edges)));
    } else {
      // Animation sans graph_json (legacy) — utiliser le graphe par défaut
      const def = defaultAnimation();
      const graphStore = useGraphStore.getState();
      graphStore.setNodes(JSON.parse(JSON.stringify(def.graph_json.nodes)));
      graphStore.setEdges(JSON.parse(JSON.stringify(def.graph_json.edges)));
      set({ current: { ...anim, graph_json: def.graph_json } });
    }
  },

  renameAnimation: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const updated = get().animations.map((a) => a.id === id ? { ...a, name: trimmed } : a);
    set({ animations: updated });
    // Si c'est l'animation courante, mettre à jour aussi
    if (get().current.id === id) {
      set({ current: { ...get().current, name: trimmed } });
    }
    saveAnimationsToStorage(updated);
  },

  launchAnimation: async (isPreview, oscAddress?, oscPort?, oscProfile?) => {
    const { current } = get();
    const { holProject, selectedTrackIds, manualOscIds, movements, stopMovementWithFade } = useGraphStore.getState();

    // Default OSC settings if not provided
    const addr = oscAddress ?? '127.0.0.1';
    const port = oscPort ?? 9000;
    const profile = oscProfile ?? 'holophonix';

    // Résoudre les osc_ids
    let oscIds: number[] = [];
    if (holProject && holProject.tracks.length > 0) {
      if (selectedTrackIds.size > 0) {
        oscIds = holProject.tracks.filter((t) => selectedTrackIds.has(t.id)).map((t) => t.id);
      } else {
        oscIds = holProject.tracks.map((t) => t.id);
      }
    } else {
      oscIds = manualOscIds;
    }

    if (oscIds.length === 0) {
      alert('Aucune track disponible.\nImportez un .hol (Toolbar → Import) ou ajoutez des tracks manuelles.');
      return null;
    }

    // ── Stopper avec fade les movements existants sur les MÊMES tracks ──
    // Comportement "Remplace sur ces tracks" : si un movement utilise déjà certains
    // des mêmes osc_ids, on le stoppe avec fade 0.5s avant de lancer le nouveau.
    const oscIdSet = new Set(oscIds);
    const conflictingMovements = movements.filter((mv) =>
      mv.osc_ids.some((id) => oscIdSet.has(id))
    );
    if (conflictingMovements.length > 0) {
      await Promise.all(conflictingMovements.map((mv) => stopMovementWithFade(mv.id, 0.5)));
    }

    // Centroïde — si null, utiliser [0,0,0]
    const centroid = get().computeCentroid();
    const origin: [number, number, number] = centroid ?? [0, 0, 0];

    try {
      const movementId = await invoke<string>('launch_animation', {
        animation: current,
        oscIds,
        origin,
        isPreview,
        oscAddress: addr,
        oscPort: port,
        oscProfile: profile,
      });
      set((s) => ({
        activeMovementIds: [...s.activeMovementIds, movementId],
        selectedMovementId: movementId,
        launchFlash: Date.now(),
        needsRelaunch: false,
      }));
      return movementId;
    } catch (e) {
      console.error('[launchAnimation] failed:', e);
      alert('Launch failed: ' + String(e));
      return null;
    }
  },

  updateLiveAnimation: async () => {
    const { current, activeMovementIds } = get();
    if (activeMovementIds.length === 0) return;
    const movementId = activeMovementIds[activeMovementIds.length - 1];
    try {
      await invoke('update_animation_state', {
        movementId,
        animation: current,
      });
    } catch (e) {
      console.error('Update animation state failed:', e);
    }
  },

  computeCentroid: () => {
    const { holProject, selectedTrackIds } = useGraphStore.getState();
    if (holProject && holProject.tracks.length > 0) {
      const tracks = selectedTrackIds.size > 0
        ? holProject.tracks.filter((t) => selectedTrackIds.has(t.id))
        : holProject.tracks;
      if (tracks.length === 0) return null;
      const sum = tracks.reduce(
        (acc, t) => [acc[0] + t.position[0], acc[1] + t.position[1], acc[2] + t.position[2]],
        [0, 0, 0],
      );
      return [sum[0] / tracks.length, sum[1] / tracks.length, sum[2] / tracks.length] as [number, number, number];
    }
    return null;
  },

  getTargetOscIds: () => {
    const { holProject, selectedTrackIds, manualOscIds } = useGraphStore.getState();
    if (holProject && holProject.tracks.length > 0) {
      if (selectedTrackIds.size > 0) {
        return holProject.tracks.filter((t) => selectedTrackIds.has(t.id)).map((t) => t.id);
      }
      return holProject.tracks.map((t) => t.id);
    }
    return manualOscIds;
  },
}));

// ── Listen for movement updates from backend ──
// Quand un movement est arrêté côté backend, on sync le store
listen('movements-update', () => {
  invoke<any[]>('list_movements').then((movements) => {
    const activeIds = movements.map((m) => m.id);
    const { selectedMovementId } = useAnimationStore.getState();
    // Si le movement sélectionné n'est plus actif, on le désélectionne
    const newSelected = selectedMovementId && activeIds.includes(selectedMovementId)
      ? selectedMovementId
      : (activeIds.length === 1 ? activeIds[0] : null); // auto-select si 1 seul
    useAnimationStore.setState({
      activeMovementIds: activeIds,
      needsRelaunch: false,
      selectedMovementId: newSelected,
    });
  }).catch(() => {});
});

