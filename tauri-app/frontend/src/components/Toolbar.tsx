import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';
import { safeInvoke as invoke } from '../utils/tauri';
import { open, save } from '@tauri-apps/plugin-dialog';

const OSC_PROFILES = [
  { value: 'holophonix', label: 'Holophonix' },
  { value: 'iem', label: 'IEM MultiEncoder' },
  { value: 'ircam', label: 'IRCAM Spat' },
  { value: 'adm', label: 'ADM-OSC' },
  { value: 'generic', label: 'Generic Cartesian' },
  { value: 'generic_polar', label: 'Generic Polar' },
];

export const Toolbar: React.FC = () => {
  const { compile, playMovement, stopAllMovements, movements, status, compileError, playError, clearCompileError, clearPlayError, nodes,
    saveGraphToFile, loadGraphFromFile, importHol, holProject,
    selectedTrackIds, getSelectedOscIds, drawMode, setDrawMode,
    undo, redo, canUndo, canRedo, panic, perfStats, setPerfStats,
    manualOscIds, setManualOscIds,
    oscAddress, oscPort, oscProfile, setOscAddress, setOscPort, setOscProfile } =
    useGraphStore();

  const [oscIds, setOscIds] = React.useState(manualOscIds.join(','));
  const [showOsc, setShowOsc] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [discoveredTargets, setDiscoveredTargets] = React.useState<Array<{ name: string; host: string; port: number; profile: string; source: string }>>([]);

  const hasNodes = nodes.length > 0;
  const hasError = !!(compileError || playError);
  const activeMovements = movements.length;

  // Tracks cibles : sélection > tous
  // Retourne des indices dans le tableau des tracks (holProject.tracks ou manualOscIds)
  const getTargetTrackIndices = () => {
    if (holProject) {
      const indices = holProject.tracks
        .map((t, idx) => selectedTrackIds.has(t.id) ? idx : -1)
        .filter((idx) => idx >= 0);
      if (indices.length > 0) return indices;
      return holProject.tracks.map((_, idx) => idx); // tous par défaut
    }
    // Sans .hol: utiliser les manualOscIds
    // Si tracks sélectionnés, filtrer par ID
    if (selectedTrackIds.size > 0) {
      return manualOscIds
        .map((id, idx) => selectedTrackIds.has(id) ? idx : -1)
        .filter((idx) => idx >= 0);
    }
    // Tous par défaut
    return manualOscIds.map((_, idx) => idx);
  };

  const handleLaunch = async (isPreview: boolean) => {
    // Nouveau système : utilise launchAnimation (basé sur l'Animation, pas le graphe)
    const animStore = useAnimationStore.getState();
    await animStore.launchAnimation(isPreview, oscAddress, oscPort, oscProfile);
  };

  // Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo), Space (play/stop), Esc (panic)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ne pas intercepter si on tape dans un input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        panic();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, panic]);

  // Poll perf stats quand des movements sont actifs
  React.useEffect(() => {
    if (activeMovements === 0) {
      setPerfStats({ fps: 0, oscRate: 0, latencyMs: 0, cpuPercent: 0 });
      return;
    }
    const interval = setInterval(async () => {
      try {
        const stats = await invoke<{ fps: number; oscRate: number; latencyMs: number; cpuPercent: number }>('get_perf_stats');
        setPerfStats(stats);
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
          <span className="text-[10px]">�</span> Import .hol
        </button>
        {holProject && (
          <span className="text-[11px] text-green-400 font-medium">
            {holProject.tracks.length} tracks
          </span>
        )}

        <div className="w-px h-5 bg-stagespace-border mx-1" />

        {/* OSC settings toggle */}
        <button
          onClick={() => setShowOsc(!showOsc)}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
            showOsc ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          <span className="text-[10px]">⚙</span> OSC
          <span className="text-gray-500 font-mono text-[10px]">{oscAddress}:{oscPort}</span>
        </button>

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
