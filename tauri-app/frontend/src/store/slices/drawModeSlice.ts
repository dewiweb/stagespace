import { StateCreator } from 'zustand';
import type { GraphNode } from '../../components/nodeParamSchema';
import { simplifyPoints, computeCentroid } from '../utils/geometryUtils';
import { feLog } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { computeTrackIndices, saveSlotsToStorage, type MoveSlot } from './moveSlotsSlice';
import { fitStroke, strokeLooksClosed, type Vec3, type DrawView } from '../../utils/splineCore';

export type SplineTool = 'freehand' | 'place' | 'edit';
export type { DrawView };

const CP_HISTORY_MAX = 32;

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

  // ── Spline studio — couche édition au-dessus du freehand ──
  // Outil actif dans le draw mode : freehand (stroke→fit→edit auto),
  // place (clic = ajout de CP), edit (drag/suppr/insert sur CPs).
  splineTool: SplineTool;
  setSplineTool: (tool: SplineTool) => void;
  // Vue gizmo fixée — top/front/side = plan de dessin + caméra snappée,
  // free = caméra libre sur plan top (legacy).
  drawView: DrawView;
  setDrawView: (v: DrawView) => void;
  // Points de contrôle éditables — ce que Done écrira dans le node.
  controlPoints: Vec3[];
  splineClosed: boolean;
  setSplineClosed: (closed: boolean) => void;
  smoothing: number; // 0..1 — intensité du fit stroke→CPs
  setSmoothing: (v: number) => void;
  // Historique undo — snapshot {cps, closed} par action mutatrice.
  cpHistory: Array<{ cps: Vec3[]; closed: boolean }>;
  cpUndo: () => void;
  // Stroke freehand → CPs fittés (push history) + bascule en mode edit.
  commitStroke: () => void;
  // Remplace les CPs avec snapshot undo (drag, delete, insert, primitive).
  // recordHistory=false pour les mises à jour continues (drag move).
  setControlPoints: (cps: Vec3[], recordHistory?: boolean) => void;
  // Snapshot undo sans toucher aux CPs — à appeler au début d'un drag.
  pushCpSnapshot: () => void;
  // Charge un jeu de CPs primitif (history + sélection aucune).
  // Les CPs sont recentrés sur l'origine des tracks sélectionnées —
  // même ancre que finalizeDrawing (les formes naissent là où sont les objets).
  loadPrimitive: (cps: Vec3[], closed: boolean) => void;
  // Recharge le premier node DrawSpline (points+closed) dans l'éditeur :
  // les points stockés sont relatifs à l'origine → on les remet en absolu
  // (finalize les re-soustraira) — idempotent si l'origine n'a pas bougé.
  loadFromNode: () => string | null;
  clearSpline: () => void;
}

// finalizeDrawing accède à nodes, edges, isPlaying, updateGraphLive, holProject, manualOscIds via get()
type DrawModeStore = DrawModeSlice & {
  nodes: GraphNode[];
  edges: any[];
  updateGraphLive: (fadeDuration?: number) => Promise<void>;
  holProject: any;
  manualOscIds: number[];
  selectedTrackIds: Set<number>;
  // Dépendances move-slots — sync du graphJson du slot édité après
  // finalize (sinon selectSlotForEditing recharge les vieux points).
  editingSlotId: string | null;
  moveSlots: MoveSlot[];
  // Champs interaction (interactionModesSlice) — setDrawMode les purge.
  manipulateMode: boolean;
  assignMode: boolean;
  zonePlaceMode: boolean;
  zoneEditMode: boolean;
};

