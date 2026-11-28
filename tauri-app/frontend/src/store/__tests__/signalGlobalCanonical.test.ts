/// <reference types="vitest/globals" />
/// Copie canonique du graphe signal global (B6) — le champ `global` du
/// store est la référence unique pour la sérialisation du show et les
/// chips, indépendamment du contexte d'édition en cours.

import { describe, it, expect, beforeEach } from 'vitest';
import { useSignalGraphStore } from '../useSignalGraphStore';
import { buildShowEnvelope } from '../slices/persistenceSlice';
import { useGraphStore, resetStore } from './testHelpers';
import type { GraphNode } from '../../components/nodeParamSchema';
import { type Edge } from '@xyflow/react';

const sigNode = (id: string, type: string, params: Record<string, any> = {}): GraphNode =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data: { label: type, type, params } }) as GraphNode;
const sigEdge = (source: string, target: string): Edge =>
  ({ id: `${source}-${target}`, source, target, sourceHandle: 'out', targetHandle: 'signal' }) as Edge;

const GLOBAL_GRAPH = {
  nodes: [
    sigNode('glfo', 'SignalLfo', { frequency: 0.05 }),
    sigNode('gout', 'SignalOut', { target: 'yaw', amount: 1 }),
  ],
  edges: [sigEdge('glfo', 'gout')],
};
const SLOT_GRAPH = {
  nodes: [
    sigNode('slfo', 'SignalLfo', { frequency: 0.4 }),
    sigNode('sout', 'SignalOut', { target: 'param:Circular:radius', amount: 1 }),
  ],
  edges: [sigEdge('slfo', 'sout')],
};

beforeEach(() => {
  resetStore();
  useSignalGraphStore.setState({
    nodes: [], edges: [], context: 'global',
    global: { nodes: [], edges: [] },
  });
  localStorage.removeItem('stagespace-signal-graph-v1');
});

describe('copie canonique du graphe global', () => {
  it('éditer en contexte global synchronise le champ global', () => {
    useSignalGraphStore.getState().setContext(null);
    useSignalGraphStore.getState().setNodes(GLOBAL_GRAPH.nodes);
    useSignalGraphStore.getState().setEdges(GLOBAL_GRAPH.edges);

    const s = useSignalGraphStore.getState();
    expect(s.global.nodes).toEqual(GLOBAL_GRAPH.nodes);
    expect(s.global.edges).toEqual(GLOBAL_GRAPH.edges);
  });

  it('éditer en contexte slot ne touche PAS le champ global', () => {
    // graphe global établi
    useSignalGraphStore.getState().setContext(null);
    useSignalGraphStore.getState().setNodes(GLOBAL_GRAPH.nodes);
    useSignalGraphStore.getState().setEdges(GLOBAL_GRAPH.edges);

    // bascule sur un slot et édition de SA modulation
    useSignalGraphStore.getState().setContext('slot-1', SLOT_GRAPH);
    useSignalGraphStore.getState().setNodes(SLOT_GRAPH.nodes);

    const s = useSignalGraphStore.getState();
    // le buffer porte le graphe du slot…
    expect(s.nodes).toEqual(SLOT_GRAPH.nodes);
    // …mais la copie canonique est restée le graphe global
    expect(s.global.nodes).toEqual(GLOBAL_GRAPH.nodes);
  });

  it('resetToDefault en contexte slot ne corrompt pas le global', () => {
    useSignalGraphStore.getState().setContext(null);
    useSignalGraphStore.getState().setNodes(GLOBAL_GRAPH.nodes);
    useSignalGraphStore.getState().setEdges(GLOBAL_GRAPH.edges);

    useSignalGraphStore.getState().setContext('slot-1', { nodes: [], edges: [] });
    useSignalGraphStore.getState().resetToDefault();

    const s = useSignalGraphStore.getState();
    // le buffer reçoit le graphe par défaut (reset du slot)…
    expect(s.nodes.length).toBeGreaterThan(0);
    // …le canonique global est inchangé — avant le fix, resetToDefault
    // écrivait localStorage global même en contexte slot.
    expect(s.global.nodes).toEqual(GLOBAL_GRAPH.nodes);
  });

  it('retour au contexte global : le buffer recharge la copie canonique', () => {
    useSignalGraphStore.getState().setContext(null);
    useSignalGraphStore.getState().setNodes(GLOBAL_GRAPH.nodes);
    useSignalGraphStore.getState().setEdges(GLOBAL_GRAPH.edges);
    useSignalGraphStore.getState().setContext('slot-1', SLOT_GRAPH);
    useSignalGraphStore.getState().setContext(null);

    const s = useSignalGraphStore.getState();
    expect(s.nodes).toEqual(GLOBAL_GRAPH.nodes);
    expect(s.edges).toEqual(GLOBAL_GRAPH.edges);
  });
});

describe('buildShowEnvelope — régression B6', () => {
  it('save en contexte slot → la section signalGraph du show est le GLOBAL', async () => {
    // arrange : graphe global établi, puis édition du slot au moment du save
    useSignalGraphStore.getState().setContext(null);
    useSignalGraphStore.getState().setNodes(GLOBAL_GRAPH.nodes);
    useSignalGraphStore.getState().setEdges(GLOBAL_GRAPH.edges);
    useSignalGraphStore.getState().setContext('slot-1', SLOT_GRAPH);

    const envelope = await buildShowEnvelope(useGraphStore.getState() as any);

    // avant le fix : le buffer (graphe du slot, cibles param:) était écrit
    // dans la section globale — incompatible au reload (compile error).
    expect(envelope.signalGraph!.nodes).toEqual(GLOBAL_GRAPH.nodes);
    expect(envelope.signalGraph!.edges).toEqual(GLOBAL_GRAPH.edges);
    const targets = envelope.signalGraph!.nodes
      .filter((n: any) => n.data?.type === 'SignalOut')
      .map((n: any) => n.data?.params?.target);
    expect(targets).not.toContain('param:Circular:radius');
    expect(targets).toContain('yaw');
  });

  it('save en contexte global → même résultat', async () => {
    useSignalGraphStore.getState().setContext(null);
    useSignalGraphStore.getState().setNodes(GLOBAL_GRAPH.nodes);
    useSignalGraphStore.getState().setEdges(GLOBAL_GRAPH.edges);

    const envelope = await buildShowEnvelope(useGraphStore.getState() as any);
    expect(envelope.signalGraph!.nodes).toEqual(GLOBAL_GRAPH.nodes);
  });
});
