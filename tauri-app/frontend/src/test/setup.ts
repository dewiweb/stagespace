/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import { vi } from 'vitest';

// Mock useAnimationStore with mutable state
export const mockAnimState = { activeMovementIds: [] as string[] };
vi.mock('../store/useAnimationStore', () => ({
  useAnimationStore: {
    getState: () => mockAnimState,
  },
}));

// Mock safeInvoke/safeListen — captures invoke calls
const invokeCalls: Array<{ cmd: string; args?: Record<string, any> }> = [];
vi.mock('../utils/tauri', () => ({
  safeInvoke: async <T = any>(cmd: string, args?: Record<string, any>): Promise<T> => {
    invokeCalls.push({ cmd, args });
    if (cmd === 'list_active_moves') return [] as unknown as T;
    if (cmd === 'load_graph_from_file') return { nodes: [], edges: [] } as unknown as T;
    return undefined as unknown as T;
  },
  safeListen: async () => () => {},
  checkTauri: () => true,
}));

// Mock @tauri-apps/api/core and event (in case any code imports directly)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, any>) => {
    invokeCalls.push({ cmd, args });
    return undefined;
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-shell', () => ({
  Shell: { open: vi.fn() },
}));

// Expose helpers for tests
export function getInvokeCalls(): Array<{ cmd: string; args?: Record<string, any> }> {
  return invokeCalls;
}
export function clearInvokeCalls(): void {
  invokeCalls.length = 0;
}

// Ensure localStorage exists (jsdom usually has it)
if (typeof window !== 'undefined' && !window.localStorage) {
  const store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    },
  });
}
