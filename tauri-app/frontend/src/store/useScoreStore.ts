/// Score timeline (S2/S3 — docs/score-sequencer.md) — le document du
/// séquenceur : lanes par OBJET + clips (références vers slots/cues/
/// markers). Document state → enveloppe .hfg + dirty tracking ;
/// transport state (playing/cursorMs) → runtime, poussé par les
/// events `score-timeline` du backend.
///
/// LES LANES SONT LES OBJETS : une lane par `track_id` patché +
/// quatre lanes globales épinglées (conductor/globalfx/spatialfx/
/// modulation). Elles sont dérivées de la config (pas des
/// entités persistées) — le doc ne stocke que leurs overrides
/// (`laneStates`) et la couverture de chaque clip (`trackIds`).
import { create } from 'zustand';
import { toast } from '../utils/toast-helpers';
import { safeInvoke as invoke, silentCatch } from '../utils/tauri';
import { safeParseStoredJson, safeSetItem } from '../utils/safeStorage';
import type { Zone } from '../types/generated/Zone';
import type { ChannelModulation } from '../types/generated/ChannelModulation';

/// Identifiants de lanes — `obj-<trackId>` par objet patché + deux
/// pseudo-lanes globales reprenant la taxonomie des graphes de
/// l'Atelier : `globalfx` (macros globales du merge — la couche
/// transform du graphe global + markers stop/panic) et `modulation`
/// (valeurs nommées injectées dans la map OSC — source `SignalOsc`
/// des graphs de modulation, le score agit comme un contrôleur).
export const GLOBALFX_LANE = 'globalfx';
export const MODULATION_LANE = 'modulation';
/// Lane de surcouche « spatial FX » — périmètre de l'onglet FX de
/// l'Atelier porté en timeline : clips `postGraph`/`zones`/`chanMods`
/// (la structure : pipeline post-process, tables de contraintes et de
/// règles cinématiques manuelles) + courbes scalaires (`ksmooth`,
/// `zone:<i>:<field>`, `mod:<key>:<field>`) qui réécrivent la
/// DÉFINITION des contraintes — l'influence reste évaluée par le merge.
export const SPATIALFX_LANE = 'spatialfx';
/// Lane du chef d'orchestre — événements-barrières (cue recall,
/// stopAll, panic) : transitions d'état globales, pas du contenu
/// composable (design §Cues on the timeline). Même id côté backend.
export const CONDUCTOR_LANE = 'conductor';
/// Lanes globales épinglées en tête de timeline (ordre d'affichage).
export const GLOBAL_LANES = [CONDUCTOR_LANE, GLOBALFX_LANE, SPATIALFX_LANE, MODULATION_LANE] as const;
export const laneIdOf = (trackId: number) => `obj-${trackId}`;

/// Comportement d'une lane en chevauchement de clips (docs/score-
/// sequencer.md §Surface) : `exclusive` = last-wins console (un move
/// score à la fois par lane), `stacked` = les clips simultanés
/// jouent ensemble, leurs sorties se composent dans le merge.
export type ScoreLaneMode = 'exclusive' | 'stacked';

/// Overrides persistés d'une lane — clé `obj-<trackId>` ou id de lane
/// globale (`conductor`/`globalfx`/`spatialfx`/`modulation`).
/// Une lane n'a une entrée que si mutée ou en mode non-défaut.
export interface ScoreLaneState {
  muted?: boolean;
  /// `exclusive` par défaut quand absent.
  mode?: ScoreLaneMode;
}

/// Référence d'un clip — JAMAIS un snapshot : le document pointe vers
/// le slot/cue vivant (édité → le clip rejoue la version courante).
/// `positions`, `modGraph` et `postGraph` sont les exceptions
/// matérialisées (issues du flatten de cue — pas d'entité vivante
/// correspondante) : le clip PORTE sa donnée (positions en track_id,
/// graphe signal / graphe global post-process sérialisés).
export type ScoreClipRef =
  | { type: 'slot'; slotId: string }
  | { type: 'cue'; cueId: string }
  | { type: 'stopAll' }
  | { type: 'panic' }
  | { type: 'positions'; positions: Record<number, [number, number, number]> }
  | { type: 'modGraph'; graph: { nodes: unknown[]; edges: unknown[] } }
  | { type: 'postGraph'; graph: { nodes: unknown[]; edges: unknown[] } }
  /// Tables MANUELLES du spatial FX (clip-porteur sur la lane
  /// spatialfx — la moitié déclarative des nodes Zone/Velocity vit
  /// dans `postGraph`) : règles cinématiques et zones, installées
  /// clear+set au tir — même sémantique que le recall de cue.
  | { type: 'chanMods'; modulations: ChannelModulation[] }
  | { type: 'zones'; zones: Zone[] }
  | ScoreEventRef;

