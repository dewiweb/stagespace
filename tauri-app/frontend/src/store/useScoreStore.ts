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
/// Comportement de la piste en chevauchement de clips (docs/score-
/// sequencer.md §Surface) : `exclusive` = last-wins console (un move
/// score à la fois — cues/markers/master), `stacked` = les clips qui
/// se chevauchent jouent simultanément, leurs sorties se composent
/// dans le merge (pistes objets).
export type ScoreLaneMode = 'exclusive' | 'stacked';

export interface ScoreTrack {
  id: string;
  name: string;
  kind: ScoreTrackKind;
  muted: boolean;
  /// Mode de chevauchement — `exclusive` par défaut (sémantique S2).
  mode?: ScoreLaneMode;
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
  /// "Clip loop" — re-déclenchement périodique : le clip tire à
  /// start + k·repeatEveryMs jusqu'à la fin de sa fenêtre (durationMs
  /// requise). Distinct du loop_mode du move (trajectoire interne) :
  /// ici chaque copie est un nouveau spawn — re-articulation rythmique.
  repeatEveryMs?: number;
  /// Fades clip-local (modèle DAW — le clip instance possède ses
  /// articulations). `undefined` = hérite les fades du slot
  /// (animation.fade_in/fade_out). fade_out joue EN TAIL après la fin
  /// du clip (EndMove à end_ms, le move s'éteint pendant son fade).
  fadeInMs?: number;
  fadeOutMs?: number;
  ref: ScoreClipRef;
}

export interface ScoreDoc {
  tracks: ScoreTrack[];
  clips: ScoreClipDoc[];
  durationMs: number;
  /// Region de boucle transport [start, end) — rebouclage hard-wrap
  /// de la partition entière (distinct du clip repeat). Les deux
  /// ensemble ou aucun.
  loopStartMs?: number;
  loopEndMs?: number;
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
  setTrackMode: (id: string, mode: ScoreLaneMode) => void;
  addClip: (trackId: string, ref: ScoreClipRef, startMs: number, durationMs?: number) => ScoreClipDoc;
  moveClip: (id: string, startMs: number) => void;
  resizeClip: (id: string, durationMs: number | undefined) => void;
  setClipRepeat: (id: string, repeatEveryMs: number | undefined) => void;
  /// Fades du clip — `undefined` = retour à l'héritage du slot.
  setClipFades: (id: string, fadeInMs: number | undefined, fadeOutMs: number | undefined) => void;
  removeClip: (id: string) => void;
  /// Copie matérielle du clip (distinct du repeat : une vraie clip
  /// indépendante, éditable séparément) — décalée de sa propre durée.
  duplicateClip: (id: string) => void;
  setLoop: (startMs: number | undefined, endMs: number | undefined) => void;
  setDurationMs: (ms: number) => void;
  setScoreDoc: (doc: ScoreDoc | undefined) => void;
  clearScore: () => void;
  // Transport actions
  playScore: () => Promise<void>;
  stopScore: () => void;
  seekScore: (ms: number) => void;
  _setTransport: (playing: boolean, cursorMs: number, loopStartMs?: number, loopEndMs?: number) => void;
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
  setTrackMode: (id, mode) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === id ? { ...t, mode } : t)),
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
  setClipRepeat: (id, repeatEveryMs) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, repeatEveryMs } : c)),
    })),
  setClipFades: (id, fadeInMs, fadeOutMs) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, fadeInMs, fadeOutMs } : c)),
    })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
  duplicateClip: (id) =>
    set((s) => {
      const src = s.clips.find((c) => c.id === id);
      if (!src) return {};
      const copy: ScoreClipDoc = {
        ...src,
        id: uid(),
        startMs: Math.min(s.durationMs, src.startMs + (src.durationMs ?? 1000)),
      };
      return { clips: [...s.clips, copy] };
    }),
  setLoop: (startMs, endMs) => {
    set({ loopStartMs: startMs, loopEndMs: endMs });
    // Resync backend immédiat (hors play) — l'état transport reflète
    // la loop armée même arrêtée.
    invoke('score_timeline_set_loop', { startMs: startMs ?? null, endMs: endMs ?? null }).catch(silentCatch);
  },
  setDurationMs: (ms) => set({ durationMs: Math.max(1000, ms) }),
  setScoreDoc: (doc) =>
    // Backfill `mode` — les docs sauvegardés avant lane_mode n'ont pas
    // le champ (exclusive = sémantique historique S2).
    set(doc
      ? { ...doc, tracks: doc.tracks.map((t) => ({ ...t, mode: t.mode ?? 'exclusive' })) }
      : { tracks: defaultTracks(), clips: [], durationMs: 120_000 }),
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
      await invoke('score_timeline_set_loop', { startMs: s.loopStartMs ?? null, endMs: s.loopEndMs ?? null });
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
  _setTransport: (playing, cursorMs, loopStartMs, loopEndMs) =>
    // Loop fields : écrits seulement si différents — l'écho backend
    // ne doit pas re-marquer le doc dirty à chaque event transport.
    set((s) =>
      s.loopStartMs === loopStartMs && s.loopEndMs === loopEndMs
        ? { playing, cursorMs }
        : { playing, cursorMs, loopStartMs, loopEndMs },
    ),
}));
