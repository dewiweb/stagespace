/// Score tape (S1) — l'horloge backend tire chaque entrée via l'event
/// `score-fire` ; le frontend l'exécute via le même REPLAY map que le
/// replay historique (mêmes fonctions que le busking enregistré).
/// Monté dans la fenêtre principale UNIQUEMENT — `score-fire` est un
/// event global Tauri : une fenêtre détachée qui écouterait doublerait
/// chaque commande (même règle que `show-control`).
import { useEffect } from 'react';
import { safeListen } from '../utils/tauri';
import { fireScoreEntry } from '../utils/liveActionsRehearsal';

interface ScoreFireEntry {
  t: number;
  name: string;
  args: number[];
}

export function useScoreTape() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const setup = async () => {
      try {
        const u = await safeListen<ScoreFireEntry>('score-fire', (event) => {
          fireScoreEntry(event.payload.name, event.payload.args ?? []);
        });
        if (cancelled) u();
        else unlisten = u;
      } catch {
        // Pas de backend (Vite seul) — silence.
      }
    };
    void setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
