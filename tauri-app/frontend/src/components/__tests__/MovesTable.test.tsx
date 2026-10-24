/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MovesTable from '../MovesTable';
import { useGraphStore } from '../../store/useGraphStore';
import { useMoveEditorStore } from '../../store/useMoveEditorStore';
import { resetStore, makeSlot, getInvokeCalls, clearInvokeCalls } from '../../store/__tests__/testHelpers';

beforeEach(() => {
  resetStore();
  // Reset animation store
  useMoveEditorStore.setState({
    animations: [],
    current: null,
    activeMovementIds: [],
    showExpert: false,
  } as any);
  clearInvokeCalls();
});

describe('MovesTable — rendering', () => {
  it('renders empty state with "+ Move" button', () => {
    render(<MovesTable />);
    expect(screen.getByText('+ Move')).toBeInTheDocument();
    expect(screen.getByText(/No move configured/i)).toBeInTheDocument();
  });

  it('renders header with "Moves" title', () => {
    render(<MovesTable />);
    expect(screen.getByText('Moves')).toBeInTheDocument();
  });

  it('shows "GO All" and "Stop All" buttons when slots exist', () => {
    const slot = makeSlot({ id: 'slot-1', name: 'Circle 1' });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    expect(screen.getByText('▶ GO All')).toBeInTheDocument();
    expect(screen.getByText('■ Stop All')).toBeInTheDocument();
  });

  it('hides "GO All" and "Stop All" when no slots', () => {
    render(<MovesTable />);
    expect(screen.queryByText('▶ GO All')).not.toBeInTheDocument();
    expect(screen.queryByText('■ Stop All')).not.toBeInTheDocument();
  });
});

describe('MovesTable — add move', () => {
  it('clicking "+ Move" creates a new slot', () => {
    render(<MovesTable />);
    fireEvent.click(screen.getByText('+ Move'));
    const slots = (useGraphStore.getState() as any).moveSlots;
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe('Move 1');
  });

  it('clicking "+ Create the first move" in empty state creates a slot', () => {
    render(<MovesTable />);
    fireEvent.click(screen.getByText('+ Create the first move'));
    const slots = (useGraphStore.getState() as any).moveSlots;
    expect(slots).toHaveLength(1);
  });
});

describe('MovesTable — slot display', () => {
  it('displays slot name and template', () => {
    const slot = makeSlot({ id: 'slot-1', name: 'My Circle', templateId: 'circle' });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    expect(screen.getByText('My Circle')).toBeInTheDocument();
  });

  it('displays track count', () => {
    const slot = makeSlot({ id: 'slot-1', trackIds: [1, 2, 3, 4, 5] });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    expect(screen.getByText('5tr')).toBeInTheDocument();
  });

  it('shows playing count in header when slot is active', () => {
    const slot = makeSlot({ id: 'slot-1', movementId: 'mv-1' });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    expect(screen.getByText('1 live')).toBeInTheDocument();
  });

  it('shows stopped count when slot is not playing', () => {
    const slot = makeSlot({ id: 'slot-1', movementId: null });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    expect(screen.getByText('1 ready')).toBeInTheDocument();
  });
});

