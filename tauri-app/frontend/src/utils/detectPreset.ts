import type { Edge } from '@xyflow/react';
import { NODE_SPECS } from './connectionRules';
import { SHAPE_PRESETS, type ShapePreset } from './shapePresets';

/// Node categories that define a move's "shape" — everything except the
/// structural plumbing (Objects/Duration/Output/Group…) and global-only
/// nodes (never in a slot graph).
const SIGNATURE_CATEGORIES = new Set([
  'MathEngine', 'PhysicsEngine', 'Spline', 'Envelope', 'Modifier',
  'Composite', 'Source', 'Plugin',
]);

const SIGNATURE_TYPES = new Set(
  NODE_SPECS.filter((s) => SIGNATURE_CATEGORIES.has(s.category)).map((s) => s.node_type as string),
);

type GraphLike = { nodes: { data?: { type?: string } }[]; edges?: Edge[] } | null | undefined;

function signatureOf(nodes: { data?: { type?: string } }[]): string {
  const types = new Set<string>();
  for (const n of nodes) {
    const t = n.data?.type;
    if (t && SIGNATURE_TYPES.has(t)) types.add(t);
  }
  return [...types].sort().join(',');
}

// Built once — build(1) is pure and cheap (~4-8 nodes per preset).
let presetSignatures: { preset: ShapePreset; sig: string }[] | null = null;
function signatures() {
  if (!presetSignatures) {
    presetSignatures = SHAPE_PRESETS.map((preset) => ({
      preset,
      sig: signatureOf(preset.build(1).nodes),
    })).filter((p) => p.sig !== '');
  }
  return presetSignatures;
}

/**
 * Preset matching a stored graph's node-type signature, or null when the
 * graph diverged from every preset (custom edits, library load, manual
 * rewire). Params are ignored — a Rose with tweaked speed is still a Rose.
 *
 * Used instead of `slot.templateId` for display: templateId is provenance
 * metadata that never updates when the graph is edited afterwards.
 */
export function detectSlotPreset(graphJson: GraphLike): ShapePreset | null {
  if (!graphJson?.nodes?.length) return null;
  const sig = signatureOf(graphJson.nodes);
  if (!sig) return null;
  return signatures().find((p) => p.sig === sig)?.preset ?? null;
}
