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
  } catch {}
  return Math.round(total / 1024);
}
