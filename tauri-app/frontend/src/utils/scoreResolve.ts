/// Résolution des clips du score → payloads backend (S2/S3). Le
/// document référence les entités vivantes (slotId/cueId) ; au
/// `playScore` on construit les payloads que le backend exécutera
/// seul — la lecture ne dépend alors plus de la webview.
/// Slots : request via le builder partagé (`buildSlotActivation`) —
/// L'ASSIGNATION DU CLIP (trackIds) remplace celle du slot :
/// restreindre la couverture filtre les osc_ids/track_indices du
/// spawn, l'étendre ajoute des tracks au move (comme une
/// réassignation dans l'Atelier). Cues : snapshot tel quel (le
/// store garde l'objet Cue backend depuis store_cue) — la
/// couverture trackIds est info visuelle, le recall reste global.
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { normalizeSlot } from '../store/slices/moveSlotsTypes';
import { buildSlotActivation } from './slotActivation';
import { CONDUCTOR_LANE, MODULATION_LANE, laneIdOf, clipLaneIds } from '../store/useScoreStore';
import type { ScoreDoc, ScoreClipDoc } from '../store/useScoreStore';

/// Une lane wire — `id` (`obj-<trackId>`/`master`) + mode. Le backend
/// coupe les moves précédents par lane en mode exclusive uniquement.
export interface ResolvedLane {
  id: string;
  stacked?: boolean;
}

export interface ResolvedScoreClip {
  id: string;
  /// Lanes occupées — `obj-<trackId>` pour slot/cue, `master` pour
  /// les markers. Le backend y enregistre ses moves actifs.
  lanes: ResolvedLane[];
  start_ms: number;
  duration_ms?: number;
  repeat_every_ms?: number;
  /// Fades clip-local (ms) — override des fades du slot ; absent =
  /// le backend prend l'animation du slot.
  fade_in_ms?: number;
  fade_out_ms?: number;
  /// Courbes clip-scoped (S3) — param → keyframes {t relatif, v
  /// absolue}, écrites live sur les macros per-move du worker.
  curves?: Record<string, { t: number; v: number }[]>;
  payload: Record<string, unknown>;
}

export interface ResolveResult {
  clips: ResolvedScoreClip[];
  errors: string[];
}

export async function resolveScoreClips(doc: ScoreDoc): Promise<ResolveResult> {
  const gs = useGraphStore.getState();
  const cs = useCuelistStore.getState();
  const ctx = { holProject: gs.holProject, manualOscIds: gs.manualOscIds };
  const laneState = (laneId: string) => doc.laneStates?.[laneId];
  const clips: ResolvedScoreClip[] = [];
  const errors: string[] = [];

  for (const c of doc.clips) {
    const isBarrier = c.ref.type === 'cue' || c.ref.type === 'stopAll' || c.ref.type === 'panic';
    // Mute : les barrières (transitions d'état globales) sont gouvernées
    // par la lane conductor — leur couverture trackIds n'est qu'un
    // blast radius visuel, elle ne mute pas l'événement. Un slot perd
    // les objets dont la lane est mutée — couverture vide → skippé.
    // Couverture effective : explicite si gelée, sinon dérivation
    // live de l'entité (réassignation Atelier reflétée dans le score).
    const activeTids = effectiveTrackIds(c).filter((tid) => !laneState(laneIdOf(tid))?.muted);
    if (isBarrier) {
      if (laneState(CONDUCTOR_LANE)?.muted) continue;
    } else if (c.ref.type === 'modGraph') {
      // Pas de couverture objet — muté par sa propre lane.
      if (laneState(MODULATION_LANE)?.muted) continue;
    } else if (activeTids.length === 0) {
      continue;
    }
    const lanes: ResolvedLane[] = clipLaneIds(c, activeTids).map(
      (id) => ({ id, ...(laneState(id)?.mode === 'stacked' ? { stacked: true } : {}) }),
    );
    const base = {
      id: c.id, lanes, start_ms: c.startMs,
      repeat_every_ms: c.repeatEveryMs,
      fade_in_ms: c.fadeInMs, fade_out_ms: c.fadeOutMs,
      ...(c.curves && Object.keys(c.curves).length ? { curves: c.curves } : {}),
    };
    switch (c.ref.type) {
      case 'slot': {
        const raw = gs.moveSlots.find((s) => s.id === (c.ref as { slotId: string }).slotId);
        if (!raw) { errors.push(`Clip ${c.id}: slot introuvable — supprimé ?`); break; }
        // L'assignation du clip remplace celle du slot — sous-ensemble
        // ou extension, le spawn ne couvre que les objets du clip.
        const slot = normalizeSlot({ ...raw, trackIds: activeTids });
        try {
          const graphJson = slot.graphJson ?? (await presetGraph(slot));
          const { request, globalMacros } = await buildSlotActivation(
            slot, graphJson, ctx, `sc-${c.id}`,
          );
          clips.push({
            ...base,
            duration_ms: c.durationMs,
            payload: {
              kind: 'Slot',
              data: { request, macros: globalMacros },
            },
          });
        } catch (e) {
          errors.push(`Clip "${slot.name}": ${e}`);
        }
        break;
      }
      case 'cue': {
        const cueId = (c.ref as { cueId: string }).cueId;
        const cue = cs.cues.find((q) => String(q.id) === String(cueId));
        if (!cue) { errors.push(`Clip ${c.id}: cue introuvable — supprimée ?`); break; }
        // Wire : `Cue.id`/`cue_number` sont String côté backend — un
        // snapshot à id numérique (vieux show, seed, édit manuel)
        // ferait échouer la désérialisation de TOUTE la partition.
        clips.push({
          ...base,
          payload: {
            kind: 'Cue',
            data: {
              ...cue,
              id: String(cue.id),
              cue_number: cue.cue_number == null ? cue.cue_number : String(cue.cue_number),
              // Champs requis côté Rust sans serde(default) — un snapshot
              // partiel (seed, vieux show, édit manuel) ne doit pas faire
              // échouer le load de toute la partition.
              name: cue.name ?? '',
              description: cue.description ?? '',
              graph: cue.graph ?? { nodes: [], edges: [] },
              timestamp: cue.timestamp ?? 0,
            },
          },
        });
        break;
      }
      case 'stopAll':
        clips.push({ ...base, payload: { kind: 'StopAll' } });
        break;
      case 'panic':
        clips.push({ ...base, payload: { kind: 'Panic' } });
        break;
      case 'positions': {
        // track_id → obj_index à la résolution (règle namespace : le
        // backend ne connaît que l'espace objet) ; seules les pistes
        // non mutées (activeTids) sont envoyées.
        const entries = (Object.entries(c.ref.positions) as [string, [number, number, number]][])
          .map(([t, p]) => ({ tid: Number(t), obj: gs.manualOscIds.indexOf(Number(t)), p }))
          .filter((e) => e.obj >= 0 && activeTids.includes(e.tid));
        if (!entries.length) break;
        clips.push({
          ...base,
          payload: { kind: 'Positions', data: { positions: entries.map((e) => [e.obj, e.p]) } },
        });
        break;
      }
      case 'modGraph':
        clips.push({
          ...base,
          payload: { kind: 'SignalGraph', data: { graph: c.ref.graph } },
        });
        break;
    }
  }
  return { clips, errors };
}

