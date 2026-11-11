import React, { useState } from 'react';
import { NodeResizer, type NodeProps, type Node } from '@xyflow/react';
import { useGraphStore } from '../../store/useGraphStore';
import { useGlobalGraphStore } from '../../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../../store/useSignalGraphStore';

interface FrameData extends Record<string, unknown> {
  label?: string;
  type?: string;
}

/// Node « frame » — annotation + regroupement visuel (pattern patcher :
/// le cadre « ce bloc gère la respiration »). UI-only : sans handles,
/// jamais sérialisé vers le backend (utils/frameNode.ts filtre les
/// payloads — le NodeType Rust est un enum fermé).
///
/// Le corps a pointer-events-none : sélectionner/déplacer le cadre se
/// fait par son header ou ses bords, les clics à l'intérieur traversent
/// vers le pane (QuickAdd au double-clic, Alt+drag cut). Le header garde
/// les events pour le rename inline.
const FrameNode: React.FC<NodeProps<Node<FrameData>>> = ({ id, data, selected }) => {
  const isGlobalNode = useGlobalGraphStore((s) => s.nodes.some((n) => n.id === id));
  const isSignalNode = useSignalGraphStore((s) => s.nodes.some((n) => n.id === id));
  const [editing, setEditing] = useState(false);
  const label = data.label || 'Frame';

  const commit = (v: string) => {
    setEditing(false);
    const next = v.trim();
    if (!next || next === data.label) return;
    if (isGlobalNode) useGlobalGraphStore.getState().updateNodeData(id, { label: next });
    else if (isSignalNode) useSignalGraphStore.getState().updateNodeData(id, { label: next });
    else useGraphStore.getState().updateNodeData(id, { label: next });
  };

  return (
    <div
      className="w-full h-full rounded-md border-2 border-dashed pointer-events-none"
      style={{
        borderColor: selected ? 'rgba(251,191,36,0.7)' : 'rgba(251,191,36,0.25)',
        background: 'rgba(251,191,36,0.03)',
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={70}
        lineClassName="!border-amber-400/50"
        handleClassName="!bg-amber-400/70 !rounded-sm"
      />
      {editing ? (
        <input
          autoFocus
          defaultValue={label}
          className="nodrag pointer-events-auto m-1 px-1.5 py-0.5 rounded bg-gray-900 border border-amber-500/60 text-amber-200 text-xs font-semibold outline-none"
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <div
          className="pointer-events-auto inline-block px-2 py-1 text-amber-300/60 text-xs font-semibold select-none cursor-default"
          onDoubleClick={() => setEditing(true)}
          title="Frame — double-click to rename"
        >
          {label}
        </div>
      )}
    </div>
  );
};

export default FrameNode;
