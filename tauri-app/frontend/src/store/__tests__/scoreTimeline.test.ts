/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { useScoreStore, clipLaneIds, GLOBALFX_LANE, MODULATION_LANE, CONDUCTOR_LANE } from '../useScoreStore';
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

  it('clipLaneIds — slot → lanes objets ; barrières → conductor', () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's2' }, 0, { trackIds: [2, 3] });
    expect(clipLaneIds(c)).toEqual(['obj-2', 'obj-3']);
    const marker = st.addClip({ type: 'panic' }, 5000);
    expect(clipLaneIds(marker)).toEqual([CONDUCTOR_LANE]);
    // Une cue est une barrière globale : lane conductor quelle que
    // soit sa couverture (le blast radius est rendu ailleurs).
    const cue = st.addClip({ type: 'cue', cueId: '7' }, 8000, { trackIds: [1, 2] });
    expect(clipLaneIds(cue)).toEqual([CONDUCTOR_LANE]);
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
    expect(clips[1].lanes.map((l) => l.id)).toEqual([CONDUCTOR_LANE]);
    expect(clips[2].lanes.map((l) => l.id)).toEqual([CONDUCTOR_LANE]);
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

  it('conductor mutée → barrières skippées ; globalfx mutée → courbes non envoyées', async () => {
    const st = useScoreStore.getState();
    st.addClip({ type: 'slot', slotId: 's1' }, 0, { durationMs: 1000, trackIds: [1] });
    st.addClip({ type: 'stopAll' }, 5_000);
    st.setLaneCurve(GLOBALFX_LANE, 'speed', [{ t: 0, v: 1 }, { t: 5000, v: 2 }]);
    st.setLaneCurve(MODULATION_LANE, '/score/energy', [{ t: 0, v: 0 }, { t: 5000, v: 1 }]);
    // Barrières gouvernées par la lane conductor (pas globalfx).
    useScoreStore.getState().toggleLaneMute(CONDUCTOR_LANE);
    useScoreStore.getState().toggleLaneMute(GLOBALFX_LANE);
    const { clips } = await resolveScoreClips(useScoreStore.getState());
    expect(clips.map((c) => c.payload.kind)).toEqual(['Slot']);
    await useScoreStore.getState().playScore();
    const load = getInvokeCalls().find((c) => c.cmd === 'score_timeline_load');
    expect(load?.args?.globalFxCurves).toEqual({});
    // Lane modulation non mutée → ses courbes passent.
    expect(load?.args?.modulationCurves).toEqual({
      '/score/energy': [{ t: 0, v: 0 }, { t: 5000, v: 1 }],
    });
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

describe('déliage + split (édition)', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    useScoreStore.getState().clearScore();
    useGraphStore.setState({
      manualOscIds: [1, 2, 3, 4],
      moveSlots: [slot('s1', 'Orbe'), slot('s2', 'Duo', [2, 3])],
    } as never);
    useCuelistStore.setState({ cues: [] } as never);
  });

  it('Détacher T<n> — override sur l\'original, nouveau clip même ref', async () => {
    const { detachLaneFromClip } = await import('../../utils/scoreDetach');
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's2' }, 1000, { durationMs: 5000 });
    expect(detachLaneFromClip(c.id, 2, false)).toBe(true);
    const clips = useScoreStore.getState().clips;
    const orig = clips.find((x) => x.id === c.id)!;
    const fresh = clips.find((x) => x.id !== c.id)!;
    expect(orig.trackIds).toEqual([3]);
    expect(fresh.trackIds).toEqual([2]);
    expect(fresh.ref).toEqual(c.ref);
    expect(fresh.startMs).toBe(1000);
    // Mono-piste → no-op ; cue → no-op.
    expect(detachLaneFromClip(fresh.id, 2, false)).toBe(false);
    const cue = st.addClip({ type: 'cue', cueId: '7' }, 0, {});
    expect(detachLaneFromClip(cue.id, 1, false)).toBe(false);
  });

  it('Détacher T<n> → nouveau move : clone en banque, clip en suivi live', async () => {
    const { detachLaneFromClip } = await import('../../utils/scoreDetach');
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's2' }, 0, { durationMs: 5000 });
    const nSlots = useGraphStore.getState().moveSlots.length;
    expect(detachLaneFromClip(c.id, 3, true)).toBe(true);
    const slots = useGraphStore.getState().moveSlots;
    expect(slots.length).toBe(nSlots + 1);
    const clone = slots.find((s) => s.name.includes('▸ T3'))!;
    expect(clone.trackIds).toEqual([3]);
    const fresh = useScoreStore.getState().clips.find((x) => x.id !== c.id)!;
    expect(fresh.ref).toEqual({ type: 'slot', slotId: clone.id });
    expect(fresh.trackIds).toBeUndefined();
  });

  it('makeClipUnique — clone + repoint, mode suivi préservé', async () => {
    const { makeClipUnique, sharedClipCount } = await import('../../utils/scoreDetach');
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's1' }, 0, {});
    const c2 = st.addClip({ type: 'slot', slotId: 's1' }, 5000, {});
    expect(sharedClipCount(c.ref)).toBe(2);
    const id = makeClipUnique(c.id)!;
    expect(id).toBeTruthy();
    const clips = useScoreStore.getState().clips;
    expect(clips[0].ref).toEqual({ type: 'slot', slotId: id });
    expect(clips[0].trackIds).toBeUndefined();
    // L'autre clip garde l'entité d'origine.
    expect(clips.find((x) => x.id === c2.id)!.ref).toEqual(c2.ref);
    expect(sharedClipCount(c2.ref)).toBe(1);
  });

  it('makeClipUnique sur cue — clone en cuelist, clip repointé', async () => {
    const { makeClipUnique } = await import('../../utils/scoreDetach');
    useCuelistStore.setState({
      cues: [{ id: 'q1', name: 'Ouverture', cue_number: '1', moves: [], track_indices: [0, 1] }] as never,
    });
    const st = useScoreStore.getState();
    const c1 = st.addClip({ type: 'cue', cueId: 'q1' }, 1000, {});
    const c2 = st.addClip({ type: 'cue', cueId: 'q1' }, 5000, {});
    const newId = makeClipUnique(c1.id)!;
    expect(newId).toBeTruthy();
    const cues = useCuelistStore.getState().cues;
    expect(cues).toHaveLength(2);
    expect(cues[1].name).toBe('Ouverture copy');
    expect(cues[1].cue_number).toBeNull();
    // Clone inséré après la source ; c1 repointé, c2 garde l'originale.
    const clips = useScoreStore.getState().clips;
    expect(clips[0].ref).toEqual({ type: 'cue', cueId: newId });
    expect(clips.find((x) => x.id === c2.id)!.ref).toEqual({ type: 'cue', cueId: 'q1' });
  });

  it('splitClip — deux parties, fades externes, courbes re-basées', () => {
    const st = useScoreStore.getState();
    const c = st.addClip({ type: 'slot', slotId: 's1' }, 1000, { durationMs: 4000, trackIds: [1] });
    useScoreStore.getState().setClipCurve(c.id, 'speed', [{ t: 0, v: 1 }, { t: 3000, v: 2 }]);
    useScoreStore.getState().setClipFades(c.id, 500, 800);
    useScoreStore.getState().splitClip(c.id, 3000);
    const clips = useScoreStore.getState().clips;
    expect(clips).toHaveLength(2);
    const left = clips.find((x) => x.id === c.id)!;
    const right = clips.find((x) => x.id !== c.id)!;
    expect(left.durationMs).toBe(2000);
    expect(left.fadeInMs).toBe(500);
    expect(left.fadeOutMs).toBeUndefined();
    expect(left.curves?.speed).toEqual([{ t: 0, v: 1 }]);
    expect(right.startMs).toBe(3000);
    expect(right.durationMs).toBe(2000);
    expect(right.fadeInMs).toBeUndefined();
    expect(right.fadeOutMs).toBe(800);
    expect(right.curves?.speed).toEqual([{ t: 1000, v: 2 }]); // t relatif re-basé
    // Hors fenêtre → no-op ; cue → no-op.
    useScoreStore.getState().splitClip(left.id, 999);
    useScoreStore.getState().splitClip(left.id, 3500);
    expect(useScoreStore.getState().clips).toHaveLength(2);
  });
});

