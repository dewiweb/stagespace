/// Listeners backend → store/toasts — extraits de useGraphStore.ts
/// (règle modularisation). Chaque hook s'abonne à un canal Tauri et
/// reflète l'état runtime dans le store ou en toast opérateur.
import React from 'react';
import { safeInvoke as invoke, safeListen as listen } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';
import { isDetachedWindow } from '../utils/safeStorage';
import { useGraphStore } from './useGraphStore';
import type { AudioState } from './slices/audioSlice';

// ── Audio error listener — surface les pannes de capture (micro débranché,
// stream mort) pendant un show. Sans cet écouteur l'event `audio-error` émis
// par le poller Rust tombait dans le vide.
let lastAudioError = '';
let lastAudioErrorAt = 0;
export const useAudioErrorListener = () => {
  React.useEffect(() => {
    const unlisten = listen<string>('audio-error', (event) => {
      const message = typeof event.payload === 'string' ? event.payload : String(event.payload);
      // Dedup : le poller peut renvoyer la même erreur en boucle — un toast
      // identique toutes les 5s max, sinon jamais.
      const now = Date.now();
      if (message === lastAudioError && now - lastAudioErrorAt < 5000) return;
      lastAudioError = message;
      lastAudioErrorAt = now;
      toast.error(`Audio capture failed: ${message}`);
    });
    const unlistenRecovered = listen('audio-recovered', () => {
      lastAudioError = '';
      toast.success('Audio capture recovered');
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
      unlistenRecovered.then((fn) => fn()).catch(() => {});
    };
  }, []);
};

// ── Audio state listener — flux `audio-state-update` (amplitude/BPM/spectre).
// Monté au niveau App, pas dans AudioPanel : le panneau peut être replié,
// masqué ou absent (Perform) alors que des CustomNode AudioSpectrum affichent
// encore le spectre. Le listener vit tant que l'app vit.
export const useAudioStateListener = () => {
  const setAudioState = useGraphStore((s) => s.setAudioState);
  React.useEffect(() => {
    const unlisten = listen<AudioState>('audio-state-update', (event) => {
      setAudioState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setAudioState]);
};

// ── Cue recall listener — surface les respawns échoués d'un recall partiel.
// Le backend continue un recall même si un move échoue (partial recall) —
// sans ce listener l'échec passerait pour un succès complet.
export const useCueRecallListener = () => {
  const refreshMovements = useGraphStore((s) => s.refreshMovements);
  React.useEffect(() => {
    const unlisten = listen<{ cue_id: string; failed_moves: string[] }>(
      'cue-recalled',
      (event) => {
        refreshMovements();
        const failed = event.payload?.failed_moves ?? [];
        if (failed.length > 0) {
          toast.error(
            `Cue recall partial — ${failed.length} move(s) failed to restart (${failed.join(', ')}). Check the spatializer.`,
            0,
          );
        }
      },
    );
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [refreshMovements]);
};

// ── Supervisor listener — events du watchdog backend (audits C5/C7) :
// worker zombie arrêté, merge thread redémarré sans le frontend.
export const useSupervisorListener = () => {
  React.useEffect(() => {
    const unStale = listen<string>('move-stale-killed', (event) => {
      toast.warning(
        `Move "${event.payload}" was stopped — its engine worker froze. Check graph complexity.`,
      );
    });
    const unRestart = listen('merge-restarted', () => {
      toast.warning('Output engine restarted automatically after a crash — playback resumed.');
    });
    const unRestartFailed = listen<string>('merge-restart-failed', (event) => {
      toast.error(
        `Output engine failed to restart — OSC output is DOWN: ${event.payload}`,
        0,
      );
    });
    return () => {
      unStale.then((fn) => fn()).catch(() => {});
      unRestart.then((fn) => fn()).catch(() => {});
      unRestartFailed.then((fn) => fn()).catch(() => {});
    };
  }, []);
};

// ── Global positions listener — écoute l'event global-positions du MergeRuntime ──
// Une seule source de positions (déjà mergées + transformées), au lieu de N events par movement.
export const useMovementPositionsListener = () => {
  const setMovementPositions = useGraphStore((s) => s.setMovementPositions);
  const movements = useGraphStore((s) => s.movements);
  const refreshMovements = useGraphStore((s) => s.refreshMovements);

  // Écouter active-moves-update pour sync la liste des moves (activate/deactivate côté backend)
  React.useEffect(() => {
    const unlisten = listen('active-moves-update', async () => {
      await refreshMovements();
      // Sync les slots après refresh — nettoie les movementIds stale
      useGraphStore.getState().syncSlotMovements();
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [refreshMovements]);

  // Ref partagé pour les effects qui doivent connaître l'état playback sans
  // y souscrire (évite de déclencher les invokes de config pendant le show).
  const movementsCount = useGraphStore((s) => s.movements.length);
  const movementsCountRef = React.useRef(movementsCount);
  movementsCountRef.current = movementsCount;

  // Appliquer la config OSC au backend (au démarrage + à chaque changement)
  const oscAddress = useGraphStore((s) => s.oscAddress);
  const oscPort = useGraphStore((s) => s.oscPort);
  const oscProfile = useGraphStore((s) => s.oscProfile);
  React.useEffect(() => {
    // Fenêtre détachée : jamais de push config — sa config locale est
    // stale (pas de .hol) et écraserait celle de la fenêtre principale.
    if (isDetachedWindow()) return;
    // Pendant le playback la config OSC est lockée backend-side — ne pas
    // invoquer (évite un faux toast d'erreur à chaque transition).
    if (movementsCountRef.current > 0) return;
    // Debounce : la saisie clavier produit un invoke par keystroke sinon.
    const t = setTimeout(() => {
      invoke('set_osc_output', { address: oscAddress, port: oscPort, profile: oscProfile })
        .catch((e: any) => {
          console.error('Failed to set OSC output:', e);
          // Zéro OSC sortant = show silencieux — l'utilisateur DOIT le voir.
          toast.error(`OSC output config failed — no positions will be sent: ${e}`);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [oscAddress, oscPort, oscProfile]);

  // Pousser les osc_ids globaux (manualOscIds ou hol track ids) au backend.
  // CRITICAL: le MergeRuntime utilise cette liste pour mapper track_indices → osc_id
  // lors de l'OSC output. Si cette liste ne correspond pas aux track_indices,
  // les positions ne sont pas envoyées en OSC.
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const holProject = useGraphStore((s) => s.holProject);
  React.useEffect(() => {
    // Fenêtre détachée : manualOscIds=[1..64] par défaut + holProject=null
    // — pousser écraserait le mapping .hol de la fenêtre principale.
    if (isDetachedWindow()) return;
    // Pendant le playback le backend rejette set_global_osc_ids — ne pas
    // invoquer (évitait le toast "OSC track mapping failed" à chaque play).
    // movementsCount dans les deps : quand le dernier move s'arrête, l'effect
    // refire et pousse les ids en attente.
    if (movementsCount > 0) return;
    // Debounce : manualOscIds change à chaque keystroke dans le champ.
    const t = setTimeout(() => {
      // Utiliser les track ids du hol project si disponible, sinon manualOscIds
      const globalIds = holProject?.tracks?.map((t: any) => t.id) ?? manualOscIds;
      invoke('set_global_osc_ids', { oscIds: globalIds })
        .catch((e: any) => {
          console.error('Failed to set global osc ids:', e);
          // Sans mapping track→osc_id, le MergeRuntime n'émet rien — critique.
          toast.error(`OSC track mapping failed — output may be silent: ${e}`);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [manualOscIds, holProject, movementsCount]);

  // Écouter global-positions (un seul event avec toutes les positions mergées)
  React.useEffect(() => {
    // Bind INCONDITIONNEL — le gate `movements.length === 0` bloquait le
    // listener quand la liste frontend était stale-vide : aucune position
    // n'arrivait jamais (radar/3D figés sur le fallback 1.5Hz). L'event
    // n'émet que quand le merge produit — bind libre = pas de travail inutile.
    let ipcFrameCount = 0;
    let ipcLastPerf = performance.now();
    let ipcMaxDelta = 0;
    let ipcLastTime = performance.now();
    const unlisten = listen('global-positions', (event: any) => {
      const now = performance.now();
      const delta = now - ipcLastTime;
      if (delta > ipcMaxDelta) ipcMaxDelta = delta;
      ipcLastTime = now;
      ipcFrameCount++;
      if (now - ipcLastPerf > 2000) {
        const ipcFps = ipcFrameCount / ((now - ipcLastPerf) / 1000);
        const dp = (window as any).__debugPerf;
        if (dp) {
          dp.ipcFps = ipcFps;
          dp.ipcMaxGap = ipcMaxDelta;
        }
        ipcFrameCount = 0;
        ipcMaxDelta = 0;
        ipcLastPerf = now;
      }
      const { positions } = event.payload as {
        time: number;
        positions: Array<[number, [number, number, number]]>;
      };
      // Les positions sont déjà mergées + transformées par le MergeRuntime.
      // On les stocke sous un pseudo-movement-id "global" pour compat avec le render loop.
      setMovementPositions(
        'global',
        positions.map(([index, [x, y, z]]) => ({ index, x, y, z })),
      );
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [movements.length, setMovementPositions]);
};
