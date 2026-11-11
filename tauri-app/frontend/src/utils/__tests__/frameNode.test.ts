import { describe, it, expect } from 'vitest';
import { stripFrames, isFrameNode, FRAME_NODE_TYPE, FRAME_DATA_TYPE } from '../frameNode';

/// Frames — annotation UI-only : filtrés de tout payload backend
/// ('Frame' n'est pas un NodeType de l'enum Rust — la désérialisation
/// échouerait).
const node = (id: string, type: string, dataType?: string) => ({
  id, type, position: { x: 0, y: 0 },
  data: { type: dataType ?? type, label: dataType ?? type, params: {} },
});

describe('frameNode', () => {
  it('isFrameNode reconnaît le type RF et le marker data', () => {
    expect(isFrameNode(node('f1', FRAME_NODE_TYPE, FRAME_DATA_TYPE) as any)).toBe(true);
    expect(isFrameNode(node('n1', 'custom', 'Circular') as any)).toBe(false);
  });

  it('stripFrames retire les frames du payload', () => {
    const nodes = [
      node('a', 'custom', 'Circular'),
      node('f', FRAME_NODE_TYPE, FRAME_DATA_TYPE),
      node('b', 'custom', 'Output'),
    ];
    const { nodes: kept } = stripFrames(nodes, []);
    expect(kept.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('stripFrames retire aussi les edges pendantes sur un frame', () => {
    // Défensif : un frame n'a pas de handles, mais si une edge référençait
    // son id elle serait orpheline après strip.
    const nodes = [
      node('a', 'custom', 'Circular'),
      node('f', FRAME_NODE_TYPE, FRAME_DATA_TYPE),
    ];
    const edges = [{ id: 'e1', source: 'a', target: 'f' }];
    const { nodes: kept, edges: keptEdges } = stripFrames(nodes, edges);
    expect(kept).toHaveLength(1);
    expect(keptEdges).toHaveLength(0);
  });

  it('stripFrames conserve les edges entre nodes gardés', () => {
    const nodes = [node('a', 'custom', 'Circular'), node('b', 'custom', 'Output')];
    const edges = [{ id: 'e1', source: 'a', target: 'b' }];
    const { edges: keptEdges } = stripFrames(nodes, edges);
    expect(keptEdges).toHaveLength(1);
  });
});
