/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AudioPanel from '../AudioPanel';
import { useGraphStore } from '../../store/useGraphStore';
import { resetStore, getInvokeCalls, setInvokeResponse } from '../../store/__tests__/testHelpers';

beforeEach(() => {
  resetStore();
  setInvokeResponse('list_audio_devices', [{ id: 'dev1', name: 'Mic' }]);
});

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

const expandAndStart = async () => {
  // Le panneau démarre replié : déplier puis Start
  fireEvent.click(screen.getByTitle('Show audio input controls'));
  const start = await screen.findByText('Start');
  fireEvent.click(start);
  await waitFor(() => expect(useGraphStore.getState().audioListening).toBe(true));
};

describe('AudioPanel — capture découplée du cycle de vie du panneau', () => {
  it('NE stoppe PAS la capture au démontage (collapse / Perform / volet masqué)', async () => {
    const { unmount } = render(<AudioPanel />);
    await expandAndStart();

    expect(calls('start_audio_capture')).toHaveLength(1);

    // Régression : l'unmount (volet droit masqué, panneau replié, mode
    // Perform) ne doit PAS appeler stop_audio_capture — la capture appartient
    // au backend, pas à ce composant.
    unmount();
    expect(calls('stop_audio_capture')).toHaveLength(0);
  });

  it('au remount, affiche encore Active/Stop sans re-start', async () => {
    const first = render(<AudioPanel />);
    await expandAndStart();
    first.unmount();

    const second = render(<AudioPanel />);
    // Le header reflète l'état store : capture toujours "Active"
    fireEvent.click(second.container.querySelector('button')!);
    await screen.findByText('Stop');
    expect(calls('start_audio_capture')).toHaveLength(1); // pas de doublon
    second.unmount();
  });

  it('un start échoué laisse audioListening à false', async () => {
    setInvokeResponse('start_audio_capture', new Error('no device'));
    render(<AudioPanel />);
    fireEvent.click(screen.getByTitle('Show audio input controls'));
    fireEvent.click(await screen.findByText('Start'));
    await screen.findByText(/no device/);
    expect(useGraphStore.getState().audioListening).toBe(false);
  });

  it('Stop explicite appelle stop_audio_capture', async () => {
    render(<AudioPanel />);
    await expandAndStart();
    fireEvent.click(await screen.findByText('Stop'));
    await waitFor(() => expect(calls('stop_audio_capture')).toHaveLength(1));
    expect(useGraphStore.getState().audioListening).toBe(false);
  });
});
