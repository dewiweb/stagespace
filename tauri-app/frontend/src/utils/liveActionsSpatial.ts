/// Positions & spatial — positions manuelles OSC, soundcheck, throw,
/// compression spatiale, attention, gestes, positions d'origine,
/// park/unpark. Extrait de liveActions.ts.
import { useGraphStore } from '../store/useGraphStore';
import { usePoseStore } from '../store/usePoseStore';
import { toast } from './toast-helpers';
import { safeInvoke as invoke, silentCatch } from './tauri';
import { logAction, rec } from './liveActionsShared';

/** /stagespace/position <obj> <x> <y> <z> — position manuelle par OSC
 *  (reprise opérateur sans drag 3D). */
export function doSetPosition(obj: number, x: number, y: number, z: number) {
  logAction('doSetPosition');
  // Ref capturée en track_id — identité persistante de l'objet, pas
  // l'index éphémère du patch courant.
  const tid = useGraphStore.getState().manualOscIds[obj];
  rec('doSetPosition', [obj, x, y, z], tid !== undefined ? { positions: { [tid]: [x, y, z] } } : undefined);
  invoke('set_manual_position', { objectIndex: obj, position: [x, y, z] })
    .catch((e) => toast.error('Set position failed: ' + e));
}

/** /stagespace/position/clear <obj> — retire la position manuelle. */
export function doClearPosition(obj: number) {
  logAction('doClearPosition');
  const tid = useGraphStore.getState().manualOscIds[obj];
  rec('doClearPosition', [obj], { trackId: tid ?? null });
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
  const tid = useGraphStore.getState().manualOscIds[obj];
  rec('doThrow', [obj, vx, vy, vz], { trackId: tid ?? null, vel: [vx, vy, vz] });
  invoke('throw_object', { obj, vel: [vx, vy, vz] })
    .catch((e) => toast.error('Throw failed: ' + e));
}

/** /stagespace/spatial <k> — dynamique spatiale : compresseur spatial
 *  global (k<1 resserre le champ, k>1 l'étend). Geste live busking. */
export function doSpatial(k: number, from?: string) {
  logAction('doSpatial', from);
  rec('doSpatial', [k], { macro: 'spatial' });
  invoke('set_spatial_compression', { k })
    .catch((e) => toast.error('Spatial compression failed: ' + e));
}

/** /stagespace/attention <obj>|clear — fige les autres objets (change
 *  blindness : un seul bouge) / libère la stase. */
export function doAttention(obj: number | null, from?: string) {
  logAction('doAttention', from);
  const tid = obj === null ? null : (useGraphStore.getState().manualOscIds[obj] ?? null);
  rec('doAttention', [obj ?? -1], { trackId: tid });
  invoke('set_attention', { obj })
    .catch((e) => toast.error('Attention failed: ' + e));
}

/** /stagespace/gesture <name> [strength] — explode/converge/orbit/front
 *  en une commande : vélocité calculée par objet (balistique thrown). */
export function doGesture(name: string, strength: number, from?: string) {
  logAction('doGesture', from);
  rec('doGesture', [strength], { macro: name, strength });
  invoke('set_gesture', { name, strength })
    .catch((e) => toast.error('Gesture failed: ' + e));
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
  const tid = useGraphStore.getState().manualOscIds[obj];
  rec('doPark', [obj], { trackId: tid ?? null });
  invoke('park_object', { obj }).catch((e) => toast.error('Park failed: ' + e));
}

export function doUnpark(obj: number, from?: string) {
  logAction('doUnpark', from);
  const tid = useGraphStore.getState().manualOscIds[obj];
  rec('doUnpark', [obj], { trackId: tid ?? null });
  invoke('unpark_object', { obj }).catch((e) => toast.error('Unpark failed: ' + e));
}

/** /stagespace/pose/capture <name> [track…] — capture les positions live
 *  dans la pose nommée (upsert). tracks vide/absent = toutes connues. */
export function doPoseCapture(name: string, tracks?: number[], from?: string) {
  logAction('doPoseCapture', from);
  void usePoseStore.getState().capturePose(name, tracks);
}

/** /stagespace/pose/snap <name> — rappel instantané : positions manuelles
 *  pour les tracks de la pose (partiel — les autres ne bougent pas). */
export function doPoseSnap(name: string, from?: string) {
  logAction('doPoseSnap', from);
  // Ref d'enregistrement : la tape rehearsal capture les positions
  // résolues (track_id-keyed, même shape que les clips `positions`) —
  // le replay ne dépend pas de l'existence future de la pose.
  const pose = usePoseStore.getState().poses.find((p) => p.name === name);
  if (pose) rec('doPoseSnap', [], { positions: pose.positions });
  void usePoseStore.getState().snapPose(name);
}

/** /stagespace/pose/goto <name> [duration] — rampe animée vers la pose
 *  (oneshot + hold : la cible est tenue exactement, enchaînable). */
export function doPoseGoto(name: string, duration?: number, from?: string) {
  logAction('doPoseGoto', from);
  void usePoseStore.getState().gotoPose(name, duration);
}

/** /stagespace/pose/morph <from> <to> [duration] — morph animé A → B :
 *  départ depuis la pose A (fallback live hors de A), distribution = B. */
export function doPoseMorph(fromPose: string, toPose: string, duration?: number, from?: string) {
  logAction('doPoseMorph', from);
  void usePoseStore.getState().morphPose(fromPose, toPose, duration);
}
