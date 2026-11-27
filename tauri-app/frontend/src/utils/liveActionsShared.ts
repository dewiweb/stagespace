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
/// que le busking fait vraiment, puis le convertit en CLIPS de la
/// timeline Score (recorder → sequencer, pas de tape parallèle).
export interface RecRef {
  /// Slot résolu à l'enregistrement (référence vivante — le clip suit
  /// le slot si son graphe est édité plus tard).
  slotId?: string;
  /// Cue résolue à l'enregistrement.
  cueId?: string;
  /// Objet cible en track_id (converti depuis l'obj_index de la
  /// commande — l'identité persistante de l'objet opérateur).
  trackId?: number | null;
  /// Takeover de position : track_id → xyz.
  positions?: Record<number, [number, number, number]>;
  /// Slots à restaurer (unsolo) ou stoppés (solo).
  slotIds?: string[];
  /// Force d'un geste balistique.
  strength?: number;
  /// Vélocité d'un throw.
  vel?: [number, number, number];
  /// Nom de macro normalisé (clé store) ou 'spatial'.
  macro?: string;
}
export interface RecEntry { t: number; name: string; args: number[]; ref?: RecRef }
export const rehearsalState: {
  recording: boolean;
  t0: number;
  entries: RecEntry[];
} = { recording: false, t0: 0, entries: [] };

export function rec(name: string, args: number[] = [], ref?: RecRef) {
  if (rehearsalState.recording)
    rehearsalState.entries.push({ t: Date.now() - rehearsalState.t0, name, args, ref });
}

/// Log opérationnel — le point de passage commun GUI + OSC.
/// Les commandes OSC (from présent) sont broadcastées par le backend
/// en 'show-log' à toutes les fenêtres : ne pas doubler ici.
export function logAction(name: string, detail?: string) {
  // Seule la provenance réseau ('osc:<addr>') est couverte par le broadcast
  // backend — les tags GUI ('menu', 'conduite'…) ne le sont JAMAIS :
  // les supprimer ici les faisait disparaître du log (audit U14).
  if (detail?.startsWith('osc:')) return;
  useGraphStore.getState().pushShowLog(name);
}

/// Les actions sont loggées sous leur nom de fonction (`doTape`,
/// `doCueGo`…) — l'opérateur doit lire le show, pas le code. Mapping
/// explicite pour les noms cryptiques, sinon `doX` → `X`.
const LOG_LABELS: Record<string, string> = {
  doTape: 'Position tape',
  doRehearsal: 'Rehearsal capture',
  doTcChase: 'TC chase',
  doTcFps: 'TC fps',
  doCueGo: 'Cue GO',
  doCuePrev: 'Cue prev',
  doCueNext: 'Cue next',
  doSetlistGo: 'Setlist GO',
  doPanic: 'PANIC',
  doStopAll: 'Stop all',
  doMacro: 'Macro',
  doGesture: 'Gesture',
  doSpatial: 'Spatial',
  doAttention: 'Attention',
  doSoundcheck: 'Soundcheck',
};
export function formatLogLabel(name: string): string {
  if (LOG_LABELS[name]) return LOG_LABELS[name];
  const m = /^do([A-Z].+)$/.exec(name);
  return m ? m[1] : name;
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
