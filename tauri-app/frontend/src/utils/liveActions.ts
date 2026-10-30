/// Actions live partagées — source unique pour les raccourcis clavier
/// (useLiveShortcuts) et les commandes OSC `/stagespace/*` (useShowControl).
/// Toute action manuelle annule d'abord les timers pre-wait/follow pendus.
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { toast } from './toast-helpers';
import { safeInvoke as invoke } from './tauri';

/// GO setlist (= Enter) — crossfade vers le prochain move.
export function doGo() {
  useCuelistStore.getState().cancelPendingTimers();
  const gs = useGraphStore.getState();
  gs.goToNextMove().then((res: { ok: boolean; message: string }) => {
    if (!res.ok) toast.warning(res.message);
  });
}

/// Cue suivante (= Shift+Enter).
export function doCueNext() {
  useCuelistStore.getState().cancelPendingTimers();
  if (!useCuelistStore.getState().isRecalling) {
    useCuelistStore.getState().goToNextCue();
  }
}

/// Cue précédente (= Backspace).
export function doCuePrev() {
  useCuelistStore.getState().cancelPendingTimers();
  if (!useCuelistStore.getState().isRecalling) {
    useCuelistStore.getState().goToPreviousCue();
  }
}

/// Recall direct d'une cue par numéro — match sur `cue_number`, sinon
/// index 1-based dans la liste.
export function doCueRecall(n: string) {
  const s = useCuelistStore.getState();
  s.cancelPendingTimers();
  const byNumber = s.cues.find((c) => c.cue_number != null && c.cue_number === n);
  const idx = Number.parseInt(n, 10);
  const byIndex = Number.isFinite(idx) && idx >= 1 && idx <= s.cues.length ? s.cues[idx - 1] : undefined;
  const cue = byNumber ?? byIndex;
  if (!cue) {
    toast.warning(`Cue '${n}' not found`);
    return;
  }
  if (!s.isRecalling) s.recallCue(cue.id);
}

/// Panic (= Esc) — stop all + positions origine.
export function doPanic() {
  useCuelistStore.getState().cancelPendingTimers();
  useGraphStore.getState().panic();
}

/** Park un objet : ses canaux échappent aux recalls de cues. */
export function doPark(obj: number) {
  invoke('park_object', { obj }).catch((e) => toast.error('Park failed: ' + e));
}

export function doUnpark(obj: number) {
  invoke('unpark_object', { obj }).catch((e) => toast.error('Unpark failed: ' + e));
}

/// Stop all moves (même fonction que le bouton UI — deactivate_all).
export function doStop() {
  useCuelistStore.getState().cancelPendingTimers();
  useGraphStore.getState().stopAllMovements();
}
