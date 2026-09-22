import { toast } from '../store/useToastStore';

/// Wrapper localStorage qui alerte l'utilisateur en cas de quota dépassé ou corruption.
/// En live, perdre silencieusement un setlist = désastre.
let quotaWarningShown = false;

export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    const msg = String(e);
    if (msg.includes('QuotaExceeded') || msg.includes('NS_ERROR_DOM_QUOTA')) {
      if (!quotaWarningShown) {
        quotaWarningShown = true;
        toast.error(
          'Storage full! Your work is NOT being saved. Export your show file (.json) immediately.',
          0, // sticky — ne disparaît pas
        );
      }
    } else {
      toast.error(`Save failed: ${msg}`, 5000);
    }
    return false;
  }
}

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    toast.error(`Failed to read saved data: ${e}`, 5000);
    return null;
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // removeItem ne lance normalement pas
  }
}

/// Parse une valeur JSON depuis localStorage de façon sûre.
/// En cas de corruption : toast sticky + la valeur brute est préservée sous
/// `key + '.corrupt'` pour permettre une récupération manuelle.
/// (Un show perdu silencieusement en live = désastre.)
export function safeParseStoredJson<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    toast.error(`Failed to read saved data: ${e}`, 5000);
    return fallback;
  }
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    try {
      localStorage.setItem(`${key}.corrupt`, raw);
      // Purger la clé d'origine — sinon chaque boot re-parse, re-backup et
      // réaffiche le toast sticky jusqu'à intervention manuelle.
      localStorage.removeItem(key);
    } catch {
      // Même le backup peut échouer (quota) — le toast ci-dessous suffit
    }
    toast.error(
      `Saved data "${key}" is corrupted — backed up under "${key}.corrupt" and reset to defaults.`,
      0, // sticky — l'utilisateur doit voir ça
    );
    return fallback;
  }
}

/// Écriture debounced (trailing edge) pour les hot paths — les sliders qui
/// appellent à chaque pointermove ne doivent pas sérialiser toute la librairie
/// de façon synchrone à 60Hz (jank garanti sur le main thread).
///
/// La dernière valeur gagne ; flush automatique sur pagehide pour ne pas
/// perdre l'état si l'onglet se ferme pendant la fenêtre de debounce.
const pendingWrites = new Map<string, string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const STORAGE_DEBOUNCE_MS = 250;

export function debouncedSetItem(key: string, value: string): void {
  pendingWrites.set(key, value);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPendingWrites, STORAGE_DEBOUNCE_MS);
}

/// Écrit immédiatement tout ce qui est en attente de debounce.
export function flushPendingWrites(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const [key, value] of pendingWrites) {
    safeSetItem(key, value);
  }
  pendingWrites.clear();
}

// Flush à la fermeture/masquage de l'onglet — sinon la dernière frame d'un
// drag peut être perdue (250ms de fenêtre).
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingWrites);
}

/// Estime l'espace localStorage utilisé (en KB)
export function getStorageUsageKB(): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key) ?? '';
        total += key.length + val.length;
      }
    }
  } catch {
    // localStorage inaccessible — estimation retournée = 0
  }
  return Math.round(total / 1024);
}
