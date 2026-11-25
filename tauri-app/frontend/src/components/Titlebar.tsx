import { getCurrentWindow } from '@tauri-apps/api/window';
import { MenuBar } from './MenuBar';
import { useMoveEditorStore } from '../store/useMoveEditorStore';

/** Vraie fenêtre Tauri ? Le shim dev-bridge pose aussi
    __TAURI_INTERNALS__ mais n'a pas de fenêtre OS à contrôler —
    tauri-bridge.js le marque via __STAGESPACE_BRIDGE__. */
const realWindow =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window &&
  !('__STAGESPACE_BRIDGE__' in window);

const SURFACES = [
  { id: 'atelier', label: 'Atelier', color: 'bg-stagespace-modulation', title: 'Composer/préparer — graphes, moves, cues, score, réglages' },
  { id: 'jeu', label: 'Jeu', color: 'bg-stagespace-live', title: 'Interagir live — pads, gestes, radar, sources' },
  { id: 'score', label: 'Score', color: 'bg-stagespace-accent', title: 'Composer le show dans le temps — timeline multipiste, clips moves/cues' },
  { id: 'conduite', label: 'Conduite', color: 'bg-stagespace-conduite', title: 'Faire avancer le show — cues, GO, surveillance, log' },
] as const;

/** Barre de titre custom (fenêtre frameless — `decorations: false`).
 *  Porte le brand, la menubar, la nav surfaces et les contrôles OS.
 *  `data-tauri-drag-region="deep"` : toute la barre drag la fenêtre
 *  sauf les éléments cliquables (le script drag.js de Tauri exclut
 *  nativement BUTTON/role=menuitem/tabindex) ; double-clic = maximize
 *  (internal_toggle_maximize, inclus dans core:window:default).
 *  En navigateur/bridge : même rendu, sans les boutons fenêtre. */
export function Titlebar() {
  const surface = useMoveEditorStore((s) => s.surface);
  const setSurface = useMoveEditorStore((s) => s.setSurface);
  const appWindow = realWindow ? getCurrentWindow() : null;

  return (
    <header
      data-tauri-drag-region="deep"
      className="h-9 bg-stagespace-panel border-b border-stagespace-border flex items-center flex-shrink-0 select-none"
    >
      {/* Brand — vit dans le chrome de la fenêtre */}
      <div className="flex items-center gap-2 pl-3 pr-1">
        <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow">
          <span className="text-white font-bold text-[10px] leading-none">S</span>
        </div>
        <span className="text-white font-bold text-xs tracking-tight hidden md:inline">
          STAGESPACE
        </span>
        <span className="text-gray-500 text-[10px] italic hidden xl:inline">
          Play the space
        </span>
      </div>

      <MenuBar />
      <div className="flex-1" />

      {/* Nav surfaces — même tabs qu'avant, compactées pour la titlebar */}
      <nav className="flex items-center gap-0.5 mr-2 bg-gray-900/60 rounded-md p-0.5">
        {SURFACES.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSurface(tab.id)}
            title={tab.title}
            className={`px-2.5 py-0.5 text-[11px] font-bold rounded transition-all ${
              surface === tab.id
                ? `${tab.color} text-white shadow`
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {appWindow && (
        <div className="flex items-stretch self-stretch">
          <button
            onClick={() => appWindow.minimize()}
            title="Minimize"
            className="w-11 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white text-sm"
          >
            –
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            title="Maximize / restore"
            className="w-11 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white text-xs"
          >
            ▢
          </button>
          <button
            onClick={() => appWindow.close()}
            title="Close — stops all moves (panic-clean)"
            className="w-11 flex items-center justify-center text-gray-400 hover:bg-stagespace-danger hover:text-white text-sm"
          >
            ✕
          </button>
        </div>
      )}
    </header>
  );
}
