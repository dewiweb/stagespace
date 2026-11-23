/// Résolution des clips du score → payloads backend (S2). Le document
/// référence les entités vivantes (slotId/cueId) ; au `playScore` on
/// construit les payloads que le backend exécutera seul — la lecture
/// de la timeline ne dépend alors plus de la webview.
/// Slots : request via le builder partagé (`buildSlotActivation`) avec
/// movement_id déterministe `sc-<clipId>` ; cues : snapshot tel quel
/// (le store garde l'objet Cue backend depuis store_cue).
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { normalizeSlot } from '../store/slices/moveSlotsTypes';
import { buildSlotActivation } from './slotActivation';
import type { ScoreDoc, ScoreClipDoc } from '../store/useScoreStore';

export interface ResolvedScoreClip {
  id: string;
  track: string;
  start_ms: number;
  duration_ms?: number;
  repeat_every_ms?: number;
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
  const muted = new Set(doc.tracks.filter((t) => t.muted).map((t) => t.id));
  const clips: ResolvedScoreClip[] = [];
  const errors: string[] = [];

  for (const c of doc.clips) {
    if (muted.has(c.trackId)) continue;
    switch (c.ref.type) {
      case 'slot': {
        const raw = gs.moveSlots.find((s) => s.id === (c.ref as { slotId: string }).slotId);
        if (!raw) { errors.push(`Clip ${c.id}: slot introuvable — supprimé ?`); break; }
        const slot = normalizeSlot(raw);
        try {
          const graphJson = slot.graphJson ?? (await presetGraph(slot));
          const { request, globalMacros } = await buildSlotActivation(
            slot, graphJson, ctx, `sc-${c.id}`,
          );
          clips.push({
            id: c.id,
            track: c.trackId,
            start_ms: c.startMs,
            duration_ms: c.durationMs,
            repeat_every_ms: c.repeatEveryMs,
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
        clips.push({
          id: c.id, track: c.trackId, start_ms: c.startMs,
          repeat_every_ms: c.repeatEveryMs,
          payload: { kind: 'Cue', data: cue },
        });
        break;
      }
      case 'stopAll':
        clips.push({ id: c.id, track: c.trackId, start_ms: c.startMs, repeat_every_ms: c.repeatEveryMs, payload: { kind: 'StopAll' } });
        break;
      case 'panic':
        clips.push({ id: c.id, track: c.trackId, start_ms: c.startMs, repeat_every_ms: c.repeatEveryMs, payload: { kind: 'Panic' } });
        break;
    }
  }
  return { clips, errors };
}

/// Slot sans graphe sauvegardé → le graphe du preset template (même
/// règle de fallback que playSlot).
async function presetGraph(slot: ReturnType<typeof normalizeSlot>) {
  const { SHAPE_PRESETS } = await import('./shapePresets');
  const preset = SHAPE_PRESETS.find((p) => p.id === slot.templateId) ?? SHAPE_PRESETS[0];
  const built = preset.build(slot.trackIds.length);
  return { nodes: built.nodes, edges: built.edges };
}

/// Type guard utilisé par la vue — un clip ne peut vivre que sur une
/// lane de son kind (slots→slot, cues→cue, markers→stopAll/panic).
export function clipKindOf(ref: ScoreClipDoc['ref']): 'slots' | 'cues' | 'markers' {
  return ref.type === 'slot' ? 'slots' : ref.type === 'cue' ? 'cues' : 'markers';
}
