import { useCallback, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useGraphStore, type NodeType } from '../store/useGraphStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import { GLOBAL_ONLY_NODES, SUB_ONLY_NODES, SIGNAL_ONLY_NODES } from '../components/nodeParamSchema';
import {
  snapshotSelection, cloneForPaste, writeGraphClipboard, readGraphClipboard,
  type GraphClipboardPayload,
} from '../utils/graphClipboard';
import { toast } from '../utils/toast-helpers';

/// Clipboard de graphe (copy/cut/paste/duplicate) + suppression par ids,
/// factorisés hors de NodeEditor (modularisation). Le clipboard est
/// module-level (graphClipboard.ts) → le paste fonctionne entre tabs et
/// même entre éditeurs ; les nodes hors scope du domaine cible sont
/// filtrés à l'arrivée.
export function useGraphClipboard(opts: {
  activeTab: 'sub' | 'global' | 'signal';
  displayNodes: Node[];
  displayEdges: Edge[];
  /// Ctrl+K vit dans le même listener que les raccourcis clipboard.
  onQuickAdd: () => void;
}) {
  const { activeTab, displayNodes, displayEdges, onQuickAdd } = opts;

  /// Suppression par ids — le sub passe par onNodesChange/onEdgesChange
  /// (historique + autosave naturels), les standalone filtrent directement.
  const removeByIds = useCallback(
    (nodeIds: Set<string>, edgeIds: Set<string>) => {
      if (activeTab === 'global') {
        const st = useGlobalGraphStore.getState();
        st.setNodes(st.nodes.filter((n) => !nodeIds.has(n.id)));
        st.setEdges(st.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)));
      } else if (activeTab === 'signal') {
        const st = useSignalGraphStore.getState();
        st.setNodes(st.nodes.filter((n) => !nodeIds.has(n.id)));
        st.setEdges(st.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)));
      } else {
        const st = useGraphStore.getState();
        if (nodeIds.size > 0) {
          st.onNodesChange([...nodeIds].map((id) => ({ type: 'remove' as const, id })));
        }
        if (edgeIds.size > 0) {
          st.onEdgesChange([...edgeIds].map((id) => ({ type: 'remove' as const, id })));
        }
      }
    },
    [activeTab],
  );

  /// Collage dans le graphe actif — nodes désélectionnés au profit des
  /// nouveaux. Les nodes hors scope du domaine courant (Signal ≠
  /// Positions, global ≠ sub-only) sont filtrés — sinon le backend les
  /// rejetterait au prochain diagnose.
  const pastePayload = useCallback(
    (payload: GraphClipboardPayload) => {
      const clip = cloneForPaste(payload, Date.now());
      if (!clip) return;
      const inScope = (t: NodeType) =>
        activeTab === 'signal'
          ? SIGNAL_ONLY_NODES.has(t)
          : activeTab === 'global'
            ? !SUB_ONLY_NODES.has(t) && !SIGNAL_ONLY_NODES.has(t)
            : !GLOBAL_ONLY_NODES.has(t) && !SIGNAL_ONLY_NODES.has(t);
      const kept = clip.nodes.filter((n) => inScope(n.data.type as NodeType));
      const skipped = clip.nodes.length - kept.length;
      if (skipped > 0) {
        toast.warning(`${skipped} node${skipped > 1 ? 's' : ''} skipped — not valid in the ${activeTab === 'signal' ? 'Modulation' : activeTab === 'global' ? 'Global FX' : 'Move'} graph`);
      }
      const keptIds = new Set(kept.map((n) => n.id));
      const clipEdges = clip.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
      if (kept.length === 0) return;
      const deselect = <T extends { selected?: boolean }>(arr: T[]): T[] =>
        arr.map((x) => (x.selected ? { ...x, selected: false } : x));
      if (activeTab === 'global') {
        const st = useGlobalGraphStore.getState();
        st.setNodes([...deselect(st.nodes), ...kept]);
        st.setEdges([...st.edges, ...clipEdges]);
      } else if (activeTab === 'signal') {
        const st = useSignalGraphStore.getState();
        st.setNodes([...deselect(st.nodes), ...kept]);
        st.setEdges([...st.edges, ...clipEdges]);
      } else {
        const st = useGraphStore.getState();
        st.onNodesChange(
          st.nodes.filter((n) => n.selected).map((n) => ({ type: 'select' as const, id: n.id, selected: false })),
        );
        st.addNodesAndEdges(kept, clipEdges);
      }
    },
    [activeTab],
  );

  // Ctrl/Cmd+K quick-add + C/X/V/D clipboard — pas pendant la saisie
  // dans un champ.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable]')) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        onQuickAdd();
        return;
      }
      if (key === 'c' || key === 'x') {
        const snap = snapshotSelection(displayNodes, displayEdges);
        if (snap.nodes.length === 0) return;
        e.preventDefault();
        writeGraphClipboard(snap);
        if (key === 'x') {
          const ids = new Set(snap.nodes.map((n) => n.id));
          // Toutes les edges incidentes aux nodes retirés — pas seulement
          // les internes copiées — sinon edges pendantes dans le graphe.
          const incident = new Set(
            displayEdges.filter((e2) => ids.has(e2.source) || ids.has(e2.target)).map((e2) => e2.id),
          );
          removeByIds(ids, incident);
        }
        return;
      }
      if (key === 'v') {
        const clip = readGraphClipboard();
        if (!clip) return;
        e.preventDefault();
        pastePayload(clip);
        return;
      }
      if (key === 'd') {
        // Duplicate : copie la sélection et colle immédiatement, sans
        // écraser le clipboard.
        const snap = snapshotSelection(displayNodes, displayEdges);
        if (snap.nodes.length === 0) return;
        e.preventDefault();
        pastePayload(snap);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [displayNodes, displayEdges, removeByIds, pastePayload, onQuickAdd]);

  return { removeByIds, pastePayload };
}
