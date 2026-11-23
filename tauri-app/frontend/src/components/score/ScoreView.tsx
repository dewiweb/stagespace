/// Surface SCORE (S2/S3 — docs/score-sequencer.md) — le séquenceur
/// multipiste : LES LANES SONT LES OBJETS (une par track_id patché)
/// + deux pseudo-lanes globales reprenant la taxonomie des graphes :
/// GLOBALFX (transform du merge + markers) et MODULATION (valeurs
/// SignalOsc). Un clip couvrant plusieurs objets se rend en copie
/// liée sur chaque lane.
/// Les clips référencent les entités vivantes du show ; l'exécution
/// est backend-side (spawn_move / recall_cue_inner) — la webview
/// n'est qu'une vue : curseur, édition, transport.
///
/// Orchestrateur — les sous-vues vivent dans ./ :
///   scoreParams.ts      catalogues de paramètres courbables
///   scoreUtils.ts       fmtMs / couleurs / labels
///   CurveEditor.tsx     éditeur SVG de keyframes
///   ScoreCurvePane.tsx  zone haute (params + éditeur, split réglable)
///   ScoreTransport.tsx  barre play/loop/zoom
///   ScoreTimeline.tsx   en-têtes de lanes + clips + curseur
///   ScoreClipPicker.tsx popup d'ajout de clip
///   ScoreInspector.tsx  bandeau bas (couverture, saisies, actions)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  useScoreStore, GLOBALFX_LANE, MODULATION_LANE, laneIdOf,
  type ScoreClipDoc, type ScoreLaneMode,
} from '../../store/useScoreStore';
import { useGraphStore } from '../../store/useGraphStore';
import { useCuelistStore } from '../../store/useCuelistStore';
import { buildGraphForSlot, type MoveSlot } from '../../store/slices/moveSlotsTypes';
import {
  nodeParamDefsOf, clipParamDefsOf, globalFxParamDefsOf, MERGE_BLEND_DEFS,
  type ParamDef,
} from './scoreParams';
import { clipLabel as clipLabelOf } from './scoreUtils';
import { ScoreCurvePane } from './ScoreCurvePane';
import type { ParamGroup } from './ScoreParamsPanel';
import { ScoreTransport } from './ScoreTransport';
import { ScoreTimeline, type ScoreLaneLayout } from './ScoreTimeline';
import { ScoreClipPicker, type ScorePickerState } from './ScoreClipPicker';
import { ScoreInspector } from './ScoreInspector';
import type { ClipDragMode } from './ScoreClipBlock';

