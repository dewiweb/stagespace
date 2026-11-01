/// Actions live partagées — source unique pour les raccourcis clavier
/// (useLiveShortcuts) et les commandes OSC `/stagespace/*` (useShowControl).
/// Toute action manuelle annule d'abord les timers pre-wait/follow pendus.
import { useGraphStore } from '../store/useGraphStore';

/// Log opérationnel — le point de passage commun GUI + OSC.
/// Toute action live (quel que soit le transport) est tracée ici.
function logAction(name: string, detail?: string) {
  useGraphStore
    .getState()
    .pushShowLog(`${name}${detail ? ` ${detail}` : ''}`);
}
import { useCuelistStore } from '../store/useCuelistStore';
import { toast } from './toast-helpers';
import { safeInvoke as invoke, silentCatch } from './tauri';

/** NACK le contrôleur OSC si la commande vient d'/stagespace/* (from). */
function nack(from: string | undefined, reason: string) {
  if (!from) return;
  invoke('send_show_nack', { addr: from, reason }).catch(silentCatch);
}

/** Garde commune : rejet NACK si un recall est en cours. */
function recallBusy(from?: string): boolean {
  if (useCuelistStore.getState().isRecalling) {
    nack(from, 'busy: recall-in-progress');
    return true;
  }
  return false;
}

/// GO setlist (= Enter) — crossfade vers le prochain move.
export function doGo(from?: string) {
  logAction('doGo', from);
  if (recallBusy(from)) return;
  useCuelistStore.getState().cancelPendingTimers();
  const gs = useGraphStore.getState();
  gs.goToNextMove().then((res: { ok: boolean; message: string }) => {
    if (!res.ok) toast.warning(res.message);
  });
}

/// Cue suivante (= Shift+Enter).
export function doCueNext(from?: string) {
  logAction('doCueNext', from);
  useCuelistStore.getState().cancelPendingTimers();
  if (recallBusy(from)) return;
  useCuelistStore.getState().goToNextCue();
}

/// Cue précédente (= Backspace).
export function doCuePrev(from?: string) {
  logAction('doCuePrev', from);
  useCuelistStore.getState().cancelPendingTimers();
  if (recallBusy(from)) return;
  useCuelistStore.getState().goToPreviousCue();
}

/// Recall direct d'une cue par numéro — match sur `cue_number`, sinon
/// index 1-based dans la liste.
export function doCueRecall(n: string, fadeOverride?: number, from?: string) {
  logAction('doCueRecall');
  const s = useCuelistStore.getState();
  s.cancelPendingTimers();
  if (recallBusy(from)) return;
  const byNumber = s.cues.find((c) => c.cue_number != null && c.cue_number === n);
  const idx = Number.parseInt(n, 10);
  const byIndex = Number.isFinite(idx) && idx >= 1 && idx <= s.cues.length ? s.cues[idx - 1] : undefined;
  const cue = byNumber ?? byIndex;
  if (!cue) {
    nack(from, `not-found: cue '${n}'`);
    toast.warning(`Cue '${n}' not found`);
    return;
  }
  void s.recallCue(cue.id, fadeOverride != null ? { fadeOverride } : undefined);
}

/** Arm/disarm OSC — dry-run pilotable depuis la console (set_osc_armed). */
export function doArm(armed: boolean) {
  logAction('doArm');
  invoke('set_osc_armed', { armed }).catch((e) => toast.error('OSC arm failed: ' + e));
}

/** /stagespace/slot <n> — joue le slot n (index 1-based, busking). */
export function doSlot(n: number, from?: string) {
  logAction('doSlot');
  const gs = useGraphStore.getState();
  const slot = gs.moveSlots.find((s) => s.oscIndex === n) ?? gs.moveSlots[n - 1];
  if (!slot) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  // Un slot tiré pendant un recall serait tué par la désactivation du
  // recall — rejet explicite plutôt qu'un tir orphelin.
  if (recallBusy(from)) return;
  useCuelistStore.getState().cancelPendingTimers();
  void gs.playSlot(slot.id);
}

/** /stagespace/slot/stop <n> — coupe le slot n avec son fade_out. */
export function doSlotStop(n: number, from?: string) {
  logAction('doSlotStop');
  const gs = useGraphStore.getState();
  const slot = gs.moveSlots.find((s) => s.oscIndex === n) ?? gs.moveSlots[n - 1];
  if (!slot) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  // Un stop pendant un recall peut tuer un move que le recall vient de
  // respawner — même garde que doSlot.
  if (recallBusy(from)) return;
  useCuelistStore.getState().cancelPendingTimers();
  if (slot.movementId) void gs.stopSlotWithFade(slot.id, slot.fadeOut ?? 1);
}

/** /stagespace/solo <n> — coupe les autres slots puis joue n. */
/// Ids des slots à restaurer après le dernier solo (vide = pas de solo actif).
/// Vit dans le slice (soloSavedIds) — pas un module-level caché.
export function getSoloRestoreIds(): string[] {
  return useGraphStore.getState().soloSavedIds;
}

