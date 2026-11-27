import React from 'react';
import { TrackAssignment, useMoveEditorStore } from '../store/useMoveEditorStore';
import EmptyState from './ui/EmptyState';
import ContextMenu from './ui/ContextMenu';
import { trackColor } from '../utils/trackColor';
import { TRACK_PATTERNS, applySelectionPattern, SelectionPattern } from '../utils/trackPatterns';
import { buildObjectMenuItems } from '../utils/objectMenuItems';
import { useGraphStore } from '../store/useGraphStore';
import { sourceHex, SOURCE_LABEL } from '../utils/sourceColors';

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
  /// Remplace la sélection entière (patterns + all/none). C'est au
  /// parent de router vers la bonne cible : sélection globale
  /// (Inspector) ou trackIds du slot (LiveDrawer) — sinon les patterns
  /// mutent le mauvais espace.
  setTrackSelection: (ids: number[]) => void;
  assignments: TrackAssignment[];
  /// Omis = mode select-only (ex. le picker modal de MovesTable, qui stage
  /// l'appartenance et n'édite pas la depth) : le toggle Select/Depth est
  /// caché et les patterns n'écrivent pas de patches depth.
  updateAssignment?: (trackId: number, patch: Partial<TrackAssignment>) => void;
  /// Mode dense pour le drawer Perform (pleine largeur) : cellules petites,
  /// grille auto-fill au lieu de 4 colonnes fixes.
  compact?: boolean;
}




