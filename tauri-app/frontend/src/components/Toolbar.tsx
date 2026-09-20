import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { toast } from '../utils/toast-helpers';
import { safeInvoke as invoke } from '../utils/tauri';
import { isModalOpen, closeTopModal } from '../utils/modalGuard';
import { open, save } from '@tauri-apps/plugin-dialog';
import { SettingsModal } from './SettingsModal';

const OSC_PROFILES = [
  { value: 'holophonix', label: 'Holophonix' },
  { value: 'iem', label: 'IEM MultiEncoder' },
  { value: 'ircam', label: 'IRCAM Spat' },
  { value: 'adm', label: 'ADM-OSC' },
  { value: 'generic', label: 'Generic Cartesian' },
  { value: 'generic_polar', label: 'Generic Polar' },
];

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
  const selectedTrackIds = useGraphStore((s) => s.selectedTrackIds);
  const getSelectedOscIds = useGraphStore((s) => s.getSelectedOscIds);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const canUndo = useGraphStore((s) => s.canUndo);
  const canRedo = useGraphStore((s) => s.canRedo);
  const panic = useGraphStore((s) => s.panic);
  const perfStats = useGraphStore((s) => s.perfStats);
  const setPerfStats = useGraphStore((s) => s.setPerfStats);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const setManualOscIds = useGraphStore((s) => s.setManualOscIds);
  const oscAddress = useGraphStore((s) => s.oscAddress);
  const oscPort = useGraphStore((s) => s.oscPort);
  const oscProfile = useGraphStore((s) => s.oscProfile);
  const setOscAddress = useGraphStore((s) => s.setOscAddress);
  const setOscPort = useGraphStore((s) => s.setOscPort);
  const setOscProfile = useGraphStore((s) => s.setOscProfile);

  const [oscIds, setOscIds] = React.useState(manualOscIds.join(','));
  const [showOsc, setShowOsc] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [discoveredTargets, setDiscoveredTargets] = React.useState<Array<{ name: string; host: string; port: number; profile: string; source: string }>>([]);

  const hasError = !!(compileError || playError);
  const activeMovements = movements.length;
  const hasGraph = nodes.length > 0;

  // Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo), Space (play/stop selected), Esc (panic), Enter (GO next cue), ArrowLeft/Right (cue nav)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // ── Escape : chaîne de priorité explicite ──
      // 1. Un modal/picker est ouvert → Esc le ferme (jamais panic)
      // 2. Dans un champ texte → blur (le prochain Esc paniquera)
      // 3. Un mode d'édition est actif (draw/manipulate/assign) → annule le mode
      // 4. Sinon → PANIC, inconditionnel (ni bouton ni React Flow ne bloquent)
      if (e.key === 'Escape') {
        if (e.defaultPrevented || e.repeat) return;
        if (isModalOpen()) {
          e.preventDefault();
          closeTopModal();
          return;
        }
        if (isTextField) {
          target.blur();
          return;
        }
        e.preventDefault();
        const gs = useGraphStore.getState();
        if (gs.cancelInteractionModes()) return;
        panic();
        return;
      }

      // Ne pas intercepter les autres touches si on tape dans un champ
      // ou qu'un bouton a le focus (Space/Enter = activation native)
      if (isTextField || target.tagName === 'BUTTON') return;
      // Un handler plus spécifique a déjà consommé la touche
      if (e.defaultPrevented) return;
      // Un modal/picker est ouvert → aucun autre raccourci live
      if (isModalOpen()) return;
      // Maintenir la touche ne doit pas spammer GO/play
      if (e.repeat) return;
      // Dans l'éditeur React Flow : Delete/Backspace suppriment des nodes —
      // aucun raccourci live ne doit s'activer depuis le canvas.
      if (target instanceof Element && target.closest('.react-flow')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Enter') {
        // GO: next cue in setlist
        e.preventDefault();
        if (!useCuelistStore.getState().isRecalling) {
          useCuelistStore.getState().goToNextCue();
        }
      } else if (e.key === 'Backspace') {
        // Previous cue
        e.preventDefault();
        if (!useCuelistStore.getState().isRecalling) {
          useCuelistStore.getState().goToPreviousCue();
        }
      } else if (e.key === ' ') {
        // Space: play/stop the selected (editing) slot
        e.preventDefault();
        const gs = useGraphStore.getState();
        const slotId = (gs as any).editingSlotId as string | null;
        if (!slotId) {
          toast.info('No move selected — click a move first');
          return;
        }
        const slot = (gs as any).moveSlots?.find((s: any) => s.id === slotId);
        if (!slot) return;
        if (slot.movementId) {
          (gs as any).stopSlot(slotId);
        } else {
          (gs as any).playSlot(slotId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, panic]);

  // Poll perf stats quand des movements sont actifs
  const oscErrorToastShown = React.useRef(false);
  const mergeDiedToastShown = React.useRef(false);
  React.useEffect(() => {
    if (activeMovements === 0) {
      setPerfStats({ fps: 0, oscRate: 0, latencyMs: 0, cpuPercent: 0 });
      oscErrorToastShown.current = false;
      mergeDiedToastShown.current = false;
      return;
    }
    const interval = setInterval(async () => {
      try {
        const stats = await invoke<{ fps: number; oscRate: number; latencyMs: number; cpuPercent: number; oscErrorRate: number; oscRefusedRate: number; threadDied?: boolean }>('get_perf_stats');
        setPerfStats(stats);
        // Merge thread mort = blackout OSC silencieux (fps affiché = valeur
        // figée, pas un signe de vie). Alerter une fois.
        if (stats.threadDied && !mergeDiedToastShown.current) {
          mergeDiedToastShown.current = true;
          toast.error(
            'CRITICAL: merge thread died — OSC output is stopped. Stop all moves and restart playback (Esc = panic).',
            0,
          );
        }
        // Alerte OSC si taux d'erreur > 5% (une seule fois par session de playback).
        // ECONNREFUSED dominant = personne n'écoute le port cible (pas du packet loss).
        if (stats.oscErrorRate > 0.05 && !oscErrorToastShown.current) {
          oscErrorToastShown.current = true;
          const refusedDominant = stats.oscRefusedRate > stats.oscErrorRate / 2;
          const { oscAddress: host, oscPort: port } = useGraphStore.getState();
          toast.error(
            refusedDominant
              ? `OSC destination unreachable — nothing is listening on ${host}:${port}. Is the spatializer running?`
              : `OSC output failing: ${(stats.oscErrorRate * 100).toFixed(0)}% packet loss. Check network connection to spatializer.`,
            10000,
          );
        }
        if (stats.oscErrorRate < 0.01) {
          oscErrorToastShown.current = false;
        }
      } catch (e) {
        // ignore
      }
    }, 500);
    return () => clearInterval(interval);
  }, [activeMovements, setPerfStats]);

  // Auto-fill OSC IDs from selected tracks
  React.useEffect(() => {
    const ids = getSelectedOscIds();
    if (ids.length > 0) {
      setOscIds(ids.join(','));
    }
  }, [selectedTrackIds, getSelectedOscIds]);

  const handleSaveGraph = async () => {
    try {
      const filePath = await save({
        filters: [{ name: 'STAGESPACE Graph', extensions: ['hfg'] }],
        defaultPath: 'graph.hfg',
      });
      if (filePath) {
        await saveGraphToFile(filePath as string);
      }
    } catch (e) {
      console.error('Save graph failed:', e);
      toast.error(`Save graph failed: ${e}`);
    }
  };

  const handleLoadGraph = async () => {
    try {
      const result = await open({
        filters: [{ name: 'STAGESPACE Graph', extensions: ['hfg', 'json'] }],
        multiple: false,
      });
      if (result) {
        await loadGraphFromFile(result as string);
      }
    } catch (e) {
      console.error('Load graph failed:', e);
      toast.error(`Load graph failed: ${e}`);
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
          <span className="text-[10px]">◆</span> Import .hol
        </button>
        {holProject && (
          <span className="text-[11px] text-green-400 font-medium">
            {holProject.tracks.length} tracks
          </span>
        )}

        <div className="w-px h-5 bg-stagespace-border mx-1" />

        {/* OSC quick toggle (inline panel) */}
        <button
          onClick={() => setShowOsc(!showOsc)}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
            showOsc ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          <span className="text-[10px]">⚙</span> OSC
          <span className="text-gray-500 font-mono text-[10px]">{oscAddress}:{oscPort}</span>
        </button>

        {/* Settings (modal) */}
        <button
          onClick={() => setShowSettings(true)}
          className="px-2.5 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
          title="Settings — OSC, audio, tracks"
        >
          <span className="text-[10px]">☰</span> Settings
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
          ↶
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="px-2 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>

        {/* Save / Load graph (expert) */}
        <button
          onClick={handleSaveGraph}
          disabled={!hasGraph}
          className="px-2 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Save graph to .hfg file"
        >
          💾
        </button>
        <button
          onClick={handleLoadGraph}
          className="px-2 py-1.5 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:text-white transition-colors"
          title="Load graph from .hfg file"
        >
          📂
        </button>

        {/* Error badge */}
        {hasError && (
          <button
            onClick={() => { clearCompileError(); clearPlayError(); }}
            className="px-2 py-1 text-[11px] font-medium rounded bg-red-900/50 text-red-400 border border-red-700/50 hover:bg-red-900/70 transition-colors"
          >
            ⚠ Error — dismiss
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

      {/* OSC Settings panel */}
      {showOsc && (
        <div className="px-4 py-2.5 border-t border-stagespace-border bg-gray-900/50 flex items-center gap-3 flex-wrap animate-fade-in">
          <div className="flex items-center gap-1.5">
            <label className="text-gray-500 text-[11px]">Host</label>
            <input
              type="text"
              value={oscAddress}
              onChange={(e) => setOscAddress(e.target.value)}
              className="w-28 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
              placeholder="127.0.0.1"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-gray-500 text-[11px]">Port</label>
            <input
              type="number"
              value={oscPort}
              onChange={(e) => setOscPort(Number(e.target.value) || 0)}
              className="w-16 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-gray-500 text-[11px]">Profile</label>
            <select
              value={oscProfile}
              onChange={(e) => setOscProfile(e.target.value)}
              className="px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
            >
              {OSC_PROFILES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-gray-500 text-[11px]">Track IDs</label>
            <input
              type="text"
              value={oscIds}
              onChange={(e) => {
                setOscIds(e.target.value);
                const parsed = e.target.value
                  .split(',')
                  .map((id) => parseInt(id.trim(), 10))
                  .filter((id) => !isNaN(id));
                setManualOscIds(parsed);
              }}
              className="w-32 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
              placeholder="1,2,3..."
            />
          </div>

          {/* Network Discovery */}
          <button
            onClick={async () => {
              setDiscovering(true);
              try {
                const targets = await invoke<Array<{ name: string; host: string; port: number; profile: string; source: string }>>('discover_osc_targets');
                setDiscoveredTargets(targets);
              } catch (e) {
                console.error('Discovery failed:', e);
                toast.error(`OSC discovery failed: ${e}`);
              } finally {
                setDiscovering(false);
              }
            }}
            disabled={discovering}
            className="px-3 py-1 text-[11px] font-medium rounded bg-cyan-700 hover:bg-cyan-600 text-white transition-colors disabled:opacity-40"
          >
            {discovering ? 'Scanning...' : '🔍 Discover'}
          </button>

          {/* Discovered targets */}
          {discoveredTargets.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {discoveredTargets.map((t, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setOscAddress(t.host);
                    setOscPort(t.port);
                    setOscProfile(t.profile);
                  }}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                    t.source === 'mdns'
                      ? 'bg-green-900/40 border-green-700/50 text-green-400 hover:bg-green-900/60'
                      : t.source === 'scan'
                      ? 'bg-blue-900/40 border-blue-700/50 text-blue-400 hover:bg-blue-900/60'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                  title={`${t.source}: ${t.host}:${t.port}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
