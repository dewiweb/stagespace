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

  it('repeatEveryMs (copies du pattern) est propagé à la résolution', async () => {
    const st = useScoreStore.getState();
    const c = st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 0, 10_000);
    useScoreStore.getState().setClipRepeat(c.id, 2_000);
    const { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips[0].repeat_every_ms).toBe(2000);
    expect(clips[0].duration_ms).toBe(10_000);
  });

  it('duplicateClip — copie indépendante décalée de sa durée', () => {
    const st = useScoreStore.getState();
    const c = st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 1000, 4000);
    useScoreStore.getState().duplicateClip(c.id);
    const clips = useScoreStore.getState().clips;
    expect(clips).toHaveLength(2);
    const copy = clips[1];
    expect(copy.id).not.toBe(c.id);
    expect(copy.startMs).toBe(5000); // 1000 + durée 4000
    expect(copy.ref).toEqual(c.ref);
    // Copie indépendante : bouger l'une ne touche pas l'autre.
    useScoreStore.getState().moveClip(copy.id, 9000);
    expect(useScoreStore.getState().clips[0].startMs).toBe(1000);
  });

  it('setClipFades — fades clip-local propagés à la résolution', async () => {
    const st = useScoreStore.getState();
    const c = st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 0, 5000);
    useScoreStore.getState().setClipFades(c.id, 1500, 3000);
    const doc = useScoreStore.getState().clips[0];
    expect(doc.fadeInMs).toBe(1500);
    expect(doc.fadeOutMs).toBe(3000);
    const { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips[0].fade_in_ms).toBe(1500);
    expect(clips[0].fade_out_ms).toBe(3000);
    // undefined → héritage du slot (pas de champ à la résolution).
    useScoreStore.getState().setClipFades(c.id, undefined, undefined);
    const r2 = await resolveScoreClips(useScoreStore.getState());
    expect(r2.clips[0].fade_in_ms).toBeUndefined();
    expect(r2.clips[0].fade_out_ms).toBeUndefined();
  });

  it('lane mode — setTrackMode stacked → flag propagé, exclusive par défaut', async () => {
    const st = useScoreStore.getState();
    st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 0, 5000);
    let { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips[0].stacked).toBeUndefined(); // exclusive = absent du wire
    useScoreStore.getState().setTrackMode('trk-slots', 'stacked');
    ({ clips } = await resolveScoreClips(useScoreStore.getState()));
    expect(clips[0].stacked).toBe(true);
    useScoreStore.getState().setTrackMode('trk-slots', 'exclusive');
    ({ clips } = await resolveScoreClips(useScoreStore.getState()));
    expect(clips[0].stacked).toBeUndefined();
  });

  it('setScoreDoc backfill mode:exclusive sur les vieux docs', () => {
    useScoreStore.getState().setScoreDoc({
      tracks: [{ id: 't1', name: 'A', kind: 'slots', muted: false }],
      clips: [], durationMs: 60_000,
    });
    expect(useScoreStore.getState().tracks[0].mode).toBe('exclusive');
  });

  it('loop region — setLoop stocke + playScore envoie set_loop au backend', async () => {
    const st = useScoreStore.getState();
    st.addClip('trk-slots', { type: 'slot', slotId: 's1' }, 0, 5000);
    useScoreStore.getState().setLoop(2000, 30_000);
    const s = useScoreStore.getState();
    expect(s.loopStartMs).toBe(2000);
    expect(s.loopEndMs).toBe(30_000);
    await useScoreStore.getState().playScore();
    const setLoopCall = getInvokeCalls().find((c) => c.cmd === 'score_timeline_set_loop');
    expect(setLoopCall?.args).toEqual({ startMs: 2000, endMs: 30_000 });
    // Désarmement → null/null (pas de region).
    useScoreStore.getState().setLoop(undefined, undefined);
    const disarm = getInvokeCalls().filter((c) => c.cmd === 'score_timeline_set_loop').pop();
    expect(disarm?.args).toEqual({ startMs: null, endMs: null });
  });
});
