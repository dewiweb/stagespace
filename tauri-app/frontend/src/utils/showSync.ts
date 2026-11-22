/// Sync du show entre UIs (desktop ↔ navigateurs distants ↔ fenêtres
/// détachées) — le backend sert de relais :
///   mutation locale → push set_show_snapshot (débouncé)
///   → event show-state-changed → les AUTRES clients pull + apply.
/// Bidirectionnel, convergent (last-writer-wins), echo-safe :
/// chaque client ignore ses propres events (clientId) et ne repousse
/// jamais le contenu qu'il vient d'appliquer ou déjà poussé.

import { safeInvoke as invoke, silentCatch } from './tauri';
import {
  SYNC_CLIENT_ID,
  markPushed,
  isDuplicateSyncContent,
  envelopeComparable,
  isApplying,
} from './showSyncState';

const PUSH_DEBOUNCE_MS = 800;
let initialized = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPull = false;

async function pushNow() {
  if (isApplying()) return;
  const { useGraphStore } = await import('../store/useGraphStore');
  const { buildShowEnvelope } = await import('../store/slices/persistenceSlice');
  const envelope = await buildShowEnvelope(useGraphStore.getState());
  const json = envelopeComparable(envelope);
  if (isDuplicateSyncContent(json)) return;
  try {
    await invoke('set_show_snapshot', { clientId: SYNC_CLIENT_ID, envelope });
    markPushed(json);
  } catch (e) {
    console.error('[showSync] push failed:', e);
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushNow(), PUSH_DEBOUNCE_MS);
}

async function pullNow() {
  const { useGraphStore } = await import('../store/useGraphStore');
  const s = useGraphStore.getState();
  if (s.movements.length > 0) {
    // Apply impossible pendant le jeu — retry au retour à l'idle.
    pendingPull = true;
    return;
  }
  pendingPull = false;
  await s.pullShowFromHost({ quiet: true });
}

/// Champs "contenu de show" — un changement de l'un d'eux mérite un push.
/// (movements/positions = runtime, déjà sync via events backend.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentChanged(s: any, p: any): boolean {
  return (
    s.moveSlots !== p.moveSlots ||
    s.nodes !== p.nodes ||
    s.edges !== p.edges ||
    s.setlistOrder !== p.setlistOrder ||
    s.currentSetlistIndex !== p.currentSetlistIndex ||
    s.editingSlotId !== p.editingSlotId ||
    s.macros !== p.macros ||
    s.zones !== p.zones ||
    s.modulations !== p.modulations ||
    s.objectChannels !== p.objectChannels ||
    s.kinematicSmoothing !== p.kinematicSmoothing ||
    s.holProject !== p.holProject ||
    s.manualOscIds !== p.manualOscIds ||
    s.manualPositions !== p.manualPositions ||
    s.oscAddress !== p.oscAddress ||
    s.oscPort !== p.oscPort ||
    s.oscProfile !== p.oscProfile ||
    s.oscInPort !== p.oscInPort
  );
}

export async function initShowSync() {
  if (initialized) return;
  initialized = true;

  const { listen } = await import('@tauri-apps/api/event');
  const { useGraphStore } = await import('../store/useGraphStore');
  const { useCuelistStore } = await import('../store/useCuelistStore');
  const { useGlobalGraphStore } = await import('../store/useGlobalGraphStore');
  const { useSignalGraphStore } = await import('../store/useSignalGraphStore');

  // Un pair a poussé son contenu → pull + apply (ignore son propre écho).
  await listen<{ clientId?: string }>('show-state-changed', (ev) => {
    if (ev.payload?.clientId === SYNC_CLIENT_ID) return;
    pullNow().catch(silentCatch);
  });

  // Mutations locales → push débouncé.
  useGraphStore.subscribe((s, p) => {
    if (contentChanged(s, p)) schedulePush();
  });
  useCuelistStore.subscribe((s, p) => {
    if (s.cues !== p.cues) schedulePush();
  });
  useGlobalGraphStore.subscribe((s, p) => {
    if (s.nodes !== p.nodes || s.edges !== p.edges) schedulePush();
  });
  useSignalGraphStore.subscribe((s, p) => {
    if (s.nodes !== p.nodes || s.edges !== p.edges) schedulePush();
  });

  // Fin du jeu → rejouer un pull bloqué (apply refusé pendant playback).
  useGraphStore.subscribe((s, p) => {
    if (p.movements.length > 0 && s.movements.length === 0 && pendingPull) {
      void pullNow();
    }
  });
}
