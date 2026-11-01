/// Actions live partagées — source unique pour les raccourcis clavier
/// (useLiveShortcuts) et les commandes OSC `/stagespace/*` (useShowControl).
/// Toute action manuelle annule d'abord les timers pre-wait/follow pendus.
import { useGraphStore } from '../store/useGraphStore';

/// Rehearsal capture — bande de commandes horodatée : enregistre ce
/// que le busking fait vraiment, rejoue comme un cue live.
const rehearsalState: {
  recording: boolean;
  t0: number;
  entries: { t: number; name: string; args: number[] }[];
  playTimers: ReturnType<typeof setTimeout>[];
} = { recording: false, t0: 0, entries: [], playTimers: [] };

function rec(name: string, args: number[] = []) {
  if (rehearsalState.recording)
    rehearsalState.entries.push({ t: Date.now() - rehearsalState.t0, name, args });
}

/// Log opérationnel — le point de passage commun GUI + OSC.
/// Les commandes OSC (from présent) sont broadcastées par le backend
/// en 'show-log' à toutes les fenêtres : ne pas doubler ici.
function logAction(name: string, detail?: string) {
  if (detail) return; // couvert par le broadcast backend
  useGraphStore.getState().pushShowLog(name);
}
import { useCuelistStore } from '../store/useCuelistStore';
import { broadcastTimerCancel } from './timerBroadcast';
import { isDetachedWindow } from './safeStorage';
import { emit } from '@tauri-apps/api/event';
import { toast } from './toast-helpers';
import { safeInvoke as invoke, silentCatch } from './tauri';

/// Annule les timers pre_wait/follow ICI ET partout — chaque webview
/// possède ses propres timers (revue H1) : un panic/stop dans une
/// fenêtre détachée doit désarmer ceux de la principale aussi.
function disarmPending() {
  useCuelistStore.getState().cancelPendingTimers();
  broadcastTimerCancel();
}

/// Fenêtre détachée → la commande part sur le fil `conduite:cmd` : la
/// fenêtre PRINCIPALE exécute (propriétaire unique des actions show —
/// indices, isRecalling, slots toujours frais). Une exécution locale
/// dans la détachée utilisait son index cue stale et son store local
/// (revue M5 : mauvaise cue tirée, moves doublés).
function routeDetached(wire: string): boolean {
  if (!isDetachedWindow()) return false;
  void emit('conduite:cmd', wire).catch(() => {});
  return true;
}

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
  if (routeDetached('go')) return;
  logAction('doGo', from);
  if (recallBusy(from)) return;
  disarmPending();
  const gs = useGraphStore.getState();
  gs.goToNextMove().then((res: { ok: boolean; message: string }) => {
    if (!res.ok) toast.warning(res.message);
  });
}

/// Cue suivante (= Shift+Enter).
export function doCueNext(from?: string) {
  if (routeDetached('next')) return;
  logAction('doCueNext', from);
  // Guard avant mutation — une commande nackée ne doit pas annuler les timers.
  if (recallBusy(from)) return;
  disarmPending();
  useCuelistStore.getState().goToNextCue();
}

/// Cue précédente (= Backspace).
export function doCuePrev(from?: string) {
  if (routeDetached('prev')) return;
  logAction('doCuePrev', from);
  if (recallBusy(from)) return;
  disarmPending();
  useCuelistStore.getState().goToPreviousCue();
}

