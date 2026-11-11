import { describe, it, expect } from 'vitest';
import { detectSlotPreset } from '../detectPreset';
import { SHAPE_PRESETS } from '../shapePresets';

const presetGraph = (id: string) => SHAPE_PRESETS.find((p) => p.id === id)!.build(4);

describe('detectSlotPreset', () => {
  it('détecte le preset depuis le graphe réel — pas le templateId', () => {
    // Slot "rose" dont le graphe a divergé vers Circular : la vérité est
    // le graphe, pas la métadonnée.
    expect(detectSlotPreset(presetGraph('circle'))?.id).toBe('circle');
    expect(detectSlotPreset(presetGraph('rose'))?.id).toBe('rose');
  });

  it('ignore les params — un rose modifié reste un rose', () => {
    const g = presetGraph('rose');
    const engine = g.nodes.find((n) => (n.data as { type?: string }).type === 'RoseCurve')!;
    (engine.data as { params: Record<string, unknown> }).params.speed = 99;
    expect(detectSlotPreset(g)?.id).toBe('rose');
  });

  it('graphe divergé → null (Custom) — un node ajouté casse la signature', () => {
    const g = presetGraph('rose');
    const scale = {
      id: 'x',
      type: 'custom' as const,
      position: { x: 0, y: 0 },
      data: { label: 'Scale', type: 'Scale', params: {} },
    };
    expect(detectSlotPreset({ nodes: [...g.nodes, scale], edges: g.edges })).toBeNull();
  });

  it('sans graphe → null', () => {
    expect(detectSlotPreset(null)).toBeNull();
    expect(detectSlotPreset({ nodes: [] })).toBeNull();
  });

  it('chaque preset a une signature détectable', () => {
    for (const p of SHAPE_PRESETS) {
      expect(p.build(2).nodes.length).toBeGreaterThan(0);
    }
  });
});