/// Couverture EFFECTIVE d'un clip — `trackIds` explicite si présent,
/// sinon dérivation live de l'entité référencée : slot → slot.trackIds
/// (une réassignation Atelier se reflète dans le score), cue → blast
/// radius du snapshot courant, markers → []. Utilisée pour lanes,
/// mute, rendu et blast radius — la seule source de vérité.
export function effectiveTrackIds(c: ScoreClipDoc): number[] {
  if (c.trackIds !== undefined) return c.trackIds;
  const gs = useGraphStore.getState();
  switch (c.ref.type) {
    case 'slot': {
      const slotId = (c.ref as { slotId: string }).slotId;
      return gs.moveSlots.find((s) => s.id === slotId)?.trackIds ?? [];
    }
    case 'cue': {
      const cs = useCuelistStore.getState();
      const cue = cs.cues.find((q) => String(q.id) === String((c.ref as { cueId: string }).cueId));
      return cue ? cueCoverage(cue, gs.manualOscIds) : [];
    }
    case 'positions':
      // Les positions sont portées en track_id (espace opérateur).
      return Object.keys((c.ref as { positions: Record<number, [number, number, number]> }).positions)
        .map(Number).filter((t) => Number.isFinite(t));
    default:
      return [];
  }
}

/// Couverture dérivée d'une cue — union des track-objets que son
/// snapshot touche : scope `track_indices` + tracks des moves
/// stockés + positions manuelles. En obj_index dans la snapshot →
/// conversion track_id via la liste `manualOscIds` (règle namespace :
/// les lanes parlent track_id, jamais obj_index).
export function cueCoverage(
  cue: { track_indices?: number[]; moves?: { track_indices?: number[] }[]; manual_positions?: object },
  manualOscIds: number[],
): number[] {
  const objIdx = new Set<number>([
    ...(cue.track_indices ?? []),
    ...(cue.moves ?? []).flatMap((m) => m.track_indices ?? []),
    ...Object.keys(cue.manual_positions ?? {}).map(Number),
  ]);
  return [...objIdx]
    .map((i) => manualOscIds[i])
    .filter((tid): tid is number => tid != null)
    .sort((a, b) => a - b);
}

/// Slot sans graphe sauvegardé → le graphe du preset template (même
/// règle de fallback que playSlot).
async function presetGraph(slot: ReturnType<typeof normalizeSlot>) {
  const { SHAPE_PRESETS } = await import('./shapePresets');
  const preset = SHAPE_PRESETS.find((p) => p.id === slot.templateId) ?? SHAPE_PRESETS[0];
  const built = preset.build(slot.trackIds.length);
  return { nodes: built.nodes, edges: built.edges };
}
