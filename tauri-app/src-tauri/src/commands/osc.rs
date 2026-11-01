use super::error::IpcError;
use super::state::lock_or_recover;
use crate::AppState;
use stagespace_engines::{OscInStatsSnapshot, OscMapping, OscProfile, OscReceiver, OscSender};
use std::str::FromStr;
use tauri::{Emitter, State};

// OSC Receiver Commands

/// Ajoute un mapping OSC IN → destination (handler | macro | channel | position).
/// Le mapping est actif immédiatement, même si le receiver tourne déjà.
#[tauri::command]
pub async fn osc_add_mapping(
    mapping: OscMapping,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.add_mapping(mapping).map_err(IpcError::validation)
}

#[tauri::command]
pub async fn osc_remove_mapping(
    address: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.remove_mapping(&address);
    Ok(())
}

/// Active/désactive un mapping sans le supprimer (toggle dans l'éditeur).
#[tauri::command]
pub async fn osc_set_mapping_enabled(
    address: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    if !receiver.set_mapping_enabled(&address, enabled) {
        return Err(IpcError::not_found(format!("mapping '{address}'")));
    }
    Ok(())
}

#[tauri::command]
pub async fn osc_list_mappings(state: State<'_, AppState>) -> Result<Vec<OscMapping>, IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    Ok(receiver.list_mappings())
}

/// Vide tous les mappings OSC IN — utilisé par le restore .hfg (le fichier
/// remplace l'état courant : clear + replay des mappings sauvegardés).
#[tauri::command]
pub async fn osc_clear_mappings(state: State<'_, AppState>) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.clear_mappings();
    Ok(())
}

/// Active/désactive globalement l'OSC IN (master switch anti-loop)
#[tauri::command]
pub async fn osc_set_in_enabled(enabled: bool, state: State<'_, AppState>) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.set_in_enabled(enabled);
    Ok(())
}

/// Supprime l'OSC IN pendant `duration_ms` — les messages reçus pendant la
/// fenêtre sont ignorés (anti-loop après recall/panic). Clampée : un `u64`
/// arbitraire pouvait overflower `Instant + Duration` et paniquer.
#[tauri::command]
pub async fn osc_suppress_in(duration_ms: u64, state: State<'_, AppState>) -> Result<(), IpcError> {
    const MAX_SUPPRESS_MS: u64 = 120_000;
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.suppress_ms(duration_ms.min(MAX_SUPPRESS_MS));
    Ok(())
}

/// Statistiques du pipeline OSC IN (reçus / matchés / routés / droppés)
#[tauri::command]
pub async fn osc_in_stats(state: State<'_, AppState>) -> Result<OscInStatsSnapshot, IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    Ok(receiver.stats())
}

/// Retourne la dernière valeur reçue pour une clé (handler name ou feedback
/// key de destination : "macro:scale", "channel:Gain:3", "position:2")
#[tauri::command]
pub async fn osc_get_value(
    handler: String,
    state: State<'_, AppState>,
) -> Result<Vec<f64>, IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver
        .get_last_value(&handler)
        .ok_or_else(|| IpcError::not_found(format!("No value for handler: {handler}")))
}

#[tauri::command]
pub async fn osc_get_all_values(state: State<'_, AppState>) -> Result<serde_json::Value, IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    let values = receiver.get_all_values();
    serde_json::to_value(values).map_err(|e| IpcError::internal(e.to_string()))
}

