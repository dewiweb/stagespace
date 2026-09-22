//! Commands Tauri pour le cuelist (Phase 3 — cue system étendu).
//!
//! Store : snapshot complet (graph, macros, tracks, global graph, depths, manual positions)
//! Recall : désactiver/activer moves, hot-swap global graph, restaurer macros/depths/positions

use super::error::IpcError;
use super::state::lock_or_recover;
use crate::graph::parser::build_graph_from_json;
use crate::AppState;
use serde::Deserialize;
use stagespace_engines::{Cue, MacroSnapshot, SpatialMacroSnapshot};
use std::sync::atomic::AtomicBool;
use tauri::{Emitter, State};

/// RAII guard : remet recall_in_progress à false quand droppé (même si recall panique)
struct RecallGuard<'a>(&'a AtomicBool);
impl Drop for RecallGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

// ─── Store Cue ───

/// Données pour stocker un cue (envoyées par le frontend)
#[derive(Debug, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct StoreCueRequest {
    pub name: String,
    pub description: String,
    /// Sub-graph du move (graph_json)
    #[ts(type = "unknown")]
    pub graph: serde_json::Value,
    /// Macros per-move (speed, scale, shift, rotation)
    pub macros: Option<MacroSnapshot>,
    /// Macros spatiales étendues (radius_scale, height_offset)
    pub spatial_macros: Option<SpatialMacroSnapshot>,
    /// Indices des tracks ciblées
    pub track_indices: Vec<usize>,
    /// Durée du crossfade
    pub fade_duration: f64,
    /// Numéro de cue
    pub cue_number: Option<String>,
    // ─── Phase 3 : champs étendus ───
    /// Graph global (post-processing)
    #[ts(type = "unknown | null")]
    pub global_graph: Option<serde_json::Value>,
    /// IDs des moves actifs
    pub active_move_ids: Vec<String>,
    /// Profondeurs par track
    pub per_track_depths: Vec<f64>,
    /// Positions manuelles (drag 3D)
    pub manual_positions: std::collections::HashMap<usize, [f64; 3]>,
}

/// Stocke un cue (snapshot complet)
#[tauri::command]
pub async fn store_cue(
    request: StoreCueRequest,
    state: State<'_, AppState>,
) -> Result<Cue, IpcError> {
    // Capturer l'état runtime réel du backend (P1-P4) — l'engine détient la
    // vérité, le frontend ne voit qu'une partie de cet état.
    let (object_channels, channel_modulations, zones) = {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        (
            merge_rt.object_channels(),
            merge_rt.modulations(),
            merge_rt.zones(),
        )
    };
    let osc_mappings = lock_or_recover(&state.osc_receiver).list_mappings();

    // Phase 5 : snapshot complet de chaque move actif — assez pour que
    // `recall_cue` puisse les recréer seul (graph, tracks, loop, direction).
    let moves: Vec<stagespace_engines::MoveSnapshot> = {
        let movements = lock_or_recover(&state.movements);
        movements
            .values()
            .map(|m| {
                let (fade_in, fade_out) = m.runtime.fade();
                stagespace_engines::MoveSnapshot {
                    id: m.id.clone(),
                    name: m.name.clone(),
                    graph_json: m.graph_json.clone(),
                    osc_ids: m.osc_ids.clone(),
                    track_indices: m.track_indices.clone(),
                    is_preview: m.is_preview,
                    origin: m.origin,
                    duration: m.duration,
                    loop_mode: m.loop_mode.clone(),
                    direction: m.direction.clone(),
                    // Depths/phases/audio mods + enveloppe de cycle — snapshotés
                    // depuis le runtime live (toujours à jour, hot-swaps inclus).
                    animation_state: m.runtime.animation_state(),
                    fade_in,
                    fade_out,
                }
            })
            .collect()
    };

    let cue = Cue {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        description: request.description,
        graph: request.graph,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0),
        macros: request.macros,
        track_indices: request.track_indices,
        fade_duration: request.fade_duration,
        cue_number: request.cue_number,
        global_graph: request.global_graph,
        active_move_ids: request.active_move_ids,
        per_track_depths: request.per_track_depths,
        manual_positions: request.manual_positions,
        spatial_macros: request.spatial_macros,
        object_channels: Some(object_channels),
        channel_modulations: Some(channel_modulations),
        osc_mappings: Some(osc_mappings),
        zones: Some(zones),
        moves,
    };

    // Émettre l'événement pour que le frontend persiste le cue
    state
        .app_handle
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|handle| handle.emit("cue-stored", &cue));

    Ok(cue)
}

// ─── Recall Cue ───

