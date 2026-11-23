//! Score tape (S1 du séquenceur — docs/score-sequencer.md) — bande de
//! commandes horodatées dont l'HORLOGE vit dans le backend (thread
//! dédié), pas en `setTimeout` frontend : timing déterministe, état
//! requêtable (`score_state`), le curseur survit à un reload webview.
//! Le frontend reste l'exécuteur — chaque entrée est ré-émise en
//! `score-fire` et dispatchée par le REPLAY map existant, mêmes
//! sémantiques que le busking enregistré.

use super::error::IpcError;
use super::state::{emit_ui, lock_or_recover, Shared};
use crate::commands::cue_commands::recall_cue_inner;
use crate::commands::merge_commands::macros::apply_set_macro_request;
use crate::commands::merge_commands::move_management::{
    deactivate_all_arc, deactivate_move_arc, spawn_move, spec_from_request, ActivateMoveRequest,
};
use crate::commands::playback::SetMacroRequest;
use crate::AppState;
use serde::{Deserialize, Serialize};
use stagespace_engines::Cue;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

/// Une commande horodatée — `name`/`args` au format frontend (`doSlot`,
/// `doSetPosition`…), compatible avec le `.sscore.json` existant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreTapeEntry {
    /// ms depuis le début de la bande.
    pub t: u64,
    pub name: String,
    #[serde(default)]
    pub args: Vec<f64>,
}

/// État de la bande dans AppState — la partition courante + l'horloge.
#[derive(Default)]
pub struct ScoreTape {
    pub entries: Vec<ScoreTapeEntry>,
    /// Départ du play courant — `cursor = now - started_at`.
    pub started_at: Option<Instant>,
    /// Génération de lecture : stop/clear/load l'incrémente, les
    /// sleeps armés par une ancienne génération s'abortent.
    pub generation: u64,
}

/// État requêtable par l'UI (resync après reload, indicateur PLAY).
#[derive(Serialize)]
pub struct ScoreTapeState {
    pub playing: bool,
    /// Position courante du curseur en ms (0 si pas de lecture).
    pub cursor_ms: u64,
    pub len: usize,
}

fn tape_state(tape: &ScoreTape) -> ScoreTapeState {
    ScoreTapeState {
        playing: tape.started_at.is_some(),
        cursor_ms: tape
            .started_at
            .map(|t0| t0.elapsed().as_millis() as u64)
            .unwrap_or(0),
        len: tape.entries.len(),
    }
}

/// Charge une partition (remplace la bande courante, stoppe la lecture).
#[tauri::command]
pub async fn score_load(
    entries: Vec<ScoreTapeEntry>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut tape = lock_or_recover(&state.score_tape);
    tape.generation += 1;
    tape.started_at = None;
    tape.entries = entries;
    Ok(())
}

/// Lance la lecture — thread horloge : sleep jusqu'au timestamp de
/// chaque entrée puis `score-fire` vers l'UI. Un play sur une lecture
/// en cours la relance depuis le début (re-arm propre via generation).
#[tauri::command]
pub async fn score_play(state: State<'_, AppState>) -> Result<(), IpcError> {
    let (gen, entries) = {
        let mut tape = lock_or_recover(&state.score_tape);
        tape.generation += 1;
        tape.started_at = Some(Instant::now());
        (tape.generation, tape.entries.clone())
    };
    if entries.is_empty() {
        lock_or_recover(&state.score_tape).started_at = None;
        return Err(IpcError::validation("score tape empty"));
    }
    let tape_arc = state.score_tape.clone();
    let sink = state.event_sink.clone();
    std::thread::spawn(move || {
        let t0 = Instant::now();
        for e in &entries {
            let deadline = Duration::from_millis(e.t);
            // Sleep par tranches : un stop/clear doit être vu <50ms même
            // si la prochaine entrée est lointaine (pas de tir orphelin).
            loop {
                let elapsed = t0.elapsed();
                if elapsed >= deadline {
                    break;
                }
                if lock_or_recover(&tape_arc).generation != gen {
                    return; // stoppé — mourir sans tirer
                }
                std::thread::sleep((deadline - elapsed).min(Duration::from_millis(50)));
            }
            if lock_or_recover(&tape_arc).generation != gen {
                return;
            }
            emit_ui(&sink, "score-fire", e);
        }
        // Fin de bande — la génération n'a pas changé : fermer la lecture.
        let mut tape = lock_or_recover(&tape_arc);
        if tape.generation == gen {
            tape.started_at = None;
        }
        drop(tape);
        emit_ui(
            &sink,
            "score-state",
            serde_json::json!({ "playing": false }),
        );
    });
    Ok(())
}

/// Stoppe la lecture — les sleeps armés s'abortent à la prochaine
/// tranche (<50ms), la partition est conservée.
#[tauri::command]
pub async fn score_stop(state: State<'_, AppState>) -> Result<(), IpcError> {
    let mut tape = lock_or_recover(&state.score_tape);
    tape.generation += 1;
    tape.started_at = None;
    Ok(())
}

/// Vide la partition (stoppe d'abord).
#[tauri::command]
pub async fn score_clear(state: State<'_, AppState>) -> Result<(), IpcError> {
    let mut tape = lock_or_recover(&state.score_tape);
    tape.generation += 1;
    tape.started_at = None;
    tape.entries.clear();
    Ok(())
}

/// État courant — resync de l'UI (PLAY affiché, curseur).
#[tauri::command]
pub async fn score_state(state: State<'_, AppState>) -> Result<ScoreTapeState, IpcError> {
    Ok(tape_state(&lock_or_recover(&state.score_tape)))
}

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
    /// Génération — stop/load l'incrémente, les sleeps armés s'abortent.
    pub generation: u64,
}

#[derive(Serialize)]
pub struct ScoreTimelineState {
    pub playing: bool,
    pub cursor_ms: u64,
    pub duration_ms: u64,
    pub len: usize,
    pub loop_start_ms: Option<u64>,
    pub loop_end_ms: Option<u64>,
}

