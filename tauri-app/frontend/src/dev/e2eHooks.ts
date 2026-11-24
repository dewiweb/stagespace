/// Hooks de test e2e — expose les VRAIES instances des stores sur
/// `window.__live` pour les tests browser (dev-bridge + puppeteer).
///
/// Pourquoi : un `import()` depuis une eval console en dev Vite crée
/// un module fantôme — chaque URL (« /src/store/useScoreStore »,
/// « /src/store/useScoreStore.ts », l'URL résolue avec `?t=` post-HMR)
/// produit un enregistrement distinct, donc un store Zustand distinct
/// que l'app ne voit pas. Les stores ne sont atteignables qu'en
/// passant par le graphe de modules de l'app — ce fichier en fait
/// partie (importé depuis `main.tsx`).
///
/// Usage : `window.__live.score.getState().playScore()`,
/// `window.__live.cues.getState().cues`, …
/// DEV only — le bloc d'install est dead-code éliminé en build prod.
import { useScoreStore } from '../store/useScoreStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { useGraphStore } from '../store/useGraphStore';
import { useSessionStore } from '../store/useSessionStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import { useShowStatusStore } from '../store/useShowStatusStore';
import { useToastStore } from '../store/useToastStore';

export interface LiveStores {
  score: typeof useScoreStore;
  cues: typeof useCuelistStore;
  graph: typeof useGraphStore;
  session: typeof useSessionStore;
  moveEditor: typeof useMoveEditorStore;
  globalGraph: typeof useGlobalGraphStore;
  signalGraph: typeof useSignalGraphStore;
  showStatus: typeof useShowStatusStore;
  toasts: typeof useToastStore;
}

declare global {
  interface Window {
    __live?: LiveStores;
  }
}

/// Appelé une fois par `main.tsx` en DEV. Idempotent — réinstaller
/// après un HMR repointe simplement vers les nouvelles instances.
export function installE2eHooks(): void {
  window.__live = {
    score: useScoreStore,
    cues: useCuelistStore,
    graph: useGraphStore,
    session: useSessionStore,
    moveEditor: useMoveEditorStore,
    globalGraph: useGlobalGraphStore,
    signalGraph: useSignalGraphStore,
    showStatus: useShowStatusStore,
    toasts: useToastStore,
  };
}
