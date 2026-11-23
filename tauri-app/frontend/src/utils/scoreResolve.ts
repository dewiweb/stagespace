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
import { GLOBALFX_LANE, laneIdOf, clipLaneIds } from '../store/useScoreStore';
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
    const isMarker = c.ref.type === 'stopAll' || c.ref.type === 'panic';
    // Mute : les markers sont gouvernés par la lane master ; un
    // slot/cue perd les objets dont la lane est mutée — couverture
    // vide → clip skippé (sa lane est "silencieuse").
    const activeTids = c.trackIds.filter((tid) => !laneState(laneIdOf(tid))?.muted);
    if (isMarker) {
      if (laneState(GLOBALFX_LANE)?.muted) continue;
    } else if (activeTids.length === 0) {
      continue;
    }
    const lanes: ResolvedLane[] = clipLaneIds({ ...c, trackIds: activeTids } as ScoreClipDoc).map(
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
    }
  }
  return { clips, errors };
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
