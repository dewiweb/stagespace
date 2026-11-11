import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import {
  NodeTypes,
  type Node,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnConnectStartParams,
  type HandleType,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore, NodeType } from '../store/useGraphStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import CustomNode from './CustomNode';
import FrameNode from './editor/FrameNode';
import { NodePalette } from './editor/NodePalette';
import { GraphCanvas } from './editor/GraphCanvas';
import { useStandaloneGraph } from '../hooks/useStandaloneGraph';
import { useNodeInsertion } from '../hooks/useNodeInsertion';
import { useGraphClipboard } from '../hooks/useGraphClipboard';
import { QuickAddModal } from './QuickAddModal';
import { type GraphNode } from './nodeParamSchema';
import {
  isValidConnection, connectionRejectionReason,
  outputPortType, inputPortType,
} from '../utils/connectionRules';
import { healEdgesForRemoval } from '../utils/graphHeal';
import { stripFrames, isFrameNode } from '../utils/frameNode';
import { presetsUsingType } from '../utils/shapePresets';
import { toast } from '../utils/toast-helpers';
import { safeInvoke as invoke } from '../utils/tauri';
import { issuesByNode, nodeIssueClass, type GraphIssue } from '../utils/graphIssues';
import type { PluginKind } from '../types/generated/PluginKind';

/// `frame` = annotation UI-only — jamais sérialisé vers le backend
/// (utils/frameNode.ts filtre tous les payloads).
const nodeTypes: NodeTypes = { custom: CustomNode, frame: FrameNode };

