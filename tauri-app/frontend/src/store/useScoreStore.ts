/// Score timeline (S2/S3 — docs/score-sequencer.md) — le document du
/// séquenceur : lanes par OBJET + clips (références vers slots/cues/
/// markers). Document state → enveloppe .hfg + dirty tracking ;
/// transport state (playing/cursorMs) → runtime, poussé par les
/// events `score-timeline` du backend.
///
/// LES LANES SONT LES OBJETS : une lane par `track_id` patché +
/// une pseudo-lane master. Elles sont dérivées de la config (pas des
/// entités persistées) — le doc ne stocke que leurs overrides
/// (`laneStates`) et la couverture de chaque clip (`trackIds`).
import { create } from 'zustand';
import { toast } from '../utils/toast-helpers';
import { safeInvoke as invoke, silentCatch } from '../utils/tauri';

/// Identifiants de lanes — `obj-<trackId>` par objet patché + deux
/// pseudo-lanes globales reprenant la taxonomie des graphes de
/// l'Atelier : `globalfx` (macros globales du merge — la couche
/// transform du graphe global + markers stop/panic) et `modulation`
/// (valeurs nommées injectées dans la map OSC — source `SignalOsc`
/// des graphs de modulation, le score agit comme un contrôleur).
export const GLOBALFX_LANE = 'globalfx';
export const MODULATION_LANE = 'modulation';
/// Lane du chef d'orchestre — événements-barrières (cue recall,
/// stopAll, panic) : transitions d'état globales, pas du contenu
/// composable (design §Cues on the timeline). Même id côté backend.
export const CONDUCTOR_LANE = 'conductor';
/// Lanes globales épinglées en tête de timeline (ordre d'affichage).
export const GLOBAL_LANES = [CONDUCTOR_LANE, GLOBALFX_LANE, MODULATION_LANE] as const;
export const laneIdOf = (trackId: number) => `obj-${trackId}`;

/// Comportement d'une lane en chevauchement de clips (docs/score-
/// sequencer.md §Surface) : `exclusive` = last-wins console (un move
/// score à la fois par lane), `stacked` = les clips simultanés
/// jouent ensemble, leurs sorties se composent dans le merge.
export type ScoreLaneMode = 'exclusive' | 'stacked';

/// Overrides persistés d'une lane — clé `obj-<trackId>` ou `master`.
/// Une lane n'a une entrée que si mutée ou en mode non-défaut.
export interface ScoreLaneState {
  muted?: boolean;
  /// `exclusive` par défaut quand absent.
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
  /// Couverture — les track-objets pilotés par ce clip (= les lanes
  /// sur lesquelles il se rend en copie liée). Slot : `undefined` =
  /// suit `slot.trackIds` en live (réassignation Atelier reflétée) ;
  /// une liste = assignation explicite gelée (sous-ensemble ou
  /// extension du slot, comme dans l'Atelier). Cue : blast radius
  /// dérivé du snapshot (info visuelle — le recall reste global ;
  /// undefined = suivi en live aussi). Marker : vide.
  trackIds?: number[];
  startMs: number;
  /// Slots : fin auto (désactivation). Absent = le move tourne jusqu'au
  /// stop suivant/panic (clip "ouvert").
  durationMs?: number;
  /// Tuile du clip — copies liées du move : le clip tire à
  /// start + k·repeatEveryMs jusqu'à la fin de sa fenêtre (durationMs
  /// requise). COMPORTEMENT PAR DÉFAUT du score pour les moves
  /// `loop_mode='loop'` : insérés avec repeat = la période du cycle,
  /// étendre le clip ajoute des copies. Chaque copie est un nouveau
  /// spawn (ré-articulation — distinct du loop interne qui jouerait
  /// sa trajectoire en continu sur un seul spawn).
  repeatEveryMs?: number;
  /// Fades clip-local (modèle DAW — le clip instance possède ses
  /// articulations). `undefined` = hérite les fades du slot
  /// (animation.fade_in/fade_out). fade_out joue EN TAIL après la fin
  /// du clip (EndMove à end_ms, le move s'éteint pendant son fade).
  fadeInMs?: number;
  fadeOutMs?: number;
  /// Courbes clip-scoped (S3 — docs/score-sequencer.md) :
  /// `paramId` → keyframes `{t, v}` avec `t` = ms relatif au début du
  /// clip. Écrites en live sur les macros PER-MOVE du worker spawné
  /// (scope PerMove — valeur absolue, base = seed du slot). Params :
  /// speed, scale, yaw/pitch/roll, offset_x/y/z (= shift_*).
  curves?: Record<string, ScoreKeyframe[]>;
  ref: ScoreClipRef;
}

