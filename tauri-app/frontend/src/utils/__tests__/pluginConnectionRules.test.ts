import { describe, it, expect } from 'vitest';
import { isValidConnection, getInputPorts } from '../connectionRules';

/// Parité frontend/Rust pour les règles kind-aware des nodes Plugin
/// (ABI v2) — mirror de validator.rs::is_valid_connection / has_input_port.
describe('plugin kind-aware connection rules', () => {
  it('engine plugin : seuls Objects/Duration l\'alimentent', () => {
    expect(isValidConnection('Objects', 'Plugin', 'engine')).toBe(true);
    expect(isValidConnection('Duration', 'Plugin', 'engine')).toBe(true);
    expect(isValidConnection('Circular', 'Plugin', 'engine')).toBe(false);
    expect(isValidConnection('Scale', 'Plugin', 'engine')).toBe(false);
  });

  it('modifier plugin : trajectoires + modifiers + falloffs, pas composites/physics', () => {
    expect(isValidConnection('Circular', 'Plugin', 'modifier')).toBe(true);
    expect(isValidConnection('Scale', 'Plugin', 'modifier')).toBe(true);
    expect(isValidConnection('TimeFalloff', 'Plugin', 'modifier')).toBe(true);
    expect(isValidConnection('DirectionalFalloff', 'Plugin', 'modifier')).toBe(true);
    expect(isValidConnection('MoveRef', 'Plugin', 'modifier')).toBe(true);
    expect(isValidConnection('Mix', 'Plugin', 'modifier')).toBe(false);
    expect(isValidConnection('Bouncing', 'Plugin', 'modifier')).toBe(false);
    expect(isValidConnection('Objects', 'Plugin', 'modifier')).toBe(false);
    expect(isValidConnection('Duration', 'Plugin', 'modifier')).toBe(false);
  });

  it('composite plugin : composites + physics OK, falloffs limités exclus', () => {
    expect(isValidConnection('Mix', 'Plugin', 'composite')).toBe(true);
    expect(isValidConnection('Group', 'Plugin', 'composite')).toBe(true);
    expect(isValidConnection('Bouncing', 'Plugin', 'composite')).toBe(true);
    expect(isValidConnection('Circular', 'Plugin', 'composite')).toBe(true);
    expect(isValidConnection('DirectionalFalloff', 'Plugin', 'composite')).toBe(false);
    expect(isValidConnection('Objects', 'Plugin', 'composite')).toBe(false);
  });

  it('kind inconnu (plugin manquant) : superset permissif', () => {
    expect(isValidConnection('Objects', 'Plugin')).toBe(true);
    expect(isValidConnection('Duration', 'Plugin')).toBe(true);
    expect(isValidConnection('Circular', 'Plugin')).toBe(true);
    expect(isValidConnection('Mix', 'Plugin')).toBe(true);
  });

  it('ports d\'entrée dictés par le kind', () => {
    expect(getInputPorts('Plugin', 'engine')).toEqual(['input', 'duration']);
    expect(getInputPorts('Plugin', 'modifier')).toEqual(['input']);
    expect(getInputPorts('Plugin', 'composite')).toEqual(['input', 'input_a', 'input_b']);
    expect(getInputPorts('Plugin')).toEqual(['input', 'input_a', 'input_b', 'duration']);
  });

  it('plugin en sortie : sémantique engine (l\'arm `from` est kind-blind)', () => {
    expect(isValidConnection('Plugin', 'Output')).toBe(true);
    expect(isValidConnection('Plugin', 'Scale')).toBe(true);
    expect(isValidConnection('Plugin', 'Sequence')).toBe(true);
    expect(isValidConnection('Plugin', 'Objects')).toBe(false);
  });
});
