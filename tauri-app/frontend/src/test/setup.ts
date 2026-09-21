/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock useAnimationStore with mutable state
export const mockAnimState = {
  activeMovementIds: [] as string[],
  showExpert: false,
  setShowExpert: (show: boolean) => { mockAnimState.showExpert = show; },
  current: null as any,
  animations: [] as any[],
  launchAnimation: async () => null,
  updateLiveAnimation: async () => {},
  setCurrent: (anim: any) => { mockAnimState.current = anim; },
  renameAnimation: (_id: string, _name: string) => {},
  deleteAnimation: (_id: string) => {},
  addAnimation: (_anim: any) => {},
};
// Create a callable function that also has getState/setState (mimics Zustand)
const useAnimationStoreHook: any = (selector?: (s: typeof mockAnimState) => any) => {
  if (typeof selector === 'function') return selector(mockAnimState);
  return mockAnimState;
};
useAnimationStoreHook.getState = () => mockAnimState;
useAnimationStoreHook.setState = (partial: any) => {
  if (typeof partial === 'function') partial(mockAnimState);
  else Object.assign(mockAnimState, partial);
  return mockAnimState;
};
useAnimationStoreHook.subscribe = () => () => {};
useAnimationStoreHook.getInitialState = () => mockAnimState;
vi.mock('../store/useAnimationStore', () => ({
  useAnimationStore: useAnimationStoreHook,
}));

// Mock safeInvoke/safeListen — captures invoke calls
const invokeCalls: Array<{ cmd: string; args?: Record<string, any> }> = [];
const invokeResponses = new Map<string, any>();
vi.mock('../utils/tauri', () => ({
  safeInvoke: async <T = any>(cmd: string, args?: Record<string, any>): Promise<T> => {
    invokeCalls.push({ cmd, args });
    if (invokeResponses.has(cmd)) {
      const r = invokeResponses.get(cmd);
      // Un Error = la commande rejette (injection de panne backend dans les tests)
      if (r instanceof Error) throw r;
      return r as T;
    }
    if (cmd === 'list_active_moves') return [] as unknown as T;
    if (cmd === 'load_graph_from_file') return { nodes: [], edges: [] } as unknown as T;
    return undefined as unknown as T;
  },
  safeListen: async () => () => {},
  checkTauri: () => true,
  feLog: (_msg: string) => { /* no-op in tests */ },
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

// Mock toast store — no-op in tests
vi.mock('../store/useToastStore', () => ({
  useToastStore: { getState: () => ({ push: () => {}, dismiss: () => {}, clear: () => {}, toasts: [] }) },
  toast: { error: () => {}, warning: () => {}, info: () => {}, success: () => {} },
}));

// Expose helpers for tests
export function getInvokeCalls(): Array<{ cmd: string; args?: Record<string, any> }> {
  return invokeCalls;
}
export function clearInvokeCalls(): void {
  invokeCalls.length = 0;
  invokeResponses.clear();
}
/// Configure la réponse mockée d'une commande IPC (ex: load_graph_from_file)
export function setInvokeResponse(cmd: string, response: any): void {
  invokeResponses.set(cmd, response);
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
