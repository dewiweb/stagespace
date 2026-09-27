/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { spliceRejectionReason } from '../connectionRules';
import { presetsUsingType, SHAPE_PRESETS } from '../shapePresets';

/// Autopatch — règles d'insertion d'un node sur une edge sélectionnée
/// (`A → B` + clic palette `M` = `A → M → B`). Mirror des tables du
/// validateur Rust via isValidConnection/getInputPorts.
describe('spliceRejectionReason (autopatch)', () => {
  it('modifier sur une edge trajectoire : valide', () => {
    // Circular → Output, insert Scale
    expect(spliceRejectionReason('Circular', 'Output', 'Scale', undefined, 'input')).toBeNull();
    // Circular → Scale, insert Rotate (chaînage de modifiers)
    expect(spliceRejectionReason('Circular', 'Scale', 'Rotate', undefined, 'input')).toBeNull();
  });

  it('edge vers une entrée composite : valide, le port cible est préservé', () => {
    // Circular → Mix:input_a, insert Offset → Offset → Mix:input_a
    expect(spliceRejectionReason('Circular', 'Mix', 'Offset', undefined, 'input_a')).toBeNull();
  });

  it('targetHandle null (edge legacy) : traité comme input', () => {
    expect(spliceRejectionReason('Circular', 'Output', 'Scale', undefined, null)).toBeNull();
  });

  it('edge duration : refusée avec explication', () => {
    const reason = spliceRejectionReason('Duration', 'Circular', 'Scale', undefined, 'duration');
    expect(reason).toMatch(/duration/);
  });

  it('edge spline : refusée', () => {
    const reason = spliceRejectionReason('DrawSpline', 'EvaluateSpline', 'Scale', undefined, 'spline');
    expect(reason).toMatch(/spline/);
  });

  it('source incompatible : refusée (Objects ne peut pas alimenter Scale)', () => {
    const reason = spliceRejectionReason('Objects', 'Circular', 'Scale', undefined, 'input');
    expect(reason).toMatch(/Objects can't feed Scale/);
  });

  it('physics → modifier : refusée (mirror du validator Rust)', () => {
    const reason = spliceRejectionReason('Bouncing', 'Output', 'Scale', undefined, 'input');
    expect(reason).toBeTruthy();
  });

  it('cible incompatible : refusée (modifier ne peut pas alimenter Sequence)', () => {
    const reason = spliceRejectionReason('Circular', 'Sequence', 'Scale', undefined, 'input_a');
    expect(reason).toMatch(/can't feed Sequence/);
  });

  it('plugin modifier : insérable sur une edge trajectoire', () => {
    expect(spliceRejectionReason('Circular', 'Output', 'Plugin', 'modifier', 'input')).toBeNull();
  });

  it('plugin composite : refusé (input_b resterait pendante)', () => {
    const reason = spliceRejectionReason('Circular', 'Output', 'Plugin', 'composite', 'input');
    expect(reason).toMatch(/two inputs/);
  });

  it('composite natif (Mix) : refusé', () => {
    const reason = spliceRejectionReason('Circular', 'Output', 'Mix', undefined, 'input');
    expect(reason).toMatch(/two inputs/);
  });

  it('engine : refusé (pas alimentable par une trajectoire)', () => {
    const reason = spliceRejectionReason('Circular', 'Output', 'Spiral', undefined, 'input');
    expect(reason).toMatch(/can't feed Spiral/);
  });
});

/// Help runnable — presets contenant un type de node (menu clic-droit).
describe('presetsUsingType', () => {
  it('trouve les presets qui instancient Circular', () => {
    const hits = presetsUsingType('Circular');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((p) => p.id === 'circle')).toBe(true);
  });

  it('trouve les presets contenant des modifiers (Rotate)', () => {
    const hits = presetsUsingType('Rotate');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((p) => SHAPE_PRESETS.includes(p))).toBe(true);
  });

  it('type sans preset : liste vide (fallback UI)', () => {
    expect(presetsUsingType('MoveRef')).toEqual([]);
  });

  it('chaque preset retourné produit un graphe runnable', () => {
    for (const p of presetsUsingType('Circular')) {
      const g = p.build(4);
      expect(g.nodes.length).toBeGreaterThan(1);
      expect(g.edges.length).toBeGreaterThan(0);
    }
  });
});