const ScoreView: React.FC = () => {
  const clips = useScoreStore((s) => s.clips);
  const laneStates = useScoreStore((s) => s.laneStates);
  const durationMs = useScoreStore((s) => s.durationMs);
  const playing = useScoreStore((s) => s.playing);
  const cursorMs = useScoreStore((s) => s.cursorMs);
  const loopStartMs = useScoreStore((s) => s.loopStartMs);
  const loopEndMs = useScoreStore((s) => s.loopEndMs);
  const globalFxCurves = useScoreStore((s) => s.globalFxCurves);
  const modulationCurves = useScoreStore((s) => s.modulationCurves);
  const { addClip, moveClip, resizeClip, removeClip, duplicateClip, setDurationMs, setClipRepeat, setClipFades, setClipCurve, setClipTrackIds, setLaneCurve, setLoop, playScore, stopScore, seekScore, toggleLaneMute, setLaneMode } =
    useScoreStore.getState();
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const macros = useGraphStore((s) => s.macros);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const mergeStrategy = useGraphStore((s) => s.mergeStrategy);
  const setMergeStrategy = useGraphStore((s) => s.setMergeStrategy);
  const cues = useCuelistStore((s) => s.cues);

  const [pxPerSec, setPxPerSec] = useState(60);
  const [selected, setSelected] = useState<string | null>(null);
  /// Lane globale sélectionnée (`globalfx`/`modulation`) — contexte
  /// d'édition de la zone haute. Pseudo-lanes épinglées : leurs
  /// courbes vivent au niveau du doc en temps absolu partition.
  const [selGlobal, setSelGlobal] = useState<string | null>(null);
  /// Nom fraîchement saisi pour une nouvelle courbe modulation
  /// (clé libre — `/score/energy`, `/mod/x`… lue par les SignalOsc).
  const [modName, setModName] = useState('');
  const [picker, setPicker] = useState<ScorePickerState | null>(null);
  /// Partage éditeur/timeline — drag sur la poignée, défaut 50/50.
  const [topFrac, setTopFrac] = useState(0.5);
  const splitRootRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef(false);
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
  /// Hauteur de piste — réglable globalement (slider transport).
  /// Défaut ~40 px → ~8-9 pistes visibles dans la moitié basse.
  const [laneH, setLaneH] = useState(40);
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

  const clipLabel = (c: ScoreClipDoc) => clipLabelOf(c, moveSlots, cues);

  // Lanes = les objets patchés (manualOscIds = la liste des
  // track_ids) ∪ les couvertures de clips. Un trackId référencé par
  // un clip mais absent de la config → lane "fantôme" (l'objet n'est
  // plus patché — le clip resterait muet à cet endroit).
  const covered = new Set(clips.flatMap((c) => c.trackIds));
  const laneTids = [...new Set([...manualOscIds, ...covered])].sort((a, b) => a - b);
  const lanes = laneTids.map((tid) => ({ id: laneIdOf(tid), trackId: tid, ghost: !manualOscIds.includes(tid) }));
  const laneModeOf = (laneId: string): ScoreLaneMode => laneStates?.[laneId]?.mode ?? 'exclusive';
  const laneMutedOf = (laneId: string) => !!laneStates?.[laneId]?.muted;

  // Layout par lane — en mode stacked les clips qui se chevauchent
  // sont empilés sur des sous-lignes (packing glouton par startMs) et
  // la lane grandit ; en exclusive une seule ligne (le chevauchement
  // se dessine tel quel — last-wins au fire). Un clip multi-objets a
  // une sous-ligne INDÉPENDANTE par lane couverte.
  const laneLayout = new Map<string, ScoreLaneLayout>();
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
  const dragRef = useRef<{ clipId: string; mode: ClipDragMode; startX: number; origMs: number } | null>(null);
  const onClipPointerDown = (e: React.PointerEvent, clip: ScoreClipDoc, mode: ClipDragMode, origMs?: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(clip.id);
    setSelGlobal(null);
    dragRef.current = { clipId: clip.id, mode, startX: e.clientX, origMs: origMs ?? (mode === 'move' ? clip.startMs : clip.durationMs ?? 0) };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onClipPointerMove = (e: React.PointerEvent, clip: ScoreClipDoc) => {
    const d = dragRef.current;
    if (!d || d.clipId !== clip.id) return;
    // Delta SIGNÉ — pas px2ms (borné à ≥0 pour les positions absolues) :
    // sinon tout drag vers la gauche est écrasé à 0.
    const deltaMs = ((e.clientX - d.startX) / pxPerSec) * 1000;
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

  const addToLane = (ref: ScoreClipDoc['ref'], opts?: { durationMs?: number; trackIds?: number[]; repeatEveryMs?: number }) => {
    addClip(ref, displayCursor, opts);
    setPicker(null);
  };

  // Zone haute — contexte d'édition des courbes (docs/score-sequencer.md
  // §Surface) : clip slot → enveloppe + params per-move (écrits sur le
  // transform du worker) ; GLOBALFX → transform global (merge,
  // /stagespace/macro) ; MODULATION → valeurs nommées SignalOsc.
  const [curveParam, setCurveParam] = useState<string>('enveloppe');

  const selClip = clips.find((x) => x.id === selected);
  // Graphe du slot sélectionné → params modulables du move (les vrais
  // params : radius, speed de node…) — fallback rebuild depuis le
  // preset quand graphJson n'est pas persisté.
  const selSlot: MoveSlot | undefined =
    selClip?.ref.type === 'slot'
      ? moveSlots.find((s) => s.id === (selClip.ref as { slotId: string }).slotId)
      : undefined;
  const nodeDefs = selSlot
    ? nodeParamDefsOf(
        selSlot.graphJson?.nodes ??
          buildGraphForSlot(selSlot.templateId, Math.max(1, selSlot.trackIds?.length ?? 1))?.nodes,
      )
    : [];
  // Ligne plate = valeur connue à l'insertion : transform du slot pour
  // le transform per-move, transform global courant pour globalfx.
  const clipDefs = clipParamDefsOf(selSlot);
  const globalFxDefs = globalFxParamDefsOf(macros);
  // Lane MODULATION — valeurs nommées libres (clés OSC-like, lues par
  // les SignalOsc des graphs de modulation). Plage convention ±1 :
  // le graph de modulation met à l'échelle, comme pour une vraie
  // source OSC. Pas de "base connue" → ligne plate à 0.
  const selLaneIsGlobalFx = selGlobal === GLOBALFX_LANE;
  const selLaneIsMod = selGlobal === MODULATION_LANE;
  const modNames = Object.keys(modulationCurves ?? {}).sort();
  const modDefs: ParamDef[] = modNames.map((n) => ({ id: n, min: -1, max: 1, def: 0, label: n }));
  const isSlot = selClip?.ref.type === 'slot';
  const ctxParams = selLaneIsGlobalFx
    ? globalFxDefs
    : selLaneIsMod
      ? modDefs
      : [...nodeDefs, ...clipDefs, ...MERGE_BLEND_DEFS];
  const ctxFirst = selLaneIsGlobalFx
    ? globalFxDefs[0].id
    : selLaneIsMod
      ? (modNames[0] ?? '')
      : 'enveloppe';
  // Le chip actif doit exister dans le contexte courant — sinon
  // retombe sur la première entrée du catalogue. Contexte modulation :
  // le nom fraîchement saisi (pas encore de courbe) reste valide.
  const effParam =
    ctxParams.some((p) => p.id === curveParam) || curveParam === ctxFirst
      ? curveParam
      : selLaneIsMod && modName && curveParam === modName
        ? curveParam
        : ctxFirst;

  /// Groupes de lignes de la colonne paramètres — le panneau ne
  /// connaît pas le contexte, ScoreView le résout.
  const paramGroups: ParamGroup[] = selLaneIsGlobalFx
    ? [{
        rows: globalFxDefs.map((p) => ({
          id: p.id,
          active: effParam === p.id,
          hasData: globalFxCurves?.[p.id] != null,
          title: `Courbe globalfx ${p.id} — transform global (merge) — base ${p.def}`,
        })),
      }]
    : selLaneIsMod
      ? [{
          rows: [
            ...modDefs.map((p) => ({
              id: p.id,
              active: effParam === p.id,
              hasData: modulationCurves?.[p.id] != null,
              title: `Valeur nommée ${p.id} — injectée dans la map OSC, lue par SignalOsc`,
            })),
            ...(effParam && !modDefs.some((p) => p.id === effParam)
              ? [{
                  id: effParam,
                  active: true,
                  hasData: false,
                  title: 'Nouvelle valeur — éditez la courbe à droite pour la créer',
                }]
              : []),
          ],
        }]
      : selClip
        ? [
            {
              rows: [{
                id: 'enveloppe',
                active: effParam === 'enveloppe',
                hasData: false,
                title: 'fade-in / fade-out effectifs du clip',
              }],
            },
            ...(isSlot && nodeDefs.length > 0
              ? [{
                  header: 'graphe — params du move',
                  rows: nodeDefs.map((p) => ({
                    id: p.id,
                    active: effParam === p.id,
                    hasData: selClip.curves?.[p.id] != null,
                    title: `${p.label} — param modulable du graphe (base ${p.base}) — courbe absolue, type-wide`,
                    display: p.label,
                  })),
                }]
              : []),
            ...(isSlot
              ? [{
                  header: 'Transform — per-move',
                  rows: clipDefs.map((p) => ({
                    id: p.id,
                    active: effParam === p.id,
                    hasData: selClip.curves?.[p.id] != null,
                    title: `Courbe ${p.id} — per-move (transform du move) — base ${p.def}`,
                  })),
                }]
              : []),
            ...(isSlot
              ? [{
                  header: 'Merge — blend',
                  rows: MERGE_BLEND_DEFS.map((p) => ({
                    id: p.id,
                    active: effParam === p.id,
                    hasData: selClip.curves?.[p.id] != null,
                    title: `Courbe ${p.label} — set_move_${p.id.slice(6)} : fade × weight = poids effectif (Crossfade/Blend/Override) — base ${p.def}`,
                    display: p.label,
                  })),
                }]
              : []),
          ]
        : [];

  return (
    <div ref={splitRootRef} className="flex-1 flex flex-col bg-gray-950 text-gray-200 overflow-hidden select-none">
      <ScoreCurvePane
        topFrac={topFrac}
        selGlobal={selGlobal}
        selClip={selClip ?? null}
        selLaneIsGlobalFx={selLaneIsGlobalFx}
        selLaneIsMod={selLaneIsMod}
        effParam={effParam}
        durationMs={durationMs}
        globalFxDefs={globalFxDefs}
        globalFxCurves={globalFxCurves}
        modDefs={modDefs}
        modulationCurves={modulationCurves}
        nodeDefs={nodeDefs}
        clipDefs={clipDefs}
        selFades={selClip ? effFades(selClip) : undefined}
        selClipLabel={selClip ? clipLabel(selClip) : undefined}
        paramGroups={paramGroups}
        paramEmptyContent={
          <span className="text-[11px] text-gray-600 italic px-1 py-2">
            Sélectionnez un clip ou une lane globale pour éditer ses courbes.
          </span>
        }
        modName={modName}
        setModName={setModName}
        setCurveParam={setCurveParam}
        mergeStrategy={mergeStrategy}
        setMergeStrategy={setMergeStrategy}
        setLaneCurve={setLaneCurve}
        setClipCurve={setClipCurve}
      />
      {/* Poignée de partage éditeur/timeline */}
      <div
        className="h-1 shrink-0 cursor-row-resize bg-gray-800 hover:bg-cyan-700/60 border-y border-gray-900"
        title="Glisser pour régler le partage éditeur / timeline"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          splitDrag.current = true;
        }}
        onPointerMove={(e) => {
          if (!splitDrag.current || !splitRootRef.current) return;
          const r = splitRootRef.current.getBoundingClientRect();
          setTopFrac(Math.min(0.8, Math.max(0.15, (e.clientY - r.top) / r.height)));
        }}
        onPointerUp={() => { splitDrag.current = false; }}
      />
      <ScoreTransport
        playing={playing}
        displayCursor={displayCursor}
        durationMs={durationMs}
        loopStartMs={loopStartMs}
        loopEndMs={loopEndMs}
        pxPerSec={pxPerSec}
        laneH={laneH}
        onPlayStop={() => (playing ? stopScore() : void playScore())}
        onSetDurationMs={setDurationMs}
        onSetLoop={setLoop}
        onZoom={(dir) => setPxPerSec((z) => dir > 0 ? Math.min(400, z * 1.4) : Math.max(10, z / 1.4))}
        onLaneH={setLaneH}
      />
      <ScoreTimeline
        grow={1 - topFrac}
        durationMs={durationMs}
        displayCursor={displayCursor}
        playing={playing}
        tickEvery={tickEvery}
        laneH={laneH}
        rowH={rowH}
        ms2px={ms2px}
        px2ms={px2ms}
        loopStartMs={loopStartMs}
        loopEndMs={loopEndMs}
        seekScore={seekScore}
        lanes={lanes}
        laneLayout={laneLayout}
        laneModeOf={laneModeOf}
        laneMutedOf={laneMutedOf}
        clips={clips}
        globalFxCurves={globalFxCurves}
        modulationCurves={modulationCurves}
        selGlobal={selGlobal}
        selected={selected}
        onSelectLane={(laneId) => { setSelGlobal(laneId); setSelected(null); setPicker(null); }}
        onClearSelection={() => { setSelected(null); setSelGlobal(null); setPicker(null); }}
        onOpenPicker={(laneId, x, y) => setPicker({ laneId, x, y })}
        onToggleLaneMute={toggleLaneMute}
        onSetLaneMode={setLaneMode}
        clipOrphan={clipOrphan}
        effFades={effFades}
        clipLabel={clipLabel}
        onClipPointerDown={onClipPointerDown}
        onClipPointerMove={onClipPointerMove}
        onClipPointerUp={onClipPointerUp}
      />

      {/* Picker d'ajout de clip — globalfx → markers ; lane objet →
          slots/cues. La couverture du clip suit l'assignation : slot
          → ses trackIds, cue → la couverture dérivée du snapshot. */}
      {picker && (
        <ScoreClipPicker
          picker={picker}
          moveSlots={moveSlots}
          cues={cues}
          manualOscIds={manualOscIds}
          onPick={addToLane}
        />
      )}

      {/* Bandeau info bas — inspector du clip sélectionné */}
      <ScoreInspector
        clipsCount={clips.length}
        selected={selClip ?? null}
        clipLabel={clipLabel}
        manualOscIds={manualOscIds}
        covered={covered}
        durationMs={durationMs}
        onMoveClip={moveClip}
        onResizeClip={resizeClip}
        onSetClipFades={setClipFades}
        onSetClipRepeat={setClipRepeat}
        onSetClipTrackIds={setClipTrackIds}
        onDuplicateClip={duplicateClip}
      />
    </div>
  );
};

export default ScoreView;
