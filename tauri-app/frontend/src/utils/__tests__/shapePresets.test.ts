import { describe, it, expect } from 'vitest';
import { SHAPE_PRESETS } from '../shapePresets';
import { isValidConnection, getInputPorts } from '../connectionRules';
import type { NodeType } from '../../store/useGraphStore';

const nodeType = (n: { data: unknown }) =>
  (n.data as { type?: NodeType }).type as NodeType;

describe('SHAPE_PRESETS', () => {
  it('all preset ids are unique', () => {
    const ids = SHAPE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const preset of SHAPE_PRESETS) {
    describe(`${preset.name} (${preset.id})`, () => {
      const { nodes, edges } = preset.build(8);
      const byId = new Map(nodes.map((n) => [n.id, n]));

      it('has Objects, Duration and Output nodes', () => {
        const types = nodes.map(nodeType);
        expect(types).toContain('Objects');
        expect(types).toContain('Duration');
        expect(types).toContain('Output');
      });

      it('every edge respects connection rules and ports', () => {
        const portUse = new Map<string, Set<string>>();
        for (const e of edges) {
          const src = byId.get(e.source);
          const dst = byId.get(e.target);
          expect(src, `edge source ${e.source} missing`).toBeDefined();
          expect(dst, `edge target ${e.target} missing`).toBeDefined();

          const from = nodeType(src!);
          const to = nodeType(dst!);
          expect(
            isValidConnection(from, to),
            `${from} -> ${to} rejected by connection rules`,
          ).toBe(true);

          const targetPort = e.targetHandle ?? 'in';
          expect(
            getInputPorts(to).map((p) => p.name),
            `${to} has no input port '${targetPort}'`,
          ).toContain(targetPort);

          const key = e.target;
          const used = portUse.get(key) ?? new Set<string>();
          expect(
            used.has(targetPort),
            `${to} port '${targetPort}' receives multiple edges`,
          ).toBe(false);
          used.add(targetPort);
          portUse.set(key, used);
        }
      });
    });
  }
});