describe('MovesTable — play/stop', () => {
  it('clicking ▶ play button calls playSlot', async () => {
    const slot = makeSlot({ id: 'slot-1', movementId: null });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    const playBtn = screen.getByTitle(/Launch live/i);
    fireEvent.click(playBtn);
    await new Promise((r) => setTimeout(r, 100));
    const calls = getInvokeCalls();
    expect(calls.some((c) => c.cmd === 'activate_move')).toBe(true);
  });

  it('clicking ■ stop button calls deactivate_move when playing', async () => {
    const slot = makeSlot({ id: 'slot-1', movementId: 'mv-1' });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    const stopBtn = screen.getByTitle(/Immediate stop/i);
    fireEvent.click(stopBtn);
    await new Promise((r) => setTimeout(r, 100));
    const calls = getInvokeCalls();
    expect(calls.some((c) => c.cmd === 'deactivate_move')).toBe(true);
  });

  it('clicking ■ Stop All calls deactivate_move for all active slots', async () => {
    const slot1 = makeSlot({ id: 'slot-1', movementId: 'mv-1' });
    const slot2 = makeSlot({ id: 'slot-2', movementId: 'mv-2', name: 'Move 2' });
    useGraphStore.setState({ moveSlots: [slot1, slot2] } as any);
    render(<MovesTable />);
    fireEvent.click(screen.getByText('■ Stop All'));
    await new Promise((r) => setTimeout(r, 100));
    const calls = getInvokeCalls().filter((c) => c.cmd === 'deactivate_move');
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('MovesTable — setlist', () => {
  it('clicking ★ adds slot to setlist', () => {
    const slot = makeSlot({ id: 'slot-1' });
    useGraphStore.setState({ moveSlots: [slot], setlistOrder: [] } as any);
    render(<MovesTable />);
    const starBtn = screen.getByTitle(/Add to the show setlist/i);
    fireEvent.click(starBtn);
    expect((useGraphStore.getState() as any).setlistOrder).toContain('slot-1');
  });

  it('shows setlist bar when slots are in setlist', () => {
    const slot = makeSlot({ id: 'slot-1', name: 'Opening' });
    useGraphStore.setState({ moveSlots: [slot], setlistOrder: ['slot-1'] } as any);
    render(<MovesTable />);
    expect(screen.getByText('Setlist')).toBeInTheDocument();
    expect(screen.getByText('GO ▶')).toBeInTheDocument();
  });

  it('clicking GO ▶ calls goToNextMove', async () => {
    const slot = makeSlot({ id: 'slot-1', name: 'Opening' });
    useGraphStore.setState({
      moveSlots: [slot],
      setlistOrder: ['slot-1'],
      currentSetlistIndex: -1,
    } as any);
    render(<MovesTable />);
    fireEvent.click(screen.getByText('GO ▶'));
    await new Promise((r) => setTimeout(r, 200));
    // After GO, playSlot should have been called
    const calls = getInvokeCalls();
    expect(calls.some((c) => c.cmd === 'activate_move')).toBe(true);
  });
});

describe('MovesTable — preview toggle', () => {
  it('clicking ◉ toggles preview mode', () => {
    const slot = makeSlot({ id: 'slot-1', isPreview: false });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    const previewBtn = screen.getByTitle(/Mode Live/i);
    fireEvent.click(previewBtn);
    const slots = (useGraphStore.getState() as any).moveSlots;
    expect(slots[0].isPreview).toBe(true);
  });
});

describe('MovesTable — slot selection', () => {
  it('clicking a slot row selects it for editing', () => {
    const slot = makeSlot({ id: 'slot-1', name: 'Test Move' });
    useGraphStore.setState({ moveSlots: [slot], editingSlotId: null } as any);
    render(<MovesTable />);
    // Click on the slot name
    fireEvent.click(screen.getByText('Test Move'));
    expect((useGraphStore.getState() as any).editingSlotId).toBe('slot-1');
  });
});

describe('MovesTable — remove slot', () => {
  it('clicking ✕ opens a confirmation — delete only after confirm', () => {
    const slot = makeSlot({ id: 'slot-1', name: 'To Remove' });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    const removeBtn = screen.getByTitle(/Delete this slot/i);
    fireEvent.click(removeBtn);
    // Le slot n'est pas supprimé tant que le modal n'est pas confirmé
    expect((useGraphStore.getState() as any).moveSlots).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect((useGraphStore.getState() as any).moveSlots).toHaveLength(0);
  });

  it('cancelling the confirmation keeps the slot', () => {
    const slot = makeSlot({ id: 'slot-1', name: 'To Remove' });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    render(<MovesTable />);
    fireEvent.click(screen.getByTitle(/Delete this slot/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((useGraphStore.getState() as any).moveSlots).toHaveLength(1);
  });
});
