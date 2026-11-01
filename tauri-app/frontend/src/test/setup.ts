import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock useMoveEditorStore with mutable state
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
const useMoveEditorStoreHook: any = (selector?: (s: typeof mockAnimState) => any) => {
  if (typeof selector === 'function') return selector(mockAnimState);
  return mockAnimState;
};
useMoveEditorStoreHook.getState = () => mockAnimState;
useMoveEditorStoreHook.setState = (partial: any) => {
  if (typeof partial === 'function') partial(mockAnimState);
  else Object.assign(mockAnimState, partial);
  return mockAnimState;
};
useMoveEditorStoreHook.subscribe = () => () => {};
useMoveEditorStoreHook.getInitialState = () => mockAnimState;
vi.mock('../store/useMoveEditorStore', () => ({
  useMoveEditorStore: useMoveEditorStoreHook,
}));

// Mock safeInvoke/safeListen — captures invoke calls AND event listeners
const invokeCalls: Array<{ cmd: string; args?: Record<string, any> }> = [];
const listeners = new Map<string, Array<(e: { payload: any }) => void>>();
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
  safeListen: async (event: string, handler: (e: { payload: any }) => void) => {
    // Les listeners sont enregistrés — les tests peuvent émettre via
    // emitMockEvent (ex: show-control → useShowControl → liveActions).
    listeners.get(event)?.push(handler) ?? listeners.set(event, [handler]);
    return () => {
      const arr = listeners.get(event) ?? [];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    };
  },
  checkTauri: () => true,
  feLog: (_msg: string) => { /* no-op in tests */ },
  registerBackendHealth: (_h: { down: () => void; up: () => void }) => { /* no-op in tests */ },
  silentCatch: (_e: unknown) => { /* no-op in tests */ },
}));

// Mock @tauri-apps/api/core and event (in case any code imports directly)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, any>) => {
    invokeCalls.push({ cmd, args });
    return undefined;
  },
}));
// emit() est capturé — les tests vérifient le broadcast live:state.
const emitCalls: Array<{ event: string; payload: any }> = [];
vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
  emit: async (event: string, payload: any) => {
    emitCalls.push({ event, payload });
  },
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
/// Émet un event mocké vers les listeners enregistrés (safeListen).
export function emitMockEvent(event: string, payload: any): void {
  for (const h of listeners.get(event) ?? []) h({ payload });
}
/// Oublie tous les listeners enregistrés — isolation entre tests.
export function clearListeners(): void {
  listeners.clear();
}
/// Accès aux emit() capturés (broadcast live:state de la fenêtre
/// principale vers les détachées).
export function getEmitCalls(): Array<{ event: string; payload: any }> {
  return emitCalls;
}
export function clearEmitCalls(): void {
  emitCalls.length = 0;
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
