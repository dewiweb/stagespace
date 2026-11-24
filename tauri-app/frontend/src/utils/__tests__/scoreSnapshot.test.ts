/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { snapshotScoreAt } from '../scoreSnapshot';
import { useScoreStore } from '../../store/useScoreStore';
import { useGraphStore, resetStore, makeSlot } from '../../store/__tests__/testHelpers';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import type { ChannelModulation } from '../../types/generated/ChannelModulation';
import type { Zone } from '../../types/generated/Zone';

// Re-capture arrangement→cue : l'évaluateur de la partition au curseur
// doit reproduire les sémantiques du scheduler (exclusivité de lanes,
// mute, dernier-porteur) — inverse exact du flatten.

const clip = (o: Partial<ScoreClipDoc>): ScoreClipDoc =>
  ({ id: 'c1', startMs: 0, ...o }) as ScoreClipDoc;

const ctx = () => ({ holProject: null, manualOscIds: useGraphStore.getState().manualOscIds });

describe('scoreSnapshot — arrangement → cue', () => {
  beforeEach(() => {
    resetStore();
    useScoreStore.getState().clearScore();
    useGraphStore.setState({
      moveSlots: [
        makeSlot({ id: 's1', trackIds: [1] }),
        makeSlot({ id: 's2', trackIds: [2] }),
      ],
    } as never);
  });

  it('un clip slot couvrant le curseur devient un MoveSnapshot', async () => {
    useScoreStore.setState({
      clips: [clip({ id: 'cA', ref: { type: 'slot', slotId: 's1' }, startMs: 1000, durationMs: 5000 })],
    } as never);
    const { request } = await snapshotScoreAt(3000, ctx());
    expect(request.moves).toHaveLength(1);
    expect(request.moves[0].id).toBe('sc-cA');
    expect(request.moves[0].name).toBe('Test Move');
    expect(request.moves[0].osc_ids).toEqual([1]);
    expect(request.moves[0].track_indices).toEqual([0]); // track 1 → obj 0
    expect(request.track_indices).toEqual([0]);
  });

  it('un clip hors fenêtre ne produit pas de move', async () => {
    useScoreStore.setState({
      clips: [clip({ id: 'cA', ref: { type: 'slot', slotId: 's1' }, startMs: 0, durationMs: 1000 })],
    } as never);
    const { request } = await snapshotScoreAt(5000, ctx());
    expect(request.moves).toHaveLength(0);
  });

  it('lane exclusive : le clip le plus tardif tue le move du précédent', async () => {
    useScoreStore.setState({
      clips: [
        clip({ id: 'cA', ref: { type: 'slot', slotId: 's1' }, startMs: 0 }),
        clip({ id: 'cB', ref: { type: 'slot', slotId: 's1' }, startMs: 2000 }),
      ],
    } as never);
    const { request } = await snapshotScoreAt(3000, ctx());
    expect(request.moves.map((m) => m.id)).toEqual(['sc-cB']);
  });

  it('lane stacked : les deux clips coexistent', async () => {
    useScoreStore.setState({
      clips: [
        clip({ id: 'cA', ref: { type: 'slot', slotId: 's1' }, startMs: 0 }),
        clip({ id: 'cB', ref: { type: 'slot', slotId: 's1' }, startMs: 2000 }),
      ],
      laneStates: { 'obj-1': { mode: 'stacked' } },
    } as never);
    const { request } = await snapshotScoreAt(3000, ctx());
    expect(request.moves.map((m) => m.id)).toEqual(['sc-cA', 'sc-cB']);
  });

  it('lane mutée : le clip ne spawn rien', async () => {
    useScoreStore.setState({
      clips: [clip({ id: 'cA', ref: { type: 'slot', slotId: 's1' }, startMs: 0 })],
      laneStates: { 'obj-1': { muted: true } },
    } as never);
    const { request } = await snapshotScoreAt(3000, ctx());
    expect(request.moves).toHaveLength(0);
  });

  it('clip slot orphelin → report skipped honnête', async () => {
    useScoreStore.setState({
      clips: [clip({ id: 'cA', ref: { type: 'slot', slotId: 'gone' }, startMs: 0 })],
    } as never);
    const { request, skipped } = await snapshotScoreAt(1000, ctx());
    expect(request.moves).toHaveLength(0);
    expect(skipped.some((s) => s.includes('orphelin'))).toBe(true);
  });

  it('clip positions → manual_positions (track_id → obj_index)', async () => {
    useScoreStore.setState({
      clips: [clip({ id: 'cA', ref: { type: 'positions', positions: { 2: [1, 2, 3] } }, startMs: 500 })],
    } as never);
    const { request } = await snapshotScoreAt(2000, ctx());
    expect(request.manual_positions).toEqual({ 1: [1, 2, 3] });
  });

  it('courbes pos.* écrasent les positions au curseur', async () => {
    useScoreStore.setState({
      clips: [clip({ id: 'cA', ref: { type: 'positions', positions: { 1: [9, 9, 9] } }, startMs: 0 })],
      objectCurves: { 'obj-1': { 'pos.x': [{ t: 0, v: 0 }, { t: 4000, v: 8 }] } },
    } as never);
    const { request } = await snapshotScoreAt(2000, ctx());
    expect(request.manual_positions[0]).toEqual([4, 9, 9]);
  });

  it('courbe depth → per_track_depths dense (trous à 1.0)', async () => {
    useScoreStore.setState({
      objectCurves: { 'obj-3': { depth: [{ t: 0, v: 0.7 }] } },
    } as never);
    const { request } = await snapshotScoreAt(1000, ctx());
    expect(request.per_track_depths).toEqual([1.0, 1.0, 0.7]);
  });

  it('zones clip + courbe zone:i:falloff → table patchée', async () => {
    const zone = {
      shape: { kind: 'sphere', center: [0, 0, 0], radius: 2 },
      falloff: 0.5, enabled: true, channels: {}, effect: null,
    } as unknown as Zone;
    useScoreStore.setState({
      clips: [clip({ id: 'cZ', ref: { type: 'zones', zones: [zone] }, startMs: 0 })],
      spatialFxCurves: { 'zone:0:falloff': [{ t: 0, v: 3 }] },
    } as never);
    const { request } = await snapshotScoreAt(2000, ctx());
    expect(request.zones).toHaveLength(1);
    expect(request.zones![0].falloff).toBe(3);
  });

  it('chanMods clip + courbe mod:…:scale → règle patchée', async () => {
    const rule: ChannelModulation = {
      object: null, source: 'Speed', channel: 'Spread',
      scale: 1, offset: 0, min: null, max: null, listener: [0, 0, 0],
    };
    useScoreStore.setState({
      clips: [clip({ id: 'cM', ref: { type: 'chanMods', modulations: [rule] }, startMs: 0 })],
      spatialFxCurves: { 'mod:speed>spread:scale': [{ t: 0, v: 2.5 }] },
    } as never);
    const { request } = await snapshotScoreAt(1000, ctx());
    expect(request.channel_modulations![0].scale).toBe(2.5);
  });

  it('courbes GLOBALFX → macros + spatial_macros', async () => {
    useScoreStore.setState({
      globalFxCurves: {
        scale: [{ t: 0, v: 1 }, { t: 2000, v: 3 }],
        radius_scale: [{ t: 0, v: 0.5 }],
      },
    } as never);
    const { request } = await snapshotScoreAt(1000, ctx());
    expect(request.macros!.scale).toBe(2);
    expect(request.spatial_macros).toEqual({ radius_scale: 0.5, height_offset: 0 });
  });

  it('macros de slot appliquées au lancement → base du snapshot', async () => {
    const s = makeSlot({ id: 's1', trackIds: [1] });
    s.macros = { ...s.macros, scale: 2, yaw: 45 };
    useGraphStore.setState({ moveSlots: [s] } as never);
    useScoreStore.setState({
      clips: [clip({ id: 'cA', ref: { type: 'slot', slotId: 's1' }, startMs: 0 })],
    } as never);
    const { request } = await snapshotScoreAt(1000, ctx());
    expect(request.macros!.scale).toBe(2);
    expect(request.macros!.yaw).toBe(45);
    expect(request.macros!.speed).toBe(1); // pas de champ speed dans SlotGlobalMacros
  });

  it('postGraph/modGraph → global_graph/signal_graph', async () => {
    const g = { nodes: [{ id: 'n' }], edges: [] };
    useScoreStore.setState({
      clips: [
        clip({ id: 'cP', ref: { type: 'postGraph', graph: g }, startMs: 100 }),
        clip({ id: 'cS', ref: { type: 'modGraph', graph: g }, startMs: 100 }),
      ],
    } as never);
    const { request } = await snapshotScoreAt(500, ctx());
    expect(request.global_graph).toBeTruthy();
    expect(request.signal_graph).toBeTruthy();
  });

  it('événements conductor → skipped (pas un état)', async () => {
    useScoreStore.setState({
      clips: [
        clip({ id: 'cG', ref: { type: 'gesture', name: 'explode', strength: 1 }, startMs: 0 }),
        clip({ id: 'cP', ref: { type: 'park' }, trackIds: [1], startMs: 500 }),
      ],
    } as never);
    const { request, skipped } = await snapshotScoreAt(2000, ctx());
    expect(request.moves).toHaveLength(0);
    expect(skipped.some((s) => s.includes('conductor'))).toBe(true);
  });

  it('repeat : itération couvrant le curseur → move snapshoté', async () => {
    useScoreStore.setState({
      clips: [clip({ id: 'cR', ref: { type: 'slot', slotId: 's1' }, startMs: 1000, durationMs: 4000, repeatEveryMs: 1000 })],
    } as never);
    // Fenêtre [1000,5000), tuiles à 1000/2000/3000/4000 — curseur 4500
    // est dans la tuile [4000,5000).
    const { request } = await snapshotScoreAt(4500, ctx());
    expect(request.moves.map((m) => m.id)).toEqual(['sc-cR']);
  });
});
