import React from 'react';
import NodeEditor from './components/NodeEditor';
import Scene3D from './components/Scene3D';
import MovesTable from './components/MovesTable';
import CuelistPanel from './components/CuelistPanel';
import SpatialFxPanel from './components/SpatialFxPanel';
import AnimationList from './components/AnimationList';
import Inspector from './components/Inspector';
import AudioPanel from './components/AudioPanel';
import TabPanel from './components/TabPanel';
import Toolbar from './components/Toolbar';
import StatusBar from './components/StatusBar';
import ToastContainer from './components/ToastContainer';
import PerformView from './components/PerformView';
import WelcomeModal, { shouldShowWelcome } from './components/WelcomeModal';
import ShortcutsModal from './components/ShortcutsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Workflow, ChevronRight, ChevronDown, PanelRightClose, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Maximize2, Minimize2, Activity } from 'lucide-react';
import { useLiveShortcuts, usePerfStatsPolling } from './hooks/useLiveShortcuts';
import { prepareGraphForSave } from './components/nodeParamSchema';
import { usePersistedState } from './utils/usePersistedState';
import { useGraphStore, useMovementPositionsListener, useAudioErrorListener, useCueRecallListener, useSupervisorListener } from './store/useGraphStore';
import { useAnimationStore } from './store/useAnimationStore';

