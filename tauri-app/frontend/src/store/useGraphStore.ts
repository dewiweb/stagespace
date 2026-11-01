import React from 'react';
import { create } from 'zustand';
import { safeInvoke as invoke } from '../utils/tauri';
import { safeListen as listen } from '../utils/tauri';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  MarkerType,
} from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';
import { createPerfSlice, type PerfSlice } from './slices/perfSlice';
import { createAudioSlice, type AudioSlice, type AudioState } from './slices/audioSlice';
import { createOscSlice, type OscSlice } from './slices/oscSlice';
import { createPersistenceSlice, type PersistenceSlice } from './slices/persistenceSlice';
import { createMacrosSlice, type MacrosSlice } from './slices/macrosSlice';
import { createHolProjectSlice, type HolProjectSlice } from './slices/holProjectSlice';
import { createDrawModeSlice, type DrawModeSlice } from './slices/drawModeSlice';
import { createMovementSlice, type MovementSlice } from './slices/movementSlice';
import { createMoveSlotsSlice, type MoveSlotsSlice, computeTrackIndices } from './slices/moveSlotsSlice';
import { createOscConfigSlice, type OscConfigSlice } from './slices/oscConfigSlice';
import { createSplineLibrarySlice, type SplineLibrarySlice } from './slices/splineLibrarySlice';
import { createSpatialFxSlice, type SpatialFxSlice } from './slices/spatialFxSlice';
import { createInteractionModesSlice, type InteractionModesSlice } from './slices/interactionModesSlice';
import { createPluginSlice, type PluginSlice } from './slices/pluginSlice';
import { SHAPE_PRESETS } from '../utils/shapePresets';
import { clearTargetsForRemovedNodes } from '../utils/signalTargets';
import { toast } from '../utils/toast-helpers';
import { safeSetItem } from '../utils/safeStorage';
import type {
  NodeType,
  AppStatus,
  MovementInfo,
  HolTrack,
  HolProject,
} from './types/index';

// Re-export types from slices for backward compatibility
export type { AudioState } from './slices/audioSlice';
export type { PerfStats } from './slices/perfSlice';
export type { OscMapping } from './slices/oscSlice';

// Re-export types from types/index for backward compatibility
export type { NodeType, AppStatus, MovementInfo, HolTrack, HolProject };

interface GraphState
  extends PerfSlice, AudioSlice, OscSlice, PersistenceSlice,
    MacrosSlice, HolProjectSlice, DrawModeSlice,
    MovementSlice, MoveSlotsSlice, OscConfigSlice, SplineLibrarySlice, SpatialFxSlice,
    InteractionModesSlice, PluginSlice {
  // React Flow state (single source of truth)
  nodes: GraphNode[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: GraphNode) => void;
  removeNode: (id: string) => void;
  /// Autopatch : remplace `oldEdgeId` par `edgeIn` (source→node) + `edgeOut`
  /// (node→target) et ajoute le node — atomique, une seule entrée d'historique.
  insertNodeOnEdge: (node: GraphNode, oldEdgeId: string, edgeIn: Edge, edgeOut: Edge) => void;
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  setNodes: (nodes: GraphNode[]) => void;
  setEdges: (edges: Edge[]) => void;

  // Playback / status
  status: AppStatus;
  duration: number;
  compileError: string | null;
  playError: string | null;
  clearCompileError: () => void;
  clearPlayError: () => void;

  // Hot-swap du graphe en lecture — cible le move du slot édité
  updateGraphLive: (fadeDuration?: number) => Promise<void>;
  // Incrémenté à chaque compilation/update — pour déclencher la visu de trajectoire
  graphCompileVersion: number;

  // .hol project import — extrait vers holProjectSlice

  // Macro controls — extraits vers macrosSlice

  // Track selection (from .hol import) — extraits vers holProjectSlice

  // Manual OSC IDs (quand pas de .hol — tracks virtuels) — extraits vers holProjectSlice

  // Manual object positions (drag in visualiseur + default circle) — extraits vers holProjectSlice
  manualPositions: Record<number, [number, number, number]>;
  setManualPosition: (index: number, pos: [number, number, number]) => void;
  setManualPositions: (positions: Record<number, [number, number, number]>) => void;
  resetManualPositions: (nObjects: number) => void;

  // Draw mode (freehand trajectory drawing) — extrait vers drawModeSlice

  // Multi-movement — extrait vers movementSlice

  // Shape presets
  applyShapePreset: (presetId: string, nObjects: number) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pushHistory: () => void;
  /// Internes undo/redo — snapshots de graphe + throttle des pushs de
  /// suppression en rafale. Non exposés aux composants.
  _history: Array<{ nodes: GraphNode[]; edges: Edge[] }>;
  _historyIndex: number;
  _lastRemovalPushAt: number;

  /// Persiste le graphe courant dans le slot en cours d'édition.
  /// Exposé pour que les loaders externes (loadMovementGraph, loadAnimation,
  /// loadGraph) puissent synchroniser le slot après avoir remplacé nodes/edges.
  autoSaveToEditingSlot: () => void;

  // Panic
  panic: () => Promise<void>;
}

