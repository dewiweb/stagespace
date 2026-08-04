import React from 'react';
import { useGraphStore } from '../store/useGraphStore';

export default function MovementsPanel() {
  const { movements, stopMovement, stopAllMovements, refreshMovements, nodes, holProject, selectedTrackIds, manualOscIds } = useGraphStore();

  React.useEffect(() => {
    refreshMovements();
    const interval = setInterval(refreshMovements, 2000);
    return () => clearInterval(interval);
  }, [refreshMovements]);

  const hasGraph = nodes.length > 0;
  const previewCount = movements.filter((m) => m.is_preview).length;
  const liveCount = movements.filter((m) => !m.is_preview).length;

  // Tracks ciblés par le prochain launch (info uniquement — le launch est dans la Toolbar)
  const targetTrackCount = holProject
    ? (selectedTrackIds.size > 0 ? selectedTrackIds.size : holProject.tracks.length)
    : (selectedTrackIds.size > 0 ? selectedTrackIds.size : manualOscIds.length);

  return (
    <div className="p-3 h-full flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
          <span className="text-white text-[10px]">MV</span>
        </div>
        <h3 className="text-white font-semibold text-sm">Movements</h3>
        {movements.length > 0 && (
          <span className="text-indigo-400 text-[10px] ml-auto font-mono">
            {movements.length} active
            {previewCount > 0 && <span className="text-cyan-400"> ({previewCount} preview</span>}
            {previewCount > 0 && liveCount > 0 && <span className="text-gray-500">,</span>}
            {previewCount > 0 && <span className="text-cyan-400">)</span>}
            {liveCount > 0 && <span className="text-green-400"> {liveCount} live</span>}
          </span>
        )}
      </div>

      {/* Info: tracks ciblés par le prochain launch */}
      <div className="text-[10px] text-gray-500 bg-gray-800/30 rounded px-2 py-1.5 border border-gray-700/30">
        <div className="flex items-center justify-between">
          <span>Prochain launch:</span>
          <span className="text-indigo-400 font-mono">{targetTrackCount} tracks</span>
        </div>
        <div className="text-gray-600 text-[9px] mt-0.5">
          {selectedTrackIds.size > 0
            ? '(tracks sélectionnés)'
            : holProject
              ? '(tous les tracks .hol par défaut)'
              : '(tous les manual IDs par défaut)'}
        </div>
      </div>

      {/* Active movements list */}
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {movements.length === 0 ? (
          <div className="text-gray-600 text-[11px] text-center py-4 bg-gray-800/30 rounded border border-gray-700/30">
            Aucun movement actif.
            <br />
            <span className="text-gray-500">Utilise ▶ Launch Live ou 👁 Launch Preview</span>
            <br />
            <span className="text-gray-700">dans la toolbar pour démarrer.</span>
          </div>
        ) : (
          movements.map((mv, idx) => (
            <div
              key={mv.id}
              className={`p-2 rounded border transition-colors ${
                mv.is_preview
                  ? 'bg-cyan-900/20 border-cyan-700/30'
                  : 'bg-green-900/20 border-green-700/30'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[8px] font-mono w-4 h-4 rounded flex items-center justify-center ${
                      mv.is_preview ? 'bg-cyan-800 text-cyan-300' : 'bg-green-800 text-green-300'
                    }`}>
                      {idx + 1}
                    </span>
                    <div className="text-white text-[11px] font-semibold truncate">{mv.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                      mv.is_preview ? 'bg-cyan-800 text-cyan-300' : 'bg-green-800 text-green-300'
                    }`}>
                      {mv.is_preview ? 'PREVIEW' : 'LIVE'}
                    </span>
                    <span className="text-gray-500 text-[9px] font-mono">
                      {mv.track_count} tracks
                    </span>
                    {mv.is_playing && (
                      <span className="text-green-400 text-[9px] animate-pulse">● running</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => stopMovement(mv.id)}
                  className="text-red-400 hover:text-red-300 text-[11px] ml-2 font-medium"
                >
                  ■ Stop
                </button>
              </div>
              {/* Track IDs + perf stats */}
              <div className="text-gray-600 text-[9px] font-mono truncate mt-1 ml-5">
                IDs: {mv.osc_ids.join(', ')}
              </div>
              {/* Per-movement perf stats */}
              {mv.is_playing && mv.fps > 0 && (
                <div className="text-[8px] font-mono mt-0.5 ml-5 flex gap-2">
                  <span className={mv.fps >= 55 ? 'text-green-400' : mv.fps >= 30 ? 'text-yellow-400' : 'text-red-400'}>
                    {mv.fps.toFixed(0)}fps
                  </span>
                  <span className="text-cyan-400">{mv.osc_rate.toFixed(0)}osc/s</span>
                  <span className={mv.cpu_percent < 50 ? 'text-gray-500' : 'text-yellow-400'}>
                    {mv.cpu_percent.toFixed(0)}%cpu
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Stop all */}
      {movements.length > 0 && (
        <button
          onClick={stopAllMovements}
          className="py-1.5 px-3 bg-red-900/50 hover:bg-red-900/70 text-red-400 text-[11px] rounded font-medium transition-colors border border-red-800/50"
        >
          ■ Stop All Movements
        </button>
      )}
    </div>
  );
}