fn timeline_state(tl: &ScoreTimeline) -> ScoreTimelineState {
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

/// Charge la partition de clips (stoppe la lecture, reset le curseur).
/// Les clips sont triés par start — le lecteur les consomme en ordre.
#[tauri::command]
pub async fn score_timeline_load(
    clips: Vec<ScoreClip>,
    duration_ms: u64,
    global_fx_curves: HashMap<String, Vec<ScoreKeyframe>>,
    modulation_curves: HashMap<String, Vec<ScoreKeyframe>>,
    object_curves: HashMap<usize, HashMap<String, Vec<ScoreKeyframe>>>,
    spatial_fx_curves: HashMap<String, Vec<ScoreKeyframe>>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut tl = lock_or_recover(&state.score_timeline);
    tl.generation += 1;
    tl.started_at = None;
    tl.seek_ms = 0;
    let mut sorted = clips;
    sorted.sort_by_key(|c| c.start_ms);
    // Keyframes triés par t — l'évaluation fait un partition_point.
    for c in &mut sorted {
        for kfs in c.curves.values_mut() {
            kfs.sort_by_key(|k| k.t);
        }
    }
    let mut gfx = global_fx_curves;
    for kfs in gfx.values_mut() {
        kfs.sort_by_key(|k| k.t);
    }
    let mut mods = modulation_curves;
    for kfs in mods.values_mut() {
        kfs.sort_by_key(|k| k.t);
    }
    let mut objs = object_curves;
    for params in objs.values_mut() {
        for kfs in params.values_mut() {
            kfs.sort_by_key(|k| k.t);
        }
    }
    let mut sfx = spatial_fx_curves;
    for kfs in sfx.values_mut() {
        kfs.sort_by_key(|k| k.t);
    }
    tl.clips = sorted;
    tl.global_fx_curves = gfx;
    tl.modulation_curves = mods;
    tl.object_curves = objs;
    tl.spatial_fx_curves = sfx;
    tl.duration_ms = duration_ms;
    Ok(())
}

/// Échantillonne une courbe (keyframes triés par t) — interpolation
/// linéaire, clamp aux bornes avant/après. `None` = courbe vide.
fn sample_curve(kfs: &[ScoreKeyframe], t_ms: u64) -> Option<f64> {
    match kfs.len() {
        0 => None,
        1 => Some(kfs[0].v),
        _ => {
            if t_ms <= kfs[0].t {
                return Some(kfs[0].v);
            }
            let last = &kfs[kfs.len() - 1];
            if t_ms >= last.t {
                return Some(last.v);
            }
            let i = kfs.partition_point(|k| k.t <= t_ms);
            let (a, b) = (&kfs[i - 1], &kfs[i]);
            let f = (t_ms - a.t) as f64 / (b.t - a.t) as f64;
            let v = match a.interp {
                // step : la valeur du keyframe tient jusqu'au suivant.
                ScoreInterp::Step => a.v,
                // smooth : smoothstep — ease in/out sans overshoot.
                ScoreInterp::Smooth => {
                    let s = f * f * (3.0 - 2.0 * f);
                    a.v + (b.v - a.v) * s
                }
                ScoreInterp::Linear => a.v + (b.v - a.v) * f,
            };
            Some(v)
        }
    }
}

/// Écrit une valeur de courbe sur un MacroState — même convention de
/// noms que `audio_param_overrides` (`offset_*` et `shift_*` acceptés
/// pour les axes, comme la traduction du signal graph). Valable pour
/// les deux scopes : `Runtime::macros()` (per-move) et
/// `MergeRuntime::macros()` (global).
fn write_macro_param(m: &stagespace_engines::MacroState, param: &str, v: f64) {
    match param {
        "speed" => m.set_speed(v),
        "scale" => m.set_scale(v),
        "radius_scale" => m.set_radius_scale(v),
        "height_offset" => m.set_height_offset(v),
        "shift_x" | "offset_x" => {
            let s = m.get_shift();
            m.set_shift(v, s.y, s.z);
        }
        "shift_y" | "offset_y" => {
            let s = m.get_shift();
            m.set_shift(s.x, v, s.z);
        }
        "shift_z" | "offset_z" => {
            let s = m.get_shift();
            m.set_shift(s.x, s.y, v);
        }
        "yaw" => {
            let (_, p, r) = m.get_rotation();
            m.set_rotation(v, p, r);
        }
        "pitch" => {
            let (y, _, r) = m.get_rotation();
            m.set_rotation(y, v, r);
        }
        "roll" => {
            let (y, p, _) = m.get_rotation();
            m.set_rotation(y, p, v);
        }
        _ => {}
    }
}

/// Une cible de courbes clip-scoped : le MacroState du move spawné,
/// le canal de deltas `param:` de son runtime, les cibles résolues au
/// fire, le t0 ABSOLU de cette itération (start + k·repeat — le temps
/// local de la courbe = cursor − t0) et la table de keyframes.
/// Cible `param:` résolue — ((node_key, param_key), base du node).
type ResolvedParamTarget = ((String, String), f64);

struct CurveTarget {
    macros: Arc<stagespace_engines::MacroState>,
    /// `Runtime::param_deltas` — même canal que les contributions du
    /// signal graph (somme dans `ParamSlots::apply_frame`).
    param_deltas: Arc<Mutex<HashMap<(String, String), f64>>>,
    /// Cibles `param:` résolues au fire — clé de courbe →
    /// ((node_key, param_key), base). La base sert à convertir la
    /// valeur absolue de la courbe en delta (`slots = base + Δ`).
    param_targets: HashMap<String, Vec<ResolvedParamTarget>>,
    t0_ms: u64,
    curves: HashMap<String, Vec<ScoreKeyframe>>,
}

/// Résolution d'une cible de courbe `param:<node_id|NodeType>:<key>` —
/// mêmes règles que le signal compiler (id d'abord, type-wide ensuite),
/// appliquées au `graph_json` de la request du clip. Retourne les
/// ((node_key, param_key), base) — node_key = l'id React Flow du node
/// (= `__fe_id` injecté par le parser, clé stable des ParamSlots).
fn resolve_param_targets(
    gj: &stagespace_engines::GraphJson,
    param_id: &str,
) -> Vec<ResolvedParamTarget> {
    let Some(rest) = param_id.strip_prefix("param:") else {
        return Vec::new();
    };
    let Some((seg, key)) = rest.split_once(':') else {
        return Vec::new();
    };
    let by_id: Vec<&stagespace_engines::GraphNodeJson> =
        gj.nodes.iter().filter(|n| n.id == seg).collect();
    let targets: Vec<&stagespace_engines::GraphNodeJson> = if !by_id.is_empty() {
        by_id
    } else {
        gj.nodes
            .iter()
            .filter(|n| n.data.node_type.as_deref() == Some(seg))
            .collect()
    };
    targets
        .iter()
        .filter_map(|n| {
            let base = n.data.params.get(key)?.as_f64()?;
            Some(((n.id.clone(), key.to_string()), base))
        })
        .collect()
}

/// Évalue toutes les courbes au curseur courant — appelé à chaque
/// réveil de l'horloge (le sleep est borné à 50 ms). Clip-scoped →
/// macros per-move + deltas `param:` + blend `merge:` (weight /
/// priority — `set_move_*`, côté merge pas worker) du move ;
/// GLOBALFX → macros globales du merge ; MODULATION → valeurs
/// nommées dans la map OSC (source `SignalOsc` des graphs de
/// modulation — le score agit comme un contrôleur OSC de plus).
/// Les trois couches de courbes temps-absolu du score — regroupées
/// pour `eval_curves` (clippy::too_many_arguments).
struct AbsCurves<'a> {
    global_fx: &'a HashMap<String, Vec<ScoreKeyframe>>,
    modulation: &'a HashMap<String, Vec<ScoreKeyframe>>,
    /// `obj_index → param → keyframes` (lanes objet `obj-<trackId>`).
    object: &'a HashMap<usize, HashMap<String, Vec<ScoreKeyframe>>>,
    /// Lane SPATIALFX — `ksmooth`, `zone:<i>:<field>`, `mod:<key>:<field>`.
    spatial_fx: &'a HashMap<String, Vec<ScoreKeyframe>>,
}

/// Écrit une valeur de courbe SPATIALFX — patch en place des tables
/// manuelles du merge (jamais l'influence, toujours la définition) :
/// - `ksmooth` → `set_kinematic_smoothing` (lissage cinématique global)
/// - `zone:<i>:<field>` → `falloff` / `strength` (des effets Repel/
///   Attract/Dampen/Vortex) / `enabled` (v ≥ 0.5) — `update_zone(i, z)`.
///   `i` est POSITIONNEL : index dans la table courante — le dernier
///   clip `zones` tiré (ou l'état opérateur) fixe l'ordre.
/// - `mod:<src>><ch>[@<obj>][#<n>]:<field>` → `scale`/`offset`/`min`/`max`
///   de la n-ième règle matchant `(source, channel, object)` —
///   `update_modulation(i, r)`. La clé est stable entre les
///   réinstallations de table (contrairement à l'index) ; `#n`
///   départage les règles qui partagent le même triplet.
///
/// Clé/champ/index inconnu → skip silencieux (la courbe s'applique à
/// la table COURANTE : une règle absente n'a rien à moduler).
fn eval_spatial_fx_param(rt: &stagespace_engines::MergeRuntime, param: &str, v: f64) {
    if param == "ksmooth" {
        rt.set_kinematic_smoothing(v);
        return;
    }
    if let Some(rest) = param.strip_prefix("zone:") {
        let Some((idx, field)) = rest.split_once(':') else {
            return;
        };
        let Ok(i) = idx.parse::<usize>() else {
            return;
        };
        let mut zones = rt.zones();
        let Some(z) = zones.get_mut(i) else {
            return;
        };
        match field {
            "falloff" => z.falloff = v.max(0.0),
            "enabled" => z.enabled = v >= 0.5,
            "strength" => {
                if let Some(
                    stagespace_engines::zones::ZoneEffect::Repel { strength }
                    | stagespace_engines::zones::ZoneEffect::Attract { strength }
                    | stagespace_engines::zones::ZoneEffect::Dampen { strength }
                    | stagespace_engines::zones::ZoneEffect::Vortex { strength },
                ) = z.effect.as_mut()
                {
                    *strength = v;
                }
            }
            _ => return,
        }
        let z = z.clone();
        rt.update_zone(i, z);
        return;
    }
    if let Some(rest) = param.strip_prefix("mod:") {
        let Some((key, field)) = rest.split_once(':') else {
            return;
        };
        // `src>ch[@obj][#n]` — #n = occurrence (défaut 0).
        let (key, occ) = match key.split_once('#') {
            Some((k, n)) => (k, n.parse::<usize>().unwrap_or(0)),
            None => (key, 0),
        };
        let (src_ch, obj) = match key.split_once('@') {
            Some((a, b)) => (a, b.parse::<usize>().ok()),
            None => (key, None),
        };
        let obj = match (key.contains('@'), obj) {
            // `@` présent mais non numérique → clé invalide.
            (true, None) => return,
            _ => obj,
        };
        let Some((src, ch)) = src_ch.split_once('>') else {
            return;
        };
        let (Ok(src), Ok(ch)) = (
            stagespace_engines::KinematicSource::from_str(src),
            stagespace_engines::osc_sender::SpatialChannel::from_str(ch),
        ) else {
            return;
        };
        let rules = rt.modulations();
        let mut seen = 0usize;
        for (i, r) in rules.iter().enumerate() {
            if r.source == src && r.channel == ch && r.object == obj {
                if seen == occ {
                    let mut patched = r.clone();
                    match field {
                        "scale" => patched.scale = v,
                        "offset" => patched.offset = v,
                        "min" => patched.min = v,
                        "max" => patched.max = v,
                        _ => return,
                    }
                    rt.update_modulation(i, patched);
                    return;
                }
                seen += 1;
            }
        }
    }
}

