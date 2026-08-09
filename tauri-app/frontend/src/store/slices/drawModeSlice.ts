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

    // Chercher le node DrawSpline dans le graphe courant
    // C'est le seul node à mettre à jour — EvaluateSpline lit les points
    // depuis DrawSpline via la connexion (resolve_spline_points dans le compiler)
    const drawSplineNode = nodes.find((n) => (n.data as any)?.type === 'DrawSpline');
    feLog(`[DBG-finalize] drawSplineNode=${drawSplineNode?.id ?? 'NOT FOUND'}`);

    if (!drawSplineNode) {
      feLog(`[DBG-finalize] ABORT: no DrawSpline node found`);
      set({ drawMode: false });
      return null;
    }

    // Mettre à jour uniquement le node DrawSpline avec les points dessinés
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id === drawSplineNode.id) {
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

    return drawSplineNode.id;
  },
});
