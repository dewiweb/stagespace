import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
import { computeCentroid } from '../utils/geometryUtils';
import type { Node, Edge } from 'reactflow';
import type { HolProject } from '../types/index';

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
  /// ID du movement actif (null = arrêté)
  movementId: string | null;
  /// Mode preview ou live
  isPreview: boolean;
  /// Macros sauvegardées (appliquées au lancement et au GO)
  macros: MoveMacros;
  /// Durée du fade pour les transitions (GO, stop avec fade)
  fadeDuration: number;
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
  const ids = Array.from(s.selectedTrackIds).sort((a: number, b: number) => a - b);
  if (ids.length === 0 && !s.nodes.find((n: any) => (n.data as any)?.type === 'Objects')) return;

  const ENGINE_TYPES = new Set([
    'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
    'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
    'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
    'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm',
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

  // ─── CRUD moves ───
  addMoveSlot: () => void;
  removeMoveSlot: (id: string) => void;
  renameMoveSlot: (id: string, name: string) => void;
  setSlotTemplate: (id: string, templateId: string) => void;
  setSlotTracks: (id: string, trackIds: number[]) => void;
  setSlotMacros: (id: string, macros: Partial<MoveMacros>) => void;
  setSlotFadeDuration: (id: string, fade: number) => void;
  /// Bascule le mode preview (pas d'OSC out) / live (OSC out)
  toggleSlotPreview: (id: string) => void;
  /// Sélectionne un slot pour édition — sync selectedTrackIds + charge le graphe dans l'éditeur
  selectSlotForEditing: (id: string | null) => void;

  // ─── Live (lancer/arrêter) ───
  playSlot: (id: string) => Promise<void>;
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
  'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm',
  'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
  'Mix', 'Group', 'Sequence', 'Crossfade',
]);

function loadSlotsFromStorage(): MoveSlot[] {
  try {
    const raw = localStorage.getItem(SLOTS_STORAGE_KEY);
    if (!raw) return [];
    const slots = JSON.parse(raw);
    // Migration: ajouter macros + fadeDuration si manquants (anciennes versions)
    return slots.map((s: any) => ({
      ...s,
      macros: s.macros ?? defaultMacros(),
      fadeDuration: s.fadeDuration ?? 2.0,
    }));
  } catch {
    return [];
  }
}

function saveSlotsToStorage(slots: MoveSlot[]) {
  try {
    localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
  } catch {}
}

function loadSetlistFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(SETLIST_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSetlistToStorage(setlist: string[]) {
  try {
    localStorage.setItem(SETLIST_STORAGE_KEY, JSON.stringify(setlist));
  } catch {}
}

export const createMoveSlotsSlice: StateCreator<MoveSlotsStore, [], [], MoveSlotsSlice> = (set, get) => ({
  moveSlots: loadSlotsFromStorage(),
  setlistOrder: loadSetlistFromStorage(),
  currentSetlistIndex: -1,
  editingSlotId: null,

  selectSlotForEditing: (id) => {
    set({ editingSlotId: id });
    if (!id) return;
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot) return;
    // Charger le graphe du slot dans l'éditeur AVANT de sync les tracks,
    // pour que syncObjectsNode mette à jour le BON Objects node.
    if (slot.graphJson) {
      get().setNodes(JSON.parse(JSON.stringify(slot.graphJson.nodes)));
      get().setEdges(JSON.parse(JSON.stringify(slot.graphJson.edges)));
    }
    // Sync selectedTrackIds avec les tracks du slot.
    // IMPORTANT: on met à jour selectedTrackIds SANS appeler syncObjectsNode
    // (qui ferait un hot-swap sur TOUS les moves actifs).
    // On sync juste le node Objects visuellement, sans hot-swap backend.
    set({ selectedTrackIds: new Set(slot.trackIds) });
    // Sync visuel du node Objects (sans hot-swap)
    syncObjectsNodeNoHotSwap(get);
  },

  addMoveSlot: () => {
    const { holProject, manualOscIds, moveSlots } = get();
    // Tracks par défaut: toutes les tracks disponibles
    const defaultTrackIds = holProject
      ? holProject.tracks.map((t) => t.id)
      : manualOscIds;
    const idx = moveSlots.length + 1;
    const newSlotId = `slot-${Date.now()}`;
    set((s) => {
      const newSlots = [...s.moveSlots, {
        id: newSlotId,
        name: `Move ${idx}`,
        graphJson: null, // Sera construit au play depuis le template
        templateId: 'circle',
        trackIds: defaultTrackIds,
        movementId: null,
        isPreview: false,
        macros: defaultMacros(),
        fadeDuration: 2.0,
      }];
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
    // Sélectionner automatiquement le nouveau slot pour édition
    get().selectSlotForEditing(newSlotId);
  },

  removeMoveSlot: (id) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    // Arrêter le movement si actif
    if (slot?.movementId) {
      get().stopMovement(slot.movementId);
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
        import('../../components/nodeParamSchema').then(({ prepareGraphForSave }) => {
          const graphData = prepareGraphForSave(nodes, edges);
          invoke('update_move_graph_merged', {
            movementId: slot.movementId,
            graphJson: graphData,
            fadeDuration: 0.5,
          }).catch(console.error);
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
      // Comparaison rapide : même taille + mêmes éléments
      let same = currentSelected.size === newSet.size;
      if (same) {
        for (const t of newSet) {
          if (!currentSelected.has(t)) { same = false; break; }
        }
      }
      if (!same) {
        get().setSelectedTrackIds(newSet);
      }
    } else {
      // Slot non-édité mais en lecture : hot-swap avec le graphe mis à jour
      const slot = get().moveSlots.find((s) => s.id === id);
      if (slot?.movementId && slot?.graphJson) {
        import('../../components/nodeParamSchema').then(({ prepareGraphForSave }) => {
          const graphData = prepareGraphForSave(slot.graphJson!.nodes, slot.graphJson!.edges);
          invoke('update_move_graph_merged', {
            movementId: slot.movementId,
            graphJson: graphData,
            fadeDuration: 0.3,
          }).catch(console.error);
        });
      }
    }
  },

  playSlot: async (id) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot) return;
    if (slot.movementId) return; // Déjà en lecture

    const { holProject, manualOscIds } = get();

    // Construire le graphe si pas déjà fait
    let graphJson = slot.graphJson;
    if (!graphJson) {
      const { SHAPE_PRESETS } = await import('../../utils/shapePresets');
      const preset = SHAPE_PRESETS.find((p) => p.id === slot.templateId) ?? SHAPE_PRESETS[0];
      const built = preset.build(slot.trackIds.length);
      graphJson = { nodes: built.nodes, edges: built.edges };
      // Sauvegarder dans le slot
      set((s) => {
        const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, graphJson } : sl);
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots };
      });
    }

    // Préparer le graphe pour le backend
    const { prepareGraphForSave } = await import('../../components/nodeParamSchema');
    const graphData = prepareGraphForSave(graphJson.nodes, graphJson.edges);

    // Résoudre les trackIndices depuis les trackIds
    const trackIndices: number[] = [];
    if (holProject) {
      slot.trackIds.forEach((id) => {
        const idx = holProject.tracks.findIndex((t) => t.id === id);
        if (idx >= 0) trackIndices.push(idx);
      });
    } else {
      slot.trackIds.forEach((id) => {
        const idx = manualOscIds.indexOf(id);
        trackIndices.push(idx >= 0 ? idx : id - 1);
      });
    }

    // Calculer le centroïde
    const origin = computeCentroid(holProject, trackIndices, manualOscIds);

    const movementId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Récupérer la config OSC globale
    const { oscAddress, oscPort, oscProfile } = get();
    try {
      await invoke('activate_move', {
        request: {
          movement_id: movementId,
          name: slot.name,
          graph_json: graphData,
          osc_ids: slot.trackIds,
          track_indices: trackIndices,
          is_preview: slot.isPreview,
          origin,
        },
      });
      // Appliquer le speed du slot au movement (per-move)
      if (slot.macros) {
        try {
          await invoke('set_move_speed', {
            movementId,
            speed: slot.macros.speed ?? 1.0,
          });
        } catch (e) {
          console.warn('[playSlot] set_move_speed failed:', e);
        }
      }
      set((s) => {
        const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, movementId } : sl);
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots };
      });
      await get().refreshMovements();
    } catch (e) {
      console.error(`[playSlot] Failed to play slot ${id}:`, e);
    }
  },

  stopSlot: async (id) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot?.movementId) return;
    try {
      await get().stopMovement(slot.movementId);
      set((s) => {
        const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, movementId: null } : sl);
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots };
      });
    } catch (e) {
      console.error(`[stopSlot] Failed to stop slot ${id}:`, e);
    }
  },

  stopSlotWithFade: async (id, fadeDuration) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot?.movementId) return;
    try {
      await get().stopMovementWithFade(slot.movementId, fadeDuration);
      set((s) => {
        const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, movementId: null } : sl);
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots };
      });
    } catch (e) {
      console.error(`[stopSlotWithFade] Failed to stop slot ${id}:`, e);
      // Ne pas mettre movementId à null si le stop a échoué
    }
  },

  goAllSlots: async () => {
    const slots = get().moveSlots.filter((s) => !s.movementId);
    // Lancer en séquentiel (le backend gère le parallèle)
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
    const { nodes, edges } = get();
    set((s) => {
      const newSlots = s.moveSlots.map((sl) =>
        sl.id === id ? { ...sl, graphJson: { nodes: [...nodes], edges: [...edges] } } : sl
      );
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
    // Hot-swap si le slot est en lecture
    const slot = get().moveSlots.find((s) => s.id === id);
    if (slot?.movementId) {
      import('../../components/nodeParamSchema').then(({ prepareGraphForSave }) => {
        const graphData = prepareGraphForSave(nodes, edges);
        invoke('update_move_graph_merged', {
          movementId: slot.movementId,
          graphJson: graphData,
          fadeDuration: 0.3,
        }).catch(console.error);
      });
    }
  },

  setSlotMacros: (id, macros) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) =>
        sl.id === id ? { ...sl, macros: { ...sl.macros, ...macros } } : sl
      );
      saveSlotsToStorage(newSlots);
      return { moveSlots: newSlots };
    });
    // Appliquer en live si le slot est en lecture
    const slot = get().moveSlots.find((s) => s.id === id);
    if (slot?.movementId) {
      // Speed = per-move (worker) — pousser au backend
      invoke('set_move_speed', {
        movementId: slot.movementId,
        speed: slot.macros.speed ?? 1.0,
      }).catch((e) => console.warn('[setSlotMacros] set_move_speed failed:', e));
      // Note: les macros spatiales (scale, shift, rotation) sont globales (MergeRuntime).
      // Elles ne sont PAS poussées ici — utiliser les macros globales de l'Inspector pour ça.
      // Les macros spatiales du slot sont appliquées au lancement (playSlot) via set_global_macro.
    }
  },

  setSlotFadeDuration: (id, fade) => {
    set((s) => {
      const newSlots = s.moveSlots.map((sl) => sl.id === id ? { ...sl, fadeDuration: fade } : sl);
      saveSlotsToStorage(newSlots);
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
    if (setlistOrder.length === 0) return 'Setlist vide — ajoute des moves à la setlist';

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

    // 2. Lancer le prochain move
    await get().playSlot(nextSlotId);

    // 3. Avancer l'index
    set({ currentSetlistIndex: nextIndex });

    const total = setlistOrder.length;
    return `GO: "${nextSlot.name}" (${nextIndex + 1}/${total})`;
  },

  syncSlotMovements: () => {
    // Nettoyer les movementIds qui ne sont plus actifs côté backend
    const { movements, moveSlots } = get();
    const activeIds = new Set(movements.map((m) => m.id));
    const hasStale = moveSlots.some((s) => s.movementId && !activeIds.has(s.movementId));
    if (hasStale) {
      set((s) => {
        const newSlots = s.moveSlots.map((sl) =>
          sl.movementId && !activeIds.has(sl.movementId) ? { ...sl, movementId: null } : sl
        );
        saveSlotsToStorage(newSlots);
        return { moveSlots: newSlots };
      });
    }
  },
});