/// Change le port du receiver OSC — le nouveau receiver est bindé et démarré
/// AVANT de stopper l'ancien : si le bind échoue, l'OSC IN reste fonctionnel
/// (sinon un mauvais port laissait le receiver arrêté en silence).
#[tauri::command]
pub async fn set_osc_receiver_port(port: u16, state: State<'_, AppState>) -> Result<(), IpcError> {
    // Même garde que set_global_osc_ids : le frontend peut être stale
    // (TOCTOU) — un rebind OSC IN pendant le playback casse les mappings.
    {
        let movements = lock_or_recover(&state.movements);
        if !movements.is_empty() {
            return Err(IpcError::conflict(
                "Cannot change OSC input port during playback. Stop all moves first.",
            ));
        }
    }
    // Même port → rien à changer
    {
        let receiver = lock_or_recover(&state.osc_receiver);
        if receiver.port == port && receiver.is_alive() {
            return Ok(());
        }
    }

    let (mappings, targets, enabled) = {
        let receiver = lock_or_recover(&state.osc_receiver);
        (
            receiver.list_mappings(),
            receiver.targets(),
            receiver.in_enabled(),
        )
    };

    let mut new_receiver = OscReceiver::new(port);
    new_receiver.set_targets(targets);
    new_receiver.set_in_enabled(enabled);
    for mapping in mappings {
        new_receiver
            .add_mapping(mapping)
            .map_err(|e| IpcError::internal(format!("Failed to restore mapping: {e}")))?;
    }
    // Bind + démarrage AVANT de toucher l'ancien receiver
    new_receiver
        .start()
        .map_err(|e| IpcError::io(format!("Failed to start OSC receiver on port {port}: {e}")))?;

    // Succès : stopper l'ancien et swapper
    let new_address_handle = {
        let mut receiver = lock_or_recover(&state.osc_receiver);
        receiver.stop();
        let handle = new_receiver.address_values_handle();
        *receiver = new_receiver;
        handle
    };
    // Re-brancher le cache OSC du signal graph sur le NOUVEAU receiver —
    // l'ancien handle pointe sur un map mort (les nodes SignalOsc liraient
    // des valeurs figées en silence).
    lock_or_recover(&state.merge_runtime).set_osc_values_handle(new_address_handle);
    eprintln!("[INFO] OSC receiver now listening on port {port}");
    Ok(())
}

/// Configure la sortie OSC du MergeRuntime (adresse, port, profil)
#[tauri::command]
pub async fn set_osc_output(
    address: String,
    port: u16,
    profile: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let profile_enum = OscProfile::from_str(&profile)
        .map_err(|e| IpcError::validation(format!("Invalid OSC profile '{profile}': {e}")))?;
    // Garde backend (le check frontend peut être stale) : reconfigurer la
    // cible OSC pendant le playback rerouterait toutes les positions.
    {
        let movements = lock_or_recover(&state.movements);
        if !movements.is_empty() {
            return Err(IpcError::conflict(
                "Cannot change OSC output during playback. Stop all moves first.",
            ));
        }
    }
    let osc_sender = OscSender::new(profile_enum, address.clone(), port);
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt
        .set_osc_target(address.clone(), port, osc_sender)
        .map_err(|e| IpcError::io(format!("Failed to set OSC target: {e:?}")))?;
    eprintln!("[INFO] OSC output now sending to {address}:{port} ({profile})");
    Ok(())
}

/// Récupère le port actuel du receiver OSC
#[tauri::command]
pub async fn get_osc_receiver_port(state: State<'_, AppState>) -> Result<u16, IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    Ok(receiver.port)
}

/// Envoie une position OSC unique à un track (utilisé par le Panic button)
#[tauri::command]
pub async fn send_osc_position(
    osc_id: u32,
    x: f64,
    y: f64,
    z: f64,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    // Un NaN/inf passerait direct à l'encodage OSC (ce chemin — panic
    // button — ne transite pas par la sanitize du merge loop).
    if ![x, y, z].iter().all(|v| v.is_finite()) {
        return Err(IpcError::validation("position must be finite"));
    }

    // Anti-loop : ignorer les echoes OSC IN pendant le panic
    lock_or_recover(&state.osc_receiver).suppress_ms(200);

    // Envoie via la cible OSC courante du MergeRuntime — celle-ci suit
    // `set_osc_output`, contrairement à `state.osc_sender` qui reste figée
    // sur le sender du startup (Generic@127.0.0.1:7000) : sans ça le panic
    // n'atteignait jamais le renderer réel.
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt
        .send_position_now(osc_id, nalgebra::Vector3::new(x, y, z))
        .map_err(|e| IpcError::io(format!("OSC send failed: {e}")))?;
    Ok(())
}