fn eval_curves(
    cursor_ms: u64,
    targets: &HashMap<String, CurveTarget>,
    merge: &Arc<Mutex<stagespace_engines::MergeRuntime>>,
    master: &stagespace_engines::MacroState,
    abs: &AbsCurves<'_>,
    osc_source: &stagespace_engines::signal_compiler::SignalOscSource,
) {
    for (move_id, target) in targets {
        let lt = cursor_ms.saturating_sub(target.t0_ms);
        for (param, kfs) in &target.curves {
            if let Some(v) = sample_curve(kfs, lt) {
                if param.starts_with("param:") {
                    // Courbe absolue → delta `v − base` sur les slots du
                    // move (param modulable du graphe — même canal que
                    // le signal graph, relu à la frame suivante).
                    if let Some(tgts) = target.param_targets.get(param) {
                        if !tgts.is_empty() {
                            let mut ext = lock_or_recover(&target.param_deltas);
                            for ((nk, pk), base) in tgts {
                                ext.insert((nk.clone(), pk.clone()), v - base);
                            }
                        }
                    }
                } else if let Some(mk) = param.strip_prefix("merge:") {
                    // Blend params — côté MERGE, pas le worker :
                    // `fade × weight` est le poids effectif dans
                    // Override/Crossfade/Blend ; priority départage la
                    // stratégie Priority. Même canal que les IPC
                    // set_move_weight/set_move_priority.
                    let rt = lock_or_recover(merge);
                    match mk {
                        "weight" => rt.set_move_weight(move_id, v),
                        "priority" => rt.set_move_priority(move_id, v.max(0.0).round() as u32),
                        _ => {}
                    }
                } else {
                    write_macro_param(&target.macros, param, v);
                }
            }
        }
    }
    for (param, kfs) in abs.global_fx {
        if let Some(v) = sample_curve(kfs, cursor_ms) {
            write_macro_param(master, param, v);
        }
    }
    if !abs.spatial_fx.is_empty() {
        let rt = lock_or_recover(merge);
        for (param, kfs) in abs.spatial_fx {
            if let Some(v) = sample_curve(kfs, cursor_ms) {
                eval_spatial_fx_param(&rt, param, v);
            }
        }
    }
    if !abs.object.is_empty() {
        let rt = lock_or_recover(merge);
        for (obj, params) in abs.object {
            for (param, kfs) in params {
                if let Some(v) = sample_curve(kfs, cursor_ms) {
                    if param == "depth" {
                        rt.set_track_depth(*obj, v);
                    } else if let Ok(ch) =
                        stagespace_engines::osc_sender::SpatialChannel::from_str(param)
                    {
                        rt.set_object_channel(*obj, ch, v);
                    }
                }
            }
        }
    }
    if !abs.modulation.is_empty() {
        // Read-lock → map COURANTE (suit les rebinds du receiver),
        // puis une écriture par nom — `SignalOsc.name` les relit à la
        // frame suivante, comme une adresse OSC reçue.
        let map = osc_source.read().unwrap_or_else(|e| e.into_inner()).clone();
        let mut vals = lock_or_recover(&map);
        for (name, kfs) in abs.modulation {
            if let Some(v) = sample_curve(kfs, cursor_ms) {
                vals.insert(name.clone(), vec![v]);
            }
        }
    }
}

