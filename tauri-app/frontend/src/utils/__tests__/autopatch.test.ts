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
    expect(spliceRejectionReason('Circular', 'Output', 'Scale', undefined, 'in')).toBeNull();
    // Circular → Scale, insert Rotate (chaînage de modifiers)
    expect(spliceRejectionReason('Circular', 'Scale', 'Rotate', undefined, 'in')).toBeNull();
  });

  it('edge vers une entrée composite : valide, le port cible est préservé', () => {
    // Circular → Mix:input_a, insert Offset → Offset → Mix:input_a
    expect(spliceRejectionReason('Circular', 'Mix', 'Offset', undefined, 'a')).toBeNull();
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

  it('port carrier (Objects) : refusée — pas un edge Positions', () => {
    const reason = spliceRejectionReason('Objects', 'Circular', 'Scale', undefined, 'objects');
    expect(reason).toBeTruthy();
  });

  it('physics → modifier : valide (les types Positions matchent)', () => {
    expect(spliceRejectionReason('Bouncing', 'Output', 'Scale', undefined, 'in')).toBeNull();
  });

  it('cible composite : valide (modifier → Sequence.a est Positions)', () => {
    expect(spliceRejectionReason('Circular', 'Sequence', 'Scale', undefined, 'a')).toBeNull();
  });

  it('plugin modifier : insérable sur une edge trajectoire', () => {
    expect(spliceRejectionReason('Circular', 'Output', 'Plugin', 'modifier', 'in')).toBeNull();
  });

  it('plugin composite : refusé (input_b resterait pendante)', () => {
    const reason = spliceRejectionReason('Circular', 'Output', 'Plugin', 'composite', 'in');
    expect(reason).toMatch(/single Positions input/);
  });

  it('composite natif (Mix) : refusé', () => {
    const reason = spliceRejectionReason('Circular', 'Output', 'Mix', undefined, 'in');
    expect(reason).toMatch(/single Positions input/);
  });

  it('engine : refusé (pas alimentable par une trajectoire)', () => {
    const reason = spliceRejectionReason('Circular', 'Output', 'Spiral', undefined, 'in');
    expect(reason).toMatch(/single Positions input/);
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
