/// Transport live — setlist GO, navigation/rappel de cues, panic, stop.
/// Extrait de liveActions.ts (règle modularisation) — comportement inchangé.
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { toast } from './toast-helpers';
import {
  logAction, disarmPending, routeDetached, nack, recallBusy,
} from './liveActionsShared';

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

/** /stagespace/cue/arm <n> — arme une cue SANS la tirer (modèle console :
 *  navigation pure — click unique dans la cue list fait la même chose). */
export function doCueArm(n: string, from?: string) {
  if (routeDetached(`cuearm:${n}`)) return;
  logAction('doCueArm', from);
  const s = useCuelistStore.getState();
  const cue = s.cues.find((c) => c.cue_number === n) ?? s.cues[Number(n) - 1];
  if (!cue) {
    nack(from, `not-found: cue ${n}`);
    return;
  }
  s.armCue(s.armedCueId === cue.id ? null : cue.id);
}

/** /stagespace/cue/go — tire la cue armée (ou la suivante si rien d'armé). */
export function doCueGo(from?: string) {
  if (routeDetached('cuego')) return;
  logAction('doCueGo', from);
  const armed = useCuelistStore.getState().armedCueId;
  if (armed) doCueRecallById(armed, undefined, from);
  else doCueNext(from);
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

/// Stop all moves (même fonction que le bouton UI — deactivate_all).
export function doStop() {
  logAction('doStop');
  disarmPending();
  useGraphStore.getState().stopAllMovements();
}
