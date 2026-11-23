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
  const { addClip, moveClip, resizeClip, removeClip, duplicateClip, setDurationMs, setClipRepeat, setClipFades, setLoop, playScore, stopScore, seekScore, toggleTrackMute, setTrackMode } =
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
  const rowH = 20; // hauteur d'une sous-ligne en mode stacked

  // Clip orphelin — sa référence (slotId/cueId) ne pointe plus sur une
  // entité vivante : signalé en édition, pas seulement en toast au play.
  const clipOrphan = (c: ScoreClipDoc): boolean => {
    if (c.ref.type === 'slot')
      return !moveSlots.some((s) => s.id === (c.ref as { slotId: string }).slotId);
    if (c.ref.type === 'cue')
      return !cues.some((q) => String(q.id) === String((c.ref as { cueId: string }).cueId));
    return false;
  };

  // Fades effectifs (ms) : clip-local sinon hérité du slot.
  const effFades = (c: ScoreClipDoc): { inMs: number; outMs: number } => {
    if (c.ref.type !== 'slot') return { inMs: 0, outMs: 0 };
    const sl = moveSlots.find((x) => x.id === (c.ref as { slotId: string }).slotId);
    return {
      inMs: c.fadeInMs ?? (sl?.fadeIn ?? 0) * 1000,
      outMs: c.fadeOutMs ?? (sl?.fadeOut ?? 0.5) * 1000,
    };
  };

  // Layout par piste — en mode stacked les clips qui se chevauchent
  // sont empilés sur des sous-lignes (packing glouton par startMs) et
  // la piste grandit ; en exclusive une seule ligne (le chevauchement
  // se dessine tel quel — last-wins au fire).
  const laneLayout = new Map<string, { height: number; rowOf: Map<string, number> }>();
  for (const t of tracks) {
    const lane = clips.filter((c) => c.trackId === t.id);
    if (t.mode !== 'stacked') {
      laneLayout.set(t.id, { height: laneH, rowOf: new Map(lane.map((c) => [c.id, 0])) });
      continue;
    }
    const rowEnd: number[] = [];
    const rowOf = new Map<string, number>();
    for (const c of [...lane].sort((a, b) => a.startMs - b.startMs)) {
      const end = c.startMs + (c.durationMs ?? 250);
      let r = rowEnd.findIndex((e) => c.startMs >= e);
      if (r < 0) { r = rowEnd.length; rowEnd.push(0); }
      rowEnd[r] = end;
      rowOf.set(c.id, r);
    }
    laneLayout.set(t.id, { height: Math.max(laneH, 8 + rowEnd.length * rowH), rowOf });
  }

  // Drag de clip : horizontal → startMs (snap 50ms) ; bord droit →
  // resize ; poignées d'angle → fades clip-local.
  const dragRef = useRef<{ clipId: string; mode: 'move' | 'resize' | 'fadeIn' | 'fadeOut'; startX: number; origMs: number } | null>(null);
  const onClipPointerDown = (e: React.PointerEvent, clip: ScoreClipDoc, mode: 'move' | 'resize' | 'fadeIn' | 'fadeOut', origMs?: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(clip.id);
    dragRef.current = { clipId: clip.id, mode, startX: e.clientX, origMs: origMs ?? (mode === 'move' ? clip.startMs : clip.durationMs ?? 0) };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onClipPointerMove = (e: React.PointerEvent, clip: ScoreClipDoc) => {
    const d = dragRef.current;
    if (!d || d.clipId !== clip.id) return;
    const deltaMs = px2ms(e.clientX - d.startX);
    if (d.mode === 'move') moveClip(clip.id, Math.round((d.origMs + deltaMs) / 50) * 50);
    else if (d.mode === 'resize') resizeClip(clip.id, Math.max(100, Math.round((d.origMs + deltaMs) / 50) * 50));
    else if (d.mode === 'fadeIn') setClipFades(clip.id, Math.max(0, Math.round((d.origMs + deltaMs) / 50) * 50), clip.fadeOutMs);
    else if (d.mode === 'fadeOut') setClipFades(clip.id, clip.fadeInMs, Math.max(0, Math.round((d.origMs + deltaMs) / 50) * 50));
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

  // Zone haute — éditeur clip-scoped (docs/score-sequencer.md §Surface) :
  // les "courbes" du clip sélectionné s'éditent ici. L'enveloppe de
  // fades est la première courbe réelle ; les paramètres continus
  // (pos.x, speed, scale…) arrivent avec S3.
  const CurveZone = () => {
    const c = clips.find((x) => x.id === selected);
    const chip = (label: string, active: boolean, title?: string) => (
      <span
        title={title}
        className={`px-2 py-0.5 text-[9px] font-bold rounded border ${active ? 'border-cyan-500 text-cyan-300 bg-cyan-900/30' : 'border-gray-800 text-gray-600'}`}
      >
        {label}
      </span>
    );
    const inner = (() => {
      if (!c)
        return (
          <span className="text-[11px] text-gray-600 italic">
            Sélectionnez un clip — ses courbes éditables s'affichent ici (éditeur S3).
          </span>
        );
      if (c.ref.type !== 'slot')
        return (
          <span className="text-[11px] text-gray-500">
            {clipLabel(c)} — événement ponctuel, pas de courbe éditable.
          </span>
        );
      // Enveloppe du clip : rampe fade-in → sustain → tail fade-out
      // APRÈS la fin de fenêtre (le move s'éteint au-delà du bord).
      const fades = effFades(c);
      const end = c.durationMs ?? fades.inMs + 4_000; // clip ouvert → fenêtre nominale
      const total = end + fades.outMs + 500;
      const W = 1000; // viewBox, étiré au conteneur
      const H = 100;
      const pad = 12;
      const x = (ms: number) => pad + (ms / total) * (W - pad * 2);
      const pts = [
        [x(0), H - 8],
        [x(fades.inMs), 8],
        [x(end), 8],
        [x(end + fades.outMs), H - 8],
      ]
        .map((p) => p.join(','))
        .join(' ');
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="flex-1 h-full" preserveAspectRatio="none">
          {/* fenêtre du clip */}
          <rect x={x(0)} y={0} width={x(end) - x(0)} height={H} className="fill-purple-500/10" />
          {/* tail — fade joué au-delà de la fenêtre */}
          <rect x={x(end)} y={0} width={x(end + fades.outMs) - x(end)} height={H} className="fill-purple-500/5" />
          <line x1={x(end)} y1={0} x2={x(end)} y2={H} stroke="#a78bfa" strokeOpacity={0.5} strokeDasharray="3 3" />
          <polyline points={pts} fill="none" stroke="#c4b5fd" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {fades.inMs > 0 && (
            <line x1={x(0)} y1={H - 4} x2={x(fades.inMs)} y2={H - 4} stroke="#67e8f9" strokeOpacity={0.6} />
          )}
          {fades.outMs > 0 && (
            <line x1={x(end)} y1={H - 4} x2={x(end + fades.outMs)} y2={H - 4} stroke="#67e8f9" strokeOpacity={0.6} />
          )}
          <text x={x(0) + 2} y={H - 10} className="fill-gray-500" fontSize="9">0</text>
          <text x={x(end) + 2} y={12} className="fill-purple-300" fontSize="9">fin clip</text>
          {fades.outMs > 0 && (
            <text x={x(end + fades.outMs) - 30} y={H - 10} className="fill-cyan-300" fontSize="9">
              +{(fades.outMs / 1000).toFixed(1)}s tail
            </text>
          )}
        </svg>
      );
    })();
    return (
      <div className="h-40 shrink-0 border-b border-gray-800 bg-gray-900/40 flex flex-col px-3 py-1.5 gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Éditeur</span>
          {chip('enveloppe (fades)', true, 'fade-in / fade-out effectifs du clip')}
          {chip('pos.x — S3', false, 'Courbes de paramètres — automation lanes (S3)')}
          {chip('speed — S3', false, 'Courbes de paramètres — automation lanes (S3)')}
          <div className="flex-1" />
          {c && <span className="text-[10px] text-gray-500">{clipLabel(c)}</span>}
        </div>
        {inner}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-gray-200 overflow-hidden select-none">
      <CurveZone />
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
            <div key={t.id} className="flex items-center gap-1 px-2 border-b border-gray-800" style={{ height: laneLayout.get(t.id)?.height ?? laneH }}>
              <button
                onClick={() => toggleTrackMute(t.id)}
                title={t.muted ? 'Lane mutée — clips non joués' : 'Mute lane'}
                className={`w-3 h-3 rounded-sm border ${t.muted ? 'bg-orange-600 border-orange-400' : 'border-gray-600'}`}
              />
              <button
                onClick={() => setTrackMode(t.id, t.mode === 'stacked' ? 'exclusive' : 'stacked')}
                title={t.mode === 'stacked'
                  ? 'Stacked — les clips simultanés composent (moves superposés)'
                  : 'Exclusive — un clip à la fois (last-wins, sémantique console)'}
                className={`text-[8px] font-mono px-0.5 rounded border ${t.mode === 'stacked' ? 'border-purple-500 text-purple-300' : 'border-gray-700 text-gray-600 hover:text-gray-400'}`}
              >
                {t.mode === 'stacked' ? 'STK' : 'EXC'}
              </button>
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
            {tracks.map((t) => {
              const lay = laneLayout.get(t.id) ?? { height: laneH, rowOf: new Map<string, number>() };
              const stacked = t.mode === 'stacked';
              return (
                <div key={t.id} className="relative border-b border-gray-800" style={{ height: lay.height, opacity: t.muted ? 0.4 : 1 }}>
                  {clips.filter((c) => c.trackId === t.id).map((c) => {
                    const w = c.durationMs != null ? ms2px(c.durationMs) : 14;
                    const row = lay.rowOf.get(c.id) ?? 0;
                    const top = stacked ? 2 + row * rowH : 6;
                    const h = stacked ? rowH - 4 : lay.height - 12;
                    const orphan = clipOrphan(c);
                    const fades = c.ref.type === 'slot' ? effFades(c) : null;
                    const bg = CLIP_COLORS[c.ref.type].split(' ')[0];
                    return (
                      <React.Fragment key={c.id}>
                        {/* Tail fade-out — déborde le bord droit : le
                            move s'éteint APRÈS la fin de sa fenêtre
                            (EndMove à end + ramp). */}
                        {fades && fades.outMs > 0 && c.durationMs != null && (
                          <div
                            className="absolute z-0 pointer-events-none"
                            style={{ left: ms2px(c.startMs + c.durationMs), top, height: h, width: ms2px(fades.outMs) }}
                          >
                            <div
                              className={`absolute inset-0 ${bg} opacity-50`}
                              style={{ clipPath: 'polygon(0 0, 0 100%, 100% 0)' }}
                            />
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize pointer-events-auto"
                              title="fade out — tail du clip (s)"
                              onPointerDown={(e) => onClipPointerDown(e, c, 'fadeOut', fades.outMs)}
                              onPointerMove={(e) => onClipPointerMove(e, c)}
                              onPointerUp={onClipPointerUp}
                            />
                          </div>
                        )}
                        <div
                          className={`absolute rounded border text-[10px] font-bold px-1.5 flex items-center overflow-hidden cursor-grab ${CLIP_COLORS[c.ref.type]} ${selected === c.id ? 'ring-2 ring-white' : ''} ${orphan ? 'border-dashed opacity-50 saturate-50' : ''}`}
                          style={{ left: ms2px(c.startMs), width: Math.max(14, w), minWidth: 14, top, height: h }}
                          title={orphan ? `${clipLabel(c)} — référence perdue` : clipLabel(c)}
                          onPointerDown={(e) => onClipPointerDown(e, c, 'move')}
                          onPointerMove={(e) => onClipPointerMove(e, c)}
                          onPointerUp={onClipPointerUp}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Région de fade-in + poignée d'angle (drag
                              horizontal → fade_in clip-local) */}
                          {fades && fades.inMs > 0 && (
                            <div
                              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-black/50 to-transparent pointer-events-none"
                              style={{ width: ms2px(fades.inMs) }}
                            />
                          )}
                          {fades && (
                            <div
                              className="absolute left-0 top-0 w-2.5 h-2.5 cursor-ew-resize"
                              style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)', background: 'rgba(255,255,255,.4)' }}
                              title="fade in — entrée du clip (s)"
                              onPointerDown={(e) => onClipPointerDown(e, c, 'fadeIn', fades.inMs)}
                              onPointerMove={(e) => onClipPointerMove(e, c)}
                              onPointerUp={onClipPointerUp}
                            />
                          )}
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
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
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
              {c.ref.type === 'slot' && numIn('fade in', c.fadeInMs,
                (v) => setClipFades(c.id, v, c.fadeOutMs),
                'Fade-in clip-local — vide = hérite le fade du slot')}
              {c.ref.type === 'slot' && numIn('fade out', c.fadeOutMs,
                (v) => setClipFades(c.id, c.fadeInMs, v),
                'Fade-out clip-local (tail après la fin) — vide = hérite le fade du slot')}
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
