import { StateCreator } from 'zustand';
import { type Node, type Edge, MarkerType } from 'reactflow';
import { simplifyPoints } from '../utils/geometryUtils';

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

// finalizeDrawing accède à nodes, edges, addNode, isPlaying, updateGraphLive via get()
type DrawModeStore = DrawModeSlice & {
  nodes: Node[];
  edges: Edge[];
  addNode: (node: Node) => void;
  isPlaying: boolean;
  updateGraphLive: (fadeDuration?: number) => Promise<void>;
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
    const { drawnPoints, nodes, addNode } = get();
    if (drawnPoints.length < 3) return null;

    // Douglas-Peucker simplification
    const simplified = simplifyPoints(drawnPoints, 0.02);

    // Créer un node DrawSpline avec les points
    const nodeId = `drawspline-${Date.now()}`;
    const drawSplineNode: Node = {
      id: nodeId,
      type: 'custom',
      position: { x: 300, y: 200 },
      data: {
        label: 'DrawSpline',
        type: 'DrawSpline',
        params: {
          n_objects: 9,
          points: JSON.stringify(simplified.map((p) => [p[0], p[1], p[2]])),
          closed: false,
          tension: 0.5,
          speed: 1.0,
          phase_offset: true,
        },
      },
    };
    addNode(drawSplineNode);

    // Créer aussi un node Output et connecter le DrawSpline → Output
    const outputId = `output-${Date.now()}`;
    const outputNode: Node = {
      id: outputId,
      type: 'custom',
      position: { x: 550, y: 200 },
      data: { label: 'Output', type: 'Output', params: {} },
    };
    addNode(outputNode);

    // Ajouter l'edge DrawSpline → Output
    const { edges } = get();
    set({
      edges: [...edges, {
        id: `e-${nodeId}-${outputId}`,
        source: nodeId,
        target: outputId,
        sourceHandle: 'output',
        targetHandle: 'input',
        markerEnd: { type: MarkerType.ArrowClosed },
      }],
      drawnPoints: [],
      drawMode: false,
    });

    // Si en lecture, hot-swap
    const { isPlaying } = get();
    if (isPlaying) {
      get().updateGraphLive(0.5);
    }

    return nodeId;
  },
});