/// Lance la lecture — thread horloge qui exécute les clips sur Shared.
/// Spanning : un clip Slot qui chevauche le curseur démarre immédiatement
/// avec `set_time_offset(cursor - start)` ; les cue markers passés sont
/// skippés (l'état initial reste l'affaire de l'opérateur/conduite).
#[tauri::command]
pub async fn score_timeline_play(state: State<'_, AppState>) -> Result<(), IpcError> {
    let sh = Shared::from_state(&state);
    let tl_arc = state.score_timeline.clone();
    let (
        gen,
        clips,
        seek,
        lp,
        global_fx_curves,
        modulation_curves,
        object_curves,
        spatial_fx_curves,
    ) = {
        let mut tl = lock_or_recover(&tl_arc);
        tl.generation += 1;
        tl.started_at = Some(Instant::now());
        (
            tl.generation,
            tl.clips.clone(),
            tl.seek_ms,
            tl.loop_region,
            tl.global_fx_curves.clone(),
            tl.modulation_curves.clone(),
            tl.object_curves.clone(),
            tl.spatial_fx_curves.clone(),
        )
    };
    if clips.is_empty() {
        lock_or_recover(&tl_arc).started_at = None;
        return Err(IpcError::validation("score timeline empty"));
    }

    let sink = sh.event_sink.clone();
    std::thread::spawn(move || {
        // Lane → moves score actifs. En mode `exclusive` la liste reste
        // ≤1 (un nouveau clip coupe le précédent — console) ; en
        // `stacked` les moves se composent dans le merge.
        let mut lane_active: HashMap<String, Vec<(String, f64)>> = HashMap::new();
        // Cibles de courbes : move score → (macros per-move du worker,
        // t0 absolu, table). Rempli au fire (clips Slot avec curves),
        // vidé au EndMove/cut/hard-wrap. Les macros master du merge
        // sont prises une fois — Arc stable pour la durée du process.
        let mut curve_targets: HashMap<String, CurveTarget> = HashMap::new();
        let master_macros = lock_or_recover(&sh.merge_runtime).macros();
        // Source `SignalOsc` — handle EXTERNE (RwLock) : les écritures
        // modulation suivent les rebinds du receiver OSC.
        let osc_source = lock_or_recover(&sh.merge_runtime).osc_values_source();
        // Cycles de lecture : sans loop un seul passage ; avec loop, le
        // transport reboucle à `loop_start` (hard-wrap — les moves
        // score du cycle sont coupés avant de repartir, sémantique
        // "redémarrer la phrase" déterministe).
        let mut cycle_start = seek;
        'outer: loop {
            let t0 = Instant::now();
            let cursor = |elapsed: Duration| cycle_start + elapsed.as_millis() as u64;
            for (t, ev) in build_events(&clips, cycle_start) {
                // Borne de boucle : les événements ≥ loop_end sont
                // exclus du cycle (wrap dur, pas de pré-écoute).
                if lp.map(|(_, e)| t >= e).unwrap_or(false) {
                    break;
                }
                loop {
                    let elapsed = t0.elapsed();
                    if cursor(elapsed) >= t {
                        break;
                    }
                    if lock_or_recover(&tl_arc).generation != gen {
                        return;
                    }
                    std::thread::sleep(
                        Duration::from_millis(t - cursor(elapsed)).min(Duration::from_millis(50)),
                    );
                    // Tick courbes — chaque réveil ≤50 ms écrit les
                    // valeurs échantillonnées au curseur courant.
                    eval_curves(
                        cursor(t0.elapsed()),
                        &curve_targets,
                        &sh.merge_runtime,
                        &master_macros,
                        &AbsCurves {
                            global_fx: &global_fx_curves,
                            modulation: &modulation_curves,
                            object: &object_curves,
                            spatial_fx: &spatial_fx_curves,
                        },
                        &osc_source,
                    );
                }
                if lock_or_recover(&tl_arc).generation != gen {
                    return;
                }
                match ev {
                    Ev::Fire(i, k, offset) => fire_clip(
                        &clips[i],
                        k,
                        offset,
                        &sh,
                        &mut lane_active,
                        &mut curve_targets,
                        &sink,
                    ),
                    Ev::EndMove(id, fade) => {
                        for v in lane_active.values_mut() {
                            v.retain(|x| x.0 != id);
                        }
                        curve_targets.remove(&id);
                        if let Err(e) = deactivate_move_arc(&id, fade, true, &sh) {
                            eprintln!("[score] end-of-clip deactivate '{id}' failed: {e}");
                        }
                    }
                }
                // Les courbes du clip qui vient de tirer écrivent leurs
                // valeurs de t0 immédiatement (sinon ≤50 ms de retard).
                eval_curves(
                    cursor(t0.elapsed()),
                    &curve_targets,
                    &sh.merge_runtime,
                    &master_macros,
                    &AbsCurves {
                        global_fx: &global_fx_curves,
                        modulation: &modulation_curves,
                        object: &object_curves,
                        spatial_fx: &spatial_fx_curves,
                    },
                    &osc_source,
                );
            }
            match lp {
                Some((lstart, lend)) if lend > lstart => {
                    // Attendre la borne de boucle (les événements peuvent
                    // finir avant lend — trou de queue).
                    loop {
                        let elapsed = t0.elapsed();
                        if cursor(elapsed) >= lend {
                            break;
                        }
                        if lock_or_recover(&tl_arc).generation != gen {
                            return;
                        }
                        std::thread::sleep(
                            Duration::from_millis(lend - cursor(elapsed))
                                .min(Duration::from_millis(50)),
                        );
                        eval_curves(
                            cursor(t0.elapsed()),
                            &curve_targets,
                            &sh.merge_runtime,
                            &master_macros,
                            &AbsCurves {
                                global_fx: &global_fx_curves,
                                modulation: &modulation_curves,
                                object: &object_curves,
                                spatial_fx: &spatial_fx_curves,
                            },
                            &osc_source,
                        );
                    }
                    if lock_or_recover(&tl_arc).generation != gen {
                        return;
                    }
                    // Hard-cut : couper tous les moves score du cycle
                    // avant le rebouclage — chaque cycle repart propre.
                    // Un move multi-lanes apparaît dans la liste de
                    // chaque lane couverte → dédup avant le cut.
                    let drained: Vec<(String, f64)> = {
                        let mut seen = HashSet::new();
                        lane_active
                            .drain()
                            .flat_map(|(_, v)| v)
                            .filter(|(id, _)| seen.insert(id.clone()))
                            .collect()
                    };
                    for (id, fade) in drained {
                        curve_targets.remove(&id);
                        let _ = deactivate_move_arc(&id, fade, true, &sh);
                    }
                    emit_ui(&sink, "active-moves-update", ());
                    // Rebase du curseur partagé — l'état rapporté reflète
                    // le retour visuel à loop_start.
                    {
                        let mut tl = lock_or_recover(&tl_arc);
                        if tl.generation != gen {
                            return;
                        }
                        tl.seek_ms = lstart;
                        tl.started_at = Some(Instant::now());
                    }
                    let st = timeline_state(&lock_or_recover(&tl_arc));
                    emit_ui(&sink, "score-timeline", st);
                    cycle_start = lstart;
                }
                _ => break 'outer,
            }
        }
        let mut tl = lock_or_recover(&tl_arc);
        if tl.generation == gen {
            tl.started_at = None;
        }
        let st = timeline_state(&tl);
        drop(tl);
        emit_ui(&sink, "score-timeline", st);
    });
    // État play poussé aussi — resync des vues (remote, reload).
    let st = timeline_state(&lock_or_recover(&state.score_timeline));
    emit_ui(&state.event_sink, "score-timeline", st);
    Ok(())
}

/// Liste d'événements du lecteur : démarrages de clips + fins auto des
/// moves score (Slots). Extrait de la commande pour être testable en
/// unit — la détermination des timestamps est pure.
enum Ev {
    /// clip index, itération (repeat), offset_ms (seek à cheval)
    Fire(usize, u64, u64),
    /// movement_id, fade_out
    EndMove(String, f64),
}

/// Compile les clips résolus en liste d'événements ordonnée à partir
/// de `seek`. Un clip `repeat_every_ms` s'expande en copies à
/// `start + k·every` bornées par sa fenêtre `duration_ms` — les
/// répétitions sont matérialisées au play (pas de scheduler
/// infini) : déterministe, borné (4096 itérations max), seek sûr.
fn build_events(clips: &[ScoreClip], seek: u64) -> Vec<(u64, Ev)> {
    let mut events: Vec<(u64, Ev)> = Vec::new();
    for (i, c) in clips.iter().enumerate() {
        // Expansion des répétitions — (fire_at, itération, fin du move
        // score pour cette itération). repeat_every requiert duration_ms
        // (la fenêtre borne les copies) — sans fenêtre, une seule fois
        // + avertissement (jamais de génération non bornée).
        let iterations: Vec<(u64, u64, Option<u64>)> = match (c.repeat_every_ms, c.duration_ms) {
            (Some(every), Some(window)) if every > 0 => {
                let mut v = Vec::new();
                for k in 0u64..4096 {
                    let fk = c.start_ms + k * every;
                    if fk >= c.start_ms + window {
                        break;
                    }
                    v.push((fk, k, Some((fk + every).min(c.start_ms + window))));
                }
                v
            }
            (Some(_), _) => {
                eprintln!(
                    "[score] clip '{}': repeat_every ignoré — duration_ms requis",
                    c.id
                );
                vec![(c.start_ms, 0, None)]
            }
            _ => vec![(c.start_ms, 0, c.duration_ms.map(|d| c.start_ms + d))],
        };
        for (fire_at, k, iter_end) in iterations {
            if fire_at >= seek {
                events.push((fire_at, Ev::Fire(i, k, 0)));
            } else if matches!(c.payload, ScoreClipPayload::Slot { .. })
                && iter_end.map(|e| e > seek).unwrap_or(true)
            {
                // Itération de slot à cheval sur le curseur → offset.
                events.push((seek, Ev::Fire(i, k, seek - fire_at)));
            }
            // Cue markers déjà passés : skippés (documenté — pas de catch-up).
            if let (Some(e), ScoreClipPayload::Slot { request, .. }) = (iter_end, &c.payload) {
                if e > seek {
                    // fade_out effectif : l'override clip-local prime
                    // sur le fade de l'animation du slot.
                    let fade = c
                        .fade_out_ms
                        .map(|m| m as f64 / 1000.0)
                        .or_else(|| request.animation.as_ref().map(|a| a.fade_out))
                        .unwrap_or(0.5);
                    let mv_id = if c.repeat_every_ms.is_some() {
                        format!("{}-{k}", request.movement_id)
                    } else {
                        request.movement_id.clone()
                    };
                    events.push((e, Ev::EndMove(mv_id, fade)));
                }
            }
        }
    }
    events.sort_by_key(|(t, _)| *t);
    events
}

/// Exécute un clip — mêmes chemins que les actions opérateur/OSC.
/// Lane réservée — les moves respawnés par les recalls de cue s'y
/// enregistrent pour le cleanup wrap/stop (barrière d'état, design
/// §Cues on the timeline). Même id côté frontend (`CONDUCTOR_LANE`).
const CONDUCTOR_LANE: &str = "conductor";

