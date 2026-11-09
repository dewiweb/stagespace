import { describe, it, expect } from 'vitest';
import { isValidConnection, getInputPorts } from '../connectionRules';

/// Parité frontend/Rust pour les règles kind-aware des nodes Plugin
/// (ABI v2) — mirror de validator.rs::is_valid_connection / has_input_port.
describe('plugin kind-aware connection rules', () => {
  it('engine plugin : seuls Objects/Duration l\'alimentent', () => {
    expect(isValidConnection('Objects', 'Plugin', undefined, undefined, 'engine')).toBe(true);
    expect(isValidConnection('Duration', 'Plugin', undefined, undefined, 'engine')).toBe(true);
    expect(isValidConnection('Circular', 'Plugin', undefined, undefined, 'engine')).toBe(false);
    expect(isValidConnection('Scale', 'Plugin', undefined, undefined, 'engine')).toBe(false);
  });

  it('modifier plugin : trajectoires + modifiers + falloffs, pas composites/physics', () => {
    expect(isValidConnection('Circular', 'Plugin', undefined, undefined, 'modifier')).toBe(true);
    expect(isValidConnection('Scale', 'Plugin', undefined, undefined, 'modifier')).toBe(true);
    expect(isValidConnection('TimeFalloff', 'Plugin', undefined, undefined, 'modifier')).toBe(true);
    expect(isValidConnection('DirectionalFalloff', 'Plugin', undefined, undefined, 'modifier')).toBe(true);
    expect(isValidConnection('MoveRef', 'Plugin', undefined, undefined, 'modifier')).toBe(true);
    expect(isValidConnection('Mix', 'Plugin', undefined, undefined, 'modifier')).toBe(true);
    expect(isValidConnection('Bouncing', 'Plugin', undefined, undefined, 'modifier')).toBe(true);
    expect(isValidConnection('Objects', 'Plugin', undefined, undefined, 'modifier')).toBe(false);
    expect(isValidConnection('Duration', 'Plugin', undefined, undefined, 'modifier')).toBe(false);
  });

  it('composite plugin : composites + physics OK, falloffs limités exclus', () => {
    expect(isValidConnection('Mix', 'Plugin', undefined, undefined, 'composite')).toBe(true);
    expect(isValidConnection('Group', 'Plugin', undefined, undefined, 'composite')).toBe(true);
    expect(isValidConnection('Bouncing', 'Plugin', undefined, undefined, 'composite')).toBe(true);
    expect(isValidConnection('Circular', 'Plugin', undefined, undefined, 'composite')).toBe(true);
    expect(isValidConnection('DirectionalFalloff', 'Plugin', undefined, undefined, 'composite')).toBe(true);
    expect(isValidConnection('Objects', 'Plugin', undefined, undefined, 'composite')).toBe(false);
  });

  it('kind inconnu (plugin manquant) : superset permissif', () => {
    expect(isValidConnection('Objects', 'Plugin')).toBe(true);
    expect(isValidConnection('Duration', 'Plugin')).toBe(true);
    expect(isValidConnection('Circular', 'Plugin')).toBe(true);
    expect(isValidConnection('Mix', 'Plugin')).toBe(true);
  });

  it('ports d\'entrée dictés par le kind', () => {
    expect(getInputPorts('Plugin', 'engine').map((p) => p.name)).toEqual(['objects', 'duration']);
    expect(getInputPorts('Plugin', 'modifier').map((p) => p.name)).toEqual(['in']);
    expect(getInputPorts('Plugin', 'composite').map((p) => p.name)).toEqual(['a', 'b']);
    expect(getInputPorts('Plugin').map((p) => p.name)).toEqual(['objects', 'duration', 'in', 'a', 'b']);
  });

  it('plugin en sortie : sémantique engine (l\'arm `from` est kind-blind)', () => {
    expect(isValidConnection('Plugin', 'Output')).toBe(true);
    expect(isValidConnection('Plugin', 'Scale')).toBe(true);
    expect(isValidConnection('Plugin', 'Sequence')).toBe(true);
    expect(isValidConnection('Plugin', 'Objects')).toBe(false);
  });
});
