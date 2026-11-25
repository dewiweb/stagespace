/// <reference types="vitest/globals" />
/// Poses dans l'enveloppe .hfg — write (buildShowEnvelope fetch le
/// backend) / read (loadShowEnvelope → pose_replace_all atomique).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGraphStore,
  getInvokeCalls,
  resetStore,
  makeSimpleGraph,
  setInvokeResponse,
} from './testHelpers';
import { buildShowEnvelope } from '../slices/persistenceSlice';
import { usePoseStore } from '../usePoseStore';

beforeEach(() => {
  resetStore();
  usePoseStore.setState({ poses: [] });
});

describe('buildShowEnvelope — section poses', () => {
  it('inclut les poses fetchées du backend', async () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);
    setInvokeResponse('pose_list', [
      { name: 'line-up', positions: { 1: [2, 1.5, 0], 3: [-2.5, 2, 0] } },
    ]);

    const env = await buildShowEnvelope(useGraphStore.getState() as any);

    expect(env.poses).toHaveLength(1);
    expect(env.poses![0].name).toBe('line-up');
    expect(env.poses![0].positions[1]).toEqual([2, 1.5, 0]);
  });
});

describe('loadShowEnvelope — restauration des poses', () => {
  function makeEnvelope(poses?: unknown) {
    const graph = makeSimpleGraph(3);
    return {
      format: 'stagespace-show',
      version: 2,
      nodes: graph.nodes,
      edges: graph.edges,
      ...(poses !== undefined ? { poses } : {}),
    } as any;
  }

  it('pose_replace_all avec les poses du fichier', async () => {
    const poses = [
      { name: 'line-up', positions: { 1: [2, 1.5, 0] } },
      { name: 'cluster', positions: { 2: [0, 0, 0], 4: [1, 1, 1] } },
    ];
    await useGraphStore.getState().loadShowEnvelope(makeEnvelope(poses));

    const call = getInvokeCalls().find((c) => c.cmd === 'pose_replace_all');
    expect(call).toBeDefined();
    expect((call!.args as any).poses).toHaveLength(2);
    expect((call!.args as any).poses[0].name).toBe('line-up');
  });

  it('section absente → table effacée (les poses ne fuient pas entre shows)', async () => {
    await useGraphStore.getState().loadShowEnvelope(makeEnvelope());

    const call = getInvokeCalls().find((c) => c.cmd === 'pose_replace_all');
    expect(call).toBeDefined();
    expect((call!.args as any).poses).toEqual([]);
  });

  it('section invalide (non-array) → rejet de validation', async () => {
    await expect(
      useGraphStore.getState().loadShowEnvelope(makeEnvelope({ name: 'x' }))
    ).rejects.toThrow(/poses/);
  });
});
