/// Explosion d'un clip cue en primitives timeline (docs/score-sequencer.md).
/// « Bounce to tracks » : le snapshot de la cue devient un arrangement de
/// clips ordinaires — la cue d'origine reste intacte dans la cuelist et
/// rappelable en Conduite ; le matériau explosé est indépendant (nouveaux
/// slots en banque, éditables partout).
///
/// Mapping : `moves[]` → slots de banque + clips slot suivis (live) ;
/// `macros` → keyframes GLOBALFX à l'instant du clip. Le reste du
/// snapshot n'a pas d'entité timeline correspondante — il n'est PAS
/// silencieusement perdu : listé dans `skipped` et restitué à
/// l'opérateur (la cue conserve tout, le flatten est honnêtement partiel).
import { useScoreStore, GLOBALFX_LANE } from '../store/useScoreStore';
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { defaultMacros, type MoveSlot } from '../store/slices/moveSlotsTypes';
import type { Cue } from '../types/generated/Cue';
import type { MoveSnapshot } from '../types/generated/MoveSnapshot';

export interface FlattenCueResult {
  /// Clips slot créés (un par move du snapshot).
  movedClips: number;
  /// Keyframes GLOBALFX posés.
  macroKeys: number;
  /// Catégories du snapshot non mappables — rien n'est perdu, la cue
  /// d'origine garde tout ; l'opérateur est averti.
  skipped: string[];
}

const MACRO_FIELDS = ['speed', 'scale', 'shift_x', 'shift_y', 'shift_z', 'yaw', 'pitch', 'roll'] as const;

/// Construit le slot de banque matérialisant un MoveSnapshot.
/// track_indices/osc_ids sont en obj_index → conversion track_id via
/// la liste courante (règle namespace AGENTS.md).
function slotFromMove(cue: Cue, mv: MoveSnapshot, index: number, osc: number[]): MoveSlot {
  const idx = (mv.track_indices?.length ? mv.track_indices : mv.osc_ids) ?? [];
  const trackIds = idx.map((i) => osc[i]).filter((t): t is number => t != null);
  return {
    id: `slot-${Date.now()}-${index}`,
    name: `${cue.name}·${mv.name}`,
    graphJson: (mv.graph_json ?? null) as MoveSlot['graphJson'],
    signalGraph: (mv.signal_graph ?? null) as MoveSlot['signalGraph'],
    templateId: 'cue-flatten',
    trackIds: trackIds.length ? trackIds : osc,
    movementId: null,
    isPreview: mv.is_preview ?? false,
    macros: defaultMacros(),
    fadeDuration: 2,
    loopMode: mv.loop_mode === 'oneshot' ? 'oneshot' : 'loop',
    direction: mv.direction === 'backward' || mv.direction === 'ping_pong' ? mv.direction : 'forward',
    fadeIn: mv.fade_in ?? 0.5,
    fadeOut: mv.fade_out ?? 0.5,
    endMode: (mv.end_mode ?? undefined) as MoveSlot['endMode'],
    anchorMode: (mv.anchor_mode ?? undefined) as MoveSlot['anchorMode'],
    anchorTarget: mv.anchor_target != null ? osc[mv.anchor_target] : undefined,
    phaseSpread: 0,
    assignments: [],
    audioMods: [],
    oscIndex: 0,
  };
}