export const useGraphStore = create<GraphState>()((...a) => {
  const [set, get] = a;

  // ── Auto-save : sauvegarde le graphe édité dans le slot édité ──
  // Appelé après chaque mutation de nodes/edges pour garantir que
  // slot.graphJson est toujours synchronisé avec l'éditeur.
  // Ne modifie que moveSlots (pas nodes/edges) → pas de boucle.
  function autoSaveToEditingSlot() {
    const editingSlotId = get().editingSlotId;
    if (!editingSlotId) return;
    const { nodes, edges, moveSlots } = get();
    // Suppression de nodes du graphe du move : les cibles SignalOut
    // `param:<id>:<key>` de la modulation per-move deviendraient mortes —
    // on les efface (sink inerte) avec un toast.
    const newSlots = moveSlots.map((sl) => {
      if (sl.id !== editingSlotId) return sl;
      const prevIds = new Set((sl.graphJson?.nodes ?? []).map((n) => n.id));
      const removed = new Set([...prevIds].filter((id) => !nodes.some((n) => n.id === id)));
      let signalGraph = sl.signalGraph;
      if (signalGraph && removed.size > 0) {
        const { nodes: cleaned, cleared } = clearTargetsForRemovedNodes(signalGraph.nodes, removed);
        if (cleared > 0) {
          signalGraph = { nodes: cleaned, edges: signalGraph.edges };
          toast.info(`${cleared} modulation target${cleared > 1 ? 's' : ''} cleared (deleted node)`);
        }
      }
      return { ...sl, signalGraph, graphJson: { nodes: [...nodes], edges: [...edges] } };
    });
    // Sauvegarder dans localStorage (la fonction est dans moveSlotsSlice)
    safeSetItem('stagespace-move-slots', JSON.stringify(newSlots));
    set({ moveSlots: newSlots });
  }

  // Debounce pour l'auto-save pendant le drag (onNodesChange/onEdgesChange)
  // — évite d'écrire à chaque pixel de drag.
  let dragSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedAutoSave() {
    if (dragSaveTimer) clearTimeout(dragSaveTimer);
    dragSaveTimer = setTimeout(() => {
      dragSaveTimer = null;
      autoSaveToEditingSlot();
    }, 400);
  }

  // Timer SÉPARÉ pour le hot-swap débouncé d'updateNodeData — partager
  // dragSaveTimer causait des pertes : un drag pouvait annuler un hot-swap
  // pending et vice-versa.
  let hotSwapTimer: ReturnType<typeof setTimeout> | null = null;

  // Les deletes clavier (Delete/Backspace) arrivent via des changes 'remove'
  // dans onNodesChange/onEdgesChange — pas via removeNode : sans push ici la
  // suppression n'est pas undoable. Debounce 100ms : un delete de node émet
  // aussi les removes des edges incidents → une seule entrée par geste.
  // Le timestamp vit dans le state (pas en module) pour être resettable
  // avec le reste du store.
  function pushHistoryForRemoval() {
    const now = Date.now();
    const last = get()._lastRemovalPushAt ?? 0;
    if (now - last <= 100) return;
    set({ _lastRemovalPushAt: now });
    get().pushHistory();
  }

  return {
  // Exposé pour les loaders externes (loadMovementGraph, persistenceSlice, etc.)
  autoSaveToEditingSlot,
  ...createPerfSlice(...a),
  ...createAudioSlice(...a),
  ...createOscSlice(...a),
  ...createPersistenceSlice(...a),
  ...createMacrosSlice(...a),
  ...createHolProjectSlice(...a),
  ...createDrawModeSlice(...a),
  ...createMovementSlice(...a),
  ...createMoveSlotsSlice(...a),
  ...createOscConfigSlice(...a),
  ...createSplineLibrarySlice(...a),
  ...createSpatialFxSlice(...a),
  ...createInteractionModesSlice(...a),
  ...createPluginSlice(...a),

  // Graphe par défaut — preset Circle pour que l'app ne démarre jamais vide
  ...(() => {
    const preset = SHAPE_PRESETS[0]; // Circle
    return preset.build(8);
  })(),

  onNodesChange: (changes) => {
    if (changes.some((c) => c.type === 'remove')) pushHistoryForRemoval();
    set({ nodes: applyNodeChanges(changes, get().nodes) as GraphNode[] });
    // Auto-save avec debounce (drag = beaucoup de changes)
    debouncedAutoSave();
  },
  onEdgesChange: (changes) => {
    if (changes.some((c) => c.type === 'remove')) pushHistoryForRemoval();
    set({ edges: applyEdgeChanges(changes, get().edges) as Edge[] });
    debouncedAutoSave();
  },
  onConnect: (connection) => {
    get().pushHistory();
    // Arité-1 mirror du validator : un port d'entrée ne prend qu'une
    // edge. Re-câbler dans un input occupé remplace l'edge existante
    // (sémantique standard des éditeurs nodaux) — sinon le graphe passe
    // en UI mais est rejeté par le backend. On déduplique aussi l'edge
    // identique (même source/cible/ports).
    set({
      edges: rfAddEdge(
        { ...connection, markerEnd: { type: MarkerType.ArrowClosed } },
        get().edges.filter(
          (e) =>
            !(
              e.target === connection.target &&
              (e.targetHandle ?? null) === (connection.targetHandle ?? null)
            ),
        ),
      ) as Edge[],
    });
    autoSaveToEditingSlot();
  },

  addNode: (node) => {
    get().pushHistory();
    set((s) => ({ nodes: [...s.nodes, node] }));
    autoSaveToEditingSlot();
  },
  insertNodeOnEdge: (node, oldEdgeId, edgeIn, edgeOut) => {
    get().pushHistory();
    set((s) => ({
      nodes: [...s.nodes, node],
      edges: [
        ...s.edges.filter((e) => e.id !== oldEdgeId),
        edgeIn,
        edgeOut,
      ],
    }));
    autoSaveToEditingSlot();
  },
  removeNode: (id) => {
    get().pushHistory();
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    autoSaveToEditingSlot();
  },
  updateNodeData: (id, data) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? {
          ...n,
          data: {
            ...n.data,
            ...data,
            // Deep merge params si les deux existent
            params: data.params && n.data.params
              ? { ...n.data.params, ...data.params }
              : (data.params ?? n.data.params),
          },
        } : n,
      ),
    }));
    // Auto-save + hot-swap si le slot est en lecture
    autoSaveToEditingSlot();
    const editingSlotId = get().editingSlotId as string | null;
    if (editingSlotId) {
      const slot = get().moveSlots?.find((s: any) => s.id === editingSlotId);
      if (slot?.movementId) {
        // Hot-swap avec un léger debounce — timer dédié (hotSwapTimer),
        // ne pas réutiliser dragSaveTimer (auto-save ≠ hot-swap).
        if (hotSwapTimer) clearTimeout(hotSwapTimer);
        hotSwapTimer = setTimeout(() => {
          hotSwapTimer = null;
          get().updateGraphLive?.(0.3).catch((e: any) => {
            console.error('[updateNodeData] debounced hot-swap failed:', e);
          });
        }, 200);
      }
    }
  },
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  status: 'idle',
  duration: 4.0,
  compileError: null,
  playError: null,
  clearCompileError: () => set({ compileError: null, status: get().movements.length > 0 ? 'playing' : 'idle' }),
  clearPlayError: () => set({ playError: null, status: get().movements.length > 0 ? 'playing' : 'idle' }),
  graphCompileVersion: 0,

  updateGraphLive: async (fadeDuration?: number) => {
    const { movements, nodes, edges } = get();
    const { useMoveEditorStore } = await import('./useMoveEditorStore');
    const { activeMovementIds } = useMoveEditorStore.getState();
    if (movements.length === 0 && activeMovementIds.length === 0) return;
    const { prepareGraphForSave } = await import('../components/nodeParamSchema');
    const graphData = prepareGraphForSave(nodes, edges);
    const fade = fadeDuration ?? 0.3;
    try {
      // Hot-swap : cible TOUJOURS le movement du slot édité.
      // Plus de fallback "tous les movements actifs" — c'était la source
      // du bug où éditer le slot A hot-swapait aussi le movement du slot B.
      // Si aucun slot n'est édité, on ne hot-swap pas (comportement explicite).
      const allMovementIds = new Set([
        ...movements.map((m) => m.id),
        ...activeMovementIds,
      ]);

      const editingSlotId = get().editingSlotId as string | null;
      const moveSlots = get().moveSlots as Array<{ id: string; movementId: string | null; trackIds?: number[] }> | undefined;
      const editingSlotMovementId = editingSlotId && moveSlots
        ? moveSlots.find((s) => s.id === editingSlotId)?.movementId ?? null
        : null;

      if (editingSlotMovementId && allMovementIds.has(editingSlotMovementId)) {
        // Extraire la duration du graphe courant
        const durNode = nodes.find((n: any) => n.data.type === 'Duration');
        const duration = durNode?.data?.params?.duration ?? 4.0;
        // Récupérer les osc_ids et track_indices du slot édité
        const editingSlot = moveSlots?.find((s: any) => s.id === editingSlotId);
        const oscIds = editingSlot?.trackIds ?? [];
        const holProj = get().holProject;
        const manualIds = get().manualOscIds ?? [];
        const trackIndices = computeTrackIndices(oscIds, holProj, manualIds);
        await invoke('update_move_graph_merged', {
          movementId: editingSlotMovementId,
          graphJson: graphData,
          fadeDuration: fade,
          duration,
          oscIds,
          trackIndices,
        }).catch((e: any) => {
          console.error(`Hot-swap failed for movement ${editingSlotMovementId}:`, e);
          toast.error('Live update failed: ' + e);
        });
      }
      set({ graphCompileVersion: get().graphCompileVersion + 1 });
    } catch (error: any) {
      console.error('Live update failed:', error);
      toast.error('Live update failed: ' + (error?.message ?? String(error)));
      // La pill StatusBar/Toolbar persiste l'erreur après le toast —
      // un hot-swap raté silencieux = graphe UI ≠ graphe runtime.
      set({ compileError: String(error?.message ?? error), status: 'error' });
    }
  },

  // Track selection — extrait vers holProjectSlice
  // Draw mode — extrait vers drawModeSlice

  applyShapePreset: (presetId, nObjects) => {
    import('../utils/shapePresets').then(({ SHAPE_PRESETS }) => {
      const preset = SHAPE_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const { nodes: newNodes, edges: newEdges } = preset.build(nObjects);
      get().pushHistory();
      set({ nodes: newNodes, edges: newEdges });

      // Si un slot est sélectionné pour édition, mettre à jour son template + graphe.
      // setSlotTemplate gère aussi le hot-swap si le slot est en lecture.
      const editingSlotId = get().editingSlotId as string | null;
      if (editingSlotId) {
        const { setSlotTemplate } = get();
        if (setSlotTemplate) {
          setSlotTemplate(editingSlotId, presetId);
        }
      }

      // Sync l'animation store
      import('./useMoveEditorStore').then(({ useMoveEditorStore }) => {
        const animState = useMoveEditorStore.getState();
        animState.setCurrent({
          ...animState.current,
          name: preset.name,
          graph_json: { nodes: newNodes, edges: newEdges },
        });
      });
      // NOTE: on n'appelle pas updateGraphLive ici — setSlotTemplate gère
      // le hot-swap du slot édité directement (et sauve le graphe dans le slot).
    });
  },

  // ─── Undo/Redo ───
  _history: [] as Array<{ nodes: GraphNode[]; edges: Edge[] }>,
  _historyIndex: -1,
  _lastRemovalPushAt: 0,
  canUndo: false,
  canRedo: false,
  pushHistory: () => {
    const { nodes, edges, _history, _historyIndex } = get();
    const snapshot = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    const newHistory = _history.slice(0, _historyIndex + 1);
    newHistory.push(snapshot);
    // Limite à 50 entrées
    if (newHistory.length > 50) newHistory.shift();
    set({ _history: newHistory, _historyIndex: newHistory.length - 1, canUndo: newHistory.length > 1, canRedo: false });
  },
  undo: () => {
    const { _history, _historyIndex } = get();
    if (_historyIndex <= 0) return;
    const newIdx = _historyIndex - 1;
    const snapshot = _history[newIdx];
    set({
      nodes: JSON.parse(JSON.stringify(snapshot.nodes)),
      edges: JSON.parse(JSON.stringify(snapshot.edges)),
      _historyIndex: newIdx,
      canUndo: newIdx > 0,
      canRedo: true,
    });
    // Persister vers le slot en édition — sinon undo serait invisible
    // dans graphJson et perdu à la prochaine sélection de slot.
    autoSaveToEditingSlot();
    // Hot-swap inconditionnel : updateGraphLive self-guard
    // (isPlaying / movements / activeMovementIds)
    get().updateGraphLive(0.3).catch((e) => console.error('[undo] hot-swap failed:', e));
  },
  redo: () => {
    const { _history, _historyIndex } = get();
    if (_historyIndex >= _history.length - 1) return;
    const newIdx = _historyIndex + 1;
    const snapshot = _history[newIdx];
    set({
      nodes: JSON.parse(JSON.stringify(snapshot.nodes)),
      edges: JSON.parse(JSON.stringify(snapshot.edges)),
      _historyIndex: newIdx,
      canUndo: true,
      canRedo: newIdx < _history.length - 1,
    });
    autoSaveToEditingSlot();
    get().updateGraphLive(0.3).catch((e) => console.error('[redo] hot-swap failed:', e));
  },

  // ─── Panic ───
  panic: async () => {
    const { holProject, manualOscIds } = get();
    let failedStops = 0;
    // Stop immédiat — inconditionnel. `deactivate_all_moves` est idempotent et
    // le cache `movements` peut être stale : ne JAMAIS s'en servir de garde.
    // Un throw ici ne doit PAS empêcher l'envoi des positions d'origine (sinon
    // le spatializer garde les dernières positions et les sources restent "en
    // l'air").
    try {
      await get().stopAllMovements();
    } catch (e) {
      failedStops += 1;
      console.error('Panic: stop all failed:', e);
    }
    // Envoyer les positions d'origine à tous les récepteurs OSC — en
    // parallèle (64 awaits séquentiels dans un arrêt d'urgence = latence
    // inutile). `send_osc_position` route via le MergeRuntime (cible live).
    const sends: Promise<unknown>[] = [];
    if (holProject) {
      for (const track of holProject.tracks) {
        sends.push(
          invoke('send_osc_position', {
            oscId: track.id,
            x: track.position[0],
            y: track.position[1],
            z: track.position[2],
          }),
        );
      }
    } else {
      // Sans .hol : origines = track_positions backend (posées par
      // /stagespace/trackpos ou set_track_positions) — sinon (0,0,0).
      // Un backend down ne doit pas empêcher le reset à zéro : try/catch.
      let trackPositions: Record<number, [number, number, number]> = {};
      try {
        // `?? {}` : un backend qui résout null/undefined n'est pas une
        // erreur pour try/catch — mais trackPositions[id] crasherait.
        trackPositions = (await invoke('get_track_positions')) ?? {};
      } catch (e) {
        console.error('Panic: could not fetch track positions:', e);
      }
      for (const id of manualOscIds) {
        const pos = trackPositions[id] ?? [0, 0, 0];
        sends.push(
          invoke('send_osc_position', { oscId: id, x: pos[0], y: pos[1], z: pos[2] }),
        );
      }
    }
    const results = await Promise.allSettled(sends);
    const failedSends = results.filter((r) => r.status === 'rejected').length;
    for (const r of results) {
      if (r.status === 'rejected') console.error('Panic: position reset failed:', r.reason);
    }
    // Feedback obligatoire — un panic silencieux est un panic douteux.
    // Ne jamais prétendre que les positions ont été reset si aucun envoi
    // n'était possible (pas de .hol ni de manualOscIds).
    if (failedStops === 0 && failedSends === 0) {
      const msg = sends.length > 0
        ? 'PANIC — all moves stopped, positions reset'
        : 'PANIC — all moves stopped';
      toast.warning(msg, 4000);
    } else {
      toast.error(
        `PANIC partially failed — ${failedStops} stop error(s), ${failedSends} position reset(s) lost. Verify the spatializer state.`,
        0,
      );
    }
  },

  };
});