/// Événements gestuels/contrôle — lane CONDUCTOR, one-shot comme
  /// stopAll/panic (mêmes chemins que les commandes OSC
  /// `/stagespace/*`). Les cibles (park/unpark/throw/manualClear/
  /// attention) = la COUVERTURE du clip (`trackIds`) : `undefined` =
  /// tous les objets patchés (suivi live), liste explicite = ces
  /// objets. `gesture` est global (tous les objets émis).
  /// - `gesture` : impulsion balistique globale (explode/converge/
  ///   orbit/front), `strength` = vélocité initiale (défaut OSC : 3).
  /// - `park` / `unpark` : fige / relâche (couverture vide → clear).
  /// - `throw` : lance balistique `vel` (m/s) sur les objets couverts.
  /// - `manualClear` : relâche les positions manuelles (vide = tout).
  /// - `attention` : stase — tout fige SAUF le 1er objet couvert ;
  ///   couverture vide = release.
export type ScoreEventRef =
  | { type: 'gesture'; name: 'explode' | 'converge' | 'orbit' | 'front'; strength: number }
  | { type: 'throw'; vel: [number, number, number] }
  | { type: 'park' }
  | { type: 'unpark' }
  | { type: 'manualClear' }
  | { type: 'attention' };

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
/// Miroir de `ScoreInterp` côté backend (commands/score/types.rs).
export type ScoreInterp = 'linear' | 'step' | 'smooth';

/// Un point d'une courbe : `t` en ms (relatif au début du clip pour
/// les courbes clip-scoped, absolu partition pour les courbes de
/// lanes) + valeur du paramètre.
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
export const clipLaneIds = (c: ScoreClipDoc, eff: number[] = c.trackIds ?? []): string[] => {
  switch (c.ref.type) {
    case 'slot':
    case 'positions':
      return eff.length ? eff.map(laneIdOf) : [GLOBALFX_LANE];
    case 'modGraph':
      return [MODULATION_LANE];
    case 'postGraph':
    case 'chanMods':
    case 'zones':
      // Pipeline post-process + tables de contraintes/règles — la
      // surcouche « spatial FX » (périmètre de l'onglet FX d'Atelier).
      return [SPATIALFX_LANE];
    default:
      return [CONDUCTOR_LANE];
  }
};

export interface ScoreDoc {
  /// Overrides des lanes dérivées (`obj-<trackId>`/lanes globales → état).
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
  /// Courbes des lanes OBJET — temps absolu, `laneId (obj-<trackId>) →
  /// param → keyframes` : `depth` + les canaux SpatialChannel (gain,
  /// spread, distance, presence, yaw, aperture, lfe). Écrites en live
  /// sur les tables runtime du merge (`set_track_depth` /
  /// `set_object_channel`) — la lane mutée est skippée à la résolution.
  objectCurves?: Record<string, Record<string, ScoreKeyframe[]>>;
  /// Courbes SPATIALFX — temps absolu : `ksmooth` (lissage
  /// cinématique global), `zone:<i>:<field>` (falloff/strength/enabled
  /// — index positionnel dans la table courante), `mod:<src>><ch>[@<obj>]
  /// [#<n>]:<field>` (scale/offset/min/max de la n-ième règle matchant
  /// la clé). Les courbes réécrivent la définition des contraintes —
  /// jamais l'influence positionnelle (calculée par le merge).
  spatialFxCurves?: Record<string, ScoreKeyframe[]>;
  /// Region de boucle transport [start, end) — rebouclage hard-wrap
  /// de la partition entière (distinct du clip repeat). Les deux
  /// ensemble ou aucun.
  loopStartMs?: number;
  loopEndMs?: number;
}

