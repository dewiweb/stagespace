/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { ScoreClipPicker } from '../ScoreClipPicker';
import { useLiveShortcuts } from '../../../hooks/useLiveShortcuts';
import { getInvokeCalls, clearInvokeCalls, resetStore } from '../../../store/__tests__/testHelpers';
import { useCuelistStore } from '../../../store/useCuelistStore';

/// Régression : Esc avec le picker ouvert fermait le picker ET
/// paniquait le show (raccourci global Esc→panic non bloqué).
/// Le picker est une modal via useModalGuard → Esc consommé par
/// closeTopModal, jamais deactivate_all_moves.
const Harness = ({ onClose }: { onClose: () => void }) => {
  useLiveShortcuts();
  return (
    <ScoreClipPicker
      picker={{ laneId: 'obj-1', x: 0, y: 0 }}
      moveSlots={[]}
      cues={[]}
      manualOscIds={[1]}
      onPick={() => {}}
      onClose={onClose}
    />
  );
};

describe('ScoreClipPicker — Esc modal guard', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    useCuelistStore.setState({ cues: [], currentCueIndex: -1, isRecalling: false });
  });

  it('Esc → onClose appelé une fois, panic PAS invoqué', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('deactivate_all_moves');
  });

  it('sans picker : Esc → panic (comportement inchangé)', async () => {
    const { unmount } = renderHook(() => useLiveShortcuts());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('deactivate_all_moves');
    unmount();
  });
});
