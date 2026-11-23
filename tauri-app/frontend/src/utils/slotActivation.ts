/// Activation payload d'un slot — builder UNIQUE partagé entre
/// `playSlot` (bouton, busking, GO) et le résolveur de clips du score
/// timeline (S2 — docs/score-sequencer.md). Le score embarque la
/// request résolue au `score_timeline_load` : le backend rejoue
/// exactement ce payload, sans dépendre du frontend à l'exécution.
import { computeCentroid } from '../store/utils/geometryUtils';
import {
  computeTrackIndices,
  extractDuration,
  type MoveSlot,
} from '../store/slices/moveSlotsTypes';
import type { GraphNode } from '../components/nodeParamSchema';
import type { Edge } from '@xyflow/react';
import type { HolProject } from '../store/types/index';

export interface SlotActivationCtx {
  holProject: HolProject | null;
  manualOscIds: number[];
}

/// Macros spatiales du slot — envoyées au merge global via
/// `set_global_macro` (play manuel) ou embarquées dans le clip
/// (timeline : le backend les applique au lancement du clip).
export interface SlotGlobalMacros {
  scale: number;
  shiftX: number;
  shiftY: number;
  shiftZ: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface SlotActivation {
  request: Record<string, unknown>;
  globalMacros: SlotGlobalMacros;
}

/// Construit la request `activate_move` d'un slot — même forme que
/// playSlot (graph_json, animation payload, signal graph, boundary
/// track_id→obj_index sur anchor_target). `graphJson` doit déjà être
/// résolu par l'appelant (slot.graphJson, preset fallback, ou nodes
/// courants si le slot est en édition).
export async function buildSlotActivation(
  slot: MoveSlot,
  graphJson: { nodes: GraphNode[]; edges: Edge[] },
  ctx: SlotActivationCtx,
  movementId: string,
): Promise<SlotActivation> {
  const { prepareGraphForSave } = await import('../components/nodeParamSchema');
  const graphData = prepareGraphForSave(graphJson.nodes, graphJson.edges);

  // Lire la duration depuis le node Duration du graphe
  const duration = extractDuration(graphJson.nodes);

  const trackIndices = computeTrackIndices(slot.trackIds, ctx.holProject, ctx.manualOscIds);
  if (trackIndices.length === 0) {
    throw new Error(
      `No track indices — the slot's track selection doesn't map to current OSC ids (check OSC ids / selection).`,
    );
  }

  const origin = computeCentroid(ctx.holProject, trackIndices, ctx.manualOscIds);

  // Payload animation complet — le backend en extrait fade (cycle),
  // speed (worker) et AnimationState (depths, phase offsets, audio mods).
  // NB: les macros spatiales scale/shift/rotation de l'animation ne sont
  // PAS reprises dans le spec backend — elles restent globales (merge)
  // via set_global_macro, sinon double-application.
  const animation = {
    id: slot.id,
    name: slot.name,
    speed: slot.macros.speed,
    duration,
    direction: slot.direction,
    loop_mode: slot.loopMode === 'oneshot' ? 'one_shot' : 'loop',
    scale: slot.macros.scale,
    yaw: slot.macros.yaw,
    pitch: slot.macros.pitch,
    roll: slot.macros.roll,
    offset_x: slot.macros.shiftX,
    offset_y: slot.macros.shiftY,
    offset_z: slot.macros.shiftZ,
    assignments: slot.assignments,
    phase_spread: slot.phaseSpread,
    audio_mods: slot.audioMods,
    graph_json: graphData,
    fade_in: slot.fadeIn,
    fade_out: slot.fadeOut,
  };
  // Graphe de modulation per-move (cibles `param:` liées aux nodes du
  // graphe du move — compilé côté backend avec le même graph_json).
  const signalGraphData = slot.signalGraph
    ? {
        nodes: slot.signalGraph.nodes.map((n) => ({
          id: n.id,
          type: 'custom',
          position: n.position,
          data: {
            label: n.data.label ?? n.data.type ?? '',
            type: n.data.type ?? 'SignalOut',
            params: n.data.params ?? {},
          },
        })),
        edges: slot.signalGraph.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? 'out',
          targetHandle: e.targetHandle ?? 'signal',
        })),
      }
    : null;

  return {
    request: {
      movement_id: movementId,
      name: slot.name,
      graph_json: graphData,
      osc_ids: slot.trackIds,
      track_indices: trackIndices,
      is_preview: slot.isPreview ?? false,
      origin,
      duration,
      loop_mode: slot.loopMode,
      direction: slot.direction,
      end_mode: slot.endMode ?? 'revert',
      anchor_mode: slot.anchorMode ?? 'origin',
      // Boundary UI→wire : l'opérateur saisit un track_id, le
      // backend attend obj_index (position dans osc_ids).
      anchor_target:
        slot.anchorTarget != null
          ? ctx.manualOscIds.indexOf(slot.anchorTarget) >= 0
            ? ctx.manualOscIds.indexOf(slot.anchorTarget)
            : null
          : null,
      // Le graphe de modulation per-move voyage via l'animation payload
      // (MoveSpec.signal_graph = request.animation.signal_graph).
      animation: animation ? { ...animation, signal_graph: signalGraphData } : animation,
    },
    globalMacros: {
      scale: slot.macros.scale,
      shiftX: slot.macros.shiftX,
      shiftY: slot.macros.shiftY,
      shiftZ: slot.macros.shiftZ,
      yaw: slot.macros.yaw,
      pitch: slot.macros.pitch,
      roll: slot.macros.roll,
    },
  };
}
