import { StateCreator } from 'zustand';
import { type Node } from 'reactflow';
import { simplifyPoints, computeCentroid } from '../utils/geometryUtils';
import { feLog } from '../../utils/tauri';

export interface DrawModeSlice {
  // Draw mode (freehand trajectory drawing)
  drawMode: boolean;
  setDrawMode: (enabled: boolean) => void;
  drawZ: number;
  setDrawZ: (z: number) => void;
  drawnPoints: Array<[number, number, number]>;
  addDrawnPoint: (p: [number, number, number]) => void;
  clearDrawnPoints: () => void;
  finalizeDrawing: () => Promise<string | null>;
}

// finalizeDrawing accède à nodes, edges, isPlaying, updateGraphLive, holProject, manualOscIds via get()
type DrawModeStore = DrawModeSlice & {
  nodes: Node[];
  edges: any[];
  isPlaying: boolean;
  updateGraphLive: (fadeDuration?: number) => Promise<void>;
  holProject: any;
  manualOscIds: number[];
  selectedTrackIds: Set<number>;
};

export const createDrawModeSlice: StateCreator<DrawModeStore, [], [], DrawModeSlice> = (set, get) => ({
  // Draw mode
  drawMode: false,
  setDrawMode: (enabled) => set({ drawMode: enabled }),
  drawZ: 0,
  setDrawZ: (z) => set({ drawZ: z }),
  drawnPoints: [],
  addDrawnPoint: (p) => set((s) => ({ drawnPoints: [...s.drawnPoints, p] })),
  clearDrawnPoints: () => set({ drawnPoints: [] }),

  finalizeDrawing: async () => {
    const { drawnPoints, nodes, holProject, manualOscIds, selectedTrackIds } = get();
    feLog(`[DBG-finalize] drawnPoints=${drawnPoints.length} nodes=${nodes.length} types=${nodes.map((n) => (n.data as any)?.type).join(',')}`);
    if (drawnPoints.length < 3) {
      feLog(`[DBG-finalize] ABORT: not enough points (${drawnPoints.length})`);
      return null;
    }

    // Douglas-Peucker simplification
    const simplified = simplifyPoints(drawnPoints, 0.02);
    feLog(`[DBG-finalize] simplified=${simplified.length} pts, first=${JSON.stringify(simplified[0])}, last=${JSON.stringify(simplified[simplified.length - 1])}`);

    // Calculer l'origin (isobarycentre des tracks sélectionnées)
    const trackIndices: number[] = [];
    const trackIds = Array.from(selectedTrackIds);
    if (holProject) {
      trackIds.forEach((tid) => {
        const idx = holProject.tracks.findIndex((t: any) => t.id === tid);
        if (idx >= 0) trackIndices.push(idx);
      });
    } else {
      trackIds.forEach((tid) => {
        const idx = manualOscIds.indexOf(tid);
        trackIndices.push(idx >= 0 ? idx : tid - 1);
      });
    }
    const origin = computeCentroid(holProject, trackIndices, manualOscIds);
    feLog(`[DBG-finalize] origin=${JSON.stringify(origin)} trackIds=${trackIds.join(',')} trackIndices=${trackIndices.join(',')}`);

    // Soustraire l'origin pour rendre les points relatifs
    const relativePoints = simplified.map((p) => [
      p[0] - origin[0],
      p[1] - origin[1],
      p[2] - origin[2],
    ] as [number, number, number]);
    const pointsJson = JSON.stringify(relativePoints);
    feLog(`[DBG-finalize] pointsJson=${pointsJson.slice(0, 200)}...`);

    // Chercher les nodes cibles : DrawSpline (trajectoire) et/ou
    // VectorField field="drawn" (lignes de flux → vecteurs tangents)
    const drawSplineNode = nodes.find((n) => (n.data as any)?.type === 'DrawSpline');
    const vectorFieldNode = nodes.find(
      (n) => (n.data as any)?.type === 'VectorField' && (n.data as any)?.params?.field === 'drawn'
    );
    feLog(`[DBG-finalize] drawSplineNode=${drawSplineNode?.id ?? 'NOT FOUND'} vectorFieldNode=${vectorFieldNode?.id ?? 'NOT FOUND'}`);

    if (!drawSplineNode && !vectorFieldNode) {
      feLog(`[DBG-finalize] ABORT: no DrawSpline or drawn VectorField node found`);
      set({ drawMode: false });
      return null;
    }

    // Stroke → vecteurs tangents [x, y, vx, vy] (direction unitaire dans le
    // plan x,y — la magnitude est portée par le param strength du champ)
    let vectorsSpec: string | null = null;
    if (vectorFieldNode) {
      const vectors = relativePoints.map((p, i) => {
        const prev = relativePoints[Math.max(0, i - 1)];
        const next = relativePoints[Math.min(relativePoints.length - 1, i + 1)];
        const tx = next[0] - prev[0];
        const ty = next[1] - prev[1];
        const norm = Math.hypot(tx, ty) || 1;
        return [p[0], p[1], tx / norm, ty / norm];
      });
      const strokeSpec = vectors
        .map((v) => v.map((c) => +c.toFixed(3)).join(','))
        .join('; ');
      // Append : chaque stroke ajoute une ligne de flux au champ existant
      const existing = String((vectorFieldNode.data as any)?.params?.points ?? '').trim();
      vectorsSpec = existing ? `${existing}; ${strokeSpec}` : strokeSpec;
      feLog(`[DBG-finalize] vectorField vectors=${vectors.length}`);
    }

    // Mettre à jour les nodes cibles
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (drawSplineNode && n.id === drawSplineNode.id) {
          feLog(`[DBG-finalize] updating DrawSpline ${n.id} oldPoints=${((n.data as any)?.params?.points ?? '').slice(0, 80)}...`);
          return {
            ...n,
            data: {
              ...n.data,
              params: {
                ...(n.data as any).params,
                points: pointsJson,
              },
            },
          };
        }
        if (vectorFieldNode && n.id === vectorFieldNode.id && vectorsSpec !== null) {
          feLog(`[DBG-finalize] updating VectorField ${n.id}`);
          return {
            ...n,
            data: {
              ...n.data,
              params: {
                ...(n.data as any).params,
                points: vectorsSpec,
              },
            },
          };
        }
        return n;
      }),
      drawMode: false,
    }));

    // Synchroniser slot.graphJson avec les nodes mis à jour
    // (sinon selectSlotForEditing rechargera les vieux points)
    const editingSlotId = (get() as any).editingSlotId as string | null;
    if (editingSlotId) {
      const { nodes: updatedNodes, edges: updatedEdges } = get();
      const moveSlots = (get() as any).moveSlots as any[] | undefined;
      if (moveSlots) {
        const newSlots = moveSlots.map((sl: any) =>
          sl.id === editingSlotId
            ? { ...sl, graphJson: { nodes: [...updatedNodes], edges: [...updatedEdges] } }
            : sl
        );
        set({ moveSlots: newSlots } as any);
        feLog(`[DBG-finalize] synced slot.graphJson for editingSlotId=${editingSlotId}`);
      }
    }

    // Si en lecture, hot-swap
    const { isPlaying } = get();
    feLog(`[DBG-finalize] isPlaying=${isPlaying}`);
    if (isPlaying) {
      get().updateGraphLive(0.5);
    }

    return drawSplineNode?.id ?? vectorFieldNode?.id ?? null;
  },
});
