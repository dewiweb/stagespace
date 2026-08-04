import React from 'react';
import { TrackAssignment } from '../store/useAnimationStore';

interface TrackInfo {
  id: number;
  name: string;
  color?: string;
  position?: [number, number, number];
}

interface TrackGridProps {
  tracks: TrackInfo[];
  selectedTrackIds: Set<number>;
  toggleTrackSelection: (id: number) => void;
  selectAllTracks: () => void;
  deselectAllTracks: () => void;
  assignments: TrackAssignment[];
  updateAssignment: (trackId: number, patch: Partial<TrackAssignment>) => void;
}

/// Couleur HSL pour un index
function colorForIndex(i: number, total: number) {
  const hue = (i / Math.max(total, 1)) * 360;
  return `hsl(${hue}, 70%, 55%)`;
}

/// Patterns de sélection rapides
type SelectionPattern = 'all' | 'none' | 'even' | 'odd' | 'first_half' | 'second_half' | 'pairs' | 'inverse';

const PATTERNS: { id: SelectionPattern; label: string; icon: string; title: string }[] = [
  { id: 'all', label: 'All', icon: '◉', title: 'Tout sélectionner (100%)' },
  { id: 'none', label: 'None', icon: '○', title: 'Tout désélectionner' },
  { id: 'even', label: '1 sur 2', icon: '⫼', title: 'Sélectionner un sur deux' },
  { id: 'odd', label: 'Inverse', icon: '⇄', title: 'Inverser la sélection' },
  { id: 'first_half', label: '1ère moitié', icon: '◀', title: 'Première moitié' },
  { id: 'second_half', label: '2ème moitié', icon: '▶', title: 'Deuxième moitié' },
];

export const TrackGrid: React.FC<TrackGridProps> = ({
  tracks, selectedTrackIds, toggleTrackSelection,
  selectAllTracks, deselectAllTracks,
  assignments, updateAssignment,
}) => {
  const [showDepth, setShowDepth] = React.useState(false);

  // Applique un pattern de sélection
  const applyPattern = (pattern: SelectionPattern) => {
    const ids = tracks.map((t) => t.id);
    const n = ids.length;
    if (n === 0) return;

    switch (pattern) {
      case 'all':
        selectAllTracks();
        // Set depth to 100% for all
        ids.forEach((id) => updateAssignment(id, { depth: 1.0 }));
        break;
      case 'none':
        deselectAllTracks();
        break;
      case 'even':
        // Sélectionner un sur deux (indices pairs)
        deselectAllTracks();
        ids.filter((_, i) => i % 2 === 0).forEach((id) => {
          toggleTrackSelection(id);
          updateAssignment(id, { depth: 1.0 });
        });
        break;
      case 'odd':
        // Sélectionner un sur deux (indices impairs)
        deselectAllTracks();
        ids.filter((_, i) => i % 2 === 1).forEach((id) => {
          toggleTrackSelection(id);
          updateAssignment(id, { depth: 1.0 });
        });
        break;
      case 'first_half':
        deselectAllTracks();
        ids.slice(0, Math.ceil(n / 2)).forEach((id) => {
          toggleTrackSelection(id);
          updateAssignment(id, { depth: 1.0 });
        });
        break;
      case 'second_half':
        deselectAllTracks();
        ids.slice(Math.floor(n / 2)).forEach((id) => {
          toggleTrackSelection(id);
          updateAssignment(id, { depth: 1.0 });
        });
        break;
      case 'inverse':
        // Inverser la sélection
        ids.forEach((id) => toggleTrackSelection(id));
        break;
    }
  };

  // Compte des tracks affectées
  const assignedCount = tracks.filter((t) => selectedTrackIds.has(t.id)).length;
  const totalDepth = tracks.reduce((sum, t) => {
    const asg = assignments.find((a) => a.track_id === t.id);
    return sum + (asg?.depth ?? (selectedTrackIds.has(t.id) ? 1.0 : 0.0));
  }, 0);

  return (
    <div className="space-y-2">
      {/* Barre de patterns */}
      <div className="flex flex-wrap gap-0.5">
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPattern(p.id)}
            title={p.title}
            className="px-1.5 py-0.5 text-[8px] bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Toggle depth view */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowDepth(!showDepth)}
          className={`px-1.5 py-0.5 text-[8px] rounded transition-colors ${
            showDepth ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          {showDepth ? '◐ Depth' : '◑ Select'}
        </button>
        <span className="text-gray-500 text-[9px] font-mono ml-auto">
          {assignedCount}/{tracks.length} · Σ={totalDepth.toFixed(1)}
        </span>
      </div>

      {/* Grille de tracks */}
      <div className="grid grid-cols-4 gap-1 max-h-40 overflow-y-auto p-0.5">
        {tracks.map((t, i) => {
          const isSelected = selectedTrackIds.has(t.id);
          const asg = assignments.find((a) => a.track_id === t.id);
          const depth = asg?.depth ?? 1.0;
          const color = t.color ?? colorForIndex(i, tracks.length);

          if (showDepth) {
            // Mode depth : chaque track montre son slider de profondeur
            return (
              <div
                key={t.id}
                className={`relative rounded-lg p-1 transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-blue-900/40 border-blue-600/50'
                    : 'bg-gray-800/40 border-gray-700/30 opacity-50'
                }`}
                onClick={() => toggleTrackSelection(t.id)}
                title={`${t.name} (#${t.id}) — depth: ${Math.round(depth * 100)}%`}
              >
                {/* Color dot + ID */}
                <div className="flex items-center gap-1 mb-0.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-white text-[8px] font-mono">{t.id}</span>
                </div>
                {/* Depth bar — vertical fill */}
                <div className="relative h-8 bg-gray-900/60 rounded overflow-hidden">
                  <div
                    className="absolute bottom-0 left-0 right-0 transition-all"
                    style={{
                      height: `${depth * 100}%`,
                      backgroundColor: color,
                      opacity: 0.7,
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-mono text-white/80">
                    {Math.round(depth * 100)}
                  </span>
                </div>
                {/* Mini depth slider */}
                {isSelected && (
                  <input
                    type="range" min={0} max={1} step={0.05} value={depth}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateAssignment(t.id, { depth: parseFloat(e.target.value) });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-0.5 mt-0.5 accent-cyan-500"
                  />
                )}
              </div>
            );
          }

          // Mode select : simple toggle visuel
          return (
            <button
              key={t.id}
              onClick={() => toggleTrackSelection(t.id)}
              className={`relative aspect-square rounded-lg flex flex-col items-center justify-center transition-all border-2 ${
                isSelected
                  ? 'border-blue-500 bg-blue-900/40 scale-105'
                  : 'border-gray-700/30 bg-gray-800/40 hover:border-gray-600'
              }`}
              title={`${t.name} (#${t.id})`}
            >
              {/* Color indicator */}
              <div
                className="w-3 h-3 rounded-full mb-0.5"
                style={{
                  backgroundColor: color,
                  opacity: isSelected ? 1.0 : 0.3,
                }}
              />
              <span className={`text-[9px] font-mono ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                {t.id}
              </span>
              {/* Depth indicator (mini bar at bottom) */}
              {isSelected && (
                <div className="absolute bottom-0.5 left-1 right-1 h-0.5 bg-gray-900/60 rounded overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{ width: `${depth * 100}%`, backgroundColor: color }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Track details — la track survolée ou sélectionnée */}
      {assignedCount > 0 && showDepth && (
        <div className="text-gray-500 text-[8px] text-center">
          Cliquez une track pour l'affecter · Glissez le slider pour le depth
        </div>
      )}
    </div>
  );
};
