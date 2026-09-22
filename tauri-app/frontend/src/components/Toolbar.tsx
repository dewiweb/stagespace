import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../utils/toast-helpers';
import { open, save } from '@tauri-apps/plugin-dialog';
import { FolderInput, Settings, Undo2, Redo2, Save, FolderOpen, TriangleAlert } from 'lucide-react';
import { SettingsModal } from './SettingsModal';

export const Toolbar: React.FC = () => {
  // Sélecteurs granulaires — un full-store subscribe re-renderait la Toolbar
  // à chaque frame (movementPositions écrit à 60fps).
  const movements = useGraphStore((s) => s.movements);
  const status = useGraphStore((s) => s.status);
  const compileError = useGraphStore((s) => s.compileError);
  const playError = useGraphStore((s) => s.playError);
  const clearCompileError = useGraphStore((s) => s.clearCompileError);
  const clearPlayError = useGraphStore((s) => s.clearPlayError);
  const nodes = useGraphStore((s) => s.nodes);
  const saveGraphToFile = useGraphStore((s) => s.saveGraphToFile);
  const loadGraphFromFile = useGraphStore((s) => s.loadGraphFromFile);
  const importHol = useGraphStore((s) => s.importHol);
  const holProject = useGraphStore((s) => s.holProject);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const canUndo = useGraphStore((s) => s.canUndo);
  const canRedo = useGraphStore((s) => s.canRedo);
  const panic = useGraphStore((s) => s.panic);
  const perfStats = useGraphStore((s) => s.perfStats);
  const oscAddress = useGraphStore((s) => s.oscAddress);
  const oscPort = useGraphStore((s) => s.oscPort);
  const oscProfile = useGraphStore((s) => s.oscProfile);

  const [showSettings, setShowSettings] = React.useState(false);

  const hasError = !!(compileError || playError);
  const activeMovements = movements.length;
  const hasGraph = nodes.length > 0;

  // Les raccourcis live (Esc panic, Enter GO, …) et le polling perfStats sont
  // montés au niveau App (hooks/useLiveShortcuts.ts) — ils doivent survivre au
  // démontage du Toolbar en mode Perform.

  const handleSaveGraph = async () => {
    try {
      const filePath = await save({
        filters: [{ name: 'STAGESPACE Show', extensions: ['hfg'] }],
        defaultPath: 'show.hfg',
      });
      if (filePath) {
        await saveGraphToFile(filePath as string);
        toast.success('Show saved');
      }
    } catch (e) {
      console.error('Save show failed:', e);
      toast.error(`Save show failed: ${e}`);
    }
  };

  const handleLoadGraph = async () => {
    try {
      const result = await open({
        filters: [{ name: 'STAGESPACE Show', extensions: ['hfg', 'json'] }],
        multiple: false,
      });
      if (result) {
        await loadGraphFromFile(result as string);
        toast.success('Show loaded');
      }
    } catch (e) {
      console.error('Load show failed:', e);
      toast.error(`Load show failed: ${e}`);
    }
  };

  const handleImportHol = async () => {
    try {
      const result = await open({
        filters: [{ name: 'Holophonix Project', extensions: ['hol', 'json'] }],
        multiple: false,
      });
      if (result) {
        await importHol(result as string);
      }
    } catch (e) {
      console.error('Import .hol failed:', e);
      toast.error(`Import .hol failed: ${e}`);
    }
  };

  const statusColor =
    activeMovements > 0 ? 'bg-green-500' :
    status === 'compiling' ? 'bg-yellow-500 animate-pulse' :
    status === 'error' ? 'bg-red-500' :
    status === 'compiled' ? 'bg-blue-500' :
    'bg-gray-600';

  const statusLabel =
    activeMovements > 0 ? `${activeMovements} movement${activeMovements > 1 ? 's' : ''}` :
    status === 'compiling' ? 'Compiling' :
    status === 'error' ? 'Error' :
    status === 'compiled' ? 'Compiled' :
    'Idle';

  return (
    <div className="flex flex-col border-b border-stagespace-border bg-stagespace-panel">
      <div className="flex items-center gap-2 px-4 py-2">
        {/* Import .hol — action principale */}
        <button
          onClick={handleImportHol}
          className="px-3 py-1.5 text-xs font-medium rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors flex items-center gap-1.5"
        >
          <FolderInput size={13} /> Import .hol
        </button>
        {holProject && (
          <span className="text-[11px] text-green-400 font-medium">
            {holProject.tracks.length} tracks
          </span>
        )}

        <div className="w-px h-5 bg-stagespace-border mx-1" />

        {/* OSC status chip → ouvre Settings (source unique d'édition —
            le panneau inline dupliquait host/port/profile/trackIds/discovery) */}
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
          title={`OSC → ${oscAddress}:${oscPort} (${oscProfile}) — Settings`}
        >
          <Settings size={13} />
          <span className="text-gray-500 font-mono text-[10px]">{oscAddress}:{oscPort}</span>
          <span className="text-gray-600 text-[10px]">{oscProfile}</span>
        </button>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

        <div className="w-px h-5 bg-stagespace-border mx-1" />

        {/* Undo/Redo (expert) */}
        <button
          onClick={undo}
          disabled={!canUndo}
          className="px-2 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="px-2 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={14} />
        </button>

        {/* Save / Load show (graphe + slots + cues + OSC + spatial FX) */}
        <button
          onClick={handleSaveGraph}
          disabled={!hasGraph}
          className="px-2 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Save complete show to .hfg file"
        >
          <Save size={14} />
        </button>
        <button
          onClick={handleLoadGraph}
          className="px-2 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors"
          title="Load show from .hfg file (slots, cues, OSC, FX — blocked during playback)"
        >
          <FolderOpen size={14} />
        </button>

        {/* Error badge */}
        {hasError && (
          <button
            onClick={() => { clearCompileError(); clearPlayError(); }}
            className="px-2 py-1 text-[11px] font-medium rounded bg-red-900/50 text-red-400 border border-red-700/50 hover:bg-red-900/70 transition-colors"
          >
            <TriangleAlert size={11} className="inline -mt-0.5" /> Error — dismiss
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* PANIC — arrêt d'urgence, toujours visible et accessible.
            Jamais replié dans un panel : c'est le seul contrôle qui doit
            survivre à tous les états de l'UI (Esc = même action). */}
        <button
          onClick={() => { panic(); }}
          className="px-3 py-1.5 text-xs font-bold rounded bg-red-800 hover:bg-red-700 text-white border border-red-600 transition-colors tracking-wider"
          title="PANIC (Esc) — stoppe tous les moves et renvoie les positions d'origine"
        >
          ◼ PANIC
        </button>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5 px-2 py-0.5">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-[11px] text-gray-400 font-medium">{statusLabel}</span>
        </div>

        {/* Performance overlay — visible quand des movements tournent */}
        {activeMovements > 0 && perfStats && (
          <div className="flex items-center gap-2 px-2 py-0.5 bg-gray-900/80 rounded border border-gray-700/50 text-[10px] font-mono">
            <span className={perfStats.fps >= 55 ? 'text-green-400' : perfStats.fps >= 30 ? 'text-yellow-400' : 'text-red-400'}>
              {perfStats.fps.toFixed(0)} FPS
            </span>
            <span className="text-gray-500">·</span>
            <span className="text-cyan-400">{perfStats.oscRate.toFixed(0)} OSC/s</span>
            <span className="text-gray-500">·</span>
            <span className={perfStats.cpuPercent < 50 ? 'text-gray-400' : 'text-yellow-400'}>
              {perfStats.cpuPercent.toFixed(0)}% CPU
            </span>
          </div>
        )}
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
