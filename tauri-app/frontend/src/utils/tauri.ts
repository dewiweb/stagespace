// Safe wrappers for Tauri APIs — works in both Tauri window and plain browser
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

let isTauriAvailable: boolean | null = null;

export function checkTauri(): boolean {
  if (isTauriAvailable !== null) return isTauriAvailable;
  isTauriAvailable = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return isTauriAvailable;
}

export async function safeInvoke<T = any>(cmd: string, args?: Record<string, any>): Promise<T> {
  if (!checkTauri()) {
    throw new Error(`Tauri not available: invoke("${cmd}") called in browser mode`);
  }
  return tauriInvoke<T>(cmd, args);
}

export async function safeListen<T = any>(
  event: string,
  handler: (payload: { payload: T }) => void,
): Promise<() => void> {
  if (!checkTauri()) {
    // Return a no-op unlisten function
    return () => {};
  }
  return tauriListen<T>(event, handler);
}
