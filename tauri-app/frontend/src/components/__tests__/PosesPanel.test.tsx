/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PosesPanel } from '../conduite/PosesPanel';
import { resetStore, getInvokeCalls, clearInvokeCalls, setInvokeResponse } from '../../store/__tests__/testHelpers';
import { usePoseStore } from '../../store/usePoseStore';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetStore();
  clearInvokeCalls();
  // pose_list/pose_capture répondent — sinon le store reçoit undefined.
  setInvokeResponse('pose_list', []);
  setInvokeResponse('pose_capture', { name: 'x', positions: {} });
  usePoseStore.setState({ poses: [], selectedPoseName: null });
});

const typeNameAndCapture = async (name: string) => {
  fireEvent.change(screen.getByPlaceholderText('pose name…'), { target: { value: name } });
  fireEvent.click(screen.getByText('● cap'));
  await waitFor(() => {
    expect(getInvokeCalls().some((c) => c.cmd === 'pose_capture')).toBe(true);
  });
  return getInvokeCalls().find((c) => c.cmd === 'pose_capture')!;
};

describe('PosesPanel — capture distribution', () => {
  it('sans sélection explicite, capture TOUTES les tracks (trackIds null)', async () => {
    render(<PosesPanel />);
    const call = await typeNameAndCapture('full');
    // null → le backend capture toutes les positions connues.
    expect(call.args!.trackIds).toBeNull();
    expect(call.args!.name).toBe('full');
  });

  it('le bouton distribution affiche "all" par défaut', () => {
    render(<PosesPanel />);
    expect(screen.getByTitle(/Capture covers ALL tracks/)).toHaveTextContent('all');
  });

  it('le picker s\'ouvre avec toutes les tracks cochées — désélection restreint la capture', async () => {
    render(<PosesPanel />);
    // manualOscIds du helper = 1..9 → 9 tracks dans la grid.
    fireEvent.click(screen.getByTitle(/Capture covers ALL tracks/));
    // Modale ouverte : décocher la track 2 (cellules labellées #N).
    const cell2 = await screen.findByTitle('#2 (#2)');
    fireEvent.click(cell2);
    fireEvent.click(screen.getByText('Confirmer'));
    // Le bouton reflète la restriction : 8/9.
    expect(screen.getByText('8/9')).toBeInTheDocument();
    const call = await typeNameAndCapture('subset');
    expect(call.args!.trackIds).toHaveLength(8);
    expect(call.args!.trackIds).not.toContain(2);
    expect(call.args!.trackIds).toContain(1);
  });

  it('toutes les tracks re-cochées → retour à la capture complète (null canonique)', async () => {
    render(<PosesPanel />);
    fireEvent.click(screen.getByTitle(/Capture covers ALL tracks/));
    const cell2 = await screen.findByTitle('#2 (#2)');
    fireEvent.click(cell2); // off
    fireEvent.click(cell2); // on again → toutes cochées
    fireEvent.click(screen.getByText('Confirmer'));
    // État canonicalisé : le bouton revient à "all".
    expect(screen.getByTitle(/Capture covers ALL tracks/)).toHaveTextContent('all');
    const call = await typeNameAndCapture('backtoall');
    expect(call.args!.trackIds).toBeNull();
  });

  it('Confirmer désactivé quand aucune track cochée', async () => {
    render(<PosesPanel />);
    fireEvent.click(screen.getByTitle(/Capture covers ALL tracks/));
    // Tout décocher (9 clics)
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      fireEvent.click(await screen.findByTitle(`#${n} (#${n})`));
    }
    expect(screen.getByText('Confirmer')).toBeDisabled();
  });
});
