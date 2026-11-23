/// Sécurité de session — dirty tracking par subscription sur les clés
/// "document" des stores, garde à la fermeture fenêtre, et file
/// d'actions en attente pour la modale "unsaved changes".
///
/// Le tracking est volontairement par LISTE BLANCHE de clés : le show
/// .hfg contient slots/cues/graphes/zones/macros/config, pas le runtime
/// (movements, positions émises, sélections). Une mutation runtime ne
/// doit JAMAIS salir le document.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useGraphStore } from '../store/useGraphStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { useScoreStore } from '../store/useScoreStore';
import { useSessionStore } from '../store/useSessionStore';
import { checkTauri } from './tauri';
import { feLog } from './tauri';

// ── Clés document — miroir de buildShowEnvelope (persistenceSlice) ──
// Exclus délibérément : editingSlotId, currentSetlistIndex,
// selectedTrackIds (sélection/vue sérialisée dans l'enveloppe mais pas
// une "édition"), et tout le runtime (movements, positions, objectStates).
const GRAPH_DOC_KEYS = [
  'nodes', 'edges', 'moveSlots', 'setlistOrder', 'macros',
  'oscAddress', 'oscPort', 'oscProfile', 'oscInPort',
  'zones', 'modulations', 'objectChannels', 'kinematicSmoothing',
  'holProject', 'manualOscIds', 'manualPositions',
] as const;

type AnyStore = { subscribe: (fn: (s: unknown, p: unknown) => void) => () => void };

function watchKeys(
  store: AnyStore,
  keys: readonly string[],
  mark: () => void,
): () => void {
  return store.subscribe((state, prev) => {
    const s = state as Record<string, unknown>;
    const p = prev as Record<string, unknown>;
    for (const k of keys) {
      if (s[k] !== p[k]) { mark(); return; }
    }
  });
}

/// Abonne les stores document → markDirty au premier changement.
/// À appeler une fois au montage App. Le markClean après load/save
/// écrase les marks déclenchés par le load lui-même.
export function initDirtyTracking(): () => void {
  const mark = () => useSessionStore.getState().markDirty();
  const subs = [
    watchKeys(useGraphStore as unknown as AnyStore, GRAPH_DOC_KEYS, mark),
    watchKeys(useGlobalGraphStore as unknown as AnyStore, ['nodes', 'edges'], mark),
    watchKeys(useSignalGraphStore as unknown as AnyStore, ['nodes', 'edges'], mark),
    watchKeys(useCuelistStore as unknown as AnyStore, ['cues', 'tcChaseEnabled'], mark),
    watchKeys(useScoreStore as unknown as AnyStore, ['laneStates', 'clips', 'durationMs', 'loopStartMs', 'loopEndMs', 'globalFxCurves', 'modulationCurves', 'objectCurves', 'spatialFxCurves'], mark),
  ];
  return () => subs.forEach((u) => u());
}

// ── Action en attente de confirmation "unsaved" ──
// Un callback ne peut pas vivre dans le store (non sérialisable) —
// module state, la modale lit le label et exécute.

let pending: { label: string; run: () => void } | null = null;
const pendingListeners = new Set<() => void>();

export function setPendingUnsavedAction(label: string, run: () => void): void {
  pending = { label, run };
  pendingListeners.forEach((l) => l());
}
export function getPendingUnsavedAction() { return pending; }
export function clearPendingUnsavedAction(): void {
  pending = null;
  pendingListeners.forEach((l) => l());
}
export function subscribePendingUnsaved(l: () => void): () => void {
  pendingListeners.add(l);
  return () => pendingListeners.delete(l);
}

/// Garde dirty — exécute `run` directement si le document est clean,
/// sinon arme la modale unsaved (Save first / Discard / Cancel).
export function guardDirty(label: string, run: () => void): void {
  if (!useSessionStore.getState().dirty) { run(); return; }
  setPendingUnsavedAction(label, run);
}