describe('flatten cue → clips (explosion)', () => {
  const mv = (id: string, name: string, trackIndices: number[], extra = {}) => ({
    id, name, graph_json: { nodes: [], edges: [] }, signal_graph: null,
    osc_ids: [], track_indices: trackIndices, is_preview: false,
    duration: 6, loop_mode: 'loop', direction: 'forward',
    fade_in: 0.8, fade_out: 1.2, end_mode: null, anchor_mode: null,
    anchor_target: null, ...extra,
  });

  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    useScoreStore.getState().clearScore();
    useGraphStore.setState({
      manualOscIds: [1, 2, 3, 4],
      moveSlots: [slot('s1', 'Orbe')],
    } as never);
    useCuelistStore.setState({
      cues: [{
        id: 'c1', name: 'Ouverture', cue_number: '1', description: '',
        mode: 'Full', track_indices: [],
        moves: [
          mv('m1', 'Spirale', [0, 2], { end_mode: 'hold', anchor_mode: 'current' }),
          mv('m2', 'Essaim', [1], { duration: 3, loop_mode: 'oneshot', direction: 'ping_pong' }),
        ],
        macros: { speed: 1.5, scale: 2, shift_x: 0, shift_y: 0, shift_z: 0, yaw: 90, pitch: 0, roll: 0 },
        spatial_macros: { radius_scale: 1.4, height_offset: 0.2 },
        signal_graph: { nodes: [{ id: 'n1' }], edges: [] },
        manual_positions: { 0: [1, 2, 3], 2: [0, 1, 0] },
        object_channels: null, osc_mappings: null, zones: null,
        per_track_depths: [], active_move_ids: [],
      }] as never,
    });
  });

  it('moves→slots+clips suivis, macros→GLOBALFX, skipped rapportés, cue intacte', async () => {
    const { flattenCueClip } = await import('../../utils/scoreFlatten');
    const st = useScoreStore.getState();
    const cueClip = st.addClip({ type: 'cue', cueId: 'c1' }, 12000, {});
    const r = flattenCueClip(cueClip.id)!;
    expect(r.movedClips).toBe(4); // 2 slots + positions + modGraph
    expect(r.macroKeys).toBe(10); // 8 macros + 2 spatial
    expect(r.skipped).toEqual([]);

    // Clip cue remplacé par l'arrangement à t0 — slots en suivi live.
    const clips = useScoreStore.getState().clips;
    expect(clips.find((c) => c.ref.type === 'cue')).toBeUndefined();
    expect(clips).toHaveLength(4);
    expect(clips.every((c) => c.startMs === 12000)).toBe(true);
    expect(clips.filter((c) => c.ref.type === 'slot').every((c) => c.trackIds === undefined)).toBe(true);

    // manual_positions (obj_index) → clip positions en track_id.
    const posClip = clips.find((c) => c.ref.type === 'positions')!;
    expect(posClip.ref).toEqual({ type: 'positions', positions: { 1: [1, 2, 3], 3: [0, 1, 0] } });
    // signal_graph → clip modGraph portant le graphe.
    const modClip = clips.find((c) => c.ref.type === 'modGraph')!;
    expect((modClip.ref as { graph: { nodes: unknown[] } }).graph.nodes).toHaveLength(1);

    // Slots matérialisés : obj_index → track_id, props du snapshot.
    const slots = useGraphStore.getState().moveSlots;
    const spirale = slots.find((s) => s.name === 'Ouverture·Spirale')!;
    expect(spirale.trackIds).toEqual([1, 3]);
    expect(spirale.endMode).toBe('hold');
    expect(spirale.anchorMode).toBe('current');
    const essaim = slots.find((s) => s.name === 'Ouverture·Essaim')!;
    expect(essaim.loopMode).toBe('oneshot');
    expect(essaim.direction).toBe('ping_pong');
    const slotClips = clips.filter((c) => c.ref.type === 'slot');
    expect(slotClips[0].durationMs).toBe(6000);
    // Les clips slot pointent les slots matérialisés.
    const ids = new Set(slots.map((s) => s.id));
    expect(slotClips.every((c) => c.ref.type === 'slot' && ids.has(c.ref.slotId))).toBe(true);

    // Macros → keyframes GLOBALFX à l'instant du clip.
    const gfx = useScoreStore.getState().globalFxCurves!;
    expect(gfx.speed).toContainEqual({ t: 12000, v: 1.5 });
    expect(gfx.yaw).toEqual([{ t: 12000, v: 90 }]);
    expect(gfx.radius_scale).toEqual([{ t: 12000, v: 1.4 }]);
    expect(gfx.height_offset).toEqual([{ t: 12000, v: 0.2 }]);

    // La cue d'origine est intacte — flatten non destructif.
    expect(useCuelistStore.getState().cues[0].moves).toHaveLength(2);
  });

  it('snapshot vide → clip conservé, rapport honnête', async () => {
    const { flattenCueClip, reportFlatten } = await import('../../utils/scoreFlatten');
    useCuelistStore.setState({
      cues: [
        { id: 'empty', name: 'Stop', moves: [], macros: null, signal_graph: null,
          spatial_macros: null, manual_positions: {}, object_channels: null,
          osc_mappings: null, zones: null, per_track_depths: [] },
        // Catégorie non matérialisable seule (zones) → warning + clip
        // conservé.
        { id: 'zones-only', name: 'Zones', moves: [], macros: null, signal_graph: null,
          spatial_macros: null, manual_positions: {}, object_channels: null,
          osc_mappings: null, zones: [{}], per_track_depths: [] },
      ] as never,
    });
    const cueClip = useScoreStore.getState().addClip({ type: 'cue', cueId: 'empty' }, 5000, {});
    const r = flattenCueClip(cueClip.id)!;
    expect(r.movedClips).toBe(0);
    expect(reportFlatten(r).kind).toBe('info');
    const zClip = useScoreStore.getState().addClip({ type: 'cue', cueId: 'zones-only' }, 8000, {});
    const rz = flattenCueClip(zClip.id)!;
    const repz = reportFlatten(rz);
    expect(repz.kind).toBe('warning');
    expect(repz.message).toContain('zones');
    expect(useScoreStore.getState().clips.find((c) => c.id === zClip.id)).toBeTruthy();
    // Le clip cue survit — supprimer la seule représentation serait
    // une perte d'information.
    expect(useScoreStore.getState().clips.find((c) => c.id === cueClip.id)).toBeTruthy();
  });

  it('no-op : clip non-cue ou cue introuvable', async () => {
    const { flattenCueClip } = await import('../../utils/scoreFlatten');
    const st = useScoreStore.getState();
    const s = st.addClip({ type: 'slot', slotId: 's1' }, 0, {});
    expect(flattenCueClip(s.id)).toBeUndefined();
    const orphan = st.addClip({ type: 'cue', cueId: 'nope' }, 0, {});
    expect(flattenCueClip(orphan.id)).toBeUndefined();
  });
});
