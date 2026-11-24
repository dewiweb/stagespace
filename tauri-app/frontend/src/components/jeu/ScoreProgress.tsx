/// Progression read-only de la partition Score dans la surface Jeu —
/// l'opérateur VOIT l'avancement (curseur animé, prochains événements
/// façon « next cue ») sans pouvoir éditer : la partition dirige, les
/// gros boutons restent à l'opérateur (panic, GO, slots).
/// Montée dans la top bar — nulle si la partition est vide.
import React, { useEffect, useRef, useState } from 'react';
import { useScoreStore } from '../../store/useScoreStore';
import { useGraphStore } from '../../store/useGraphStore';
import { useCuelistStore } from '../../store/useCuelistStore';
import { clipLabel, fmtMs } from '../score/scoreUtils';

const NEXT_SHOWN = 2;

export const ScoreProgress: React.FC = () => {
  const playing = useScoreStore((s) => s.playing);
  const cursorMs = useScoreStore((s) => s.cursorMs);
  const durationMs = useScoreStore((s) => s.durationMs);
  const clips = useScoreStore((s) => s.clips);
  const loopEndMs = useScoreStore((s) => s.loopEndMs);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const cues = useCuelistStore((s) => s.cues);

  // Curseur animé — même modèle que ScoreView : base posée par les
  // events `score-timeline` + delta wall-clock local (l'horloge de
  // vérité reste backend ; l'affichage interpole entre les pushes).
  const [displayCursor, setDisplayCursor] = useState(cursorMs);
  const playBase = useRef({ at: 0, ms: 0 });
  const transportRev = useScoreStore((s) => s.transportRev);
  useEffect(() => {
    playBase.current = { at: performance.now(), ms: cursorMs };
    if (!playing) setDisplayCursor(cursorMs);
  }, [cursorMs, playing, transportRev]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setDisplayCursor(playBase.current.ms + performance.now() - playBase.current.at);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  if (clips.length === 0) return null;

  // Prochains événements — les clips démarrant après le curseur, par
  // ordre de tir (le repeat compte par son début — assez pour un
  // « prochain » en lecture seule).
  const upcoming = clips
    .filter((c) => c.startMs > displayCursor)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, NEXT_SHOWN);
  const pct = durationMs > 0 ? Math.min(100, (displayCursor / durationMs) * 100) : 0;

  return (
    <span
      className="flex items-center gap-2 flex-shrink-0 min-w-0"
      title="Score — progression de la partition (lecture seule : édition dans la surface Score)"
    >
      <span className="text-gray-500 uppercase text-[10px]">Score</span>
      <span className={`text-[11px] font-mono tabular-nums ${playing ? 'text-cyan-300' : 'text-gray-500'}`}>
        {playing ? '▶' : '■'} {fmtMs(displayCursor)}
        {durationMs > 0 && <span className="text-gray-600"> / {fmtMs(durationMs)}</span>}
        {loopEndMs != null && <span className="text-cyan-600" title="Loop active"> ⟳</span>}
      </span>
      <span className="w-16 h-1 rounded bg-gray-800 overflow-hidden flex-shrink-0" title={`${pct.toFixed(0)}%`}>
        <span className="block h-full bg-cyan-500/70 transition-[width] duration-100" style={{ width: `${pct}%` }} />
      </span>
      {upcoming.length > 0 && (
        <span className="text-[10px] text-gray-500 truncate">
          → {upcoming.map((c) => `${clipLabel(c, moveSlots, cues)} @${fmtMs(c.startMs)}`).join(' · ')}
        </span>
      )}
      {upcoming.length === 0 && playing && (
        <span className="text-[10px] text-gray-600 truncate">→ fin de partition</span>
      )}
    </span>
  );
};
