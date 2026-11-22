import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';

/// Clipboard module-level — la copie survit au switch de tab (sub/global/
/// signal) comme dans un patcher : copier une chaîne d'un graphe, coller
/// dans un autre. Pas de localStorage : la payload est éphémère, session.
export interface GraphClipboardPayload {
  nodes: GraphNode[];
  edges: Edge[];
}

let clipboard: GraphClipboardPayload | null = null;

export function writeGraphClipboard(payload: GraphClipboardPayload): void {
  clipboard = payload;
}

export function readGraphClipboard(): GraphClipboardPayload | null {
  return clipboard;
}

// ─── Presse-papier système (JSON versionné, multi-kind) ───
// La copie écrit aussi navigator.clipboard → une payload (chaîne de
// nœuds, spline, position) voyage entre shows, machines ou fichiers.
// Au paste, le clipboard mémoire prime (cohérence session), le texte
// système sert de fallback. L'enveloppe est versionnée : un vieux clip
// d'une autre app est ignoré, pas avalé.

const CLIPBOARD_APP = 'stagespace';
const CLIPBOARD_VERSION = 1;
export type ClipboardKind = 'graph' | 'spline' | 'position';

interface ClipboardEnvelope {
  app: string;
  v: number;
  kind: ClipboardKind;
  payload: unknown;
}

const isVec3 = (p: any): p is [number, number, number] =>
  Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((v: any) => Number.isFinite(v));

export function serializeClipboard(kind: ClipboardKind, payload: unknown): string {
  return JSON.stringify({ app: CLIPBOARD_APP, v: CLIPBOARD_VERSION, kind, payload });
}

/// Parse l'enveloppe seule — la validation de la payload est par kind
/// (parseGraphClipboard / parseSplineClipboard / parsePositionClipboard).
function parseEnvelope(text: string): ClipboardEnvelope | null {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (json?.app !== CLIPBOARD_APP || json?.v !== CLIPBOARD_VERSION) return null;
  if (json.kind !== 'graph' && json.kind !== 'spline' && json.kind !== 'position') return null;
  return json as ClipboardEnvelope;
}

export function serializeGraphClipboard(payload: GraphClipboardPayload): string {
  return serializeClipboard('graph', payload);
}

/// Valide une payload textuelle kind='graph' — structure minimale :
/// nodes[] avec id + data.type string, edges[] source/target string.
export function parseGraphClipboard(text: string): GraphClipboardPayload | null {
  const env = parseEnvelope(text);
  if (env?.kind !== 'graph') return null;
  const payload = env.payload as any;
  if (!payload || !Array.isArray(payload.nodes)) return null;
  if (payload.nodes.length === 0 || payload.nodes.length > 500) return null;
  const okNode = (n: any) =>
    typeof n?.id === 'string' && typeof n?.data?.type === 'string' &&
    typeof n?.position?.x === 'number' && typeof n?.position?.y === 'number';
  if (!payload.nodes.every(okNode)) return null;
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const okEdge = (e: any) => typeof e?.source === 'string' && typeof e?.target === 'string';
  if (!edges.every(okEdge)) return null;
  return { nodes: payload.nodes, edges };
}

// ─── Splines (control points dessinés à la main) ───

export interface SplineClipboardPayload {
  points: [number, number, number][];
  closed: boolean;
}

let splineClipboard: SplineClipboardPayload | null = null;

export function writeSplineClipboard(payload: SplineClipboardPayload): void {
  splineClipboard = payload;
}

export function readSplineClipboard(): SplineClipboardPayload | null {
  return splineClipboard;
}

export function serializeSplineClipboard(payload: SplineClipboardPayload): string {
  return serializeClipboard('spline', payload);
}

export function parseSplineClipboard(text: string): SplineClipboardPayload | null {
  const env = parseEnvelope(text);
  if (env?.kind !== 'spline') return null;
  const payload = env.payload as any;
  if (!payload || !Array.isArray(payload.points)) return null;
  if (payload.points.length < 2 || payload.points.length > 1000) return null;
  if (!payload.points.every(isVec3)) return null;
  return { points: payload.points.map((p: number[]) => [p[0], p[1], p[2]]), closed: payload.closed === true };
}

// ─── Position d'objet (copier-coller une position 3D) ───

let positionClipboard: [number, number, number] | null = null;

export function writePositionClipboard(pos: [number, number, number]): void {
  positionClipboard = pos;
}

export function readPositionClipboard(): [number, number, number] | null {
  return positionClipboard;
}

export function serializePositionClipboard(pos: [number, number, number]): string {
  return serializeClipboard('position', { pos });
}

export function parsePositionClipboard(text: string): [number, number, number] | null {
  const env = parseEnvelope(text);
  if (env?.kind !== 'position') return null;
  const pos = (env.payload as any)?.pos;
  return isVec3(pos) ? [pos[0], pos[1], pos[2]] : null;
}

/// Snapshot sérialisé de la sélection — nodes + edges internes uniquement
/// (une edge vers un node hors sélection ne se colle pas). `issueMessages`
/// est un décor injecté par le polling diagnostics — jamais persisté.
export function snapshotSelection(nodes: GraphNode[], edges: Edge[]): GraphClipboardPayload {
  const sel = nodes.filter((n) => n.selected);
  const ids = new Set(sel.map((n) => n.id));
  return {
    nodes: sel.map((n) =>
      JSON.parse(JSON.stringify({ ...n, selected: false, data: { ...n.data, issueMessages: undefined } })),
    ),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => JSON.parse(JSON.stringify({ ...e, selected: false }))),
  };
}

/// Clone la payload avec des ids frais et un offset visuel — remap des
/// références d'edges. Retourne null sur payload vide.
export function cloneForPaste(
  payload: GraphClipboardPayload,
  stamp: number,
): GraphClipboardPayload | null {
  if (payload.nodes.length === 0) return null;
  const idMap = new Map<string, string>();
  const nodes = payload.nodes.map((n, i) => {
    const nid = `${n.data.type}-${stamp}-${i}`;
    idMap.set(n.id, nid);
    return {
      ...JSON.parse(JSON.stringify(n)),
      id: nid,
      position: { x: n.position.x + 24, y: n.position.y + 24 },
      selected: true,
    } as GraphNode;
  });
  const edges = payload.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}.${e.sourceHandle ?? ''}-${idMap.get(e.target)}.${e.targetHandle ?? ''}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      selected: false,
    }));
  return { nodes, edges };
}
