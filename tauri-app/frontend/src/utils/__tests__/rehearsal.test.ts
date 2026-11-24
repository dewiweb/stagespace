/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { doRehearsal, doSlot } from '../liveActions';
import { recordingToScore } from '../recordingToScore';
import { rehearsalState } from '../liveActionsShared';
import { useScoreStore } from '../../store/useScoreStore';
import { useGraphStore, getInvokeCalls, clearInvokeCalls, resetStore } from '../../store/__tests__/testHelpers';

// Recorder → Score : la capture busking est matérialisée en clips/courbes
// de la timeline (refs vivantes — pas de tape parallèle). Le transport
// reste `score_timeline_*` (backend-owned, déterministe).
const slot = (id: string, oscIndex = 1) =>
  ({
    id, name: id, oscIndex, templateId: 'circle',
    graphJson: null, signalGraph: null, trackIds: [1],
    movementId: null, isPreview: false,
  }) as never;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('rehearsal — recorder → clips Score', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    rehearsalState.recording = false;
    rehearsalState.entries = [];
    useScoreStore.getState().clearScore();
    useGraphStore.setState({ moveSlots: [slot('s1', 1), slot('s2', 2)], manualOscIds: [1, 2] } as never);
  });

  it('stop matérialise la prise : un doSlot devient un clip slot', async () => {
    doRehearsal('record');
    doSlot(1);
    doRehearsal('stop');
    await settle(50);
    const clips = useScoreStore.getState().clips;
    expect(clips).toHaveLength(1);
    expect(clips[0].ref).toEqual({ type: 'slot', slotId: 's1' });
    // Pas de stop enregistré → clip refermé à la fin de la prise (1ms min).
    expect(clips[0].durationMs).toBeGreaterThan(0);
  });

  it('play délègue au transport timeline (playScore)', async () => {
    doRehearsal('record');
    doSlot(1);
    doRehearsal('stop');
    await settle(50);
    clearInvokeCalls();
    doRehearsal('play');
    await settle(80);
    const calls = getInvokeCalls().map((c) => c.cmd);
    expect(calls).toContain('score_timeline_load');
    expect(calls).toContain('score_timeline_play');
    expect(calls).not.toContain('score_play');
  });

  it('clear vide la partition score', () => {
    doRehearsal('record');
    doSlot(1);
    doRehearsal('stop');
    expect(useScoreStore.getState().clips.length).toBe(1);
    doRehearsal('clear');
    expect(useScoreStore.getState().clips.length).toBe(0);
  });
});

describe('recordingToScore — appariement et conversion', () => {
  beforeEach(() => {
    rehearsalState.recording = false;
  });

  it('slot joué puis stoppé → clip borné ; panic ferme les clips ouverts', () => {
    const take = recordingToScore([
      { t: 100, name: 'doSlot', args: [1], ref: { slotId: 's1' } },
      { t: 4000, name: 'doSlotStop', args: [1], ref: { slotId: 's1' } },
      { t: 5000, name: 'doSlot', args: [2], ref: { slotId: 's2' } },
      { t: 8000, name: 'doPanic', args: [] },
    ]);
    expect(take.clips).toHaveLength(3);
    expect(take.clips[0].durationMs).toBe(3900);
    expect(take.clips[1].durationMs).toBe(3000); // fermé par le panic
    expect(take.clips[2].ref.type).toBe('panic');
  });

  it('cue et gestes deviennent des clips typés ; positions → courbes pos.*', () => {
    const take = recordingToScore([
      { t: 0, name: 'doCueRecallById', args: [], ref: { cueId: 'c1' } },
      { t: 1000, name: 'doPark', args: [0], ref: { trackId: 3 } },
      { t: 1500, name: 'doSetPosition', args: [0, 1, 2, 3], ref: { positions: { 3: [1, 2, 3] } } },
      { t: 1600, name: 'doSetPosition', args: [0, 2, 2, 3], ref: { positions: { 3: [2, 2, 3] } } },
      { t: 2000, name: 'doGesture', args: [2.5], ref: { macro: 'explode', strength: 2.5 } },
    ]);
    expect(take.clips.map((c) => c.ref.type)).toEqual(['cue', 'park', 'gesture']);
    expect(take.clips[1].trackIds).toEqual([3]);
    // Le drag → trajectoire keyframée sur la lane obj-3.
    expect(take.objectCurves['obj-3']['pos.x']).toEqual([
      { t: 1500, v: 1, interp: 'linear' },
      { t: 1600, v: 2, interp: 'linear' },
    ]);
    expect(take.objectCurves['obj-3']['pos.z']).toEqual([
      { t: 1500, v: 3, interp: 'linear' },
      { t: 1600, v: 3, interp: 'linear' },
    ]);
  });

  it('macros → courbes globalfx ; spatial → courbe spatialfx ; inconnus → skipped', () => {
    const take = recordingToScore([
      { t: 0, name: 'doMacro', args: [1.5], ref: { macro: 'scale' } },
      { t: 500, name: 'doSpatial', args: [0.8], ref: { macro: 'spatial' } },
      { t: 600, name: 'doSetTrackPosition', args: [1, 0, 0, 0] },
    ]);
    expect(take.globalFx.scale).toEqual([{ t: 0, v: 1.5, interp: 'linear' }]);
    expect(take.spatialFx.spatial).toEqual([{ t: 500, v: 0.8, interp: 'linear' }]);
    expect(take.skipped).toEqual(['doSetTrackPosition']);
  });
});