// ── Audio error listener — surface les pannes de capture (micro débranché,
// stream mort) pendant un show. Sans cet écouteur l'event `audio-error` émis
// par le poller Rust tombait dans le vide.
let lastAudioError = '';
let lastAudioErrorAt = 0;
export const useAudioErrorListener = () => {
  React.useEffect(() => {
    const unlisten = listen<string>('audio-error', (event) => {
      const message = typeof event.payload === 'string' ? event.payload : String(event.payload);
      // Dedup : le poller peut renvoyer la même erreur en boucle — un toast
      // identique toutes les 5s max, sinon jamais.
      const now = Date.now();
      if (message === lastAudioError && now - lastAudioErrorAt < 5000) return;
      lastAudioError = message;
      lastAudioErrorAt = now;
      toast.error(`Audio capture failed: ${message}`);
    });
    const unlistenRecovered = listen('audio-recovered', () => {
      lastAudioError = '';
      toast.success('Audio capture recovered');
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
      unlistenRecovered.then((fn) => fn()).catch(() => {});
    };
  }, []);
};

// ── Audio state listener — flux `audio-state-update` (amplitude/BPM/spectre).
// Monté au niveau App, pas dans AudioPanel : le panneau peut être replié,
// masqué ou absent (Perform) alors que des CustomNode AudioSpectrum affichent
// encore le spectre. Le listener vit tant que l'app vit.
export const useAudioStateListener = () => {
  const setAudioState = useGraphStore((s) => s.setAudioState);
  React.useEffect(() => {
    const unlisten = listen<AudioState>('audio-state-update', (event) => {
      setAudioState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setAudioState]);
};

// ── Cue recall listener — surface les respawns échoués d'un recall partiel.
// Le backend continue un recall même si un move échoue (partial recall) —
// sans ce listener l'échec passerait pour un succès complet.
export const useCueRecallListener = () => {
  const refreshMovements = useGraphStore((s) => s.refreshMovements);
  React.useEffect(() => {
    const unlisten = listen<{ cue_id: string; failed_moves: string[] }>(
      'cue-recalled',
      (event) => {
        refreshMovements();
        const failed = event.payload?.failed_moves ?? [];
        if (failed.length > 0) {
          toast.error(
            `Cue recall partial — ${failed.length} move(s) failed to restart (${failed.join(', ')}). Check the spatializer.`,
            0,
          );
        }
      },
    );
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [refreshMovements]);
};

// ── Supervisor listener — events du watchdog backend (audits C5/C7) :
// worker zombie arrêté, merge thread redémarré sans le frontend.
export const useSupervisorListener = () => {
  React.useEffect(() => {
    const unStale = listen<string>('move-stale-killed', (event) => {
      toast.warning(
        `Move "${event.payload}" was stopped — its engine worker froze. Check graph complexity.`,
      );
    });
    const unRestart = listen('merge-restarted', () => {
      toast.warning('Output engine restarted automatically after a crash — playback resumed.');
    });
    const unRestartFailed = listen<string>('merge-restart-failed', (event) => {
      toast.error(
        `Output engine failed to restart — OSC output is DOWN: ${event.payload}`,
        0,
      );
    });
    return () => {
      unStale.then((fn) => fn()).catch(() => {});
      unRestart.then((fn) => fn()).catch(() => {});
      unRestartFailed.then((fn) => fn()).catch(() => {});
    };
  }, []);
};

// ── Global positions listener — écoute l'event global-positions du MergeRuntime ──
// Une seule source de positions (déjà mergées + transformées), au lieu de N events par movement.
export const useMovementPositionsListener = () => {
  const setMovementPositions = useGraphStore((s) => s.setMovementPositions);
  const movements = useGraphStore((s) => s.movements);
  const refreshMovements = useGraphStore((s) => s.refreshMovements);

  // Écouter active-moves-update pour sync la liste des moves (activate/deactivate côté backend)
  React.useEffect(() => {
    const unlisten = listen('active-moves-update', async () => {
      await refreshMovements();
      // Sync les slots après refresh — nettoie les movementIds stale
      useGraphStore.getState().syncSlotMovements();
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [refreshMovements]);

  // Ref partagé pour les effects qui doivent connaître l'état playback sans
  // y souscrire (évite de déclencher les invokes de config pendant le show).
  const movementsCount = useGraphStore((s) => s.movements.length);
  const movementsCountRef = React.useRef(movementsCount);
  movementsCountRef.current = movementsCount;

  // Appliquer la config OSC au backend (au démarrage + à chaque changement)
  const oscAddress = useGraphStore((s) => s.oscAddress);
  const oscPort = useGraphStore((s) => s.oscPort);
  const oscProfile = useGraphStore((s) => s.oscProfile);
  React.useEffect(() => {
    // Pendant le playback la config OSC est lockée backend-side — ne pas
    // invoquer (évite un faux toast d'erreur à chaque transition).
    if (movementsCountRef.current > 0) return;
    // Debounce : la saisie clavier produit un invoke par keystroke sinon.
    const t = setTimeout(() => {
      invoke('set_osc_output', { address: oscAddress, port: oscPort, profile: oscProfile })
        .catch((e: any) => {
          console.error('Failed to set OSC output:', e);
          // Zéro OSC sortant = show silencieux — l'utilisateur DOIT le voir.
          toast.error(`OSC output config failed — no positions will be sent: ${e}`);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [oscAddress, oscPort, oscProfile]);

  // Pousser les osc_ids globaux (manualOscIds ou hol track ids) au backend.
  // CRITICAL: le MergeRuntime utilise cette liste pour mapper track_indices → osc_id
  // lors de l'OSC output. Si cette liste ne correspond pas aux track_indices,
  // les positions ne sont pas envoyées en OSC.
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const holProject = useGraphStore((s) => s.holProject);
  React.useEffect(() => {
    // Pendant le playback le backend rejette set_global_osc_ids — ne pas
    // invoquer (évitait le toast "OSC track mapping failed" à chaque play).
    // movementsCount dans les deps : quand le dernier move s'arrête, l'effect
    // refire et pousse les ids en attente.
    if (movementsCount > 0) return;
    // Debounce : manualOscIds change à chaque keystroke dans le champ.
    const t = setTimeout(() => {
      // Utiliser les track ids du hol project si disponible, sinon manualOscIds
      const globalIds = holProject?.tracks?.map((t: any) => t.id) ?? manualOscIds;
      invoke('set_global_osc_ids', { oscIds: globalIds })
        .catch((e: any) => {
          console.error('Failed to set global osc ids:', e);
          // Sans mapping track→osc_id, le MergeRuntime n'émet rien — critique.
          toast.error(`OSC track mapping failed — output may be silent: ${e}`);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [manualOscIds, holProject, movementsCount]);

  // Écouter global-positions (un seul event avec toutes les positions mergées)
  React.useEffect(() => {
    if (movements.length === 0) return;
    let ipcFrameCount = 0;
    let ipcLastPerf = performance.now();
    let ipcMaxDelta = 0;
    let ipcLastTime = performance.now();
    const unlisten = listen('global-positions', (event: any) => {
      const now = performance.now();
      const delta = now - ipcLastTime;
      if (delta > ipcMaxDelta) ipcMaxDelta = delta;
      ipcLastTime = now;
      ipcFrameCount++;
      if (now - ipcLastPerf > 2000) {
        const ipcFps = ipcFrameCount / ((now - ipcLastPerf) / 1000);
        const dp = (window as any).__debugPerf;
        if (dp) {
          dp.ipcFps = ipcFps;
          dp.ipcMaxGap = ipcMaxDelta;
        }
        ipcFrameCount = 0;
        ipcMaxDelta = 0;
        ipcLastPerf = now;
      }
      const { positions } = event.payload as {
        time: number;
        positions: Array<[number, [number, number, number]]>;
      };
      // Les positions sont déjà mergées + transformées par le MergeRuntime.
      // On les stocke sous un pseudo-movement-id "global" pour compat avec le render loop.
      setMovementPositions(
        'global',
        positions.map(([index, [x, y, z]]) => ({ index, x, y, z })),
      );
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [movements.length, setMovementPositions]);
};

