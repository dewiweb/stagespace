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
///   ScoreDopesheet.tsx  vue d'ensemble éditable (aucune sélection)
///   ScoreClipParams.tsx params du clip (ex-inspector, zone haute)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useScoreStore, GLOBALFX_LANE, MODULATION_LANE, CONDUCTOR_LANE, OSC_LANE, SPATIALFX_LANE, laneIdOf,
  type ScoreClipDoc, type ScoreLaneMode,
} from '../../store/useScoreStore';
import { useGraphStore } from '../../store/useGraphStore';
import { useCuelistStore } from '../../store/useCuelistStore';
import { buildGraphForSlot, type MoveSlot } from '../../store/slices/moveSlotsTypes';
import {
  nodeParamDefsOf, clipParamDefsOf, globalFxParamDefsOf, spatialFxParamDefsOf, MERGE_BLEND_DEFS, OBJECT_LANE_DEFS,
  type ParamDef,
} from './scoreParams';
import { clipLabel as clipLabelOf, isTextEntryTarget, fmtMs } from './scoreUtils';
import { effectiveTrackIds } from '../../utils/scoreResolve';
import { isModalOpen } from '../../utils/modalGuard';
import { ScoreCurvePane } from './ScoreCurvePane';
import type { ParamGroup } from './ScoreParamsPanel';
import { ScoreTransport } from './ScoreTransport';
import { ScoreTimeline, type ScoreLaneLayout, type ScoreMenuTarget } from './ScoreTimeline';
import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu';
import { detachLaneFromClip, makeClipUnique, sharedClipCount } from '../../utils/scoreDetach';
import { flattenCueClip, reportFlatten } from '../../utils/scoreFlatten';
import { snapshotScoreAt } from '../../utils/scoreSnapshot';
import { validateScore, type ScoreIssue } from '../../utils/scoreValidate';
import { toast } from '../../utils/toast-helpers';
import Modal from '../ui/Modal';
import { ScoreClipPicker, type ScorePickerState } from './ScoreClipPicker';
import { ScoreToolbar } from './ScoreToolbar';
import { ScoreDopesheet } from './ScoreDopesheet';
import { ScoreClipParams } from './ScoreClipParams';
import { collectDopesheetRows, type DopeRow } from '../../utils/scoreDopesheet';
import type { ClipDragMode } from './ScoreClipBlock';

