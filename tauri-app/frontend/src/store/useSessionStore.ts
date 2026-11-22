/// État de session document — dirty flag ("modifié depuis le dernier
/// save"), chemin du show courant et liste des shows récents.
///
/// Pourquoi un store à part : ce n'est NI du contenu de show (l'enveloppe
/// .hfg) NI du runtime — c'est la mémoire de la relation entre le
/// document en mémoire et le fichier sur disque. Persisté en localStorage
/// pour qu'un crash/reload conserve le flag dirty (→ prompt recovery).
import { create } from 'zustand';
import { safeSetItem, safeParseStoredJson } from '../utils/safeStorage';

const SESSION_KEY = 'stagespace-session';
const MAX_RECENT = 8;

interface SessionPersist {
  dirty: boolean;
  currentShowPath: string | null;
  recentShows: string[];
}

function loadSession(): SessionPersist {
  const p = safeParseStoredJson<SessionPersist | null>(SESSION_KEY, null);
  return {
    dirty: p?.dirty ?? false,
    currentShowPath: p?.currentShowPath ?? null,
    recentShows: Array.isArray(p?.recentShows) ? p.recentShows.slice(0, MAX_RECENT) : [],
  };
}

interface SessionStore extends SessionPersist {
  markDirty: () => void;
  /// Save/load/new réussi → clean. `path` renseigné = mémorise le chemin
  /// courant + tête des recents ; omis = clean sans toucher au chemin
  /// (pull remote, load enveloppe sans path).
  markClean: (path?: string | null) => void;
  /// Show nouveau/vide — clean et plus de chemin (untitled).
  markUntitled: () => void;
}

const persist = (s: SessionPersist) => safeSetItem(SESSION_KEY, JSON.stringify(s));

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...loadSession(),

  markDirty: () => {
    if (get().dirty) return;
    set({ dirty: true });
    persist({ dirty: true, currentShowPath: get().currentShowPath, recentShows: get().recentShows });
  },

  markClean: (path) => {
    if (path === undefined) {
      set({ dirty: false });
      persist({ dirty: false, currentShowPath: get().currentShowPath, recentShows: get().recentShows });
      return;
    }
    // New show (path === null) : le document n'a plus de fichier associé.
    const recentShows = path
      ? [path, ...get().recentShows.filter((p) => p !== path)].slice(0, MAX_RECENT)
      : get().recentShows;
    set({ dirty: false, currentShowPath: path, recentShows });
    persist({ dirty: false, currentShowPath: path, recentShows });
  },

  markUntitled: () => {
    set({ dirty: false, currentShowPath: null });
    persist({ dirty: false, currentShowPath: null, recentShows: get().recentShows });
  },
}));
