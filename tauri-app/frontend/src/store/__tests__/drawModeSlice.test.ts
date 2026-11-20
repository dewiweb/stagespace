/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, resetStore } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('setDrawMode', () => {
  it('enables draw mode', () => {
    useGraphStore.getState().setDrawMode(true);
    expect((useGraphStore.getState() as any).drawMode).toBe(true);
  });

  it('disables draw mode', () => {
    useGraphStore.setState({ drawMode: true } as any);
    useGraphStore.getState().setDrawMode(false);
    expect((useGraphStore.getState() as any).drawMode).toBe(false);
  });
});

describe('setDrawZ', () => {
  it('sets the Z height for drawing', () => {
    useGraphStore.getState().setDrawZ(5.5);
    expect((useGraphStore.getState() as any).drawZ).toBe(5.5);
  });
});

describe('addDrawnPoint', () => {
  it('adds a point to the drawn points array', () => {
    useGraphStore.getState().addDrawnPoint([1, 2, 3]);
    expect((useGraphStore.getState() as any).drawnPoints).toEqual([[1, 2, 3]]);
  });

  it('appends points', () => {
    useGraphStore.setState({ drawnPoints: [[1, 2, 3]] } as any);
    useGraphStore.getState().addDrawnPoint([4, 5, 6]);
    expect((useGraphStore.getState() as any).drawnPoints).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
});

describe('clearDrawnPoints', () => {
  it('clears all drawn points', () => {
    useGraphStore.setState({ drawnPoints: [[1, 2, 3], [4, 5, 6]] } as any);
    useGraphStore.getState().clearDrawnPoints();
    expect((useGraphStore.getState() as any).drawnPoints).toEqual([]);
  });
});

describe('finalizeDrawing', () => {
  it('returns null when less than 3 points', async () => {
    useGraphStore.setState({ drawnPoints: [[1, 2, 3]] } as any);
    const result = await useGraphStore.getState().finalizeDrawing();
    expect(result).toBeNull();
  });

  it('returns null when exactly 2 points', async () => {
    useGraphStore.setState({ drawnPoints: [[0, 0, 0], [1, 1, 0]] } as any);
    const result = await useGraphStore.getState().finalizeDrawing();
    expect(result).toBeNull();
  });

  it('updates existing DrawSpline node with drawn points', async () => {
    // Préparer un graphe avec un node DrawSpline existant
    const drawSplineId = 'draw-spline-test';
    useGraphStore.setState({
      drawnPoints: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0]],
      nodes: [
        { id: drawSplineId, type: 'custom', position: { x: 0, y: 0 }, data: { type: 'DrawSpline', params: { points: '[[0,0,0]]' } } },
      ],
      edges: [],
    } as any);

    const result = await useGraphStore.getState().finalizeDrawing();

    expect(result).toBe(drawSplineId);

    const nodes = useGraphStore.getState().nodes;
    const drawSplineNode = nodes.find((n: any) => n.data.type === 'DrawSpline');
    expect(drawSplineNode).toBeDefined();
    // Les points doivent avoir été mis à jour
    const points = (drawSplineNode!.data as any).params.points;
    expect(points).toBeDefined();
    const parsed = JSON.parse(points);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
  });

  it('returns null when no DrawSpline node exists', async () => {
    useGraphStore.setState({
      drawnPoints: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      nodes: [],
      edges: [],
    } as any);

    const result = await useGraphStore.getState().finalizeDrawing();
    expect(result).toBeNull();
  });

  it('disables drawMode after finalization', async () => {
    const drawSplineId = 'draw-spline-test2';
    useGraphStore.setState({
      drawnPoints: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      drawMode: true,
      nodes: [
        { id: drawSplineId, type: 'custom', position: { x: 0, y: 0 }, data: { type: 'DrawSpline', params: { points: '[[0,0,0]]' } } },
      ],
      edges: [],
    } as any);

    await useGraphStore.getState().finalizeDrawing();

    expect((useGraphStore.getState() as any).drawMode).toBe(false);
  });
});

describe('loadFromNode', () => {
  const mkNode = (id: string, pts: string, closed = false) => ({
    id, type: 'custom', position: { x: 0, y: 0 },
    data: { type: 'DrawSpline', label: id, params: { points: pts, closed } },
  });

  it('loads points+closed into controlPoints and records the node id', () => {
    useGraphStore.setState({ nodes: [mkNode('sp1', '[[0,0,0],[1,0,0],[0,1,0]]', true)] } as any);
    const id = useGraphStore.getState().loadFromNode();
    expect(id).toBe('sp1');
    const s = useGraphStore.getState();
    expect(s.controlPoints.length).toBe(3);
    expect(s.splineClosed).toBe(true);
    expect(s.loadedSplineNodeId).toBe('sp1');
    expect(s.splineTool).toBe('edit');
  });

  it('targets the requested node among several', () => {
    useGraphStore.setState({
      nodes: [mkNode('spA', '[[0,0,0],[1,0,0],[0,1,0]]'), mkNode('spB', '[[9,9,9],[8,0,0],[0,8,0]]')],
    } as any);
    const id = useGraphStore.getState().loadFromNode('spB');
    expect(id).toBe('spB');
    const s = useGraphStore.getState();
    expect(s.loadedSplineNodeId).toBe('spB');
    // Origine = (0,0,0) en l'absence de holProject → les points restent tels quels.
    expect(s.controlPoints[0]).toEqual([9, 9, 9]);
  });
});

describe('spline draft lifecycle', () => {
  const mkNode = (id: string) => ({
    id, type: 'custom', position: { x: 0, y: 0 },
    data: { type: 'DrawSpline', params: { points: '[[0,0,0],[1,0,0],[0,1,0]]' } },
  });

  it('auto-loads the existing spline when entering draw mode', () => {
    useGraphStore.setState({ nodes: [mkNode('sp1')], controlPoints: [], drawnPoints: [] } as any);
    useGraphStore.getState().setDrawMode(true);
    const s = useGraphStore.getState();
    expect(s.drawMode).toBe(true);
    expect(s.controlPoints.length).toBe(3);
    expect(s.loadedSplineNodeId).toBe('sp1');
  });

  it('clears loadedSplineNodeId on draw mode exit', () => {
    useGraphStore.setState({ drawMode: true, loadedSplineNodeId: 'sp1', controlPoints: [[0,0,0],[1,0,0]] } as any);
    useGraphStore.getState().setDrawMode(false);
    const s = useGraphStore.getState();
    expect(s.loadedSplineNodeId).toBeNull();
    expect(s.controlPoints).toEqual([]);
  });

  it('finalize writes to the loaded node, not the first DrawSpline', async () => {
    useGraphStore.setState({
      controlPoints: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
      loadedSplineNodeId: 'spB',
      drawMode: true,
      nodes: [
        { id: 'spA', type: 'custom', position: { x: 0, y: 0 }, data: { type: 'DrawSpline', params: { points: '[[1,1,1]]' } } },
        { id: 'spB', type: 'custom', position: { x: 0, y: 0 }, data: { type: 'DrawSpline', params: { points: '[[2,2,2]]' } } },
      ],
      edges: [],
    } as any);

    const result = await useGraphStore.getState().finalizeDrawing();
    expect(result).toBe('spB');
    const spA = useGraphStore.getState().nodes.find((n) => n.id === 'spA');
    const spB = useGraphStore.getState().nodes.find((n) => n.id === 'spB');
    expect((spA!.data as any).params.points).toBe('[[1,1,1]]');
    expect(JSON.parse((spB!.data as any).params.points).length).toBe(3);
  });
});