/// Interpolation d'un segment de courbe — définie sur le keyframe
/// (segment [ce point → suivant)). 'linear' = défaut (rétrocompatible),
/// 'step' maintient la valeur, 'smooth' = smoothstep ease in/out.
/// Miroir de `ScoreInterp` côté backend (score.rs).
export type ScoreInterp = 'linear' | 'step' | 'smooth';

/// Un point d'une courbe : `t` en ms (relatif au début du clip pour
/// les courbes clip-scoped, absolu partition pour les courbes
/// master) + valeur du paramètre.
export interface ScoreKeyframe {
  t: number;
  v: number;
  interp?: ScoreInterp;
}

/// Lanes occupées par un clip — slot : ses objets ; cue/stopAll/panic
/// (barrières d'état globales) : la lane conductor — leur couverture
/// `trackIds` reste sur le clip pour le blast radius visuel. Un clip
/// objet à couverture vide se rend sur la lane globalfx : le contenu
/// global/non-assigné reste visible.
/// Lanes occupées par un clip — slot : ses objets ; cue/stopAll/panic
/// (barrières d'état globales) : la lane conductor — leur couverture
/// `trackIds` reste sur le clip pour le blast radius visuel. Un clip
/// objet à couverture vide se rend sur la lane globalfx : le contenu
/// global/non-assigné reste visible. `eff` = couverture effective
/// (résolue — les clips en mode "suit l'entité" n'ont pas de trackIds
/// gelés ; voir effectiveTrackIds dans scoreResolve).
export const clipLaneIds = (c: ScoreClipDoc, eff: number[] = c.trackIds ?? []): string[] =>
  c.ref.type === 'slot'
    ? (eff.length ? eff.map(laneIdOf) : [GLOBALFX_LANE])
    : [CONDUCTOR_LANE];

export interface ScoreDoc {
  /// Overrides des lanes dérivées (`obj-<trackId>`/`master` → état).
  laneStates?: Record<string, ScoreLaneState>;
  clips: ScoreClipDoc[];
  durationMs: number;
  /// Courbes GLOBALFX (S3) — keyframes en temps ABSOLU de partition,
  /// écrites sur les macros GLOBALES du merge (mêmes chemins que
  /// /stagespace/macro). Affectent l'ensemble du core.
  globalFxCurves?: Record<string, ScoreKeyframe[]>;
  /// Courbes MODULATION (S3) — temps absolu, injectées comme valeurs
  /// nommées dans la map des valeurs OSC : lues par les `SignalOsc`
  /// des graphs de modulation (globale + per-move — même espace
  /// d'adresses). Clé = le nom/adresse (ex. `/score/energy`).
  modulationCurves?: Record<string, ScoreKeyframe[]>;
  /// Region de boucle transport [start, end) — rebouclage hard-wrap
  /// de la partition entière (distinct du clip repeat). Les deux
  /// ensemble ou aucun.
  loopStartMs?: number;
  loopEndMs?: number;
}