const uid = () => `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const emptyDoc = (): ScoreDoc => ({
  laneStates: {},
  clips: [],
  durationMs: 120_000,
  // Les maps de courbes sont listées explicitement : `set` fusionne
  // en surface — un champ absent persisterait (clearScore = tout
  // vider, courbes comprises).
  globalFxCurves: {},
  modulationCurves: {},
  objectCurves: {},
  spatialFxCurves: {},
});

interface ScoreState extends ScoreDoc {
  // Transport — runtime (pas dans l'enveloppe)
  playing: boolean;
  cursorMs: number;
  // Document actions
  /// Mute d'une lane (`obj-<trackId>` ou lane globale).
  toggleLaneMute: (laneId: string) => void;
  /// Mode de chevauchement d'une lane.
  setLaneMode: (laneId: string, mode: ScoreLaneMode) => void;
  /// Insère un clip. `trackIds` = couverture (objets pilotés) — pour
  /// un slot : son assignation ; pour une cue : union dérivée de son
  /// snapshot ; markers : ignoré (lane conductor). Retourne le clip.
  addClip: (ref: ScoreClipRef, startMs: number, opts?: { durationMs?: number; trackIds?: number[]; repeatEveryMs?: number }) => ScoreClipDoc;
  /// Réassigne la couverture d'un clip (ajoute/retire des objets —
  /// même effet qu'une réassignation de tracks dans l'Atelier).
  /// `undefined` = repasse le clip en mode "suit l'entité vivante".
  setClipTrackIds: (id: string, trackIds: number[] | undefined) => void;
  /// Repointe la référence du clip vers une autre entité (ex. après
  /// un "make unique" — le clip suit désormais le move cloné).
  retargetClip: (id: string, ref: ScoreClipRef) => void;
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
  /// Coupe le clip en deux à `ms` (temps score absolu) — les bords
  /// externes gardent leurs fades, le bord interne n'en a pas ; les
  /// courbes sont re-découpées (t relatif clip). Slots seulement —
  /// cues/markers sont des événements instantanés insécables.
  splitClip: (id: string, ms: number) => void;
  setLoop: (startMs: number | undefined, endMs: number | undefined) => void;
  setDurationMs: (ms: number) => void;
  setScoreDoc: (doc: ScoreDoc | undefined) => void;
  clearScore: () => void;
  // Transport actions
  playScore: () => Promise<void>;
  /// Hot-swap de la partition pendant la lecture — édition live sans
  /// coupure : les clips inchangés gardent leurs moves (backend).
  _hotSwap: () => Promise<void>;
  stopScore: () => void;
  seekScore: (ms: number) => void;
  /// Chase timecode — le transport suit le TC entrant
  /// (`/stagespace/timecode` + `/stagespace/score/chase <0|1>`). Flag
  /// runtime persisté localStorage, jamais dans le doc.
  tcChase: boolean;
  setTcChase: (on: boolean) => void;
  /// Entrée TC en secondes — dispatch show-control (un paquet = un
  /// appel, le chase filtre par deadband).
  chaseTimecode: (tc: number) => void;
  _setTransport: (playing: boolean, cursorMs: number, loopStartMs?: number, loopEndMs?: number) => void;
  /// Sélection d'édition — dans le store (pas ScoreView) pour que la
  /// toolbar et le MenuBar global agissent sur la même cible.
  selectedClipId: string | null;
  selGlobalLane: string | null;
  /// Les deux sélections sont exclusives (un clip OU une lane globale).
  selectClip: (id: string | null) => void;
  selectGlobalLane: (laneId: string | null) => void;
  clearScoreSelection: () => void;
}

/// Dernière partition résolue envoyée au backend (clip.id → JSON) —
/// base du diff hot-swap : un clip inchangé garde son move actif.
let lastResolvedClips = new Map<string, string>();

/// Persistance du flag TC chase (transport, pas le doc — même modèle
/// que `TC_CHASE_KEY` côté cuelist).
const SCORE_TC_CHASE_KEY = 'stagespace.score.tc_chase';
/// Dernière valeur TC vue par le chase (rolling = le TC avance) +
/// garde contre les play concurrents pendant un démarrage chase.
let lastChaseTc: number | null = null;
let chasePlayPending = false;
/// Deadband du chase — sous ~2 frames à 25 fps la dérive est ignorée
/// (un seek = rebase du transport, inutile en dessous du bruit TC).
const CHASE_DEADBAND_MS = 80;

export const useScoreStore = create<ScoreState>()((set, get) => ({
  ...emptyDoc(),
  selectedClipId: null,
  selGlobalLane: null,
  selectClip: (id) => set({ selectedClipId: id, selGlobalLane: null }),
  selectGlobalLane: (laneId) => set({ selGlobalLane: laneId, selectedClipId: null }),
  clearScoreSelection: () => set({ selectedClipId: null, selGlobalLane: null }),
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
  retargetClip: (id, ref) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, ref } : c)),
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
      if (laneId.startsWith('obj-')) {
        // Lane objet — map imbriquée laneId → param → keyframes.
        const lane = { ...(s.objectCurves?.[laneId] ?? {}) };
        if (keyframes === undefined) delete lane[paramId];
        else lane[paramId] = [...keyframes].sort((a, b) => a.t - b.t);
        return { objectCurves: { ...(s.objectCurves ?? {}), [laneId]: lane } };
      }
      // Routing explicite — un laneId inconnu retomberait en GLOBALFX
      // et écrirait silencieusement sur la mauvaise lane : no-op.
      const field =
        laneId === GLOBALFX_LANE
          ? 'globalFxCurves'
          : laneId === MODULATION_LANE
            ? 'modulationCurves'
            : laneId === SPATIALFX_LANE
              ? 'spatialFxCurves'
              : null;
      if (!field) return {};
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
  splitClip: (id, ms) =>
    set((s) => {
      const c = s.clips.find((x) => x.id === id);
      if (!c || c.ref.type !== 'slot' || ms <= c.startMs) return {};
      if (c.durationMs != null && ms >= c.startMs + c.durationMs) return {};
      const off = ms - c.startMs;
      // Courbes : t relatif au début du clip → la partie droite est
      // re-basée à 0 (les points avant la coupe restent à gauche).
      const cut = (ks: ScoreKeyframe[], side: 'l' | 'r') =>
        side === 'l' ? ks.filter((k) => k.t < off) : ks.filter((k) => k.t >= off).map((k) => ({ ...k, t: k.t - off }));
      const splitCurves = (side: 'l' | 'r') => {
        if (!c.curves) return undefined;
        const out = Object.fromEntries(
          Object.entries(c.curves)
            .map(([p, ks]) => [p, cut(ks, side)] as const)
            .filter(([, ks]) => ks.length > 0),
        );
        return Object.keys(out).length > 0 ? out : undefined;
      };
      const left: ScoreClipDoc = {
        ...c,
        durationMs: off,
        fadeOutMs: undefined,
        curves: splitCurves('l'),
      };
      const right: ScoreClipDoc = {
        ...c,
        id: uid(),
        startMs: ms,
        durationMs: c.durationMs != null ? c.durationMs - off : undefined,
        fadeInMs: undefined,
        trackIds: c.trackIds !== undefined ? [...c.trackIds] : undefined,
        curves: splitCurves('r'),
      };
      return { clips: s.clips.flatMap((x) => (x.id === id ? [left, right] : [x])) };
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
      const { clips, errors, objectCurves } = await resolveScoreClips(s);
      errors.forEach((e) => toast.warning(e));
      if (clips.length === 0) { toast.error('Score : aucun clip résolvable'); return; }
      lastResolvedClips = new Map(clips.map((c) => [c.id, JSON.stringify(c)]));
      // Seek courant = base du curseur (le backend spanne les clips à cheval).
      await invoke('score_timeline_load', {
        clips,
        durationMs: s.durationMs,
        // Lane globale mutée → ses courbes ne jouent pas.
        globalFxCurves: s.laneStates?.[GLOBALFX_LANE]?.muted ? {} : (s.globalFxCurves ?? {}),
        modulationCurves: s.laneStates?.[MODULATION_LANE]?.muted ? {} : (s.modulationCurves ?? {}),
        spatialFxCurves: s.laneStates?.[SPATIALFX_LANE]?.muted ? {} : (s.spatialFxCurves ?? {}),
        objectCurves,
      });
      // `load` remet le curseur backend à 0 — on re-pose le seek pour
      // que play démarre depuis le curseur courant (play-from-cursor).
      if (s.cursorMs > 0) {
        await invoke('score_timeline_seek', { ms: s.cursorMs });
      }
      await invoke('score_timeline_set_loop', { startMs: s.loopStartMs ?? null, endMs: s.loopEndMs ?? null });
      await invoke('score_timeline_play');
      set({ playing: true });
    } catch (e) {
      toast.error('Score play failed: ' + e);
    }
  },
  stopScore: () => {
    lastResolvedClips = new Map();
    invoke('score_timeline_stop').catch(silentCatch);
    set({ playing: false });
  },
  _hotSwap: async () => {
    const s = get();
    if (!s.playing) return;
    try {
      const { resolveScoreClips } = await import('../utils/scoreResolve');
      const { clips, errors, objectCurves } = await resolveScoreClips(s);
      errors.forEach((e) => toast.warning(e));
      const next = new Map(clips.map((c) => [c.id, JSON.stringify(c)]));
      // dead = id disparu OU contenu modifié — le backend ne tue que
      // les moves de ces clips ; les inchangés survivent (hot-swap).
      const dead = [...lastResolvedClips.keys()].filter(
        (id) => next.get(id) !== lastResolvedClips.get(id),
      );
      await invoke('score_timeline_update', {
        clips,
        durationMs: s.durationMs,
        globalFxCurves: s.laneStates?.[GLOBALFX_LANE]?.muted ? {} : (s.globalFxCurves ?? {}),
        modulationCurves: s.laneStates?.[MODULATION_LANE]?.muted ? {} : (s.modulationCurves ?? {}),
        spatialFxCurves: s.laneStates?.[SPATIALFX_LANE]?.muted ? {} : (s.spatialFxCurves ?? {}),
        objectCurves,
        deadClipIds: dead,
      });
      lastResolvedClips = next;
    } catch (e) {
      toast.warning('Score update failed: ' + e);
    }
  },
  seekScore: (ms) => {
    invoke('score_timeline_seek', { ms }).then(() => set({ cursorMs: ms })).catch(silentCatch);
  },
  tcChase: safeParseStoredJson<boolean>(SCORE_TC_CHASE_KEY, false),
  setTcChase: (on) => {
    set({ tcChase: on });
    safeSetItem(SCORE_TC_CHASE_KEY, JSON.stringify(on));
    // Reset complet : premier paquet = locate (pas de faux rolling),
    // et un toggle pendant un play chase ne le laisse pas verrouillé.
    lastChaseTc = null;
    chasePlayPending = false;
  },
  chaseTimecode: (tc) => {
    if (!get().tcChase || !Number.isFinite(tc) || tc < 0) return;
    // Premier paquet après le toggle = locate seulement (un TC garé à
    // l'armement du chase ne doit pas démarrer la lecture tout seul).
    const rolling = lastChaseTc != null && tc > lastChaseTc;
    lastChaseTc = tc;
    const ms = tc * 1000;
    const s = get();
    if (!s.playing) {
      if (rolling) {
        // TC qui roule = démarrer le transport À la position TC —
        // chase, pas simple seek. cursorMs posé d'abord : playScore
        // re-seek le backend post-load depuis cette valeur.
        // Partition vide : pas de démarrage — sinon le toast "Score
        // vide" spammerait à chaque paquet TC.
        if (!chasePlayPending && s.clips.length > 0) {
          chasePlayPending = true;
          set({ cursorMs: ms });
          void s.playScore().finally(() => { chasePlayPending = false; });
        }
      } else if (Math.abs(ms - s.cursorMs) > CHASE_DEADBAND_MS) {
        s.seekScore(ms); // TC garé = locate (le curseur suit, pas de play)
      }
      return;
    }
    // En lecture : rebase si la dérive dépasse le bruit du TC.
    if (Math.abs(ms - s.cursorMs) > CHASE_DEADBAND_MS) s.seekScore(ms);
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
