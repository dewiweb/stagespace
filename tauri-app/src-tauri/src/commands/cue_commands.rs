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
    pub graph: stagespace_engines::GraphJson,
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
    pub global_graph: Option<stagespace_engines::GraphJson>,
    /// Graph de modulation global (domaine signal → deltas de macros)
    #[serde(default)]
    pub signal_graph: Option<stagespace_engines::GraphJson>,
    /// IDs des moves actifs
    pub active_move_ids: Vec<String>,
    /// Profondeurs par track
    pub per_track_depths: Vec<f64>,
    /// Positions manuelles (drag 3D)
    pub manual_positions: std::collections::HashMap<usize, [f64; 3]>,
    /// Mode de la cue (Full par défaut)
    #[serde(default)]
    pub mode: stagespace_engines::CueMode,
    /// Portée d'une cue Tracking — ignorée en mode Full
    #[serde(default)]
    pub scope: stagespace_engines::CueScope,
    /// Attente avant exécution (s)
    #[serde(default)]
    pub pre_wait: f64,
    /// Follow : auto-GO cue suivante après N s (None = off)
    #[serde(default)]
    pub follow: Option<f64>,
    /// Timecode de déclenchement (s)
    #[serde(default)]
    pub timecode: Option<f64>,
}

/// Stocke un cue (snapshot complet)
#[tauri::command]
pub async fn store_cue(
    request: StoreCueRequest,
    state: State<'_, AppState>,
) -> Result<Cue, IpcError> {
    // Capturer l'état runtime réel du backend (P1-P4) — l'engine détient la
    // vérité, le frontend ne voit qu'une partie de cet état.
    let (object_channels, channel_modulations, zones, per_track_depths) = {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        (
            merge_rt.object_channels(),
            merge_rt.modulations(),
            merge_rt.zones(),
            merge_rt.track_depths(),
        )
    };
    let osc_mappings = lock_or_recover(&state.osc_receiver).list_mappings();

    // Validation frontière : NaN/inf dans un snapshot → valeurs pourries
    // réinjectées au recall (fade NaN, positions NaN, depths NaN).
    if !request.fade_duration.is_finite() || request.fade_duration < 0.0 {
        return Err(IpcError::validation(
            "fade_duration must be a finite non-negative number",
        ));
    }
    for (track, pos) in &request.manual_positions {
        if !pos.iter().all(|v| v.is_finite()) {
            return Err(IpcError::validation(format!(
                "manual_positions[{track}] must be finite"
            )));
        }
    }
    for (i, d) in request.per_track_depths.iter().enumerate() {
        if !d.is_finite() {
            return Err(IpcError::validation(format!(
                "per_track_depths[{i}] must be finite"
            )));
        }
    }

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
                    signal_graph: m.signal_graph.clone(),
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

    // Tracking : filtre ce qui est enregistré — object_channels/
    // manual_positions/depths restreints aux tracks du scope ; catégories
    // scope=false → None/vide (le recall ne les touche pas).
    let tracking = request.mode == stagespace_engines::CueMode::Tracking;
    let scope = request.scope;
    let scoped = |idx: usize| -> bool {
        !tracking || request.track_indices.is_empty() || request.track_indices.contains(&idx)
    };
    let object_channels = if tracking && !scope.channels {
        None
    } else {
        Some(
            object_channels
                .into_iter()
                .filter(|(i, _)| scoped(*i))
                .collect::<std::collections::HashMap<_, _>>(),
        )
    };
    let channel_modulations = if tracking && !scope.channels {
        None
    } else {
        Some(channel_modulations)
    };
    let manual_positions: std::collections::HashMap<usize, [f64; 3]> = request
        .manual_positions
        .into_iter()
        .filter(|(i, _)| !tracking || scope.positions && scoped(*i))
        .collect();
    // Vecteur positionnel : garder l'alignement index → track. Le scope
    // ne filtre PAS ici (sinon l'index 5 retomberait à 0) — il s'applique
    // au recall, en merge par index sur les depths courantes.
    let per_track_depths = if tracking && !scope.positions {
        Vec::new()
    } else {
        per_track_depths
    };
    let moves = if tracking && !scope.moves {
        Vec::new()
    } else {
        moves
    };
    let cue = Cue {
        id: uuid::Uuid::new_v4().to_string(),
        schema_version: Some(stagespace_engines::CUE_SCHEMA_VERSION),
        name: request.name,
        description: request.description,
        graph: request.graph,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0),
        macros: if tracking && !scope.macros {
            None
        } else {
            request.macros
        },
        track_indices: request.track_indices,
        fade_duration: request.fade_duration,
        cue_number: request.cue_number,
        global_graph: if tracking && !scope.global_graph {
            None
        } else {
            request.global_graph
        },
        signal_graph: if tracking && !scope.signal_graph {
            None
        } else {
            request.signal_graph
        },
        active_move_ids: if tracking && !scope.moves {
            Vec::new()
        } else {
            request.active_move_ids
        },
        // Capturé depuis le runtime (comme zones/channels) — le champ de la
        // request était toujours [] côté frontend.
        per_track_depths,
        manual_positions,
        spatial_macros: if tracking && !scope.macros {
            None
        } else {
            request.spatial_macros
        },
        object_channels,
        channel_modulations,
        osc_mappings: if tracking && !scope.osc_mappings {
            None
        } else {
            Some(osc_mappings)
        },
        zones: if tracking && !scope.zones {
            None
        } else {
            Some(zones)
        },
        moves,
        mode: request.mode,
        scope,
        pre_wait: request.pre_wait,
        follow: request.follow,
        timecode: request.timecode,
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
pub async fn recall_cue(
    cue: Cue,
    time_offset: Option<f64>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let sh = crate::commands::state::Shared::from_state(&state);
    let handle = sh
        .app_handle
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let sh2 = sh.clone();
    let cue_moves: Vec<String> = cue.moves.iter().map(|m| m.id.clone()).collect();
    let result = tauri::async_runtime::spawn_blocking(move || recall_cue_inner(cue, sh))
        .await
        .map_err(|e| IpcError::internal(format!("Cue recall task failed: {e}")))?;
    // Seek TC : offset temporel appliqué aux moves du cue — un locate
    // reprend la trajectoire à tc - cue.timecode, pas à t=0.
    if let Some(off) = time_offset {
        if off.is_finite() && result.is_ok() {
            let movements = lock_or_recover(&sh2.movements);
            for id in &cue_moves {
                if let Some(m) = movements.get(id) {
                    m.runtime.set_time_offset(off);
                }
            }
        }
    }
    // Le recall tue/respawn des moves (même partiellement en cas d'échec) —
    // l'UI doit resynchroniser sa liste sinon elle affiche des zombies.
    if let Some(h) = handle {
        let _ = h.emit("active-moves-update", ());
    }
    result
}

/// Park/unpark un objet : les recalls de cues n'écrivent plus ses canaux
/// (reprise manuelle prioritaire — sémantique Park des consoles).
#[tauri::command]
pub async fn park_object(obj: usize, state: State<'_, AppState>) -> Result<String, IpcError> {
    lock_or_recover(&state.merge_runtime).park_object(obj);
    Ok(format!("object {obj} parked"))
}

#[tauri::command]
pub async fn unpark_object(obj: usize, state: State<'_, AppState>) -> Result<String, IpcError> {
    lock_or_recover(&state.merge_runtime).unpark_object(obj);
    Ok(format!("object {obj} unparked"))
}

/// Objets parkés (indices) — pour l'indicateur UI : un objet parké
/// échappe aux recalls, l'opérateur doit le voir.
#[tauri::command]
pub async fn get_parked_objects(state: State<'_, AppState>) -> Result<Vec<usize>, IpcError> {
    let set = lock_or_recover(&state.merge_runtime).parked_objects();
    let mut v: Vec<usize> = set.into_iter().collect();
    v.sort_unstable();
    Ok(v)
}

pub(crate) fn recall_cue_inner(
    cue: Cue,
    sh: crate::commands::state::Shared,
) -> Result<(), IpcError> {
    // Versioning du contrat : un cue écrit par une version future pourrait
    // porter des champs que ce backend ignore — échec explicite plutôt
    // qu'un recall partiel silencieux.
    if cue.schema_version.unwrap_or(0) > stagespace_engines::CUE_SCHEMA_VERSION {
        return Err(IpcError::validation(format!(
            "Cue '{}' uses schema_version {} > supported {} — written by a newer version",
            cue.name,
            cue.schema_version.unwrap_or(0),
            stagespace_engines::CUE_SCHEMA_VERSION
        )));
    }
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
        return Err(IpcError::busy(
            "A cue recall is already in progress — please wait.".to_string(),
        ));
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

    // Crossfade de l'output layer : tout ce que le post-merge lit hors
    // positions mergées (graph global, macros, positions manuelles,
    // depths, canaux, zones, modulations) est figé en `from` — les writes
    // ci-dessous écrivent la cible (Live) et le merge blende entre les
    // deux sur `cue.fade_duration` au lieu de sauter. fade=0 → no-op.
    lock_or_recover(&sh.merge_runtime).begin_transition(cue.fade_duration);

    // Mode Tracking : n'appliquer que les catégories cochées — les moves
    // hors cue continuent de tourner, les canaux/positions sont mergés
    // (jamais clear-all), les catégories scope=false ne sont pas touchées.
    let tracking = cue.mode == stagespace_engines::CueMode::Tracking;
    let scope = cue.scope;

    // 1. Hot-swap le graph global AVANT de désactiver les moves (fail-fast sans side effects)
    //    Si la compilation échoue, on retourne une erreur sans avoir modifié l'état.
    if let Some(global_graph) = cue
        .global_graph
        .as_ref()
        .filter(|_| !tracking || scope.global_graph)
    {
        let audio_state = {
            let merge_rt = lock_or_recover(&sh.merge_runtime);
            merge_rt
                .audio_state_arc()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        };

        let graph = build_graph_from_json(global_graph, &audio_state)
            .map_err(|e| IpcError::validation(format!("Failed to parse global graph: {e}")))?;

        let effects = stagespace_engines::extract_graph_effects(&graph)
            .map_err(|e| IpcError::validation(format!("Failed to extract graph effects: {e:?}")))?;

        let macros = lock_or_recover(&sh.merge_runtime).macros();

        let compile_params = stagespace_engines::PostProcessCompileParams { graph, macros };

        let post_process_fn = stagespace_engines::compile_post_process(compile_params)
            .map_err(|e| IpcError::validation(format!("Failed to compile global graph: {e:?}")))?;

        let merge_rt = lock_or_recover(&sh.merge_runtime);
        merge_rt.swap_post_process_fn(post_process_fn);
        merge_rt.set_graph_effects(effects.zones, effects.modulations, effects.move_ref);
        // Idem update_global_graph : un node Merge peut fixer la stratégie.
        if let Some(strategy) = effects.strategy {
            merge_rt.set_merge_strategy(strategy);
        }
    }

    // 1b. Idem pour le graph de modulation global (domaine signal → deltas
    //     de macros) : recompilé + swappé si le cue en porte un.
    if let Some(signal_graph_json) = cue
        .signal_graph
        .as_ref()
        .filter(|_| !tracking || scope.signal_graph)
    {
        let audio_state = {
            let merge_rt = lock_or_recover(&sh.merge_runtime);
            merge_rt
                .audio_state_arc()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        };
        let graph = build_graph_from_json(signal_graph_json, &audio_state)
            .map_err(|e| IpcError::validation(format!("Failed to parse signal graph: {e}")))?;
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        // Un graphe signal sans SignalOut n'a aucune sortie — il ne peut
        // jamais avoir produit de modulation (snapshot d'une édition en
        // cours). Le traiter comme « pas de modulation » plutôt que de
        // faire échouer le recall entier sur un no-op.
        if graph
            .nodes
            .values()
            .any(|n| n.node_type == stagespace_engines::NodeType::SignalOut)
        {
            let signal_fn = stagespace_engines::compile_signal_graph(&graph)
                .map_err(|e| IpcError::validation(format!("Failed to compile signal graph: {e:?}")))?;
            merge_rt.swap_signal_fn(signal_fn);
        } else {
            eprintln!("[WARN] recall: signal graph without SignalOut — treated as no modulation");
            merge_rt.swap_signal_fn(stagespace_engines::signal_compiler::empty_signal_fn());
        }
    } else if !tracking {
        // Le cue ne porte pas de graph signal → la modulation globale
        // est reset. Sans ça, la SignalFn du cue précédent survivrait au
        // recall (deltas stales sur les macros).
        lock_or_recover(&sh.merge_runtime)
            .swap_signal_fn(stagespace_engines::signal_compiler::empty_signal_fn());
    }

    // 2. Désactiver les moves absents du cue (Full uniquement — Tracking
    //    ne tue jamais un move non listé). Quand le cue porte des
    //    snapshots (Phase 5), `moves` est la vérité backend — un move spawné
    //    entre le poll frontend et le store y figure, alors qu'il manquerait
    //    dans active_move_ids (killed-then-respawned au lieu de continuer).
    if !tracking {
        let movements = lock_or_recover(&sh.movements);
        let active_ids: std::collections::HashSet<&str> = if cue.moves.is_empty() {
            cue.active_move_ids.iter().map(|s| s.as_str()).collect()
        } else {
            cue.moves.iter().map(|s| s.id.as_str()).collect()
        };

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
    if (!tracking || scope.macros) && (cue.macros.is_some() || cue.spatial_macros.is_some()) {
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

    // 5. Restaurer les per-track depths (Tracking + scope.positions →
    //    merge par index, jamais clear).
    if !cue.per_track_depths.is_empty() && (!tracking || scope.positions) {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        if !tracking {
            merge_rt.set_track_depths(cue.per_track_depths.clone());
        } else {
            // Merge par index : seules les tracks du scope sont écrites —
            // le vec du cue reste aligné sur la liste globale des tracks.
            let scoped = |i: usize| cue.track_indices.is_empty() || cue.track_indices.contains(&i);
            let mut cur = merge_rt.track_depths();
            if cur.len() < cue.per_track_depths.len() {
                cur.resize(cue.per_track_depths.len(), 1.0);
            }
            for (i, d) in cue.per_track_depths.iter().enumerate() {
                if scoped(i) {
                    cur[i] = *d;
                }
            }
            merge_rt.set_track_depths(cur);
        }
    }

    // 6. Restaurer les manual positions — Full = clear+set (snapshot
    //    exact) ; Tracking+scope.positions = merge (set, jamais clear).
    {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        if !tracking {
            merge_rt.clear_all_manual_positions();
            for (idx, pos) in &cue.manual_positions {
                merge_rt.set_manual_position(*idx, *pos);
            }
        } else if scope.positions {
            for (idx, pos) in &cue.manual_positions {
                merge_rt.set_manual_position(*idx, *pos);
            }
        }
    }

    // 6b. Restaurer l'état Phase 4 (canaux, modulations, zones, mappings OSC IN)
    //     Champ absent (ancien cue) = ne pas toucher à l'état courant ;
    //     champ présent (même vide) = restaurer exactement le snapshot.
    {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        if let Some(ref channels) = cue.object_channels {
            // Full = snapshot exact (clear+set) ; Tracking = merge par
            // objet (un objet hors scope garde sa valeur).
            // Objets parkés : jamais touchés par une cue — leurs canaux
            // courants sont sauvegardés avant le clear et restaurés après.
            let parked = merge_rt.parked_objects();
            let kept: Vec<(usize, stagespace_engines::SpatialChannels)> =
                if !tracking && !parked.is_empty() {
                    let cur = merge_rt.object_channels();
                    parked
                        .iter()
                        .filter_map(|i| cur.get(i).copied().map(|c| (*i, c)))
                        .collect()
                } else {
                    Vec::new()
                };
            if !tracking {
                merge_rt.clear_all_object_channels();
            }
            if !tracking || scope.channels {
                for (idx, chs) in channels {
                    if parked.contains(idx) {
                        continue;
                    }
                    for (ch, v) in chs.iter() {
                        merge_rt.set_object_channel(*idx, ch, v);
                    }
                }
            }
            for (idx, chs) in kept {
                for (ch, v) in chs.iter() {
                    merge_rt.set_object_channel(idx, ch, v);
                }
            }
        }
        if let Some(mods) = cue
            .channel_modulations
            .as_ref()
            .filter(|_| !tracking || scope.channels)
        {
            merge_rt.clear_modulations();
            for rule in mods.iter() {
                // Un cue au-delà du cap tronque au lieu d'échouer le recall
                // entier — les 64 premières règles suffisent en pratique.
                if merge_rt.add_modulation(rule.clone()).is_err() {
                    break;
                }
            }
        }
        if let Some(zs) = cue.zones.as_ref().filter(|_| !tracking || scope.zones) {
            merge_rt.clear_zones();
            for z in zs.iter() {
                if merge_rt.add_zone(z.clone()).is_err() {
                    break;
                }
            }
        }
    }
    if let Some(maps) = cue
        .osc_mappings
        .as_ref()
        .filter(|_| !tracking || scope.osc_mappings)
    {
        let receiver = lock_or_recover(&sh.osc_receiver);
        receiver.clear_mappings();
        for m in maps.iter() {
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
    if !cue.moves.is_empty() && (!tracking || scope.moves) {
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
                signal_graph: snap.signal_graph.clone(),
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
