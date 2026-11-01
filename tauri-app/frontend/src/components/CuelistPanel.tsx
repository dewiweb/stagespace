import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useCuelistStore, type CueData } from '../store/useCuelistStore';
import { useGraphStore } from '../store/useGraphStore';
import { doCuePrev, doCueNext, doCueRecallById } from '../utils/liveActions';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import { ConfirmModal } from './ui/ConfirmModal';
import EmptyState from './ui/EmptyState';
import { Badge } from './ui/Badge';
import { toast } from '../utils/toast-helpers';
import { useOscArmed } from '../hooks/useOscArmed';

export const CuelistPanel: React.FC = () => {
  const cues = useCuelistStore((s) => s.cues);
  const currentCueIndex = useCuelistStore((s) => s.currentCueIndex);
  const isRecalling = useCuelistStore((s) => s.isRecalling);
  const storeCue = useCuelistStore((s) => s.storeCue);
  const pending = useCuelistStore((s) => s.pending);
  const deleteCue = useCuelistStore((s) => s.deleteCue);
  const updateCue = useCuelistStore((s) => s.updateCue);
  // Rappels/next/prev passent par liveActions (guard recallBusy unifié).

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
  const signalNodes = useSignalGraphStore((s) => s.nodes);
  const signalEdges = useSignalGraphStore((s) => s.edges);

  const handleStoreCue = async () => {
    if (!newCueName.trim()) return;
    const slot = moveSlots.find((s) => s.id === editingSlotId);
    const graphJson = { nodes, edges };

    // Récupérer le graph global + le graph de modulation (domaine signal)
    const globalGraphJson = { nodes: globalNodes, edges: globalEdges };
    // Un graphe signal sans SignalOut ne compile pas (sortie obligatoire)
    // — le stocker rendrait le cue irrévocable. Sans sortie = pas de
    // modulation à mémoriser → null.
    const hasSignalOut = signalNodes.some(
      (n) => (n.data as { type?: string }).type === 'SignalOut'
    );
    const signalGraphJson = hasSignalOut ? { nodes: signalNodes, edges: signalEdges } : null;

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
      signal_graph: signalGraphJson,
      active_move_ids: activeMoveIds,
      per_track_depths: [],
      manual_positions: manualPosMap,
      mode: 'Full' as const,
      scope: {
        moves: true, channels: true, positions: true, zones: true,
        global_graph: true, signal_graph: true, macros: true, osc_mappings: true,
      },
      pre_wait: 0,
      follow: null,
      timecode: null,
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
        <span className="text-gray-400 text-xs">{cues.length}</span>
        <TcStatus />
        <div className="flex-1" />
        {/* GO buttons */}
        <button
          onClick={() => doCuePrev('cuelist')}
          disabled={currentCueIndex <= 0 || isRecalling}
          className="px-1.5 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded disabled:opacity-30"
          title="Previous cue"
        >
          ◀
        </button>
        <span className="text-gray-500 text-xs tabular-nums">
          {currentCueIndex + 1}/{cues.length}
        </span>
        <button
          onClick={() => doCueNext('cuelist')}
          disabled={currentCueIndex + 1 >= cues.length || isRecalling}
          className="px-1.5 py-0.5 text-xs bg-purple-800 hover:bg-purple-700 text-purple-200 rounded disabled:opacity-30"
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
          className="flex-1 px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
        />
        <input
          type="number"
          min={0}
          step={0.1}
          value={newCueFade}
          onChange={(e) => setNewCueFade(Math.max(0, Number(e.target.value) || 0))}
          title="Crossfade duration on recall (s)"
          className="w-14 px-1.5 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-white text-right font-mono focus:outline-none focus:border-purple-500"
        />
        <button
          onClick={handleStoreCue}
          disabled={!newCueName.trim()}
          className="px-2 py-1 text-xs bg-purple-700 hover:bg-purple-600 text-white rounded disabled:opacity-30 font-medium"
        >
          ★ Store
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {cues.length === 0 ? (
          <div className="px-3 py-3">
            <EmptyState
              size="sm"
              title="No cues"
              hint="A cue snapshots all running moves — store one, recall it live (Shift+Enter)."
            />
          </div>
        ) : (
          <div className="divide-y divide-stagespace-border">
            {cues.map((cue, idx) => (
              <React.Fragment key={cue.id}>
              <div
                key={cue.id + '-row'}
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
                  doCueRecallById(cue.id, undefined, 'cuelist');
                }}
                title={idx === currentCueIndex ? 'Current cue' : 'Click = arm · double-click = RECALL (replaces the whole scene)'}
              >
                <span className="text-gray-500 text-xs tabular-nums w-6">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-medium truncate flex items-center gap-1">
                    {cue.name}
                    {cue.id === armedCueId && (() => {
                      // Même contrat que le backend : scope gate chaque
                      // catégorie + matching par movement.id (le backend
                      // compare active_ids à cue.moves[].id — pas de name).
                      const scope = cue.scope ?? {};
                      const movesOn = scope.moves !== false;
                      const posOn = scope.positions !== false;
                      const activeIds = new Set(movements.map((m) => m.id));
                      const start = movesOn ? (cue.moves ?? []).filter((m) => !activeIds.has(m.id)).length : 0;
                      const stop = movesOn && cue.mode !== 'Tracking'
                        ? movements.filter((m) => !(cue.moves ?? []).some((cm) => cm.id === m.id)).length
                        : 0;
                      const pos = posOn ? Object.keys(cue.manual_positions ?? {}).length : 0;
                      const parts = [
                        start > 0 && `+${start}m`,
                        stop > 0 && `−${stop}m`,
                        pos > 0 && `${pos}pos`,
                      ].filter(Boolean).join(' ');
                      return parts ? <span className="text-[9px] text-amber-400 font-mono" title="audition : ce que la cue va toucher (scope-respecté)">{parts}</span> : null;
                    })()}
                    {cue.mode === 'Tracking' && (
                      <Badge className="bg-cyan-900/60 text-cyan-300">TRK</Badge>
                    )}
                    {(cue.pre_wait ?? 0) > 0 && (
                      <Badge>w{cue.pre_wait}s</Badge>
                    )}
                    {cue.follow != null && (
                      <Badge
                        danger={idx + 1 === cues.length}
                        title={
                          idx + 1 === cues.length
                            ? 'Follow has no next cue — it will never fire'
                            : 'auto-follow (s)'
                        }
                      >
                        f{cue.follow}s{idx + 1 === cues.length ? '!' : ''}
                      </Badge>
                    )}
                    {cue.timecode != null && (
                      <Badge>TC</Badge>
                    )}
                    {pending?.cueId === cue.id && (
                      <PendingCountdown deadline={pending.deadline} kind={pending.kind} />
                    )}
                  </div>
                  <div className="text-gray-400 text-xs truncate flex items-center gap-1.5">
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
                    {cue.id === armedCueId && (
                      <span
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={cue.mode ?? 'Full'}
                          onChange={(e) =>
                            updateCue({ ...cue, mode: e.target.value as 'Full' | 'Tracking' })
                          }
                          className="bg-gray-900 border border-gray-700 rounded text-gray-300 text-[10px] px-0.5"
                        >
                          <option value="Full">Full</option>
                          <option value="Tracking">Tracking</option>
                        </select>
                        {cue.mode === 'Tracking' && (
                          <ScopeEditor cue={cue} updateCue={updateCue} />
                        )}
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          title="pre-wait (s)"
                          defaultValue={cue.pre_wait ?? 0}
                          key={`${cue.id}-pw-${cue.pre_wait}`}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value));
                            if (!isNaN(v)) updateCue({ ...cue, pre_wait: v });
                          }}
                          className="w-10 px-1 py-0 bg-gray-900 border border-gray-700 rounded text-gray-300 text-right font-mono"
                        />
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          placeholder="follow"
                          title="follow (s, vide = off)"
                          defaultValue={cue.follow ?? ''}
                          key={`${cue.id}-fw-${cue.follow}`}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                            updateCue({ ...cue, follow: v });
                          }}
                          className="w-10 px-1 py-0 bg-gray-900 border border-gray-700 rounded text-gray-300 text-right font-mono"
                        />
                        <input
                          type="number"
                          min={0}
                          step={0.04}
                          placeholder="TC s"
                          title="timecode (s, vide = off)"
                          defaultValue={cue.timecode ?? ''}
                          key={`${cue.id}-tc-${cue.timecode}`}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                            updateCue({ ...cue, timecode: v });
                          }}
                          className="w-12 px-1 py-0 bg-gray-900 border border-gray-700 rounded text-gray-300 text-right font-mono"
                        />
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete({ id: cue.id, name: cue.name });
                  }}
                  className="text-gray-400 hover:text-red-400 text-xs px-1"
                  title="Delete"
                >
                  <X size={11} />
                </button>
              </div>
              {/* Audition — où la cue pose les objets, SANS émettre :
                  fantômes cue (manual_positions + move origins) vs
                  positions actuellement émises. */}
              {cue.id === armedCueId && (() => {
                const ghosts: { x: number; y: number; kind: 'pos' | 'origin' }[] = [];
                const posOn = (cue.scope ?? {}).positions !== false;
                if (posOn) {
                  for (const p of Object.values(cue.manual_positions ?? {})) {
                    if (p) ghosts.push({ x: p[0], y: p[1], kind: 'pos' });
                  }
                }
                if ((cue.scope ?? {}).moves !== false) {
                  for (const m of cue.moves ?? []) {
                    const o = m.origin;
                    if (o) ghosts.push({ x: o[0], y: o[1], kind: 'origin' });
                  }
                }
                if (ghosts.length === 0) return null;
                const emitted = useGraphStore.getState().emittedPositions;
                const all = [...ghosts.map((g) => [g.x, g.y]), ...Object.values(emitted)];
                const maxR = Math.max(5, ...all.flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));
                const k = 60 / maxR;
                return (
                  <div className="mx-3 mb-1 bg-gray-900/60 rounded p-1.5">
                    <svg viewBox="-70 -70 140 140" className="w-full h-28">
                      <circle cx="0" cy="0" r="65" fill="none" stroke="#1f2937" strokeWidth="1" />
                      <line x1="0" y1="-65" x2="0" y2="65" stroke="#1f2937" strokeWidth="0.5" />
                      <line x1="-65" y1="0" x2="65" y2="0" stroke="#1f2937" strokeWidth="0.5" />
                      {Object.entries(emitted).map(([id, [x, y]]) => (
                        <circle key={'e' + id} cx={x * k} cy={-y * k} r="2.5" fill="#4b5563" />
                      ))}
                      {ghosts.map((g, i) => (
                        <circle
                          key={i}
                          cx={g.x * k}
                          cy={-g.y * k}
                          r={g.kind === 'pos' ? 4 : 3}
                          fill={g.kind === 'pos' ? '#f59e0b' : 'none'}
                          stroke={g.kind === 'pos' ? 'none' : '#22d3ee'}
                          strokeWidth="1.5"
                        />
                      ))}
                    </svg>
                    <div className="text-[8px] text-gray-500 text-center">
                      ○ actuel · ● cue pos · ○ cyan cue origins — audition, rien n'est émis
                    </div>
                  </div>
                );
              })()}
              </React.Fragment>
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


