use super::error::IpcError;
use super::state::lock_or_recover;
use crate::AppState;
use stagespace_engines::{OscInStatsSnapshot, OscMapping, OscProfile, OscReceiver, OscSender};
use std::str::FromStr;
use tauri::State;

// OSC Receiver Commands

/// Ajoute un mapping OSC IN → destination (handler | macro | channel | position).
/// Le mapping est actif immédiatement, même si le receiver tourne déjà.
#[tauri::command]
pub async fn osc_add_mapping(
    mapping: OscMapping,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.add_mapping(mapping).map_err(IpcError::from)
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
    {
        let mut receiver = lock_or_recover(&state.osc_receiver);
        receiver.stop();
        *receiver = new_receiver;
    }
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
