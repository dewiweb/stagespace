import { useCallback, useMemo, useState, type MutableRefObject } from 'react';
import {
  MarkerType,
  type Node, type Edge, type ReactFlowInstance,
} from '@xyflow/react';
import { useGraphStore, type NodeType } from '../store/useGraphStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import {
  NODE_CATEGORIES, getDefaultParams, pluginDefaultParams,
  GLOBAL_ONLY_NODES, SUB_ONLY_NODES, SIGNAL_ONLY_NODES,
  type GraphNode,
} from '../components/nodeParamSchema';
import {
  spliceRejectionReason, effectiveInputPorts,
  firstInputPortOf, firstOutputPortOf, specOf,
} from '../utils/connectionRules';
import { FRAME_NODE_TYPE, FRAME_DATA_TYPE } from '../utils/frameNode';
import type { PortDef } from '../types/generated/PortDef';
import type { PluginManifest } from '../types/generated/PluginManifest';
import type { PluginKind } from '../types/generated/PluginKind';
import { toast } from '../utils/toast-helpers';

/// Tout ce qui fait entrer un node dans le graphe — palette clic/drag,
/// wire-drop → QuickAdd filtré, splice sur une edge (sélection, drop
/// palette, double-clic), paste de position. Extrait de NodeEditor (qui
/// dépassait le seuil de modularisation avec ces chemins en plus).
///
/// Un seul pending à la fois : `pendingWire` (fil lâché sur le pane) ou
/// `pendingInsert` (edge à couper en deux) arment le QuickAdd.

export const PALETTE_DRAG_MIME = 'application/x-stagespace-node';
export type PaletteDragPayload =
  | { kind: 'type'; type: NodeType }
  | { kind: 'plugin'; manifest: PluginManifest };

export interface PendingWire {
  nodeId: string;
  handleId: string | null;
  /// 'from' = fil tiré depuis une sortie (le nouveau node reçoit) ;
  /// 'to' = tiré depuis une entrée (le nouveau node alimente).
  dir: 'from' | 'to';
  portType: PortDef['port_type'];
  screen: { x: number; y: number };
}

const createNode = (type: NodeType, position: { x: number; y: number }): Node => ({
  id: `${type}-${Date.now()}`,
  type: 'custom',
  position,
  data: { label: type, type, params: getDefaultParams(type) },
});

/// Node Plugin pré-rempli depuis un manifeste : plugin_id + defaults
/// déclarés par le plugin, label = nom affiché du manifeste.
const createPluginNode = (manifest: PluginManifest, position: { x: number; y: number }): Node => ({
  id: `Plugin-${manifest.id}-${Date.now()}`,
  type: 'custom',
  position,
  data: { label: manifest.name, type: 'Plugin' as NodeType, params: pluginDefaultParams(manifest) },
});

/// Hit-test d'edge sous un point écran — le path visible porte `id` =
/// edge.id ; on remonte depuis le path d'interaction (20px, invisible)
/// ou le label via le groupe `.react-flow__edge` parent.
export function edgeIdAtScreenPoint(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const g = (el as HTMLElement).closest?.('.react-flow__edge');
    if (!g) continue;
    const path = g.querySelector('.react-flow__edge-path');
    if (path?.id) return path.id;
  }
  return null;
}