/// Rappelle un cue : désactiver/activer moves, hot-swap global graph, restaurer macros/depths/positions
///
/// C'est la commande la plus lourde du backend (compile des graphes, join de
/// threads workers, respawn de moves) — elle tourne sur `spawn_blocking`
/// pour ne pas affamer l'executor async pendant un live.
#[tauri::command]
pub async fn recall_cue(cue: Cue, state: State<'_, AppState>) -> Result<(), IpcError> {
    let sh = crate::commands::state::Shared::from_state(&state);
    let handle = sh
        .app_handle
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let result = tauri::async_runtime::spawn_blocking(move || recall_cue_inner(cue, sh))
        .await
        .map_err(|e| IpcError::internal(format!("Cue recall task failed: {e}")))?
        .map_err(IpcError::from);
    // Le recall tue/respawn des moves (même partiellement en cas d'échec) —
    // l'UI doit resynchroniser sa liste sinon elle affiche des zombies.
    if let Some(h) = handle {
        let _ = h.emit("active-moves-update", ());
    }
    result
}

pub(crate) fn recall_cue_inner(cue: Cue, sh: crate::commands::state::Shared) -> Result<(), String> {
    // Anti-recall concurrent : si un recall est déjà en cours, refuser
    if sh
        .recall_in_progress
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return Err("A cue recall is already in progress — please wait.".to_string());
    }

    // Garantir que le flag est remis à false quoi qu'il arrive
    let _guard = RecallGuard(&sh.recall_in_progress);

    // Anti-loop OSC IN : ignorer les messages entrants pendant le recall —
    // le renderer renvoie souvent un echo des valeurs qu'on vient d'envoyer.
    // La fenêtre couvre le recall entier : fade_in des moves respawnés +
    // marge de settle (le fixe 500ms expirait avant la fin d'un long fade,
    // laissant passer les echos de fin de cue).
    // Clampée comme osc_suppress_in : un fade_duration géant (cue .hfg
    // éditée à la main) overflowait le u64 et paniquait à mi-recall.
    const MAX_SUPPRESS_MS: u64 = 120_000;
    let suppress_ms =
        (500.0 + cue.fade_duration.max(0.0) * 1000.0).min(MAX_SUPPRESS_MS as f64) as u64;
    lock_or_recover(&sh.osc_receiver).suppress_ms(suppress_ms);

    // 1. Hot-swap le graph global AVANT de désactiver les moves (fail-fast sans side effects)
    //    Si la compilation échoue, on retourne une erreur sans avoir modifié l'état.
    if let Some(ref global_graph) = cue.global_graph {
        let audio_state = {
            let merge_rt = lock_or_recover(&sh.merge_runtime);
            merge_rt
                .audio_state_arc()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        };

        let graph = build_graph_from_json(global_graph, &audio_state)
            .map_err(|e| format!("Failed to parse global graph: {e}"))?;

        let effects = stagespace_engines::extract_graph_effects(&graph)
            .map_err(|e| format!("Failed to extract graph effects: {e:?}"))?;

        let merge_rt = lock_or_recover(&sh.merge_runtime);
        let macros = merge_rt.macros();

        let compile_params = stagespace_engines::PostProcessCompileParams { graph, macros };

        let post_process_fn = stagespace_engines::compile_post_process(compile_params)
            .map_err(|e| format!("Failed to compile global graph: {e:?}"))?;

        merge_rt.swap_post_process_fn(post_process_fn);
        merge_rt.set_graph_effects(effects.zones, effects.modulations);
    }

    // 2. Désactiver les moves qui ne sont pas dans active_move_ids
    {
        let movements = lock_or_recover(&sh.movements);
        let active_ids: std::collections::HashSet<&str> =
            cue.active_move_ids.iter().map(|s| s.as_str()).collect();

        let to_deactivate: Vec<String> = movements
            .keys()
            .filter(|id| !active_ids.contains(id.as_str()))
            .cloned()
            .collect();

        drop(movements);

        for id in to_deactivate {
            // Retirer de la map + unregister du merge + stop du worker.
            // Un id en cours d'activation (pending) n'est pas touché — il
            // s'auto-abortera via le check recall_in_progress de spawn_move.
            let movement = {
                let pending = lock_or_recover(&sh.pending_move_ids);
                let mut movements = lock_or_recover(&sh.movements);
                if pending.contains(&id) {
                    None
                } else {
                    movements.remove(&id)
                }
            };
            {
                let merge_rt = lock_or_recover(&sh.merge_runtime);
                merge_rt.unregister_move(&id);
            }
            if let Some(movement) = movement {
                // stop() join le thread proprement — fait HORS des locks.
                movement.runtime.stop();
            }
        }
    }

    // 3+4. Restaurer les macros — UNE écriture atomique (restore_all) :
    //      les 5 set_* séparés laissaient plusieurs frames lire un mix
    //      ancien/nouveau pendant le recall.
    if cue.macros.is_some() || cue.spatial_macros.is_some() {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        let ms = merge_rt.macros();
        let mut snap = ms.snapshot();
        if let Some(ref macros) = cue.macros {
            snap.scale = macros.scale;
            snap.shift = nalgebra::Vector3::new(macros.shift_x, macros.shift_y, macros.shift_z);
            snap.yaw = macros.yaw;
            snap.pitch = macros.pitch;
            snap.roll = macros.roll;
        }
        if let Some(ref spatial) = cue.spatial_macros {
            snap.radius_scale = spatial.radius_scale;
            snap.height_offset = spatial.height_offset;
        }
        ms.restore_all(&snap);
    }

    // 5. Restaurer les per-track depths
    if !cue.per_track_depths.is_empty() {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        merge_rt.set_track_depths(cue.per_track_depths.clone());
    }

    // 6. Restaurer les manual positions
    {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        merge_rt.clear_all_manual_positions();
        for (idx, pos) in &cue.manual_positions {
            merge_rt.set_manual_position(*idx, *pos);
        }
    }

    // 6b. Restaurer l'état Phase 4 (canaux, modulations, zones, mappings OSC IN)
    //     Champ absent (ancien cue) = ne pas toucher à l'état courant ;
    //     champ présent (même vide) = restaurer exactement le snapshot.
    {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        if let Some(ref channels) = cue.object_channels {
            merge_rt.clear_all_object_channels();
            for (idx, chs) in channels {
                for (ch, v) in chs.iter() {
                    merge_rt.set_object_channel(*idx, ch, v);
                }
            }
        }
        if let Some(ref mods) = cue.channel_modulations {
            merge_rt.clear_modulations();
            for rule in mods {
                merge_rt.add_modulation(rule.clone());
            }
        }
        if let Some(ref zs) = cue.zones {
            merge_rt.clear_zones();
            for z in zs {
                merge_rt.add_zone(z.clone());
            }
        }
    }
    if let Some(ref maps) = cue.osc_mappings {
        let receiver = lock_or_recover(&sh.osc_receiver);
        receiver.clear_mappings();
        for m in maps {
            // Un mapping invalide dans un vieux cue ne doit pas faire
            // échouer le recall — on log et on continue
            if let Err(e) = receiver.add_mapping(m.clone()) {
                eprintln!("[WARN] Skipping invalid OSC mapping '{}': {e}", m.address);
            }
        }
    }

    // 7. Restaurer les moves snapshotés au store (Phase 5). Le backend
    //    recrée les workers lui-même — un move snapshoté reprend exactement
    //    son graphe, ses tracks, son loop/direction. Champ vide = cue ancien
    //    format → le frontend rejoue `cue.graph` (listener cue-recalled).
    let mut failed_moves: Vec<String> = Vec::new();
    if !cue.moves.is_empty() {
        use crate::commands::merge_commands::{
            parse_direction, parse_loop_mode, spawn_move_for_recall, MoveSpec,
        };
        let speed = cue.macros.as_ref().map(|m| m.speed);
        for snap in &cue.moves {
            // Déjà actif et running → ne pas respawner (le move continue).
            let already_running = {
                let movements = lock_or_recover(&sh.movements);
                let worker_alive = movements
                    .get(&snap.id)
                    .is_some_and(|m| m.runtime.is_running());
                // Worker vivant mais retiré du merge (stale-kill) = zombie —
                // il faut respawn. is_running() seul ne suffit pas.
                let in_merge = lock_or_recover(&sh.merge_runtime).has_move(&snap.id);
                worker_alive && in_merge
            };
            if already_running {
                continue;
            }
            // Entrée fantôme (worker stoppé ou zombie hors-merge) → purger.
            let ghost = lock_or_recover(&sh.movements).remove(&snap.id);
            if let Some(mv) = ghost {
                mv.runtime.stop();
            }
            let spec = MoveSpec {
                id: snap.id.clone(),
                name: snap.name.clone(),
                graph_json: snap.graph_json.clone(),
                osc_ids: snap.osc_ids.clone(),
                track_indices: snap.track_indices.clone(),
                is_preview: snap.is_preview,
                origin: snap.origin,
                duration: snap.duration,
                loop_mode: parse_loop_mode(&snap.loop_mode),
                direction: parse_direction(&snap.direction),
                fade: Some((snap.fade_in, snap.fade_out)),
                speed,
                spatial_macros: None,
                animation_state: snap.animation_state.clone(),
            };
            match spawn_move_for_recall(spec, &sh) {
                Ok(_) => {
                    if cue.fade_duration > 0.0 {
                        lock_or_recover(&sh.merge_runtime)
                            .start_fade_in(&snap.id, cue.fade_duration);
                    }
                }
                // Un move qui échoue ne doit pas faire échouer le recall
                // entier — on log et on continue (partial recall visible).
                Err(e) => {
                    eprintln!("[WARN] recall: failed to respawn move '{}': {e}", snap.id);
                    failed_moves.push(snap.id.clone());
                }
            }
        }
    }

    // Le payload porte les respawns échoués — un recall partiel ne doit pas
    // passer pour un succès côté UI.
    sh.app_handle
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|handle| {
            handle.emit(
                "cue-recalled",
                serde_json::json!({ "cue_id": cue.id, "failed_moves": failed_moves }),
            )
        });

    Ok(())
}
