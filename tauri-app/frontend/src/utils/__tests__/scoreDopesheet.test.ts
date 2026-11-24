/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest';
import { collectDopesheetRows, type DopeRow } from '../scoreDopesheet';
import type { ScoreClipDoc, ScoreDoc } from '../../store/useScoreStore';

const clip = (o: Partial<ScoreClipDoc>): ScoreClipDoc =>
  ({ id: 'c1', startMs: 0, ...o }) as ScoreClipDoc;

const doc = (o: Partial<ScoreDoc>): ScoreDoc =>
  ({ clips: [], durationMs: 60_000, ...o }) as ScoreDoc;

const label = (c: ScoreClipDoc) => c.id;
const rows = (d: ScoreDoc): DopeRow[] => collectDopesheetRows(d, label);
const keys = (d: ScoreDoc) => rows(d).map((r) => r.key);

describe('collectDopesheetRows', () => {
  it('doc vide → aucune rangée', () => {
    expect(rows(doc({}))).toEqual([]);
  });

  it('clip osc → rangée events sur la lane OSC', () => {
    const k = keys(doc({
      clips: [clip({ ref: { type: 'osc', addr: '/go', args: '1' }, startMs: 2000 })],
    }));
    expect(k).toEqual(['ev:osc']);
  });

  it('clip slot → PAS de rangée events (le clip vit sur sa lane objet)', () => {
    const k = keys(doc({
      clips: [clip({ ref: { type: 'slot', slotId: 's1' }, trackIds: [1], durationMs: 5000 })],
    }));
    expect(k.filter((x) => x.startsWith('ev:'))).toEqual([]);
  });

  it('clip slot avec courbe → rangée clip-curve `cc:`', () => {
    const r = rows(doc({
      clips: [clip({
        ref: { type: 'slot', slotId: 's1' }, trackIds: [1],
        curves: { 'transform:scale': [{ t: 100, v: 0.5 }, { t: 300, v: 1 }] },
      })],
    }));
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('clip-curve');
    expect(r[0].key).toBe('cc:c1:transform:scale');
    expect(r[0].points.map((p) => p.kfIdx)).toEqual([0, 1]);
    expect(r[0].clipId).toBe('c1');
  });

  it('courbes de lanes globales → rangées lane-curve `lc:`', () => {
    const r = rows(doc({
      globalFxCurves: { speed: [{ t: 0, v: 1 }, { t: 500, v: 2 }] },
      modulationCurves: { '/score/energy': [{ t: 100, v: 0.2 }] },
      spatialFxCurves: { ksmooth: [{ t: 0, v: 0.4 }] },
    }));
    expect(r.map((x) => x.key)).toEqual([
      'lc:globalfx:speed',
      'lc:spatialfx:ksmooth',
      'lc:modulation:/score/energy',
    ]);
    expect(r.every((x) => x.kind === 'lane-curve')).toBe(true);
    expect(r[0].points[1]).toMatchObject({ t: 500, v: 2, kfIdx: 1 });
  });

  it('courbes lanes objets → rangées `lc:obj-N:` triées par track', () => {
    const r = rows(doc({
      objectCurves: {
        'obj-3': { 'pos.x': [{ t: 0, v: 1 }] },
        'obj-1': { depth: [{ t: 0, v: 2 }] },
      },
    }));
    expect(r.map((x) => x.key)).toEqual(['lc:obj-1:depth', 'lc:obj-3:pos.x']);
    expect(r[0].laneLabel).toBe('T1');
  });

  it('courbes vides exclues', () => {
    const k = keys(doc({
      globalFxCurves: { speed: [], yaw: [{ t: 0, v: 0 }] },
    }));
    expect(k).toEqual(['lc:globalfx:yaw']);
  });

  it('events triés par ordre de lane (conductor avant osc), points par temps', () => {
    const r = rows(doc({
      clips: [
        clip({ id: 'o1', ref: { type: 'osc', addr: '/a', args: '' }, startMs: 9000 }),
        clip({ id: 'g1', ref: { type: 'stopAll' }, startMs: 5000 }),
        clip({ id: 'o2', ref: { type: 'osc', addr: '/b', args: '' }, startMs: 1000 }),
      ],
    }));
    expect(r.map((x) => x.key)).toEqual(['ev:conductor', 'ev:osc']);
    expect(r[1].points.map((p) => p.t)).toEqual([1000, 9000]);
    expect(r[1].points.map((p) => p.clipId)).toEqual(['o2', 'o1']);
  });
});
