import React from 'react';
import NodeEditor from './components/NodeEditor';
import Scene3D from './components/Scene3D';
import MovesTable from './components/MovesTable';
import CuelistPanel from './components/CuelistPanel';
import AnimationList from './components/AnimationList';
import Inspector from './components/Inspector';
import AudioPanel from './components/AudioPanel';
import TabPanel from './components/TabPanel';
import Toolbar from './components/Toolbar';
import { prepareGraphForSave } from './components/nodeParamSchema';
import { useGraphStore, useMovementPositionsListener } from './store/useGraphStore';
import { useAnimationStore } from './store/useAnimationStore';

function App() {
  const status = useGraphStore((s) => s.status);
  const movements = useGraphStore((s) => s.movements);
  const showExpert = useAnimationStore((s) => s.showExpert);
  const setShowExpert = useAnimationStore((s) => s.setShowExpert);
  const oscInPort = useGraphStore((s) => s.oscInPort);
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [rightCollapsed, setRightCollapsed] = React.useState(false);
  // Sections collapsibles du panneau gauche
  const [graphsExpanded, setGraphsExpanded] = React.useState(true);
  const [movesExpanded, setMovesExpanded] = React.useState(true);

  // Listen to movement positions (multi-runtime)
  useMovementPositionsListener();

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
  ];

  const activeCount = movements.length;
  const statusColor =
    activeCount > 0 ? 'bg-green-500' :
    status === 'compiling' ? 'bg-yellow-500 animate-pulse' :
    status === 'error' ? 'bg-red-500' :
    'bg-gray-600';

  const statusLabel =
    activeCount > 0 ? `${activeCount} live` :
    status === 'compiling' ? 'Compiling' :
    status === 'error' ? 'Error' :
    'Idle';

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
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${statusColor}`} />
            <span className="text-gray-400 text-[11px] font-medium">{statusLabel}</span>
          </div>
          <div className="w-px h-4 bg-stagespace-border" />
          <button
            onClick={() => setShowExpert(!showExpert)}
            className={`px-3 py-1 text-xs font-bold rounded transition-all flex items-center gap-1.5 ${
              showExpert ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
            title="Mode Expert — éditeur de graphe avancé (nodes, connexions, custom trajectories)"
          >
            <span className="text-[10px]">{showExpert ? '◆' : '◇'}</span>
            {showExpert ? 'Expert' : 'Simple'}
          </button>
        </div>
      </header>

      {/* Toolbar (OSC settings, import .hol) */}
      <Toolbar />

      {/* Main Content — 3 colonnes */}
      <div className="flex-1 flex overflow-hidden">
        {/* Colonne gauche : AnimationList + onglets secondaires (collapsible) */}
        {leftCollapsed ? (
          <button
            onClick={() => setLeftCollapsed(false)}
            className="w-7 border-r border-stagespace-border bg-stagespace-panel flex flex-col items-center pt-3 flex-shrink-0 hover:bg-gray-800 transition-colors group"
            title="Afficher le panneau des graphes"
          >
            <span className="text-gray-500 group-hover:text-white text-xs">▸</span>
            <span className="text-gray-600 text-[9px] mt-2 writing-vertical" style={{ writingMode: 'vertical-rl' }}>Graphes</span>
          </button>
        ) : (
          <div className="w-64 border-r border-stagespace-border flex flex-col bg-stagespace-panel flex-shrink-0 relative">
            <button
              onClick={() => setLeftCollapsed(true)}
              className="absolute -right-3 top-2 z-20 w-6 h-6 bg-stagespace-panel border border-stagespace-border rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 transition-colors text-xs"
              title="Masquer le panneau"
            >
              ◂
            </button>
            {/* Section 1: Graphes (AnimationList) — collapsible */}
            <div className={`flex flex-col min-h-0 ${graphsExpanded ? 'flex-1' : 'flex-shrink-0'} ${movesExpanded ? '' : 'flex-1'}`}>
              <div className="flex items-center gap-1 px-3 py-1.5 border-b border-stagespace-border flex-shrink-0 bg-gray-900/30">
                <button
                  onClick={() => setGraphsExpanded(!graphsExpanded)}
                  className="text-gray-400 hover:text-white text-[10px] w-4"
                  title={graphsExpanded ? "Réduire" : "Agrandir"}
                >{graphsExpanded ? '▼' : '▶'}</button>
                <span className="text-gray-400 text-[10px] uppercase tracking-wider font-medium">Graphes</span>
              </div>
              {graphsExpanded && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AnimationList />
                </div>
              )}
            </div>
            {/* Section 2: Moves (TabPanel) — collapsible */}
            <div className={`${movesExpanded ? 'h-64' : 'flex-shrink-0'} flex flex-col border-t border-stagespace-border ${graphsExpanded ? '' : 'flex-1'}`}>
              <div className="flex items-center gap-1 px-3 py-1.5 border-b border-stagespace-border flex-shrink-0 bg-gray-900/30">
                <button
                  onClick={() => setMovesExpanded(!movesExpanded)}
                  className="text-gray-400 hover:text-white text-[10px] w-4"
                  title={movesExpanded ? "Réduire" : "Agrandir"}
                >{movesExpanded ? '▼' : '▶'}</button>
                <span className="text-gray-400 text-[10px] uppercase tracking-wider font-medium">Moves</span>
              </div>
              {movesExpanded && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <TabPanel tabs={secondaryTabs} defaultTab="moves" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Colonne centre : 3D Canvas + Expert (split view quand Expert activé) */}
        <div className="flex-1 flex flex-col bg-stagespace-panel min-w-[300px]">
          {/* Barre du haut — change selon le mode */}
          {showExpert ? (
            <div className="h-9 border-b border-stagespace-border flex items-center px-3 flex-shrink-0 gap-2">
              <span className="text-gray-300 text-xs font-medium">Expert — Node Editor</span>
              <div className="flex-1" />
              <span className="text-gray-500 text-[10px]">Lancer via MovesTable ▶</span>
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
                title="Sauvegarder le graphe comme animation Custom"
              >
                ★ Save
              </button>
            </div>
          ) : (
            <div className="h-9 border-b border-stagespace-border flex items-center px-3 bg-stagespace-panel flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">3D</span>
                </div>
                <span className="text-gray-300 text-xs font-medium">Canvas</span>
              </div>
              <div className="flex-1" />
              <span className="text-gray-600 text-[10px]">orbit: drag · zoom: scroll</span>
            </div>
          )}

          {/* Contenu : NodeEditor (Expert only) + Scene3D (toujours monté, même position) */}
          <div className="flex-1 flex min-h-0">
            {showExpert && (
              <div className="flex-1 min-w-0 border-r border-stagespace-border">
                <NodeEditor />
              </div>
            )}
            {/* Scene3D toujours rendu au même endroit — pas de unmount/remount */}
            <div className={showExpert ? "w-1/2 min-w-[200px] flex flex-col" : "flex-1 flex flex-col"}>
              {showExpert && (
                <div className="h-7 border-b border-stagespace-border flex items-center px-2 bg-stagespace-panel flex-shrink-0">
                  <span className="text-gray-400 text-[10px] font-medium">3D Preview</span>
                  <span className="text-gray-600 text-[9px] ml-2">orbit: drag · zoom: scroll</span>
                </div>
              )}
              <div className="flex-1 min-h-0">
                <Scene3D width="100%" height="100%" />
              </div>
            </div>
          </div>
        </div>

        {/* Colonne droite : Inspector (collapsible) */}
        {rightCollapsed ? (
          <button
            onClick={() => setRightCollapsed(false)}
            className="w-7 border-l border-stagespace-border bg-stagespace-panel flex flex-col items-center pt-3 flex-shrink-0 hover:bg-gray-800 transition-colors group"
            title="Afficher l'Inspector"
          >
            <span className="text-gray-500 group-hover:text-white text-xs">◂</span>
            <span className="text-gray-600 text-[9px] mt-2" style={{ writingMode: 'vertical-rl' }}>Inspector</span>
          </button>
        ) : (
          <div className="w-72 border-l border-stagespace-border flex-shrink-0 relative flex flex-col">
            <button
              onClick={() => setRightCollapsed(true)}
              className="absolute -left-3 top-2 z-20 w-6 h-6 bg-stagespace-panel border border-stagespace-border rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 transition-colors text-xs"
              title="Masquer l'Inspector"
            >
              ▸
            </button>
            {/* Audio Panel — compact, en haut */}
            <div className="flex-shrink-0 max-h-[40%] overflow-y-auto border-b border-stagespace-border">
              <AudioPanel />
            </div>
            {/* Inspector — prend le reste de l'espace */}
            <div className="flex-1 overflow-y-auto">
              <Inspector />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