const ScoreView: React.FC = () => {
  const clips = useScoreStore((s) => s.clips);
  const laneStates = useScoreStore((s) => s.laneStates);
  const durationMs = useScoreStore((s) => s.durationMs);
  const playing = useScoreStore((s) => s.playing);
  const tcChase = useScoreStore((s) => s.tcChase);
  const cursorMs = useScoreStore((s) => s.cursorMs);
  const loopStartMs = useScoreStore((s) => s.loopStartMs);
  const loopEndMs = useScoreStore((s) => s.loopEndMs);
  const globalFxCurves = useScoreStore((s) => s.globalFxCurves);
  const modulationCurves = useScoreStore((s) => s.modulationCurves);
  const spatialFxCurves = useScoreStore((s) => s.spatialFxCurves);
  const objectCurves = useScoreStore((s) => s.objectCurves);
  const { addClip, moveClip, resizeClip, removeClip, duplicateClip, splitClip, setDurationMs, setClipRepeat, setClipFades, setClipCurve, setClipTrackIds, setLaneCurve, setLoop, playScore, stopScore, seekScore, toggleLaneMute, setLaneMode, selectClip, selectGlobalLane, clearScoreSelection, retargetClip } =
    useScoreStore.getState();
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const macros = useGraphStore((s) => s.macros);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const mergeStrategy = useGraphStore((s) => s.mergeStrategy);
  const setMergeStrategy = useGraphStore((s) => s.setMergeStrategy);
  const cues = useCuelistStore((s) => s.cues);

  const [pxPerSec, setPxPerSec] = useState(60);
  // Sélection dans le store — toolbar + MenuBar agissent dessus.
  const selected = useScoreStore((s) => s.selectedClipId);
  /// Lane globale sélectionnée (`globalfx`/`modulation`) — contexte
  /// d'édition de la zone haute. Pseudo-lanes épinglées : leurs
  /// courbes vivent au niveau du doc en temps absolu partition.
  const selGlobal = useScoreStore((s) => s.selGlobalLane);
  /// Nom fraîchement saisi pour une nouvelle courbe modulation
  /// (clé libre — `/score/energy`, `/mod/x`… lue par les SignalOsc).
  const [modName, setModName] = useState('');
  const [picker, setPicker] = useState<ScorePickerState | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ target: ScoreMenuTarget; x: number; y: number } | null>(null);
  /// Rapport preflight (validateScore) — null = modale fermée.
  const [issues, setIssues] = useState<ScoreIssue[] | null>(null);
  /// Partage éditeur/timeline — drag sur la poignée, défaut 50/50.
  const [topFrac, setTopFrac] = useState(0.5);
  const splitRootRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef(false);
  // Curseur animé pendant la lecture — base = dernier état poussé par
  // le backend + delta wall-clock local (l'horloge de vérité reste
  // backend ; ceci n'est que l'affichage).
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
  const covered = new Set(clips.flatMap((c) => effectiveTrackIds(c)));
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
    // Seuls les slots occupent des lanes objets — la couverture des
    // barrières (cue) n'est qu'un blast radius visuel.
    const laneClips = clips.filter((c) => c.ref.type === 'slot' && effectiveTrackIds(c).includes(lane.trackId));
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
    selectClip(clip.id);
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

  // Suppression au clavier du clip sélectionné. Phase CAPTURE : le
  // handler global (useLiveShortcuts, Backspace → cue précédent) est
  // en bubbling — on consomme la touche avant lui via preventDefault
  // (il bail sur defaultPrevented). Un modal ouvert ou une saisie
  // texte bloque (les INPUT non-textuels comme les sliders ne
  // bloquent PAS — sinon le slider qui garde le focus rend Delete
  // muet).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        if (isModalOpen() || isTextEntryTarget(e.target)) return;
        e.preventDefault();
        removeClip(selected);
        clearScoreSelection();
      }
      // S — split du clip sélectionné au curseur (même verbe que la
      // toolbar et le menu Edit).
      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey && selected) {
        if (isModalOpen() || isTextEntryTarget(e.target)) return;
        e.preventDefault();
        splitClip(selected, displayCursor);
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [selected, removeClip, splitClip, displayCursor, clearScoreSelection]);

  const addToLane = (ref: ScoreClipDoc['ref'], opts?: { durationMs?: number; trackIds?: number[]; repeatEveryMs?: number }) => {
    addClip(ref, picker?.startMs ?? displayCursor, opts);
    setPicker(null);
  };

  /// Menu contextuel (clic droit) — items par cible. Le clip est
  /// sélectionné au passage pour que l'inspector reflète la cible.
  const ctxMenuItems = (): { header?: string; items: ContextMenuItem[] } => {
    if (!ctxMenu) return { items: [] };
    const t = ctxMenu.target;
    if (t.kind === 'clip') {
      const c = clips.find((x) => x.id === t.clipId);
      if (!c) return { items: [] };
      const eff = effectiveTrackIds(c);
      const laneSuffix = t.trackId !== undefined ? ` — T${t.trackId}` : '';
      const isSlot = c.ref.type === 'slot';
      const isCue = c.ref.type === 'cue';
      const canDetach = isSlot && t.trackId !== undefined && eff.length > 1;
      const n = sharedClipCount(c.ref);
      const items: ContextMenuItem[] = [
        // Le déliage de couverture n'existe que sur un clip slot —
        // afficher « Détacher Tundefined » désactivé sur les autres
        // types (cue, markers, graph) n'apporte que du bruit.
        ...(isSlot
          ? [
              {
                label: `Détacher T${t.trackId}`,
                disabled: !canDetach,
                title: canDetach
                  ? 'Scinde la couverture : cette piste devient un clip indépendant (même move, placement libre)'
                  : 'Détachable seulement sur un clip multi-objets (slot)',
                onClick: () => {
                  if (detachLaneFromClip(c.id, t.trackId!, false)) toast.success(`T${t.trackId} détachée en clip indépendant`);
                },
              },
              {
                label: `Détacher T${t.trackId} en nouveau move`,
                disabled: !canDetach,
                title: canDetach
                  ? 'La piste devient un clip suivant un NOUVEAU move en banque (contenu divergent possible)'
                  : 'Détachable seulement sur un clip multi-objets (slot)',
                onClick: () => {
                  if (detachLaneFromClip(c.id, t.trackId!, true)) toast.success(`Nouveau move créé pour T${t.trackId}`);
                },
              },
            ]
          : []),
        {
          label: `Rendre unique${n > 1 ? ` (lié ×${n})` : ''}`,
          disabled: !isSlot && !isCue,
          title: isSlot
            ? `Clone le move en banque — ce clip suit la copie, ${n > 1 ? `les ${n - 1} autre(s) clip(s) gardent l'original` : 'édition sans affecter l\'original'}`
            : isCue
              ? 'Duplique la cue dans la cuelist — ce clip suit la copie, les autres références gardent l\'originale'
              : 'Pas d\'entité à dupliquer sur un marker',
          onClick: () => {
            const id = makeClipUnique(c.id);
            if (id) toast.success(isCue ? 'Cue dupliquée dans la cuelist — le clip suit la copie' : 'Move dupliqué — le clip suit la copie');
          },
        },
        {
          label: 'Exploser la cue → clips',
          disabled: !isCue,
          title: isCue
            ? 'Matérialise le snapshot en arrangement éditable (moves → clips, macros → GLOBALFX) — la cue d\'origine reste intacte'
            : 'Explosion : clips cue seulement',
          onClick: () => {
            const r = flattenCueClip(c.id);
            if (r) { const rep = reportFlatten(r); toast[rep.kind](rep.message); }
          },
        },
        { separator: true },
        { label: 'Dupliquer le clip', onClick: () => duplicateClip(c.id) },
        {
          label: 'Supprimer',
          danger: true,
          onClick: () => { removeClip(c.id); if (selected === c.id) clearScoreSelection(); },
        },
      ];
      if (isSlot || isCue) {
        items.push(
          { separator: true },
          c.trackIds === undefined
            ? {
                label: 'Geler la couverture',
                title: 'La couverture actuelle devient un override explicite (ne suit plus l\'entité)',
                onClick: () => setClipTrackIds(c.id, eff),
              }
            : {
                label: 'Repasser en suivi live',
                title: 'La couverture re-dérive de l\'entité référencée (réassignations Atelier reflétées)',
                onClick: () => setClipTrackIds(c.id, undefined),
              },
        );
      }
      return { header: `${clipLabel(c)}${laneSuffix}`, items };
    }
    if (t.kind === 'lane') {
      const muted = laneMutedOf(t.laneId);
      const isObj = t.trackId !== undefined;
      const stacked = laneModeOf(t.laneId) === 'stacked';
      const items: ContextMenuItem[] = [
        { label: muted ? 'Démuter la lane' : 'Muter la lane', onClick: () => toggleLaneMute(t.laneId) },
        {
          label: stacked ? 'Passer en exclusive' : 'Passer en stacked',
          disabled: !isObj,
          title: isObj ? 'Mode de chevauchement des clips sur cette lane' : 'Les lanes globales sont exclusive par nature',
          onClick: () => setLaneMode(t.laneId, stacked ? 'exclusive' : 'stacked'),
        },
        { separator: true },
        {
          label: 'Ajouter un clip ici…',
          disabled: t.laneId === GLOBALFX_LANE || t.laneId === MODULATION_LANE || t.laneId === SPATIALFX_LANE,
          title: t.laneId === OSC_LANE
            ? 'Clip message OSC-out (lumières/vidéo/consoles externes)'
            : 'Les courbes des lanes globales s\'éditent en zone haute',
          onClick: () => setPicker({ laneId: t.laneId, x: ctxMenu.x, y: ctxMenu.y }),
        },
      ];
      return { header: isObj ? `Lane T${t.trackId}` : t.laneId, items };
    }
    if (t.kind === 'empty') {
      const canAdd = t.laneId === CONDUCTOR_LANE || t.laneId === OSC_LANE || t.trackId !== undefined;
      return {
        items: [{
          label: `Ajouter un clip à ${fmtMs(t.ms)}…`,
          disabled: !canAdd,
          title: canAdd ? undefined : 'Les courbes des lanes globales s\'éditent en zone haute',
          onClick: () => setPicker({ laneId: t.laneId, x: ctxMenu.x, y: ctxMenu.y, startMs: t.ms }),
        }],
      };
    }
    // ruler — bornes de loop
    const armed = loopStartMs != null && loopEndMs != null;
    return {
      header: fmtMs(t.ms),
      items: [
        {
          label: 'Loop : début ici',
          disabled: armed && t.ms >= loopEndMs!,
          title: 'Le début de région doit précéder la fin',
          onClick: () => setLoop(t.ms, loopEndMs ?? durationMs),
        },
        {
          label: 'Loop : fin ici',
          disabled: loopStartMs == null || t.ms <= loopStartMs,
          title: loopStartMs == null ? 'Posez d\'abord le début' : 'La fin doit suivre le début',
          onClick: () => setLoop(loopStartMs, t.ms),
        },
        { separator: true },
        {
          label: 'Désarmer la loop',
          disabled: !armed,
          onClick: () => setLoop(undefined, undefined),
        },
      ],
    };
  };

  const openCtxMenu = (target: ScoreMenuTarget, x: number, y: number) => {
    setPicker(null);
    if (target.kind === 'clip') selectClip(target.clipId);
    setCtxMenu({ target, x, y });
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
  // Lane SPATIALFX — surcouche d'effets : les defs zone:*/mod:* sont
  // dérivées des clips zones/chanMods installés (une courbe ne module
  // qu'une contrainte qui existe) + ksmooth + clés orphelines.
  const selLaneIsSpatialFx = selGlobal === SPATIALFX_LANE;
  const spatialFxDefs = spatialFxParamDefsOf(clips, spatialFxCurves);
  // Lane objet sélectionnée (`obj-<trackId>`) — courbes depth/canaux.
  const selObjLane = selGlobal?.startsWith('obj-') ? selGlobal : null;
  // Lane OSC — événements one-shot (messages externes) : aucune courbe.
  const selLaneIsOsc = selGlobal === OSC_LANE;
  const modNames = Object.keys(modulationCurves ?? {}).sort();
  const modDefs: ParamDef[] = modNames.map((n) => ({ id: n, min: -1, max: 1, def: 0, label: n }));
  const isSlot = selClip?.ref.type === 'slot';
  const ctxParams = selLaneIsGlobalFx
    ? globalFxDefs
    : selLaneIsMod
      ? modDefs
      : selLaneIsSpatialFx
        ? spatialFxDefs
        : selObjLane
          ? OBJECT_LANE_DEFS
          : selLaneIsOsc
            ? []
            : [...nodeDefs, ...clipDefs, ...MERGE_BLEND_DEFS];
  const ctxFirst = selLaneIsGlobalFx
    ? globalFxDefs[0].id
    : selLaneIsMod
      ? (modNames[0] ?? '')
      : selLaneIsSpatialFx
        ? spatialFxDefs[0].id
        : selObjLane
          ? OBJECT_LANE_DEFS[0].id
          : selLaneIsOsc
            ? ''
            : selClip
              ? 'clip'
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
      : selLaneIsSpatialFx
        ? [{
            rows: spatialFxDefs.map((p) => ({
              id: p.id,
              active: effParam === p.id,
              hasData: spatialFxCurves?.[p.id] != null,
              title: `Courbe ${p.label ?? p.id} — réécrit la définition dans la table courante (l'influence reste évaluée par le merge)`,
              display: p.label,
            })),
          }]
        : selObjLane
        ? [{
            rows: OBJECT_LANE_DEFS.map((p) => ({
              id: p.id,
              active: effParam === p.id,
              hasData: objectCurves?.[selObjLane]?.[p.id] != null,
              title: p.id === 'depth'
                ? `Courbe depth — per_track_depth de ${selObjLane} (lu par PerTrackDepth, absent = 1.0)`
                : `Courbe ${p.id} — canal spatial de ${selObjLane} (SpatialChannel, émis en OSC) — base ${p.def}`,
            })),
          }]
        : selLaneIsOsc
        ? []
        : selClip
        ? [
            {
              rows: [
                {
                  id: 'clip',
                  active: effParam === 'clip',
                  hasData: false,
                  title: 'Paramètres du clip — couverture, timing, référence',
                },
                ...(isSlot
                  ? [{
                      id: 'enveloppe',
                      active: effParam === 'enveloppe',
                      hasData: false,
                      title: 'fade-in / fade-out effectifs du clip',
                    }]
                  : []),
              ],
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

  // ── Dopesheet (rien de sélectionné) — vue d'ensemble éditable de
  //    toute l'automation. Rangées collectées depuis le doc courant.
  const [hScroll, setHScroll] = useState(0);
  const dopeRows = useMemo(
    () => collectDopesheetRows(
      {
        laneStates, clips, durationMs,
        globalFxCurves, modulationCurves, spatialFxCurves, objectCurves,
      },
      (c) => clipLabelOf(c, moveSlots, cues),
    ),
    [laneStates, clips, durationMs, globalFxCurves, modulationCurves, spatialFxCurves, objectCurves, moveSlots, cues],
  );
  /// ParamDef de la rangée — pour le drag vertical (valeur). Les defs
  /// clip-scoped dépendent du slot porteur de CHAQUE clip.
  const dopeParamDefOf = useCallback((row: DopeRow): ParamDef | undefined => {
    if (row.kind === 'events') return undefined;
    if (row.kind === 'lane-curve') {
      if (row.laneId === GLOBALFX_LANE) return globalFxDefs.find((d) => d.id === row.paramId);
      if (row.laneId === SPATIALFX_LANE) return spatialFxDefs.find((d) => d.id === row.paramId);
      if (row.laneId === MODULATION_LANE) return modDefs.find((d) => d.id === row.paramId);
      return OBJECT_LANE_DEFS.find((d) => d.id === row.paramId);
    }
    const clip = clips.find((c) => c.id === row.clipId);
    const slot = clip?.ref.type === 'slot'
      ? moveSlots.find((s) => s.id === (clip.ref as { slotId: string }).slotId)
      : undefined;
    return [...nodeParamDefsOf(
      slot?.graphJson?.nodes ??
        (slot ? buildGraphForSlot(slot.templateId, Math.max(1, slot.trackIds?.length ?? 1))?.nodes : undefined),
    ), ...clipParamDefsOf(slot), ...MERGE_BLEND_DEFS].find((d) => d.id === row.paramId);
  }, [clips, moveSlots, globalFxDefs, spatialFxDefs, modDefs]);
  /// Sélection d'une rangée → bascule vers son contexte d'édition.
  const onDopeSelectRow = useCallback((row: DopeRow) => {
    if (row.kind === 'clip-curve' && row.clipId) {
      selectClip(row.clipId);
      if (row.paramId) setCurveParam(row.paramId);
    } else if (row.laneId) {
      selectGlobalLane(row.laneId);
      if (row.paramId) setCurveParam(row.paramId);
    }
  }, [selectClip, selectGlobalLane]);
  /// Drag ◆ courbe — retime (t) + valeur (v). Le setter re-trie.
  const onDopeMoveKf = useCallback((row: DopeRow, kfIdx: number, t: number, v?: number) => {
    const read = () => row.kind === 'clip-curve'
      ? clips.find((c) => c.id === row.clipId)?.curves?.[row.paramId ?? '']
      : row.laneId === GLOBALFX_LANE ? globalFxCurves?.[row.paramId ?? '']
        : row.laneId === SPATIALFX_LANE ? spatialFxCurves?.[row.paramId ?? '']
          : row.laneId === MODULATION_LANE ? modulationCurves?.[row.paramId ?? '']
            : objectCurves?.[row.laneId ?? '']?.[row.paramId ?? ''];
    const kfs = read();
    if (!kfs || !row.paramId) return;
    const next = kfs.map((k, i) => (i === kfIdx ? { ...k, t, v: v ?? k.v } : k));
    if (row.kind === 'clip-curve' && row.clipId) setClipCurve(row.clipId, row.paramId, next);
    else if (row.laneId) setLaneCurve(row.laneId, row.paramId, next);
  }, [clips, globalFxCurves, spatialFxCurves, modulationCurves, objectCurves, setClipCurve, setLaneCurve]);

  return (
    <div ref={splitRootRef} className="flex-1 flex flex-col bg-gray-950 text-gray-200 overflow-hidden select-none">
      <ScoreCurvePane
        topFrac={topFrac}
        selGlobal={selGlobal}
        selClip={selClip ?? null}
        selLaneIsGlobalFx={selLaneIsGlobalFx}
        selLaneIsMod={selLaneIsMod}
        selLaneIsSpatialFx={selLaneIsSpatialFx}
        spatialFxDefs={spatialFxDefs}
        spatialFxCurves={spatialFxCurves}
        selObjLane={selObjLane}
        objectCurves={objectCurves}
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
        dopesheet={
          <ScoreDopesheet
            rows={dopeRows}
            durationMs={durationMs}
            ms2px={ms2px}
            px2ms={px2ms}
            displayCursor={displayCursor}
            loopStartMs={loopStartMs}
            loopEndMs={loopEndMs}
            paramDefOf={dopeParamDefOf}
            onSelectRow={onDopeSelectRow}
            onSeek={seekScore}
            onMoveKf={onDopeMoveKf}
            onMoveClip={moveClip}
            scrollLeft={hScroll}
            onHScroll={setHScroll}
          />
        }
        clipParams={selClip ? (
          <ScoreClipParams
            clip={selClip}
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
            onUpdateRef={retargetClip}
          />
        ) : undefined}
        footer={
          <div className="flex items-center justify-end gap-2 text-[9px] text-gray-600">
            <span>{clips.length} clip(s)</span>
            <button className="hover:text-gray-300" onClick={() => {
              useScoreStore.getState().clearScore();
              toast.info('Score vidé');
            }}>Vider le score</button>
          </div>
        }
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
        onCaptureCue={() => {
          // Re-capture arrangement→cue : état de la partition au curseur
          // → StoreScoreCueRequest complet (aucune capture live).
          void (async () => {
            try {
              const { holProject } = useGraphStore.getState();
              const { request, skipped } = await snapshotScoreAt(displayCursor, { holProject, manualOscIds });
              request.name = `Score @${fmtMs(displayCursor)}`;
              const cue = await useCuelistStore.getState().storeScoreCue(request);
              const detail = skipped.length ? ` — ignoré : ${skipped.join(', ')}` : '';
              toast.success(`Cue « ${cue.name} » capturée (${request.moves.length} move(s))${detail}`);
            } catch (e) {
              toast.error(`Capture cue échouée : ${e}`);
            }
          })();
        }}
        onValidate={() => setIssues(validateScore())}
        tcChase={tcChase}
        onTcChase={() => useScoreStore.getState().setTcChase(!tcChase)}
      />
      <ScoreToolbar
        selClip={selClip ?? null}
        cursorMs={displayCursor}
        onSplit={splitClip}
        onDuplicate={duplicateClip}
        onDelete={(id) => { removeClip(id); clearScoreSelection(); }}
        onDetachLane={(id, tid, asNewMove) => {
          if (detachLaneFromClip(id, tid, asNewMove)) {
            toast.success(asNewMove ? `T${tid} détachée → nouveau move en banque` : `T${tid} détachée en clip indépendant`);
          }
        }}
        onMakeUnique={(id) => {
          const wasCue = clips.find((x) => x.id === id)?.ref.type === 'cue';
          if (makeClipUnique(id)) toast.success(wasCue ? 'Cue dupliquée — le clip suit la copie' : 'Move dupliqué — le clip suit la copie');
        }}
        onFlattenCue={(id) => {
          const r = flattenCueClip(id);
          if (r) { const rep = reportFlatten(r); toast[rep.kind](rep.message); }
        }}
        onToggleFollow={(id) => {
          const c = clips.find((x) => x.id === id);
          if (c) setClipTrackIds(id, c.trackIds === undefined ? effectiveTrackIds(c) : undefined);
        }}
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
        spatialFxCurves={spatialFxCurves}
        objectCurves={objectCurves}
        selGlobal={selGlobal}
        selected={selected}
        onSelectLane={(laneId) => { selectGlobalLane(laneId); setPicker(null); }}
        onClearSelection={() => { clearScoreSelection(); setPicker(null); }}
        onOpenPicker={(laneId, x, y) => setPicker({ laneId, x, y })}
        onToggleLaneMute={toggleLaneMute}
        onSetLaneMode={setLaneMode}
        clipOrphan={clipOrphan}
        effFades={effFades}
        clipLabel={clipLabel}
        onClipPointerDown={onClipPointerDown}
        onClipPointerMove={onClipPointerMove}
        onClipPointerUp={onClipPointerUp}
        onContextMenu={openCtxMenu}
        scrollLeft={hScroll}
        onHScroll={setHScroll}
      />

      {/* Picker d'ajout de clip — globalfx → markers ; lane objet →
          slots/cues. La couverture du clip suit l'assignation : slot
          → ses trackIds, cue → la couverture dérivée du snapshot. */}
      {picker && (
        <ScoreClipPicker
          picker={picker}
          moveSlots={moveSlots}
          cues={cues}
          onPick={addToLane}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Menu contextuel timeline — items dépendent de la cible
          (clip/lane/corps vide/ruler). */}
      {ctxMenu && (() => {
        const { header, items } = ctxMenuItems();
        return (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            header={header}
            items={items}
            onClose={() => setCtxMenu(null)}
          />
        );
      })()}

      {/* Preflight — rapport de la résolution sèche (✓ check) */}
      {issues && (
        <Modal
          title={`Preflight — ${issues.length === 0 ? 'partition saine' : `${issues.filter((i) => i.level === 'error').length} erreur(s), ${issues.filter((i) => i.level === 'warning').length} avertissement(s)`}`}
          onClose={() => setIssues(null)}
          widthClass="max-w-lg"
        >
          {issues.length === 0 ? (
            <p className="text-xs text-green-400 px-1 py-2">Aucun problème détecté — la partition jouera comme affichée.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto space-y-1 px-1 py-1">
              {issues.map((it, i) => (
                <li key={i} className={`text-[11px] leading-snug ${it.level === 'error' ? 'text-red-300' : 'text-amber-200/90'}`}>
                  <span className="font-bold mr-1">{it.level === 'error' ? '✕' : '⚠'}</span>
                  {it.message}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

    </div>
  );
};

export default ScoreView;
