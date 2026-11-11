import React, { useRef, useMemo, useState } from 'react';
import {
  ReactFlow, useReactFlow, Background, Controls, MiniMap, Panel, NodeTypes,
  type Node, type Edge, type Connection, type OnConnectStartParams,
  type OnNodesChange, type OnEdgesChange, type HandleType,
  type ReactFlowInstance,
} from '@xyflow/react';
import EmptyState from '../ui/EmptyState';
import { getCategoryColor, type GraphNode } from '../nodeParamSchema';
import type { NodeType } from '../../store/useGraphStore';
import { portTypesInGraph, PORT_COLORS } from '../../utils/connectionRules';
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';
import { countIssues, type GraphIssue } from '../../utils/graphIssues';
import { useEffect } from 'react';

/// Canvas ReactFlow extrait de NodeEditor (P2.4) — la surface d'édition :
/// le flow décoré (issues + MoveRef actifs), les panneaux flottants
/// (diagnostics, légende de ports), l'état vide, et les overlays passés
/// en `children` (nodeMenu, QuickAddModal, connecting badge).
///
/// Les handlers `onNodesChange/onEdgesChange/onConnect` arrivent DÉJÀ
/// résolus par le parent (sub store vs standalone global/signal) — le
/// canvas ne connaît pas les trois contextes.
interface GraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (connection: Connection) => void;
  onConnectStart: (event: unknown, params: OnConnectStartParams) => void;
  onConnectEnd: (event: unknown) => void;
  /// Drag du endpoint d'une edge vers une autre cible (reconnect plugdata).
  onReconnect: (oldEdge: Edge, newConnection: Connection) => void;
  onReconnectStart: (event: unknown, edge: Edge, handleType: HandleType) => void;
  onReconnectEnd: (event: unknown, edge: Edge, handleType: HandleType) => void;
  /// Instance ReactFlow exposée (screenToFlowPosition pour le wire-drop).
  onInit: (instance: ReactFlowInstance) => void;
  onNodeDoubleClick: (event: React.MouseEvent, node: Node) => void;
  onNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
  /// Double-clic sur un fil → QuickAdd filtré aux 2 bouts (insertion).
  onEdgeDoubleClick: (event: React.MouseEvent, edge: Edge) => void;
  /// Drop palette → canvas (node posé au curseur, ou splice sur un fil).
  onPaletteDrop: (e: React.DragEvent) => void;
  onPaletteDragOver: (e: React.DragEvent) => void;
  onDismissNodeMenu: () => void;
  onPaneDoubleClick: (e: React.MouseEvent) => void;
  isValidConnection: (connection: Edge | Connection) => boolean;
  nodeTypes: NodeTypes;
  /// Clé de contexte pour re-fit la vue (tab + slot édité).
  contextKey: string;
  /// Nodes bruts (non décorés) — légende des ports + état vide.
  displayNodes: GraphNode[];
  emptyHint: string;
  graphIssues: GraphIssue[];
  issuesOpen: boolean;
  onToggleIssues: () => void;
  children?: React.ReactNode;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = (p) => {
  return (
    <div
      className="flex-1 bg-stagespace-bg relative"
      onDrop={p.onPaletteDrop}
      onDragOver={p.onPaletteDragOver}
    >
      <ReactFlow
        nodes={p.nodes}
        edges={p.edges}
        onNodesChange={p.onNodesChange}
        onEdgesChange={p.onEdgesChange}
        onConnect={p.onConnect}
        onConnectStart={p.onConnectStart}
        onConnectEnd={p.onConnectEnd}
        onReconnect={p.onReconnect}
        onReconnectStart={p.onReconnectStart}
        onReconnectEnd={p.onReconnectEnd}
        onInit={p.onInit}
        edgesReconnectable
        onNodeDoubleClick={p.onNodeDoubleClick}
        onEdgeDoubleClick={p.onEdgeDoubleClick}
        onNodeContextMenu={p.onNodeContextMenu}
        onNodeClick={p.onDismissNodeMenu}
        onPaneClick={p.onDismissNodeMenu}
        onMoveStart={p.onDismissNodeMenu}
        onDoubleClick={p.onPaneDoubleClick}
        isValidConnection={p.isValidConnection}
        nodeTypes={p.nodeTypes}
        fitView
        /* minZoom bas : les gros graphes doivent pouvoir se dézoomer
           largement pour la navigation d'ensemble (défaut 0.5 = bloquant). */
        minZoom={0.15}
        maxZoom={2}
        deleteKeyCode={['Delete', 'Backspace']}
        className="!bg-stagespace-bg"
      >
        <Background color="#1e1e2e" gap={24} />
        <Controls showInteractive={false} />
        <ViewportSync contextKey={p.contextKey} />
        <PortLegend nodes={p.displayNodes} />
        <IssuesPanel
          issues={p.graphIssues}
          open={p.issuesOpen}
          onToggle={p.onToggleIssues}
          nodes={p.nodes}
          onNodesChange={p.onNodesChange}
        />
        <MiniMap
          nodeColor={(n) => getCategoryColor((n.data.type ?? '') as NodeType)}
          maskColor="rgba(10,10,15,0.7)"
        />
      </ReactFlow>

      {p.displayNodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <EmptyState title="Empty graph" hint={p.emptyHint} />
        </div>
      )}

      {p.children}
    </div>
  );
};

