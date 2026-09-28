/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusBar from '../StatusBar';
import { useGraphStore } from '../../store/useGraphStore';
import { resetStore, clearInvokeCalls } from '../../store/__tests__/testHelpers';

beforeEach(() => {
  resetStore();
  clearInvokeCalls();
});

describe('StatusBar — engine status', () => {
  it('shows Idle with no movements', () => {
    render(<StatusBar />);
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('shows live count when movements are active', () => {
    useGraphStore.setState({
      movements: [{ id: 'mv-1' }, { id: 'mv-2' }] as any,
    } as any);
    render(<StatusBar />);
    expect(screen.getByText('2 live')).toBeInTheDocument();
  });

  it('shows Compiled status', () => {
    useGraphStore.setState({ status: 'compiled', movements: [] } as any);
    render(<StatusBar />);
    expect(screen.getByText('Compiled')).toBeInTheDocument();
  });
});

describe('StatusBar — perf stats', () => {
  it('shows perf stats when movements are active', () => {
    useGraphStore.setState({
      movements: [{ id: 'mv-1' }] as any,
      perfStats: { fps: 60, oscRate: 480, latencyMs: 1.5, cpuPercent: 5, oscErrorRate: 0, threadDied: false },
    } as any);
    render(<StatusBar />);
    expect(screen.getByText('60 FPS')).toBeInTheDocument();
    expect(screen.getByText('480 osc/s')).toBeInTheDocument();
    expect(screen.getByText('5% cpu')).toBeInTheDocument();
  });

  it('hides perf stats when no movements', () => {
    useGraphStore.setState({
      movements: [] as any,
      perfStats: { fps: 60, oscRate: 480, latencyMs: 1.5, cpuPercent: 5 },
    } as any);
    render(<StatusBar />);
    expect(screen.queryByText('60 FPS')).not.toBeInTheDocument();
  });

  it('shows MERGE DEAD when the merge thread died', () => {
    useGraphStore.setState({
      movements: [{ id: 'mv-1' }] as any,
      perfStats: { fps: 0, oscRate: 0, latencyMs: 0, cpuPercent: 0, oscErrorRate: 0, threadDied: true },
    } as any);
    render(<StatusBar />);
    expect(screen.getByText('MERGE DEAD')).toBeInTheDocument();
  });
});

describe('StatusBar — errors', () => {
  it('shows a dismissible error pill for compileError', () => {
    useGraphStore.setState({ compileError: 'Test error', movements: [] } as any);
    render(<StatusBar />);
    expect(screen.getByText(/Compile: Test error/i)).toBeInTheDocument();
  });

  it('dismisses the error on click', () => {
    useGraphStore.setState({ compileError: 'Test error', movements: [] } as any);
    render(<StatusBar />);
    fireEvent.click(screen.getByText(/Compile: Test error/i));
    expect((useGraphStore.getState() as any).compileError).toBeNull();
  });
});

describe('StatusBar — OSC destination', () => {
  it('shows the OSC output destination', () => {
    render(<StatusBar />);
    expect(screen.getByText(/→.*127\.0\.0\.1:\d+/)).toBeInTheDocument();
  });
});
