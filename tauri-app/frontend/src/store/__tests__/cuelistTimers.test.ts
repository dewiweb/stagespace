import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCuelistStore } from '../useCuelistStore';
import { resetStore, setInvokeResponse, getInvokeCalls } from './testHelpers';
import type { CueData } from '../useCuelistStore';

const cue = (id: string, extra: Partial<CueData> = {}): CueData =>
  ({
    id,
    schema_version: null,
    name: id,
    description: '',
    graph: { nodes: [], edges: [] },
    timestamp: 0,
    macros: null,
    track_indices: [],
    fade_duration: 0,
    cue_number: null,
    global_graph: null,
    signal_graph: null,
    active_move_ids: [],
    per_track_depths: [],
    manual_positions: {},
    spatial_macros: null,
    object_channels: null,
    channel_modulations: null,
    osc_mappings: null,
    zones: null,
    moves: [],
    mode: 'Full',
    scope: { moves: true, channels: true, positions: true, zones: true, global_graph: true, signal_graph: true, macros: true, osc_mappings: true },
    pre_wait: 0,
    follow: null,
    timecode: null,
    ...extra,
  }) as CueData;

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
  useCuelistStore.setState({
    cues: [cue('a', { cue_number: '1' }), cue('b', { cue_number: '2', pre_wait: 0.5, follow: 0.25 }), cue('c', { cue_number: '3' })],
    currentCueIndex: -1,
    pending: null,
    tcChaseEnabled: false,
    lastTimecode: null,
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pre_wait / follow / cancel', () => {
  it('pre_wait delays the recall and marks pending', async () => {
    void useCuelistStore.getState().recallCue('b');
    expect(getInvokeCalls().find((c) => c.cmd === 'recall_cue')).toBeUndefined();
    expect(useCuelistStore.getState().pending?.kind).toBe('pre_wait');
    await vi.advanceTimersByTimeAsync(600);
    expect(getInvokeCalls().some((c) => c.cmd === 'recall_cue')).toBe(true);
  });

  it('follow auto-GOs the next cue', async () => {
    setInvokeResponse('recall_cue', null);
    await useCuelistStore.getState().recallCue('b', { skipPreWait: true });
    expect(useCuelistStore.getState().pending?.kind).toBe('follow');
    await vi.advanceTimersByTimeAsync(300);
    const recalls = getInvokeCalls().filter((c) => c.cmd === 'recall_cue');
    expect(recalls.length).toBe(2);
  });

  it('cancelPendingTimers cancels a pending pre-wait', async () => {
    void useCuelistStore.getState().recallCue('b');
    useCuelistStore.getState().cancelPendingTimers();
    await vi.advanceTimersByTimeAsync(1000);
    expect(getInvokeCalls().find((c) => c.cmd === 'recall_cue')).toBeUndefined();
    expect(useCuelistStore.getState().pending).toBeNull();
  });

  it('feedback IPC fires after cue change', async () => {
    await useCuelistStore.getState().recallCue('a');
    expect(getInvokeCalls().some((c) => c.cmd === 'send_show_feedback')).toBe(true);
  });
});

describe('timecode handling', () => {
  it('TC fires a cue only when chase enabled', () => {
    useCuelistStore.setState({
      cues: [cue('t1', { timecode: 10 }), cue('t2', { timecode: 20 })],
      tcChaseEnabled: true,
    });
    useCuelistStore.getState().handleTimecode(15); // locate → t1
    expect(useCuelistStore.getState().lastTimecode).toBe(15);
    useCuelistStore.getState().handleTimecode(15.5); // step, nothing crossed
    expect(getInvokeCalls().filter((c) => c.cmd === 'recall_cue').length).toBe(1);
  });

  it('TC-fired recall skips pre_wait', async () => {
    useCuelistStore.setState({
      cues: [cue('t1', { timecode: 10, pre_wait: 5 })],
      tcChaseEnabled: true,
    });
    useCuelistStore.getState().handleTimecode(12);
    await vi.advanceTimersByTimeAsync(0);
    expect(getInvokeCalls().some((c) => c.cmd === 'recall_cue')).toBe(true);
  });
});
