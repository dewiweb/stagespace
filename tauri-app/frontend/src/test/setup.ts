/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

// Mock Tauri APIs for tests — captures invoke calls instead of throwing
const invokeCalls: Array<{ cmd: string; args?: Record<string, any> }> = [];

// Override safeInvoke/safeListen before any store imports
const mockInvoke = async <T = any>(cmd: string, args?: Record<string, any>): Promise<T> => {
  invokeCalls.push({ cmd, args });
  return undefined as unknown as T;
};

const mockListen = async <T = any>(
  _event: string,
  _handler: (payload: { payload: T }) => void,
): Promise<() => void> => {
  return () => {};
};

// Mock @tauri-apps/api/core and @tauri-apps/api/event
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

// Mock @tauri-apps/plugin-dialog and @tauri-apps/plugin-shell
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Shell: { open: vi.fn() },
}));

// Helper to get recorded invoke calls
export function getInvokeCalls(): Array<{ cmd: string; args?: Record<string, any> }> {
  return invokeCalls;
}

export function clearInvokeCalls(): void {
  invokeCalls.length = 0;
}

// jsdom doesn't implement localStorage by default in some versions
// but it's usually present. Ensure it exists.
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
