//! Types wire du séquenceur — `ScoreClip`/`ScoreClipPayload` (résolus
//! frontend), `ScoreTimeline` (état AppState) et `ScoreTimelineState`
//! (snapshot UI). La lecture ne dépend plus de la webview.
use super::curves::CurveTarget;
use crate::commands::merge_commands::move_management::ActivateMoveRequest;
use crate::commands::playback::SetMacroRequest;
use serde::{Deserialize, Serialize};
use stagespace_engines::Cue;
use std::collections::HashMap;
use std::time::Instant;

// ─── S2 — ScoreTimeline : clips multi-pistes exécutés par le backend ───
// Contrairement à la tape (score-fire → dispatch frontend), le timeline
// EXÉCUTE : spawn_move / recall_cue_inner / deactivate directement sur
// Shared — les moves survivent à la mort de la webview, vraie runtime
// truth (docs/score-sequencer.md §S2).

/// Payload résolu d'un clip — le frontend résout les références au
/// `score_timeline_load` (slot → ActivateMoveRequest construit par le
/// même builder que playSlot ; cue → snapshot Cue tel que stocké).
/// La lecture ne dépend alors plus de la webview.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScoreClipPayload {
    /// Move : spawn à `start` ; `duration_ms` → désactivation auto en
    /// fin de clip (fade = le fade_out du slot).
    Slot {
        request: Box<ActivateMoveRequest>,
        /// Macros spatiales du slot — appliquées au merge au lancement,
        /// comme un play manuel (set_global_macro).
        macros: Option<SetMacroRequest>,
    },
    /// Marqueur cue — recall_cue_inner au timestamp (le flag anti-recall
    /// concurrent est géré par recall_cue_inner lui-même).
    Cue(Box<Cue>),
    /// Tout couper — deactivate_all honor_end_mode (= doStop).
    StopAll,
    /// Panic — deactivate_all sans honorer les fins déclarées (= Esc).
    Panic,
    /// Positions manuelles — `{obj_index → pos}` appliqué au merge,
    /// même chemin que `/stagespace/position` (clip `positions`, issu
    /// du flatten de `cue.manual_positions`). Instantané, persisté
    /// jusqu'à override — sémantique identique à la cue.
    Positions { positions: Vec<(usize, [f64; 3])> },
    /// Graph de modulation global — compile + hot-swap de la SignalFn
    /// (même chemin que `update_signal_graph`, scope global ; clip
    /// `modGraph`, issu du flatten de `cue.signal_graph`).
    SignalGraph {
        graph: stagespace_engines::GraphJson,
    },
    /// Graph global post-process — build → extract_graph_effects →
    /// compile → swap_post_process_fn + set_graph_effects (+ stratégie
    /// du node Merge en tête de chaîne) : même chemin que `recall_cue`
    /// étape 1 / `update_global_graph`. Restaure la moitié DÉCLARATIVE
    /// des zones/modulations (nodes Zone/Velocity) — disjointe des
    /// tables manuelles `cue.zones`/`cue.channel_modulations` (clip
    /// `postGraph`, issu du flatten de `cue.global_graph`).
    PostGraph {
        graph: stagespace_engines::GraphJson,
    },
    /// Table de règles cinématiques MANUELLES — clear + install (même
    /// chemin que `recall_cue` : `clear_modulations` + `add_modulation`
    /// par règle). La moitié déclarative (nodes Velocity du graphe)
    /// revient via PostGraph — disjoint. Clip `chanMods`, issu du
    /// flatten de `cue.channel_modulations`.
    ChanMods {
        modulations: Vec<stagespace_engines::ChannelModulation>,
    },
    /// Table de zones MANUELLES — clear + install (même chemin que
    /// `recall_cue` : `clear_zones` + `add_zone` par zone). Les zones
    /// sont des contraintes déclaratives évaluées par frame (influence
    /// SDF) — le clip installe la définition, le merge garde l'éval.
    /// Clip `zones`, issu du flatten de `cue.zones`.
    Zones {
        zones: Vec<stagespace_engines::Zone>,
    },
    /// Geste balistique GLOBAL — `gesture(name, strength)` sur tous
    /// les objets émis (même chemin que `/stagespace/gesture` :
    /// explode/converge/orbit/front, vélocité initiale amortie).
    Gesture { name: String, strength: f64 },
    /// Park — `park_object` par objet (fige + exempte des recalls).
    /// Objets en obj_index ; liste vide = no-op (logué).
    Park { objects: Vec<usize> },
    /// Unpark — `unpark_object` par objet ; liste vide = `clear_parked`
    /// (relâche tout — l'événement "release" de fin de section).
    Unpark { objects: Vec<usize> },
    /// Throw — `throw_object(obj, vel)` par objet couvert (grab &
    /// throw balistique, même chemin que `/stagespace/throw`).
    Throw { objects: Vec<usize>, vel: [f64; 3] },
    /// Relâche des positions manuelles — `clear_manual_position` par
    /// objet ; liste vide = `clear_all_manual_positions` (retour au
    /// live pour toutes les reprises opérateur).
    ManualClear { objects: Vec<usize> },
    /// Attention — `attention_focus(obj)` (stase : tout fige sauf
    /// l'objet couvert) ou `attention_release()` quand `obj` est None.
    Attention { obj: Option<usize> },
}

