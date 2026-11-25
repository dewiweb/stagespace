/// <reference types="vitest/globals" />
/// ScorePoseEditor — l'édition numérique des poses : brouillon local,
/// dirty tracking, add/remove tracks, save atomique via pose_save.
import { describe, expect, it, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ScorePoseEditor } from '../ScorePoseEditor';
import { usePoseStore } from '../../../store/usePoseStore';
import { useGraphStore } from '../../../store/useGraphStore';
import { resetStore, clearInvokeCalls, getInvokeCalls, setInvokeResponse } from '../../../store/__tests__/testHelpers';
import type { Pose } from '../../../types/generated/Pose';

const pose: Pose = {
  name: 'line-up',
  positions: { 1: [2, 1.5, 0], 3: [-2.5, 2, 0] },
};

beforeEach(() => {
  resetStore();
  clearInvokeCalls();
  usePoseStore.setState({ poses: [pose], selectedPoseName: null });
  // T1 patchée, T3 hors mapping → couverture du marquage amber.
  useGraphStore.setState({ manualOscIds: [1] } as any);
  setInvokeResponse('pose_save', null);
  setInvokeResponse('pose_list', [pose]);
});

describe('ScorePoseEditor', () => {
  it('affiche les tracks triées avec leurs positions', () => {
    render(<ScorePoseEditor pose={pose} onInsert={() => {}} />);
    expect(screen.getByText(/^T1/)).toBeTruthy();
    expect(screen.getByText(/^T3/)).toBeTruthy();
    // Track 3 hors du mapping (défaut [1,2]) → marquée amber ; T1 patchée.
    expect(screen.getByText(/^T3/).textContent).toContain('⚠');
    expect(screen.getByText(/^T1$/).textContent).not.toContain('⚠');
  });

  it('save désactivé sans modification, activé dès un edit', () => {
    render(<ScorePoseEditor pose={pose} onInsert={() => {}} />);
    const saveBtn = screen.getByText('✓ save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    // Edit d'un axe — premier input number de la première row (x de T1)
    const inputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(inputs[0], { target: { value: '5' } });
    expect(saveBtn.disabled).toBe(false);
    expect(screen.getByText('modifié')).toBeTruthy();
  });

  it('save → pose_save avec le brouillon complet', async () => {
    render(<ScorePoseEditor pose={pose} onInsert={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(inputs[0], { target: { value: '5' } });
    fireEvent.click(screen.getByText('✓ save'));
    await new Promise((r) => setTimeout(r, 0));
    const calls = getInvokeCalls().filter((c) => c.cmd === 'pose_save');
    expect(calls).toHaveLength(1);
    expect(calls[0].args!.pose.positions['1']).toEqual([5, 1.5, 0]);
    expect(calls[0].args!.pose.positions['3']).toEqual([-2.5, 2, 0]); // inchangé
  });

  it('add track — nouvelle ligne à [0,0,0], incluse au save', async () => {
    render(<ScorePoseEditor pose={pose} onInsert={() => {}} />);
    const input = screen.getByPlaceholderText(/\+ track/);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByText('+ add'));
    expect(screen.getByText(/T7/)).toBeTruthy();
    fireEvent.click(screen.getByText('✓ save'));
    await new Promise((r) => setTimeout(r, 0));
    const calls = getInvokeCalls().filter((c) => c.cmd === 'pose_save');
    expect(calls[0].args!.pose.positions['7']).toEqual([0, 0, 0]);
  });

  it('remove track — exclue du save', async () => {
    render(<ScorePoseEditor pose={pose} onInsert={() => {}} />);
    const removeButtons = screen.getAllByTitle(/Remove track/);
    fireEvent.click(removeButtons[0]); // retire T1
    fireEvent.click(screen.getByText('✓ save'));
    await new Promise((r) => setTimeout(r, 0));
    const calls = getInvokeCalls().filter((c) => c.cmd === 'pose_save');
    expect(calls[0].args!.pose.positions['1']).toBeUndefined();
    expect(calls[0].args!.pose.positions['3']).toEqual([-2.5, 2, 0]);
  });

  it('revert — abandonne le brouillon', () => {
    render(<ScorePoseEditor pose={pose} onInsert={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(inputs[0], { target: { value: '9' } });
    fireEvent.click(screen.getByText('revert'));
    expect((inputs[0] as HTMLInputElement).value).toBe('2');
    expect((screen.getByText('✓ save') as HTMLButtonElement).disabled).toBe(true);
  });
});