export function doSolo(n: number, from?: string) {
  logAction('doSolo');
  const gs = useGraphStore.getState();
  const target = gs.moveSlots.find((s) => s.oscIndex === n) ?? gs.moveSlots[n - 1];
  if (!target) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  if (recallBusy(from)) return;
  useCuelistStore.getState().cancelPendingTimers();
  // Sauvegarde des autres slots jouants — un solo n'est jamais une
  // fin en soi, l'opérateur voudra souvent revenir au mix d'avant.
  useGraphStore.setState({ soloSavedIds: gs.moveSlots.filter((s) => s.id !== target.id && s.movementId).map((s) => s.id) });
  for (const s of gs.moveSlots) {
    if (s.id !== target.id && s.movementId) void gs.stopSlotWithFade(s.id, s.fadeOut ?? 1);
  }
  void gs.playSlot(target.id);
}

/** /stagespace/unsolo — rejoue les slots stoppés par le dernier solo. */
export function doUnsolo() {
  logAction('doUnsolo');
  const gs = useGraphStore.getState();
  const ids = gs.soloSavedIds;
  useGraphStore.setState({ soloSavedIds: [] });
  for (const id of ids) {
    const slot = gs.moveSlots.find((s) => s.id === id);
    if (slot && !slot.movementId) void gs.playSlot(id);
  }
}

/** /stagespace/status — renvoie le feedback cue courant/suivant au demandeur. */
export function doStatus() {
  logAction('doStatus');
  useCuelistStore.getState().sendStatusNow();
}

/// Panic (= Esc) — stop all + positions origine.
export function doPanic() {
  logAction('doPanic');
  useCuelistStore.getState().cancelPendingTimers();
  useGraphStore.getState().panic();
}

/** /stagespace/position <obj> <x> <y> <z> — position manuelle par OSC
 *  (reprise opérateur sans drag 3D). */
export function doSetPosition(obj: number, x: number, y: number, z: number) {
  logAction('doSetPosition');
  invoke('set_manual_position', { objectIndex: obj, position: [x, y, z] })
    .catch((e) => toast.error('Set position failed: ' + e));
}

/** /stagespace/position/clear <obj> — retire la position manuelle. */
export function doClearPosition(obj: number) {
  logAction('doClearPosition');
  invoke('clear_manual_position', { objectIndex: obj }).catch(silentCatch);
}

/** /stagespace/position/clearall — retire toutes les positions manuelles. */
export function doClearAllPositions() {
  logAction('doClearAllPositions');
  invoke('clear_all_manual_positions').catch(silentCatch);
}

/** /stagespace/soundcheck [start|stop|next|prev] — ping séquentiel par
 *  track : position repère (front-center) 1.5 s puis retour à la base.
 *  Identification spatiale en repère — state machine côté frontend,
 *  le canal `position` existant fait le reste. */
const SOUNDCHECK_PING_MS = 1500;
const soundcheckState: { running: boolean; idx: number; pinged: number | null; timer: ReturnType<typeof setTimeout> | null } = {
  running: false,
  idx: 0,
  pinged: null,
  timer: null,
};

function soundcheckPing(tracks: number[]) {
  const s = soundcheckState;
  if (s.idx < 0 || s.idx >= tracks.length) {
    doSoundcheck('stop');
    return;
  }
  const obj = tracks[s.idx];
  s.pinged = obj;
  doSetPosition(obj, 0, -2, 0); // repère front-center
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    doClearPosition(obj);
    s.pinged = null;
    s.idx += 1;
    if (s.running && s.idx < tracks.length) soundcheckPing(tracks);
    else doSoundcheck('stop');
  }, SOUNDCHECK_PING_MS);
}

export function doSoundcheck(action?: string) {
  logAction('doSoundcheck');
  const s = soundcheckState;
  const tracks = useGraphStore.getState().manualOscIds;
  if (action === 'stop') {
    s.running = false;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    // Ne nettoie que le ping courant — jamais les positions manuelles
    // de l'opérateur.
    if (s.pinged != null) doClearPosition(s.pinged);
    s.pinged = null;
    return;
  }
  if (action === 'next' || action === 'prev') {
    s.running = true;
    s.idx = Math.max(0, Math.min(tracks.length - 1, s.idx + (action === 'next' ? 1 : -1)));
    soundcheckPing(tracks);
    return;
  }
  // start (défaut)
  s.running = true;
  s.idx = 0;
  soundcheckPing(tracks);
}

/** /stagespace/trackpos <track> <x> <y> <z> — position d'origine d'une
 *  track (là où panic renvoie, base Barycenter — .hol par OSC).
 *  Setter unitaire : un set par track ne doit pas effacer les autres
 *  origines (set_track_positions remplace toute la map). */
export function doSetTrackPosition(track: number, x: number, y: number, z: number) {
  logAction('doSetTrackPosition');
  invoke('set_track_position', { track, position: [x, y, z] })
    .catch((e) => toast.error('Set track position failed: ' + e));
}

/** Park un objet : ses canaux échappent aux recalls de cues. */
export function doPark(obj: number) {
  logAction('doPark');
  invoke('park_object', { obj }).catch((e) => toast.error('Park failed: ' + e));
}

export function doUnpark(obj: number) {
  logAction('doUnpark');
  invoke('unpark_object', { obj }).catch((e) => toast.error('Unpark failed: ' + e));
}

/// Stop all moves (même fonction que le bouton UI — deactivate_all).
export function doStop() {
  logAction('doStop');
  useCuelistStore.getState().cancelPendingTimers();
  useGraphStore.getState().stopAllMovements();
}
