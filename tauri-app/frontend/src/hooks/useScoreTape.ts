/// Score tape (S1) — l'horloge backend tire chaque entrée via l'event
/// `score-fire` ; le frontend l'exécute via le même REPLAY map que le
/// replay historique (mêmes fonctions que le busking enregistré).
/// Monté dans la fenêtre principale UNIQUEMENT — `score-fire` est un
/// event global Tauri : une fenêtre détachée qui écouterait doublerait
/// chaque commande (même règle que `show-control`).
import { useEffect } from 'react';
import { safeListen } from '../utils/tauri';
import { fireScoreEntry } from '../utils/liveActionsRehearsal';
import { useScoreStore } from '../store/useScoreStore';

interface ScoreFireEntry {
  t: number;
  name: string;
  args: number[];
}

interface ScoreTimelineStateEvent {
  playing: boolean;
  cursor_ms: number;
  loop_start_ms?: number;
  loop_end_ms?: number;
}

export function useScoreTape() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenTl: (() => void) | undefined;
    let cancelled = false;
    const setup = async () => {
      try {
        const u = await safeListen<ScoreFireEntry>('score-fire', (event) => {
          fireScoreEntry(event.payload.name, event.payload.args ?? []);
        });
        // S2 — transitions du transport timeline (play→end, stop, seek)
        // poussées par le backend ; le curseur continu est animé par la vue.
        const v = await safeListen<ScoreTimelineStateEvent>('score-timeline', (event) => {
          const p = event.payload;
          useScoreStore.getState()._setTransport(p.playing, p.cursor_ms, p.loop_start_ms, p.loop_end_ms);
        });
        if (cancelled) { u(); v(); }
        else { unlisten = u; unlistenTl = v; }
      } catch {
        // Pas de backend (Vite seul) — silence.
      }
    };
    void setup();
    return () => {
      cancelled = true;
      unlisten?.();
      unlistenTl?.();
    };
  }, []);
}