/// Compte à rebours du timer pendu (pre-wait/follow) sur une cue.
function PendingCountdown({ deadline, kind }: { deadline: number; kind: 'pre_wait' | 'follow' }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, (deadline - Date.now()) / 1000);
  return (
    <Badge className="bg-amber-800/80 text-amber-200" title={kind}>
      {kind === 'pre_wait' ? 'in' : 'follow'} {left.toFixed(1)}s
    </Badge>
  );
}

/// Dry-run : désarme l'OSC (le merge continue, rien ne part au renderer) —
/// permet de répéter la conduite sans envoyer de positions.
function DryRunChip() {
  const [armed, setArmed] = useOscArmed();
  return (
    <button
      onClick={() => setArmed(!armed)}
      className={`px-1.5 py-0.5 rounded border ${armed ? 'border-gray-600 text-gray-500' : 'border-emerald-600 text-emerald-400'}`}
      title={armed ? 'OSC armed — click to rehearse without sending' : 'DRY-RUN — OSC disarmed'}
    >
      {armed ? 'ARM' : 'DRY-RUN'}
    </button>
  );
}

/// Statut timecode : TC courant (HH:MM:SS:FF) ou "TC lost" si silence >1s.
function TcStatus() {
  const tc = useCuelistStore((s) => s.lastTimecode);
  const at = useCuelistStore((s) => s.lastTimecodeAt);
  const chaseOn = useCuelistStore((s) => s.tcChaseEnabled);
  const setChase = useCuelistStore((s) => s.setTcChaseEnabled);
  const fps = useGraphStore((s) => s.timecodeFps);
  const setFps = useGraphStore((s) => s.setTimecodeFps);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  // Applique la valeur persistée au receiver au montage — la conversion
  // HH:MM:SS:FF côté backend doit correspondre à l'affichage ici.
  useEffect(() => {
    setFps(fps);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply persisted value once
  }, []);
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const f = Math.floor((s % 1) * fps);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };
  const lost = tc == null || Date.now() - at > 1000;
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[10px]">
      <DryRunChip />
      <button
        onClick={() => setChase(!chaseOn)}
        className={`px-1.5 py-0.5 rounded border ${chaseOn ? 'border-emerald-600 text-emerald-400' : 'border-gray-600 text-gray-500'}`}
        title="TC chase"
      >
        TC chase
      </button>
      <span className="font-mono text-gray-400">{lost ? 'TC lost' : fmt(tc!)}</span>
      <select
        value={fps}
        onChange={(e) => setFps(Number(e.target.value))}
        className="bg-transparent border border-gray-600 rounded text-gray-400 px-0.5"
        title="Timecode frame rate"
      >
        {[24, 25, 30].map((f) => <option key={f} value={f}>{f}fps</option>)}
      </select>
    </span>
  );
}

/// Checkboxes de scope pour une cue Tracking.
function ScopeEditor({ cue, updateCue }: { cue: CueData; updateCue: (c: CueData) => void }) {
  const SCOPE_KEYS = ['moves','channels','positions','zones','global_graph','signal_graph','macros','osc_mappings'] as const;
  const scope = cue.scope ?? Object.fromEntries(SCOPE_KEYS.map((k) => [k, true]));
  return (
    <span className="flex items-center gap-0.5">
      {SCOPE_KEYS.map((k) => (
        <label key={k} className="text-[10px] text-gray-400 flex items-center" title={k}>
          <input
            type="checkbox"
            checked={(scope as Record<string, boolean>)[k] ?? true}
            onChange={(e) =>
              updateCue({ ...cue, scope: { ...scope, [k]: e.target.checked } })
            }
            className="w-2.5 h-2.5"
          />
          {k.slice(0, 3)}
        </label>
      ))}
    </span>
  );
}
