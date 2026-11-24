/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { validateScore } from '../scoreValidate';
import { useScoreStore } from '../../store/useScoreStore';
import { useCuelistStore } from '../../store/useCuelistStore';
import { useGraphStore, resetStore, makeSlot } from '../../store/__tests__/testHelpers';
import type { ScoreClipDoc } from '../../store/useScoreStore';

const clip = (o: Partial<ScoreClipDoc>): ScoreClipDoc =>
  ({ id: 'c1', startMs: 0, ...o }) as ScoreClipDoc;

const errors = () => validateScore().filter((i) => i.level === 'error');
const warnings = () => validateScore().filter((i) => i.level === 'warning');

describe('scoreValidate — preflight', () => {
  beforeEach(() => {
    resetStore();
    useScoreStore.getState().clearScore();
    useCuelistStore.setState({ cues: [] } as never);
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 's1', trackIds: [1] })] } as never);
  });

  it('partition vide → erreur', () => {
    expect(errors().some((i) => i.message.includes('vide'))).toBe(true);
  });

  it('partition saine → rapport vide', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'slot', slotId: 's1' }, durationMs: 5000 })],
      durationMs: 10000,
    } as never);
    expect(validateScore()).toHaveLength(0);
  });

  it('slot orphelin → erreur', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'slot', slotId: 'gone' } })],
    } as never);
    expect(errors().some((i) => i.message.includes('orphelin'))).toBe(true);
  });

  it('cue orpheline → erreur', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'cue', cueId: 'gone' } })],
    } as never);
    expect(errors().some((i) => i.message.includes('cue supprimée'))).toBe(true);
  });

  it('couverture mutée → warning clip muet', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'slot', slotId: 's1' } })],
      laneStates: { 'obj-1': { muted: true } },
    } as never);
    expect(warnings().some((i) => i.message.includes('muet'))).toBe(true);
  });

  it('tracks hors patch → warning', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'slot', slotId: 's1' }, trackIds: [42] })],
    } as never);
    expect(warnings().some((i) => i.message.includes('hors du patch'))).toBe(true);
  });

  it('clip au-delà de la durée → warning jamais tiré', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'slot', slotId: 's1' }, startMs: 20000 })],
      durationMs: 10000,
    } as never);
    expect(warnings().some((i) => i.message.includes('jamais tiré'))).toBe(true);
  });

  it('courbe GLOBALFX inconnue (typo) → warning', () => {
    useScoreStore.setState({
      globalFxCurves: { sped: [{ t: 0, v: 1 }] },
    } as never);
    expect(warnings().some((i) => i.message.includes('« sped »'))).toBe(true);
  });

  it('courbe zone:i: sans clip zones → warning sans table', () => {
    useScoreStore.setState({
      spatialFxCurves: { 'zone:0:falloff': [{ t: 0, v: 1 }] },
    } as never);
    expect(warnings().some((i) => i.message.includes('aucun clip zones'))).toBe(true);
  });

  it('courbe zone hors index de la table → warning', () => {
    useScoreStore.setState({
      clips: [clip({
        ref: { type: 'zones', zones: [{ shape: {}, falloff: 0, enabled: true }] as never },
      })],
      spatialFxCurves: { 'zone:5:falloff': [{ t: 0, v: 1 }] },
    } as never);
    expect(warnings().some((i) => i.message.includes('zone 5 absente'))).toBe(true);
  });

  it('courbe mod: sans clip chanMods → warning', () => {
    useScoreStore.setState({
      spatialFxCurves: { 'mod:speed>spread:scale': [{ t: 0, v: 1 }] },
    } as never);
    expect(warnings().some((i) => i.message.includes('aucun clip chanMods'))).toBe(true);
  });

  it('courbe objet sur lane hors patch → warning', () => {
    useScoreStore.setState({
      objectCurves: { 'obj-42': { depth: [{ t: 0, v: 1 }] } },
    } as never);
    expect(warnings().some((i) => i.message.includes('T42 hors du patch'))).toBe(true);
  });

  it('param inconnu sur lane objet → warning', () => {
    useScoreStore.setState({
      objectCurves: { 'obj-1': { sped: [{ t: 0, v: 1 }] } },
    } as never);
    expect(warnings().some((i) => i.message.includes('param inconnu « sped »'))).toBe(true);
  });

  it('courbes clip-scoped sur non-slot → warning ignorées', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'panic' }, curves: { speed: [{ t: 0, v: 1 }] } })],
    } as never);
    expect(warnings().some((i) => i.message.includes('ignorées'))).toBe(true);
  });

  it('région de boucle inversée → erreur', () => {
    useScoreStore.setState({
      clips: [clip({ ref: { type: 'slot', slotId: 's1' } })],
      loopStartMs: 5000, loopEndMs: 1000,
    } as never);
    expect(errors().some((i) => i.message.includes('boucle invalide'))).toBe(true);
  });

  it('erreurs triées avant warnings', () => {
    useScoreStore.setState({
      clips: [
        clip({ ref: { type: 'slot', slotId: 'gone' } }),
        clip({ id: 'c2', ref: { type: 'slot', slotId: 's1' }, startMs: 99000 }),
      ],
      durationMs: 10000,
    } as never);
    const list = validateScore();
    expect(list[0].level).toBe('error');
  });
});