/// Recall direct d'une cue par numéro — match sur `cue_number`, sinon
/// index 1-based dans la liste.
export function doCueRecall(n: string, fadeOverride?: number, from?: string) {
  if (routeDetached(`cue:${n}`)) return;
  logAction('doCueRecall', from);
  const s = useCuelistStore.getState();
  if (recallBusy(from)) return;
  disarmPending();
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

/// Recall par id de cue — utilisé par les cue lists GUI (ConduiteView,
/// CuelistPanel) où la cible est l'objet cue, pas son numéro.
export function doCueRecallById(id: string, fadeOverride?: number, from?: string) {
  if (routeDetached(`recall:${id}`)) return;
  logAction('doCueRecallById', from);
  const s = useCuelistStore.getState();
  if (recallBusy(from)) return;
  if (!s.cues.some((c) => c.id === id)) {
    nack(from, `not-found: cue id '${id}'`);
    return;
  }
  disarmPending();
  void s.recallCue(id, fadeOverride != null ? { fadeOverride } : undefined);
}

/** Arm/disarm OSC — dry-run pilotable depuis la console (set_osc_armed). */
export function doArm(armed: boolean, from?: string) {
  logAction('doArm', from);
  invoke('set_osc_armed', { armed }).catch((e) => toast.error('OSC arm failed: ' + e));
}

/** /stagespace/slot <n> — joue le slot n (index 1-based, busking). */
export function doSlot(n: number, from?: string) {
  if (routeDetached(`slot:${n}`)) return;
  logAction('doSlot', from);
  rec('doSlot', [n]);
  const gs = useGraphStore.getState();
  const slot = gs.moveSlots.find((s) => s.oscIndex === n);
  if (!slot) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  // Un slot tiré pendant un recall serait tué par la désactivation du
  // recall — rejet explicite plutôt qu'un tir orphelin.
  if (recallBusy(from)) return;
  disarmPending();
  void gs.playSlot(slot.id);
}

/** /stagespace/slot/stop <n> — coupe le slot n avec son fade_out. */
export function doSlotStop(n: number, from?: string) {
  if (routeDetached(`slotstop:${n}`)) return;
  logAction('doSlotStop', from);
  rec('doSlotStop', [n]);
  const gs = useGraphStore.getState();
  const slot = gs.moveSlots.find((s) => s.oscIndex === n);
  if (!slot) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  // Un stop pendant un recall peut tuer un move que le recall vient de
  // respawner — même garde que doSlot.
  if (recallBusy(from)) return;
  if (slot.movementId) {
    disarmPending();
    void gs.stopSlotWithFade(slot.id, slot.fadeOut ?? 1);
  }
}

/** /stagespace/solo <n> — coupe les autres slots puis joue n. */
/// Ids des slots à restaurer après le dernier solo (vide = pas de solo actif).
/// Vit dans le slice (soloSavedIds) — pas un module-level caché.
export function getSoloRestoreIds(): string[] {
  return useGraphStore.getState().soloSavedIds;
}

export function doSolo(n: number, from?: string) {
  if (routeDetached(`solo:${n}`)) return;
  logAction('doSolo', from);
  rec('doSolo', [n]);
  const gs = useGraphStore.getState();
  // Un n hors oscIndex = not-found, jamais le slot n-1 (mauvais objet tiré).
  const target = gs.moveSlots.find((s) => s.oscIndex === n);
  if (!target) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  if (recallBusy(from)) return;
  disarmPending();
  // Sauvegarde des autres slots jouants — un solo n'est jamais une
  // fin en soi, l'opérateur voudra souvent revenir au mix d'avant.
  useGraphStore.setState({ soloSavedIds: gs.moveSlots.filter((s) => s.id !== target.id && s.movementId).map((s) => s.id) });
  for (const s of gs.moveSlots) {
    if (s.id !== target.id && s.movementId) void gs.stopSlotWithFade(s.id, s.fadeOut ?? 1);
  }
  void gs.playSlot(target.id);
}

/** /stagespace/unsolo — rejoue les slots stoppés par le dernier solo. */
export function doUnsolo(from?: string) {
  if (routeDetached('unsolo')) return;
  logAction('doUnsolo', from);
  // Un recall vient peut-être de tuer ces moves — rejouer maintenant
  // ressusciterait des slots que la cue voulait morts.
  if (recallBusy(from)) return;
  disarmPending();
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
  disarmPending();
  useGraphStore.getState().panic();
}

/** /stagespace/position <obj> <x> <y> <z> — position manuelle par OSC
 *  (reprise opérateur sans drag 3D). */
export function doSetPosition(obj: number, x: number, y: number, z: number) {
  logAction('doSetPosition');
  rec('doSetPosition', [obj, x, y, z]);
  invoke('set_manual_position', { objectIndex: obj, position: [x, y, z] })
    .catch((e) => toast.error('Set position failed: ' + e));
}

/** /stagespace/position/clear <obj> — retire la position manuelle. */
export function doClearPosition(obj: number) {
  logAction('doClearPosition');
  rec('doClearPosition', [obj]);
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
  // Sauvegarde la position manuelle existante — le ping ne doit jamais
  // détruire une reprise opérateur (C2, vérité backend).
  invoke<[number, number, number] | null>('get_manual_position', { obj }).then((prev) => {
    doSetPosition(obj, 0, -2, 0); // repère front-center
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      if (prev) doSetPosition(obj, prev[0], prev[1], prev[2]);
      else doClearPosition(obj);
      s.pinged = null;
      s.idx += 1;
      if (s.running && s.idx < tracks.length) soundcheckPing(tracks);
      else doSoundcheck('stop');
    }, SOUNDCHECK_PING_MS);
  }).catch(() => {
    // Fallback : comportement historique si le getter échoue.
    doSetPosition(obj, 0, -2, 0);
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      doClearPosition(obj);
      s.pinged = null;
      s.idx += 1;
      if (s.running && s.idx < tracks.length) soundcheckPing(tracks);
      else doSoundcheck('stop');
    }, SOUNDCHECK_PING_MS);
  });
}

