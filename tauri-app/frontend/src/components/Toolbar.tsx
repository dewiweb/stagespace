import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../utils/toast-helpers';
import { open, save } from '@tauri-apps/plugin-dialog';
import { FolderInput, Settings, Undo2, Redo2, Save, FolderOpen, CircleHelp } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { PanicButton } from './ui/PanicButton';
import { OscArmToggle } from './ui/OscArmToggle';
import { IconButton } from './ui/IconButton';

export const Toolbar: React.FC = () => {
  // Sélecteurs granulaires — un full-store subscribe re-renderait la Toolbar
  // à chaque frame (movementPositions écrit à 60fps).
  const compileError = useGraphStore((s) => s.compileError);
  const playError = useGraphStore((s) => s.playError);
  const nodes = useGraphStore((s) => s.nodes);
  const saveGraphToFile = useGraphStore((s) => s.saveGraphToFile);
  const loadGraphFromFile = useGraphStore((s) => s.loadGraphFromFile);
  const importHol = useGraphStore((s) => s.importHol);
  const holProject = useGraphStore((s) => s.holProject);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const canUndo = useGraphStore((s) => s.canUndo);
  const canRedo = useGraphStore((s) => s.canRedo);
  const oscAddress = useGraphStore((s) => s.oscAddress);
  const oscPort = useGraphStore((s) => s.oscPort);
  const oscProfile = useGraphStore((s) => s.oscProfile);

  const [showSettings, setShowSettings] = React.useState(false);

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

  return (
    <div className="flex flex-col border-b border-stagespace-border bg-stagespace-panel">
      <div className="flex items-center gap-2 px-4 py-2">
        {/* Import .hol — action principale */}
        <button
          onClick={handleImportHol}
          className="px-3 py-1.5 text-xs font-medium rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors flex items-center gap-1.5"
          title="Import a Holophonix project — discovers track IDs, names, colors, positions"
        >
          <FolderInput size={13} /> Import .hol
        </button>
        {holProject && (
          <span className="text-xs text-green-400 font-medium">
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
          <span className="text-gray-500 text-[11px] uppercase tracking-wider">OSC out</span>
          <span className="text-gray-500 font-mono text-xs">{oscAddress}:{oscPort}</span>
          <span className="text-gray-400 text-xs">{oscProfile}</span>
        </button>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

        <div className="w-px h-5 bg-stagespace-border mx-1" />

        {/* Undo/Redo (expert) */}
        <IconButton onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={14} />
        </IconButton>
        <IconButton onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <Redo2 size={14} />
        </IconButton>

        {/* Save / Load show (graphe + slots + cues + OSC + spatial FX) */}
        <IconButton onClick={handleSaveGraph} disabled={!hasGraph} title="Save complete show to .hfg file">
          <Save size={14} />
        </IconButton>
        <IconButton
          onClick={handleLoadGraph}
          title="Load show from .hfg file (slots, cues, OSC, FX — blocked during playback)"
        >
          <FolderOpen size={14} />
        </IconButton>

        {/* Spacer — la StatusBar (bas de fenêtre) porte statut, perf,
            erreurs et version ; la Toolbar ne garde que les actions. */}
        <div className="flex-1" />

        {/* Zone sécurité live — arm + panic groupés à droite : les deux
            contrôles d'arrêt/sécurité au même endroit. */}
        <OscArmToggle />

        {/* Help — cheatsheet raccourcis live (même contenu que la touche ?) */}
        <IconButton
          onClick={() => {
            import('../store/useMoveEditorStore').then(({ useMoveEditorStore }) => {
              useMoveEditorStore.getState().setShortcutsOpen(true);
            });
          }}
          title="Keyboard shortcuts (?)"
        >
          <CircleHelp size={14} />
        </IconButton>

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
