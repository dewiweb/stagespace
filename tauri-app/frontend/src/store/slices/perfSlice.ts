import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
import { isDetachedWindow, safeParseStoredJson } from '../../utils/safeStorage';
import type { PerfStatsResponse } from '../../types/generated/PerfStatsResponse';

/// Payload complet de `get_perf_stats` — généré depuis Rust (ts-rs).
/// Inclut les champs liveness (isRunning, threadDied…) en plus des métriques.
export type PerfStats = PerfStatsResponse;

export interface PerfSlice {
  // Performance overlay
  perfStats: PerfStats | null;
  setPerfStats: (stats: PerfStats) => void;
  /// Source-de-contrôle par objet — move / manual / psn / park / hold /
  /// track. La lecture opérateur du modèle de contrôle.
  objectStates: Record<number, string>;
  refreshObjectStates: () => Promise<void>;
  /// Santé des flux — PSN running/age, armé, âge du dernier show-cmd
  /// (inclut le timecode) en secondes. Bandeau permanent P1.3.
  flowHealth: {
    psnRunning: boolean;
    psnAge: number | null;
    armed: boolean;
    showCmdAgeS: number | null;
  };
  refreshFlowHealth: () => Promise<void>;
  /// Positions réellement émises par objet (ce que le renderer a reçu) —
  /// confidence view : le "commanded" vs l'intention GUI.
  emittedPositions: Record<number, [number, number, number]>;
  refreshEmittedPositions: () => Promise<void>;
  /// Vu-mètre perceptuel — calculé à 60fps côté merge.
  perceptual: {
    legibility_deg_s: Record<number, number>;
    looming_ms: number;
    vection: number;
  };
  refreshPerceptual: () => Promise<void>;
  /// Log opérationnel des commandes show — qui a GO quand, quel NACK.
  /// P2.4 : l'historique horodaté visible en conduite.
  showLog: { ts: number; label: string }[];
  pushShowLog: (label: string) => void;
}

export const createPerfSlice: StateCreator<PerfSlice, [], [], PerfSlice> = (set) => ({
  perfStats: null,
  setPerfStats: (stats) => set({ perfStats: stats }),
  objectStates: {},
  refreshObjectStates: async () => {
    try {
      const states = await invoke<Record<number, string>>('get_object_states');
      // != null : un invoke en échec/vide ne doit pas effacer le dernier
      // état connu — sinon la détachée verrait `undefined` broadcast.
      if (states != null) set({ objectStates: states });
    } catch { /* non critique */ }
  },
  flowHealth: { psnRunning: false, psnAge: null, armed: true, showCmdAgeS: null },
  refreshFlowHealth: async () => {
    try {
      const [[psnRunning, psnAge], armed, showCmdAgeS] = await Promise.all([
        invoke<[boolean, number | null]>('get_psn_health'),
        invoke<boolean>('get_osc_armed'),
        invoke<number | null>('get_last_show_cmd_age'),
      ]);
      if (psnRunning != null && armed != null)
        set({ flowHealth: { psnRunning, psnAge, armed, showCmdAgeS } });
    } catch { /* non critique */ }
  },
  emittedPositions: {},
  refreshEmittedPositions: async () => {
    try {
      const pos = await invoke<Record<number, [number, number, number]>>('get_emitted_positions');
      if (pos != null) set({ emittedPositions: pos });
    } catch { /* non critique */ }
  },
  perceptual: { legibility_deg_s: {}, looming_ms: 0, vection: 0 },
  refreshPerceptual: async () => {
    try {
      const p = await invoke<{
        legibility_deg_s: Record<number, number>;
        looming_ms: number;
        vection: number;
      }>('get_perceptual_metrics');
      if (p != null) set({ perceptual: p });
    } catch { /* non critique */ }
  },
  showLog: [],
  pushShowLog: (label) =>
    set((s) => ({
      showLog: [...s.showLog.slice(-49), { ts: Date.now(), label }],
    })),
});

