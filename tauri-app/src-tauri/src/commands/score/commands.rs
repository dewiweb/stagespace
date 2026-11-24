//! Commandes IPC du transport score — `load`/`play`/`update`/`stop`/
//! `seek`/`state`/`set_loop`. Toutes partagent la même machine de
//! rebase (`spawn_score_thread` + `kill_score_moves` + miroir
//! `tl.active`) ; les états sont poussés via `score-timeline`.
use super::scheduler::{kill_score_moves, spawn_score_thread};
use super::types::{
    timeline_has_content, timeline_state, ScoreClip, ScoreKeyframe, ScoreTimelineState,
    SCORE_MOVE_PREFIX,
};
use crate::commands::error::IpcError;
use crate::commands::merge_commands::move_management::deactivate_move_arc;
use crate::commands::state::{emit_ui, lock_or_recover, Shared};
use crate::AppState;
use std::collections::{HashMap, HashSet};
use tauri::State;

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
    let sh = Shared::from_state(&state);
    let mut tl = lock_or_recover(&state.score_timeline);
    tl.generation += 1;
    tl.started_at = None;
    tl.seek_ms = 0;
    // Load = reset complet : les moves score du doc précédent sont
    // coupés net (un nouveau doc ne doit pas hériter de l'ancien).
    kill_score_moves(&sh, &mut tl, true);
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

/// Lance la lecture — thread horloge qui exécute les clips sur Shared.
/// Spanning : un clip Slot qui chevauche le curseur démarre immédiatement
/// avec `set_time_offset(cursor - start)` ; les cue markers passés sont
/// skippés (l'état initial reste l'affaire de l'opérateur/conduite).
#[tauri::command]
pub async fn score_timeline_play(state: State<'_, AppState>) -> Result<(), IpcError> {
    let sh = Shared::from_state(&state);
    let tl_arc = state.score_timeline.clone();
    {
        let tl = lock_or_recover(&tl_arc);
        if !timeline_has_content(&tl) {
            return Err(IpcError::validation("score timeline empty"));
        }
    }
    // Fresh play : les ids score sont déterministes (`sc-<clip>`) — un
    // move survivant ferait échouer le spawn au conflit d'id. Balayage
    // des résidus ; les moves opérateur ne sont pas touchés.
    {
        let mut tl = lock_or_recover(&tl_arc);
        kill_score_moves(&sh, &mut tl, true);
    }
    spawn_score_thread(&sh, &tl_arc)?;
    // État play poussé aussi — resync des vues (remote, reload).
    let st = timeline_state(&lock_or_recover(&state.score_timeline));
    emit_ui(&state.event_sink, "score-timeline", st);
    Ok(())
}

