/// Surface SCORE (S2 — docs/score-sequencer.md) — le séquenceur
/// multipiste : lanes (moves / cues / markers), clips posés sur une
/// timeline, transport backend (score_timeline_*). Les clips
/// référencent les entités vivantes du show ; l'exécution est
/// backend-side (spawn_move / recall_cue_inner) — la webview n'est
/// qu'une vue : curseur, édition, transport.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useScoreStore, type ScoreClipDoc, type ScoreTrack } from '../../store/useScoreStore';
import { useGraphStore } from '../../store/useGraphStore';
import { useCuelistStore } from '../../store/useCuelistStore';
import { extractDuration } from '../../store/slices/moveSlotsTypes';
import { toast } from '../../utils/toast-helpers';

const fmtMs = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

const CLIP_COLORS: Record<string, string> = {
  slot: 'bg-purple-600/80 border-purple-400',
  cue: 'bg-amber-600/80 border-amber-400',
  stopAll: 'bg-red-700/80 border-red-500',
  panic: 'bg-red-900/80 border-red-400',
};

const ScoreView: React.FC = () => {
  const tracks = useScoreStore((s) => s.tracks);
  const clips = useScoreStore((s) => s.clips);
  const durationMs = useScoreStore((s) => s.durationMs);
  const playing = useScoreStore((s) => s.playing);
  const cursorMs = useScoreStore((s) => s.cursorMs);
  const loopStartMs = useScoreStore((s) => s.loopStartMs);
  const loopEndMs = useScoreStore((s) => s.loopEndMs);
  const { addClip, moveClip, resizeClip, removeClip, duplicateClip, setDurationMs, setClipRepeat, setLoop, playScore, stopScore, seekScore, toggleTrackMute } =
    useScoreStore.getState();
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const cues = useCuelistStore((s) => s.cues);

  const [pxPerSec, setPxPerSec] = useState(60);
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ trackId: string; x: number; y: number } | null>(null);
  // Curseur animé pendant la lecture — base = dernier état poussé par
  // le backend + delta wall-clock local (l'horloge de vérité reste
  // backend ; ceci n'est que l'affichage).
  const [displayCursor, setDisplayCursor] = useState(cursorMs);
  const playBase = useRef({ at: 0, ms: 0 });
  useEffect(() => {
    playBase.current = { at: performance.now(), ms: cursorMs };
    if (!playing) setDisplayCursor(cursorMs);
  }, [cursorMs, playing]);
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

  const ms2px = useCallback((ms: number) => (ms / 1000) * pxPerSec, [pxPerSec]);
  const px2ms = useCallback((px: number) => Math.max(0, (px / pxPerSec) * 1000), [pxPerSec]);
  const tickEvery = pxPerSec < 30 ? 10_000 : pxPerSec < 80 ? 5_000 : 1_000;
  const laneH = 44;

  // Drag de clip : horizontal → startMs (snap 50ms) ; bord droit → resize.
  const dragRef = useRef<{ clipId: string; mode: 'move' | 'resize'; startX: number; origMs: number } | null>(null);
  const onClipPointerDown = (e: React.PointerEvent, clip: ScoreClipDoc, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(clip.id);
    dragRef.current = { clipId: clip.id, mode, startX: e.clientX, origMs: mode === 'move' ? clip.startMs : clip.durationMs ?? 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onClipPointerMove = (e: React.PointerEvent, clip: ScoreClipDoc) => {
    const d = dragRef.current;
    if (!d || d.clipId !== clip.id) return;
    const deltaMs = px2ms(e.clientX - d.startX);
    if (d.mode === 'move') moveClip(clip.id, Math.round((d.origMs + deltaMs) / 50) * 50);
    else resizeClip(clip.id, Math.max(100, Math.round((d.origMs + deltaMs) / 50) * 50));
  };
  const onClipPointerUp = () => { dragRef.current = null; };

  // Suppression au clavier du clip sélectionné.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        removeClip(selected);
        setSelected(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selected, removeClip]);

  const clipLabel = (clip: ScoreClipDoc): string => {
    switch (clip.ref.type) {
      case 'slot': {
        const sl = moveSlots.find((x) => x.id === (clip.ref as { slotId: string }).slotId);
        return sl ? sl.name : '⚠ slot perdu';
      }
      case 'cue': {
        const cue = cues.find((x) => String(x.id) === String((clip.ref as { cueId: string }).cueId));
        return cue ? `CUE ${cue.cue_number} ${cue.name}` : '⚠ cue perdue';
      }
      case 'stopAll': return 'STOP ALL';
      case 'panic': return 'PANIC';
    }
  };

  const addToTrack = (track: ScoreTrack, ref: ScoreClipDoc['ref'], durationMs?: number) => {
    addClip(track.id, ref, displayCursor, durationMs);
    setPicker(null);
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-gray-200 overflow-hidden select-none">
      {/* Transport */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800 bg-gray-900/60">
        <button
          onClick={() => (playing ? stopScore() : void playScore())}
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
            onBlur={(e) => setDurationMs(Number(e.target.value) * 1000)}
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
                onClick={() => setLoop(loopOn ? undefined : 0, loopOn ? undefined : durationMs)}
                title="Region de boucle — le transport reboucle (hard-wrap)"
                className={`px-2 py-0.5 text-[10px] font-bold rounded ${loopOn ? 'bg-cyan-800 text-cyan-200' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
              >
                ⟲ LOOP
              </button>
              {loopOn && (
                <>
                  {boundIn('de', loopStartMs, (v) => setLoop(Math.min(v, loopEndMs - 50), loopEndMs))}
                  {boundIn('à', loopEndMs, (v) => setLoop(loopStartMs, Math.max(v, loopStartMs + 50)))}
                </>
              )}
            </span>
          );
        })()}
        <div className="flex-1" />
        <button onClick={() => setPxPerSec((z) => Math.max(10, z / 1.4))} className="px-2 py-0.5 text-xs bg-gray-800 rounded hover:bg-gray-700">−</button>
        <button onClick={() => setPxPerSec((z) => Math.min(400, z * 1.4))} className="px-2 py-0.5 text-xs bg-gray-800 rounded hover:bg-gray-700">+</button>
        <span className="text-[10px] text-gray-500 w-10 text-right">{pxPerSec.toFixed(0)}px/s</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* En-têtes de lanes */}
        <div className="w-32 shrink-0 border-r border-gray-800 bg-gray-900/40 flex flex-col">
          <div className="h-6 border-b border-gray-800" />
          {tracks.map((t) => (
            <div key={t.id} className="flex items-center gap-1 px-2 border-b border-gray-800" style={{ height: laneH }}>
              <button
                onClick={() => toggleTrackMute(t.id)}
                title={t.muted ? 'Lane mutée — clips non joués' : 'Mute lane'}
                className={`w-3 h-3 rounded-sm border ${t.muted ? 'bg-orange-600 border-orange-400' : 'border-gray-600'}`}
              />
              <span className={`text-[10px] font-bold flex-1 truncate ${t.muted ? 'text-gray-600 line-through' : 'text-gray-300'}`}>{t.name}</span>
              <button
                onClick={(e) => setPicker({ trackId: t.id, x: e.clientX, y: e.clientY })}
                title="Ajouter un clip au curseur"
                className="text-gray-500 hover:text-white text-sm leading-none"
              >+</button>
            </div>
          ))}
          <div className="flex-1" />
        </div>

        {/* Zone timeline */}
        <div className="flex-1 overflow-auto" onClick={() => { setSelected(null); setPicker(null); }}>
          <div className="relative" style={{ width: ms2px(durationMs) + 200, minHeight: '100%' }}>
            {/* Ruler — click = seek (stopped only, backend refusera sinon) */}
            <div
              className="h-6 border-b border-gray-800 relative cursor-text bg-gray-900/30"
              onClick={(e) => {
                if (playing) return;
                const rect = e.currentTarget.getBoundingClientRect();
                seekScore(Math.round(px2ms(e.clientX - rect.left) / 50) * 50);
              }}
            >
              {Array.from({ length: Math.ceil(durationMs / tickEvery) + 1 }, (_, i) => i * tickEvery).map((ms) => (
                <div key={ms} className="absolute top-0 bottom-0 border-l border-gray-700 pl-1 text-[9px] text-gray-500" style={{ left: ms2px(ms) }}>
                  {fmtMs(ms).slice(0, 5)}
                </div>
              ))}
              {/* Region de boucle — bandeau sur la ruler */}
              {loopStartMs != null && loopEndMs != null && (
                <div
                  className="absolute top-0 bottom-0 bg-cyan-400/15 border-x border-cyan-400/60 pointer-events-none"
                  style={{ left: ms2px(loopStartMs), width: ms2px(loopEndMs - loopStartMs) }}
                />
              )}
            </div>
            {/* Bornes de loop pleine hauteur (très faible) */}
            {loopStartMs != null && loopEndMs != null && (
              <>
                <div className="absolute top-0 bottom-0 w-px bg-cyan-400/30 pointer-events-none" style={{ left: ms2px(loopStartMs) }} />
                <div className="absolute top-0 bottom-0 w-px bg-cyan-400/30 pointer-events-none" style={{ left: ms2px(loopEndMs) }} />
              </>
            )}
            {/* Lanes */}
            {tracks.map((t) => (
              <div key={t.id} className="relative border-b border-gray-800" style={{ height: laneH, opacity: t.muted ? 0.4 : 1 }}>
                {clips.filter((c) => c.trackId === t.id).map((c) => {
                  const w = c.durationMs != null ? ms2px(c.durationMs) : 14;
                  return (
                    <div
                      key={c.id}
                      className={`absolute top-1.5 bottom-1.5 rounded border text-[10px] font-bold px-1.5 flex items-center overflow-hidden cursor-grab ${CLIP_COLORS[c.ref.type]} ${selected === c.id ? 'ring-2 ring-white' : ''}`}
                      style={{ left: ms2px(c.startMs), width: Math.max(14, w), minWidth: 14 }}
                      title={clipLabel(c)}
                      onPointerDown={(e) => onClipPointerDown(e, c, 'move')}
                      onPointerMove={(e) => onClipPointerMove(e, c)}
                      onPointerUp={onClipPointerUp}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Copies du pattern — ticks aux bornes de répétition */}
                      {c.repeatEveryMs != null && c.repeatEveryMs > 0 && c.durationMs != null &&
                        Array.from(
                          { length: Math.floor(c.durationMs / c.repeatEveryMs) },
                          (_, i) => (i + 1) * c.repeatEveryMs!,
                        ).filter((off) => off < c.durationMs!).map((off) => (
                          <div
                            key={off}
                            className="absolute top-0 bottom-0 border-l border-white/30 pointer-events-none"
                            style={{ left: ms2px(off) }}
                          />
                        ))}
                      <span className="truncate pointer-events-none">
                        {c.repeatEveryMs != null ? '⟳ ' : ''}{clipLabel(c)}
                      </span>
                      {c.ref.type === 'slot' && c.durationMs != null && (
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/50"
                          onPointerDown={(e) => onClipPointerDown(e, c, 'resize')}
                          onPointerMove={(e) => onClipPointerMove(e, c)}
                          onPointerUp={onClipPointerUp}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Curseur */}
            <div className="absolute top-0 bottom-0 w-px bg-cyan-400 pointer-events-none" style={{ left: ms2px(displayCursor) }} />
          </div>
        </div>
      </div>

      {/* Picker d'ajout de clip */}
      {picker && (() => {
        const track = tracks.find((t) => t.id === picker.trackId);
        if (!track) return null;
        return (
          <div
            className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 max-h-64 overflow-auto min-w-52"
            style={{ left: picker.x, top: picker.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {track.kind === 'slots' && moveSlots.map((s) => (
              <button
                key={s.id}
                className="w-full text-left px-3 py-1 text-xs hover:bg-purple-700/40 truncate"
                onClick={() => {
                  const dur = s.graphJson ? extractDuration(s.graphJson.nodes) * 1000 : 30_000;
                  addToTrack(track, { type: 'slot', slotId: s.id }, dur);
                }}
              >
                ⬤ {s.name}
              </button>
            ))}
            {track.kind === 'cues' && cues.map((c, i) => (
              <button
                key={c.id}
                className="w-full text-left px-3 py-1 text-xs hover:bg-amber-700/40 truncate"
                onClick={() => addToTrack(track, { type: 'cue', cueId: String(c.id) })}
              >
                ◆ CUE {c.cue_number ?? i + 1} {c.name}
              </button>
            ))}
            {track.kind === 'markers' && (
              <>
                <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-800/40" onClick={() => addToTrack(track, { type: 'stopAll' })}>
                  ■ STOP ALL — coupe tous les moves
                </button>
                <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-900/40" onClick={() => addToTrack(track, { type: 'panic' })}>
                  ■ PANIC — arrêt d'urgence (origines)
                </button>
              </>
            )}
            {track.kind === 'slots' && moveSlots.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-gray-500">Aucun slot — créez-en un dans Atelier</div>
            )}
            {track.kind === 'cues' && cues.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-gray-500">Aucune cue — capturez-en une dans Atelier</div>
            )}
          </div>
        );
      })()}

      {/* Bandeau info bas — inspector du clip sélectionné */}
      <div className="px-3 py-1 border-t border-gray-800 text-[10px] text-gray-500 flex items-center gap-4">
        <span>{clips.length} clip{clips.length > 1 ? 's' : ''} — exécution backend (survit au reload)</span>
        {(() => {
          const c = clips.find((x) => x.id === selected);
          if (!c) return null;
          const numIn = (label: string, val: number | undefined, onSet: (v: number | undefined) => void, title?: string) => (
            <label className="flex items-center gap-1" title={title}>
              {label}
              <input
                key={`${c.id}-${label}`}
                type="number" min={0} step={0.5} defaultValue={val != null ? val / 1000 : ''}
                placeholder="—"
                onBlur={(e) => {
                  const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) * 1000);
                  onSet(v);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
              />
              s
            </label>
          );
          return (
            <span className="flex items-center gap-3 text-gray-400 border-l border-gray-800 pl-4">
              <span className="font-bold text-gray-300">{clipLabel(c)}</span>
              {numIn('début', c.startMs, (v) => v != null && moveClip(c.id, v))}
              {numIn('durée', c.durationMs, (v) => resizeClip(c.id, v && v > 0 ? v : undefined))}
              {numIn('⟳ toutes les', c.repeatEveryMs, (v) => {
                // Repeat exige une fenêtre (durationMs) — un clip
                // ouvert qui devient bouclé prend le reste du score
                // comme fenêtre.
                if (v != null && v > 0 && c.durationMs == null) {
                  resizeClip(c.id, Math.max(v, durationMs - c.startMs));
                }
                setClipRepeat(c.id, v && v > 0 ? v : undefined);
              }, 'Copies du pattern — re-déclenche le clip toutes les N s dans sa durée')}
              <button
                className="hover:text-gray-200 border border-gray-700 rounded px-1.5 py-0.5"
                title="Dupliquer le clip (copie indépendante, décalée de sa durée)"
                onClick={() => duplicateClip(c.id)}
              >⧉</button>
            </span>
          );
        })()}
        <div className="flex-1" />
        <button className="hover:text-gray-300" onClick={() => {
          useScoreStore.getState().clearScore();
          toast.info('Score vidé');
        }}>Vider le score</button>
      </div>
    </div>
  );
};

export default ScoreView;