fn fire_clip(
    clip: &ScoreClip,
    iteration: u64,
    offset_ms: u64,
    sh: &Shared,
    lane_active: &mut HashMap<String, Vec<(String, f64)>>,
    curve_targets: &mut HashMap<String, CurveTarget>,
    sink: &Arc<Mutex<Option<crate::commands::state::EventSink>>>,
) {
    match &clip.payload {
        ScoreClipPayload::Slot { request, macros } => {
            // Mode exclusive PAR LANE : les moves score actifs sur
            // chaque lane exclusive occupée sont coupés d'abord —
            // dernier clip gagne (console). Sur les lanes stacked ils
            // continuent : leurs sorties se composent dans le merge.
            for lane in clip.lanes.iter().filter(|l| !l.stacked) {
                if let Some(prev) = lane_active.remove(&lane.id) {
                    for (prev_id, prev_fade) in prev {
                        curve_targets.remove(&prev_id);
                        let _ = deactivate_move_arc(&prev_id, prev_fade, true, sh);
                        // Un move multi-lanes coupé ici resterait
                        // enregistré actif sur ses autres lanes (état
                        // stale + futur deactivate en trop) — purge.
                        for v in lane_active.values_mut() {
                            v.retain(|x| x.0 != prev_id);
                        }
                    }
                }
            }
            let mut req = request.as_ref().clone();
            // Itérations d'un clip répété : id suffixé par itération —
            // chaque copie est un move distinct (les EndMove ciblent par id).
            if clip.repeat_every_ms.is_some() {
                req.movement_id = format!("{}-{iteration}", req.movement_id);
            }
            // Fades clip-local : override de l'animation du slot quand
            // présents (None = héritage). L'override du fade_out est
            // aussi celui stocké pour les cuts/EndMove ultérieurs.
            if let Some(a) = req.animation.as_mut() {
                if let Some(ms) = clip.fade_in_ms {
                    a.fade_in = ms as f64 / 1000.0;
                }
                if let Some(ms) = clip.fade_out_ms {
                    a.fade_out = ms as f64 / 1000.0;
                }
            }
            match spawn_move(spec_from_request(req.clone()), sh) {
                Ok(_) => {
                    if let Some(m) = macros {
                        apply_set_macro_request(m, &lock_or_recover(&sh.merge_runtime));
                    }
                    if offset_ms > 0 || !clip.curves.is_empty() {
                        if let Some(mv) = lock_or_recover(&sh.movements).get(&req.movement_id) {
                            if offset_ms > 0 {
                                mv.runtime.set_time_offset(offset_ms as f64 / 1000.0);
                            }
                            // Courbes clip-scoped → macros per-move du
                            // worker (scope PerMove). t0 = début ABSOLU
                            // de cette itération (start + k·repeat) —
                            // le spanning (offset>0) n'affecte que la
                            // phase interne du move, pas le temps de
                            // courbe qui suit le curseur timeline.
                            if !clip.curves.is_empty() {
                                // Cibles `param:` résolues sur le
                                // graph_json de la request (id node ou
                                // type-wide — mêmes règles que le
                                // signal compiler), base lue dans les
                                // params du node.
                                let param_targets = clip
                                    .curves
                                    .keys()
                                    .filter(|k| k.starts_with("param:"))
                                    .map(|k| (k.clone(), resolve_param_targets(&req.graph_json, k)))
                                    .collect();
                                curve_targets.insert(
                                    req.movement_id.clone(),
                                    CurveTarget {
                                        macros: mv.runtime.macros(),
                                        param_deltas: mv.runtime.param_deltas(),
                                        param_targets,
                                        t0_ms: clip.start_ms
                                            + iteration * clip.repeat_every_ms.unwrap_or(0),
                                        curves: clip.curves.clone(),
                                    },
                                );
                            }
                        }
                    }
                    let fade_out = req.animation.as_ref().map(|a| a.fade_out).unwrap_or(0.5);
                    // Le move s'enregistre dans TOUTES ses lanes : il
                    // est coupé si l'une d'elles (exclusive) reçoit un
                    // nouveau clip, et drainé au hard-wrap partout.
                    for lane in &clip.lanes {
                        lane_active
                            .entry(lane.id.clone())
                            .or_default()
                            .push((req.movement_id.clone(), fade_out));
                    }
                    emit_ui(sink, "active-moves-update", ());
                }
                Err(e) => eprintln!("[score] clip '{}' spawn failed: {}", clip.id, e),
            }
        }
        ScoreClipPayload::Cue(cue) => {
            // recall_cue_inner gère le flag concurrent (CAS + RAII) —
            // un recall opérateur en cours → Err(busy), le clip est skippé.
            match recall_cue_inner((**cue).clone(), sh.clone()) {
                Ok(()) => {
                    // Barrière d'état (design §Cues on the timeline) :
                    // un recall Full a tué les moves non listés — les
                    // moves score trackés sont morts, le score perd
                    // l'autorité jusqu'au prochain clip. Purge sinon les
                    // entrées stales pollueraient cuts/wraps futurs.
                    if cue.mode == stagespace_engines::CueMode::Full {
                        lane_active.clear();
                        curve_targets.clear();
                    }
                    // Les moves respawnés par le snapshot (ids statiques,
                    // connus dans cue.moves) s'enregistrent sur la lane
                    // conductor pour le cleanup wrap/stop — sans ça ils
                    // fuiraient entre les cycles de loop.
                    let respawned: Vec<(String, f64)> =
                        cue.moves.iter().map(|m| (m.id.clone(), 0.0)).collect();
                    if !respawned.is_empty() {
                        lane_active
                            .entry(CONDUCTOR_LANE.to_string())
                            .or_default()
                            .extend(respawned);
                    }
                    emit_ui(sink, "active-moves-update", ());
                }
                // Busy-skip remonté à l'opérateur — une cue manquée dans
                // un show est un événement visible, pas un log backend.
                Err(e) => emit_ui(
                    sink,
                    "score-nack",
                    serde_json::json!({ "clip_id": clip.id, "reason": e.to_string() }),
                ),
            }
        }
        ScoreClipPayload::StopAll => {
            let _ = deactivate_all_arc(0.0, true, sh);
            // Barrière aussi : tout ce que le score avait spawné est mort.
            lane_active.clear();
            curve_targets.clear();
        }
        ScoreClipPayload::Panic => {
            let _ = deactivate_all_arc(0.0, false, sh);
            lane_active.clear();
            curve_targets.clear();
        }
        ScoreClipPayload::Positions { positions } => {
            // Même chemin que /stagespace/position — takeover manuel
            // des objets listés (persiste jusqu'à override/clear).
            let rt = lock_or_recover(&sh.merge_runtime);
            for (obj, pos) in positions {
                rt.set_manual_position(*obj, *pos);
            }
        }
        ScoreClipPayload::SignalGraph { graph } => {
            // update_signal_graph scope global — graph vide = reset.
            let signal_fn = if graph.nodes.is_empty() {
                Some(stagespace_engines::signal_compiler::empty_signal_fn())
            } else {
                let audio_state = lock_or_recover(&sh.audio_state);
                crate::graph::parser::build_graph_from_json(graph, &audio_state)
                    .map_err(|e| format!("parse: {e}"))
                    .and_then(|g| {
                        stagespace_engines::compile_signal_graph(&g)
                            .map_err(|e| format!("compile: {e:?}"))
                    })
                    .map_err(|e| {
                        eprintln!("[score] clip '{}': signal graph rejeté — {e}", clip.id);
                        e
                    })
                    .ok()
            };
            if let Some(f) = signal_fn {
                lock_or_recover(&sh.merge_runtime).swap_signal_fn(f);
            }
        }
        ScoreClipPayload::PostGraph { graph } => {
            // recall_cue étape 1 : parse → effets → compile → swap. Un
            // graphe invalide logue sans crasher (ni la lecture ni le
            // post-process courant ne sont interrompus).
            let rt = lock_or_recover(&sh.merge_runtime);
            let audio_state = lock_or_recover(&sh.audio_state);
            let compiled = crate::graph::parser::build_graph_from_json(graph, &audio_state)
                .map_err(|e| format!("parse: {e}"))
                .and_then(|g| {
                    let effects = stagespace_engines::extract_graph_effects(&g)
                        .map_err(|e| format!("effects: {e:?}"))?;
                    let f = stagespace_engines::compile_post_process(
                        stagespace_engines::PostProcessCompileParams {
                            graph: g,
                            macros: rt.macros(),
                        },
                    )
                    .map_err(|e| format!("compile: {e:?}"))?;
                    Ok((f, effects))
                });
            match compiled {
                Ok((f, effects)) => {
                    rt.swap_post_process_fn(f);
                    rt.set_graph_effects(effects.zones, effects.modulations, effects.move_ref);
                    if let Some(strategy) = effects.strategy {
                        rt.set_merge_strategy(strategy);
                    }
                }
                Err(e) => eprintln!("[score] clip '{}': global graph rejeté — {e}", clip.id),
            }
        }
        ScoreClipPayload::ChanMods { modulations } => {
            // recall_cue : clear + install de la table MANUELLE —
            // les règles Velocity du graphe (graph_modulations) ne
            // sont pas touchées (disjoint).
            let rt = lock_or_recover(&sh.merge_runtime);
            rt.clear_modulations();
            for r in modulations {
                if let Err(e) = rt.add_modulation(r.clone()) {
                    eprintln!("[score] clip '{}': modulation rejetée — {e}", clip.id);
                }
            }
        }
        ScoreClipPayload::Zones { zones } => {
            // recall_cue : clear + install des zones MANUELLES — les
            // zones du graphe (graph_zones) ne sont pas touchées.
            let rt = lock_or_recover(&sh.merge_runtime);
            rt.clear_zones();
            for z in zones {
                if let Err(e) = rt.add_zone(z.clone()) {
                    eprintln!("[score] clip '{}': zone rejetée — {e}", clip.id);
                }
            }
        }
        ScoreClipPayload::Gesture { name, strength } => {
            // /stagespace/gesture — impulsion sur les objets émis.
            lock_or_recover(&sh.merge_runtime).gesture(name, *strength);
        }
        ScoreClipPayload::Park { objects } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            if objects.is_empty() {
                eprintln!("[score] clip '{}': park sans cible — ignoré", clip.id);
            }
            for &o in objects {
                rt.park_object(o);
            }
        }
        ScoreClipPayload::Unpark { objects } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            if objects.is_empty() {
                rt.clear_parked();
            } else {
                for &o in objects {
                    rt.unpark_object(o);
                }
            }
        }
        ScoreClipPayload::Throw { objects, vel } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            for &o in objects {
                rt.throw_object(o, *vel);
            }
        }
        ScoreClipPayload::ManualClear { objects } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            if objects.is_empty() {
                rt.clear_all_manual_positions();
            } else {
                for &o in objects {
                    rt.clear_manual_position(o);
                }
            }
        }
        ScoreClipPayload::Attention { obj } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            match obj {
                Some(o) => rt.attention_focus(*o),
                None => rt.attention_release(),
            }
        }
    }
}