export const createDrawModeSlice: StateCreator<DrawModeStore, [], [], DrawModeSlice> = (set, get) => ({
  // Draw mode — setter exclusif : entrer en draw purge les autres modes
  // d'interaction (sinon une couche assign/manipulate couvre le canvas draw).
  drawMode: false,
  setDrawMode: (enabled) =>
    set(enabled
      ? { drawMode: true, manipulateMode: false, assignMode: false, zonePlaceMode: false, zoneEditMode: false }
      // Quitter le mode abandonne le brouillon — Done a déjà persisté,
      // Cancel/Esc jettent les CPs (sinon ils ressurgissent à la ré-entrée).
      : { drawMode: false, drawnPoints: [], controlPoints: [], cpHistory: [], splineClosed: false, splineTool: 'freehand' as SplineTool, drawView: 'free' as DrawView }),
  drawZ: 0,
  setDrawZ: (z) => set({ drawZ: z }),
  drawnPoints: [],
  addDrawnPoint: (p) => set((s) => ({ drawnPoints: [...s.drawnPoints, p] })),
  clearDrawnPoints: () => set({ drawnPoints: [] }),

  // ── Spline studio ──
  splineTool: 'freehand' as SplineTool,
  setSplineTool: (tool) => set({ splineTool: tool }),
  drawView: 'free' as DrawView,
  setDrawView: (v) => set({ drawView: v }),
  controlPoints: [],
  splineClosed: false,
  setSplineClosed: (closed) =>
    set((s) => ({
      splineClosed: closed,
      cpHistory: [...s.cpHistory, { cps: s.controlPoints, closed: s.splineClosed }].slice(-CP_HISTORY_MAX),
    })),
  smoothing: 0.5,
  setSmoothing: (v) => set({ smoothing: Math.min(1, Math.max(0, v)) }),
  cpHistory: [] as Array<{ cps: Vec3[]; closed: boolean }>,
  cpUndo: () =>
    set((s) => {
      const prev = s.cpHistory[s.cpHistory.length - 1];
      if (!prev) return s;
      return {
        controlPoints: prev.cps,
        splineClosed: prev.closed,
        cpHistory: s.cpHistory.slice(0, -1),
      };
    }),
  commitStroke: () =>
    set((s) => {
      if (s.drawnPoints.length < 3) return s;
      const closed = strokeLooksClosed(s.drawnPoints);
      const cps = fitStroke(s.drawnPoints, { smoothing: s.smoothing, closed });
      return {
        controlPoints: cps,
        splineClosed: closed,
        cpHistory: [...s.cpHistory, { cps: s.controlPoints, closed: s.splineClosed }].slice(-CP_HISTORY_MAX),
        drawnPoints: [],
        splineTool: 'edit' as SplineTool,
      };
    }),
  pushCpSnapshot: () =>
    set((s) => ({
      cpHistory: [...s.cpHistory, { cps: s.controlPoints, closed: s.splineClosed }].slice(-CP_HISTORY_MAX),
    })),
  setControlPoints: (cps, recordHistory = true) =>
    set((s) => ({
      controlPoints: cps,
      cpHistory: recordHistory
        ? [...s.cpHistory, { cps: s.controlPoints, closed: s.splineClosed }].slice(-CP_HISTORY_MAX)
        : s.cpHistory,
    })),
  loadPrimitive: (cps, closed) =>
    set((s) => {
      const trackIds = Array.from(s.selectedTrackIds);
      const trackIndices = computeTrackIndices(trackIds, s.holProject, s.manualOscIds);
      const o = computeCentroid(s.holProject, trackIndices, s.manualOscIds);
      return {
        controlPoints: cps.map((p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]] as Vec3),
        splineClosed: closed,
        drawnPoints: [],
        cpHistory: [...s.cpHistory, { cps: s.controlPoints, closed: s.splineClosed }].slice(-CP_HISTORY_MAX),
        splineTool: 'edit' as SplineTool,
      };
    }),
  loadFromNode: () => {
    const s = get();
    const node = s.nodes.find((n) => n.data.type === 'DrawSpline');
    if (!node) return null;
    const raw = node.data.params?.points;
    let arr: unknown;
    try {
      arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
    if (!Array.isArray(arr)) return null;
    const rel = arr
      .filter((p): p is number[] => Array.isArray(p) && p.length >= 3)
      .map((p) => [+p[0], +p[1], +p[2]] as Vec3);
    if (rel.length < 2) return null;
    const trackIds = Array.from(s.selectedTrackIds);
    const trackIndices = computeTrackIndices(trackIds, s.holProject, s.manualOscIds);
    const o = computeCentroid(s.holProject, trackIndices, s.manualOscIds);
    const closed = node.data.params?.closed === true;
    set({
      controlPoints: rel.map((p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]] as Vec3),
      splineClosed: closed,
      drawnPoints: [],
      splineTool: 'edit' as SplineTool,
      cpHistory: [...s.cpHistory, { cps: s.controlPoints, closed: s.splineClosed }].slice(-CP_HISTORY_MAX),
    });
    return node.id;
  },
  clearSpline: () => set({ controlPoints: [], cpHistory: [], drawnPoints: [], splineClosed: false }),

  finalizeDrawing: async () => {
    const { drawnPoints, controlPoints, splineClosed, nodes, holProject, manualOscIds, selectedTrackIds } = get();
    feLog(`[DBG-finalize] drawnPoints=${drawnPoints.length} controlPoints=${controlPoints.length} closed=${splineClosed} nodes=${nodes.length} types=${nodes.map((n) => n.data.type).join(',')}`);

    // Source : CPs édités si présents (spline studio), sinon le stroke brut.
    const source = controlPoints.length >= 2 ? controlPoints : drawnPoints;
    if (source.length < 2) {
      feLog(`[DBG-finalize] ABORT: not enough points (${source.length})`);
      return null;
    }

    // Les CPs issus du studio sont déjà propres — pas de re-simplification.
    // Le fallback stroke brut garde la Douglas-Peucker historique.
    const simplified = controlPoints.length >= 2
      ? source
      : simplifyPoints(drawnPoints, 0.02);
    feLog(`[DBG-finalize] simplified=${simplified.length} pts, first=${JSON.stringify(simplified[0])}, last=${JSON.stringify(simplified[simplified.length - 1])}`);

    // Calculer l'origin (isobarycentre des tracks sélectionnées)
    const trackIds = Array.from(selectedTrackIds);
    const trackIndices = computeTrackIndices(trackIds, holProject, manualOscIds);
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
    const drawSplineNode = nodes.find((n) => n.data.type === 'DrawSpline');
    const vectorFieldNode = nodes.find(
      (n) => n.data.type === 'VectorField' && n.data.params?.field === 'drawn'
    );
    feLog(`[DBG-finalize] drawSplineNode=${drawSplineNode?.id ?? 'NOT FOUND'} vectorFieldNode=${vectorFieldNode?.id ?? 'NOT FOUND'}`);

    if (!drawSplineNode && !vectorFieldNode) {
      feLog(`[DBG-finalize] ABORT: no DrawSpline or drawn VectorField node found`);
      set({ drawMode: false, drawnPoints: [], controlPoints: [], cpHistory: [], splineClosed: false, splineTool: 'freehand' as SplineTool, drawView: 'free' as DrawView });
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
      const existing = String(vectorFieldNode.data.params?.points ?? '').trim();
      vectorsSpec = existing ? `${existing}; ${strokeSpec}` : strokeSpec;
      feLog(`[DBG-finalize] vectorField vectors=${vectors.length}`);
    }

    // Mettre à jour les nodes cibles
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (drawSplineNode && n.id === drawSplineNode.id) {
          feLog(`[DBG-finalize] updating DrawSpline ${n.id} oldPoints=${String(n.data.params?.points ?? '').slice(0, 80)}...`);
          return {
            ...n,
            data: {
              ...n.data,
              params: {
                ...n.data.params,
                points: pointsJson,
                // Honorés via EngineParams.extra côté Rust (parse_spline).
                closed: splineClosed,
                tension: 0.5,
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
                ...n.data.params,
                points: vectorsSpec,
              },
            },
          };
        }
        return n;
      }),
      drawMode: false,
      // Stroke persisté dans le node → vider les buffers pour éviter une
      // double écriture au prochain finalize (l'append VectorField relit
      // params.points existants).
      drawnPoints: [],
      controlPoints: [],
      cpHistory: [],
      splineClosed: false,
      splineTool: 'freehand' as SplineTool,
      drawView: 'free' as DrawView,
    }));

    // Synchroniser slot.graphJson avec les nodes mis à jour
    // (sinon selectSlotForEditing rechargera les vieux points)
    const editingSlotId = get().editingSlotId;
    if (editingSlotId) {
      const { nodes: updatedNodes, edges: updatedEdges } = get();
      const newSlots = get().moveSlots.map((sl) =>
        sl.id === editingSlotId
          ? { ...sl, graphJson: { nodes: [...updatedNodes], edges: [...updatedEdges] } }
          : sl
      );
      set({ moveSlots: newSlots } as Partial<DrawModeStore>);
      saveSlotsToStorage(newSlots); // persister — sinon le dessin est perdu au reload
      feLog(`[DBG-finalize] synced slot.graphJson for editingSlotId=${editingSlotId}`);
    }

    // Hot-swap inconditionnel : updateGraphLive self-guard (isPlaying /
    // movements actifs / slot en lecture) — ne pas le limiter à isPlaying,
    // sinon un dessin sur un slot move en lecture ne serait jamais poussé.
    get().updateGraphLive(0.5).catch((e) => {
      console.error('[finalizeDrawing] updateGraphLive failed:', e);
      // Le dessin est en store mais le runtime live ne l'a pas reçu — visible.
      toast.error(`Drawing hot-swap failed — running move may be stale: ${e}`);
    });

    return drawSplineNode?.id ?? vectorFieldNode?.id ?? null;
  },
});
