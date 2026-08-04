import React from 'react';
import { useGraphStore } from '../store/useGraphStore';

// Génère une couleur HSL pour un index donné (même schéma que les sphères 3D)
function colorForIndex(i: number, total: number) {
  const hue = (i / Math.max(total, 1)) * 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export default function TrackPanel() {
  const holProject = useGraphStore((s) => s.holProject);
  const selectedTrackIds = useGraphStore((s) => s.selectedTrackIds);
  const toggleTrackSelection = useGraphStore((s) => s.toggleTrackSelection);
  const selectAllTracks = useGraphStore((s) => s.selectAllTracks);
  const deselectAllTracks = useGraphStore((s) => s.deselectAllTracks);
  const getSelectedOscIds = useGraphStore((s) => s.getSelectedOscIds);
  const importHol = useGraphStore((s) => s.importHol);
  const clearHol = useGraphStore((s) => s.clearHol);
  const isPlaying = useGraphStore((s) => s.isPlaying);
  const movements = useGraphStore((s) => s.movements);
  const hasActiveRuntime = isPlaying || movements.length > 0;
  const manualOscIds = useGraphStore((s) => s.manualOscIds);

  // Per-track depth (0-100%)
  const [trackDepths, setTrackDepths] = React.useState<Record<number, number>>({});

  const setDepth = (trackId: number, depth: number) => {
    setTrackDepths((prev) => ({ ...prev, [trackId]: depth }));
  };

  const handleImport = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const result = await open({
        filters: [{ name: 'Holophonix Project', extensions: ['hol', 'json'] }],
        multiple: false,
      });
      if (result) {
        await importHol(result as string);
        setTimeout(() => selectAllTracks(), 100);
      }
    } catch (e) {
      console.error('Import .hol failed:', e);
    }
  };

  // ── Mode .hol : tracks réels ──
  if (holProject) {
    const selectedIds = getSelectedOscIds();
    return (
      <div className="p-3 h-full flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
            <span className="text-white text-[10px]">TRK</span>
          </div>
          <h3 className="text-white font-semibold text-sm">Tracks</h3>
          <span className="text-gray-500 text-[10px] ml-auto">
            {holProject.tracks.length} tracks
          </span>
        </div>

        <div className="flex gap-1">
          <button onClick={selectAllTracks} className="flex-1 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors">All</button>
          <button onClick={deselectAllTracks} className="flex-1 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors">None</button>
          <button onClick={handleImport} className="px-2 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors" title="Re-import">↻</button>
        </div>

        {selectedIds.length > 0 && (
          <div className="px-2 py-1.5 bg-cyan-900/20 border border-cyan-700/30 rounded">
            <div className="text-cyan-400 text-[9px] font-mono">OSC IDs ({selectedIds.length})</div>
            <div className="text-white text-[10px] font-mono truncate">{selectedIds.join(', ')}</div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-1">
          {holProject.tracks.map((track) => {
            const selected = selectedTrackIds.has(track.id);
            const depth = trackDepths[track.id] ?? 100;
            return (
              <div key={track.id} className={`p-1.5 rounded border transition-colors ${selected ? 'bg-cyan-900/30 border-cyan-600/50' : 'bg-gray-800/30 border-gray-700/30 hover:bg-gray-800/60'}`}>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleTrackSelection(track.id)}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: track.color || '#888' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-[11px] font-medium truncate">{track.name}</div>
                    <div className="text-gray-500 text-[9px] font-mono">#{track.id} · [{track.position[0].toFixed(1)}, {track.position[1].toFixed(1)}, {track.position[2].toFixed(1)}]</div>
                  </div>
                  <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${selected ? 'bg-cyan-600 border-cyan-500' : 'border-gray-600'}`}>
                    {selected && <span className="text-white text-[8px]">✓</span>}
                  </div>
                </div>
                {selected && (
                  <div className="flex items-center gap-1.5 mt-1.5 pl-5">
                    <span className="text-gray-500 text-[9px]">Depth</span>
                    <input type="range" min={0} max={100} step={5} value={depth} onChange={(e) => setDepth(track.id, parseInt(e.target.value))} className="flex-1 h-1 accent-cyan-500" />
                    <span className={`text-[9px] font-mono w-7 ${hasActiveRuntime ? 'text-green-400' : 'text-white'}`}>{depth}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button onClick={clearHol} className="py-1 text-[10px] text-red-400 hover:text-red-300 bg-gray-800/50 hover:bg-gray-700/50 rounded transition-colors">Clear Project</button>
      </div>
    );
  }

  // ── Mode sans .hol : tracks virtuels depuis manualOscIds ──
  const selectedIds = getSelectedOscIds();
  const virtualTracks = manualOscIds.map((id, i) => ({
    id,
    name: `Object ${id}`,
    color: colorForIndex(i, manualOscIds.length),
  }));

  const selectAllVirtual = () => {
    const next = new Set(manualOscIds);
    useGraphStore.setState({ selectedTrackIds: next });
    useGraphStore.getState().syncObjectsNode();
  };

  return (
    <div className="p-3 h-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
          <span className="text-white text-[10px]">TRK</span>
        </div>
        <h3 className="text-white font-semibold text-sm">Objects</h3>
        <span className="text-gray-500 text-[10px] ml-auto">
          {manualOscIds.length} IDs
        </span>
      </div>

      {/* Import .hol — discret en haut */}
      <button
        onClick={handleImport}
        className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-cyan-900/20 hover:bg-cyan-900/40 border border-cyan-700/30 rounded py-1 transition-colors"
      >
        + Import .hol project
      </button>

      <div className="flex gap-1">
        <button onClick={selectAllVirtual} className="flex-1 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors">All</button>
        <button onClick={deselectAllTracks} className="flex-1 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors">None</button>
      </div>

      {selectedIds.length > 0 && (
        <div className="px-2 py-1.5 bg-cyan-900/20 border border-cyan-700/30 rounded">
          <div className="text-cyan-400 text-[9px] font-mono">OSC IDs ({selectedIds.length})</div>
          <div className="text-white text-[10px] font-mono truncate">{selectedIds.join(', ')}</div>
        </div>
      )}

      {/* Track list virtuel */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {virtualTracks.map((track) => {
          const selected = selectedTrackIds.has(track.id);
          return (
            <div key={track.id} className={`p-1.5 rounded border transition-colors ${selected ? 'bg-cyan-900/30 border-cyan-600/50' : 'bg-gray-800/30 border-gray-700/30 hover:bg-gray-800/60'}`}>
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleTrackSelection(track.id)}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: track.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-[11px] font-medium truncate">{track.name}</div>
                  <div className="text-gray-500 text-[9px] font-mono">#{track.id}</div>
                </div>
                <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${selected ? 'bg-cyan-600 border-cyan-500' : 'border-gray-600'}`}>
                  {selected && <span className="text-white text-[8px]">✓</span>}
                </div>
              </div>
            </div>
          );
        })}
        {manualOscIds.length === 0 && (
          <div className="text-gray-500 text-[10px] text-center py-4">
            No track IDs set. Add some in the OSC settings.
          </div>
        )}
      </div>
    </div>
  );
}
