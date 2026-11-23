/// Surface SCORE (S2/S3 — docs/score-sequencer.md) — le séquenceur
/// multipiste : LES LANES SONT LES OBJETS (une par track_id patché)
/// + une pseudo-lane master (macros globales, markers). Un clip
/// couvrant plusieurs objets se rend en copie liée sur chaque lane.
/// Les clips référencent les entités vivantes du show ; l'exécution
/// est backend-side (spawn_move / recall_cue_inner) — la webview
/// n'est qu'une vue : curseur, édition, transport.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  useScoreStore, MASTER_LANE, laneIdOf, clipLaneIds,
  type ScoreClipDoc, type ScoreKeyframe,
} from '../../store/useScoreStore';
import { useGraphStore } from '../../store/useGraphStore';
import { useCuelistStore } from '../../store/useCuelistStore';
import { extractDuration } from '../../store/slices/moveSlotsTypes';
import { cueCoverage } from '../../utils/scoreResolve';
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

/// Paramètres continus courbables — deux scopes S3 distincts
/// (docs/score-sequencer.md + runtime/macros.rs §MacroScope) :
/// - CLIP : macros per-move du worker (Animation transform — la
///   courbe override la valeur seedée du slot, ce move seulement).
/// - MASTER : macros GLOBALES du merge (/stagespace/macro) — toute
///   l'output. `radius_scale`/`height_offset` n'existent que là (pas
///   de champ Animation). `phase_spread` hors catalogue : assignments
///   figés au spawn, pas hot-modifiable.
interface ParamDef { id: string; min: number; max: number; def: number }
const CLIP_PARAM_DEFS: ParamDef[] = [
  { id: 'speed', min: 0, max: 4, def: 1 },
  { id: 'scale', min: 0, max: 4, def: 1 },
  { id: 'yaw', min: -180, max: 180, def: 0 },
  { id: 'pitch', min: -180, max: 180, def: 0 },
  { id: 'roll', min: -180, max: 180, def: 0 },
  { id: 'offset_x', min: -10, max: 10, def: 0 },
  { id: 'offset_y', min: -10, max: 10, def: 0 },
  { id: 'offset_z', min: -10, max: 10, def: 0 },
];
const MASTER_PARAM_DEFS: ParamDef[] = [
  { id: 'speed', min: 0, max: 4, def: 1 },
  { id: 'scale', min: 0, max: 4, def: 1 },
  { id: 'shift_x', min: -10, max: 10, def: 0 },
  { id: 'shift_y', min: -10, max: 10, def: 0 },
  { id: 'shift_z', min: -10, max: 10, def: 0 },
  { id: 'yaw', min: -180, max: 180, def: 0 },
  { id: 'pitch', min: -180, max: 180, def: 0 },
  { id: 'roll', min: -180, max: 180, def: 0 },
  { id: 'radius_scale', min: 0, max: 4, def: 1 },
  { id: 'height_offset', min: -10, max: 10, def: 0 },
];

