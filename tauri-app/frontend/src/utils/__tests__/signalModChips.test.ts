/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest';
import { buildModChips } from '../signalModChips';
import { buildDefaultSignalGraph } from '../../store/useSignalGraphStore';
import type { GraphNode } from '../../components/nodeParamSchema';
import { type Edge } from '@xyflow/react';

const sigNode = (id: string, type: string, params: Record<string, any> = {}): GraphNode =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data: { label: type, type, params } }) as GraphNode;

const sigEdge = (source: string, target: string): Edge =>
  ({ id: `${source}-${target}`, source, target, sourceHandle: 'out', targetHandle: 'signal' }) as Edge;

describe('buildModChips', () => {
  it('graphe vide → pas de chips', () => {
    expect(buildModChips([], [])).toEqual([]);
    expect(buildModChips([sigNode('a', 'SignalLfo')], [])).toEqual([]);
  });

  it('LFO → Map → Out(yaw) : chip yaw ← LFO freq', () => {
    const nodes = [
      sigNode('lfo', 'SignalLfo', { frequency: 10, waveform: 'sine', amplitude: 3.8 }),
      sigNode('map', 'SignalMap', { in_min: -1, in_max: 1, out_min: -15, out_max: 15 }),
      sigNode('out', 'SignalOut', { target: 'yaw', amount: 1 }),
    ];
    const edges = [sigEdge('lfo', 'map'), sigEdge('map', 'out')];
    const chips = buildModChips(nodes, edges);
    expect(chips).toHaveLength(1);
    expect(chips[0].target).toBe('yaw');
    expect(chips[0].srcLabel).toBe('LFO 10Hz');
    expect(chips[0].chainLabel).toBe('SignalLfo → SignalMap → SignalOut');
  });

  it('plusieurs SignalOut → un chip chacun', () => {
    const nodes = [
      sigNode('lfo', 'SignalLfo', { frequency: 0.5 }),
      sigNode('out1', 'SignalOut', { target: 'yaw' }),
      sigNode('audio', 'SignalAudio', { source: 'kick' }),
      sigNode('out2', 'SignalOut', { target: 'scale' }),
    ];
    const edges = [sigEdge('lfo', 'out1'), sigEdge('audio', 'out2')];
    const chips = buildModChips(nodes, edges);
    expect(chips.map((c) => `${c.target} ← ${c.srcLabel}`)).toEqual([
      'yaw ← LFO 0.5Hz',
      'scale ← AUDIO kick',
    ]);
  });

  it('SignalOut orphelin → chip avec source — (modulation constante)', () => {
    const chips = buildModChips([sigNode('out', 'SignalOut', { target: 'speed' })], []);
    expect(chips[0].srcLabel).toBe('—');
    expect(chips[0].target).toBe('speed');
  });

  it('amount = 0 → modulation inerte, pas de chip', () => {
    const nodes = [
      sigNode('lfo', 'SignalLfo', { frequency: 10 }),
      sigNode('out', 'SignalOut', { target: 'yaw', amount: 0 }),
    ];
    expect(buildModChips(nodes, [sigEdge('lfo', 'out')])).toEqual([]);
  });

  it('cycle dans le graphe → pas de boucle infinie', () => {
    const nodes = [
      sigNode('a', 'SignalMath'),
      sigNode('b', 'SignalMap'),
      sigNode('out', 'SignalOut', { target: 'yaw' }),
    ];
    const edges = [sigEdge('a', 'b'), sigEdge('b', 'a'), sigEdge('b', 'out')];
    const chips = buildModChips(nodes, edges);
    expect(chips).toHaveLength(1);
  });

  it('buildDefaultSignalGraph (démo reset) produit un chip yaw ±15°', () => {
    const { nodes, edges } = buildDefaultSignalGraph();
    const chips = buildModChips(nodes, edges);
    expect(chips).toHaveLength(1);
    expect(chips[0].target).toBe('yaw');
    expect(chips[0].srcLabel).toBe('LFO 0.05Hz');
  });
});
