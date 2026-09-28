import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useCuelistStore } from '../store/useCuelistStore';
import { useGraphStore } from '../store/useGraphStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { ConfirmModal } from './ui/ConfirmModal';
import { toast } from '../utils/toast-helpers';

export const CuelistPanel: React.FC = () => {
  const cues = useCuelistStore((s) => s.cues);
  const currentCueIndex = useCuelistStore((s) => s.currentCueIndex);
  const isRecalling = useCuelistStore((s) => s.isRecalling);
  const storeCue = useCuelistStore((s) => s.storeCue);
  const recallCue = useCuelistStore((s) => s.recallCue);
  const deleteCue = useCuelistStore((s) => s.deleteCue);
  const updateCue = useCuelistStore((s) => s.updateCue);
  const goToNextCue = useCuelistStore((s) => s.goToNextCue);
  const goToPreviousCue = useCuelistStore((s) => s.goToPreviousCue);

  const [newCueName, setNewCueName] = useState('');
  const [newCueFade, setNewCueFade] = useState(0.5);
  // Confirmation avant delete — un cue supprimé n'est pas récupérable et
  // le bouton ✕ est adjacent au recall (un misclick live coûte le cue).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  // Arm-before-recall : un simple clic sur un cue l'arme (outline), le
  // double-clic déclenche le recall. Un recall tue TOUS les moves actifs —
  // un misclick en live viderait la scène.
  const [armedCueId, setArmedCueId] = useState<string | null>(null);

  // Récupérer l'état actuel pour le store
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const movements = useGraphStore((s) => s.movements);
  const macros = useGraphStore((s) => s.macros);
  const manualPositions = useGraphStore((s) => s.manualPositions);
  const globalNodes = useGlobalGraphStore((s) => s.nodes);
  const globalEdges = useGlobalGraphStore((s) => s.edges);

  const handleStoreCue = async () => {
    if (!newCueName.trim()) return;
    const slot = moveSlots.find((s) => s.id === editingSlotId);
    const graphJson = { nodes, edges };

    // Récupérer le graph global
    const globalGraphJson = { nodes: globalNodes, edges: globalEdges };

    // IDs des moves actifs
    const activeMoveIds = movements.map((m) => m.id);

    // Manual positions au format HashMap
    const manualPosMap: Record<number, [number, number, number]> = {};
    Object.entries(manualPositions).forEach(([k, v]) => {
      manualPosMap[Number(k)] = v;
    });

    const cueData = {
      name: newCueName.trim(),
      description: '',
      graph: graphJson,
      macros: {
        speed: macros.speed,
        scale: macros.scale,
        shift_x: macros.shiftX,
        shift_y: macros.shiftY,
        shift_z: macros.shiftZ,
        yaw: macros.yaw,
        pitch: macros.pitch,
        roll: macros.roll,
      },
      spatial_macros: {
        radius_scale: macros.radius_scale ?? 1.0,
        height_offset: macros.height_offset ?? 0.0,
      },
      track_indices: slot?.trackIds ?? [],
      fade_duration: newCueFade,
      cue_number: null,
      global_graph: globalGraphJson,
      active_move_ids: activeMoveIds,
      per_track_depths: [],
      manual_positions: manualPosMap,
    };

    try {
      await storeCue(cueData);
      setNewCueName('');
    } catch (e) {
      console.error('[storeCue] Failed:', e);
      toast.error(`Cue not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-stagespace-border flex items-center gap-2">
        <span className="text-gray-300 text-xs font-semibold">Cues</span>
        <span className="text-gray-600 text-[10px]">{cues.length}</span>
        <div className="flex-1" />
        {/* GO buttons */}
        <button
          onClick={() => goToPreviousCue()}
          disabled={currentCueIndex <= 0 || isRecalling}
          className="px-1.5 py-0.5 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded disabled:opacity-30"
          title="Previous cue"
        >
          ◀
        </button>
        <span className="text-gray-500 text-[10px] tabular-nums">
          {currentCueIndex + 1}/{cues.length}
        </span>
        <button
          onClick={() => goToNextCue()}
          disabled={currentCueIndex + 1 >= cues.length || isRecalling}
          className="px-1.5 py-0.5 text-[10px] bg-purple-800 hover:bg-purple-700 text-purple-200 rounded disabled:opacity-30"
          title="Next cue — RECALL replaces the whole scene (kill + respawn). Setlist GO = Enter."
        >
          RECALL ▶
        </button>
      </div>

      {/* Store new cue */}
      <div className="px-3 py-2 border-b border-stagespace-border flex items-center gap-1">
        <input
          type="text"
          value={newCueName}
          onChange={(e) => setNewCueName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleStoreCue()}
          placeholder="Cue name..."
          className="flex-1 px-2 py-1 text-[11px] bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
        />
        <input
          type="number"
          min={0}
          step={0.1}
          value={newCueFade}
          onChange={(e) => setNewCueFade(Math.max(0, Number(e.target.value) || 0))}
          title="Crossfade duration on recall (s)"
          className="w-14 px-1.5 py-1 text-[11px] bg-gray-900 border border-gray-700 rounded text-white text-right font-mono focus:outline-none focus:border-purple-500"
        />
        <button
          onClick={handleStoreCue}
          disabled={!newCueName.trim()}
          className="px-2 py-1 text-[10px] bg-purple-700 hover:bg-purple-600 text-white rounded disabled:opacity-30 font-medium"
        >
          ★ Store
        </button>
      </div>

      {/* Cue list */}
      <div className="flex-1 overflow-y-auto">
        {cues.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-600 text-[11px]">
            No cue. Store the current state with ★ Store.
          </div>
        ) : (
          <div className="divide-y divide-stagespace-border">
            {cues.map((cue, idx) => (
              <div
                key={cue.id}
                className={`px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors ${
                  idx === currentCueIndex
                    ? 'bg-purple-900/30 border-l-2 border-purple-500'
                    : cue.id === armedCueId
                      ? 'bg-purple-900/10 ring-1 ring-inset ring-purple-500/60'
                      : 'hover:bg-gray-800/50'
                }`}
                onClick={() => setArmedCueId(cue.id === armedCueId ? null : cue.id)}
                onDoubleClick={() => {
                  setArmedCueId(null);
                  recallCue(cue.id);
                }}
                title={idx === currentCueIndex ? 'Current cue' : 'Click = arm · double-click = RECALL (replaces the whole scene)'}
              >
                <span className="text-gray-500 text-[10px] tabular-nums w-6">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-[11px] font-medium truncate">
                    {cue.name}
                  </div>
                  <div className="text-gray-600 text-[10px] truncate flex items-center gap-1.5">
                    {cue.active_move_ids.length > 0 && (
                      <span>{cue.active_move_ids.length} move(s)</span>
                    )}
                    {cue.id === armedCueId ? (
                      <label
                        className="flex items-center gap-1 text-amber-400"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        fade
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          defaultValue={cue.fade_duration}
                          key={`${cue.id}-${cue.fade_duration}`}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value));
                            if (!isNaN(v)) updateCue({ ...cue, fade_duration: v });
                          }}
                          className="w-12 px-1 py-0 bg-gray-900 border border-amber-700/60 rounded text-amber-300 text-right font-mono focus:outline-none"
                        />
                        s
                      </label>
                    ) : (
                      <span>· {cue.fade_duration}s</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete({ id: cue.id, name: cue.name });
                  }}
                  className="text-gray-600 hover:text-red-400 text-[10px] px-1"
                  title="Delete"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Delete the cue"
          message={
            <>
              Delete <span className="text-white font-semibold">« {pendingDelete.name} »</span> ?
              <br />
              <span className="text-gray-500">Permanent — the cue cannot be recovered.</span>
            </>
          }
          onConfirm={() => {
            deleteCue(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default CuelistPanel;
