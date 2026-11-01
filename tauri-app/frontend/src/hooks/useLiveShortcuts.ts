import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../utils/toast-helpers';
import { doGo, doCueNext, doCuePrev } from '../utils/liveActions';
import { isModalOpen, closeTopModal } from '../utils/modalGuard';
import { safeInvoke as invoke } from '../utils/tauri';
import type { PerfStatsResponse } from '../types/generated/PerfStatsResponse';

/// Raccourcis live globaux — montés au niveau App (PAS Toolbar) pour survivre
/// au passage en mode Perform (le Toolbar se démonte ; Esc=panic et Enter=GO
/// doivent rester actifs).
///
/// Space (play/stop selected) · Esc (panic) · Enter (GO setlist — crossfade)
/// Shift+Enter (RECALL cue suivant — kill+respawn) · Backspace (cue précédent)
/// Ctrl+Z / Ctrl+Y ou Ctrl+Shift+Z (undo/redo)
export function useLiveShortcuts() {
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const panic = useGraphStore((s) => s.panic);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // ── Escape : chaîne de priorité explicite ──
      // 1. Un modal/picker est ouvert → Esc le ferme (jamais panic)
      // 2. Dans un champ texte → blur (le prochain Esc paniquera)
      // 3. Un mode d'édition est actif (draw/manipulate/assign) → annule le mode
      // 4. Sinon → PANIC, inconditionnel (ni bouton ni React Flow ne bloquent)
      if (e.key === 'Escape') {
        if (e.defaultPrevented || e.repeat) return;
        if (isModalOpen()) {
          e.preventDefault();
          closeTopModal();
          return;
        }
        if (isTextField) {
          target.blur();
          return;
        }
        e.preventDefault();
        const gs = useGraphStore.getState();
        if (gs.cancelInteractionModes()) return;
        panic();
        return;
      }

      // Ne pas intercepter les autres touches si on tape dans un champ
      // ou qu'un bouton a le focus (Space/Enter = activation native)
      if (isTextField || target.tagName === 'BUTTON') return;
      // Un handler plus spécifique a déjà consommé la touche
      if (e.defaultPrevented) return;
      // `?` toggle l'aide — avant le guard modal pour permettre de fermer
      // le panneau de shortcuts avec la même touche.
      if (e.key === '?' && !e.repeat) {
        e.preventDefault();
        import('../store/useMoveEditorStore').then(({ useMoveEditorStore }) => {
          const s = useMoveEditorStore.getState();
          s.setShortcutsOpen(!s.shortcutsOpen);
        });
        return;
      }
      // Un modal/picker est ouvert → aucun autre raccourci live
      if (isModalOpen()) return;
      // Maintenir la touche ne doit pas spammer GO/play
      if (e.repeat) return;
      // Dans l'éditeur React Flow : Delete/Backspace suppriment des nodes —
      // aucun raccourci live ne doit s'activer depuis le canvas.
      if (target instanceof Element && target.closest('.react-flow')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // GO = avance la SETLIST (crossfade vers le prochain move).
        // Distinct du cue recall (Shift+Enter) : le GO ne tue pas les moves
        // layerés, il fait la transition de scène prévue.
        e.preventDefault();
        doGo();
      } else if (e.key === 'Enter' && e.shiftKey) {
        // RECALL = cue suivant — kill + respawn du snapshot complet.
        // Shift requis : action de scène entière, jamais sur un Enter nu.
        e.preventDefault();
        doCueNext();
      } else if (e.key === 'Backspace') {
        // Previous cue
        e.preventDefault();
        doCuePrev();
      } else if (e.key === ' ') {
        // Space: play/stop the selected (editing) slot
        e.preventDefault();
        const gs = useGraphStore.getState();
        const slotId = gs.editingSlotId as string | null;
        if (!slotId) {
          toast.info('No move selected — click a move first');
          return;
        }
        const slot = gs.moveSlots?.find((s) => s.id === slotId);
        if (!slot) return;
        if (slot.movementId) {
          gs.stopSlot(slotId);
        } else {
          gs.playSlot(slotId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    // Un bouton qui garde le focus après un click capture Space/Enter —
    // Space re-cliquait le bouton (ex: GO) au lieu de jouer le slot.
    const blurButtons = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') {
        (e.target as HTMLElement).blur();
      }
    };
    document.addEventListener('click', blurButtons, true);
    return () => {
      window.removeEventListener('keydown', handler);
      document.removeEventListener('click', blurButtons, true);
    };
  }, [undo, redo, panic]);
}

/// Polling perf stats pendant la lecture + alertes live-safety (merge thread
/// mort = blackout OSC silencieux, taux d'erreur OSC > 5%). Monté au niveau
/// App — ces alertes doivent fonctionner aussi en mode Perform.
export function usePerfStatsPolling() {
  const activeMovements = useGraphStore((s) => s.movements.length);
  const setPerfStats = useGraphStore((s) => s.setPerfStats);

  const oscErrorToastShown = React.useRef(false);
  const mergeDiedToastShown = React.useRef(false);

  React.useEffect(() => {
    if (activeMovements === 0) {
      setPerfStats({
        fps: 0,
        oscRate: 0,
        latencyMs: 0,
        mergeFrameUs: 0,
        mergeLockUs: 0,
        cpuPercent: 0,
        oscErrorRate: 0,
        oscRefusedRate: 0,
        oscSuspended: false,
        isRunning: false,
        threadDied: false,
        mergeFrames: 0,
        droppedPositions: 0,
      });
      oscErrorToastShown.current = false;
      mergeDiedToastShown.current = false;
      return;
    }
    const interval = setInterval(async () => {
      try {
        const stats = await invoke<PerfStatsResponse>('get_perf_stats');
        setPerfStats(stats);
        useGraphStore.getState().refreshObjectStates();
        // Merge thread mort = blackout OSC silencieux (fps affiché = valeur
        // figée, pas un signe de vie). Alerter une fois.
        if (stats.threadDied && !mergeDiedToastShown.current) {
          mergeDiedToastShown.current = true;
          toast.error(
            'CRITICAL: merge thread died — OSC output is stopped. Stop all moves and restart playback (Esc = panic).',
            0,
          );
        }
        // Alerte OSC si taux d'erreur > 5% (une seule fois par session de playback).
        // ECONNREFUSED dominant = personne n'écoute le port cible (pas du packet loss).
        if (stats.oscErrorRate > 0.05 && !oscErrorToastShown.current) {
          oscErrorToastShown.current = true;
          const refusedDominant = stats.oscRefusedRate > stats.oscErrorRate / 2;
          const { oscAddress: host, oscPort: port } = useGraphStore.getState();
          toast.error(
            refusedDominant
              ? `OSC destination unreachable — nothing is listening on ${host}:${port}. Is the spatializer running?`
              : `OSC output failing: ${(stats.oscErrorRate * 100).toFixed(0)}% packet loss. Check network connection to spatializer.`,
            10000,
          );
        }
        if (stats.oscErrorRate < 0.01) {
          oscErrorToastShown.current = false;
        }
      } catch {
        // ignore — le prochain tick retentera
      }
    }, 500);
    return () => clearInterval(interval);
  }, [activeMovements, setPerfStats]);
}
