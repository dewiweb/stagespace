/// Gestes du pose-pad : tap = snap, hold ≥350ms = goto (pas de snap en
/// double au release), clic sur le nom = sélection fantômes sans snap.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { PoseTile } from '../show/PoseTile';
import type { Pose } from '../../types/generated/Pose';

const pose = { name: 'alpha', positions: { 1: [1, 0, 0], 2: [0, 1, 0] } } as unknown as Pose;

const setup = () => {
  const onSnap = vi.fn();
  const onGoto = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <PoseTile pose={pose} patchedCount={2} isSelected={false} onSnap={onSnap} onGoto={onGoto} onSelect={onSelect} />,
  );
  return { onSnap, onGoto, onSelect, pad: utils.getByRole('button', { name: /pose alpha snap/ }) };
};

describe('PoseTile', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('tap = snap instantané', () => {
    const { onSnap, onGoto, pad } = setup();
    fireEvent.pointerDown(pad);
    fireEvent.pointerUp(pad);
    fireEvent.click(pad);
    expect(onSnap).toHaveBeenCalledTimes(1);
    expect(onGoto).not.toHaveBeenCalled();
  });

  it('hold ≥350ms = goto, sans snap au release', () => {
    const { onSnap, onGoto, pad } = setup();
    fireEvent.pointerDown(pad);
    vi.advanceTimersByTime(400);
    fireEvent.pointerUp(pad);
    fireEvent.click(pad);
    expect(onGoto).toHaveBeenCalledTimes(1);
    expect(onSnap).not.toHaveBeenCalled();
  });

  it('release avant 350ms annule le goto', () => {
    const { onSnap, onGoto, pad } = setup();
    fireEvent.pointerDown(pad);
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(pad);
    vi.advanceTimersByTime(300);
    fireEvent.click(pad);
    expect(onGoto).not.toHaveBeenCalled();
    expect(onSnap).toHaveBeenCalledTimes(1);
  });

  it('clic sur le nom = sélection, pas de snap', () => {
    const { onSnap, onSelect, pad } = setup();
    const name = pad.querySelector('[role=button]')!;
    fireEvent.pointerDown(name);
    fireEvent.click(name);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSnap).not.toHaveBeenCalled();
  });
});
