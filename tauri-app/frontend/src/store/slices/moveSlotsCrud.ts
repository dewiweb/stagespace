/// Méthodes CRUD/sélection/setters/setlist du slice MoveSlots —
/// extraites de moveSlotsSlice.ts (règle modularisation). Reçoit set/get
/// du StateCreator ; retourne un fragment Partial<MoveSlotsSlice> spread
/// dans le slice composite.
import { safeInvoke as invoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { migrateStoredGraph } from '../../utils/graphMigration';
import type { StateCreator } from 'zustand';
import type { MoveSlotsSlice, MoveSlotsStore } from './moveSlotsSlice';
import {
  buildGraphForSlot,
  defaultMacros,
  syncObjectsNodeNoHotSwap,
  slotToAnimation,
  saveSlotsToStorage,
  saveSlotsToStorageDebounced,
  saveSetlistToStorage,
  computeTrackIndices,
  extractDuration,
  ENGINE_TYPES_WITH_N_OBJECTS,
  throttledMoveSpeed,
} from './moveSlotsTypes';

type CreatorArgs = Parameters<StateCreator<MoveSlotsStore, [], [], MoveSlotsSlice>>;

export const createSlotCrudMethods = (set: CreatorArgs[0], get: CreatorArgs[1]): Pick<MoveSlotsSlice, 'setSlotSignalGraph' | 'selectSlotForEditing' | 'addMoveSlot' | 'removeMoveSlot' | 'renameMoveSlot' | 'setSlotTemplate' | 'setSlotTracks' | 'setSlotMacros' | 'setSlotFadeDuration' | 'setSlotEndMode' | 'setSlotAnchorMode' | 'setSlotAnchorTarget' | 'setSlotLoopMode' | 'setSlotDirection' | 'updateSlotAnimationFields' | 'toggleSlotPreview' | 'addToSetlist' | 'removeFromSetlist' | 'moveSetlistItem'> => ({
  setSlotSignalGraph: (id, graph) => {
    set((s) => {
      const moveSlots = s.moveSlots.map((sl) =>
        sl.id === id ? { ...sl, signalGraph: graph } : sl,
      );
      saveSlotsToStorageDebounced(moveSlots);
      return { moveSlots };
    });
  },

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
    // migrateStoredGraph : types renommés/inconnus des vieux slots persistés.
    if (graphJson) {
      const migrated = migrateStoredGraph(
        { nodes: graphJson.nodes, edges: graphJson.edges },
        'slotGraph',
      );
      if (migrated) {
        get().setNodes(JSON.parse(JSON.stringify(migrated.nodes)));
        get().setEdges(JSON.parse(JSON.stringify(migrated.edges)));
      }
    }
    // Reset undo/redo — l'historique appartient au slot précédent.
    // Sans ça, un undo après switch restaurerait le graphe d'un autre slot.
    set({ _history: [], _historyIndex: -1, canUndo: false, canRedo: false });
    // Baseline : le graphe du slot devient l'entrée 0 — sinon le premier
    // edit après un switch n'était jamais undoable (undo bloque à index 0).
    get().pushHistory?.();
    // Sync selectedTrackIds avec les tracks du slot.
    // IMPORTANT: on met à jour selectedTrackIds SANS appeler syncObjectsNode
    // (qui ferait un hot-swap sur TOUS les moves actifs).
    // On sync juste le node Objects visuellement, sans hot-swap backend.
    set({ selectedTrackIds: new Set(slot.trackIds) });
    // Sync visuel du node Objects (sans hot-swap)
    syncObjectsNodeNoHotSwap(get);
    // Projeter le slot dans `current` — l'Inspector édite `current`, qui est
    // write-through vers ce slot. Import deferred : cycle useGraphStore ↔
    // useMoveEditorStore (même pattern que les autres call-sites du store).
    import('../useMoveEditorStore').then(({ useMoveEditorStore }) => {
      useMoveEditorStore.getState().setCurrent(slotToAnimation(get().moveSlots.find((s) => s.id === id) ?? slot));
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
        signalGraph: null,
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
        oscIndex: Math.max(0, ...get().moveSlots.map((sl) => sl.oscIndex)) + 1,
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
              const nodeType = n.data.type as string;
              const params = n.data.params ?? {};
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
        ? { nodes: get().nodes, edges: get().edges }
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

  setSlotEndMode: (id, mode) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, endMode: mode } : sl);
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
  },

  setSlotAnchorMode: (id, mode) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, anchorMode: mode } : sl);
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
  },

  setSlotAnchorTarget: (id, target) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, anchorTarget: target } : sl);
      saveSlotsToStorage(newSlots);
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
});