/// Éditeur de courbe générique — keyframes {t, v} sur une fenêtre
/// [0, endMs] (relatif clip ou absolu master). Clic vide = ajoute un
/// point, drag = déplace, clic droit = supprime. Interpolation
/// linéaire (smooth/bezier plus tard). Évaluée par le backend au play.
const CurveEditor: React.FC<{
  kfs?: ScoreKeyframe[];
  endMs: number;
  param: ParamDef;
  onCurve: (kfs: ScoreKeyframe[] | undefined) => void;
}> = ({ kfs, endMs, param: p, onCurve }) => {
  const end = endMs;
  const W = 1000;
  const H = 100;
  const pad = 12;
  const x = (t: number) => pad + (t / end) * (W - pad * 2);
  const y = (v: number) => 8 + (1 - (v - p.min) / (p.max - p.min)) * (H - 16);
  const toCurve = (e: React.PointerEvent<SVGSVGElement>): ScoreKeyframe => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const vy = ((e.clientY - r.top) / r.height) * H;
    const t = Math.max(0, Math.min(end, Math.round(((vx - pad) / (W - pad * 2)) * end / 50) * 50));
    const v = Math.max(p.min, Math.min(p.max, p.min + (1 - (vy - 8) / (H - 16)) * (p.max - p.min)));
    return { t, v: Math.round(v * 100) / 100 };
  };
  const dragRef = useRef<number | null>(null);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="flex-1 h-full cursor-crosshair"
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        // Clic sur le fond → nouveau keyframe (courbe vide → pose
        // aussi le point de départ à la valeur par défaut).
        if (e.button !== 0) return;
        const pt = toCurve(e);
        const next = kfs ? [...kfs] : [{ t: 0, v: p.def }];
        next.push(pt);
        onCurve(next);
      }}
      onPointerMove={(e) => {
        if (dragRef.current === null || !kfs) return;
        const pt = toCurve(e);
        const next = kfs.map((k, i) => (i === dragRef.current ? pt : k));
        onCurve(next);
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <rect x={x(0)} y={0} width={x(end) - x(0)} height={H} className="fill-purple-500/5" />
      {/* ligne de la valeur par défaut */}
      <line x1={x(0)} y1={y(p.def)} x2={x(end)} y2={y(p.def)} stroke="#6b7280" strokeDasharray="4 4" strokeOpacity={0.5} />
      <text x={x(0) + 2} y={y(p.def) - 2} className="fill-gray-500" fontSize="8">
        {p.def}
      </text>
      {kfs ? (
        <>
          <polyline
            points={kfs.map((k) => `${x(k.t)},${y(k.v)}`).join(' ')}
            fill="none" stroke="#67e8f9" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
          />
          {kfs.map((k, i) => (
            <circle
              key={i} cx={x(k.t)} cy={y(k.v)} r={7}
              className="fill-cyan-300 stroke-gray-900 cursor-grab"
              strokeWidth={1.5}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                dragRef.current = i;
                (e.target as Element).setPointerCapture(e.pointerId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = kfs.filter((_, j) => j !== i);
                onCurve(next.length ? next : undefined);
              }}
            />
          ))}
          <text x={x(end) - 60} y={H - 6} className="fill-cyan-300" fontSize="9">
            {kfs[kfs.length - 1]?.v ?? p.def}
          </text>
        </>
      ) : (
        <text x={W / 2 - 110} y={H / 2} className="fill-gray-500" fontSize="10">
          clic pour poser un keyframe — {p.id}
        </text>
      )}
    </svg>
  );
};

