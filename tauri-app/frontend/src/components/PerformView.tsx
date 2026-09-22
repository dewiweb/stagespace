import React from 'react';
import Scene3D from './Scene3D';
import CuelistPanel from './CuelistPanel';
import { Slider } from './ui/Slider';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { PARAM_SCHEMA, type NodeParamValue, type GraphNodeData } from './nodeParamSchema';
import type { NodeType } from '../store/types/index';
import { toast } from '../utils/toast-helpers';

/// ── PERFORM VIEW ──
/// Surface live réduite : setlist + cues + canvas + params live à la demande.
/// Ce qui est volontairement absent : node editor, templates/bibliothèque,
/// config OSC, suppression/renommage — tout ce qui peut casser le show.
///
/// Sémantique : tap ▶/■ = layer parallèle · GO = setlist crossfade ·
/// RECALL cue = Shift+Enter (ou double-clic cue) · Esc = panic.

/// Types de nodes "engine" — même liste que l'Inspector (params live du move)
const ENGINE_TYPES = new Set([
  'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
  'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
  'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
  'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField',
  'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
  'Mix', 'Group', 'Sequence', 'Crossfade',
]);

export const PerformView: React.FC = () => {
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const setlistOrder = useGraphStore((s) => s.setlistOrder);
  const currentSetlistIndex = useGraphStore((s) => s.currentSetlistIndex);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  const playSlot = useGraphStore((s) => s.playSlot);
  const stopSlot = useGraphStore((s) => s.stopSlot);
  const goToNextMove = useGraphStore((s) => s.goToNextMove);
  const panic = useGraphStore((s) => s.panic);
  const pendingPlays = useGraphStore((s) => s.pendingPlays);
  const perfStats = useGraphStore((s) => s.perfStats);
  const isRecalling = useCuelistStore((s) => s.isRecalling);

  const [goFeedback, setGoFeedback] = React.useState<string | null>(null);

  const playingCount = moveSlots.filter((s) => s.movementId).length;

  const nextSetlistSlotId =
    currentSetlistIndex >= 0 && currentSetlistIndex + 1 < setlistOrder.length
      ? setlistOrder[currentSetlistIndex + 1]
      : setlistOrder.length > 0 && currentSetlistIndex < 0
        ? setlistOrder[0]
        : null;
  const nextSetlistSlot = nextSetlistSlotId
    ? moveSlots.find((s) => s.id === nextSetlistSlotId)
    : null;

  const handleGO = async () => {
    const msg = await goToNextMove();
    if (msg) {
      setGoFeedback(msg.startsWith('GO:') ? `ok:${msg}` : `err:${msg}`);
      setTimeout(() => setGoFeedback(null), 3000);
    }
  };

  // Ordre d'affichage : setlist d'abord (dans l'ordre), puis les autres slots
  const orderedSlots = [
    ...setlistOrder.map((id) => moveSlots.find((s) => s.id === id)).filter(Boolean),
    ...moveSlots.filter((s) => !setlistOrder.includes(s.id)),
  ] as typeof moveSlots;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-stagespace-bg">
      {/* ═══ Top bar — statut + GO + PANIC ═══ */}
      <div className="h-14 flex items-center gap-4 px-4 border-b border-stagespace-border bg-stagespace-panel flex-shrink-0">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              playingCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
            }`}
          />
          <span className="text-white text-sm font-bold tabular-nums">
            {playingCount > 0 ? `${playingCount} LIVE` : 'IDLE'}
          </span>
          {perfStats && playingCount > 0 && (
            <span
              className={`text-[10px] font-mono ${
                perfStats.oscErrorRate > 0.05
                  ? 'text-red-400'
                  : 'text-gray-500'
              }`}
            >
              {perfStats.oscRate.toFixed(0)} osc/s
            </span>
          )}
        </div>

        <div className="w-px h-6 bg-stagespace-border" />

        {/* Setlist position + next */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-gray-500 text-[10px] uppercase tracking-wider flex-shrink-0">
            Setlist {currentSetlistIndex + 1}/{setlistOrder.length}
          </span>
          <div className="min-w-0">
            <div className="text-gray-500 text-[9px]">next</div>
            <div className="text-white text-sm font-semibold truncate">
              {nextSetlistSlot?.name ?? '—'}
            </div>
          </div>
          {goFeedback && (
            <span
              className={`text-[10px] animate-pulse ${
                goFeedback.startsWith('ok:') ? 'text-green-400' : 'text-red-400 font-bold'
              }`}
            >
              {goFeedback.slice(4)}
            </span>
          )}
        </div>

        <button
          onClick={handleGO}
          disabled={!nextSetlistSlotId}
          className="px-8 py-2.5 bg-green-600 hover:bg-green-500 text-white text-lg font-black rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
          title="GO : prochain move de la setlist (Enter) — RECALL cue = Shift+Enter"
        >
          GO ▶
        </button>
        <button
          onClick={() => {
            if (isRecalling) return;
            panic();
            toast.warning('PANIC — all moves stopped');
          }}
          className="px-5 py-2.5 bg-red-700 hover:bg-red-600 text-white text-sm font-black rounded-lg transition-colors active:scale-95"
          title="PANIC : stop tout + positions d'origine (Esc)"
        >
          ■ PANIC
        </button>
      </div>

      {/* ═══ Corps : setlist | canvas ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Colonne gauche : moves (layers) + cues */}
        <div className="w-72 flex-shrink-0 border-r border-stagespace-border flex flex-col bg-stagespace-panel min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-3 py-2 text-gray-500 text-[10px] uppercase tracking-wider border-b border-stagespace-border">
              Moves — tap ▶ = layer
            </div>
            {orderedSlots.map((slot) => {
              const isPlaying = !!slot.movementId || pendingPlays.includes(slot.id);
              const isSelected = editingSlotId === slot.id;
              const setlistIdx = setlistOrder.indexOf(slot.id);
              const isCurrentSetlist = setlistIdx === currentSetlistIndex;
              return (
                <div
                  key={slot.id}
                  onClick={() => selectSlotForEditing(isSelected ? null : slot.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-800/40 transition-colors ${
                    isSelected
                      ? 'bg-indigo-900/30 ring-1 ring-inset ring-indigo-600/60'
                      : isPlaying
                        ? 'bg-green-900/10 hover:bg-green-900/20'
                        : 'hover:bg-gray-800/30'
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPlaying) stopSlot(slot.id);
                      else playSlot(slot.id);
                    }}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors active:scale-95 ${
                      isPlaying
                        ? 'bg-red-800/80 hover:bg-red-700 text-red-200'
                        : 'bg-green-800/80 hover:bg-green-700 text-green-200'
                    }`}
                    title={isPlaying ? 'Stop ce move' : 'Lancer (en layer — les autres continuent)'}
                  >
                    {isPlaying ? '■' : '▶'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white text-xs font-medium truncate">{slot.name}</span>
                      {isPlaying && (
                        <span
                          className={`text-[8px] px-1 rounded ${
                            slot.isPreview ? 'bg-cyan-900 text-cyan-300' : 'bg-green-900 text-green-300'
                          }`}
                        >
                          {slot.isPreview ? 'PREV' : 'LIVE'}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-600 text-[9px]">
                      {slot.trackIds.length} trk
                      {setlistIdx >= 0 && (
                        <span className={isCurrentSetlist ? 'text-purple-400' : ''}>
                          {' '}· set {setlistIdx + 1}
                        </span>
                      )}
                    </div>
                  </div>
                  {isCurrentSetlist && (
                    <span className="text-purple-400 text-[10px] font-bold" title="Setlist courante">●</span>
                  )}
                </div>
              );
            })}
            {orderedSlots.length === 0 && (
              <div className="px-3 py-6 text-center text-gray-600 text-[11px]">
                Aucun move — quitter Perform (⚙ header) pour en créer.
              </div>
            )}
          </div>
          {/* Cues — arm + double-clic recall (déjà protégé) */}
          <div className="h-56 flex-shrink-0 border-t border-stagespace-border flex flex-col min-h-0">
            <CuelistPanel />
          </div>
        </div>

        {/* Canvas 3D */}
        <div className="flex-1 min-w-0">
          <Scene3D width="100%" height="100%" />
        </div>
      </div>

      {/* ═══ Bottom : chips live + drawer params ═══ */}
      <LiveDrawer />
    </div>
  );
};

