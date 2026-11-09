/// Infra partagée des actions live — logging, NACK OSC, désarmement
/// des timers, routage des fenêtres détachées. Importée par les modules
/// domaine ; liveActions.ts ré-exporte les actions publiques.
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { broadcastTimerCancel } from './timerBroadcast';
import { isDetachedWindow } from './safeStorage';
import { emit } from '@tauri-apps/api/event';
import { safeInvoke as invoke, silentCatch } from './tauri';

/// Rehearsal capture — bande de commandes horodatée : enregistre ce
/// que le busking fait vraiment, rejoue comme un cue live.
export const rehearsalState: {
  recording: boolean;
  t0: number;
  entries: { t: number; name: string; args: number[] }[];
  playTimers: ReturnType<typeof setTimeout>[];
} = { recording: false, t0: 0, entries: [], playTimers: [] };

export function rec(name: string, args: number[] = []) {
  if (rehearsalState.recording)
    rehearsalState.entries.push({ t: Date.now() - rehearsalState.t0, name, args });
}

/// Log opérationnel — le point de passage commun GUI + OSC.
/// Les commandes OSC (from présent) sont broadcastées par le backend
/// en 'show-log' à toutes les fenêtres : ne pas doubler ici.
export function logAction(name: string, detail?: string) {
  if (detail) return; // couvert par le broadcast backend
  useGraphStore.getState().pushShowLog(name);
}

/// Annule les timers pre_wait/follow ICI ET partout — chaque webview
/// possède ses propres timers (revue H1) : un panic/stop dans une
/// fenêtre détachée doit désarmer ceux de la principale aussi.
export function disarmPending() {
  useCuelistStore.getState().cancelPendingTimers();
  broadcastTimerCancel();
}

/// Fenêtre détachée → la commande part sur le fil `conduite:cmd` : la
/// fenêtre PRINCIPALE exécute (propriétaire unique des actions show —
/// indices, isRecalling, slots toujours frais). Une exécution locale
/// dans la détachée utilisait son index cue stale et son store local
/// (revue M5 : mauvaise cue tirée, moves doublés).
export function routeDetached(wire: string): boolean {
  if (!isDetachedWindow()) return false;
  void emit('conduite:cmd', wire).catch(() => {});
  return true;
}

/** NACK le contrôleur OSC si la commande vient d'/stagespace/* (from). */
export function nack(from: string | undefined, reason: string) {
  if (!from) return;
  invoke('send_show_nack', { addr: from, reason }).catch(silentCatch);
}

/** Garde commune : rejet NACK si un recall est en cours. */
export function recallBusy(from?: string): boolean {
  if (useCuelistStore.getState().isRecalling) {
    nack(from, 'busy: recall-in-progress');
    return true;
  }
  return false;
}