const ScoreView: React.FC = () => {
  const clips = useScoreStore((s) => s.clips);
  const laneStates = useScoreStore((s) => s.laneStates);
  const durationMs = useScoreStore((s) => s.durationMs);
  const playing = useScoreStore((s) => s.playing);
  const cursorMs = useScoreStore((s) => s.cursorMs);
  const loopStartMs = useScoreStore((s) => s.loopStartMs);
  const loopEndMs = useScoreStore((s) => s.loopEndMs);
  const masterCurves = useScoreStore((s) => s.masterCurves);
  const { addClip, moveClip, resizeClip, removeClip, duplicateClip, setDurationMs, setClipRepeat, setClipFades, setClipCurve, setClipTrackIds, setMasterCurve, setLoop, playScore, stopScore, seekScore, toggleLaneMute, setLaneMode } =
    useScoreStore.getState();
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const cues = useCuelistStore((s) => s.cues);

  const [pxPerSec, setPxPerSec] = useState(60);
  const [selected, setSelected] = useState<string | null>(null);
  /// Contexte d'édition master — la piste master n'est pas un
  /// ScoreTrack : c'est une pseudo-lane épinglée, ses courbes
  /// (masterCurves) vivent au niveau du doc en temps absolu.
  const [selMaster, setSelMaster] = useState(false);
  const [picker, setPicker] = useState<{ laneId: string; x: number; y: number } | null>(null);
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

  // Lanes = les objets patchés (manualOscIds = la liste des
  // track_ids) ∪ les couvertures de clips. Un trackId référencé par
  // un clip mais absent de la config → lane "fantôme" (l'objet n'est
  // plus patché — le clip resterait muet à cet endroit).
  const covered = new Set(clips.flatMap((c) => c.trackIds));
  const laneTids = [...new Set([...manualOscIds, ...covered])].sort((a, b) => a - b);
  const lanes = laneTids.map((tid) => ({ id: laneIdOf(tid), trackId: tid, ghost: !manualOscIds.includes(tid) }));
  const laneModeOf = (laneId: string) => laneStates?.[laneId]?.mode ?? 'exclusive';
  const laneMutedOf = (laneId: string) => !!laneStates?.[laneId]?.muted;

  // Layout par lane — en mode stacked les clips qui se chevauchent
  // sont empilés sur des sous-lignes (packing glouton par startMs) et
  // la lane grandit ; en exclusive une seule ligne (le chevauchement
  // se dessine tel quel — last-wins au fire). Un clip multi-objets a
  // une sous-ligne INDÉPENDANTE par lane couverte.
  const laneLayout = new Map<string, { height: number; rowOf: Map<string, number> }>();
  for (const lane of lanes) {
    const laneClips = clips.filter((c) => c.trackIds.includes(lane.trackId));
    if (laneModeOf(lane.id) !== 'stacked') {
      laneLayout.set(lane.id, { height: laneH, rowOf: new Map(laneClips.map((c) => [c.id, 0])) });
      continue;
    }
    const rowEnd: number[] = [];
    const rowOf = new Map<string, number>();
    for (const c of [...laneClips].sort((a, b) => a.startMs - b.startMs)) {
      const end = c.startMs + (c.durationMs ?? 250);
      let r = rowEnd.findIndex((e) => c.startMs >= e);
      if (r < 0) { r = rowEnd.length; rowEnd.push(0); }
      rowEnd[r] = end;
      rowOf.set(c.id, r);
    }
    laneLayout.set(lane.id, { height: Math.max(laneH, 8 + rowEnd.length * rowH), rowOf });
  }

  // Drag de clip : horizontal → startMs (snap 50ms) ; bord droit →
  // resize ; poignées d'angle → fades clip-local.
  const dragRef = useRef<{ clipId: string; mode: 'move' | 'resize' | 'fadeIn' | 'fadeOut'; startX: number; origMs: number } | null>(null);
  const onClipPointerDown = (e: React.PointerEvent, clip: ScoreClipDoc, mode: 'move' | 'resize' | 'fadeIn' | 'fadeOut', origMs?: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(clip.id);
    setSelMaster(false);
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

  const addToLane = (ref: ScoreClipDoc['ref'], opts?: { durationMs?: number; trackIds?: number[] }) => {
    addClip(ref, displayCursor, opts);
    setPicker(null);
  };

  // Zone haute — éditeur clip-scoped / master (docs/score-sequencer.md
  // §Surface) : les courbes du contexte sélectionné s'éditent ici.
  // Clip slot → enveloppe + params per-move (écrits sur les macros
  // du worker) ; master → macros globales (merge, /stagespace/macro).
  const [curveParam, setCurveParam] = useState<string>('enveloppe');

  const selClip = clips.find((x) => x.id === selected);
  // Le chip actif doit exister dans le contexte courant — sinon
  // retombe sur la première entrée du catalogue (enveloppe / speed).
  const ctxParams = selMaster ? MASTER_PARAM_DEFS : CLIP_PARAM_DEFS;
  const ctxFirst = selMaster ? MASTER_PARAM_DEFS[0].id : 'enveloppe';
  const effParam = ctxParams.some((p) => p.id === curveParam) || curveParam === ctxFirst
    ? curveParam : ctxFirst;

  const chip = (label: string, active: boolean, hasData: boolean, title?: string) => (
    <button
      title={title}
      onClick={() => setCurveParam(label)}
      className={`px-2 py-0.5 text-[9px] font-bold rounded border whitespace-nowrap ${
        active
          ? 'border-cyan-500 text-cyan-300 bg-cyan-900/30'
          : 'border-gray-700 text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}{hasData ? ' •' : ''}
    </button>
  );

  const CurveZone = () => {
    const isSlot = selClip?.ref.type === 'slot';
    const inner = (() => {
      if (selMaster) {
        const p = MASTER_PARAM_DEFS.find((d) => d.id === effParam) ?? MASTER_PARAM_DEFS[0];
        return (
          <CurveEditor
            kfs={masterCurves?.[p.id]}
            endMs={durationMs}
            param={p}
            onCurve={(kfs) => setMasterCurve(p.id, kfs)}
          />
        );
      }
      if (!selClip)
        return (
          <span className="text-[11px] text-gray-600 italic">
            Sélectionnez un clip ou la piste master — les courbes s'affichent ici.
          </span>
        );
      if (effParam !== 'enveloppe' && isSlot) {
        const p = CLIP_PARAM_DEFS.find((d) => d.id === effParam) ?? CLIP_PARAM_DEFS[0];
        return (
          <CurveEditor
            kfs={selClip.curves?.[p.id]}
            endMs={selClip.durationMs ?? 10_000}
            param={p}
            onCurve={(kfs) => setClipCurve(selClip.id, p.id, kfs)}
          />
        );
      }
      if (!isSlot)
        return (
          <span className="text-[11px] text-gray-500">
            {clipLabel(selClip)} — événement ponctuel, pas de courbe éditable.
          </span>
        );
      // Enveloppe du clip : rampe fade-in → sustain → tail fade-out
      // APRÈS la fin de fenêtre (le move s'éteint au-delà du bord).
      const fades = effFades(selClip);
      const end = selClip.durationMs ?? fades.inMs + 4_000; // clip ouvert → fenêtre nominale
      const total = end + fades.outMs + 500;
      const W = 1000;
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
          <rect x={x(0)} y={0} width={x(end) - x(0)} height={H} className="fill-purple-500/10" />
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
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide shrink-0">Éditeur</span>
          {selMaster
            ? MASTER_PARAM_DEFS.map((p) =>
                chip(p.id, effParam === p.id, masterCurves?.[p.id] != null, `Courbe master ${p.id} — macros globales (merge)`),
              )
            : chip('enveloppe', effParam === 'enveloppe', false, 'fade-in / fade-out effectifs du clip')}
          {!selMaster && isSlot &&
            CLIP_PARAM_DEFS.map((p) =>
              chip(p.id, effParam === p.id, selClip.curves?.[p.id] != null, `Courbe ${p.id} — per-move (macros du worker)`),
            )}
          <div className="flex-1 shrink-0" />
          {selMaster && <span className="text-[10px] text-cyan-400 shrink-0">MASTER — global</span>}
          {selClip && !selMaster && <span className="text-[10px] text-gray-500 shrink-0">{clipLabel(selClip)}</span>}
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
          {/* En-tête MASTER — macros globales + markers. Sélection =
              contexte d'édition des courbes (zone haute). */}
          <div
            className={`h-6 flex items-center gap-1 px-2 border-b border-gray-800 cursor-pointer ${selMaster ? 'bg-cyan-900/30 ring-1 ring-cyan-500' : 'hover:bg-gray-800/40'}`}
            onClick={() => { setSelMaster(true); setSelected(null); setPicker(null); }}
            title="Piste master — macros globales (ensemble du core) + markers"
          >
            <button
              onClick={(e) => { e.stopPropagation(); toggleLaneMute(MASTER_LANE); }}
              title={laneMutedOf(MASTER_LANE) ? 'Lane mutée — courbes+markers non joués' : 'Mute lane'}
              className={`w-3 h-3 rounded-sm border ${laneMutedOf(MASTER_LANE) ? 'bg-orange-600 border-orange-400' : 'border-gray-600'}`}
            />
            <span className={`text-[9px] font-bold tracking-wide flex-1 truncate ${laneMutedOf(MASTER_LANE) ? 'text-gray-600 line-through' : 'text-cyan-300'}`}>MASTER</span>
            <button
              onClick={(e) => { e.stopPropagation(); setPicker({ laneId: MASTER_LANE, x: e.clientX, y: e.clientY }); }}
              title="Ajouter un marker au curseur"
              className="text-gray-500 hover:text-white text-sm leading-none"
            >+</button>
          </div>
          {lanes.map((lane) => {
            const muted = laneMutedOf(lane.id);
            const stacked = laneModeOf(lane.id) === 'stacked';
            return (
              <div key={lane.id} className="flex items-center gap-1 px-2 border-b border-gray-800" style={{ height: laneLayout.get(lane.id)?.height ?? laneH }}>
                <button
                  onClick={() => toggleLaneMute(lane.id)}
                  title={muted ? 'Lane mutée — ses objets sont exclus des clips' : 'Mute lane'}
                  className={`w-3 h-3 rounded-sm border ${muted ? 'bg-orange-600 border-orange-400' : 'border-gray-600'}`}
                />
                <button
                  onClick={() => setLaneMode(lane.id, stacked ? 'exclusive' : 'stacked')}
                  title={stacked
                    ? 'Stacked — les clips simultanés composent (moves superposés)'
                    : 'Exclusive — un clip à la fois (last-wins, sémantique console)'}
                  className={`text-[8px] font-mono px-0.5 rounded border ${stacked ? 'border-purple-500 text-purple-300' : 'border-gray-700 text-gray-600 hover:text-gray-400'}`}
                >
                  {stacked ? 'STK' : 'EXC'}
                </button>
                <span
                  className={`text-[10px] font-bold flex-1 truncate ${muted ? 'text-gray-600 line-through' : lane.ghost ? 'text-orange-400/70' : 'text-gray-300'}`}
                  title={lane.ghost ? `Objet ${lane.trackId} non patché — les clips qui le couvrent y sont muets` : `track_id ${lane.trackId}`}
                >
                  T{lane.trackId}{lane.ghost ? ' ⚠' : ''}
                </span>
                <button
                  onClick={(e) => setPicker({ laneId: lane.id, x: e.clientX, y: e.clientY })}
                  title="Ajouter un clip (slot/cue) — sa couverture suit l'assignation"
                  className="text-gray-500 hover:text-white text-sm leading-none"
                >+</button>
              </div>
            );
          })}
          <div className="flex-1" />
        </div>

        {/* Zone timeline */}
        <div className="flex-1 overflow-auto" onClick={() => { setSelected(null); setSelMaster(false); setPicker(null); }}>
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
            {/* Rangée master — markers stop/panic + points aux
                positions des keyframes des courbes master (aperçu ;
                l'édition est dans la zone haute une fois la lane
                sélectionnée). */}
            <div
              className={`relative h-6 border-b border-gray-800 cursor-pointer ${selMaster ? 'bg-cyan-900/15' : 'hover:bg-gray-800/20'} ${laneMutedOf(MASTER_LANE) ? 'opacity-40' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSelMaster(true); setSelected(null); setPicker(null); }}
            >
              {clips.filter((c) => clipLaneIds(c).includes(MASTER_LANE)).map((c) => (
                <div
                  key={c.id}
                  className={`absolute top-0.5 bottom-0.5 rounded border text-[9px] font-bold px-1 flex items-center cursor-grab ${CLIP_COLORS[c.ref.type]} ${selected === c.id ? 'ring-2 ring-white' : ''}`}
                  style={{ left: ms2px(c.startMs), minWidth: 14 }}
                  title={clipLabel(c)}
                  onPointerDown={(e) => onClipPointerDown(e, c, 'move')}
                  onPointerMove={(e) => onClipPointerMove(e, c)}
                  onPointerUp={onClipPointerUp}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="truncate pointer-events-none">{clipLabel(c)}</span>
                </div>
              ))}
              {Object.entries(masterCurves ?? {}).flatMap(([param, kfs], pi) =>
                kfs.map((k, i) => (
                  <div
                    key={`${param}-${i}`}
                    title={`${param} @${fmtMs(k.t)} = ${k.v}`}
                    className="absolute w-1.5 h-1.5 rounded-full bg-cyan-300/70"
                    style={{ left: ms2px(k.t) - 3, top: 2 + (pi % 3) * 6 }}
                  />
                )),
              )}
            </div>
            {/* Lanes objets — un clip couvrant plusieurs objets se
                rend sur CHAQUE lane couverte (copie liée : éditer un
                exemplaire édite l'entité). */}
            {lanes.map((lane) => {
              const lay = laneLayout.get(lane.id) ?? { height: laneH, rowOf: new Map<string, number>() };
              const stacked = laneModeOf(lane.id) === 'stacked';
              return (
                <div key={lane.id} className="relative border-b border-gray-800" style={{ height: lay.height, opacity: laneMutedOf(lane.id) ? 0.4 : 1 }}>
                  {clips.filter((c) => c.trackIds.includes(lane.trackId)).map((c) => {
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

      {/* Picker d'ajout de clip — master → markers ; lane objet →
          slots/cues. La couverture du clip suit l'assignation : slot
          → ses trackIds, cue → la couverture dérivée du snapshot. */}
      {picker && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 max-h-64 overflow-auto min-w-52"
          style={{ left: picker.x, top: picker.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {picker.laneId === MASTER_LANE ? (
            <>
              <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-800/40" onClick={() => addToLane({ type: 'stopAll' })}>
                ■ STOP ALL — coupe tous les moves
              </button>
              <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-900/40" onClick={() => addToLane({ type: 'panic' })}>
                ■ PANIC — arrêt d'urgence (origines)
              </button>
            </>
          ) : (
            <>
              {moveSlots.length > 0 && <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase">Moves</div>}
              {moveSlots.map((s) => (
                <button
                  key={s.id}
                  title={`Assignation : tracks ${s.trackIds.join(', ') || '—'}`}
                  className="w-full text-left px-3 py-1 text-xs hover:bg-purple-700/40 truncate"
                  onClick={() => {
                    const dur = s.graphJson ? extractDuration(s.graphJson.nodes) * 1000 : 30_000;
                    addToLane({ type: 'slot', slotId: s.id }, { durationMs: dur, trackIds: s.trackIds });
                  }}
                >
                  ⬤ {s.name}
                </button>
              ))}
              {moveSlots.length === 0 && (
                <div className="px-3 py-2 text-[10px] text-gray-500">Aucun slot — créez-en un dans Atelier</div>
              )}
              {cues.length > 0 && <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase">Cues</div>}
              {cues.map((c, i) => (
                <button
                  key={c.id}
                  className="w-full text-left px-3 py-1 text-xs hover:bg-amber-700/40 truncate"
                  onClick={() => addToLane({ type: 'cue', cueId: String(c.id) }, { trackIds: cueCoverage(c, manualOscIds) })}
                >
                  ◆ CUE {c.cue_number ?? i + 1} {c.name}
                </button>
              ))}
              {cues.length === 0 && (
                <div className="px-3 py-2 text-[10px] text-gray-500">Aucune cue — capturez-en une dans Atelier</div>
              )}
            </>
          )}
        </div>
      )}

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
              {/* Couverture — les objets pilotés par ce clip. × retire
                  l'objet (réassignation) ; slot → + ajoute un objet. */}
              {(c.ref.type === 'slot' || c.ref.type === 'cue') && (
                <span className="flex items-center gap-1" title="Objets pilotés (copies liées sur les lanes)">
                  obj:
                  {c.trackIds.map((tid) => (
                    <span key={tid} className="px-1 rounded bg-gray-800 border border-gray-700 flex items-center">
                      {tid}
                      <button
                        className="ml-0.5 text-gray-500 hover:text-red-400"
                        title={`Retirer l'objet ${tid} de la couverture`}
                        onClick={() => setClipTrackIds(c.id, c.trackIds.filter((x) => x !== tid))}
                      >×</button>
                    </span>
                  ))}
                  {c.ref.type === 'slot' && (
                    <select
                      className="bg-gray-800 border border-gray-700 rounded text-[10px]"
                      value=""
                      onChange={(e) => {
                        const tid = Number(e.target.value);
                        if (tid) setClipTrackIds(c.id, [...c.trackIds, tid]);
                      }}
                      title="Assigner un objet supplémentaire à ce clip"
                    >
                      <option value="">+</option>
                      {[...new Set([...manualOscIds, ...covered])]
                        .filter((tid) => !c.trackIds.includes(tid))
                        .sort((a, b) => a - b)
                        .map((tid) => <option key={tid} value={tid}>{tid}</option>)}
                    </select>
                  )}
                </span>
              )}
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