/// Garde à la fermeture fenêtre — desktop Tauri : onCloseRequested
/// empêche la fermeture si dirty (modale). Remote navigateur :
/// beforeunload natif. No-op hors fenêtre tauri.
///
/// `closeApproved` est au niveau MODULE, pas par listener : StrictMode
/// (et HMR) peut laisser plusieurs listeners enregistrés — un flag par
/// closure serait consommé par le premier et les autres reverraient un
/// doc re-sali entre markClean et l'event (poll/sync de clés document).
/// Un seul tir : une fois Discard armé, TOUS les listeners passent.
/// Réarmé en .catch si close() est rejeté — la garde revit.
let closeApproved = false;

export function initWindowCloseGuard(): () => void {
  // beforeunload : contexte NAVIGATEUR uniquement (remote bridge). Dans
  // le webview Tauri il bloquerait un close() déjà approuvé — le doc se
  // re-salit en continu (poll manualPositions → nouvelle référence →
  // markDirty) entre le markClean et l'unload, et preventDefault ici
  // annule la fermeture native SANS repasser par onCloseRequested.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (useSessionStore.getState().dirty) e.preventDefault();
  };
  const isTauri = checkTauri();
  if (!isTauri) window.addEventListener('beforeunload', onBeforeUnload);

  let unlisten: (() => void) | undefined;
  let disposed = false;
  if (isTauri) {
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        feLog(
          `[quit] CloseRequested fired: closeApproved=${closeApproved} dirty=${useSessionStore.getState().dirty}`,
        );
        if (closeApproved) return;
        if (!useSessionStore.getState().dirty) return;
        event.preventDefault();
        feLog(`[quit] prevented, arming modal`);
        setPendingUnsavedAction('Quit', () => {
          // close() et non destroy() : allow-destroy n'est pas dans les
          // capabilities (IPC refusé, promise rejetée en silence). Le
          // markClean persiste dirty=false pour le recovery au boot.
          closeApproved = true;
          useSessionStore.getState().markClean();
          feLog(`[quit] discard: approved, closing`);
          void getCurrentWindow()
            .close()
            .then(() => feLog(`[quit] close() resolved`))
            // .catch loggé — un IPC refusé (permission) ne doit plus
            // jamais échouer en silence comme allow-destroy l'a fait.
            .catch((e) => {
              closeApproved = false;
              feLog(`[quit] close() rejected: ${e}`);
            });
        });
      })
      .then((u) => {
        // Le cleanup StrictMode peut courir AVANT la résolution —
        // désabonner dès que l'enregistrement aboutit sinon le listener
        // fuit et subsiste en doublon du listener frais.
        if (disposed) u();
        else unlisten = u;
      });
  }
  return () => {
    disposed = true;
    window.removeEventListener('beforeunload', onBeforeUnload);
    unlisten?.();
  };
}

// ── Autosave ──
// Toutes les 60s, si dirty → écriture silencieuse de l'enveloppe show
// dans <appLocalData>/autosave.hfg. Backup disque externe au
// localStorage (qui survit déjà au reload — l'autosave couvre la perte
// du profil webview et sert de dernier recours importable à la main).

const AUTOSAVE_INTERVAL_MS = 60_000;

export function initAutosave(): () => void {
  if (!checkTauri()) return () => {};
  let lastWritten = 0;
  const timer = window.setInterval(() => {
    const s = useSessionStore.getState();
    if (!s.dirty || Date.now() - lastWritten < AUTOSAVE_INTERVAL_MS / 2) return;
    void (async () => {
      try {
        const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
        const path = await join(await appLocalDataDir(), 'autosave.hfg');
        // silent : le backup n'est ni le chemin courant ni un recent,
        // et le document reste dirty (il n'est pas sauvé "pour de vrai").
        await useGraphStore.getState().saveGraphToFile(path, { silent: true });
        lastWritten = Date.now();
      } catch (e) {
        console.error('[autosave] failed:', e);
      }
    })();
  }, AUTOSAVE_INTERVAL_MS);
  return () => window.clearInterval(timer);
}
