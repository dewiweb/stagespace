// Safe wrappers for Tauri APIs — works in both Tauri window and plain browser
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

let isTauriAvailable: boolean | null = null;

export function checkTauri(): boolean {
  if (isTauriAvailable !== null) return isTauriAvailable;
  isTauriAvailable = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return isTauriAvailable;
}

/// Erreur IPC typée renvoyée par les commands backend migrées à `IpcError`.
/// `code` est stable (snake_case) — matchable programmatiquement ;
/// `message` reste lisible (`e.message` fonctionne partout).
/// Type généré depuis Rust via ts-rs — ne pas éditer le miroir.
import type { IpcError } from '../types/generated/IpcError';
export type { IpcError };
export type IpcErrorPayload = IpcError;

export class BackendError extends Error {
  readonly code: string;
  constructor(payload: IpcErrorPayload) {
    super(payload.message);
    this.name = 'BackendError';
    this.code = payload.code;
  }
}

function isIpcError(e: unknown): e is IpcErrorPayload {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as IpcErrorPayload).code === 'string' &&
    typeof (e as IpcErrorPayload).message === 'string'
  );
}

/// Canal de santé backend — le store s'enregistre (inversion de dépendance :
/// tauri.ts ne peut pas importer useShowStatusStore sans cycle).
let _health: { down: () => void; up: () => void } | null = null;
export function registerBackendHealth(h: { down: () => void; up: () => void }) {
  _health = h;
}

let _lastSilentWarn = 0;

/// Drop-in `.catch()` pour les IPC fire-and-forget : avale la rejection
/// (l'appelant s'en fiche) MAIS flag `backendDown` pour que l'UI montre
/// l'indicateur "backend absent" — un catch(()=>{}) aveugle cache la mort
/// du backend en live. Aussi visible en dev via warn rate-limité.
export function silentCatch(e: unknown): void {
  _health?.down();
  const now = Date.now();
  if (now - _lastSilentWarn > 30_000) {
    _lastSilentWarn = now;
    console.warn('[silentCatch] backend call failed silently:', e);
  }
}

export async function safeInvoke<T = any>(cmd: string, args?: Record<string, any>): Promise<T> {
  if (!checkTauri()) {
    throw new Error(`Tauri not available: invoke("${cmd}") called in browser mode`);
  }
  try {
    const result = await tauriInvoke<T>(cmd, args);
    // Un invoke réussi prouve que le backend vit — clear l'indicateur.
    _health?.up();
    return result;
  } catch (e) {
    // Les commands typées renvoient {code, message} — les wrappe en Error
    // pour que String(e)/e.message restent lisibles dans les toasts, avec
    // `code` dispo pour les décisions programmatiques.
    throw isIpcError(e) ? new BackendError(e) : e;
  }
}

/// Log un message vers stderr du backend (visible dans le terminal)
export function feLog(message: string): void {
  if (checkTauri()) {
    tauriInvoke('frontend_log', { message }).catch(() => {});
  }
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