/// Stoppe la lecture — les clips déjà tirés restent (stop = arrêt de
/// l'horloge, pas panic : les moves en cours continuent, l'opérateur
/// reprend la main). Les tirs futurs s'abortent <50ms.
#[tauri::command]
pub async fn score_timeline_stop(state: State<'_, AppState>) -> Result<(), IpcError> {
    let mut tl = lock_or_recover(&state.score_timeline);
    tl.generation += 1;
    tl.started_at = None;
    let st = timeline_state(&tl);
    drop(tl);
    emit_ui(&state.event_sink, "score-timeline", st);
    Ok(())
}

/// Déplace le curseur de base — stopped only : un seek en lecture
/// demanderait de défaire/refaire des clips (kill-respawn), S3.
#[tauri::command]
pub async fn score_timeline_seek(ms: u64, state: State<'_, AppState>) -> Result<(), IpcError> {
    let mut tl = lock_or_recover(&state.score_timeline);
    if tl.started_at.is_some() {
        return Err(IpcError::busy("score playing — stop before seek"));
    }
    tl.seek_ms = ms;
    let st = timeline_state(&tl);
    drop(tl);
    emit_ui(&state.event_sink, "score-timeline", st);
    Ok(())
}

/// État de la timeline — resync UI après reload (PLAY affiché, curseur).
#[tauri::command]
pub async fn score_timeline_state(
    state: State<'_, AppState>,
) -> Result<ScoreTimelineState, IpcError> {
    Ok(timeline_state(&lock_or_recover(&state.score_timeline)))
}