export const NodeEditor: React.FC = () => {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const storeConnect = useGraphStore((s) => s.onConnect);
  const applyShapePreset = useGraphStore((s) => s.applyShapePreset);
  const [hoveredPaletteNode, setHoveredPaletteNode] = useState<string | null>(null);
  /// Origine du fil en cours de drag — type + node + handle. Sert au dimming
  /// des cibles invalides ET au wire-drop→quick-add (type de port).
  const [connectingFrom, setConnectingFrom] = useState<{
    type: NodeType;
    nodeId: string;
    handleId: string | null;
    handleType: 'source' | 'target';
  } | null>(null);
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  // Clic-droit node → menu "Open example" (help patches Pd/plugdata :
  // la doc est un graphe runnable, pas du texte).
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeType: NodeType } | null>(null);
  // Palette repliable — QuickAdd couvre l'ajout rapide ; la palette sert
  // la découverte. Repliée elle rend ~220px au canvas en split expert.
  // État persisté : sans ça elle repartait dépliée à chaque session et
  // écrasait le canvas en split (240px de palette pour ~430px de colonne).
  const [paletteCollapsed, _setPaletteCollapsed] = useState(() =>
    localStorage.getItem('stagespace:node-palette-collapsed') === '1');
  const setPaletteCollapsed = useCallback((v: boolean) => {
    _setPaletteCollapsed(v);
    localStorage.setItem('stagespace:node-palette-collapsed', v ? '1' : '0');
  }, []);

  // Tab: "sub" = graph du slot édité, "global" = graph global (post-processing),
  // "signal" = graph de modulation (domaine scalaire → deltas de macros)
  const [activeTab, setActiveTab] = useState<'sub' | 'global' | 'signal'>('sub');

  // Nom du slot édité (pour l'afficher dans le tab sub-graph)
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const editingSlotName = editingSlotId
    ? moveSlots.find((s) => s.id === editingSlotId)?.name ?? null
    : null;

  // Global graph store
  const globalNodes = useGlobalGraphStore((s) => s.nodes);
  const globalEdges = useGlobalGraphStore((s) => s.edges);
  const setGlobalNodes = useGlobalGraphStore((s) => s.setNodes);
  const setGlobalEdges = useGlobalGraphStore((s) => s.setEdges);
  const pushGlobalGraph = useGlobalGraphStore((s) => s.pushGlobalGraph);
  const resetToDefault = useGlobalGraphStore((s) => s.resetToDefault);

  // Signal graph store (modulation → deltas de macros)
  const signalNodes = useSignalGraphStore((s) => s.nodes);
  const signalEdges = useSignalGraphStore((s) => s.edges);
  const setSignalNodes = useSignalGraphStore((s) => s.setNodes);
  const setSignalEdges = useSignalGraphStore((s) => s.setEdges);
  const pushSignalGraph = useSignalGraphStore((s) => s.pushSignalGraph);
  const resetSignalToDefault = useSignalGraphStore((s) => s.resetToDefault);
  const setSignalContext = useSignalGraphStore((s) => s.setContext);

  // Le tab Mods édite la modulation du slot en cours d'édition (per-move,
  // cibles `param:`) quand un slot est sélectionné — sinon le global.
  const editingSlotSignalGraph = editingSlotId
    ? moveSlots.find((s) => s.id === editingSlotId)?.signalGraph ?? null
    : null;
  useEffect(() => {
    setSignalContext(editingSlotId, editingSlotSignalGraph);
  }, [editingSlotId]); // eslint-disable-line react-hooks/exhaustive-deps -- rebind on slot switch only

  // Moves actifs (pour highlight les MoveRef dont le move est actif)
  const movements = useGraphStore((s) => s.movements);
  const activeMoveIds = useMemo(() => new Set(movements.map((m) => m.id)), [movements]);

  // Plugins WASM — manifestes chargés via le registry backend. Fetch lazy
  // au premier mount de l'éditeur (App fetch aussi au boot).
  const plugins = useGraphStore((s) => s.plugins);
  const pluginErrors = useGraphStore((s) => s.pluginErrors);
  const pluginsDir = useGraphStore((s) => s.pluginsDir);
  const pluginsLoaded = useGraphStore((s) => s.pluginsLoaded);
  const fetchPlugins = useGraphStore((s) => s.fetchPlugins);
  const reloadPlugins = useGraphStore((s) => s.reloadPlugins);
  const importPlugin = useGraphStore((s) => s.importPlugin);
  useEffect(() => {
    if (!pluginsLoaded) void fetchPlugins();
  }, [pluginsLoaded, fetchPlugins]);

  // Les nodes/edges affichés dépendent du tab actif
  const displayNodes =
    activeTab === 'global' ? globalNodes : activeTab === 'signal' ? signalNodes : nodes;
  const displayEdges =
    activeTab === 'global' ? globalEdges : activeTab === 'signal' ? signalEdges : edges;

  // Diagnostics live (debounced 200ms) — les règles du graphe vivent dans
  // le backend ; l'éditeur surligne les nodes en erreur/warning.
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const issueMap = useMemo(() => issuesByNode(graphIssues), [graphIssues]);

  // Décor des nodes (highlight connexion + MoveRef actif) memoized — sans ça,
  // chaque render recrée tous les objets node et React Flow re-render tout.
  const decoratedNodes = useMemo(
    () =>
      displayNodes.map((n) => {
        const nodeType = n.data.type as NodeType;
        const isMoveRef = nodeType === 'MoveRef';
        const moveId = n.data.params?.move_id as string;
        const isMoveActive = isMoveRef && moveId && activeMoveIds.has(moveId);
        const issue = issueMap.get(n.id);
        return {
          ...n,
          data: issue ? { ...n.data, issueMessages: issue.messages } : n.data,
          className: [
            connectingFrom && connectingFrom.nodeId !== n.id && !isFrameNode(n) && !isValidConnection(
              connectingFrom.type,
              nodeType,
              nodeType === 'Plugin'
                ? plugins.find((m) => m.id === n.data.params?.plugin_id)?.kind
                : undefined,
            ) ? 'rf-node-invalid-target' : '',
            isMoveActive ? 'rf-node-moveref-active' : '',
            nodeIssueClass(issueMap, n.id) ?? '',
          ].filter(Boolean).join(' '),
          style: isMoveActive ? { ...n.style, boxShadow: '0 0 8px 2px rgba(34, 197, 94, 0.6)' } : n.style,
        };
      }),
    [displayNodes, connectingFrom, activeMoveIds, plugins, issueMap],
  );

  useEffect(() => {
    const ctx = activeTab === 'global' ? 'global' : activeTab === 'signal' ? 'signal' : 'sub';
    const timer = setTimeout(async () => {
      const toGraphJson = (ns: GraphNode[], es: Edge[]) => {
        // Les frames (annotation UI) ne partent jamais au backend —
        // 'Frame' n'est pas un NodeType de l'enum Rust.
        const { nodes: kept, edges: keptEdges } = stripFrames(ns, es);
        return {
          nodes: kept.map((n) => ({
            id: n.id,
            type: 'custom',
            position: n.position,
            data: { label: n.data.label ?? n.data.type ?? '', type: n.data.type ?? '', params: n.data.params ?? {} },
          })),
          edges: keptEdges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? 'out',
            targetHandle: e.targetHandle ?? 'in',
          })),
        };
      };
      try {
        // En contexte signal per-move, le graphe du move sert à résoudre
        // les cibles `param:` (global signal → aucun move).
        const moveGraphJson =
          activeTab === 'signal' && editingSlotId ? toGraphJson(nodes, edges) : null;
        const issues = await invoke<GraphIssue[]>('diagnose_graph', {
          graphJson: toGraphJson(displayNodes, displayEdges),
          context: ctx,
          moveGraphJson,
        });
        setGraphIssues(issues);
      } catch {
        setGraphIssues([]); // pas de backend (Vite seul) — silence
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [displayNodes, displayEdges, activeTab, editingSlotId, nodes, edges]);

  // Handlers des graphes standalone (global/signal) — un seul hook
  // factorise le pattern applyChanges→set→push débouncé (ex-triplication).
  const connectedThisDrop = React.useRef(false);
  const globalGraph = useStandaloneGraph({
    nodes: globalNodes, edges: globalEdges,
    setNodes: setGlobalNodes, setEdges: setGlobalEdges,
    pushGraph: pushGlobalGraph, active: activeTab === 'global',
    connectedThisDrop,
    undo: useGlobalGraphStore.getState().undo,
    redo: useGlobalGraphStore.getState().redo,
  });
  const signalGraph = useStandaloneGraph({
    nodes: signalNodes, edges: signalEdges,
    setNodes: setSignalNodes, setEdges: setSignalEdges,
    pushGraph: pushSignalGraph, active: activeTab === 'signal',
    connectedThisDrop,
    undo: useSignalGraphStore.getState().undo,
    redo: useSignalGraphStore.getState().redo,
  });

  const handleConnect = useCallback((connection: Connection) => {
    connectedThisDrop.current = true;
    storeConnect(connection);
  }, [storeConnect]);

  // Validation visuelle des connexions — empêche de connecter des nodes incompatibles
  // Tient compte des ports (input, input_a, input_b, duration, output)
  const checkValidConnection: IsValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const sourceNode = displayNodes.find((n) => n.id === connection.source);
      const targetNode = displayNodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      const fromType = sourceNode.data.type as NodeType;
      const toType = targetNode.data.type as NodeType;
      if (!fromType || !toType) return false;

      // Plugin cible : le kind du manifeste dicte les règles (ABI v2)
      const toPluginKind = toType === 'Plugin'
        ? plugins.find((m) => m.id === targetNode.data.params?.plugin_id)?.kind
        : undefined;

      // Compatibilité port-niveau : existence + égalité de type —
      // règle unique, mirroir du validator Rust.
      return isValidConnection(
        fromType, toType,
        connection.sourceHandle ?? undefined, connection.targetHandle ?? undefined,
        toPluginKind,
      );
    },
    [displayNodes, plugins],
  );

  // Track l'origine du fil quand on commence une connexion — type + node +
  // handle : le wire-drop→quick-add en a besoin pour filtrer et câbler.
  const onConnectStart = useCallback((_: any, params: OnConnectStartParams) => {
    connectedThisDrop.current = false;
    const sourceNode = displayNodes.find((n) => n.id === params.nodeId);
    if (sourceNode && (params.handleType === 'source' || params.handleType === 'target')) {
      setConnectingFrom({
        type: sourceNode.data.type as NodeType,
        nodeId: params.nodeId ?? '',
        handleId: params.handleId ?? null,
        handleType: params.handleType,
      });
    }
  }, [displayNodes]);

  /// Kind du manifeste d'un node Plugin — restreint les ports effectifs.
  const pluginKindOf = useCallback(
    (node: GraphNode | undefined): PluginKind | undefined =>
      node?.data.type === 'Plugin'
        ? plugins.find((m) => m.id === node.data.params?.plugin_id)?.kind
        : undefined,
    [plugins],
  );

  // Insertion de nodes (palette clic/drag, wire-drop, splice, QuickAdd)
  // et clipboard (copy/cut/paste/dup + suppression par ids) — extraits
  // dans des hooks dédiés (modularisation).
  const insert = useNodeInsertion({
    activeTab, displayNodes, displayEdges, plugins, rfInstance, pluginKindOf,
  });
  const { removeByIds } = useGraphClipboard({
    activeTab, displayNodes, displayEdges, onQuickAdd: insert.openQuickAdd,
    pluginKindOf,
  });

  /// onNodesChange context-aware — avec heal (plugdata) : un node
  /// mid-chain supprimé au Delete recoud ses voisins quand les types de
  /// port correspondent (1 entrée + 1 sortie compatibles).
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const removed = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => c.id),
      );
      const heal = removed.size
        ? healEdgesForRemoval(removed, displayNodes, displayEdges, pluginKindOf)
        : [];
      (activeTab === 'global'
        ? globalGraph.onNodesChange
        : activeTab === 'signal'
          ? signalGraph.onNodesChange
          : onNodesChange)(changes);
      if (heal.length > 0) {
        if (activeTab === 'global') {
          const st = useGlobalGraphStore.getState();
          st.setEdges([...st.edges, ...heal]);
        } else if (activeTab === 'signal') {
          const st = useSignalGraphStore.getState();
          st.setEdges([...st.edges, ...heal]);
        } else {
          useGraphStore.getState().addNodesAndEdges([], heal);
        }
      }
    },
    [
      activeTab, displayNodes, displayEdges, pluginKindOf,
      globalGraph, signalGraph, onNodesChange,
    ],
  );

  const onConnectEnd = useCallback((event: any) => {
    const conn = connectingFrom;
    setConnectingFrom(null);
    // Drop réussi → onConnect a tourné. Drop sur un node incompatible →
    // expliquer pourquoi. Drop sur le pane → QuickAdd filtré au type de
    // port du fil (le geste signature plugdata : lâcher un fil dans le
    // vide ouvre la palette des nodes compatibles, posés câblés).
    if (connectedThisDrop.current || !conn) return;
    const el = event.target as HTMLElement | null;
    const targetNodeEl = el?.closest?.('.react-flow__node') as HTMLElement | null;
    const targetId = targetNodeEl?.dataset?.id;
    if (!targetId) {
      if (el?.closest?.('.react-flow__pane')) {
        // Fil arraché d'une entrée déjà câblée et lâché dans le vide =
        // "tirer le cable" (sémantique Max) → supprimer l'edge, pas de
        // QuickAdd. Entrée vierge → QuickAdd filtré (création).
        if (conn.handleType === 'target') {
          const incoming = displayEdges.find(
            (e) => e.target === conn.nodeId
              && (e.targetHandle ?? 'in') === (conn.handleId ?? 'in'),
          );
          if (incoming) {
            removeByIds(new Set(), new Set([incoming.id]));
            return;
          }
        }
        const srcNode = displayNodes.find((n) => n.id === conn.nodeId);
        const portType = conn.handleType === 'source'
          ? outputPortType(conn.type, conn.handleId)
          : inputPortType(conn.type, conn.handleId, pluginKindOf(srcNode as GraphNode | undefined));
        if (portType) {
          const pt = event.changedTouches?.[0] ?? event;
          insert.openQuickAddForWire({
            nodeId: conn.nodeId,
            handleId: conn.handleId,
            dir: conn.handleType === 'source' ? 'from' : 'to',
            portType,
            screen: { x: pt.clientX, y: pt.clientY },
          });
        }
      }
      return;
    }
    const targetNode = displayNodes.find((n) => n.id === targetId);
    const toType = targetNode?.data.type as NodeType | undefined;
    if (!toType) return;
    const toPluginKind = toType === 'Plugin'
      ? plugins.find((m) => m.id === targetNode?.data.params?.plugin_id)?.kind
      : undefined;
    const handleEl = el?.closest?.('.react-flow__handle') as HTMLElement | null;
    const targetPort = handleEl?.dataset?.handleid ?? null;
    // Back-drag (fil tiré depuis une entrée) : la cible devient la source
    // de l'edge — la raison du refus se formule dans le sens du flux.
    const reason = conn.handleType === 'source'
      ? connectionRejectionReason(
          conn.type, toType, conn.handleId ?? undefined, targetPort ?? undefined, toPluginKind,
        )
      : connectionRejectionReason(
          toType, conn.type, targetPort ?? undefined, conn.handleId ?? undefined,
          pluginKindOf(targetNode as GraphNode | undefined),
        );
    if (reason) toast.warning(reason);
  }, [connectingFrom, displayNodes, displayEdges, plugins, pluginKindOf, removeByIds, insert]);

  // Double-clic sur un node MoveRef → sélectionner le move et switcher vers le tab sub-graph
  const onNodeDoubleClick = useCallback((_: any, node: GraphNode) => {
    const nodeType = node.data.type as NodeType;
    if (nodeType !== 'MoveRef') return;
    const moveId = node.data.params?.move_id as string;
    if (!moveId) return;
    // Sélectionner le slot qui correspond à ce move
    const { moveSlots, selectSlotForEditing } = useGraphStore.getState();
    const slot = moveSlots.find((s) => s.movementId === moveId);
    if (slot) {
      selectSlotForEditing(slot.id);
    }
    // Switcher vers le tab sub-graph
    setActiveTab('sub');
  }, []);

  // Runnable help — les presets sont des graphes complets chargeables ;
  // on charge celui qui utilise le type du node cliqué. Undoable (pushHistory
  // dans applyShapePreset) — le toast le rappelle.
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    // Frames : annotation UI — pas d'exemples à proposer.
    if (isFrameNode(node)) return;
    const nodeType = node.data.type as NodeType | undefined;
    if (!nodeType) return;
    setNodeMenu({ x: event.clientX, y: event.clientY, nodeType });
  }, []);

  const openExampleFor = useCallback((nodeType: NodeType, presetId: string, presetName: string) => {
    setNodeMenu(null);
    const objectsNode = nodes.find((n) => n.data.type === 'Objects');
    const nObjects = Number(objectsNode?.data.params?.n_objects) || 8;
    applyShapePreset(presetId, nObjects);
    toast.info(`Loaded example '${presetName}' (${nodeType}) — Ctrl+Z to undo`);
  }, [nodes, applyShapePreset]);

  // Drag du endpoint d'une edge — reconnect (même découpage que onConnect :
  // standalone via le hook, sub via reconnectEdge du store).
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      connectedThisDrop.current = true;
      if (activeTab === 'global') globalGraph.onReconnect(oldEdge, connection);
      else if (activeTab === 'signal') signalGraph.onReconnect(oldEdge, connection);
      else useGraphStore.getState().reconnectEdge(oldEdge.id, connection);
    },
    [activeTab, globalGraph, signalGraph],
  );

  // Pendant le drag de reconnect, dimmer les cibles invalides comme pour
  // un fil neuf — l'extrémité ancrée reste branchée, l'autre bout cherche.
  const onReconnectStart = useCallback(
    (_: unknown, edge: Edge, handleType: HandleType) => {
      connectedThisDrop.current = false;
      const anchored = handleType === 'target'
        ? { id: edge.source, handleId: edge.sourceHandle ?? null, type: 'source' as const }
        : { id: edge.target, handleId: edge.targetHandle ?? null, type: 'target' as const };
      const node = displayNodes.find((n) => n.id === anchored.id);
      if (node) {
        setConnectingFrom({
          type: node.data.type as NodeType,
          nodeId: anchored.id,
          handleId: anchored.handleId,
          handleType: anchored.type,
        });
      }
    },
    [displayNodes],
  );

  /// Fin d'un drag de reconnect : réussi → onReconnect a tourné. Sinon,
  /// endpoint lâché sur le pane = "arracher le cable" (Max/plugdata) →
  /// supprimer l'edge ; lâché ailleurs → restore implicite React Flow.
  const onReconnectEnd = useCallback(
    (event: any, edge: Edge) => {
      setConnectingFrom(null);
      if (connectedThisDrop.current) return;
      const el = event?.target as HTMLElement | null;
      if (el?.closest?.('.react-flow__pane')) {
        removeByIds(new Set(), new Set([edge.id]));
      }
    },
    [removeByIds],
  );

  const onPaneDoubleClick = useCallback((e: React.MouseEvent) => {
    // Uniquement le pane lui-même — un double-clic sur MiniMap, Controls
    // ou un node bubble jusqu'au wrapper et ouvrirait QuickAdd par erreur.
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
    insert.openQuickAdd();
  }, [insert]);

  /// Double-clic sur un fil → QuickAdd filtré aux types des 2 bouts,
  /// node inséré au point du clic (autopatch sans sélection préalable).
  const onEdgeDoubleClick = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      insert.openQuickAddForInsert(edge, { x: e.clientX, y: e.clientY });
    },
    [insert],
  );

  // Edge activity (plugdata) : les edges s'animent quand le graphe qu'on
  // édite tourne — sub : le slot édité a un move actif ; global : n'importe
  // quel move actif (le post-process tourne dès qu'un move joue).
  const editedSlotLive = useMemo(() => {
    const slot = moveSlots.find((s) => s.id === editingSlotId);
    return !!slot?.movementId;
  }, [moveSlots, editingSlotId]);
  const edgesLive =
    activeTab === 'sub' ? editedSlotLive : movements.length > 0;
  // Insert-target : l'edge sélectionnée sur laquelle un modifier peut
  // s'insérer (trajectoire, pas duration/spline) prend un style dash cyan
  // — l'autopatch doit être découvrable sans lire le hint de palette.
  const selectedEdge = insert.selectedEdge;
  const insertableEdgeId =
    selectedEdge &&
    !['objects', 'duration', 'spline'].includes(selectedEdge.targetHandle ?? '')
      ? selectedEdge.id
      : null;
  // Color-coding par port : une edge vers 'duration' porte un temps, vers
  // 'spline' une géométrie — visuellement distinctes des edges trajectoire.
  const portEdgeClass = (handle: string | null | undefined) =>
    handle === 'duration' ? 'rf-edge-duration' :
    handle === 'spline' ? 'rf-edge-spline' :
    '';
  const decoratedEdges = useMemo(
    () =>
      displayEdges.map((e) => ({
        ...e,
        animated: edgesLive,
        className: [
          portEdgeClass(e.targetHandle),
          e.id === insertableEdgeId ? 'rf-edge-insert-target' : '',
        ].filter(Boolean).join(' ') || undefined,
      })),
    [displayEdges, edgesLive, insertableEdgeId],
  );

  const toggleCat = (label: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Tabs: Sub-graph (slot édité) vs Global (post-processing) */}
      <div className="h-8 border-b border-stagespace-border flex items-center px-2 gap-1 flex-shrink-0 bg-stagespace-panel">
        <button
          onClick={() => setActiveTab('sub')}
          className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${
            activeTab === 'sub' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
          title="Move graph — trajectory for the slot being edited"
        >
          Move graph
        </button>
        {activeTab === 'sub' && editingSlotName && (
          <span className="text-gray-400 text-xs truncate max-w-[120px]">
            › {editingSlotName}
          </span>
        )}
        <button
          onClick={() => setActiveTab('global')}
          className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${
            activeTab === 'global' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
          title="Global FX — post-processing graph applied to ALL live moves"
        >
          Global FX
        </button>
        {activeTab === 'global' && (
          <>
            <div className="flex-1" />
            <button
              onClick={() => resetToDefault()}
              className="px-2 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
              title="Reset to the default global graph"
            >
              ↺ Reset
            </button>
            <button
              onClick={() => pushGlobalGraph()}
              className="px-2 py-0.5 text-xs bg-cyan-800 hover:bg-cyan-700 text-cyan-200 rounded"
              title="Compile and push to the backend"
            >
              ↑ Push
            </button>
          </>
        )}
        <button
          onClick={() => setActiveTab('signal')}
          className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${
            activeTab === 'signal' ? 'bg-amber-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
          title="Modulation — signal graph modulating macros with additive deltas (LFO, audio, OSC…)"
        >
          Modulation
        </button>
        {activeTab === 'signal' && (
          <>
            <div className="flex-1" />
            <button
              onClick={() => resetSignalToDefault()}
              className="px-2 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
              title="Reset to the default signal graph"
            >
              ↺ Reset
            </button>
            <button
              onClick={() => pushSignalGraph()}
              className="px-2 py-0.5 text-xs bg-amber-800 hover:bg-amber-700 text-amber-200 rounded"
              title="Compile and push to the backend"
            >
              ↑ Push
            </button>
          </>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
      {/* Node Palette — repliable en rail : QuickAdd (Ctrl+K / double-clic)
          couvre l'ajout rapide ; la palette sert surtout à la découverte.
          Repliée, le canvas récupère ~220px en split expert. */}
      <NodePalette
        collapsed={paletteCollapsed}
        onToggleCollapsed={setPaletteCollapsed}
        onQuickAdd={insert.openQuickAdd}
        edgeSelected={!!insert.selectedEdge}
        activeTab={activeTab}
        collapsedCats={collapsedCats}
        onToggleCat={toggleCat}
        hovered={hoveredPaletteNode}
        onHover={setHoveredPaletteNode}
        onAddNode={insert.addNodeByType}
        onAddPluginNode={insert.addPluginNode}
        onAddFrame={insert.addFrame}
        plugins={plugins}
        pluginsLoaded={pluginsLoaded}
        pluginsDir={pluginsDir}
        pluginErrors={pluginErrors}
        importPlugin={importPlugin}
        reloadPlugins={reloadPlugins}
      />

      {/* Canvas */}
      <GraphCanvas
        nodes={decoratedNodes}
        edges={decoratedEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={
          activeTab === 'global' ? globalGraph.onEdgesChange
            : activeTab === 'signal' ? signalGraph.onEdgesChange
            : onEdgesChange
        }
        onConnect={
          activeTab === 'global' ? globalGraph.onConnect
            : activeTab === 'signal' ? signalGraph.onConnect
            : handleConnect
        }
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onInit={(inst) => { rfInstance.current = inst; }}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaletteDrop={insert.onPaletteDrop}
        onPaletteDragOver={insert.onPaletteDragOver}
        onCutEdge={(id) => removeByIds(new Set(), new Set([id]))}
        onNodeContextMenu={onNodeContextMenu}
        onDismissNodeMenu={() => setNodeMenu(null)}
        onPaneDoubleClick={onPaneDoubleClick}
        isValidConnection={checkValidConnection}
        nodeTypes={nodeTypes}
        contextKey={`${activeTab}:${editingSlotId ?? 'global'}`}
        displayNodes={displayNodes}
        emptyHint={
          activeTab === 'global'
            ? 'Click nodes in the palette — Start with: Input → Scale → Rotate → Offset → Output'
            : activeTab === 'signal'
              ? 'Click nodes in the palette — Start with: SignalLfo → SignalMap → SignalOut'
              : 'Click nodes in the palette — Start with: Objects → Duration → Circular → Output'
        }
        graphIssues={graphIssues}
        issuesOpen={issuesOpen}
        onToggleIssues={() => setIssuesOpen((o) => !o)}
      >
        {insert.quickAddOpen && (
          <QuickAddModal
            types={insert.allowedTypes}
            plugins={insert.quickAddPlugins}
            onAddType={insert.addNodeByType}
            onAddPlugin={insert.addPluginNode}
            contextHint={insert.quickAddHint}
            onClose={insert.closeQuickAdd}
          />
        )}

        {/* Menu clic-droit — exemples runnables utilisant ce type de node.
            Sub-graph only : les presets construisent des graphes de slot. */}
        {nodeMenu && (
          <div
            className="fixed z-menu w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
            style={{ left: nodeMenu.x, top: nodeMenu.y }}
          >
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800">
              {nodeMenu.nodeType} — runnable examples
            </div>
            {activeTab !== 'sub' ? (
              <div className="px-3 py-2 text-xs text-gray-500">
                Examples load into a move graph — switch to the Move graph tab first.
              </div>
            ) : presetsUsingType(nodeMenu.nodeType).length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500">
                No runnable example uses {nodeMenu.nodeType} yet.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {presetsUsingType(nodeMenu.nodeType).slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openExampleFor(nodeMenu.nodeType, p.id, p.name)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-cyan-900/40 hover:text-white transition-colors"
                    title={p.description}
                  >
                    {p.icon} {p.name}
                  </button>
                ))}
                <div className="px-3 py-1.5 text-[11px] text-gray-400 border-t border-gray-800">
                  Loads into the edited slot — Ctrl+Z to undo.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Connecting hint badge */}
        {connectingFrom && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-popover px-3 py-1.5 bg-blue-900/80 border border-blue-600 rounded-lg text-blue-200 text-xs font-medium pointer-events-none">
            Connecting from <span className="text-white font-bold">{connectingFrom.type}</span> — drag to a valid target or drop on the canvas to quick-add
          </div>
        )}
      </GraphCanvas>
      </div>
    </div>
  );
};

export default NodeEditor;
