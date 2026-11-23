/// Score timeline (S2 — docs/score-sequencer.md) — le document du
/// séquenceur : pistes + clips (références vers slots/cues/markers).
/// Document state (tracks/clips/durationMs) → enveloppe .hfg + dirty
/// tracking ; transport state (playing/cursorMs) → runtime, poussé
/// par les events `score-timeline` du backend.
/// Les clips référencent les entités du show (slotId, cueId) —
/// résolution en payloads backend au play (utils/scoreResolve).
import { create } from 'zustand';
import { toast } from '../utils/toast-helpers';
import { safeInvoke as invoke, silentCatch } from '../utils/tauri';

export type ScoreTrackKind = 'slots' | 'cues' | 'markers';

export interface ScoreTrack {
  id: string;
  name: string;
  kind: ScoreTrackKind;
  muted: boolean;
}

/// Référence d'un clip — JAMAIS un snapshot : le document pointe vers
/// le slot/cue vivant (édité → le clip rejoue la version courante).
export type ScoreClipRef =
  | { type: 'slot'; slotId: string }
  | { type: 'cue'; cueId: string }
  | { type: 'stopAll' }
  | { type: 'panic' };

export interface ScoreClipDoc {
  id: string;
  trackId: string;
  startMs: number;
  /// Slots : fin auto (désactivation). Absent = le move tourne jusqu'au
  /// stop suivant/panic (clip "ouvert").
  durationMs?: number;
  ref: ScoreClipRef;
}

export interface ScoreDoc {
  tracks: ScoreTrack[];
  clips: ScoreClipDoc[];
  durationMs: number;
}

const uid = () => `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const defaultTracks = (): ScoreTrack[] => [
  { id: 'trk-slots', name: 'MOVES', kind: 'slots', muted: false },
  { id: 'trk-cues', name: 'CUES', kind: 'cues', muted: false },
  { id: 'trk-markers', name: 'MARKERS', kind: 'markers', muted: false },
];

interface ScoreState extends ScoreDoc {
  // Transport — runtime (pas dans l'enveloppe)
  playing: boolean;
  cursorMs: number;
  // Document actions
  addTrack: (kind: ScoreTrackKind, name?: string) => void;
  removeTrack: (id: string) => void;
  toggleTrackMute: (id: string) => void;
  addClip: (trackId: string, ref: ScoreClipRef, startMs: number, durationMs?: number) => ScoreClipDoc;
  moveClip: (id: string, startMs: number) => void;
  resizeClip: (id: string, durationMs: number | undefined) => void;
  removeClip: (id: string) => void;
  setDurationMs: (ms: number) => void;
  setScoreDoc: (doc: ScoreDoc | undefined) => void;
  clearScore: () => void;
  // Transport actions
  playScore: () => Promise<void>;
  stopScore: () => void;
  seekScore: (ms: number) => void;
  _setTransport: (playing: boolean, cursorMs: number) => void;
}

export const useScoreStore = create<ScoreState>()((set, get) => ({
  tracks: defaultTracks(),
  clips: [],
  durationMs: 120_000,
  playing: false,
  cursorMs: 0,

  addTrack: (kind, name) => {
    const id = uid();
    set((s) => ({
      tracks: [...s.tracks, { id, name: name ?? kind.toUpperCase(), kind, muted: false }],
    }));
  },
  removeTrack: (id) =>
    set((s) => ({
      tracks: s.tracks.filter((t) => t.id !== id),
      clips: s.clips.filter((c) => c.trackId !== id),
    })),
  toggleTrackMute: (id) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)),
    })),

  addClip: (trackId, ref, startMs, durationMs) => {
    const clip: ScoreClipDoc = { id: uid(), trackId, startMs: Math.max(0, startMs), durationMs, ref };
    set((s) => ({ clips: [...s.clips, clip] }));
    return clip;
  },
  moveClip: (id, startMs) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, startMs: Math.max(0, startMs) } : c)),
    })),
  resizeClip: (id, durationMs) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, durationMs } : c)),
    })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
  setDurationMs: (ms) => set({ durationMs: Math.max(1000, ms) }),
  setScoreDoc: (doc) =>
    set(doc ?? { tracks: defaultTracks(), clips: [], durationMs: 120_000 }),
  clearScore: () =>
    set({ tracks: defaultTracks(), clips: [], durationMs: 120_000, playing: false, cursorMs: 0 }),

  playScore: async () => {
    const s = get();
    if (s.clips.length === 0) { toast.warning('Score vide'); return; }
    try {
      const { resolveScoreClips } = await import('../utils/scoreResolve');
      const { clips, errors } = await resolveScoreClips(s);
      errors.forEach((e) => toast.warning(e));
      if (clips.length === 0) { toast.error('Score : aucun clip résolvable'); return; }
      // Seek courant = base du curseur (le backend spanne les clips à cheval).
      await invoke('score_timeline_load', { clips, durationMs: s.durationMs });
      await invoke('score_timeline_play');
      set({ playing: true });
    } catch (e) {
      toast.error('Score play failed: ' + e);
    }
  },
  stopScore: () => {
    invoke('score_timeline_stop').catch(silentCatch);
    set({ playing: false });
  },
  seekScore: (ms) => {
    invoke('score_timeline_seek', { ms }).then(() => set({ cursorMs: ms })).catch(silentCatch);
  },
  _setTransport: (playing, cursorMs) => set({ playing, cursorMs }),
}));