export function useNodeInsertion(opts: {
  activeTab: 'sub' | 'global' | 'signal';
  displayNodes: Node[];
  displayEdges: Edge[];
  plugins: PluginManifest[];
  rfInstance: MutableRefObject<ReactFlowInstance | null>;
  pluginKindOf: (node: GraphNode | undefined) => PluginKind | undefined;
}) {
  const { activeTab, displayNodes, displayEdges, plugins, rfInstance, pluginKindOf } = opts;

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  /// Double-clic sur un fil → QuickAdd filtré aux 2 bouts, node inséré
  /// au point du clic (autopatch sans sélection préalable).
  const [pendingInsert, setPendingInsert] = useState<{
    edgeId: string;
    screen: { x: number; y: number };
  } | null>(null);

  // Autopatch legacy : une edge sélectionnée + clic palette = insertion.
  const selectedEdge = useMemo(() => {
    const sel = displayEdges.filter((e) => e.selected);
    return sel.length === 1 ? sel[0] : null;
  }, [displayEdges]);

  /// Écriture context-aware : sub via le store dédié (historique +
  /// autosave), global/signal via les setters standalone (push debounced
  /// côté useStandaloneGraph).
  const addToContext = useCallback(
    (newNode: Node, newEdges: Edge[] = [], removeEdgeId?: string) => {
      if (activeTab === 'global') {
        const st = useGlobalGraphStore.getState();
        st.setNodes([...st.nodes, newNode]);
        if (newEdges.length > 0 || removeEdgeId) {
          st.setEdges([...st.edges.filter((e) => e.id !== removeEdgeId), ...newEdges]);
        }
      } else if (activeTab === 'signal') {
        const st = useSignalGraphStore.getState();
        st.setNodes([...st.nodes, newNode]);
        if (newEdges.length > 0 || removeEdgeId) {
          st.setEdges([...st.edges.filter((e) => e.id !== removeEdgeId), ...newEdges]);
        }
      } else if (removeEdgeId) {
        useGraphStore.getState().insertNodeOnEdge(newNode, removeEdgeId, newEdges[0], newEdges[1]);
      } else if (newEdges.length > 0) {
        useGraphStore.getState().addNodesAndEdges([newNode], newEdges);
      } else {
        useGraphStore.getState().addNode(newNode);
      }
    },
    [activeTab],
  );

  /// Node « frame » — annotation UI-only (jamais sérialisé backend :
  /// utils/frameNode.ts filtre les payloads). Posé en offset diagonal,
  /// derrière les autres nodes (zIndex -1), redimensionné via NodeResizer.
  const addFrame = useCallback(() => {
    const frame: Node = {
      id: `frame-${Date.now()}`,
      type: FRAME_NODE_TYPE,
      position: {
        x: 140 + (displayNodes.length % 6) * 24,
        y: 120 + (displayNodes.length % 6) * 24,
      },
      data: { label: 'Frame', type: FRAME_DATA_TYPE, params: {} },
      style: { width: 360, height: 220, zIndex: -1 },
    };
    addToContext(frame);
  }, [addToContext, displayNodes.length]);

  /// Types des nodes aux 2 bouts d'une edge (+ kind si la cible est un
  /// plugin) — partagé par le splice et le filtre QuickAdd d'insertion.
  const edgeEndpointTypes = useCallback(
    (edge: Edge) => {
      const sourceNode = displayNodes.find((n) => n.id === edge.source);
      const targetNode = displayNodes.find((n) => n.id === edge.target);
      return {
        fromType: sourceNode?.data.type as NodeType | undefined,
        toType: targetNode?.data.type as NodeType | undefined,
        toKind: pluginKindOf(targetNode as GraphNode | undefined),
      };
    },
    [displayNodes, pluginKindOf],
  );

  /// Splice `A → M → B` : remplace `edge` par deux edges autour du
  /// nouveau node. `position` = point de drop/clic ; milieu du segment
  /// sinon (autopatch par sélection).
  const spliceOnEdge = useCallback(
    (
      newNode: Node,
      insertedType: NodeType,
      insertedKind: PluginKind | undefined,
      edge: Edge,
      position?: { x: number; y: number },
    ): boolean => {
      const { fromType, toType, toKind } = edgeEndpointTypes(edge);
      if (!fromType || !toType) return false;
      const reason = spliceRejectionReason(
        fromType, toType, insertedType, insertedKind, edge.targetHandle, toKind,
      );
      if (reason) {
        toast.warning(`Can't insert ${insertedType} here — ${reason}`);
        return false;
      }
      const sourceNode = displayNodes.find((n) => n.id === edge.source);
      const targetNode = displayNodes.find((n) => n.id === edge.target);
      newNode.position = position ?? {
        x: ((sourceNode?.position.x ?? 200) + (targetNode?.position.x ?? 400)) / 2,
        y: ((sourceNode?.position.y ?? 100) + (targetNode?.position.y ?? 300)) / 2,
      };
      const arrow = { type: MarkerType.ArrowClosed };
      const edgeIn: Edge = {
        id: `e-${edge.source}-${newNode.id}-in`,
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? 'out',
        target: newNode.id,
        targetHandle: 'in',
        markerEnd: arrow,
      };
      const edgeOut: Edge = {
        id: `e-${newNode.id}-${edge.target}-out`,
        source: newNode.id,
        sourceHandle: 'out',
        target: edge.target,
        targetHandle: edge.targetHandle ?? 'in',
        markerEnd: arrow,
      };
      addToContext(newNode, [edgeIn, edgeOut], edge.id);
      toast.success(`Inserted ${newNode.data.label ?? insertedType} into the chain`);
      return true;
    },
    [edgeEndpointTypes, displayNodes, addToContext],
  );

  const toFlow = useCallback(
    (screen: { x: number; y: number }) =>
      rfInstance.current?.screenToFlowPosition(screen)
      ?? { x: 250 + displayNodes.length * 30, y: 150 + displayNodes.length * 30 },
    [rfInstance, displayNodes.length],
  );

  /// Wire-drop pick : pose `newNode` au point de drop et le câble au fil
  /// lâché (dir 'from' : le fil alimente le node ; 'to' : le node alimente
  /// le port d'où le fil partait).
  const addNodeWithWire = useCallback(
    (newNode: Node, insertedType: NodeType, insertedKind?: PluginKind) => {
      if (!pendingWire) return;
      const arrow = { type: MarkerType.ArrowClosed };
      let edge: Edge | null = null;
      if (pendingWire.dir === 'from') {
        const inPort = firstInputPortOf(insertedType, pendingWire.portType, insertedKind);
        if (inPort) {
          edge = {
            id: `${pendingWire.nodeId}.${pendingWire.handleId ?? ''}-${newNode.id}.${inPort.name}`,
            source: pendingWire.nodeId,
            sourceHandle: pendingWire.handleId ?? undefined,
            target: newNode.id,
            targetHandle: inPort.name,
            markerEnd: arrow,
          };
        }
      } else {
        const outPort = firstOutputPortOf(insertedType, pendingWire.portType);
        if (outPort) {
          edge = {
            id: `${newNode.id}.${outPort.name}-${pendingWire.nodeId}.${pendingWire.handleId ?? ''}`,
            source: newNode.id,
            sourceHandle: outPort.name,
            target: pendingWire.nodeId,
            targetHandle: pendingWire.handleId ?? undefined,
            markerEnd: arrow,
          };
        }
      }
      addToContext(newNode, edge ? [edge] : []);
      setPendingWire(null);
    },
    [pendingWire, addToContext],
  );

  const defaultPos = () => ({
    x: 250 + displayNodes.length * 30,
    y: 150 + displayNodes.length * 30,
  });

  const addNodeByType = useCallback(
    (type: NodeType) => {
      if (pendingWire) {
        addNodeWithWire(createNode(type, toFlow(pendingWire.screen)), type);
        return;
      }
      if (pendingInsert) {
        const edge = displayEdges.find((e) => e.id === pendingInsert.edgeId);
        setPendingInsert(null);
        if (edge) {
          spliceOnEdge(createNode(type, toFlow(pendingInsert.screen)), type, undefined, edge);
          return;
        }
      }
      const newNode = createNode(type, defaultPos());
      if (selectedEdge && spliceOnEdge(newNode, type, undefined, selectedEdge)) return;
      addToContext(newNode);
    },
    [pendingWire, pendingInsert, displayEdges, selectedEdge, addNodeWithWire, spliceOnEdge, addToContext, toFlow, displayNodes.length],
  );

  // Plugin = sub-graph only (SUB_ONLY_NODES) → toujours dans le store sub.
  const addPluginNode = useCallback(
    (manifest: PluginManifest) => {
      if (pendingWire) {
        addNodeWithWire(createPluginNode(manifest, toFlow(pendingWire.screen)), 'Plugin', manifest.kind);
        return;
      }
      if (pendingInsert) {
        const edge = displayEdges.find((e) => e.id === pendingInsert.edgeId);
        setPendingInsert(null);
        if (edge) {
          spliceOnEdge(createPluginNode(manifest, toFlow(pendingInsert.screen)), 'Plugin', manifest.kind, edge);
          return;
        }
      }
      const newNode = createPluginNode(manifest, defaultPos());
      if (selectedEdge && spliceOnEdge(newNode, 'Plugin', manifest.kind, selectedEdge)) return;
      useGraphStore.getState().addNode(newNode);
    },
    [pendingWire, pendingInsert, displayEdges, selectedEdge, addNodeWithWire, spliceOnEdge, toFlow, displayNodes.length],
  );

  // ── Drag-from-palette ────────────────────────────────────────────────
  // Drag sur le canvas : pose au curseur — ou splice direct si le point
  // de drop tombe sur un fil (geste Max : déposer sur un cordon).
  const onPaletteDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(PALETTE_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onPaletteDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(PALETTE_DRAG_MIME);
      if (!raw) return;
      e.preventDefault();
      let payload: PaletteDragPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const flow = toFlow({ x: e.clientX, y: e.clientY });
      const edgeId = edgeIdAtScreenPoint(e.clientX, e.clientY);
      const edge = edgeId ? displayEdges.find((x) => x.id === edgeId) ?? null : null;
      if (payload.kind === 'plugin') {
        const node = createPluginNode(payload.manifest, flow);
        if (edge && spliceOnEdge(node, 'Plugin', payload.manifest.kind, edge, flow)) return;
        useGraphStore.getState().addNode(node);
        return;
      }
      const node = createNode(payload.type, flow);
      if (edge && spliceOnEdge(node, payload.type, undefined, edge, flow)) return;
      addToContext(node);
    },
    [displayEdges, toFlow, spliceOnEdge, addToContext],
  );

  // ── Ouvertures du QuickAdd ───────────────────────────────────────────
  const openQuickAdd = useCallback(() => {
    setPendingWire(null);
    setPendingInsert(null);
    setQuickAddOpen(true);
  }, []);

  const openQuickAddForWire = useCallback((wire: PendingWire) => {
    setPendingInsert(null);
    setPendingWire(wire);
    setQuickAddOpen(true);
  }, []);

  const openQuickAddForInsert = useCallback((edge: Edge, screen: { x: number; y: number }) => {
    setPendingWire(null);
    setPendingInsert({ edgeId: edge.id, screen });
    setQuickAddOpen(true);
  }, []);

  const closeQuickAdd = useCallback(() => {
    setQuickAddOpen(false);
    setPendingWire(null);
    setPendingInsert(null);
  }, []);

  // ── Contenu du QuickAdd selon le mode ────────────────────────────────
  const scopeFiltered = useMemo(
    () =>
      NODE_CATEGORIES.flatMap((cat) =>
        activeTab === 'signal'
          ? cat.types.filter((t) => SIGNAL_ONLY_NODES.has(t))
          : activeTab === 'global'
            ? cat.types.filter((t) => !SUB_ONLY_NODES.has(t) && !SIGNAL_ONLY_NODES.has(t))
            : cat.types.filter((t) => !GLOBAL_ONLY_NODES.has(t) && !SIGNAL_ONLY_NODES.has(t)),
      ),
    [activeTab],
  );

  /// Edge du pending insert — résolue à chaud (peut avoir été supprimée
  /// pendant que le modal était ouvert → filtre désactivé alors).
  const insertEdge = pendingInsert
    ? displayEdges.find((e) => e.id === pendingInsert.edgeId) ?? null
    : null;

  const allowedTypes = useMemo(() => {
    if (pendingWire) {
      return scopeFiltered.filter((t) =>
        pendingWire.dir === 'from'
          ? effectiveInputPorts(t).some((p) => p.port_type === pendingWire.portType)
          : specOf(t).outputs.some((p) => p.port_type === pendingWire.portType),
      );
    }
    if (insertEdge) {
      const { fromType, toType, toKind } = edgeEndpointTypes(insertEdge);
      if (fromType && toType) {
        return scopeFiltered.filter(
          (t) => !spliceRejectionReason(fromType, toType, t, undefined, insertEdge.targetHandle, toKind),
        );
      }
    }
    return scopeFiltered;
  }, [scopeFiltered, pendingWire, insertEdge, edgeEndpointTypes]);

  const quickAddPlugins = useMemo(() => {
    if (activeTab !== 'sub') return [];
    if (pendingWire) {
      return plugins.filter((m) =>
        pendingWire.dir === 'from'
          ? effectiveInputPorts('Plugin', m.kind).some((p) => p.port_type === pendingWire.portType)
          : specOf('Plugin').outputs.some((p) => p.port_type === pendingWire.portType),
      );
    }
    if (insertEdge) {
      const { fromType, toType, toKind } = edgeEndpointTypes(insertEdge);
      if (fromType && toType) {
        return plugins.filter(
          (m) => !spliceRejectionReason(fromType, toType, 'Plugin', m.kind, insertEdge.targetHandle, toKind),
        );
      }
    }
    return plugins;
  }, [activeTab, pendingWire, insertEdge, plugins, edgeEndpointTypes]);

  /// Hint contextuel affiché dans le modal.
  const quickAddHint = useMemo(() => {
    if (pendingWire) {
      const node = displayNodes.find((n) => n.id === pendingWire.nodeId);
      const label = node?.data.type ?? pendingWire.nodeId;
      return pendingWire.dir === 'from'
        ? `wire from ${label} · ${pendingWire.portType} — new node gets connected`
        : `wire to ${label} · ${pendingWire.portType} — new node gets connected`;
    }
    if (insertEdge) {
      const from = displayNodes.find((n) => n.id === insertEdge.source)?.data.type ?? insertEdge.source;
      const to = displayNodes.find((n) => n.id === insertEdge.target)?.data.type ?? insertEdge.target;
      return `insert on ${from} → ${to}`;
    }
    return undefined;
  }, [pendingWire, insertEdge, displayNodes]);

  return {
    quickAddOpen,
    openQuickAdd,
    openQuickAddForWire,
    openQuickAddForInsert,
    closeQuickAdd,
    allowedTypes,
    quickAddPlugins,
    quickAddHint,
    selectedEdge,
    addNodeByType,
    addPluginNode,
    addFrame,
    onPaletteDragOver,
    onPaletteDrop,
  };
}
