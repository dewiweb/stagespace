import { create } from 'zustand';
import { safeInvoke as invoke } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';
import { safeSetItem, safeParseStoredJson } from '../utils/safeStorage';
import type { Cue } from '../types/generated/Cue';
import type { StoreCueRequest } from '../types/generated/StoreCueRequest';
import { chase, type ChaseCue } from '../utils/timecodeChase';

/// Cue complet tel que sérialisé par le backend — type généré (ts-rs).
/// Inclut `moves`/`object_channels` capturés côté Rust au store.
export type CueData = Cue;

interface PendingCueAction {
  cueId: string;
  /// 'pre_wait' = attente avant recall ; 'follow' = auto-GO suivant.
  kind: 'pre_wait' | 'follow';
  /// Timestamp ms de l'exécution prévue (compte à rebours UI).
  deadline: number;
}

interface CuelistState {
  cues: CueData[];
  currentCueIndex: number;
  isRecalling: boolean;
  /// Timer pendu (pre-wait ou follow) — un seul à la fois, annulé par
  /// toute action manuelle/TC/panic.
  pending: PendingCueAction | null;
  /// Cue armée — modèle console : arm/nav ne tirent JAMAIS, GO tire
  /// l'armée (ou la suivante si null). Store-level : le fil OSC
  /// (/stagespace/cue/arm|go) et les fenêtres détachées y accèdent.
  armedCueId: string | null;
  armCue: (id: string | null) => void;
  /// Chasse timecode activée (persistée).
  tcChaseEnabled: boolean;
  /// Dernier timecode reçu (secondes) + horodatage pour "TC lost".
  lastTimecode: number | null;
  lastTimecodeAt: number;

