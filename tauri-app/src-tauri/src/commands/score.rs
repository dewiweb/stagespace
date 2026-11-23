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
use std::collections::HashMap;
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
}

/// Un clip posé sur la timeline — `track` = la lane d'appartenance :
/// le backend applique "un move score à la fois par lane" (un nouveau
/// clip Slot qui démarre coupe le précédent — dernier gagne, comme
/// une console qui reprend la main sur le même canal).
#[derive(Debug, Clone, Deserialize)]
pub struct ScoreClip {
    pub id: String,
    pub track: String,
    pub start_ms: u64,
    #[serde(default)]
    pub duration_ms: Option<u64>,
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
    pub seek_ms: u64,
    /// Génération — stop/load l'incrémente, les sleeps armés s'abortent.
    pub generation: u64,
}

#[derive(Serialize)]
pub struct ScoreTimelineState {
    pub playing: bool,
    pub cursor_ms: u64,
    pub duration_ms: u64,
    pub len: usize,
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
    }
}

/// Charge la partition de clips (stoppe la lecture, reset le curseur).
/// Les clips sont triés par start — le lecteur les consomme en ordre.
#[tauri::command]
pub async fn score_timeline_load(
    clips: Vec<ScoreClip>,
    duration_ms: u64,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut tl = lock_or_recover(&state.score_timeline);
    tl.generation += 1;
    tl.started_at = None;
    tl.seek_ms = 0;
    let mut sorted = clips;
    sorted.sort_by_key(|c| c.start_ms);
    tl.clips = sorted;
    tl.duration_ms = duration_ms;
    Ok(())
}

/// Lance la lecture — thread horloge qui exécute les clips sur Shared.
/// Spanning : un clip Slot qui chevauche le curseur démarre immédiatement
/// avec `set_time_offset(cursor - start)` ; les cue markers passés sont
/// skippés (l'état initial reste l'affaire de l'opérateur/conduite).
#[tauri::command]
pub async fn score_timeline_play(state: State<'_, AppState>) -> Result<(), IpcError> {
    let sh = Shared::from_state(&state);
    let tl_arc = state.score_timeline.clone();
    let (gen, clips, seek) = {
        let mut tl = lock_or_recover(&tl_arc);
        tl.generation += 1;
        tl.started_at = Some(Instant::now());
        (tl.generation, tl.clips.clone(), tl.seek_ms)
    };
    if clips.is_empty() {
        lock_or_recover(&tl_arc).started_at = None;
        return Err(IpcError::validation("score timeline empty"));
    }

    // Liste d'événements : démarrages de clips + fins auto des Slots.
    enum Ev {
        Fire(usize, u64),     // clip index, offset_ms (spanning)
        EndMove(String, f64), // movement_id, fade_out
    }
    let mut events: Vec<(u64, Ev)> = Vec::new();
    for (i, c) in clips.iter().enumerate() {
        let end = c.duration_ms.map(|d| c.start_ms + d);
        if c.start_ms >= seek {
            events.push((c.start_ms, Ev::Fire(i, 0)));
        } else if matches!(c.payload, ScoreClipPayload::Slot { .. })
            && end.map(|e| e > seek).unwrap_or(true)
        {
            // Clip slot à cheval sur le curseur → démarrage offset.
            events.push((seek, Ev::Fire(i, seek - c.start_ms)));
        }
        // Cue markers déjà passés : skippés (documenté — pas de catch-up).
        if let (Some(e), ScoreClipPayload::Slot { request, .. }) = (end, &c.payload) {
            if e > seek {
                let fade = request
                    .animation
                    .as_ref()
                    .map(|a| a.fade_out)
                    .unwrap_or(0.5);
                events.push((e, Ev::EndMove(request.movement_id.clone(), fade)));
            }
        }
    }
    events.sort_by_key(|(t, _)| *t);

    let sink = sh.event_sink.clone();
    std::thread::spawn(move || {
        let t0 = Instant::now();
        let cursor = |elapsed: Duration| seek + elapsed.as_millis() as u64;
        // Lane → move score actif — "un move à la fois par lane".
        let mut lane_active: HashMap<String, (String, f64)> = HashMap::new();
        for (t, ev) in events {
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
            }
            if lock_or_recover(&tl_arc).generation != gen {
                return;
            }
            match ev {
                Ev::Fire(i, offset) => fire_clip(&clips[i], offset, &sh, &mut lane_active, &sink),
                Ev::EndMove(id, fade) => {
                    lane_active.retain(|_, v| v.0 != id);
                    if let Err(e) = deactivate_move_arc(&id, fade, true, &sh) {
                        eprintln!("[score] end-of-clip deactivate '{id}' failed: {e}");
                    }
                }
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

/// Exécute un clip — mêmes chemins que les actions opérateur/OSC.
fn fire_clip(
    clip: &ScoreClip,
    offset_ms: u64,
    sh: &Shared,
    lane_active: &mut HashMap<String, (String, f64)>,
    sink: &Arc<Mutex<Option<crate::commands::state::EventSink>>>,
) {
    match &clip.payload {
        ScoreClipPayload::Slot { request, macros } => {
            // Le move score actif sur cette lane est coupé d'abord —
            // dernier clip gagne (sémantique console, déterministe).
            if let Some((prev_id, prev_fade)) = lane_active.remove(&clip.track) {
                let _ = deactivate_move_arc(&prev_id, prev_fade, true, sh);
            }
            match spawn_move(spec_from_request(request.as_ref().clone()), sh) {
                Ok(_) => {
                    if let Some(m) = macros {
                        apply_set_macro_request(m, &lock_or_recover(&sh.merge_runtime));
                    }
                    if offset_ms > 0 {
                        if let Some(mv) = lock_or_recover(&sh.movements).get(&request.movement_id) {
                            mv.runtime.set_time_offset(offset_ms as f64 / 1000.0);
                        }
                    }
                    let fade_out = request
                        .animation
                        .as_ref()
                        .map(|a| a.fade_out)
                        .unwrap_or(0.5);
                    lane_active.insert(clip.track.clone(), (request.movement_id.clone(), fade_out));
                    emit_ui(sink, "active-moves-update", ());
                }
                Err(e) => eprintln!("[score] clip '{}' spawn failed: {}", clip.id, e),
            }
        }
        ScoreClipPayload::Cue(cue) => {
            // recall_cue_inner gère le flag concurrent (CAS + RAII) —
            // un recall opérateur en cours → Err(busy), le clip est skippé.
            match recall_cue_inner((**cue).clone(), sh.clone()) {
                Ok(()) => emit_ui(sink, "active-moves-update", ()),
                Err(e) => eprintln!("[score] cue clip '{}' recall failed: {}", clip.id, e),
            }
        }
        ScoreClipPayload::StopAll => {
            let _ = deactivate_all_arc(0.0, true, sh);
        }
        ScoreClipPayload::Panic => {
            let _ = deactivate_all_arc(0.0, false, sh);
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
}