/// Interpolation d'un segment de courbe — définie sur le keyframe
/// comme dans les DAW : le segment [ce point → suivant) utilise son
/// `interp`. `linear` par défaut (rétrocompatible — les vieux docs
/// sans le champ lisent `linear`). `step` maintient `a.v` jusqu'au
/// keyframe suivant ; `smooth` = smoothstep `f²(3−2f)` (ease in/out
/// sans overshoot). Bezier = extension future (handles par segment).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScoreInterp {
    #[default]
    Linear,
    Step,
    Smooth,
}

/// Un keyframe de courbe — `t` en ms. Relatif au début du clip pour
/// les courbes clip-scoped, absolu (début de partition) pour les
/// courbes master. `v` = valeur ABSOLUE du paramètre.
#[derive(Debug, Clone, Deserialize)]
pub struct ScoreKeyframe {
    pub t: u64,
    pub v: f64,
    #[serde(default)]
    pub interp: ScoreInterp,
}

/// Un clip posé sur la timeline — `track` = la lane d'appartenance :
/// le backend applique "un move score à la fois par lane" (un nouveau
/// clip Slot qui démarre coupe le précédent — dernier gagne, comme
/// une console qui reprend la main sur le même canal).
/// Une lane du clip — `obj-<trackId>` pour slot/cue (les pistes sont
/// les objets : un clip multi-objets s'enregistre dans TOUTES ses
/// lanes), `master` pour les markers. `stacked` = mode de la lane :
/// un nouveau clip ne coupe pas les moves actifs qui s'y trouvent.
#[derive(Debug, Clone, Deserialize)]
pub struct ScoreLane {
    pub id: String,
    #[serde(default)]
    pub stacked: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScoreClip {
    pub id: String,
    /// Lanes occupées — sémantique last-wins exclusive vs stacked par
    /// lane (un move multi-objets est coupé si n'importe laquelle de
    /// ses lanes exclusive reçoit un nouveau clip).
    #[serde(default)]
    pub lanes: Vec<ScoreLane>,
    pub start_ms: u64,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    /// Re-déclenchement périodique — "clip loop" DAW : le clip tire à
    /// `start + k·repeat_every` jusqu'à la fin de sa fenêtre
    /// (`duration_ms`). Distinct du loop_mode du move (trajectoire
    /// interne) : ici chaque itération est un nouveau spawn/pulse —
    /// re-articulation rythmique, pas mouvement continu.
    /// Requiert `duration_ms` (la fenêtre borne les copies).
    #[serde(default)]
    pub repeat_every_ms: Option<u64>,
    /// Fades clip-local (ms) — override des fades de l'animation du
    /// slot. `None` = héritage. fade_out joue en tail : l'EndMove tire
    /// à la fin de la fenêtre et le move s'éteint pendant son fade.
    #[serde(default)]
    pub fade_in_ms: Option<u64>,
    #[serde(default)]
    pub fade_out_ms: Option<u64>,
    /// Courbes clip-scoped (S3 — docs/score-sequencer.md §S3) :
    /// `param` → keyframes (ms relatif au début du clip, valeur
    /// absolue). Évaluées à chaque tick de l'horloge (≤50 ms) et
    /// écrites sur les macros PER-MOVE du worker spawné
    /// (`runtime.macros()` — `MacroScope::PerMove`, lues à chaque
    /// frame) : la valeur seedée du slot reste la base tant que la
    /// courbe ne couvre pas le param. Interpolation linéaire, clamp
    /// aux bornes. Params : speed, scale, yaw/pitch/roll,
    /// offset_x/y/z (= shift_*), radius_scale, height_offset.
    #[serde(default)]
    pub curves: HashMap<String, Vec<ScoreKeyframe>>,
    pub payload: ScoreClipPayload,
}

/// Move score vivant — miroir dans `ScoreTimeline` de l'état autrefois
/// local au thread scheduler. Persiste entre générations : c'est lui
/// qui permet au hot-swap (`score_timeline_update`) de survivre les
/// clips inchangés, et à `stop`/`seek` de distinguer les moves score
/// des moves opérateur.
pub struct ActiveMove {
    /// Clip qui a spawné le move (`clip.id`) — la clé du diff hot-swap.
    pub clip_id: String,
    /// Lanes couvertes (cut exclusif + drain au wrap).
    pub lanes: Vec<String>,
    /// fade_out résolu au spawn (clip override ou héritage slot).
    pub fade: f64,
    /// Cible de courbes clip-scoped (macros per-move etc.).
    pub curve: Option<CurveTarget>,
}

/// État de la timeline dans AppState — partition de clips + horloge.
#[derive(Default)]
pub struct ScoreTimeline {
    pub clips: Vec<ScoreClip>,
    pub duration_ms: u64,
    /// Départ du play courant — `cursor = seek_ms + (now - started_at)`.
    pub started_at: Option<Instant>,
    /// Base du curseur — posée par seek (stopped only), consommée au play.
    /// Pendant une boucle, rebasée à `loop_start` à chaque cycle.
    pub seek_ms: u64,
    /// Region de boucle arrangement [start, end) — rebouclage
    /// hard-wrap du transport (distinct du clip repeat : boucle de la
    /// partition entière). `None` = pas de boucle.
    pub loop_region: Option<(u64, u64)>,
    /// Courbes GLOBALFX (S3) — évaluées en temps partition absolu et
    /// écrites sur les macros GLOBALES du merge
    /// (`MergeRuntime::macros()` — `MacroScope::Global`, mêmes chemins
    /// que `/stagespace/macro`). Hold à l'arrêt (dernière valeur
    /// conservée — sémantique console, l'opérateur reprend la main à
    /// tout moment).
    pub global_fx_curves: HashMap<String, Vec<ScoreKeyframe>>,
    /// Courbes MODULATION (S3) — temps absolu, écrites dans la map des
    /// valeurs OSC (`last_by_address`) : le score devient une source
    /// nommée lue par les nodes `SignalOsc` des graphs de modulation
    /// (globale et per-move — même espace d'adresses que l'OSC réel).
    pub modulation_curves: HashMap<String, Vec<ScoreKeyframe>>,
    /// Courbes des lanes OBJET (S3) — temps absolu, `obj_index → param
    /// → keyframes` : `depth` → `set_track_depth`, les autres noms sont
    /// les canaux `SpatialChannel` (gain/spread/distance/presence/yaw/
    /// aperture/lfe) → `set_object_channel`. Vrais paramètres runtime
    /// du merge (jamais dérivés d'un graphe) — matérialisés au flatten
    /// depuis `cue.per_track_depths`/`cue.object_channels`.
    pub object_curves: HashMap<usize, HashMap<String, Vec<ScoreKeyframe>>>,
    /// Courbes de la lane SPATIALFX — temps absolu : `ksmooth` (lissage
    /// cinématique), `zone:<i>:<field>` (patch en place de la zone i —
    /// falloff/strength/enabled), `mod:<src>><ch>[@<obj>][#n]:<field>`
    /// (patch en place de la nième règle matchant la clé — scale/
    /// offset/min/max). Les courbes n'automatisent jamais l'influence
    /// d'une zone (calculée live par le merge) — elles réécrivent la
    /// DÉFINITION de la contrainte.
    pub spatial_fx_curves: HashMap<String, Vec<ScoreKeyframe>>,
    /// Moves score actifs : `move_id → ActiveMove` (miroir publié par
    /// le scheduler après chaque événement). Sert au hot-swap
    /// (`score_timeline_update` préserve les moves des clips inchangés),
    /// au `stop`/`seek` (kill ciblé des moves score) et au seeding du
    /// thread respawné.
    pub active: HashMap<String, ActiveMove>,
    /// Génération — stop/load l'incrémente, les sleeps armés s'abortent.
    pub generation: u64,
}

/// Préfixe des ids de moves spawnés par le scheduler score
/// (`sc-<clip_id>` — préfixe posé côté frontend dans `scoreResolve`).
/// Sert au balayage des résidus au play et aux filtres "moves score".
pub(crate) const SCORE_MOVE_PREFIX: &str = "sc-";

#[derive(Serialize)]
pub struct ScoreTimelineState {
    pub playing: bool,
    pub cursor_ms: u64,
    pub duration_ms: u64,
    pub len: usize,
    pub loop_start_ms: Option<u64>,
    pub loop_end_ms: Option<u64>,
}

pub(crate) fn timeline_state(tl: &ScoreTimeline) -> ScoreTimelineState {
    ScoreTimelineState {
        playing: tl.started_at.is_some(),
        cursor_ms: tl.seek_ms
            + tl.started_at
                .map(|t0| t0.elapsed().as_millis() as u64)
                .unwrap_or(0),
        duration_ms: tl.duration_ms,
        len: tl.clips.len(),
        loop_start_ms: tl.loop_region.map(|r| r.0),
        loop_end_ms: tl.loop_region.map(|r| r.1),
    }
}

/// La timeline a du contenu jouable : au moins un clip ou une courbe
/// non vide (une prise qui n'est qu'une trajectoire enregistrée n'a
/// aucun clip — elle doit pourtant jouer).
pub(crate) fn timeline_has_content(tl: &ScoreTimeline) -> bool {
    let curves = |m: &HashMap<String, Vec<ScoreKeyframe>>| m.values().any(|k| !k.is_empty());
    if !tl.clips.is_empty() {
        return true;
    }
    curves(&tl.global_fx_curves)
        || curves(&tl.modulation_curves)
        || curves(&tl.spatial_fx_curves)
        || tl
            .object_curves
            .values()
            .any(|m| m.values().any(|k| !k.is_empty()))
}