  loadFromStorage: () => void;
  saveToStorage: () => void;
  storeCue: (cue: StoreCueRequest) => Promise<CueData>;
  recallCue: (cueId: string, opts?: { skipPreWait?: boolean; timeOffset?: number; fadeOverride?: number }) => Promise<void>;
  deleteCue: (cueId: string) => void;
  /// Met à jour un cue en place (fade_duration éditable post-store) —
  /// la cuelist vit côté frontend (localStorage), le backend n'en garde
  /// pas de copie.
  updateCue: (cue: CueData) => void;
  moveCue: (cueId: string, dir: -1 | 1) => void;
  goToNextCue: () => Promise<void>;
  goToPreviousCue: () => Promise<void>;
  /// Renvoie le feedback cue courant/suivant aux contrôleurs OSC
  /// (réponse à /stagespace/status).
  sendStatusNow: () => void;
  /// Annule tout timer pre-wait/follow pendu — appelé par les actions
  /// manuelles (GO/next/prev/recall/panic/stop) et avant une cue TC.
  cancelPendingTimers: () => void;
  /// Entrée d'un message timecode (déjà en secondes) — chasse + recall.
  handleTimecode: (tc: number) => void;
  setTcChaseEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'stagespace-cuelist';
const TC_CHASE_KEY = 'stagespace-cuelist-tc-chase';
/// Timer JS du pending — hors state (mutable, pas sérialisable).
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingTimer() {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

/// Feedback OSC show-control — cue courante/prochaine vers les
/// contrôleurs `/stagespace/*` (échoue silencieusement sans backend).
async function sendFeedback(cues: CueData[], currentIndex: number) {
  try {
    const cur = currentIndex >= 0 ? cues[currentIndex] : null;
    const nxt = currentIndex + 1 < cues.length ? cues[currentIndex + 1] : null;
    await invoke('send_show_feedback', {
      current: cur ? { number: cur.cue_number ?? '', name: cur.name } : null,
      next: nxt ? { number: nxt.cue_number ?? '', name: nxt.name } : null,
    });
  } catch {
    // Pas de backend (Vite seul) — silence.
  }
}

function loadFromStorage(): CueData[] {
  return safeParseStoredJson<CueData[]>(STORAGE_KEY, []);
}

function saveToStorage(cues: CueData[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(cues));
}

export const useCuelistStore = create<CuelistState>((set, get) => ({
  cues: loadFromStorage(),
  currentCueIndex: -1,
  isRecalling: false,
  armedCueId: null,
  armCue: (id) => set({ armedCueId: id }),
  pending: null,
  tcChaseEnabled: safeParseStoredJson<boolean>(TC_CHASE_KEY, false),
  lastTimecode: null,
  lastTimecodeAt: 0,

  loadFromStorage: () => {
    set({ cues: loadFromStorage() });
  },

  saveToStorage: () => {
    saveToStorage(get().cues);
  },

  storeCue: async (cueData) => {
    try {
      // Appeler le backend pour créer le cue (valide la structure)
      const cue = await invoke<CueData>('store_cue', { request: cueData });
      const cues = [...get().cues, cue];
      set({ cues });
      saveToStorage(cues);
      return cue;
    } catch (e) {
      console.error('[storeCue] Failed:', e);
      toast.error('Failed to store cue: ' + e);
      throw e;
    }
  },

  recallCue: async (cueId: string, opts) => {
    if (get().isRecalling) return; // empêche les recalls concurrents
    const cue = get().cues.find((c) => c.id === cueId);
    if (!cue) return;
    // Toute nouvelle recall annule les timers pendus (pre_wait/follow) —
    // sinon un timer armé pour une autre cue tirerait au milieu de ce
    // recall, même si la nouvelle cue n'a pas de pre_wait.
    get().cancelPendingTimers();
    // Pre-wait : le recall part après N s (compte à rebours sur la cue).
    // Toute nouvelle action annule ce timer (cancelPendingTimers).
    if (!opts?.skipPreWait && cue.pre_wait != null && cue.pre_wait > 0) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        set({ pending: null });
        // Le recall interne skippe le pre_wait (déjà consommé).
        void get().recallCue(cueId, { skipPreWait: true });
      }, cue.pre_wait * 1000);
      set({ pending: { cueId, kind: 'pre_wait', deadline: Date.now() + cue.pre_wait * 1000 } });
      return;
    }
    set({ isRecalling: true });
    try {
      const cueOut = opts?.fadeOverride != null ? { ...cue, fade_duration: opts.fadeOverride } : cue;
      await invoke('recall_cue', { cue: cueOut, timeOffset: opts?.timeOffset ?? null });
      const idx = get().cues.findIndex((c) => c.id === cueId);
      set({ currentCueIndex: idx });
      sendFeedback(get().cues, idx);
      // Follow : auto-GO de la cue suivante N s après l'exécution.
      if (cue.follow != null && cue.follow > 0 && idx + 1 < get().cues.length) {
        const nextCue = get().cues[idx + 1];
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          set({ pending: null });
          get().recallCue(nextCue.id);
        }, cue.follow * 1000);
        set({ pending: { cueId: nextCue.id, kind: 'follow', deadline: Date.now() + cue.follow * 1000 } });
      } else if (cue.follow != null && cue.follow > 0) {
        toast.warning(`Cue "${cue.name}": follow has no next cue — it will never fire`);
      }
      // Cue legacy (pré-Phase5) : `moves` est vide, le backend a désactivé
      // les moves mais ne peut pas respawner — le graphe vit dans cue.graph.
      // Le restaurer dans l'éditeur et le rejouer, sinon le show reste muet.
      if ((!cue.moves || cue.moves.length === 0) && cue.graph) {
        const g = cue.graph as { nodes?: unknown[]; edges?: unknown[] };
        if (Array.isArray(g.nodes) && g.nodes.length > 0) {
          const { useGraphStore } = await import('./useGraphStore');
          const gs = useGraphStore.getState();
          gs.setNodes(g.nodes as never);
          gs.setEdges(Array.isArray(g.edges) ? (g.edges as never) : []);
          gs.autoSaveToEditingSlot();
          const id = await gs.playMovement(cue.name, cue.track_indices ?? [], false, '', 0, '');
          if (id) {
            toast.info(`Legacy cue "${cue.name}" — graph restored and replayed`);
          } else {
            toast.error(`Legacy cue "${cue.name}" — graph restored but replay failed`, 0);
          }
        }
      }
    } catch (e) {
      console.error('[recallCue] Failed:', e);
      toast.error('Cue recall failed: ' + e);
    } finally {
      set({ isRecalling: false });
    }
  },

  deleteCue: (cueId: string) => {
    const { cues, currentCueIndex } = get();
    const currentCue = currentCueIndex >= 0 ? cues[currentCueIndex] : null;
    const filtered = cues.filter((c) => c.id !== cueId);
    // Ne JAMAIS reset à -1 : le prochain GO sauterait au cue 1 au lieu de
    // suivre la position courante. Si le cue courant est supprimé, se placer
    // juste avant le cue suivant pour que GO le rappelle.
    let newIndex = -1;
    if (currentCue) {
      newIndex = currentCue.id === cueId
        ? Math.min(currentCueIndex, filtered.length) - 1
        : filtered.findIndex((c) => c.id === currentCue.id);
    }
    set({ cues: filtered, currentCueIndex: newIndex });
    saveToStorage(filtered);
  },

  updateCue: (cue) => {
    const cues = get().cues.map((c) => (c.id === cue.id ? cue : c));
    set({ cues });
    saveToStorage(cues);
  },

  /// Réordonne la cue list — le numéro d'ordre (index) EST la structure
  /// du show ; cue_number reste le label OSC. currentCueIndex suit la
  /// cue courante par id, pas par position (l'index décale sinon).
  moveCue: (cueId: string, dir: -1 | 1) => {
    const { cues, currentCueIndex } = get();
    const i = cues.findIndex((c) => c.id === cueId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cues.length) return;
    const reordered = [...cues];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const current = currentCueIndex >= 0 ? cues[currentCueIndex] : null;
    set({
      cues: reordered,
      currentCueIndex: current ? reordered.findIndex((c) => c.id === current.id) : -1,
    });
    saveToStorage(reordered);
  },

  sendStatusNow: () => {
    sendFeedback(get().cues, get().currentCueIndex);
  },

  cancelPendingTimers: () => {
    clearPendingTimer();
    if (get().pending !== null) set({ pending: null });
  },

  setTcChaseEnabled: (enabled: boolean) => {
    set({ tcChaseEnabled: enabled });
    safeSetItem(TC_CHASE_KEY, JSON.stringify(enabled));
  },

  handleTimecode: (tc: number) => {
    if (!Number.isFinite(tc)) return;
    const prev = get().lastTimecode;
    set({ lastTimecode: tc, lastTimecodeAt: Date.now() });
    if (!get().tcChaseEnabled) return;
    const cues = get().cues as ChaseCue[];
    const currentId =
      get().currentCueIndex >= 0 ? get().cues[get().currentCueIndex].id : null;
    // Une cue TC ignore pre_wait (le timecode EST le schedule) — le
    // follow s'applique quand même (annulé par la prochaine cue TC).
    const result = chase(prev, tc, cues, currentId);
    if (result.fire) {
      const cue = get().cues.find((c) => c.id === result.fire);
      // cancelPendingTimers DANS le guard — un tick TC pendant un recall
      // ne doit pas désarmer un pre_wait/follow pending.
      if (cue && !get().isRecalling) {
        get().cancelPendingTimers();
        void import('../utils/timerBroadcast').then((m) => m.broadcastTimerCancel());
        // Le timecode EST le schedule : pre_wait ignoré pour les cues TC,
        // et la trajectoire reprend à tc - cue.timecode (seek, pas t=0).
        void get().recallCue(cue.id, {
          skipPreWait: true,
          timeOffset: cue.timecode != null ? tc - cue.timecode : undefined,
        });
      }
    }
  },

  goToNextCue: async () => {
    const { cues, currentCueIndex } = get();
    if (currentCueIndex + 1 >= cues.length) {
      toast.info(cues.length === 0 ? 'No cues in list' : 'End of cue list');
      return;
    }
    const nextCue = cues[currentCueIndex + 1];
    await get().recallCue(nextCue.id);
  },

  goToPreviousCue: async () => {
    const { cues, currentCueIndex } = get();
    if (currentCueIndex <= 0) {
      toast.info(cues.length === 0 ? 'No cues in list' : 'Already at first cue');
      return;
    }
    const prevCue = cues[currentCueIndex - 1];
    await get().recallCue(prevCue.id);
  },
}));
