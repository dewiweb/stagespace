/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeParamsPanel } from '../panels/NodeParamsPanel';
import { useGraphStore, resetStore, makeNode } from '../../store/__tests__/testHelpers';

/// Pin-to-Perform — toggles 📌 en mode édition, filtrage curé en performMode.
/// `data.pinned` est UI-only : persisté dans le .hfg, jamais envoyé au backend.
describe('NodeParamsPanel — pin to Perform', () => {
  const graphNodes = [
    makeNode('obj-1', 'Objects', { n_objects: 4 }),
    makeNode('eng-1', 'Circular', { radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true }),
    makeNode('out-1', 'Output', {}),
  ];
  const onParam = vi.fn();

  beforeEach(() => {
    resetStore();
    useGraphStore.setState({ nodes: graphNodes } as any);
    onParam.mockClear();
  });

  it('mode édition : un toggle pin par champ', () => {
    render(<NodeParamsPanel nodes={graphNodes} live={false} onParam={onParam} />);
    // 4 params dans le schema Circular → 4 pins
    const pins = screen.getAllByTitle(/Pin to Perform|Unpin/);
    expect(pins.length).toBe(4);
  });

  it('clic sur un pin → data.pinned alimenté dans le store', () => {
    render(<NodeParamsPanel nodes={graphNodes} live={false} onParam={onParam} />);
    fireEvent.click(screen.getAllByTitle('Pin to Perform — show in the Perform params drawer')[0]);
    const node = useGraphStore.getState().nodes.find((n) => n.id === 'eng-1')!;
    expect((node.data as any).pinned).toEqual(['radius']);
  });

  it('performMode sans pin : tous les params restent accessibles', () => {
    render(<NodeParamsPanel nodes={graphNodes} live={false} performMode onParam={onParam} />);
    expect(screen.getByText('Radius')).toBeInTheDocument();
    expect(screen.getByText('Speed')).toBeInTheDocument();
    // Pas de toggles pin en performMode
    expect(screen.queryAllByTitle(/Pin to Perform|Unpin/)).toHaveLength(0);
  });

  it('performMode avec pins : seuls les params épinglés sont affichés', () => {
    const pinned = [
      makeNode('obj-1', 'Objects', { n_objects: 4 }),
      { ...graphNodes[1], data: { ...graphNodes[1].data, pinned: ['radius'] } },
      makeNode('out-1', 'Output', {}),
    ];
    render(<NodeParamsPanel nodes={pinned} live={true} performMode onParam={onParam} />);
    expect(screen.getByText('Radius')).toBeInTheDocument();
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    expect(screen.queryByText('Plane')).not.toBeInTheDocument();
    expect(screen.getByText(/pinned parameter/)).toBeInTheDocument();
  });

  it('chip : icône pin sur les nodes qui ont des params épinglés', () => {
    const pinned = [
      makeNode('obj-1', 'Objects', { n_objects: 4 }),
      { ...graphNodes[1], data: { ...graphNodes[1].data, pinned: ['speed'] } },
      makeNode('out-1', 'Output', {}),
    ];
    const { container } = render(
      <NodeParamsPanel nodes={pinned} live={false} performMode onParam={onParam} />,
    );
    // L'icône Pin lucide rend un svg dans le chip du node
    expect(container.querySelector('button svg')).toBeTruthy();
  });

  it('pinned orphelines (params absents du schema) : hint explicite', () => {
    const pinned = [
      { ...graphNodes[1], data: { ...graphNodes[1].data, pinned: ['gone_key'] } },
    ];
    render(<NodeParamsPanel nodes={pinned} live={false} performMode onParam={onParam} />);
    expect(screen.getByText(/no longer exist/)).toBeInTheDocument();
  });
});
