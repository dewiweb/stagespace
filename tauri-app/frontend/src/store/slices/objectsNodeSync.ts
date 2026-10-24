/// Sync du node Objects + des paramètres n_objects des engines avec la
/// sélection de tracks — source unique appelée par holProjectSlice
/// (syncObjectsNode) et moveSlotsSlice (syncObjectsNodeNoHotSwap).
/// Aucun hot-swap backend ici : la sélection de tracks ne doit pas affecter
/// les moves en cours — updateGraphLive gère le hot-swap séparément.
import type { GraphNode } from '../../components/nodeParamSchema';

/// Types de nodes qui ont un paramètre n_objects à sync avec le node
/// Objects (évite les CountMismatch backend).
export const OBJECT_ENGINE_TYPES = new Set<string>([
  'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
  'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
  'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
  'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField',
  'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
  'Mix', 'Group', 'Sequence', 'Crossfade',
]);

/// Vue minimale du store nécessaire à la sync — structurelle, compatible
/// avec les get() des deux slices appelants.
export interface ObjectsGraphStore {
  nodes: GraphNode[];
  selectedTrackIds: Set<number>;
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  addNode: (node: GraphNode) => void;
}

export function syncObjectsGraphNodes(
  get: () => ObjectsGraphStore,
  opts: { createIfMissing?: boolean } = {},
): void {
  const s = get();
  const ids = Array.from(s.selectedTrackIds).sort((a, b) => a - b);
  // Même si ids est vide, on met à jour (pour montrer 0 objets si
  // l'utilisateur désélectionne tout) — sauf s'il n'y a pas de node
  // Objects existant, auquel cas il n'y a rien à faire.
  if (ids.length === 0 && !s.nodes.find((n) => n.data.type === 'Objects')) return;

  const objectsNode = s.nodes.find((n) => n.data.type === 'Objects');
  if (objectsNode) {
    const newParams = { ...(objectsNode.data.params ?? {}), n_objects: ids.length, track_ids: ids };
    s.updateNodeData(objectsNode.id, { params: newParams });
  } else if (opts.createIfMissing) {
    const newId = `objects-${Date.now()}`;
    s.addNode({
      id: newId,
      type: 'custom',
      position: { x: 50, y: 250 },
      data: { label: 'Objects', type: 'Objects', params: { n_objects: ids.length, track_ids: ids } },
    });
  }

  // Sync n_objects sur tous les nodes engines — on relit les nodes
  // courants (le node Objects vient d'être modifié).
  get().nodes.forEach((node) => {
    const nodeType = node.data.type;
    if (nodeType && OBJECT_ENGINE_TYPES.has(nodeType)) {
      const params = node.data.params ?? {};
      if (params.n_objects !== ids.length) {
        s.updateNodeData(node.id, { params: { ...params, n_objects: ids.length } });
      }
    }
  });
}