export function doSoundcheck(action?: string) {
  logAction('doSoundcheck');
  const s = soundcheckState;
  // doSetPosition attend obj_index (position dans osc_ids), pas le
  // track_id — on itère les indices de la liste, pas les ids.
  const tracks = useGraphStore.getState().manualOscIds.map((_, i) => i);
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

/** /stagespace/throw <obj> <vx> <vy> <vz> — grab & throw : lance l'objet
 *  avec une vélocité initiale, amortissement balistique au repos. */
export function doThrow(obj: number, vx: number, vy: number, vz: number, from?: string) {
  logAction('doThrow', from);
  rec('doThrow', [obj, vx, vy, vz]);
  invoke('throw_object', { obj, vel: [vx, vy, vz] })
    .catch((e) => toast.error('Throw failed: ' + e));
}

/** /stagespace/spatial <k> — dynamique spatiale : compresseur spatial
 *  global (k<1 resserre le champ, k>1 l'étend). Geste live busking. */
export function doSpatial(k: number, from?: string) {
  logAction('doSpatial', from);
  rec('doSpatial', [k]);
  invoke('set_spatial_compression', { k })
    .catch((e) => toast.error('Spatial compression failed: ' + e));
}

/** /stagespace/attention <obj>|clear — fige les autres objets (change
 *  blindness : un seul bouge) / libère la stase. */
export function doAttention(obj: number | null, from?: string) {
  logAction('doAttention', from);
  rec('doAttention', [obj ?? -1]);
  invoke('set_attention', { obj })
    .catch((e) => toast.error('Attention failed: ' + e));
}

/** /stagespace/gesture <name> [strength] — explode/converge/orbit/front
 *  en une commande : vélocité calculée par objet (balistique thrown). */
export function doGesture(name: string, strength: number, from?: string) {
  logAction('doGesture', from);
  invoke('set_gesture', { name, strength })
    .catch((e) => toast.error('Gesture failed: ' + e));
}

/** /stagespace/record <start|stop> · /stagespace/rehearsal <play|clear> —
 *  capture de répétition : enregistre la session busking (commandes
 *  horodatées) et la rejoue comme un cue live. */
const REPLAY: Record<string, (...a: number[]) => void> = {
  doGo: () => doGo(),
  doPanic: () => doPanic(),
  doSlot: (n) => doSlot(n),
  doSlotStop: (n) => doSlotStop(n),
  doSolo: (n) => doSolo(n),
  doUnsolo: () => doUnsolo(),
  doSetPosition: (o, x, y, z) => doSetPosition(o, x, y, z),
  doClearPosition: (o) => doClearPosition(o),
  doThrow: (o, x, y, z) => doThrow(o, x, y, z),
  doSpatial: (k) => doSpatial(k),
  doAttention: (o) => doAttention(o === -1 ? null : o),
  doSetTrackPosition: (t, x, y, z) => doSetTrackPosition(t, x, y, z),
};

export function doRehearsal(action: string, from?: string) {
  logAction('doRehearsal', from);
  const s = rehearsalState;
  switch (action) {
    case 'record':
      s.recording = true;
      s.t0 = Date.now();
      s.entries = [];
      toast.info('Rehearsal REC — capture du busking');
      break;
    case 'stop':
      s.recording = false;
      // Persiste la dernière prise — la partition survit au reload.
      try {
        localStorage.setItem('stagespace:diffusion-score', JSON.stringify(s.entries));
      } catch { /* storage full — non critique */ }
      toast.info(`Rehearsal STOP — ${s.entries.length} commandes capturées`);
      break;
    case 'play': {
      if (s.entries.length === 0) { toast.warning('Rehearsal vide'); return; }
      // Rejoue la bande sur ses timestamps (une chaîne de setTimeout).
      // recording off pendant le replay — sinon la bande s'auto-écrit.
      const wasRecording = s.recording;
      s.recording = false;
      let delay = 0;
      // Une bande déjà en cours doit être arrêtée AVANT d'armer la
      // nouvelle — remplacer playTimers sans clearTimeout perdait les
      // références et la première bande continuait de tirer (revue M7).
      s.playTimers.forEach(clearTimeout);
      // Tous les timers sont trackés — 'clear' doit pouvoir tout annuler
      // (un seul playTimer écrasé = la bande continuait de tirer).
      s.playTimers = s.entries.map((e) => {
        delay = e.t;
        return setTimeout(() => REPLAY[e.name]?.(...e.args), e.t);
      });
      s.playTimers.push(
        setTimeout(() => {
          s.recording = wasRecording;
          toast.info('Rehearsal fini');
        }, delay + 100),
      );
      break;
    }
    case 'clear':
      s.entries = [];
      s.playTimers.forEach(clearTimeout);
      s.playTimers = [];
      break;
    case 'load':
      // Charge la partition persistée (dernier record ou score importé).
      try {
        const raw = localStorage.getItem('stagespace:diffusion-score');
        if (raw) {
          s.entries = JSON.parse(raw);
          toast.info(`Score chargé — ${s.entries.length} commandes`);
        } else {
          toast.warning('Aucun score sauvegardé');
        }
      } catch { toast.error('Score invalide'); }
      break;
  }
}

/** Diffusion score — export/import de la partition (JSON). Le score =
 *  la bande rehearsal sérialisée : capturé OU autorisé, sauvegardé,
 *  joué — la partition acousmatique de la conduite A. */
export function scoreExport() {
  const raw = localStorage.getItem('stagespace:diffusion-score');
  if (!raw) { toast.warning('Aucun score à exporter'); return; }
  const blob = new Blob([raw], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diffusion-score.sscore.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Position stream tape — enregistre les positions émises à ~30Hz et
 *  rejoue le flux pour un bounce/renderer externe (binaural côté
 *  renderer — STAGESPACE ne rend pas l'audio). */
export function doTape(action: 'record' | 'stop' | 'play' | 'export', from?: string) {
  logAction('doTape', from);
  if (action === 'record' || action === 'stop') {
    const on = action === 'record';
    invoke('set_pos_tape_record', { on })
      .then(() => toast.info(on ? 'Tape REC — positions @30Hz' : 'Tape STOP'))
      .catch((e) => toast.error('Tape failed: ' + e));
  } else if (action === 'export') {
    invoke<string>('get_pos_tape').then((json) => {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'position-tape.sstape.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }).catch((e) => toast.error('Tape export failed: ' + e));
  } else {
    invoke<string>('get_pos_tape').then((json) =>
      invoke('play_pos_tape', { json })
    ).then(() => toast.info('Tape PLAY — flux injecté au rythme réel'))
     .catch((e) => toast.error('Tape play failed: ' + e));
  }
}

export function tapeImport(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    invoke('play_pos_tape', { json: reader.result as string })
      .then(() => toast.info('Tape importée — lecture'))
      .catch((e) => toast.error('Tape invalide: ' + e));
  };
  reader.readAsText(file);
}

export function scoreImport(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const entries = JSON.parse(reader.result as string);
      if (!Array.isArray(entries)) throw new Error('not a tape');
      localStorage.setItem('stagespace:diffusion-score', JSON.stringify(entries));
      rehearsalState.entries = entries;
      toast.info(`Score importé — ${entries.length} commandes`);
    } catch {
      toast.error('Score invalide');
    }
  };
  reader.readAsText(file);
}

/** /stagespace/trackpos <track> <x> <y> <z> — position d'origine d'une
 *  track (là où panic renvoie, base Barycenter — .hol par OSC).
 *  Setter unitaire : un set par track ne doit pas effacer les autres
 *  origines (set_track_positions remplace toute la map). */
export function doSetTrackPosition(track: number, x: number, y: number, z: number) {
  logAction('doSetTrackPosition');
  rec('doSetTrackPosition', [track, x, y, z]);
  invoke('set_track_position', { track, position: [x, y, z] })
    .catch((e) => toast.error('Set track position failed: ' + e));
}

/** Park un objet : ses canaux échappent aux recalls de cues. */
export function doPark(obj: number, from?: string) {
  logAction('doPark', from);
  rec('doPark', [obj]);
  invoke('park_object', { obj }).catch((e) => toast.error('Park failed: ' + e));
}

export function doUnpark(obj: number, from?: string) {
  logAction('doUnpark', from);
  rec('doUnpark', [obj]);
  invoke('unpark_object', { obj }).catch((e) => toast.error('Unpark failed: ' + e));
}

/// Stop all moves (même fonction que le bouton UI — deactivate_all).
export function doStop() {
  logAction('doStop');
  disarmPending();
  useGraphStore.getState().stopAllMovements();
}