/// Chips des moves live + drawer de params live pour le move sélectionné.
/// Le drawer écrit via updateCurrent/updateNodeData → write-through vers le
/// slot + hot-swap backend (update_animation_state / update_move_graph_merged).
const LiveDrawer: React.FC = () => {
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  const setSlotMacros = useGraphStore((s) => s.setSlotMacros);
  const setSlotDirection = useGraphStore((s) => s.setSlotDirection);
  const setSlotLoopMode = useGraphStore((s) => s.setSlotLoopMode);
  const nodes = useGraphStore((s) => s.nodes);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const updateCurrent = useAnimationStore((s) => s.updateCurrent);
  const current = useAnimationStore((s) => s.current);

  const slot = moveSlots.find((s) => s.id === editingSlotId);
  const playingSlots = moveSlots.filter((s) => s.movementId);

  // Node engine principal du graphe chargé (= celui du slot en édition)
  const engineNode = React.useMemo(
    () => nodes.find((n) => ENGINE_TYPES.has((n.data as GraphNodeData)?.type ?? '')),
    [nodes],
  );
  const engineType = (engineNode?.data as GraphNodeData | undefined)?.type as NodeType | undefined;
  const engineSchema = engineType ? PARAM_SCHEMA[engineType] ?? [] : [];
  const engineParams = ((engineNode?.data as GraphNodeData | undefined)?.params ?? {}) as Record<string, NodeParamValue>;

  const setEngineParam = (key: string, value: NodeParamValue) => {
    if (!engineNode) return;
    // Hot-swap debouncé intégré dans updateNodeData (updateGraphLive interne)
    updateNodeData(engineNode.id, { params: { ...engineParams, [key]: value } });
  };

  return (
    <div className="flex-shrink-0 border-t border-stagespace-border bg-stagespace-panel">
      {/* Chips des moves live — tap = ouvrir le drawer params */}
      <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto">
        <span className="text-gray-500 text-[9px] uppercase tracking-wider flex-shrink-0">
          Live{playingSlots.length > 0 ? ` ${playingSlots.length}` : ''}
        </span>
        {playingSlots.map((s) => (
          <button
            key={s.id}
            onClick={() => selectSlotForEditing(editingSlotId === s.id ? null : s.id)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
              editingSlotId === s.id
                ? 'bg-indigo-600 text-white'
                : 'bg-green-900/40 text-green-300 hover:bg-green-800/50 border border-green-800/50'
            }`}
            title="Params live de ce move"
          >
            {s.isPreview ? '◌' : '●'} {s.name}
          </button>
        ))}
        {playingSlots.length === 0 && (
          <span className="text-gray-600 text-[10px]">aucun move actif — ▶ sur la setlist</span>
        )}
      </div>

      {/* Drawer params — visible seulement quand un move est sélectionné */}
      {slot && (
        <div className="border-t border-stagespace-border px-4 py-2 flex items-start gap-6 overflow-x-auto">
          {/* Bloc lecture : speed / direction / loop / fades */}
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white text-xs font-bold truncate">{slot.name}</span>
              <button
                onClick={() => selectSlotForEditing(null)}
                className="ml-auto text-gray-500 hover:text-white text-xs px-1"
                title="Fermer les params"
              >
                ✕
              </button>
            </div>
            <Slider
              label="Speed"
              value={slot.macros.speed}
              min={0}
              max={3}
              step={0.05}
              unit="x"
              accent="green"
              live={!!slot.movementId}
              onChange={(v) => setSlotMacros(slot.id, { speed: v })}
            />
            <div className="flex gap-1">
              {(['forward', 'backward', 'ping_pong'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setSlotDirection(slot.id, d)}
                  className={`flex-1 py-1 text-[9px] rounded ${
                    slot.direction === d
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {d === 'ping_pong' ? 'pingpong' : d}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(['loop', 'oneshot'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setSlotLoopMode(slot.id, l)}
                  className={`flex-1 py-1 text-[9px] rounded ${
                    slot.loopMode === l
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Slider
                  label="Fade in"
                  value={current.fade_in}
                  min={0}
                  max={5}
                  step={0.1}
                  unit="s"
                  accent="purple"
                  live={!!slot.movementId}
                  onChange={(v) => updateCurrent({ fade_in: v })}
                />
              </div>
              <div className="flex-1">
                <Slider
                  label="Fade out"
                  value={current.fade_out}
                  min={0}
                  max={5}
                  step={0.1}
                  unit="s"
                  accent="purple"
                  live={!!slot.movementId}
                  onChange={(v) => updateCurrent({ fade_out: v })}
                />
              </div>
            </div>
          </div>

          {/* Bloc engine params — le cœur du live tweaking */}
          {engineSchema.length > 0 && (
            <div className="flex-shrink-0 w-72 space-y-1">
              <div className="text-gray-500 text-[9px] uppercase tracking-wider">
                {engineType} params
              </div>
              <div className="grid grid-cols-1 gap-1">
                {engineSchema
                  .filter((d) => d.type === 'number' && typeof d.min === 'number' && typeof d.max === 'number')
                  .slice(0, 6)
                  .map((d) => (
                    <Slider
                      key={d.key}
                      label={d.label}
                      value={typeof engineParams[d.key] === 'number' ? (engineParams[d.key] as number) : 0}
                      min={d.min!}
                      max={d.max!}
                      step={d.step ?? 0.1}
                      accent="cyan"
                      live={!!slot.movementId}
                      onChange={(v) => setEngineParam(d.key, v)}
                    />
                  ))}
              </div>
              {engineSchema.some((d) => d.type !== 'number' || d.min === undefined || d.max === undefined) && (
                <div className="text-gray-700 text-[9px]">
                  params non-numériques → mode Edit
                </div>
              )}
            </div>
          )}

          {/* Bloc audio mods + tracks — readout compact */}
          <div className="flex-shrink-0 w-48 space-y-1">
            <div className="text-gray-500 text-[9px] uppercase tracking-wider">Audio / tracks</div>
            {slot.audioMods.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {slot.audioMods.map((m, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-cyan-900/30 text-cyan-300 text-[9px] rounded">
                    {typeof m.source === 'string' ? m.source : 'fft'}→{m.target} ×{m.amount}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-gray-700 text-[9px]">pas de mod audio</div>
            )}
            <div className="text-gray-600 text-[9px]">
              tracks: {slot.trackIds.join(', ') || '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PerformView;
