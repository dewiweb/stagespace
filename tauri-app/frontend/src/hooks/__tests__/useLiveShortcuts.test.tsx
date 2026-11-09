/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveShortcuts } from '../useLiveShortcuts';
import { useGraphStore, getInvokeCalls, clearInvokeCalls, resetStore } from '../../store/__tests__/testHelpers';
import { useCuelistStore } from '../../store/useCuelistStore';

// Verrouille les raccourcis live — la chaîne Esc→panic, Enter→GO,
// Shift+Enter→cue, Backspace→prev, Space→slot. Chaque touche a une
// sémantique différente : un keydown mal routé tue la scène.
const key = (k: string, opts: Partial<KeyboardEventInit> = {}, target?: EventTarget) =>
  (target ?? window).dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }),
  );

const slot = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id, name: id, oscIndex: 1, templateId: 'circle',
    graphJson: null, // null → playSlot construit un vrai graphe (preset)
    signalGraph: null, trackIds: [1], movementId: null, isPreview: false,
    ...extra,
  }) as never;

describe('useLiveShortcuts', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    useCuelistStore.setState({ cues: [], currentCueIndex: -1, isRecalling: false });
  });

  it('Esc → panic : deactivate_all_moves inconditionnel', async () => {
    renderHook(() => useLiveShortcuts());
    key('Escape');
    await new Promise((r) => setTimeout(r, 0));
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('deactivate_all_moves');
  });

  it('Esc repeat → un seul panic (pas de spam)', async () => {
    renderHook(() => useLiveShortcuts());
    key('Escape', { repeat: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('deactivate_all_moves');
  });

  it('Esc dans un champ texte → blur seulement, jamais panic', async () => {
    renderHook(() => useLiveShortcuts());
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    key('Escape', {}, input);
    await new Promise((r) => setTimeout(r, 0));
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('deactivate_all_moves');
    expect(document.activeElement).not.toBe(input);
    document.body.removeChild(input);
  });

  it('Enter → GO setlist (activate_move sur le slot suivant)', async () => {
    renderHook(() => useLiveShortcuts());
    useGraphStore.setState({
      moveSlots: [slot('s1'), slot('s2', { oscIndex: 2 })],
      setlistOrder: ['s1', 's2'],
      currentSetlistIndex: 0,
    } as never);
    key('Enter');
    await new Promise((r) => setTimeout(r, 50));
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('activate_move');
  });

  it('Shift+Enter → recall cue suivante', async () => {
    renderHook(() => useLiveShortcuts());
    useCuelistStore.setState({
      cues: [
        { id: 'c1', name: 'Cue 1', cue_number: '1', moves: [], fade_duration: 1, active_move_ids: [], mode: 'Full', scope: {}, pre_wait: 0, follow: null, timecode: null, per_track_depths: [], manual_positions: {} },
        { id: 'c2', name: 'Cue 2', cue_number: '2', moves: [], fade_duration: 1, active_move_ids: [], mode: 'Full', scope: {}, pre_wait: 0, follow: null, timecode: null, per_track_depths: [], manual_positions: {} },
      ] as never,
      currentCueIndex: -1,
    });
    key('Enter', { shiftKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('recall_cue');
  });

  it('Backspace → recall cue précédente', async () => {
    renderHook(() => useLiveShortcuts());
    useCuelistStore.setState({
      cues: [
        { id: 'c1', name: 'Cue 1', cue_number: '1', moves: [], fade_duration: 1, active_move_ids: [], mode: 'Full', scope: {}, pre_wait: 0, follow: null, timecode: null, per_track_depths: [], manual_positions: {} },
        { id: 'c2', name: 'Cue 2', cue_number: '2', moves: [], fade_duration: 1, active_move_ids: [], mode: 'Full', scope: {}, pre_wait: 0, follow: null, timecode: null, per_track_depths: [], manual_positions: {} },
      ] as never,
      currentCueIndex: 1,
    });
    key('Backspace');
    await new Promise((r) => setTimeout(r, 50));
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('recall_cue');
  });

  it('Space → joue le slot en édition', async () => {
    renderHook(() => useLiveShortcuts());
    useGraphStore.setState({ moveSlots: [slot('s1')], editingSlotId: 's1' } as never);
    key(' ');
    await new Promise((r) => setTimeout(r, 50));
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('activate_move');
  });

  it('Space sans slot sélectionné → aucun invoke (toast informatif)', async () => {
    renderHook(() => useLiveShortcuts());
    useGraphStore.setState({ moveSlots: [], editingSlotId: null } as never);
    key(' ');
    await new Promise((r) => setTimeout(r, 50));
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('activate_move');
  });

  it('keydown depuis le canvas React Flow → ignoré (Delete/Backspace suppriment des nodes)', async () => {
    renderHook(() => useLiveShortcuts());
    const canvas = document.createElement('div');
    canvas.className = 'react-flow';
    document.body.appendChild(canvas);
    key('Backspace', {}, canvas);
    await new Promise((r) => setTimeout(r, 0));
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('recall_cue');
    document.body.removeChild(canvas);
  });
});
