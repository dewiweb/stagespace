//! Score tape (S1 du séquenceur — docs/score-sequencer.md) — bande de
//! commandes horodatées dont l'HORLOGE vit dans le backend (thread
//! dédié), pas en `setTimeout` frontend : timing déterministe, état
//! requêtable (`score_state`), le curseur survit à un reload webview.
//! Le frontend reste l'exécuteur — chaque entrée est ré-émise en
//! `score-fire` et dispatchée par le REPLAY map existant, mêmes
//! sémantiques que le busking enregistré.

use super::error::IpcError;
use super::state::{emit_ui, lock_or_recover};
use crate::AppState;
use serde::{Deserialize, Serialize};

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
