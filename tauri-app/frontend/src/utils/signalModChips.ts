import { type Edge } from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';

/// Extrait les modulations actives d'un graphe signal : un chip par
/// SignalOut — `target ← source` où source est le générateur en tête de
/// la chaîne amont (LFO, AUDIO, OSC…). Sert à rendre visible dans la
/// status bar ce qui drive les macros — une modulation oubliée est sinon
/// indiscernable d'un bug de trajectoire.

export interface ModChip {
  target: string;
  srcLabel: string;
  chainLabel: string;
  outId: string;
}

type Params = Record<string, any>;

const GENERATOR_LABEL: Record<string, (p: Params) => string> = {
  SignalLfo: (p) => `LFO ${p.frequency ?? '?'}Hz`,
  SignalAudio: (p) => `AUDIO ${p.source ?? ''}`.trim(),
  SignalOsc: (p) => `OSC ${p.address ?? ''}`.trim(),
  SignalConst: () => 'CONST',
  SignalTime: () => 'TIME',
  SignalRandom: () => 'RND',
  SignalBeat: () => 'BEAT',
  SignalCounter: () => 'COUNT',
};

const typeLabel = (type: string | undefined, params: Params): string => {
  const fn = type ? GENERATOR_LABEL[type] : undefined;
  if (fn) return fn(params);
  return (type ?? '?').replace(/^Signal/, '').toUpperCase();
};

/// Remonte la chaîne amont d'un nœud jusqu'au générateur (pas d'edge
/// entrante). Cycle-safe : un anneau renvoie la chaîne parcourue.
const chainUpstream = (
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[],
): GraphNode[] => {
  const chain: GraphNode[] = [];
  const seen = new Set<string>();
  let nextId = edges.find((e) => e.target === nodeId)?.source;
  while (nextId && !seen.has(nextId)) {
    seen.add(nextId);
    const cur = nodes.find((n) => n.id === nextId);
    if (!cur) break;
    chain.unshift(cur);
    nextId = edges.find((e) => e.target === cur.id)?.source;
  }
  return chain;
};

export function buildModChips(nodes: GraphNode[], edges: Edge[]): ModChip[] {
  return nodes
    .filter((n) => n.data?.type === 'SignalOut')
    .filter((n) => (n.data?.params?.amount ?? 1) !== 0) // amount 0 = inerte
    .map((out) => {
      const params: Params = out.data?.params ?? {};
      const chain = chainUpstream(out.id, nodes, edges);
      const root = chain[0];
      return {
        outId: out.id,
        target: String(params.target ?? '?'),
        srcLabel: root ? typeLabel(root.data?.type, root.data?.params ?? {}) : '—',
        chainLabel: [...chain.map((n) => n.data?.type), 'SignalOut'].join(' → '),
      };
    });
}