// Canal live:state — une SEULE fenêtre poll le backend : la principale
// broadcaste l'état santé complet, les fenêtres détachées écoutent au
// lieu de poller (N fenêtres ≠ N×1500ms d'IPC). Vit au niveau module,
// jamais gaté sur playback : park/manual/psn lisibles à l'arrêt.
export type LiveStatePayload = {
  objectStates: Record<number, string>;
  flowHealth: { psnRunning: boolean; psnAge: number | null; armed: boolean; showCmdAgeS: number | null };
  emittedPositions: Record<number, [number, number, number]>;
  perceptual: { legibility_deg_s: Record<number, number>; looming_ms: number; vection: number };
  parked: number[];
  consoleAge: number | null;
  manualPositions: Record<number, [number, number, number]>;
  /// Indices volatiles — jamais persistés, les détachées n'ont aucun
  /// autre moyen de les voir (NOW/NEXT figés sinon).
  cueIndex: number;
  setlistIndex: number;
  soloSavedIds: string[];
  /// slotId → movementId (null = arrêté) — vérité backend transitée :
  /// les pads détachés affichent l'état réel, et un tap ne peut pas
  /// lancer un doublon sur un slot déjà vivant (revue M5).
  slotMovements: Record<string, string | null>;
  /// Liste des moves actifs — les détachées ne les apprennent que par
  /// broadcast : sans eux la 3D détachée affiche "No move running" par-
  /// dessus des positions qui arrivent pourtant (movements n'est jamais
  /// re-fetché côté détachée — pas de poll backend).
  movements: { id: string; name: string; is_active: boolean }[];
};

/// Poll santé complet — écrit perfSlice + showStatusStore locaux, puis
/// (fenêtre principale) broadcaste `live:state` aux détachées.
async function pollLive(broadcast: boolean) {
  const [m, show] = await Promise.all([
    import('../useGraphStore'),
    import('../useShowStatusStore'),
  ]);
  const s = m.useGraphStore.getState();
  await Promise.all([
    s.refreshObjectStates(),
    s.refreshFlowHealth(),
    s.refreshEmittedPositions(),
    s.refreshPerceptual(),
  ]);
  // Santé show (parked / consoleAge) — même cycle que le reste.
  const [parked, consoleAge, manualPositions] = await Promise.all([
    invoke<number[]>('get_parked_objects').catch(() => null),
    invoke<number | null>('get_last_show_cmd_age').catch(() => undefined),
    invoke<Record<number, [number, number, number]>>('get_manual_positions').catch(() => null),
  ]);
  // `s` est un snapshot FIGÉ capturé avant les awaits — les refresh* ont
  // produit un nouvel état depuis. patch/payload doivent le relire,
  // sinon le voyant armed reste vrai ~3s après un disarm (revue M3).
  const fresh = m.useGraphStore.getState();
  const patch: { parked?: number[]; consoleAge?: number | null; armed: boolean } = {
    armed: fresh.flowHealth.armed,
  };
  if (parked != null) patch.parked = parked;
  if (consoleAge !== undefined) patch.consoleAge = consoleAge ?? null;
  show.useShowStatusStore.setState(patch);
  // Vérité backend des positions manuelles — le cache frontend ne voit
  // sinon jamais les écritures OSC/hold/tape/attention (cue capture et
  // .hfg sauvaient des positions fausses).
  if (manualPositions != null) {
    m.useGraphStore.setState({ manualPositions });
  }
  if (!broadcast) return;
  const payload: LiveStatePayload = {
    objectStates: fresh.objectStates,
    flowHealth: fresh.flowHealth,
    emittedPositions: fresh.emittedPositions,
    perceptual: fresh.perceptual,
    parked: patch.parked ?? show.useShowStatusStore.getState().parked,
    consoleAge: patch.consoleAge ?? show.useShowStatusStore.getState().consoleAge,
    manualPositions: manualPositions ?? m.useGraphStore.getState().manualPositions,
    cueIndex: -1,
    setlistIndex: -1,
    soloSavedIds: [],
    slotMovements: {},
    movements: [],
  };
  // Indices volatiles — lus depuis les stores au moment du broadcast
  // (await, sinon le payload partirait avec les -1 par défaut).
  const cs = await import('../useCuelistStore');
  payload.cueIndex = cs.useCuelistStore.getState().currentCueIndex;
  const g = m.useGraphStore.getState();
  payload.setlistIndex = g.currentSetlistIndex;
  payload.soloSavedIds = g.soloSavedIds;
  payload.slotMovements = Object.fromEntries(g.moveSlots.map((s) => [s.id, s.movementId]));
  payload.movements = g.movements.map((m: any) => ({ id: m.id, name: m.name, is_active: m.is_active ?? true }));
  const { emit } = await import('@tauri-apps/api/event');
  void emit('live:state', payload).catch(() => {});
}

