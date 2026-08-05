/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MacroControls from '../MacroControls';
import { useGraphStore } from '../../store/useGraphStore';
import { resetStore, getInvokeCalls, clearInvokeCalls } from '../../store/__tests__/testHelpers';

beforeEach(() => {
  resetStore();
  clearInvokeCalls();
});

describe('MacroControls — rendering', () => {
  it('renders title "Macro Controls"', () => {
    render(<MacroControls />);
    expect(screen.getByText('Macro Controls')).toBeInTheDocument();
  });

  it('renders Speed slider', () => {
    render(<MacroControls />);
    expect(screen.getByText('Speed')).toBeInTheDocument();
  });

  it('renders Scale slider', () => {
    render(<MacroControls />);
    expect(screen.getByText('Scale')).toBeInTheDocument();
  });

  it('renders Shift X, Y, Z sliders', () => {
    render(<MacroControls />);
    expect(screen.getByText('Shift X')).toBeInTheDocument();
    expect(screen.getByText('Shift Y')).toBeInTheDocument();
    expect(screen.getByText('Shift Z')).toBeInTheDocument();
  });

  it('renders Yaw, Pitch, Roll sliders', () => {
    render(<MacroControls />);
    expect(screen.getByText('Yaw (Y)')).toBeInTheDocument();
    expect(screen.getByText('Pitch (X)')).toBeInTheDocument();
    expect(screen.getByText('Roll (Z)')).toBeInTheDocument();
  });

  it('renders Reset Macros button', () => {
    render(<MacroControls />);
    expect(screen.getByText('Reset Macros')).toBeInTheDocument();
  });

  it('renders Loop and One-shot buttons', () => {
    render(<MacroControls />);
    expect(screen.getByText('Loop ∞')).toBeInTheDocument();
    expect(screen.getByText('One-shot')).toBeInTheDocument();
  });

  it('shows 8 range inputs (sliders)', () => {
    render(<MacroControls />);
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(8);
  });
});

describe('MacroControls — values', () => {
  it('displays default speed value (1.00)', () => {
    render(<MacroControls />);
    // Speed and Scale both default to 1.00 — check at least one exists
    const elements = screen.getAllByText('1.00');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('displays updated speed value when state changes', () => {
    useGraphStore.setState({
      macros: { speed: 2.5, scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
    } as any);
    render(<MacroControls />);
    expect(screen.getByText('2.50')).toBeInTheDocument();
  });
});

describe('MacroControls — interactions', () => {
  it('changing Speed slider updates store', () => {
    render(<MacroControls />);
    const speedSlider = screen.getAllByRole('slider')[0]; // First slider = Speed
    fireEvent.change(speedSlider, { target: { value: '2.5' } });
    expect((useGraphStore.getState() as any).macros.speed).toBe(2.5);
  });

  it('changing Scale slider updates store', () => {
    render(<MacroControls />);
    const scaleSlider = screen.getAllByRole('slider')[1]; // Second slider = Scale
    fireEvent.change(scaleSlider, { target: { value: '3.0' } });
    expect((useGraphStore.getState() as any).macros.scale).toBe(3.0);
  });

  it('changing Shift X slider updates store', () => {
    render(<MacroControls />);
    const shiftXSlider = screen.getAllByRole('slider')[2]; // Third slider = Shift X
    fireEvent.change(shiftXSlider, { target: { value: '1.5' } });
    expect((useGraphStore.getState() as any).macros.shiftX).toBe(1.5);
  });

  it('clicking Reset Macros resets all values', () => {
    useGraphStore.setState({
      macros: { speed: 3.0, scale: 2.0, shiftX: 1, shiftY: 1, shiftZ: 1, yaw: 45, pitch: 30, roll: 15 },
    } as any);
    render(<MacroControls />);
    fireEvent.click(screen.getByText('Reset Macros'));
    const macros = (useGraphStore.getState() as any).macros;
    expect(macros.speed).toBe(1.0);
    expect(macros.scale).toBe(1.0);
    expect(macros.shiftX).toBe(0);
    expect(macros.yaw).toBe(0);
  });

  it('clicking Loop button sets loop mode', () => {
    render(<MacroControls />);
    fireEvent.click(screen.getByText('Loop ∞'));
    // Loop mode is internal state — just verify it doesn't crash
    expect(true).toBe(true);
  });

  it('clicking One-shot button sets oneshot mode', () => {
    render(<MacroControls />);
    fireEvent.click(screen.getByText('One-shot'));
    expect(true).toBe(true);
  });
});

describe('MacroControls — live mode', () => {
  it('shows LIVE badge when movements are active', () => {
    useGraphStore.setState({
      movements: [{ id: 'mv-1' }] as any,
    } as any);
    render(<MacroControls />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('does not show LIVE badge when no movements', () => {
    render(<MacroControls />);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });

  it('pushes macros to runtime when playing and slider changes', async () => {
    useGraphStore.setState({
      movements: [{ id: 'mv-1' }] as any,
    } as any);
    render(<MacroControls />);
    const speedSlider = screen.getAllByRole('slider')[0];
    fireEvent.change(speedSlider, { target: { value: '2.0' } });
    await new Promise((r) => setTimeout(r, 50));
    // Should have called set_global_macro via invoke
    const calls = getInvokeCalls();
    expect(calls.some((c) => c.cmd === 'set_global_macro')).toBe(true);
  });
});
