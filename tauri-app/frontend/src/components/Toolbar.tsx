import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { Settings, Workflow } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { PanicButton } from './ui/PanicButton';
import { OscArmToggle } from './ui/OscArmToggle';

export const Toolbar: React.FC = () => {
  // Sélecteurs granulaires — un full-store subscribe re-renderait la Toolbar
  // à chaque frame (movementPositions écrit à 60fps).
  const compileError = useGraphStore((s) => s.compileError);
  const playError = useGraphStore((s) => s.playError);
  const holProject = useGraphStore((s) => s.holProject);
  const showExpert = useMoveEditorStore((s) => s.showExpert);
  const setShowExpert = useMoveEditorStore((s) => s.setShowExpert);
  const setEditorFocus = useMoveEditorStore((s) => s.setEditorFocus);

  const [showSettings, setShowSettings] = React.useState(false);

  // Les raccourcis live (Esc panic, Enter GO, …) et le polling perfStats sont
  // montés au niveau App (hooks/useLiveShortcuts.ts) — ils doivent survivre au
  // démontage du Toolbar en mode Perform.

  return (
    <div className="flex flex-col border-b border-stagespace-border bg-stagespace-panel">
      <div className="flex items-center gap-2 px-4 py-2">
        {/* Statut venue — le bouton Import .hol a migré dans File menu
            (single-source showFileActions) ; le chip tracks reste comme
            indicateur de la salle chargée. */}
        {holProject && (
          <span className="text-xs text-green-400 font-medium">
            {holProject.tracks.length} tracks
          </span>
        )}

        {/* Entrée Settings — la destination OSC s'affiche dans la
            StatusBar (toutes surfaces) ; dupliquer addr/port/profile ici
            créait deux sources pour la même info. */}
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
          title="Settings — OSC out destination shown in the status bar"
        >
          <Settings size={13} />
          <span className="text-gray-500 text-[11px] uppercase tracking-wider">Settings</span>
        </button>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

        {/* Simple/Expert — mode de l'éditeur de move. Même convention que
            PERFORM/Edit : le bouton affiche la CIBLE, la couleur signale
            le mode courant. (Relogé du header quand celui-ci est devenu
            la titlebar frameless.) */}
        <button
          onClick={() => {
            const next = !showExpert;
            setShowExpert(next);
            // Entrer en Expert = intention d'éditer le graphe — activer
            // le Focus directement (le split 50/50 écrase le canvas
            // React Flow ; la 3D reste à un clic via Focus).
            if (next) setEditorFocus(true);
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded transition-all flex items-center gap-1.5 ${
            showExpert ? 'bg-gray-800 text-gray-400 hover:text-white' : 'bg-purple-600 text-white'
          }`}
          title={showExpert
            ? 'Simple mode — move form editor (no graph nodes)'
            : 'Expert mode — advanced graph editor (nodes, connections, custom trajectories)'}
        >
          <Workflow size={12} />
          {showExpert ? 'Simple' : 'Expert'}
        </button>

        {/* Undo/redo, save/load, import .hol, raccourcis : tous vivent
            désormais dans la menubar + accélérateurs — la Toolbar ne
            garde que le statut de salle et la zone sécurité live. */}
        <div className="flex-1" />

        {/* Zone sécurité live — arm + panic groupés à droite : les deux
            contrôles d'arrêt/sécurité au même endroit. */}
        <OscArmToggle />

        {/* PANIC — arrêt d'urgence, toujours visible et accessible.
            Jamais replié dans un panel : c'est le seul contrôle qui doit
            survivre à tous les états de l'UI (Esc = même action). */}
        <PanicButton />

      </div>

      {/* Error detail */}
      {(compileError || playError) && (
        <div className="px-4 py-2 border-t border-red-800/50 bg-red-950/30 text-red-300 text-xs break-words animate-fade-in">
          {compileError && <div><span className="font-semibold">Compile:</span> {compileError}</div>}
          {playError && <div><span className="font-semibold">Play:</span> {playError}</div>}
        </div>
      )}
    </div>
  );
};

export default Toolbar;