/// Arme/désarme la region de boucle [start, end) — rebouclage du
/// transport (hard-wrap : les moves score du cycle sont coupés au
/// rebouclage). Appliqué à la prochaine lecture ; en cours de lecture
/// la config courante est déjà capturée — changer la loop live est S3.
#[tauri::command]
pub async fn score_timeline_set_loop(
    start_ms: Option<u64>,
    end_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut tl = lock_or_recover(&state.score_timeline);
    tl.loop_region = match (start_ms, end_ms) {
        (Some(s), Some(e)) if e > s => Some((s, e)),
        (None, None) => None,
        _ => {
            return Err(IpcError::validation(
                "loop requires start < end (both set or neither)",
            ))
        }
    };
    let st = timeline_state(&tl);
    drop(tl);
    emit_ui(&state.event_sink, "score-timeline", st);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn tape_with(entries: Vec<ScoreTapeEntry>) -> Arc<Mutex<ScoreTape>> {
        Arc::new(Mutex::new(ScoreTape {
            entries,
            ..Default::default()
        }))
    }

    #[test]
    fn state_reports_cursor_and_len() {
        let tape = tape_with(vec![
            ScoreTapeEntry {
                t: 0,
                name: "doGo".into(),
                args: vec![],
            },
            ScoreTapeEntry {
                t: 5000,
                name: "doPanic".into(),
                args: vec![],
            },
        ]);
        {
            let mut t = tape.lock().unwrap_or_else(|e| e.into_inner());
            t.started_at = Some(Instant::now());
        }
        let s = tape_state(&lock_or_recover(&tape));
        assert!(s.playing);
        assert_eq!(s.len, 2);
        assert!(s.cursor_ms < 5000);
    }

    #[test]
    fn stopped_tape_is_not_playing() {
        let tape = tape_with(vec![]);
        assert!(!tape_state(&lock_or_recover(&tape)).playing);
    }

    fn slot_clip(
        id: &str,
        start_ms: u64,
        duration_ms: Option<u64>,
        repeat_every_ms: Option<u64>,
    ) -> ScoreClip {
        ScoreClip {
            id: id.to_string(),
            lanes: vec![ScoreLane {
                id: "obj-1".to_string(),
                stacked: false,
            }],
            start_ms,
            duration_ms,
            repeat_every_ms,
            fade_in_ms: None,
            fade_out_ms: None,
            curves: HashMap::new(),
            payload: ScoreClipPayload::Slot {
                request: Box::new(ActivateMoveRequest {
                    movement_id: format!("sc-{id}"),
                    name: "test".to_string(),
                    graph_json: stagespace_engines::GraphJson::default(),
                    osc_ids: vec![1],
                    track_indices: vec![0],
                    is_preview: false,
                    origin: None,
                    duration: 10.0,
                    loop_mode: "loop".to_string(),
                    direction: "forward".to_string(),
                    animation: None,
                    end_mode: stagespace_engines::EndMode::default(),
                    anchor_mode: stagespace_engines::AnchorMode::default(),
                    anchor_target: None,
                }),
                macros: None,
            },
        }
    }

    fn events_map(evs: &[(u64, Ev)]) -> Vec<(u64, String)> {
        evs.iter()
            .map(|(t, ev)| {
                let desc = match ev {
                    Ev::Fire(i, k, off) => format!("fire:{i}:k{k}:+{off}"),
                    Ev::EndMove(id, _) => format!("end:{id}"),
                };
                (*t, desc)
            })
            .collect()
    }

    #[test]
    fn repeat_expands_into_bounded_copies() {
        // Fenêtre 10s, période 2s → 5 copies à 0,2,4,6,8 — chacune
        // vit une période (EndMove au prochain pas / fin de fenêtre).
        let clips = vec![slot_clip("c1", 0, Some(10_000), Some(2_000))];
        let evs = events_map(&build_events(&clips, 0));
        assert_eq!(
            evs,
            vec![
                (0, "fire:0:k0:+0".to_string()),
                (2000, "end:sc-c1-0".to_string()),
                (2000, "fire:0:k1:+0".to_string()),
                (4000, "end:sc-c1-1".to_string()),
                (4000, "fire:0:k2:+0".to_string()),
                (6000, "end:sc-c1-2".to_string()),
                (6000, "fire:0:k3:+0".to_string()),
                (8000, "end:sc-c1-3".to_string()),
                (8000, "fire:0:k4:+0".to_string()),
                (10000, "end:sc-c1-4".to_string()),
            ]
        );
    }

    #[test]
    fn repeat_seek_spans_iteration_with_offset() {
        // Seek à 5s : l'itération k2 (4→6s) est à cheval → fire offset
        // 1s à l'instant du seek ; les copies < seek sont mortes.
        let clips = vec![slot_clip("c1", 0, Some(10_000), Some(2_000))];
        let evs = events_map(&build_events(&clips, 5_000));
        assert_eq!(
            evs,
            vec![
                (5000, "fire:0:k2:+1000".to_string()),
                (6000, "end:sc-c1-2".to_string()),
                (6000, "fire:0:k3:+0".to_string()),
                (8000, "end:sc-c1-3".to_string()),
                (8000, "fire:0:k4:+0".to_string()),
                (10000, "end:sc-c1-4".to_string()),
            ]
        );
    }

    #[test]
    fn repeat_without_window_fires_once() {
        // repeat_every sans duration_ms → pas de fenêtre borne → une
        // seule fois (jamais de génération non bornée).
        let clips = vec![slot_clip("c1", 0, None, Some(2_000))];
        let evs = events_map(&build_events(&clips, 0));
        assert_eq!(evs, vec![(0, "fire:0:k0:+0".to_string())]);
    }

    #[test]
    fn non_repeat_clip_unchanged() {
        // Régression : un clip simple garde Fire + EndMove sur l'id de base.
        let clips = vec![slot_clip("c1", 1_000, Some(3_000), None)];
        let evs = events_map(&build_events(&clips, 0));
        assert_eq!(
            evs,
            vec![
                (1000, "fire:0:k0:+0".to_string()),
                (4000, "end:sc-c1".to_string()),
            ]
        );
    }

    #[test]
    fn clip_fade_out_overrides_animation_fade() {
        // fade_out_ms du clip prime sur le fade de l'animation du
        // slot : l'EndMove emporte l'override (utilisé au cut).
        let mut clips = vec![slot_clip("c1", 0, Some(2_000), None)];
        if let ScoreClipPayload::Slot { request, .. } = &mut clips[0].payload {
            request.animation = Some(stagespace_engines::Animation {
                fade_out: 0.5,
                ..Default::default()
            });
        }
        clips[0].fade_out_ms = Some(3_000);
        let evs = build_events(&clips, 0);
        let fade = evs.iter().find_map(|(_, ev)| match ev {
            Ev::EndMove(_, f) => Some(*f),
            _ => None,
        });
        assert_eq!(fade, Some(3.0)); // 3 000 ms → 3 s, pas le 0.5 du slot
    }

    #[test]
    fn clip_fade_inherited_when_unset() {
        // Sans override : l'EndMove retombe sur le fade de l'animation.
        let mut clips = vec![slot_clip("c1", 0, Some(2_000), None)];
        if let ScoreClipPayload::Slot { request, .. } = &mut clips[0].payload {
            request.animation = Some(stagespace_engines::Animation {
                fade_out: 1.25,
                ..Default::default()
            });
        }
        let evs = build_events(&clips, 0);
        let fade = evs.iter().find_map(|(_, ev)| match ev {
            Ev::EndMove(_, f) => Some(*f),
            _ => None,
        });
        assert_eq!(fade, Some(1.25));
    }

    #[test]
    fn new_fields_default_on_old_wire_payloads() {
        // Compat arrière : un ScoreClip sérialisé avant fades/stacked
        // (les trois champs absents) se désérialise avec les défauts.
        let json = r#"{"id":"c1","start_ms":0,
            "payload":{"kind":"StopAll"}}"#;
        let c: ScoreClip = serde_json::from_str(json).unwrap();
        assert_eq!(c.fade_in_ms, None);
        assert_eq!(c.fade_out_ms, None);
        assert!(c.lanes.is_empty());
        assert!(c.curves.is_empty());
    }

    #[test]
    fn curve_samples_linear_between_keyframes() {
        let kfs = vec![
            ScoreKeyframe {
                t: 0,
                v: 1.0,
                interp: ScoreInterp::Linear,
            },
            ScoreKeyframe {
                t: 4_000,
                v: 2.0,
                interp: ScoreInterp::Linear,
            },
            ScoreKeyframe {
                t: 8_000,
                v: 0.0,
                interp: ScoreInterp::Linear,
            },
        ];
        // Bords : clamp avant le premier / après le dernier point.
        assert_eq!(sample_curve(&kfs, 0), Some(1.0));
        assert_eq!(sample_curve(&kfs, 8_000), Some(0.0));
        assert_eq!(sample_curve(&kfs, 20_000), Some(0.0));
        // Milieu de rampe montante puis descendante.
        assert_eq!(sample_curve(&kfs, 2_000), Some(1.5));
        assert_eq!(sample_curve(&kfs, 6_000), Some(1.0));
        // Exactement sur un keyframe.
        assert_eq!(sample_curve(&kfs, 4_000), Some(2.0));
        // Cas limites.
        assert_eq!(sample_curve(&[], 100), None);
        assert_eq!(
            sample_curve(
                &[ScoreKeyframe {
                    t: 500,
                    v: 3.0,
                    interp: ScoreInterp::Linear
                }],
                0
            ),
            Some(3.0)
        );
    }

    #[test]
    fn curve_samples_step_and_smooth_interps() {
        // step : la valeur du keyframe tient jusqu'au suivant (front
        // montant au keyframe lui-même, pas avant).
        let step = vec![
            ScoreKeyframe {
                t: 0,
                v: 1.0,
                interp: ScoreInterp::Step,
            },
            ScoreKeyframe {
                t: 4_000,
                v: 3.0,
                interp: ScoreInterp::Step,
            },
        ];
        assert_eq!(sample_curve(&step, 1_999), Some(1.0));
        assert_eq!(sample_curve(&step, 4_000), Some(3.0));
        // smooth : smoothstep f²(3−2f) — milieu = moyenne, quart =
        // 0.156·Δ (ease in), pas de dépassement.
        let smooth = vec![
            ScoreKeyframe {
                t: 0,
                v: 0.0,
                interp: ScoreInterp::Smooth,
            },
            ScoreKeyframe {
                t: 4_000,
                v: 4.0,
                interp: ScoreInterp::Smooth,
            },
        ];
        assert_eq!(sample_curve(&smooth, 2_000), Some(2.0));
        let q = sample_curve(&smooth, 1_000).unwrap();
        assert!((q - 4.0 * (0.25 * 0.25 * (3.0 - 0.5))).abs() < 1e-9);
        // Linear reste le défaut serde — payload sans `interp` lit linear.
        let legacy: ScoreKeyframe = serde_json::from_str(r#"{"t":100,"v":2.5}"#).unwrap();
        assert_eq!(legacy.interp, ScoreInterp::Linear);
    }

    #[test]
    fn write_macro_param_updates_axes_independently() {
        let m = stagespace_engines::MacroState::new();
        // Aliases offset_* == shift_* (convention overrides/signal).
        write_macro_param(&m, "shift_x", 2.0);
        write_macro_param(&m, "offset_y", -1.0);
        let s = m.get_shift();
        assert_eq!(s.x, 2.0);
        assert_eq!(s.y, -1.0);
        assert_eq!(s.z, 0.0);
        // Rotation : un axe modifié n'écrase pas les deux autres.
        m.set_rotation(10.0, 20.0, 30.0);
        write_macro_param(&m, "pitch", 99.0);
        let (y, p, r) = m.get_rotation();
        assert_eq!((y, p, r), (10.0, 99.0, 30.0));
        // Scalaires.
        write_macro_param(&m, "speed", 2.5);
        write_macro_param(&m, "radius_scale", 1.4);
        write_macro_param(&m, "height_offset", -3.0);
        assert_eq!(m.get_speed(), 2.5);
        assert_eq!(m.get_radius_scale(), 1.4);
        assert_eq!(m.get_height_offset(), -3.0);
        // Param inconnu → no-op (pas de panic).
        write_macro_param(&m, "bogus", 1.0);
    }

    #[test]
    fn eval_curves_writes_per_move_and_global_scopes() {
        // Clip-scoped → le MacroState du move ; master → celui du
        // merge. Les deux scopes restent disjoints (contrat
        // MacroScope : un param piloté par UN scope).
        let move_macros = stagespace_engines::MacroState::new();
        let merge_macros = stagespace_engines::MacroState::new();
        let mut curves = HashMap::new();
        curves.insert(
            "speed".to_string(),
            vec![
                ScoreKeyframe {
                    t: 0,
                    v: 1.0,
                    interp: ScoreInterp::Linear,
                },
                ScoreKeyframe {
                    t: 2_000,
                    v: 3.0,
                    interp: ScoreInterp::Linear,
                },
            ],
        );
        // Blend params — côté merge (`merge:` prefix), pas le worker.
        curves.insert(
            "merge:weight".to_string(),
            vec![
                ScoreKeyframe {
                    t: 0,
                    v: 1.0,
                    interp: ScoreInterp::Linear,
                },
                ScoreKeyframe {
                    t: 2_000,
                    v: 1.8,
                    interp: ScoreInterp::Linear,
                },
            ],
        );
        curves.insert(
            "merge:priority".to_string(),
            vec![
                ScoreKeyframe {
                    t: 0,
                    v: 0.0,
                    interp: ScoreInterp::Linear,
                },
                ScoreKeyframe {
                    t: 2_000,
                    v: 8.0,
                    interp: ScoreInterp::Linear,
                },
            ],
        );
        let mut targets = HashMap::new();
        targets.insert(
            "sc-c1".to_string(),
            CurveTarget {
                macros: Arc::new(move_macros),
                param_deltas: Arc::new(Mutex::new(HashMap::new())),
                param_targets: HashMap::new(),
                t0_ms: 1_000, // clip à 1s → t local = cursor - 1s
                curves,
            },
        );
        let mut master = HashMap::new();
        master.insert(
            "shift_y".to_string(),
            vec![
                ScoreKeyframe {
                    t: 0,
                    v: 0.0,
                    interp: ScoreInterp::Linear,
                },
                ScoreKeyframe {
                    t: 4_000,
                    v: 4.0,
                    interp: ScoreInterp::Linear,
                },
            ],
        );
        let mv = targets["sc-c1"].macros.clone();
        let osc_source: stagespace_engines::signal_compiler::SignalOscSource = std::sync::Arc::new(
            std::sync::RwLock::new(std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()))),
        );
        let modulation = HashMap::from([(
            "/score/energy".to_string(),
            vec![
                ScoreKeyframe {
                    t: 0,
                    v: 0.0,
                    interp: ScoreInterp::Linear,
                },
                ScoreKeyframe {
                    t: 4_000,
                    v: 1.0,
                    interp: ScoreInterp::Linear,
                },
            ],
        )]);
        let merge_rt = Arc::new(Mutex::new(
            stagespace_engines::MergeRuntime::new(
                "127.0.0.1".into(),
                8000,
                stagespace_engines::OscSender::default(),
                60.0,
            )
            .expect("merge runtime"),
        ));
        // Le move doit exister dans active_moves pour que les setters
        // merge:weight/priority aient une cible.
        merge_rt
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .register_move(
                "sc-c1".to_string(),
                Arc::new(stagespace_engines::PositionBuffer::new()),
                vec![0],
                vec![0],
                false,
                stagespace_engines::EndMode::default(),
            );
        // Courbes des lanes objet : `depth` → set_track_depth,
        // canal nommé → set_object_channel — vrais params runtime.
        let object_curves = HashMap::from([(
            0usize,
            HashMap::from([
                (
                    "depth".to_string(),
                    vec![
                        ScoreKeyframe {
                            t: 0,
                            v: 1.0,
                            interp: ScoreInterp::Linear,
                        },
                        ScoreKeyframe {
                            t: 4_000,
                            v: 0.0,
                            interp: ScoreInterp::Linear,
                        },
                    ],
                ),
                (
                    "spread".to_string(),
                    vec![ScoreKeyframe {
                        t: 0,
                        v: 60.0,
                        interp: ScoreInterp::Step,
                    }],
                ),
            ]),
        )]);
        // Courbes SPATIALFX : `ksmooth` → lissage cinématique ;
        // `zone:<i>:<field>`/`mod:<key>:<field>` → patch en place des
        // tables manuelles (la courbe réécrit la définition, jamais
        // l'influence évaluée par le merge).
        {
            let rt = merge_rt.lock().unwrap_or_else(|e| e.into_inner());
            rt.add_zone(stagespace_engines::Zone {
                shape: stagespace_engines::ZoneShape::Sphere {
                    center: [0.0, 0.0, 0.0],
                    radius: 2.0,
                },
                falloff: 1.0,
                channels: stagespace_engines::SpatialChannels::default(),
                objects: None,
                enabled: true,
                effect: Some(stagespace_engines::zones::ZoneEffect::Repel { strength: 1.0 }),
            })
            .expect("zone");
            rt.add_modulation(stagespace_engines::ChannelModulation::new(
                stagespace_engines::KinematicSource::Speed,
                stagespace_engines::osc_sender::SpatialChannel::Spread,
                1.5,
            ))
            .expect("modulation");
        }
        let spatial_fx_curves = HashMap::from([
            (
                "ksmooth".to_string(),
                vec![ScoreKeyframe {
                    t: 0,
                    v: 0.9,
                    interp: ScoreInterp::Step,
                }],
            ),
            (
                "zone:0:falloff".to_string(),
                vec![ScoreKeyframe {
                    t: 0,
                    v: 3.0,
                    interp: ScoreInterp::Step,
                }],
            ),
            (
                "zone:0:enabled".to_string(),
                vec![ScoreKeyframe {
                    t: 0,
                    v: 0.0,
                    interp: ScoreInterp::Step,
                }],
            ),
            (
                "zone:0:strength".to_string(),
                vec![ScoreKeyframe {
                    t: 0,
                    v: 5.0,
                    interp: ScoreInterp::Step,
                }],
            ),
            (
                "mod:speed>spread:scale".to_string(),
                vec![ScoreKeyframe {
                    t: 0,
                    v: 4.0,
                    interp: ScoreInterp::Step,
                }],
            ),
        ]);
        eval_curves(
            2_000,
            &targets,
            &merge_rt,
            &merge_macros,
            &AbsCurves {
                global_fx: &master,
                modulation: &modulation,
                object: &object_curves,
                spatial_fx: &spatial_fx_curves,
            },
            &osc_source,
        );
        // t local = 1s → speed = 1 + (2-1)·(3-1)/2 = 2.
        assert_eq!(mv.get_speed(), 2.0);
        // cursor 2s → shift_y = 2.0 sur le scope global.
        assert_eq!(merge_macros.get_shift().y, 2.0);
        // cursor 2s → modulation "/score/energy" = 0.5 dans la map OSC.
        let map = osc_source.read().unwrap().clone();
        assert_eq!(lock_or_recover(&map)["/score/energy"], vec![0.5]);
        // Le scope master ne touche pas le move, et réciproquement.
        assert_eq!(merge_macros.get_speed(), 1.0);
        assert_eq!(mv.get_shift().y, 0.0);
        // merge:weight → 1.0 + 0.8·(1s/2s) = 1.4 ; merge:priority → 4.
        let rt = merge_rt.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(rt.get_move_weight("sc-c1"), Some(1.4));
        assert_eq!(rt.get_move_priority("sc-c1"), Some(4));
        // Lanes objet : depth obj0 → 1 − 1·(2s/4s) = 0.5 ; spread = 60.
        assert_eq!(rt.track_depths()[0], 0.5);
        assert_eq!(
            rt.object_channels()[&0].spread,
            Some(60.0),
            "la courbe channel doit écrire object_channels"
        );
        // Lane SPATIALFX : ksmooth patché ; zone[0] falloff/strength
        // patchés et enabled coupé ; la règle speed>spread scalée ×4.
        assert!((rt.kinematic_smoothing() - 0.9).abs() < 1e-9);
        assert!((rt.zones()[0].falloff - 3.0).abs() < 1e-9);
        assert!(!rt.zones()[0].enabled);
        assert_eq!(
            rt.zones()[0].effect,
            Some(stagespace_engines::zones::ZoneEffect::Repel { strength: 5.0 })
        );
        assert!((rt.modulations()[0].scale - 4.0).abs() < 1e-9);
    }
}