function App() {
  const showExpert = useAnimationStore((s) => s.showExpert);
  const setShowExpert = useAnimationStore((s) => s.setShowExpert);
  const performMode = useAnimationStore((s) => s.performMode);
  const setPerformMode = useAnimationStore((s) => s.setPerformMode);
  const debugPerfVisible = useAnimationStore((s) => s.debugPerfVisible);
  const setDebugPerfVisible = useAnimationStore((s) => s.setDebugPerfVisible);
  const shortcutsOpen = useAnimationStore((s) => s.shortcutsOpen);
  const oscInPort = useGraphStore((s) => s.oscInPort);
  // Layout persisté — l'opérateur retrouve son workspace au prochain
  // lancement (safeStorage : quota/corruption gérés).
  const [leftCollapsed, setLeftCollapsed] = usePersistedState<boolean>('ss-layout-leftCollapsed', false);
  const [rightCollapsed, setRightCollapsed] = usePersistedState<boolean>('ss-layout-rightCollapsed', false);
  const [rightWidth, setRightWidth] = usePersistedState<number>('ss-layout-rightWidth', 288);
  const [leftWidth, setLeftWidth] = usePersistedState<number>('ss-layout-leftWidth', 256);
  const resizingRef = React.useRef(false);
  const resizingSideRef = React.useRef<'left' | 'right' | 'expert'>('right');
  // Ratio NodeEditor/Scene3D en mode Expert (0.5 = moitié/moitié)
  const [expertSplit, setExpertSplit] = usePersistedState<number>('ss-layout-expertSplit', 0.5);
  const centerColRef = React.useRef<HTMLDivElement | null>(null);
  // Focus éditeur : les panneaux latéraux se retirent et le NodeEditor
  // prend toute la rangée — la navigation dans le graphe est le besoin
  // premier en Expert (Scene3D reste monté, masqué).
  const [editorFocus, setEditorFocus] = React.useState(false);
  // Focus réellement actif : editorFocus n'a de sens qu'en mode Expert.
  const focusActive = showExpert && editorFocus;
  // Sections collapsibles du panneau gauche
  const [graphsExpanded, setGraphsExpanded] = usePersistedState<boolean>('ss-layout-graphsExpanded', true);
  const [movesExpanded, setMovesExpanded] = usePersistedState<boolean>('ss-layout-movesExpanded', true);
  // AudioPanel = monitoring/config — collapsible pour rendre la hauteur à
  // l'Inspector (outil de travail principal de la colonne droite).
  const [audioExpanded, setAudioExpanded] = usePersistedState<boolean>('ss-layout-audioExpanded', true);
  // Premier lancement : proposer le show d'exemple bundle (évalué une fois)
  const [showWelcome, setShowWelcome] = React.useState(shouldShowWelcome);

  // Listen to movement positions (multi-runtime)
  useMovementPositionsListener();
  // Surface les pannes de capture audio (micro mort en show) — monté au niveau
  // App, pas AudioPanel, pour survivre au collapse du panneau droit.
  useAudioErrorListener();
  // Surface les recalls partiels (moves qui n'ont pas respawné).
  useCueRecallListener();
  // Events du superviseur backend : worker zombie arrêté, merge thread
  // redémarré de lui-même (le frontend n'est plus dans la boucle de vie).
  useSupervisorListener();
  // Raccourcis live (Esc=panic, Enter=GO, Shift+Enter=recall) + polling perf —
  // au niveau App : ils doivent fonctionner aussi en mode Perform (le Toolbar
  // et sa stack se démontent).
  useLiveShortcuts();
  usePerfStatsPolling();

  // ── Resize des panneaux gauche et droit ──
  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      if (resizingSideRef.current === 'right') {
        const newWidth = Math.max(220, Math.min(600, window.innerWidth - e.clientX));
        setRightWidth(newWidth);
      } else if (resizingSideRef.current === 'expert') {
        // Split NodeEditor/Scene3D — ratio relatif à la colonne centre
        const rect = centerColRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        const ratio = (e.clientX - rect.left) / rect.width;
        setExpertSplit(Math.max(0.25, Math.min(0.8, ratio)));
      } else {
        const newWidth = Math.max(200, Math.min(500, e.clientX));
        setLeftWidth(newWidth);
      }
    };
    const onMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startRightResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    resizingSideRef.current = 'right';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const startLeftResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    resizingSideRef.current = 'left';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // Le focus éditeur n'a de sens qu'en Expert — sortir du mode l'annule.
  React.useEffect(() => {
    if (!showExpert && editorFocus) setEditorFocus(false);
  }, [showExpert, editorFocus]);

  const startExpertResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    resizingSideRef.current = 'expert';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // Au démarrage : si le port OSC IN sauvegardé diffère du défaut (8001),
  // appliquer le port sauvegardé côté backend
  React.useEffect(() => {
    if (oscInPort !== 8001) {
      useGraphStore.getState().setOscInPort(oscInPort);
    }

    // Safety: si le graphe est vide au démarrage (état corrompu ou race condition),
    // charger le preset Circle par défaut
    const state = useGraphStore.getState();
    if (state.nodes.length === 0) {
      console.warn('[App] Graph is empty at startup — loading default Circle preset');
      state.applyShapePreset('circle', 8);
    }

    // Registry plugins WASM — manifestes pour la palette dynamique et les
    // labels/params des nodes Plugin. Non bloquant : erreur → toast + vide.
    void useGraphStore.getState().fetchPlugins();

    // Récupérer la liste des moves actifs côté backend (survit à un refresh UI)
    // puis sync les slots (nettoyer les movementIds stale)
    state.refreshMovements().then(() => {
      useGraphStore.getState().syncSlotMovements();
    });

    // Pousser le graph global au backend (post-processing)
    import('./store/useGlobalGraphStore').then(({ useGlobalGraphStore }) => {
      useGlobalGraphStore.getState().pushGlobalGraph();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Onglet secondaire (en bas du panneau gauche) — Moves + Cues
  const secondaryTabs = [
    { id: 'moves', label: 'Moves', content: <MovesTable /> },
    { id: 'cues', label: 'Cues', content: <CuelistPanel /> },
    { id: 'fx', label: 'FX', content: <SpatialFxPanel /> },
  ];

  return (
    <div className="w-screen h-screen flex flex-col bg-stagespace-bg overflow-hidden">
      {/* Header */}
      <header className="h-12 bg-stagespace-panel border-b border-stagespace-border flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <h1 className="text-white font-bold text-base tracking-tight">STAGESPACE</h1>
          <span className="text-gray-600 text-[11px] ml-1 italic">Play the space</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPerformMode(!performMode)}
            className={`px-3 py-1 text-xs font-bold rounded transition-all flex items-center gap-1.5 ${
              performMode ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
            title={performMode
              ? 'Leave Perform — back to editing'
              : 'Perform mode — live surface: setlist, GO, panic, on-demand live params'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${performMode ? 'bg-white animate-pulse' : 'bg-gray-600'}`} />
            PERFORM
          </button>
          {!performMode && (
            <button
              onClick={() => setShowExpert(!showExpert)}
              className={`px-3 py-1 text-xs font-bold rounded transition-all flex items-center gap-1.5 ${
                showExpert ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
              title="Expert mode — advanced graph editor (nodes, connections, custom trajectories)"
            >
              <Workflow size={12} />
              {showExpert ? 'Expert' : 'Simple'}
            </button>
          )}
        </div>
      </header>

      {performMode ? (
        /* Mode Perform — surface live filtrée : Toolbar et édition absents,
           les raccourcis live restent actifs (montés ci-dessus). */
        <ErrorBoundary zone="Perform">
          <PerformView />
        </ErrorBoundary>
      ) : (
        <>
      {/* Toolbar (OSC settings, import .hol) */}
      <Toolbar />

      {/* Main Content — 3 colonnes (boundary par colonne : un crash de render
          ne doit pas démonter Toolbar/ToastContainer — panic Esc doit survivre) */}
      <div className="flex-1 flex overflow-hidden">
        <ErrorBoundary zone="Left panel">
        {/* Colonne gauche : AnimationList + onglets secondaires (collapsible +
            redimensionnable). En editorFocus elle se retire entièrement —
            l'état collapse des deux côtés est préservé pour la restauration. */}
        {!focusActive && (leftCollapsed ? (
          <button
            onClick={() => setLeftCollapsed(false)}
            className="w-7 border-r border-stagespace-border bg-stagespace-panel flex flex-col items-center pt-3 flex-shrink-0 hover:bg-gray-800 transition-colors group"
            title="Show the Show / Templates panel"
          >
            <PanelLeftOpen size={13} className="text-gray-500 group-hover:text-white" />
            <span className="text-gray-600 text-[10px] mt-2 writing-vertical" style={{ writingMode: 'vertical-rl' }}>Moves</span>
          </button>
        ) : (
          <>
          <div style={{ width: leftWidth }} className="border-r border-stagespace-border flex flex-col bg-stagespace-panel flex-shrink-0 relative">
            <button
              onClick={() => setLeftCollapsed(true)}
              className="absolute -right-3 top-2 z-overlay w-6 h-6 bg-stagespace-panel border border-stagespace-border rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 transition-colors text-xs"
              title="Collapse the panel"
            >
              <PanelLeftClose size={11} />
            </button>
            {/* Section 1: Moves (TabPanel Moves/Cues/FX) — prioritaire, flex-1.
                Le slot est l'unité de travail : il passe avant la bibliothèque. */}
            <div className={`flex flex-col min-h-0 ${movesExpanded ? 'flex-1' : 'flex-shrink-0'} ${graphsExpanded ? '' : 'flex-1'}`}>
              <div className="flex items-center gap-1 px-3 py-1.5 border-b border-stagespace-border flex-shrink-0 bg-gray-900/30">
                <button
                  onClick={() => setMovesExpanded(!movesExpanded)}
                  className="text-gray-400 hover:text-white text-[10px] w-4"
                  title={movesExpanded ? "Collapse" : "Expand"}
                >{movesExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
                <span className="text-gray-400 text-[10px] uppercase tracking-wider font-medium">Show</span>
              </div>
              {movesExpanded && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <TabPanel tabs={secondaryTabs} defaultTab="moves" />
                </div>
              )}
            </div>
            {/* Section 2: Templates (AnimationList) — secondaire. Partage
                proportionnel avec Show (flex-1 chacun) au lieu d'une hauteur
                fixe : sur petit écran aucune section n'écrase l'autre. */}
            <div className={`${graphsExpanded ? 'flex-1' : 'flex-shrink-0'} flex flex-col min-h-0 border-t border-stagespace-border`}>
              <div className="flex items-center gap-1 px-3 py-1.5 border-b border-stagespace-border flex-shrink-0 bg-gray-900/30">
                <button
                  onClick={() => setGraphsExpanded(!graphsExpanded)}
                  className="text-gray-400 hover:text-white text-[10px] w-4"
                  title={graphsExpanded ? "Collapse" : "Expand"}
                >{graphsExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
                <span className="text-gray-400 text-[10px] uppercase tracking-wider font-medium">Templates</span>
              </div>
              {graphsExpanded && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AnimationList />
                </div>
              )}
            </div>
          </div>
          {/* Splitter — poignée de redimensionnement */}
          <div
            onMouseDown={startLeftResize}
            className="w-1.5 flex-shrink-0 bg-stagespace-border hover:bg-blue-500/50 cursor-col-resize transition-colors relative group"
            title="Drag to resize"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-stagespace-border group-hover:bg-blue-500" />
          </div>
          </>
        ))}

        </ErrorBoundary>

        {/* Colonne centre : 3D Canvas + Expert (split view quand Expert activé) */}
        <ErrorBoundary zone="Canvas">
        <div className="flex-1 flex flex-col bg-stagespace-panel min-w-[300px]">
          {/* Barre du haut — change selon le mode */}
          {showExpert ? (
            <div className="h-9 border-b border-stagespace-border flex items-center px-3 flex-shrink-0 gap-2">
              <span className="text-gray-300 text-xs font-medium">Expert — Node Editor</span>
              <button
                onClick={() => setEditorFocus(!editorFocus)}
                className={`px-2 py-0.5 text-[10px] rounded font-medium flex items-center gap-1 transition-colors ${
                  editorFocus
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
                title={editorFocus
                  ? 'Exit focus — restore side panels and 3D preview'
                  : 'Focus — hide side panels and 3D preview, editor takes the full row'}
              >
                {editorFocus ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                Focus
              </button>
              <div className="flex-1" />
              <button
                onClick={() => {
                  const { nodes, edges } = useGraphStore.getState();
                  const graphJson = prepareGraphForSave(nodes, edges);
                  useAnimationStore.getState().updateCurrent({
                    graph_json: graphJson,
                  });
                  useAnimationStore.getState().saveAnimation();
                  setShowExpert(false);
                }}
                className="px-2 py-0.5 text-[10px] bg-purple-700 hover:bg-purple-600 text-white rounded font-medium"
                title="Save the graph as a Custom animation"
              >
                ★ Save
              </button>
            </div>
          ) : (
            <div className="h-9 border-b border-stagespace-border flex items-center px-3 bg-stagespace-panel flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">3D</span>
                </div>
                <span className="text-gray-300 text-xs font-medium">Canvas</span>
              </div>
              <div className="flex-1" />
              {import.meta.env.DEV && (
                <button
                  onClick={() => setDebugPerfVisible(!debugPerfVisible)}
                  className={`p-1 rounded transition-colors ${debugPerfVisible ? 'text-cyan-400 bg-cyan-900/30' : 'text-gray-500 hover:text-gray-300'}`}
                  title="DEBUG PERF overlay (render/IPC fps, stutter) — dev tool"
                >
                  <Activity size={12} />
                </button>
              )}
              <span className="text-gray-500 text-[10px]">orbit: drag · zoom: scroll</span>
            </div>
          )}

          {/* Contenu : NodeEditor (Expert only) + Scene3D (toujours monté, même position) */}
          <div ref={centerColRef} className="flex-1 flex min-h-0">
            {showExpert && (
              <div
                style={focusActive ? undefined : { width: `${expertSplit * 100}%` }}
                className={`min-w-[280px] ${focusActive ? 'flex-1' : 'border-r border-stagespace-border flex-shrink-0'}`}
              >
                <NodeEditor />
              </div>
            )}
            {/* Splitter Expert — poignée de redimensionnement NodeEditor/3D.
                Scene3D reste monté (jamais démonté : la scène se réinitialise). */}
            {showExpert && !focusActive && (
              <div
                onMouseDown={startExpertResize}
                onDoubleClick={() => setExpertSplit(0.5)}
                className="w-1.5 flex-shrink-0 bg-stagespace-border hover:bg-purple-500/50 cursor-col-resize transition-colors relative group"
                title="Drag to resize · double-click = 50/50"
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-stagespace-border group-hover:bg-purple-500" />
              </div>
            )}
            {/* Scene3D toujours rendu au même endroit — pas de unmount/remount.
                En focus il est masqué (display:none) mais monté : le contexte
                WebGL et la scène survivent à l'entrée/sortie du focus. */}
            <div className={`flex-1 min-w-[200px] flex flex-col ${focusActive ? 'hidden' : ''}`}>
              {showExpert && (
                <div className="h-7 border-b border-stagespace-border flex items-center px-2 bg-stagespace-panel flex-shrink-0">
                  <span className="text-gray-400 text-[10px] font-medium">3D Preview</span>
                  <span className="text-gray-500 text-[10px] ml-2">orbit: drag · zoom: scroll</span>
                  <div className="flex-1" />
                  {import.meta.env.DEV && (
                    <button
                      onClick={() => setDebugPerfVisible(!debugPerfVisible)}
                      className={`p-1 rounded transition-colors ${debugPerfVisible ? 'text-cyan-400 bg-cyan-900/30' : 'text-gray-500 hover:text-gray-300'}`}
                      title="DEBUG PERF overlay — dev tool"
                    >
                      <Activity size={11} />
                    </button>
                  )}
                  <button
                    onClick={() => setExpertSplit(expertSplit > 0.7 ? 0.5 : 0.78)}
                    className="text-gray-500 hover:text-white px-1"
                    title={expertSplit > 0.7 ? 'Restore 50/50 split' : 'Enlarge the node editor'}
                  >
                    {expertSplit > 0.7 ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                  </button>
                </div>
              )}
              <div className="flex-1 min-h-0">
                <Scene3D width="100%" height="100%" />
              </div>
            </div>
          </div>
        </div>
        </ErrorBoundary>

        {/* Colonne droite : Inspector (collapsible + redimensionnable) */}
        <ErrorBoundary zone="Inspector">
        {!focusActive && (rightCollapsed ? (
          <button
            onClick={() => setRightCollapsed(false)}
            className="w-7 border-l border-stagespace-border bg-stagespace-panel flex flex-col items-center pt-3 flex-shrink-0 hover:bg-gray-800 transition-colors group"
            title="Show the Inspector"
          >
            <PanelRightOpen size={13} className="text-gray-500 group-hover:text-white" />
            <span className="text-gray-600 text-[10px] mt-2" style={{ writingMode: 'vertical-rl' }}>Inspector</span>
          </button>
        ) : (
          <>
            {/* Splitter — poignée de redimensionnement */}
            <div
              onMouseDown={startRightResize}
              className="w-1.5 flex-shrink-0 bg-stagespace-border hover:bg-blue-500/50 cursor-col-resize transition-colors relative group"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-stagespace-border group-hover:bg-blue-500" />
            </div>
            <div style={{ width: rightWidth }} className="border-l border-stagespace-border flex-shrink-0 relative flex flex-col">
            <button
              onClick={() => setRightCollapsed(true)}
              className="absolute -left-3 top-2 z-overlay w-6 h-6 bg-stagespace-panel border border-stagespace-border rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 transition-colors text-xs"
              title="Hide the Inspector"
            >
              <PanelRightClose size={11} />
            </button>
            {/* Audio Panel — collapsible : c'est du monitoring/config, pas
                l'outil de travail. Replié il laisse toute la hauteur à
                l'Inspector (params du slot/node, TrackGrid, macros). */}
            <div className="flex-shrink-0 flex flex-col border-b border-stagespace-border max-h-[40%]">
              <button
                onClick={() => setAudioExpanded(!audioExpanded)}
                className="flex items-center gap-1 px-3 py-1.5 flex-shrink-0 bg-gray-900/30 hover:bg-gray-800/40 transition-colors"
                title={audioExpanded ? 'Collapse audio monitoring' : 'Expand audio monitoring'}
              >
                {audioExpanded ? <ChevronDown size={11} className="text-gray-400" /> : <ChevronRight size={11} className="text-gray-400" />}
                <span className="text-gray-400 text-[10px] uppercase tracking-wider font-medium">Audio IN</span>
              </button>
              {audioExpanded && (
                <div className="overflow-y-auto min-h-0">
                  <AudioPanel />
                </div>
              )}
            </div>
            {/* Inspector — prend le reste de l'espace */}
            <div className="flex-1 overflow-y-auto">
              <Inspector />
            </div>
          </div>
          </>
        ))}
        </ErrorBoundary>
      </div>
        </>
      )}

      {/* StatusBar — monitoring moteur persistant, visible dans TOUS les
          modes (Edit et Perform). Le statut/FPS/erreurs ne dépendent plus
          des composants démontés par le mode live. */}
      <StatusBar />

      {/* Toast notifications — erreurs backend, alerts OSC, etc. */}
      <ToastContainer />

      {/* Premier lancement — show d'exemple ou départ vide */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}

      {/* Aide raccourcis — `?` key ou bouton Toolbar */}
      {shortcutsOpen && <ShortcutsModal />}
    </div>
  );
}

export default App;
