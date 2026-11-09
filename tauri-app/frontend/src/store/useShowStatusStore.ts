import { create } from 'zustand';
import { safeInvoke, safeListen, registerBackendHealth, silentCatch } from '../utils/tauri';

/// État de santé show — UN poll unique pour `parked` / `consoleAge` /
/// `armed`, partagé par PerformView, ConduitePage et StatusBar au lieu
/// d'un setInterval par composant. `armed` est aussi event-driven via
/// `osc-armed-changed` (le poll rattrape l'état initial).
interface ShowStatusState {
  parked: number[];
  /// Âge en secondes de la dernière commande show-control OSC — null si aucune.
  consoleAge: number | null;
  armed: boolean;
  /// Un `silentCatch` a avalé un échec IPC — le backend est probablement
  /// mort. Indicateur StatusBar ; revient à false au prochain invoke réussi.
  backendDown: boolean;
}

export const useShowStatusStore = create<ShowStatusState>(() => ({
  parked: [],
  consoleAge: null,
  armed: true,
  backendDown: false,
}));

// Canal sans cycle : tauri.ts notifie, le store écrit.
registerBackendHealth({
  down: () => useShowStatusStore.setState({ backendDown: true }),
  up: () => useShowStatusStore.setState({ backendDown: false }),
});

let started = false;

/// Démarre l'état santé — idempotent, appelé au mount des surfaces.
/// L'intervalle parked/consoleAge a migré dans le canal `live:state`
/// (perfSlice) : la fenêtre principale poll une fois et broadcaste, les
/// détachées écoutent — N fenêtres ne polluent plus le backend.
/// Restent ici : le fetch initial (immédiat, avant le 1er tick 1500ms)
/// et `osc-armed-changed` (event-driven, gratuit dans toute fenêtre).
export function startShowStatusPolling() {
  if (started) return;
  started = true;
  void (async () => {
    const [parked, age] = await Promise.all([
      safeInvoke<number[]>('get_parked_objects').catch((e) => { silentCatch(e); return null; }),
      safeInvoke<number | null>('get_last_show_cmd_age').catch((e) => { silentCatch(e); return undefined as number | null | undefined; }),
    ]);
    const patch: Partial<ShowStatusState> = {};
    if (parked != null) patch.parked = parked;
    if (age !== undefined) patch.consoleAge = age ?? null;
    useShowStatusStore.setState(patch);
  })();
  // armed : valeur initiale + événement backend à chaque écriture.
  void safeInvoke<boolean>('get_osc_armed')
    .then((armed) => useShowStatusStore.setState({ armed }))
    .catch(silentCatch);
  void safeListen<boolean>('osc-armed-changed', (e) =>
    useShowStatusStore.setState({ armed: e.payload }),
  );
}
