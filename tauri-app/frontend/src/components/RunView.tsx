/// P2.1 — Surface de jeu (run-view) : l'instrument de conduite, pas
/// l'admin. Grille de pads par slot avec état de jeu (playing/fading/
/// solo/park), transport (GO/panic), santé des flux. Conçue pour être
/// jouée — gros boutons, lecture à distance, états couleur immédiats.
import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { doGo, doPanic, doSlot, doSlotStop, doSolo, doUnsolo } from '../utils/liveActions';

const STATE_COLORS: Record<string, string> = {
  stopped: 'bg-gray-800 text-gray-500 hover:bg-gray-700',
  playing: 'bg-green-700 text-white',
  solo: 'bg-cyan-700 text-white',
  fading: 'bg-amber-700 text-white',
};

export const RunView: React.FC = () => {
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const objectStates = useGraphStore((s) => s.objectStates);
  const flowHealth = useGraphStore((s) => s.flowHealth);
  const currentCueIndex = useCuelistStore((s) => s.currentCueIndex);
  const cues = useCuelistStore((s) => s.cues);

  // Solo — vérité partagée `soloSavedIds` (alimentée par GUI et OSC,
  // les deux passent par doSolo) : après un solo, le seul slot jouant
  // est le slot solo'd — le badge S ne peut pas diverger d'un OSC.
  const soloSavedIds = useGraphStore((s) => s.soloSavedIds);
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  // objectStates est keyed par obj_index (position dans osc_ids) —
  // trackId → objIndex via indexOf, off-by-one pour tracks 1-based.
  const srcOf = (trackId: number) => objectStates[manualOscIds.indexOf(trackId)];
  const playingIds = new Set(moveSlots.filter((s) => s.movementId).map((s) => s.id));
  const soloId =
    soloSavedIds.length > 0
      ? (moveSlots.find((s) => s.movementId)?.id ?? null)
      : null;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white p-4 select-none">
      {/* Transport — gros boutons lisibles à distance. */}
      <div className="flex gap-3 mb-4 items-stretch">
        <button
          onClick={() => doGo(undefined)}
          className="flex-1 py-6 rounded-lg bg-green-700 hover:bg-green-600 text-2xl font-bold tracking-widest"
        >
          GO
        </button>
        <button
          onClick={() => doPanic()}
          className="flex-1 py-6 rounded-lg bg-red-700 hover:bg-red-600 text-2xl font-bold tracking-widest"
        >
          PANIC
        </button>
        <div className="flex flex-col justify-center px-4 rounded-lg bg-gray-900 font-mono text-xs min-w-[140px]">
          <div className="text-gray-400 uppercase tracking-widest">cue</div>
          <div className="text-lg font-bold">
            {currentCueIndex >= 0 ? cues[currentCueIndex]?.name ?? '—' : '—'}
          </div>
          <div className={`text-[10px] ${flowHealth.armed ? 'text-red-300' : 'text-emerald-400'}`}>
            {flowHealth.armed ? 'LIVE' : 'DRY-RUN'}
            {flowHealth.psnRunning && ' · PSN'}
          </div>
        </div>
      </div>

      {/* Grille pads — un pad = un slot, état couleur immédiat. */}
      <div className="flex gap-4 flex-1 min-h-0">
      <div className="grid grid-cols-4 gap-3 flex-1 content-start overflow-y-auto">
        {moveSlots.map((slot) => {
          const playing = playingIds.has(slot.id);
          const solo = soloId === slot.id;
          const parked = slot.trackIds.filter((t) => srcOf(t) === 'park');
          const held = slot.trackIds.filter((t) => srcOf(t) === 'hold');
          const cls = solo ? STATE_COLORS.solo : playing ? STATE_COLORS.playing : STATE_COLORS.stopped;
          return (
            <button
              key={slot.id}
              onClick={() => (playing ? doSlotStop(slot.oscIndex || 0) : doSlot(slot.oscIndex || 0, undefined))}
              onContextMenu={(e) => {
                e.preventDefault();
                if (solo) doUnsolo();
                else doSolo(slot.oscIndex || 0);
              }}
              className={`${cls} rounded-lg p-4 text-left transition-colors relative`}
            >
              <div className="font-bold text-sm truncate">{slot.name}</div>
              <div className="text-[10px] opacity-70 mt-1">
                {slot.trackIds.map((t) => `${t}${srcOf(t) === 'park' ? '⏸' : ''}`).join(' ')}
              </div>
              {parked.length > 0 && <div className="absolute top-1.5 right-1.5 text-[9px] bg-amber-800 px-1 rounded">P</div>}
              {held.length > 0 && <div className="absolute bottom-1.5 right-1.5 text-[9px] bg-cyan-800 px-1 rounded">H</div>}
              {solo && <div className="absolute top-1.5 left-1.5 text-[9px] bg-cyan-900 px-1 rounded">S</div>}
            </button>
          );
        })}
      </div>

      {/* Radar 2D — plan top-down fixe (X/Y), positions RÉELLEMENT émises
          colorées par source-de-contrôle. Lisible à distance, zéro caméra. */}
      <div className="w-64 flex-shrink-0 bg-gray-900 rounded-lg p-2 flex flex-col">
        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">radar · top</div>
        {(() => {
          // Auto-fit : échelle sur les bounds réels (venues >10m
          // n'étaient pas clampées — elles sortaient du cadre).
          const maxR = Math.max(
            5,
            ...Object.values(emittedPositions).flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]),
          );
          const k = 100 / maxR;
          return (
        <svg viewBox="-110 -110 220 220" className="flex-1 min-h-0" preserveAspectRatio="xMidYMid meet">
          <circle cx="0" cy="0" r="105" fill="none" stroke="#1f2937" strokeWidth="1" />
          <circle cx="0" cy="0" r="52" fill="none" stroke="#1f2937" strokeWidth="0.5" />
          <line x1="0" y1="-105" x2="0" y2="105" stroke="#1f2937" strokeWidth="0.5" />
          <line x1="-105" y1="0" x2="105" y2="0" stroke="#1f2937" strokeWidth="0.5" />
          <text x="0" y="-99" fill="#4b5563" fontSize="8" textAnchor="middle">FRONT · {maxR.toFixed(0)}m</text>
          {Object.entries(emittedPositions).map(([id, [x, y]]) => {
            const t = Number(id);
            const src = objectStates[t] ?? 'track';
            const fill = { park: '#f59e0b', psn: '#a855f7', hold: '#22d3ee', manual: '#f97316', move: '#22c55e', track: '#6b7280' }[src];
            const cx = Math.max(-105, Math.min(105, x * k));
            const cy = Math.max(-105, Math.min(105, y * k));
            return (
              <g key={id}>
                <circle cx={cx} cy={cy} r="4" fill={fill} />
                <text x={cx} y={cy - 7} fill="#9ca3af" fontSize="7" textAnchor="middle">{id}</text>
              </g>
            );
          })}
        </svg>
          );
        })()}
      </div>
      </div>
      <div className="text-[10px] text-gray-600 mt-2">click = play/stop · right-click = solo · P = park · H = hold</div>
    </div>
  );
};
