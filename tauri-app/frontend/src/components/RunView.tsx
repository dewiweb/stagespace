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

  // Solo — backend-side (pas de flag sur le slot) : suivi local par oscIndex.
  const [soloOsc, setSoloOsc] = React.useState<number | null>(null);
  const playingIds = new Set(moveSlots.filter((s) => s.movementId).map((s) => s.id));
  const soloId = moveSlots.find((s) => s.oscIndex === soloOsc)?.id ?? null;

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
      <div className="grid grid-cols-4 gap-3 flex-1 content-start overflow-y-auto">
        {moveSlots.map((slot) => {
          const playing = playingIds.has(slot.id);
          const solo = soloId === slot.id;
          const parked = slot.trackIds.filter((t) => objectStates[t] === 'park');
          const held = slot.trackIds.filter((t) => objectStates[t] === 'hold');
          const cls = solo ? STATE_COLORS.solo : playing ? STATE_COLORS.playing : STATE_COLORS.stopped;
          return (
            <button
              key={slot.id}
              onClick={() => (playing ? doSlotStop(slot.oscIndex || 0) : doSlot(slot.oscIndex || 0, undefined))}
              onContextMenu={(e) => {
                e.preventDefault();
                if (solo) { doUnsolo(); setSoloOsc(null); }
                else { doSolo(slot.oscIndex || 0); setSoloOsc(slot.oscIndex || 0); }
              }}
              className={`${cls} rounded-lg p-4 text-left transition-colors relative`}
            >
              <div className="font-bold text-sm truncate">{slot.name}</div>
              <div className="text-[10px] opacity-70 mt-1">
                {slot.trackIds.map((t) => `${t}${objectStates[t] === 'park' ? '⏸' : ''}`).join(' ')}
              </div>
              {parked.length > 0 && <div className="absolute top-1.5 right-1.5 text-[9px] bg-amber-800 px-1 rounded">P</div>}
              {held.length > 0 && <div className="absolute bottom-1.5 right-1.5 text-[9px] bg-cyan-800 px-1 rounded">H</div>}
              {solo && <div className="absolute top-1.5 left-1.5 text-[9px] bg-cyan-900 px-1 rounded">S</div>}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] text-gray-600 mt-2">click = play/stop · right-click = solo · P = park · H = hold</div>
    </div>
  );
};
