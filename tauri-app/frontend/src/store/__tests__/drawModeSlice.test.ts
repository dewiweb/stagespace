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
    const drawSplineNode = nodes.find((n: any) => (n.data as any)?.type === 'DrawSpline');
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
