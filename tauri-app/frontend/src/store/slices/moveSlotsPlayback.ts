/// Méthodes live/playback du slice MoveSlots — extraites de
/// moveSlotsSlice.ts (règle modularisation). playSlot/stopSlot/goToNextMove/
/// syncSlotMovements — le chemin critique du show, inchangé.
import { safeInvoke as invoke, feLog } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { computeCentroid } from '../utils/geometryUtils';
import type { StateCreator } from 'zustand';
import type { MoveSlotsSlice, MoveSlotsStore } from './moveSlotsSlice';
import {
  normalizeSlot,
  saveSlotsToStorage,
  extractDuration,
  computeTrackIndices,
  markFading,
  _fadingMoveIds,
  _orphanWarnedIds,
} from './moveSlotsTypes';

type CreatorArgs = Parameters<StateCreator<MoveSlotsStore, [], [], MoveSlotsSlice>>;

export const createSlotPlaybackMethods = (set: CreatorArgs[0], get: CreatorArgs[1]): Pick<MoveSlotsSlice, 'playSlot' | 'stopSlot' | 'stopSlotWithFade' | 'goAllSlots' | 'stopAllSlots' | 'editSlotGraph' | 'saveEditorToSlot' | 'goToNextMove' | 'syncSlotMovements'> => ({
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
        const currentNodes = get().nodes;
        const currentEdges = get().edges;
        if (currentNodes?.length > 0) {
          graphJson = { nodes: currentNodes, edges: currentEdges };
        }
      }

      const { prepareGraphForSave } = await import('../../components/nodeParamSchema');
      const graphData = prepareGraphForSave(graphJson.nodes, graphJson.edges);

      // Lire la duration depuis le node Duration du graphe
      const duration = extractDuration(graphJson.nodes);

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
      // Graphe de modulation per-move (cibles `param:` liées aux nodes du
      // graphe du move — compilé côté backend avec le même graph_json).
      const signalGraphData = slot.signalGraph
        ? {
            nodes: slot.signalGraph.nodes.map((n) => ({
              id: n.id,
              type: 'custom',
              position: n.position,
              data: {
                label: n.data.label ?? n.data.type ?? '',
                type: n.data.type ?? 'SignalOut',
                params: n.data.params ?? {},
              },
            })),
            edges: slot.signalGraph.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle ?? 'out',
              targetHandle: e.targetHandle ?? 'signal',
            })),
          }
        : null;

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
          end_mode: slot.endMode ?? 'revert',
          anchor_mode: slot.anchorMode ?? 'origin',
          // Boundary UI→wire : l'opérateur saisit un track_id, le
          // backend attend obj_index (position dans osc_ids).
          anchor_target: slot.anchorTarget != null
            ? (manualOscIds.indexOf(slot.anchorTarget) >= 0
                ? manualOscIds.indexOf(slot.anchorTarget)
                : null)
            : null,
          // Le graphe de modulation per-move voyage via l'animation payload
          // (MoveSpec.signal_graph = request.animation.signal_graph).
          animation: animation ? { ...animation, signal_graph: signalGraphData } : animation,
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
        return {
          moveSlots: newSlots,
          pendingPlays: s.pendingPlays.filter((pid) => pid !== id),
          // Surface d'erreur persistante — le toast part, la pill reste.
          playError: String(e),
          status: 'error' as const,
        };
      });
      return false;
    }
  },

  stopSlot: async (id) => {
    const slot = get().moveSlots.find((s) => s.id === id);
    if (!slot?.movementId) return;
    const movementId = slot.movementId;
    // Stop opérateur → désarmer les pre_wait/follow pendus : sinon une cue
    // armée ressuscite le move N secondes après le stop (audit P2).
    void import('../useCuelistStore').then((m) =>
      m.useCuelistStore.getState().cancelPendingTimers(),
    );
    void import('../../utils/timerBroadcast').then((m) => m.broadcastTimerCancel());
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
    void import('../useCuelistStore').then((m) =>
      m.useCuelistStore.getState().cancelPendingTimers(),
    );
    void import('../../utils/timerBroadcast').then((m) => m.broadcastTimerCancel());
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

  goToNextMove: async () => {
    // Guard show — un GO pendant un recall intercalerait des stop/play
    // entre le kill-all et le respawn ; et tout timer pendu (pre_wait/
    // follow) doit être désarmé. Même garde que liveActions.doGo, ici au
    // niveau store pour couvrir les appels UI directs.
    const { useCuelistStore } = await import('../useCuelistStore');
    const cueStore = useCuelistStore.getState();
    if (cueStore.isRecalling) {
      return { ok: false, message: 'Busy — a cue recall is in progress' };
    }
    cueStore.cancelPendingTimers();
    const { broadcastTimerCancel } = await import('../../utils/timerBroadcast');
    broadcastTimerCancel();

    const { setlistOrder, currentSetlistIndex, moveSlots } = get();
    if (setlistOrder.length === 0) {
      return { ok: false, message: 'Empty setlist — add moves to the setlist' };
    }

    const nextIndex = currentSetlistIndex + 1;
    if (nextIndex >= setlistOrder.length) {
      return { ok: false, message: 'Fin de la setlist atteinte' };
    }

    const nextSlotId = setlistOrder[nextIndex];
    const nextSlot = moveSlots.find((s) => s.id === nextSlotId);
    if (!nextSlot) {
      return { ok: false, message: `Move "${nextSlotId}" introuvable` };
    }

    // 1. Stopper tous les moves actifs avec fade
    //    Le backend attend la fin du fade avant de résoudre la promesse
    const activeSlots = moveSlots.filter((s) => s.movementId);
    if (activeSlots.length > 0) {
      const fadeDur = nextSlot.fadeDuration ?? 2.0;
      await Promise.all(activeSlots.map((s) => get().stopSlotWithFade(s.id, fadeDur)));
    }

    // 2. Ne pas avancer si le slot cible a une activation en cours (anti double-GO)
    if (get().pendingPlays.includes(nextSlotId)) {
      return { ok: false, message: `Move "${nextSlot.name}" is already activating — wait` };
    }

    // 3. Lancer le prochain move — n'avancer l'index QUE sur succès,
    //    sinon le GO suivant skipperait un move jamais lancé.
    const ok = await get().playSlot(nextSlotId);
    if (!ok) {
      return { ok: false, message: `GO FAILED: "${nextSlot.name}" did not start (see error above)` };
    }

    // 4. Avancer l'index
    set({ currentSetlistIndex: nextIndex });

    const total = setlistOrder.length;
    return { ok: true, message: `GO: "${nextSlot.name}" (${nextIndex + 1}/${total})` };
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