/// Re-fit la vue quand le contexte change (tab / slot édité) — sans ça le
/// graphe nouveau apparaît hors champ. Doit être enfant de <ReactFlow>
/// (useReactFlow nécessite le provider interne de ReactFlow).
function ViewportSync({ contextKey }: { contextKey: string }) {
  const { fitView } = useReactFlow();
  const lastKey = useRef(contextKey);
  useEffect(() => {
    if (lastKey.current === contextKey) return;
    lastKey.current = contextKey;
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 200 });
    });
    return () => cancelAnimationFrame(raf);
  }, [contextKey, fitView]);
  return null;
}

/// Panneau de diagnostics backend — chaque issue avec node_ids est cliquable :
/// focus (fitView) + sélection des nodes coupables. Enfant de <ReactFlow>
/// (useReactFlow nécessite le provider interne).
function IssuesPanel({ issues, open, onToggle, nodes, onNodesChange }: {
  issues: GraphIssue[];
  open: boolean;
  onToggle: () => void;
  nodes: Node[];
  onNodesChange: OnNodesChange<Node>;
}) {
  const { fitView } = useReactFlow();
  const counts = useMemo(() => countIssues(issues), [issues]);
  if (counts.errors === 0 && counts.warnings === 0) return null;

  const focusNodes = (ids: string[]) => {
    if (ids.length === 0) return;
    fitView({ nodes: ids.map((id) => ({ id })), duration: 250, padding: 0.4, maxZoom: 1.3 });
    const inSet = new Set(ids);
    onNodesChange([
      ...nodes.filter((n) => n.selected && !inSet.has(n.id))
        .map((n) => ({ type: 'select' as const, id: n.id, selected: false })),
      ...ids.map((id) => ({ type: 'select' as const, id, selected: true })),
    ]);
  };

  return (
    <Panel position="top-right" className="text-xs">
      <button
        onClick={onToggle}
        className="px-2 py-1 rounded bg-gray-900 border border-gray-700 hover:border-gray-500"
        title="Graph diagnostics (backend) — click an issue to focus its node"
      >
        {counts.errors > 0 && (
          <span className="text-red-400">{counts.errors} error{counts.errors > 1 ? 's' : ''}</span>
        )}
        {counts.errors > 0 && counts.warnings > 0 && ' · '}
        {counts.warnings > 0 && (
          <span className="text-amber-400">{counts.warnings} warning{counts.warnings > 1 ? 's' : ''}</span>
        )}
      </button>
      {open && (
        <div className="mt-1 max-w-xs max-h-64 overflow-y-auto bg-gray-900 border border-gray-700 rounded p-2 space-y-1">
          {issues.map((i, k) => (
            <button
              key={k}
              onClick={() => focusNodes(i.node_ids)}
              disabled={i.node_ids.length === 0}
              className={`w-full text-left rounded px-1 py-0.5 transition-colors ${
                i.severity === 'Error' ? 'text-red-300' : 'text-amber-300'
              } ${i.node_ids.length > 0 ? 'hover:bg-gray-800 cursor-pointer' : 'cursor-default'}`}
              title={i.node_ids.length > 0 ? 'Focus the node(s) on the canvas' : undefined}
            >
              <span className="font-semibold">{i.severity}</span> — {i.message}
              {i.node_ids.length > 0 && (
                <div className="text-gray-500 font-mono text-[10px]">{i.node_ids.join(', ')}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

const LEGEND_STORAGE_KEY = 'stagespace.portLegend.collapsed';

/// Légende compacte des types de ports présents dans le contexte courant —
/// les couleurs viennent de PORT_COLORS (source unique partagée avec les
/// handles). Repliée/dépliée persiste en localStorage.
function PortLegend({ nodes }: { nodes: GraphNode[] }) {
  const [collapsed, setCollapsed] = useState(
    () => safeGetItem(LEGEND_STORAGE_KEY) === 'true',
  );
  const types = useMemo(
    () => portTypesInGraph(nodes.map((n) => n.data.type)),
    [nodes],
  );
  if (types.length === 0) return null;
  return (
    <div className="absolute top-2 left-2 z-raised text-xs bg-gray-900/90 border border-gray-700 rounded">
      <button
        onClick={() => {
          setCollapsed((c) => {
            const next = !c;
            safeSetItem(LEGEND_STORAGE_KEY, String(next));
            return next;
          });
        }}
        className="px-2 py-1 w-full text-left text-gray-300 hover:text-white"
        title="Port type legend"
      >
        {collapsed ? '› Ports' : '˅ Ports'}
      </button>
      {!collapsed && (
        <div className="px-2 pb-2 space-y-0.5">
          {types.map((t) => (
            <div key={t} className="flex items-center gap-1.5 text-gray-400">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${PORT_COLORS[t]}`} />
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GraphCanvas;
