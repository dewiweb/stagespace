/// Score — sync du transport timeline + hot-swap de l'édition live.
/// Monté dans la fenêtre principale UNIQUEMENT (règle show-control :
/// la détachée n'exécute pas les actions show).
///
/// Deux canaux :
/// - `score-timeline` (backend → UI) : transitions de transport
///   (play/stop/seek/wrap) + resync au mount (le backend peut jouer
///   alors que la webview a rechargé).
/// - souscription au doc (UI → backend) : toute édition de la
///   partition PENDANT la lecture débouche en `score_timeline_update`
///   débouncée — hot-swap avec survie des clips inchangés.
import { useEffect } from 'react';
import { safeInvoke, safeListen } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';
import { useScoreStore } from '../store/useScoreStore';
import { useGraphStore } from '../store/useGraphStore';
import { doView } from '../utils/liveActions';
import { doSoundcheck } from '../utils/liveActionsSpatial';
import { doSolo, doUnsolo } from '../utils/liveActionsSlots';
import { doCueArm, doCueGo } from '../utils/liveActionsTransport';

interface ScoreTimelineStateEvent {
  playing: boolean;
  cursor_ms: number;
  loop_start_ms?: number;
  loop_end_ms?: number;
}

/// Délai de débounce du hot-swap — assez long pour absorber un drag
/// de clip, assez court pour que l'édition live soit entendue.
const HOT_SWAP_DEBOUNCE_MS = 600;

export function useScoreTape() {
  useEffect(() => {
    let unlistenTl: (() => void) | undefined;
    let unlistenNack: (() => void) | undefined;
    let unlistenLa: (() => void) | undefined;
    let hotTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const setup = async () => {
      try {
        // Transitions du transport timeline (play→end, stop, seek)
        // poussées par le backend ; le curseur continu est animé par la vue.
        const v = await safeListen<ScoreTimelineStateEvent>('score-timeline', (event) => {
          const p = event.payload;
          useScoreStore.getState()._setTransport(p.playing, p.cursor_ms, p.loop_start_ms, p.loop_end_ms);
        });
        // Barrière skippée (cue refusée par le CAS anti-recall, spawn
        // impossible…) — une cue manquée en show doit être visible.
        const n = await safeListen<{ clip_id: string; reason: string }>('score-nack', (event) => {
          toast.warning(`Score : clip ${event.payload.clip_id} ignoré — ${event.payload.reason}`);
        });
        // Actions live — clips `soundcheck`/`solo`/`unsolo`/`view`/
        // `cueArm`/`cueGo` : le score « appuie sur le bouton » de
        // l'opérateur, même dispatch que le show-control OSC.
        const la = await safeListen<{ name: string; arg: string | null }>('score-live-action', (event) => {
          const { name, arg } = event.payload;
          switch (name) {
            case 'soundcheck': doSoundcheck(arg ?? 'start'); break;
            case 'solo': if (arg != null) doSolo(Number(arg), 'score'); break;
            case 'unsolo': doUnsolo('score'); break;
            case 'view': if (arg != null) doView(arg, 'score'); break;
            case 'cueArm': if (arg != null) doCueArm(arg, 'score'); break;
            case 'cueGo': doCueGo('score'); break;
            default: toast.warning(`Score : action live inconnue « ${name} »`);
          }
        });
        if (cancelled) { v(); n(); la(); }
        else { unlistenTl = v; unlistenNack = n; unlistenLa = la; }
        // Resync après (re)mount — le backend peut être encore en
        // lecture alors que le webview a rechargé (état transport
        // frontend reparti à zéro). On re-prend l'état réel.
        const st = await safeInvoke<ScoreTimelineStateEvent>('score_timeline_state');
        if (!cancelled && st) {
          useScoreStore.getState()._setTransport(st.playing, st.cursor_ms, st.loop_start_ms, st.loop_end_ms);
        }
      } catch {
        // Pas de backend (Vite seul) — silence.
      }
    };
    void setup();
    // Édition live : toute mutation de la partition pendant la lecture
    // est poussée au backend en hot-swap (survie des clips inchangés).
    // La loop region est exclue — `score_timeline_set_loop` est déjà
    // live-safe côté backend (relu en continu par le scheduler).
    const unsubDoc = useScoreStore.subscribe((s, p) => {
      if (!s.playing) return;
      if (
        s.clips === p.clips &&
        s.laneStates === p.laneStates &&
        s.globalFxCurves === p.globalFxCurves &&
        s.modulationCurves === p.modulationCurves &&
        s.objectCurves === p.objectCurves &&
        s.spatialFxCurves === p.spatialFxCurves &&
        s.durationMs === p.durationMs
      ) return;
      clearTimeout(hotTimer);
      hotTimer = setTimeout(() => {
        void useScoreStore.getState()._hotSwap();
      }, HOT_SWAP_DEBOUNCE_MS);
    });
    // Édition de slots pendant la lecture (Atelier/Jeu) — PAS de
    // hot-swap (un move score en cours ne doit pas être tué par une
    // édition qui ne vise pas la partition). On marque les slots
    // touchés : les clips qui les référencent affichent leurs params
    // « en attente » jusqu'au prochain play/hot-swap.
    const unsubSlots = useGraphStore.subscribe((s, p) => {
      if (!useScoreStore.getState().playing || s.moveSlots === p.moveSlots) return;
      const prev = new Map(p.moveSlots.map((sl) => [sl.id, sl]));
      const changed = s.moveSlots.filter((sl) => prev.get(sl.id) !== sl).map((sl) => sl.id);
      if (changed.length) useScoreStore.getState().markSlotsPending(changed);
    });
    return () => {
      cancelled = true;
      clearTimeout(hotTimer);
      unsubDoc();
      unsubSlots();
      unlistenTl?.();
      unlistenNack?.();
      unlistenLa?.();
    };
  }, []);
}