/// `Exploser la cue → clips` : remplace le clip cue par l'arrangement
/// contenu dans son snapshot à l'instant du clip. Retourne le rapport
/// (undefined si le clip n'est pas une cue ou la cue est introuvable).
export function flattenCueClip(clipId: string): FlattenCueResult | undefined {
  const score = useScoreStore.getState();
  const clip = score.clips.find((c) => c.id === clipId);
  if (!clip || clip.ref.type !== 'cue') return undefined;
  const cue = useCuelistStore.getState().cues.find((q) => String(q.id) === String(clip.ref.type === 'cue' ? clip.ref.cueId : ''));
  if (!cue) return undefined;
  const gs = useGraphStore.getState();
  const osc = gs.manualOscIds;
  const res: FlattenCueResult = { movedClips: 0, macroKeys: 0, skipped: [] };
  const t0 = clip.startMs;

  // Moves → slots en banque (insérés avant les clips — les labels /
  // orphan-checks résolvent live) + clips qui les SUIVENT (pas
  // d'override : la couverture vit dans le slot matérialisé).
  const moves = cue.moves ?? [];
  const slots = moves.map((mv, i) => slotFromMove(cue, mv, i, osc));
  if (slots.length) {
    gs.insertMoveSlots(slots);
    moves.forEach((mv, i) => {
      score.addClip({ type: 'slot', slotId: slots[i].id }, t0, {
        durationMs: Math.round((mv.duration ?? 4) * 1000),
      });
      res.movedClips++;
    });
  }

  // Macros → keyframes GLOBALFX à t0 (insertion triée, remplace un
  // éventuel point existant à cet instant). Spatial macros = 2 champs
  // supplémentaires de la même lane (radius_scale/height_offset).
  if (cue.macros) {
    for (const p of MACRO_FIELDS) {
      const v = cue.macros[p as keyof typeof cue.macros];
      if (typeof v !== 'number') continue;
      const cur = score.globalFxCurves?.[p] ?? [];
      score.setLaneCurve(GLOBALFX_LANE, p, [...cur.filter((k) => k.t !== t0), { t: t0, v }].sort((a, b) => a.t - b.t));
      res.macroKeys++;
    }
  }
  if (cue.spatial_macros) {
    for (const p of ['radius_scale', 'height_offset'] as const) {
      const v = cue.spatial_macros[p];
      if (typeof v !== 'number') continue;
      const cur = score.globalFxCurves?.[p] ?? [];
      score.setLaneCurve(GLOBALFX_LANE, p, [...cur.filter((k) => k.t !== t0), { t: t0, v }].sort((a, b) => a.t - b.t));
      res.macroKeys++;
    }
  }

  // Positions manuelles → clip `positions` (obj_index → track_id à
  // l'explosion — le clip porte sa donnée en espace opérateur).
  const manual = Object.entries(cue.manual_positions ?? {})
    .map(([o, p]) => [osc[Number(o)], p] as const)
    .filter((e): e is [number, [number, number, number]] => e[0] != null);
  if (manual.length) {
    score.addClip({ type: 'positions', positions: Object.fromEntries(manual) }, t0, {});
    res.movedClips++;
  }

  // Graph signal global → clip `modGraph` sur la lane MODULATION.
  if (cue.signal_graph) {
    score.addClip({ type: 'modGraph', graph: cue.signal_graph as never }, t0, {});
    res.movedClips++;
  }

  // Honnêteté : ces catégories n'ont pas (encore) d'entité timeline —
  // signalées, jamais silencieusement abandonnées.
  if (cue.object_channels) res.skipped.push('channels');
  if (cue.osc_mappings?.length) res.skipped.push('osc_mappings');
  if (cue.zones?.length) res.skipped.push('zones');
  if (cue.per_track_depths?.length) res.skipped.push('depths');

  // Rien à matérialiser (snapshot vide ou catégories non mappables
  // seulement) → le clip est conservé : supprimer la seule
  // représentation de la cue perdrait l'information de placement.
  // Le clip cue laisse sinon place au matériau explosé — le garder
  // double-firerait (rappel de cue + clips matérialisés).
  if (res.movedClips === 0 && res.macroKeys === 0) return res;
  score.removeClip(clipId);
  score.clearScoreSelection();
  return res;
}

/// Restitution uniforme du rapport d'explosion (contexte / toolbar /
/// MenuBar) — le skipped n'est jamais silencieux.
export function reportFlatten(r: FlattenCueResult): { kind: 'success' | 'warning' | 'info'; message: string } {
  const detail = [`${r.movedClips} clip(s)`, r.macroKeys ? `${r.macroKeys} keyframes` : ''].filter(Boolean).join(', ');
  if (r.movedClips === 0 && r.macroKeys === 0) {
    return {
      kind: r.skipped.length ? 'warning' : 'info',
      message: r.skipped.length
        ? `Rien à exploser — contenu non matérialisable : ${r.skipped.join(', ')} (clip conservé)`
        : 'Snapshot vide — rien à exploser (clip conservé)',
    };
  }
  if (r.skipped.length) return { kind: 'warning', message: `Cue explosée : ${detail} — non matérialisé : ${r.skipped.join(', ')}` };
  return { kind: 'success', message: `Cue explosée : ${detail}` };
}
