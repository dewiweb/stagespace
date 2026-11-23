/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { useScoreStore } from '../useScoreStore';
import { resolveScoreClips } from '../../utils/scoreResolve';
import { useGraphStore, getInvokeCalls, clearInvokeCalls, resetStore } from './testHelpers';
import { useCuelistStore } from '../useCuelistStore';

// S2 — document du séquenceur + résolution clips → payloads backend.
// Le document référence (slotId/cueId), la résolution embarque les
// snapshots (activate_move request, Cue) au play — backend exécute seul.

const slot = (id: string, name = id) =>
  ({
    id, name, oscIndex: 1, templateId: 'circle',
    graphJson: null, signalGraph: null, trackIds: [1],
    movementId: null, isPreview: false,
  }) as never;

describe('score timeline (S2)', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    useScoreStore.getState().clearScore();
    useGraphStore.setState({ moveSlots: [slot('s1', 'Orbe')] } as never);
    useCuelistStore.setState({
      cues: [{ id: 7, cue_number: '1', name: 'Ouverture', moves: [] }],
    } as never);
  });

  it('addClip/moveClip/resizeClip/removeClip sur le document', () => {
    const st = useScoreStore.getState();
    const c = st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 2000, 10_000);
    expect(useScoreStore.getState().clips).toHaveLength(1);

    useScoreStore.getState().moveClip(c.id, -500);
    expect(useScoreStore.getState().clips[0].startMs).toBe(0); // clamp ≥0
    useScoreStore.getState().moveClip(c.id, 4500);
    expect(useScoreStore.getState().clips[0].startMs).toBe(4500);

    useScoreStore.getState().resizeClip(c.id, 8000);
    expect(useScoreStore.getState().clips[0].durationMs).toBe(8000);

    useScoreStore.getState().removeClip(c.id);
    expect(useScoreStore.getState().clips).toHaveLength(0);
  });

  it('removeTrack supprime la lane ET ses clips', () => {
    const st = useScoreStore.getState();
    st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 0, 1000);
    useScoreStore.getState().removeTrack('trk-slots');
    const s = useScoreStore.getState();
    expect(s.tracks.find((t) => t.id === 'trk-slots')).toBeUndefined();
    expect(s.clips).toHaveLength(0);
  });

  it('playScore résout → score_timeline_load + play', async () => {
    const st = useScoreStore.getState();
    st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 0, 5000);
    st.addClip('trk-cues', { type: 'cue', cueId: '7' }, 12_000);
    st.addClip('trk-markers', { type: 'stopAll' }, 30_000);
    await useScoreStore.getState().playScore();
    const calls = getInvokeCalls().map((c) => c.cmd);
    expect(calls).toContain('score_timeline_load');
    expect(calls).toContain('score_timeline_play');
    const load = getInvokeCalls().find((c) => c.cmd === 'score_timeline_load');
    const clips = load?.args?.clips as { payload: { kind: string } }[];
    expect(clips).toHaveLength(3);
    expect(clips.map((c) => c.payload.kind)).toEqual(['Slot', 'Cue', 'StopAll']);
    expect(useScoreStore.getState().playing).toBe(true);
  });

  it('résolution : la lane mutée est exclue, les refs perdues rapportées', async () => {
    const st = useScoreStore.getState();
    st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 0, 1000);
    st.addClip('trk-cues', { type: 'cue', cueId: '999' }, 1000); // cue inexistante
    useScoreStore.getState().toggleTrackMute('trk-slots');
    const { clips, errors } = await resolveScoreClips(useScoreStore.getState());
    expect(clips).toHaveLength(0);
    expect(errors).toHaveLength(1); // cue 999 → erreur, slot muté silencieux
    useScoreStore.getState().toggleTrackMute('trk-slots');
    const r2 = await resolveScoreClips(useScoreStore.getState());
    expect(r2.clips.map((c) => c.payload.kind)).toEqual(['Slot']);
  });

  it('stopScore → score_timeline_stop + playing false', () => {
    useScoreStore.setState({ playing: true });
    useScoreStore.getState().stopScore();
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('score_timeline_stop');
    expect(useScoreStore.getState().playing).toBe(false);
  });
});