export const TrackGrid: React.FC<TrackGridProps> = ({
  tracks, selectedTrackIds, toggleTrackSelection,
  setTrackSelection,
  assignments, updateAssignment,
  compact = false,
}) => {
  const [showDepth, setShowDepth] = React.useState(false);
  // État de contrôle par objet (park/freeze/hold/manual) — marqueur sur
  // la cellule, même palette que le radar (sourceColors). Subscription
  // réactive : l'état bouge en live (attention, panic, unpark…).
  const objectStates = useGraphStore((s) => s.objectStates);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  /// États à marquer sur la bordure — les « reprises de contrôle »
  /// (famille HeldState). move/track/psn = régime normal → pas de marque.
  const MARKED = new Set(['park', 'freeze', 'hold', 'manual']);
  const stateOf = (trackId: number) => {
    const obj = manualOscIds.indexOf(trackId);
    return obj >= 0 ? objectStates[obj] : undefined;
  };

  // Applique un pattern de sélection
  const applyPattern = (pattern: SelectionPattern) => {
    const ids = tracks.map((t) => t.id);
    if (ids.length === 0) return;
    const nextSel = applySelectionPattern(pattern, ids, selectedTrackIds);
    // Batch : une sélection + un set d'assignments par pattern — pas
    // N×toggle/updateAssignment = N syncs + N pushes live. Les patterns
    // de choix (all/even/odd/halves) initialisent depth à 1 sur les
    // tracks retenues ; none/inverse sont des sélections pures.
    const patches =
      !updateAssignment || pattern === 'none' || pattern === 'inverse'
        ? []
        : nextSel.map((id) => ({ trackId: id, patch: { depth: 1.0 } }));
    setTrackSelection(nextSel);
    if (patches.length > 0) useMoveEditorStore.getState().updateAssignments(patches);
  };

  // Compte des tracks affectées
  const assignedCount = tracks.filter((t) => selectedTrackIds.has(t.id)).length;
  const totalDepth = tracks.reduce((sum, t) => {
    const asg = assignments.find((a) => a.track_id === t.id);
    return sum + (asg?.depth ?? (selectedTrackIds.has(t.id) ? 1.0 : 0.0));
  }, 0);

  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number } | null>(null);
  // Clic-droit sur une cellule = menu OBJET (release/park/copy pos —
  // mêmes ops que radar/3D) ; sur le fond = patterns de sélection.
  const [objMenu, setObjMenu] = React.useState<{ x: number; y: number; trackId: number } | null>(null);
  const cellCtx = (e: React.MouseEvent, trackId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setObjMenu({ x: e.clientX, y: e.clientY, trackId });
  };

  return (
    <div
      className="space-y-2"
      onContextMenu={(e) => {
        // Clic-droit n'importe où sur la grille → patterns de sélection
        // (les mêmes que la barre — découvrabilité menu contextuel).
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          header="Select tracks"
          onClose={() => setCtxMenu(null)}
          items={TRACK_PATTERNS.map((p) => ({ label: p.label, title: p.title, onClick: () => applyPattern(p.id) }))}
        />
      )}
      {objMenu && (() => {
        // Boundary track_id → obj_index (AGENTS.md : obj_index partout
        // sur le wire ; les UIs opérateur parlent track_id).
        const gs = useGraphStore.getState();
        const obj = gs.manualOscIds.indexOf(objMenu.trackId);
        if (obj < 0) return null;
        const src = gs.objectStates[obj] ?? 'move';
        return (
          <ContextMenu
            x={objMenu.x}
            y={objMenu.y}
            header={`Track ${objMenu.trackId} · obj ${obj + 1}`}
            onClose={() => setObjMenu(null)}
            items={buildObjectMenuItems(obj, src, gs.emittedPositions[obj])}
          />
        );
      })()}
      {/* Barre de patterns */}
      <div className="flex flex-wrap gap-0.5">
        {TRACK_PATTERNS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPattern(p.id)}
            title={p.title}
            className="px-1.5 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Toggle depth view (absent en select-only) + compteur */}
      <div className="flex items-center gap-2">
        {updateAssignment && (
          <button
            onClick={() => setShowDepth(!showDepth)}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              showDepth ? 'bg-stagespace-accent text-gray-950' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {showDepth ? 'Depth' : 'Select'}
          </button>
        )}
        <span className="text-gray-500 text-xs font-mono ml-auto">
          {assignedCount}/{tracks.length}
          {updateAssignment && ` · Σ=${totalDepth.toFixed(1)}`}
        </span>
      </div>

      {tracks.length === 0 && (
        <EmptyState
          size="sm"
          title="No tracks yet"
          hint="Import a .hol project (menu File) to see real track IDs, names and colours — or assign track IDs in the move's params."
        />
      )}

      {/* Grille de tracks — compact = auto-fill petites cellules (drawer
          Perform pleine largeur) ; sinon 4 colonnes (Inspector étroit) */}
      <div className={`grid gap-1 overflow-y-auto p-0.5 ${
        compact ? 'grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] max-h-44' : 'grid-cols-4 max-h-40'
      }`}>
        {tracks.map((t, i) => {
          const isSelected = selectedTrackIds.has(t.id);
          const asg = assignments.find((a) => a.track_id === t.id);
          const depth = asg?.depth ?? 1.0;
          const color = t.color ?? trackColor(i, tracks.length);
          const src = stateOf(t.id);
          const markHex = src && MARKED.has(src) ? sourceHex(src) : undefined;
          const stateSuffix = src && src !== 'move' && src !== 'track' ? ` — ${SOURCE_LABEL[src] ?? src}` : '';

          if (showDepth) {
            // Mode depth : chaque track montre son slider de profondeur
            return (
              <div
                key={t.id}
                className={`relative rounded-lg p-1 transition-all cursor-pointer border ${compact ? 'col-span-2' : ''} ${
                  isSelected
                    ? 'bg-stagespace-accent/15'
                    : 'bg-gray-800/40 opacity-50'
                } ${markHex ? '' : isSelected ? 'border-stagespace-accent/50' : 'border-gray-700/30'}`}
                style={markHex ? { borderColor: markHex } : undefined}
                onClick={() => toggleTrackSelection(t.id)}
                onContextMenu={(e) => cellCtx(e, t.id)}
                title={`${t.name} (#${t.id})${stateSuffix} — depth: ${Math.round(depth * 100)}%`}
              >
                {/* Color dot + ID */}
                <div className="flex items-center gap-1 mb-0.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-white text-xs font-mono">{t.id}</span>
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
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-mono text-white/80">
                    {Math.round(depth * 100)}
                  </span>
                </div>
                {/* Mini depth slider */}
                {isSelected && updateAssignment && (
                  <input
                    type="range" min={0} max={1} step={0.05} value={depth}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateAssignment(t.id, { depth: parseFloat(e.target.value) });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-0.5 mt-0.5 accent-stagespace-accent"
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
              onContextMenu={(e) => cellCtx(e, t.id)}
              className={`relative ${compact ? 'h-9' : 'aspect-square'} rounded-lg flex ${compact ? 'flex-row gap-1 px-1' : 'flex-col'} items-center justify-center transition-all border-2 ${
                isSelected ? 'bg-stagespace-accent/15' : 'bg-gray-800/40'
              } ${markHex ? '' : isSelected ? 'border-stagespace-accent' : 'border-gray-700/30 hover:border-gray-600'} ${compact ? '' : isSelected ? 'scale-105' : ''}`}
              style={markHex ? { borderColor: markHex } : undefined}
              title={`${t.name} (#${t.id})${stateSuffix}`}
            >
              {/* Color indicator */}
              <div
                className={`${compact ? 'w-2 h-2' : 'w-3 h-3 mb-0.5'} rounded-full flex-shrink-0`}
                style={{
                  backgroundColor: color,
                  opacity: isSelected ? 1.0 : 0.3,
                }}
              />
              <span className={`text-xs font-mono ${isSelected ? 'text-white' : 'text-gray-400'}`}>
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
        <div className="text-gray-500 text-xs text-center">
          Click a track to assign it · drag the slider for depth
        </div>
      )}
    </div>
  );
};