/// Hot-swap de la partition PENDANT la lecture : remplace clips et
/// courbes au curseur vivant. `dead_clip_ids` (calculé côté frontend —
/// les clips sont `Deserialize`-only) = ids disparus ou modifiés : leurs
/// moves sont coupés net (la spec a changé — garder l'ancien move serait
/// mensonger) ; les moves des clips inchangés survivent dans `tl.active`
/// et sont hérités par le nouveau scheduler (pas de coupure audible).
/// Arrêté → équivalent à `load` en conservant le curseur.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn score_timeline_update(
    clips: Vec<ScoreClip>,
    duration_ms: u64,
    global_fx_curves: HashMap<String, Vec<ScoreKeyframe>>,
    modulation_curves: HashMap<String, Vec<ScoreKeyframe>>,
    object_curves: HashMap<usize, HashMap<String, Vec<ScoreKeyframe>>>,
    spatial_fx_curves: HashMap<String, Vec<ScoreKeyframe>>,
    dead_clip_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let sh = Shared::from_state(&state);
    let tl_arc = state.score_timeline.clone();
    let playing = {
        let mut tl = lock_or_recover(&tl_arc);
        let playing = tl.started_at.is_some();
        // Le thread courant meurt ≤50 ms — avant les kills pour que ses
        // derniers événements ne puissent pas re-remplir `tl.active`.
        tl.generation += 1;
        // Rebase du curseur vivant : seek_ms devient la base du prochain
        // cycle (started_at reposé au spawn).
        if let Some(t0) = tl.started_at {
            tl.seek_ms += t0.elapsed().as_millis() as u64;
        }
        tl.seek_ms = tl.seek_ms.min(duration_ms);
        // Kills : moves des clips morts + balayage sc-* non trackés.
        let dead: HashSet<&str> = dead_clip_ids.iter().map(String::as_str).collect();
        let kills: Vec<String> = tl
            .active
            .iter()
            .filter(|(_, am)| dead.contains(am.clip_id.as_str()))
            .map(|(id, _)| id.clone())
            .collect();
        tl.active
            .retain(|_, am| !dead.contains(am.clip_id.as_str()));
        for id in kills {
            let _ = deactivate_move_arc(&id, 0.0, true, &sh);
        }
        for id in lock_or_recover(&sh.movements)
            .keys()
            .filter(|id| id.starts_with(SCORE_MOVE_PREFIX))
            .cloned()
            .collect::<Vec<_>>()
        {
            if !tl.active.contains_key(&id) {
                let _ = deactivate_move_arc(&id, 0.0, true, &sh);
            }
        }
        // Swap du doc — mêmes tris que `load`.
        let mut sorted = clips;
        sorted.sort_by_key(|c| c.start_ms);
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
        playing
    };
    if playing {
        spawn_score_thread(&sh, &tl_arc)?;
    }
    emit_ui(&sh.event_sink, "active-moves-update", ());
    let st = timeline_state(&lock_or_recover(&tl_arc));
    emit_ui(&sh.event_sink, "score-timeline", st);
    Ok(())
}

/// Stoppe la lecture — le stop des autres modes : les moves score
/// sont désactivés selon leurs fades et end_mode déclarés (un `hold`
/// écrit sa position tenue). Les moves opérateur ne sont pas touchés.
#[tauri::command]
pub async fn score_timeline_stop(state: State<'_, AppState>) -> Result<(), IpcError> {
    let sh = Shared::from_state(&state);
    let tl_arc = state.score_timeline.clone();
    {
        let mut tl = lock_or_recover(&tl_arc);
        tl.generation += 1;
        tl.started_at = None;
        // Stop = comme dans les autres modes : les moves que le score a
        // spawnés sont désactivés selon leurs fades et end_mode déclarés
        // (honor_end_mode — un `hold` écrit sa position tenue). Les
        // moves opérateur ne sont pas touchés (dual authority).
        kill_score_moves(&sh, &mut tl, false);
    }
    let st = timeline_state(&lock_or_recover(&tl_arc));
    emit_ui(&state.event_sink, "score-timeline", st);
    Ok(())
}

/// Déplace le curseur — arrêté : simple rebase. En lecture : scrub —
/// tous les moves score sont du "mauvais temps", ils sont coupés net et
/// le scheduler repart au nouveau curseur (les clips chevauchant le
/// point d'arrivée repartent avec leur offset de spanning).
#[tauri::command]
pub async fn score_timeline_seek(ms: u64, state: State<'_, AppState>) -> Result<(), IpcError> {
    let sh = Shared::from_state(&state);
    let tl_arc = state.score_timeline.clone();
    let playing = {
        let mut tl = lock_or_recover(&tl_arc);
        // Clamp à la durée — un seek hors partition n'a pas de sens.
        tl.seek_ms = ms.min(tl.duration_ms);
        let playing = tl.started_at.is_some();
        if playing {
            // Tue le thread courant AVANT les kills — sinon ses
            // derniers événements re-rempliraient `tl.active`.
            tl.generation += 1;
            kill_score_moves(&sh, &mut tl, true);
        }
        playing
    };
    if playing {
        spawn_score_thread(&sh, &tl_arc)?;
    }
    let st = timeline_state(&lock_or_recover(&tl_arc));
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
/// rebouclage). Live-safe : le scheduler relit `loop_region` à chaque
/// événement — un changement en lecture s'applique dès le prochain
/// événement/wrap, sans respawn ni coupure.
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
