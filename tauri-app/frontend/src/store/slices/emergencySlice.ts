/// Slice urgence — panic show : stoppe tous les moves (inconditionnel,
/// même si le cache movements est stale) puis renvoie chaque objet à sa
/// position d'origine en parallèle. Extrait de useGraphStore.ts
/// (règle modularisation) — comportement inchangé.
import { safeInvoke as invoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import type { StateCreator } from 'zustand';
import type { HolProject } from '../types/index';

export interface EmergencySlice {
  /// Stoppe tous les mouvements + reset OSC positions + toast feedback
  panic: () => Promise<void>;
}

/// Dépendances minimales du slice — satisfaites par GraphState.
export type EmergencyStore = EmergencySlice & {
  holProject: HolProject | null;
  manualOscIds: number[];
  objectStates: Record<number, string>;
  stopAllMovements: () => Promise<void>;
};

type CreatorArgs = Parameters<StateCreator<EmergencyStore, [], [], EmergencySlice>>;

export const createEmergencySlice = (_set: CreatorArgs[0], get: CreatorArgs[1]): EmergencySlice => ({
  // ─── Panic ───
  panic: async () => {
    // Le panic annule aussi les timers de cue pendus (pre_wait/follow) —
    // sinon une cue armée pouvait refaire vivre des moves N secondes
    // après l'arrêt d'urgence.
    void import('../useCuelistStore').then((m) =>
      m.useCuelistStore.getState().cancelPendingTimers(),
    );
    void import('../../utils/timerBroadcast').then((m) => m.broadcastTimerCancel());
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
      // Objets sous override opérateur/externe (manuel, park, psn, hold,
      // freeze — les sources backend ≠ track/move) : le panic ne les
      // téléporte pas — le merge renverrait leur position tenue à la
      // frame suivante = flash aller-retour (revue L6). PAS manualPositions
      // ici : la carte contient le layout par défaut pour TOUS les objets.
      const OVERRIDE_SOURCES = new Set(['manual', 'park', 'psn', 'hold', 'freeze']);
      const states = get().objectStates ?? {};
      for (const id of manualOscIds) {
        const objIdx = manualOscIds.indexOf(id);
        if (OVERRIDE_SOURCES.has(states[objIdx] ?? '')) continue;
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
});