/// Master arm — « OSC LIVE » global. Gate sur le sink du merge : quand
/// désarmé, aucun paquet OSC ne part (preview 3D vivante, silence réseau).
/// Indépendant des flags `is_preview` par move.
#[tauri::command]
pub async fn set_osc_armed(
    armed: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_osc_armed(armed);
    eprintln!(
        "[INFO] OSC master arm: {}",
        if armed { "ARMED" } else { "DISARMED" }
    );
    // L'état armé est broadcasté — les toggles/chips UI restent synchronisés
    // quelle que soit la source de l'écriture (bouton, OSC /stagespace/arm).
    let _ = app.emit("osc-armed-changed", armed);
    Ok(())
}

#[tauri::command]
pub async fn get_osc_armed(state: State<'_, AppState>) -> Result<bool, IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.osc_armed())
}

/// Feedback cue vers les contrôleurs show-control : le frontend envoie
/// la cue courante/prochaine après chaque changement — le backend l'envoie
/// aux adresses ayant envoyé des commandes `/stagespace/*` (ack déjà
/// immédiat côté receiver).
#[derive(serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CueFeedbackEntry {
    pub number: String,
    pub name: String,
}

#[tauri::command]
pub async fn send_show_feedback(
    current: Option<CueFeedbackEntry>,
    next: Option<CueFeedbackEntry>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.send_show_feedback(
        current.map(|c| (c.number, c.name)),
        next.map(|n| (n.number, n.name)),
    );
    Ok(())
}

/// Âge (s) de la dernière commande `/stagespace/*` — voyant console.
#[tauri::command]
pub async fn get_last_show_cmd_age(state: State<'_, AppState>) -> Result<Option<f64>, IpcError> {
    Ok(lock_or_recover(&state.osc_receiver).last_show_cmd_age())
}

/// Dernier message OSC reçu hors `/stagespace/` — pour le learn :
/// le frontend poll pendant que l'opérateur bouge son fader.
#[tauri::command]
pub async fn get_last_osc_message(
    state: State<'_, AppState>,
) -> Result<Option<(String, Vec<f64>, f64)>, IpcError> {
    Ok(lock_or_recover(&state.osc_receiver).last_received())
}

/// NACK : `/stagespace/nack <reason>` vers l'expéditeur d'une commande
/// rejetée (busy/not-found) — addr = le `from` de l'évènement show-control.
#[tauri::command]
pub async fn send_show_nack(
    addr: String,
    reason: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let parsed: std::net::SocketAddr = addr
        .parse()
        .map_err(|_| IpcError::validation(format!("invalid controller addr '{addr}'")))?;
    lock_or_recover(&state.osc_receiver).send_show_nack(parsed, &reason);
    Ok(())
}

/// FPS utilisé pour la forme string `HH:MM:SS:FF` du timecode
/// (`/stagespace/timecode`) — non-drop, 24/25/30 ; défaut 25.
#[tauri::command]
pub async fn set_timecode_fps(fps: f64, state: State<'_, AppState>) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.set_timecode_fps(fps);
    Ok(())
}

// ─── PSN/RTTrP (PosiStageNet) — tracking industrie ───

/// Configure et démarre/arrête le récepteur PSN. Le mapping
/// `tracker_id → object_index` s'applique immédiatement ; les positions
/// reçues sont injectées en positions manuelles (lissées par la couche
/// cinématique du merge).
#[tauri::command]
pub async fn set_psn_config(
    enabled: bool,
    group: String,
    port: u16,
    tracker_map: std::collections::HashMap<u32, usize>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let psn = state.psn_receiver.clone();
    psn.set_tracker_map(tracker_map);
    if enabled {
        let merge_rt = state.merge_runtime.clone();
        psn.start(&group, port, move |obj, pos| {
            if let Ok(rt) = merge_rt.lock() {
                rt.set_manual_position(obj, pos);
            }
        })
        .map_err(IpcError::internal)?;
    } else {
        psn.stop();
    }
    Ok(())
}

/// Santé du flux PSN — `last_packet_age_ms` (None = jamais reçu) +
/// `running`. Utilisé par le bandeau de santé des flux.
#[tauri::command]
pub async fn get_psn_health(state: State<'_, AppState>) -> Result<(bool, Option<u64>), IpcError> {
    let psn = &state.psn_receiver;
    Ok((psn.is_running(), psn.last_packet_age_ms()))
}