if (isDetachedWindow()) {
  // Fenêtre détachée : pas de poll — la principale broadcaste. Le show
  // reste identique partout sans IPC dupliqué.
  let lastStateAt = 0;
  import('../../utils/tauri').then(({ safeListen }) =>
    safeListen<LiveStatePayload>('live:state', (e) => {
      lastStateAt = Date.now();
      const p = e.payload;
      void import('../useGraphStore').then((m) =>
        m.useGraphStore.setState({
          objectStates: p.objectStates,
          flowHealth: p.flowHealth,
          emittedPositions: p.emittedPositions,
          perceptual: p.perceptual,
          movements: (p.movements ?? []) as any,
          manualPositions: p.manualPositions,
          currentSetlistIndex: p.setlistIndex,
          soloSavedIds: p.soloSavedIds,
          // États des pads = vérité de la fenêtre principale (les définitions
          // viennent du storage local ; movementId vient du payload).
          moveSlots: m.useGraphStore
            .getState()
            .moveSlots.map((s) => ({ ...s, movementId: p.slotMovements[s.id] ?? null })),
        }),
      );
      // Index cue — sinon NOW/NEXT détachés restaient à -1 (NOW/NEXT figés).
      void import('../useCuelistStore').then((cs) =>
        cs.useCuelistStore.setState({ currentCueIndex: p.cueIndex }),
      );
      void import('../useShowStatusStore').then((m) =>
        m.useShowStatusStore.setState({
          parked: p.parked,
          consoleAge: p.consoleAge,
          armed: p.flowHealth.armed,
        }),
      );
    }),
  );
  // Contenu persisté : un slot/cue créé dans la fenêtre principale après
  // l'ouverture de la détachée doit y apparaître — l'événement `storage`
  // est la voie standard inter-webview pour localStorage partagé.
  window.addEventListener('storage', (e) => {
    if (e.key === 'stagespace-cuelist') {
      void import('../useCuelistStore').then((cs) => cs.useCuelistStore.getState().loadFromStorage());
    } else if (e.key === 'stagespace-move-slots') {
      const slots = safeParseStoredJson<any[]>('stagespace-move-slots', []);
      // normalizeSlot comme loadSlotsFromStorage — un slot persisté par
      // une vieille version sans oscIndex casserait les lookups doSolo/
      // doSlot (revue M6).
      void import('./moveSlotsSlice').then(({ normalizeSlot }) =>
        import('../useGraphStore').then((m) =>
          m.useGraphStore.setState({ moveSlots: slots.map(normalizeSlot) }),
        ),
      );
    } else if (e.key === 'stagespace-move-setlist') {
      const order = safeParseStoredJson<string[]>('stagespace-move-setlist', []);
      void import('../useGraphStore').then((m) =>
        m.useGraphStore.setState({ setlistOrder: order }),
      );
    }
  });
  // Watchdog : si la fenêtre principale est fermée/crashée (plus de
  // broadcast >5s), la détachée reprend le poll localement — elle reste
  // un instrument vivant, pas un écran figé. Silencieux en mode normal.
  setInterval(() => {
    if (lastStateAt === 0 || Date.now() - lastStateAt > 5000) {
      void pollLive(false).catch(() => {});
    }
  }, 3000);
} else {
  // Surveillance non critique — un tick en échec ne doit jamais
  // rejeter non capturé (le prochain tick réessaie).
  const safeTick = () => void pollLive(true).catch(() => {});
  safeTick();
  setInterval(safeTick, 1500);
}

// Log broadcasté par le backend — TOUTES les fenêtres (y compris la
// fenêtre run détachée) voient les commandes OSC. liveActions ne logge
// que les actions GUI (from absent) pour ne pas doubler.
import('../../utils/tauri').then(({ safeListen }) =>
  safeListen<{ label: string }>('show-log', (e) =>
    import('../useGraphStore').then((m) =>
      m.useGraphStore.getState().pushShowLog(e.payload.label),
    ),
  ),
);

// Les timers pre_wait/follow vivent dans CHAQUE webview — annuler dans
// une seule fenêtre laisse les autres armées : un panic dans ?view=run
// ne toucherait pas le setTimeout de la fenêtre principale (revue H1).
// Backend (sink panic/stop) et actions frontend émettent cet event —
// chaque contexte annule SES timers.
import('../../utils/tauri').then(({ safeListen }) =>
  safeListen('timers:cancel', () =>
    import('../useCuelistStore').then((m) =>
      m.useCuelistStore.getState().cancelPendingTimers(),
    ),
  ),
);
