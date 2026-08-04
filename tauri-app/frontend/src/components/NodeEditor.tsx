import React, { useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  type Node,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnConnectStartParams,
  type OnConnectEndParams,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphStore, NodeType } from '../store/useGraphStore';
import CustomNode from './CustomNode';
import { NODE_CATEGORIES, NODE_COLORS, NODE_DESCRIPTIONS, getCategoryColor, getDefaultParams, getValidTargetTypes } from './nodeParamSchema';
import { isValidConnection } from '../utils/connectionRules';

const nodeTypes: NodeTypes = { custom: CustomNode };

const createNode = (type: NodeType, position: { x: number; y: number }): Node => ({
  id: `${type}-${Date.now()}`,
  type: 'custom',
  position,
  data: { label: type, type, params: getDefaultParams(type) },
});

export const NodeEditor: React.FC = () => {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const addNode = useGraphStore((s) => s.addNode);
  const [hoveredPaletteNode, setHoveredPaletteNode] = useState<NodeType | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<NodeType | null>(null);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const addNodeByType = useCallback(
    (type: NodeType) => {
      const offset = nodes.length * 30;
      addNode(createNode(type, { x: 250 + offset, y: 150 + offset }));
    },
    [addNode, nodes.length],
  );

  // Validation visuelle des connexions — empêche de connecter des nodes incompatibles
  // Tient compte des ports (input, input_a, input_b, duration, output)
  const checkValidConnection: IsValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      const fromType = (sourceNode.data as any)?.type as NodeType;
      const toType = (targetNode.data as any)?.type as NodeType;
      if (!fromType || !toType) return false;

      // Vérifier la compatibilité des types
      if (!isValidConnection(fromType, toType)) return false;

      // Vérifier la compatibilité des ports
      // Duration → port "duration" uniquement
      // Objects → port "input" uniquement
      // Autres → port "input", "input_a", ou "input_b"
      const targetPort = connection.targetHandle;
      if (fromType === 'Duration' && targetPort !== 'duration') return false;
      if (fromType === 'Objects' && targetPort !== 'input' && targetPort !== 'input_a' && targetPort !== 'input_b') return false;

      return true;
    },
    [nodes],
  );

  // Track le type du node source quand on commence une connexion
  const onConnectStart = useCallback((_: React.MouseEvent, params: OnConnectStartParams) => {
    const sourceNode = nodes.find((n) => n.id === params.nodeId);
    if (sourceNode) {
      const fromType = (sourceNode.data as any)?.type as NodeType;
      setConnectingFrom(fromType);
    }
  }, [nodes]);

  const onConnectEnd = useCallback((_: React.MouseEvent, _params: OnConnectEndParams) => {
    setConnectingFrom(null);
  }, []);

  // Détermine si un node du canvas est une cible valide (pour le highlight)
  const isValidTarget = useCallback((nodeType: NodeType): boolean => {
    if (!connectingFrom) return false;
    return isValidConnection(connectingFrom, nodeType);
  }, [connectingFrom]);

  const toggleCat = (label: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="w-full h-full flex">
      {/* Node Palette */}
      <div className="w-60 bg-stagespace-panel border-r border-stagespace-border overflow-y-auto flex-shrink-0">
        <div className="px-3 py-3 border-b border-stagespace-border sticky top-0 bg-stagespace-panel z-10">
          <h3 className="text-white font-semibold text-sm">Nodes</h3>
          <p className="text-gray-500 text-[11px] mt-0.5">Click to add · Hover for info</p>
        </div>

        <div className="p-2 space-y-2">
          {NODE_CATEGORIES.map((cat) => {
            const isCollapsed = collapsedCats.has(cat.label);
            return (
              <div key={cat.label}>
                <button
                  onClick={() => toggleCat(cat.label)}
                  className="w-full flex items-center gap-1 text-gray-500 text-[10px] font-semibold mb-1 px-1 uppercase tracking-wider hover:text-gray-300 transition-colors"
                >
                  <span className="text-[8px]">{isCollapsed ? '▸' : '▾'}</span>
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: NODE_COLORS[cat.color] ?? '#4b5563' }}
                  />
                  {cat.label}
                  <span className="text-gray-700 ml-auto">{cat.types.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {cat.types.map((type) => (
                      <div
                        key={type}
                        className="relative"
                        onMouseEnter={() => setHoveredPaletteNode(type)}
                        onMouseLeave={() => setHoveredPaletteNode(null)}
                      >
                        <button
                          onClick={() => addNodeByType(type)}
                          className="w-full text-left px-2.5 py-1.5 text-white text-xs rounded transition-all hover:translate-x-0.5 flex items-center gap-2 group"
                          style={{ background: 'transparent' }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = getCategoryColor(type) + '20';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: getCategoryColor(type) }}
                          />
                          {type}
                        </button>
                        {/* Tooltip description */}
                        {hoveredPaletteNode === type && NODE_DESCRIPTIONS[type] && (
                          <div className="absolute left-full top-0 ml-2 z-50 w-64 p-2.5 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-gray-300 text-[10px] leading-relaxed pointer-events-none">
                            <div className="text-white font-semibold text-[11px] mb-1" style={{ color: getCategoryColor(type) }}>{type}</div>
                            {NODE_DESCRIPTIONS[type]}
                            {/* Show valid targets */}
                            {(() => {
                              const targets = getValidTargetTypes(type);
                              if (targets.length === 0) return null;
                              return (
                                <div className="mt-1.5 pt-1.5 border-t border-gray-700">
                                  <div className="text-gray-500 text-[9px] uppercase">Can connect to:</div>
                                  <div className="text-gray-400 text-[9px] mt-0.5 flex flex-wrap gap-1">
                                    {targets.slice(0, 8).map((t) => (
                                      <span key={t} className="px-1 py-0.5 bg-gray-800 rounded">{t}</span>
                                    ))}
                                    {targets.length > 8 && <span className="text-gray-600">+{targets.length - 8}</span>}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Help footer */}
        <div className="p-3 border-t border-stagespace-border mt-2">
          <div className="text-gray-600 text-[9px] leading-relaxed space-y-1">
            <div><span className="text-gray-400 font-semibold">Flow:</span> Objects → Engine → Output</div>
            <div><span className="text-gray-400 font-semibold">Chain:</span> Engine → Modifier → Output</div>
            <div><span className="text-gray-400 font-semibold">Blend:</span> 2 Engines → Mix → Output</div>
            <div><span className="text-gray-400 font-semibold">Time:</span> 2 Engines → Sequence/Crossfade</div>
            <div className="pt-1 text-gray-700">Drag from a node's bottom handle to connect. Invalid connections are blocked.</div>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 bg-stagespace-bg relative">
        <ReactFlow
          nodes={nodes.map((n) => ({
            ...n,
            className: connectingFrom && !isValidTarget((n.data as any)?.type) ? 'rf-node-invalid-target' : '',
          }))}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={checkValidConnection}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={['Delete', 'Backspace']}
          className="!bg-stagespace-bg"
        >
          <Background color="#1e1e2e" gap={24} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => getCategoryColor((n.data as any)?.type ?? '')}
            maskColor="rgba(10,10,15,0.7)"
          />
        </ReactFlow>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-gray-600 text-sm mb-1">Empty graph</div>
              <div className="text-gray-700 text-xs">Click nodes in the palette to add them</div>
              <div className="text-gray-700 text-[10px] mt-2">Start with: Objects → Duration → Circular → Output</div>
            </div>
          </div>
        )}

        {/* Connecting hint badge */}
        {connectingFrom && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 bg-blue-900/80 border border-blue-600 rounded-lg text-blue-200 text-[11px] font-medium pointer-events-none">
            Connecting from <span className="text-white font-bold">{connectingFrom}</span> — drag to a valid target
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeEditor;
