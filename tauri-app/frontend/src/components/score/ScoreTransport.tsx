/// Barre de transport du score — play/stop backend, curseur animé,
/// durée, région de boucle (hard-wrap), zoom horizontal, hauteur
/// des pistes. Transport = commandes IPC, jamais de lecture
/// frontend (setTimeout) — l'horloge de vérité est le backend.
import React from 'react';
import { fmtMs, fmtTc } from './scoreUtils';

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
  /// ★ re-capture : snapshot de l'état de la partition au curseur → cue.
  onCaptureCue: () => void;
  /// ✓ preflight : résolution sèche → rapport des refs mortes/couvertures.
  onValidate: () => void;
  /// TC chase — le transport suit le timecode entrant.
  tcChase: boolean;
  onTcChase: () => void;
  /// Pas de snap magnétique (ms) — 0 = libre.
  snapMs: number;
  onSnapMs: (ms: number) => void;
  /// Auto-scroll du playhead en lecture.
  follow: boolean;
  onFollow: () => void;
  /// ⏮/⏭ — seek début / fin de partition.
  onSeek: (ms: number) => void;
}> = ({
  playing, displayCursor, durationMs, loopStartMs, loopEndMs,
  pxPerSec, laneH, onPlayStop, onSetDurationMs, onSetLoop,
  onZoom, onLaneH, onCaptureCue, onValidate, tcChase, onTcChase,
  snapMs, onSnapMs, follow, onFollow, onSeek,
}) => (
  <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800 bg-gray-900/60">
    <button
      onClick={() => onSeek(0)}
      className="px-1.5 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:text-gray-200"
      title="Retour au début (Home)"
    >⏮</button>
    <button
      onClick={onPlayStop}
      className={`px-3 py-1 text-xs font-bold rounded ${playing ? 'bg-red-700 hover:bg-red-600' : 'bg-green-700 hover:bg-green-600'}`}
    >
      {playing ? '■ STOP' : '⏵ PLAY'}
    </button>
    <button
      onClick={() => onSeek(durationMs)}
      className="px-1.5 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:text-gray-200"
      title="Aller à la fin (End)"
    >⏭</button>
    <button
      onClick={onFollow}
      className={`px-1.5 py-1 text-[10px] font-bold rounded ${follow ? 'bg-cyan-800 text-cyan-200' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
      title="Suivi — auto-scroll : le playhead reste visible pendant la lecture"
    >⇉</button>
    <span className="font-mono text-sm text-cyan-300 w-28" title={tcChase ? 'Position — affichage timecode (chase actif)' : 'Position'}>
      {tcChase ? fmtTc(displayCursor) : fmtMs(displayCursor)}
    </span>
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
            key={val}
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
    <button
      onClick={onCaptureCue}
      className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-800/70 text-amber-200 hover:bg-amber-700"
      title="Re-capture : matérialise l'état de la partition AU CURSEUR en nouvelle cue — clips → moves, courbes → valeurs, inverse du flatten"
    >
      ★ cue
    </button>
    <button
      onClick={onValidate}
      className="px-2 py-0.5 text-[10px] font-bold rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
      title="Preflight — résolution sèche : refs mortes, couvertures muettes, courbes sans cible, avant de jouer"
    >
      ✓ check
    </button>
    <button
      onClick={onTcChase}
      className={`px-2 py-0.5 text-[10px] font-bold rounded ${tcChase ? 'bg-cyan-800 text-cyan-200' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
      title="Chase timecode — le transport suit le TC entrant (/stagespace/timecode) : locate à l'arrêt, rebase en lecture, démarrage quand le TC roule"
    >
      TC
    </button>
    <div className="flex-1" />
    <label className="text-[10px] text-gray-500 flex items-center gap-1" title="Snap magnétique — grille d'aimantation des drags (clips, keyframes, bornes, marqueurs)">
      snap
      <select
        value={snapMs}
        onChange={(e) => onSnapMs(Number(e.target.value))}
        className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
      >
        <option value={0}>libre</option>
        <option value={10}>10ms</option>
        <option value={25}>25ms</option>
        <option value={50}>50ms</option>
        <option value={100}>100ms</option>
        <option value={250}>250ms</option>
        <option value={500}>500ms</option>
        <option value={1000}>1s</option>
      </select>
    </label>
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
