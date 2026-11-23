/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { useScoreStore, clipLaneIds, MASTER_LANE } from '../useScoreStore';
import { resolveScoreClips, cueCoverage } from '../../utils/scoreResolve';
import { useGraphStore, getInvokeCalls, clearInvokeCalls, resetStore } from './testHelpers';
import { useCuelistStore } from '../useCuelistStore';

// S2/S3 — document du séquenceur + résolution clips → payloads
// backend. Les lanes sont les objets : clip.trackIds = couverture
// (assignation effective pour les slots, dérivée pour les cues) ;
// laneStates = overrides mute/mode par lane dérivée.

const slot = (id: string, name = id, trackIds = [1]) =>
  ({
    id, name, oscIndex: 1, templateId: 'circle',
    graphJson: null, signalGraph: null, trackIds,
    movementId: null, isPreview: false,
  }) as never;

describe('score timeline (S2/S3 — lanes objets)', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    useScoreStore.getState().clearScore();
    useGraphStore.setState({
      manualOscIds: [1, 2, 3, 4],
      moveSlots: [slot('s1', 'Orbe'), slot('s2', 'Duo', [2, 3])],
    } as never);
    useCuelistStore.setState({
      cues: [{ id: 7, cue_number: '1', name: 'Ouverture', moves: [] }],
    } as never);
  });

  it('addClip/moveClip/resizeClip/removeClip sur le document', () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's1' }, 2000, { durationMs: 10_000, trackIds: [1] });
    expect(useScoreStore.getState().clips).toHaveLength(1);
    expect(c.trackIds).toEqual([1]);

    useScoreStore.getState().moveClip(c.id, -500);
    expect(useScoreStore.getState().clips[0].startMs).toBe(0); // clamp ≥0
    useScoreStore.getState().moveClip(c.id, 4500);
    expect(useScoreStore.getState().clips[0].startMs).toBe(4500);

    useScoreStore.getState().resizeClip(c.id, 8000);
    expect(useScoreStore.getState().clips[0].durationMs).toBe(8000);

    useScoreStore.getState().removeClip(c.id);
    expect(useScoreStore.getState().clips).toHaveLength(0);
  });

  it('clipLaneIds — couverture → lanes objets ; vide/marker → master', () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's2' }, 0, { trackIds: [2, 3] });
    expect(clipLaneIds(c)).toEqual(['obj-2', 'obj-3']);
    const marker = st.addClip({ type: 'panic' }, 5000);
    expect(clipLaneIds(marker)).toEqual([MASTER_LANE]);
    // Couverture vide → lane master (le clip reste visible).
    const cue = st.addClip({ type: 'cue', cueId: '7' }, 8000);
    expect(clipLaneIds(cue)).toEqual([MASTER_LANE]);
  });

  it('playScore résout → score_timeline_load + play, lanes émises', async () => {
    const st = useScoreStore.getState();
    st.addClip({ type: 'slot', slotId: 's2' }, 0, { durationMs: 5000, trackIds: [2, 3] });
    st.addClip({ type: 'cue', cueId: '7' }, 12_000, { trackIds: [1] });
    st.addClip({ type: 'stopAll' }, 30_000);
    await useScoreStore.getState().playScore();
    const calls = getInvokeCalls().map((c) => c.cmd);
    expect(calls).toContain('score_timeline_load');
    expect(calls).toContain('score_timeline_play');
    const load = getInvokeCalls().find((c) => c.cmd === 'score_timeline_load');
    const clips = load?.args?.clips as { lanes: { id: string }[]; payload: { kind: string } }[];
    expect(clips).toHaveLength(3);
    expect(clips.map((c) => c.payload.kind)).toEqual(['Slot', 'Cue', 'StopAll']);
    expect(clips[0].lanes.map((l) => l.id)).toEqual(['obj-2', 'obj-3']);
    expect(clips[2].lanes.map((l) => l.id)).toEqual([MASTER_LANE]);
    expect(useScoreStore.getState().playing).toBe(true);
  });

  it('résolution : lane mutée filtre la couverture, refs perdues rapportées', async () => {
    const st = useScoreStore.getState();
    st.addClip({ type: 'slot', slotId: 's2' }, 0, { durationMs: 1000, trackIds: [2, 3] });
    st.addClip({ type: 'slot', slotId: 's1' }, 0, { durationMs: 1000, trackIds: [2] });
    st.addClip({ type: 'cue', cueId: '999' }, 1000, { trackIds: [1] }); // cue inexistante
    // Lane obj-2 mutée : s2 perd l'objet 2 (reste obj-3), s1 devient vide → skippé.
    useScoreStore.getState().toggleLaneMute('obj-2');
    const { clips, errors } = await resolveScoreClips(useScoreStore.getState());
    expect(clips.map((c) => c.payload.kind)).toEqual(['Slot']);
    expect(clips[0].lanes.map((l) => l.id)).toEqual(['obj-3']);
    expect(errors).toHaveLength(1); // cue 999 → erreur rapportée
    useScoreStore.getState().toggleLaneMute('obj-2');
    const r2 = await resolveScoreClips(useScoreStore.getState());
    expect(r2.clips).toHaveLength(2);
  });

  it('master mutée → markers skippés + masterCurves non envoyées', async () => {
    const st = useScoreStore.getState();
    st.addClip({ type: 'slot', slotId: 's1' }, 0, { durationMs: 1000, trackIds: [1] });
    st.addClip({ type: 'stopAll' }, 5_000);
    st.setMasterCurve('speed', [{ t: 0, v: 1 }, { t: 5000, v: 2 }]);
    useScoreStore.getState().toggleLaneMute(MASTER_LANE);
    const { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips.map((c) => c.payload.kind)).toEqual(['Slot']);
    await useScoreStore.getState().playScore();
    const load = getInvokeCalls().find((c) => c.cmd === 'score_timeline_load');
    expect(load?.args?.masterCurves).toEqual({});
  });

  it('stopScore → score_timeline_stop + playing false', () => {
    useScoreStore.setState({ playing: true });
    useScoreStore.getState().stopScore();
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('score_timeline_stop');
    expect(useScoreStore.getState().playing).toBe(false);
  });

  it('repeatEveryMs (copies du pattern) est propagé à la résolution', async () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's1' }, 0, { durationMs: 10_000, trackIds: [1] });
    useScoreStore.getState().setClipRepeat(c.id, 2_000);
    const { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips[0].repeat_every_ms).toBe(2000);
    expect(clips[0].duration_ms).toBe(10_000);
  });

  it('duplicateClip — copie indépendante décalée, couverture copiée', () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's2' }, 1000, { durationMs: 4000, trackIds: [2, 3] });
    useScoreStore.getState().duplicateClip(c.id);
    const clips = useScoreStore.getState().clips;
    expect(clips).toHaveLength(2);
    const copy = clips[1];
    expect(copy.id).not.toBe(c.id);
    expect(copy.startMs).toBe(5000); // 1000 + durée 4000
    expect(copy.ref).toEqual(c.ref);
    expect(copy.trackIds).toEqual([2, 3]);
    // Copie indépendante : réassigner l'une ne touche pas l'autre.
    useScoreStore.getState().setClipTrackIds(copy.id, [4]);
    expect(useScoreStore.getState().clips[0].trackIds).toEqual([2, 3]);
    expect(useScoreStore.getState().clips[1].trackIds).toEqual([4]);
  });

  it('setClipFades — fades clip-local propagés à la résolution', async () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's1' }, 0, { durationMs: 5000, trackIds: [1] });
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

  it('lane mode — stacked par lane propagé sur le wire, exclusive défaut', async () => {
    const st = useScoreStore.getState();
    st.addClip({ type: 'slot', slotId: 's2' }, 0, { durationMs: 5000, trackIds: [2, 3] });
    let { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips[0].lanes.every((l) => !l.stacked)).toBe(true);
    // obj-2 stacked uniquement → le flag ne suit que cette lane.
    useScoreStore.getState().setLaneMode('obj-2', 'stacked');
    ({ clips } = await resolveScoreClips(useScoreStore.getState()));
    expect(clips[0].lanes).toEqual([{ id: 'obj-2', stacked: true }, { id: 'obj-3' }]);
    useScoreStore.getState().setLaneMode('obj-2', 'exclusive');
    ({ clips } = await resolveScoreClips(useScoreStore.getState()));
    expect(clips[0].lanes.every((l) => !l.stacked)).toBe(true);
  });

  it('setClipCurve — courbes clip-scoped propagées à la résolution', async () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's1' }, 0, { durationMs: 5000, trackIds: [1] });
    st.setClipCurve(c.id, 'speed', [
      { t: 2_000, v: 2 }, { t: 0, v: 1 }, // volontairement non trié
    ]);
    // Keyframes triés par t au store.
    expect(useScoreStore.getState().clips[0].curves?.speed).toEqual([
      { t: 0, v: 1 }, { t: 2_000, v: 2 },
    ]);
    const { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips[0].curves?.speed).toHaveLength(2);
    st.setClipCurve(c.id, 'speed', undefined);
    const r2 = await resolveScoreClips(useScoreStore.getState());
    expect(r2.clips[0].curves).toBeUndefined();
  });

  it('cueCoverage — union scope + moves + positions, obj→track_id', () => {
    const cue = {
      track_indices: [0],
      moves: [{ track_indices: [2, 0] }],
      manual_positions: { '3': [0, 0, 0] },
    };
    // obj 0,2,3 → track_ids 1,3,4 via manualOscIds [1,2,3,4].
    expect(cueCoverage(cue as never, [1, 2, 3, 4])).toEqual([1, 3, 4]);
    // obj hors de la liste → ignoré.
    expect(cueCoverage({ track_indices: [0, 9] } as never, [1, 2])).toEqual([1]);
  });

  it('loop region — setLoop stocke + playScore envoie set_loop au backend', async () => {
    const st = useScoreStore.getState();
    st.addClip({ type: 'slot', slotId: 's1' }, 0, { durationMs: 5000, trackIds: [1] });
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
