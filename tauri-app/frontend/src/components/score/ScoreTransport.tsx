/// Barre de transport du score — play/stop backend, curseur animé,
/// durée, région de boucle (hard-wrap), zoom horizontal, hauteur
/// des pistes. Transport = commandes IPC, jamais de lecture
/// frontend (setTimeout) — l'horloge de vérité est le backend.
import React from 'react';
import { fmtMs } from './scoreUtils';

export const ScoreTransport: React.FC<{
  playing: boolean;
  displayCursor: number;
  durationMs: number;
  loopStartMs?: number;
  loopEndMs?: number;
  pxPerSec: number;
  laneH: number;
  onPlayStop: () => void;
  onSetDurationMs: (ms: number) => void;
  onSetLoop: (startMs: number | undefined, endMs: number | undefined) => void;
  onZoom: (dir: 1 | -1) => void;
  onLaneH: (h: number) => void;
}> = ({
  playing, displayCursor, durationMs, loopStartMs, loopEndMs,
  pxPerSec, laneH, onPlayStop, onSetDurationMs, onSetLoop,
  onZoom, onLaneH,
}) => (
  <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800 bg-gray-900/60">
    <button
      onClick={onPlayStop}
      className={`px-3 py-1 text-xs font-bold rounded ${playing ? 'bg-red-700 hover:bg-red-600' : 'bg-green-700 hover:bg-green-600'}`}
    >
      {playing ? '■ STOP' : '⏵ PLAY'}
    </button>
    <span className="font-mono text-sm text-cyan-300 w-28">{fmtMs(displayCursor)}</span>
    <span className="text-[10px] text-gray-500">/ {fmtMs(durationMs)}</span>
    <label className="text-[10px] text-gray-500 flex items-center gap-1">
      durée
      <input
        type="number" min={1} step={10} defaultValue={durationMs / 1000}
        onBlur={(e) => onSetDurationMs(Number(e.target.value) * 1000)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
      />
      s
    </label>
    {/* Loop region — rebouclage hard-wrap du transport [start, end) */}
    {(() => {
      const loopOn = loopStartMs != null && loopEndMs != null;
      const boundIn = (label: string, val: number, onSet: (v: number) => void) => (
        <label className="text-[10px] text-gray-500 flex items-center gap-1">
          {label}
          <input
            type="number" min={0} step={1} defaultValue={val / 1000}
            onBlur={(e) => { const v = Number(e.target.value); if (v >= 0) onSet(v * 1000); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-12 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
          />
        </label>
      );
      return (
        <span className="flex items-center gap-1.5">
          <button
            onClick={() => onSetLoop(loopOn ? undefined : 0, loopOn ? undefined : durationMs)}
            title="Region de boucle — le transport reboucle (hard-wrap)"
            className={`px-2 py-0.5 text-[10px] font-bold rounded ${loopOn ? 'bg-cyan-800 text-cyan-200' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
          >
            ⟲ LOOP
          </button>
          {loopOn && (
            <>
              {boundIn('de', loopStartMs, (v) => onSetLoop(Math.min(v, loopEndMs - 50), loopEndMs))}
              {boundIn('à', loopEndMs, (v) => onSetLoop(loopStartMs, Math.max(v, loopStartMs + 50)))}
            </>
          )}
        </span>
      );
    })()}
    {playing && (
      <span
        className="text-[10px] text-amber-400/90 border border-amber-900/60 rounded px-1.5 py-0.5"
        title="Le scheduler joue la partition chargée au PLAY — les éditions pendant la lecture s'appliquent au prochain PLAY"
      >
        éditions différées
      </span>
    )}
    <div className="flex-1" />
    <button onClick={() => onZoom(-1)} className="px-2 py-0.5 text-xs bg-gray-800 rounded hover:bg-gray-700">−</button>
    <button onClick={() => onZoom(1)} className="px-2 py-0.5 text-xs bg-gray-800 rounded hover:bg-gray-700">+</button>
    <span className="text-[10px] text-gray-500 w-10 text-right">{pxPerSec.toFixed(0)}px/s</span>
    <label className="text-[10px] text-gray-500 flex items-center gap-1" title="Hauteur des pistes">
      <span className="text-[9px]">⇳</span>
      <input
        type="range" min={24} max={96} step={4} value={laneH}
        onChange={(e) => onLaneH(Number(e.target.value))}
        className="w-16 accent-cyan-500"
      />
    </label>
  </div>
);
