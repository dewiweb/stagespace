import { describe, it, expect } from 'vitest';
import { chase, type ChaseCue } from '../timecodeChase';

const cues: ChaseCue[] = [
  { id: 'c1', timecode: 10 },
  { id: 'c2', timecode: 20 },
  { id: 'c3', timecode: 30 },
  { id: 'nul', timecode: null },
];

describe('timecodeChase', () => {
  it('forward step fires last cue crossed', () => {
    // step 10→25 franchit c1(10)? non — c1 <= prevTc ; c2(20) ∈ ]10,25] → fire c2
    expect(chase(10, 25, cues, null)).toEqual({ fire: 'c2' });
    // step 19→30 franchit c2+c3 → DERNIÈRE seulement
    expect(chase(19, 30, cues, null)).toEqual({ fire: 'c3' });
  });

  it('dt > 1s forward = locate → latest cue ≤ tc', () => {
    expect(chase(10, 100, cues, null)).toEqual({ fire: 'c3' });
    // locate sur une cue déjà courante → no-op
    expect(chase(10, 100, cues, 'c3')).toEqual({});
  });

  it('rewind (dt<0) = locate → latest cue ≤ tc', () => {
    expect(chase(50, 15, cues, null)).toEqual({ fire: 'c1' });
    expect(chase(50, 35, cues, 'c3')).toEqual({});
  });

  it('first message (prevTc null) = locate', () => {
    expect(chase(null, 25, cues, null)).toEqual({ fire: 'c2' });
    expect(chase(null, 5, cues, null)).toEqual({});
  });

  it('no cue crossed in a step → no fire', () => {
    expect(chase(21, 22, cues, null)).toEqual({});
  });

  it('no timed cues → empty', () => {
    expect(chase(1, 2, [{ id: 'x' }], null)).toEqual({});
  });
});