const uid = () => `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const emptyDoc = (): ScoreDoc => ({ laneStates: {}, clips: [], durationMs: 120_000 });

interface ScoreState extends ScoreDoc {
  // Transport — runtime (pas dans l'enveloppe)
  playing: boolean;
  cursorMs: number;
  // Document actions
  /// Mute d'une lane (`obj-<trackId>` ou `master`).
  toggleLaneMute: (laneId: string) => void;
  /// Mode de chevauchement d'une lane.
  setLaneMode: (laneId: string, mode: ScoreLaneMode) => void;
  /// Insère un clip. `trackIds` = couverture (objets pilotés) — pour
  /// un slot : son assignation ; pour une cue : union dérivée de son
  /// snapshot ; markers : ignoré (lane master). Retourne le clip.
  addClip: (ref: ScoreClipRef, startMs: number, opts?: { durationMs?: number; trackIds?: number[]; repeatEveryMs?: number }) => ScoreClipDoc;
  /// Réassigne la couverture d'un clip (ajoute/retire des objets —
  /// même effet qu'une réassignation de tracks dans l'Atelier).
  /// `undefined` = repasse le clip en mode "suit l'entité vivante".
  setClipTrackIds: (id: string, trackIds: number[] | undefined) => void;
  moveClip: (id: string, startMs: number) => void;
  resizeClip: (id: string, durationMs: number | undefined) => void;
  setClipRepeat: (id: string, repeatEveryMs: number | undefined) => void;
  /// Fades du clip — `undefined` = retour à l'héritage du slot.
  setClipFades: (id: string, fadeInMs: number | undefined, fadeOutMs: number | undefined) => void;
  /// Pose/remplace la courbe d'un paramètre (`undefined` = supprime).
  /// Les keyframes sont triées par t ; un param sans courbe garde sa
  /// valeur fixe (héritée du slot/macros au play).
  setClipCurve: (id: string, paramId: string, keyframes: ScoreKeyframe[] | undefined) => void;
  /// Courbe d'une lane globale (`globalfx` → macros du merge,
  /// `modulation` → valeur nommée dans la map OSC) — `t` absolu
  /// partition, évaluée backend au play.
  setLaneCurve: (laneId: string, paramId: string, keyframes: ScoreKeyframe[] | undefined) => void;
  removeClip: (id: string) => void;
  /// Copie matérielle du clip (distinct du repeat : un vrai clip
  /// indépendant, éditable séparément — sa couverture peut ensuite
  /// diverger) — décalé de sa propre durée.
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
  ...emptyDoc(),
  playing: false,
  cursorMs: 0,

  toggleLaneMute: (laneId) =>
    set((s) => ({
      laneStates: {
        ...s.laneStates,
        [laneId]: { ...s.laneStates?.[laneId], muted: !s.laneStates?.[laneId]?.muted },
      },
    })),
  setLaneMode: (laneId, mode) =>
    set((s) => ({
      laneStates: { ...s.laneStates, [laneId]: { ...s.laneStates?.[laneId], mode } },
    })),

  addClip: (ref, startMs, opts) => {
    const clip: ScoreClipDoc = {
      id: uid(),
      // Pas de trackIds par défaut → le clip suit l'entité vivante
      // (couverture dérivée live) ; opts.trackIds = override gelé.
      ...(opts?.trackIds !== undefined ? { trackIds: [...opts.trackIds] } : {}),
      startMs: Math.max(0, startMs),
      durationMs: opts?.durationMs,
      repeatEveryMs: opts?.repeatEveryMs,
      ref,
    };
    set((s) => ({ clips: [...s.clips, clip] }));
    return clip;
  },
  // `trackIds` = override explicite ; `undefined` = repasse en mode
  // "suit l'entité vivante".
  setClipTrackIds: (id, trackIds) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id
          ? { ...c, trackIds: trackIds === undefined ? undefined : [...new Set(trackIds)].sort((a, b) => a - b) }
          : c,
      ),
    })),
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
  setClipCurve: (id, paramId, keyframes) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const curves = { ...(c.curves ?? {}) };
        if (keyframes === undefined) delete curves[paramId];
        else curves[paramId] = [...keyframes].sort((a, b) => a.t - b.t);
        return { ...c, curves };
      }),
    })),
  setLaneCurve: (laneId, paramId, keyframes) =>
    set((s) => {
      const field = laneId === MODULATION_LANE ? 'modulationCurves' : 'globalFxCurves';
      const curves = { ...(s[field] ?? {}) };
      if (keyframes === undefined) delete curves[paramId];
      else curves[paramId] = [...keyframes].sort((a, b) => a.t - b.t);
      return { [field]: curves };
    }),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
  duplicateClip: (id) =>
    set((s) => {
      const src = s.clips.find((c) => c.id === id);
      if (!src) return {};
      const copy: ScoreClipDoc = {
        ...src,
        ...(src.trackIds !== undefined ? { trackIds: [...src.trackIds] } : {}),
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
    set(
      doc
        ? {
            ...doc,
            // `trackIds` absent = mode "suit l'entité" — préservé tel
            // quel (les vieux docs avec une liste restent des overrides).
          }
        : emptyDoc(),
    ),
  clearScore: () => set({ ...emptyDoc(), playing: false, cursorMs: 0 }),

  playScore: async () => {
    const s = get();
    if (s.clips.length === 0) { toast.warning('Score vide'); return; }
    try {
      const { resolveScoreClips } = await import('../utils/scoreResolve');
      const { clips, errors } = await resolveScoreClips(s);
      errors.forEach((e) => toast.warning(e));
      if (clips.length === 0) { toast.error('Score : aucun clip résolvable'); return; }
      // Seek courant = base du curseur (le backend spanne les clips à cheval).
      await invoke('score_timeline_load', {
        clips,
        durationMs: s.durationMs,
        // Lane globale mutée → ses courbes ne jouent pas.
        globalFxCurves: s.laneStates?.[GLOBALFX_LANE]?.muted ? {} : (s.globalFxCurves ?? {}),
        modulationCurves: s.laneStates?.[MODULATION_LANE]?.muted ? {} : (s.modulationCurves ?? {}),
      });
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
