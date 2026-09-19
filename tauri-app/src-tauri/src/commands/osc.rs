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
) -> Result<(), String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.add_mapping(mapping)
}

#[tauri::command]
pub async fn osc_remove_mapping(address: String, state: State<'_, AppState>) -> Result<(), String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.remove_mapping(&address);
    Ok(())
}

#[tauri::command]
pub async fn osc_list_mappings(state: State<'_, AppState>) -> Result<Vec<OscMapping>, String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    Ok(receiver.list_mappings())
}

/// Active/désactive globalement l'OSC IN (master switch anti-loop)
#[tauri::command]
pub async fn osc_set_in_enabled(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.set_in_enabled(enabled);
    Ok(())
}

/// Supprime l'OSC IN pendant `duration_ms` — les messages reçus pendant la
/// fenêtre sont ignorés (anti-loop après recall/panic)
#[tauri::command]
pub async fn osc_suppress_in(duration_ms: u64, state: State<'_, AppState>) -> Result<(), String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver.suppress_ms(duration_ms);
    Ok(())
}

/// Statistiques du pipeline OSC IN (reçus / matchés / routés / droppés)
#[tauri::command]
pub async fn osc_in_stats(state: State<'_, AppState>) -> Result<OscInStatsSnapshot, String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    Ok(receiver.stats())
}

/// Retourne la dernière valeur reçue pour une clé (handler name ou feedback
/// key de destination : "macro:scale", "channel:Gain:3", "position:2")
#[tauri::command]
pub async fn osc_get_value(
    handler: String,
    state: State<'_, AppState>,
) -> Result<Vec<f64>, String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    receiver
        .get_last_value(&handler)
        .ok_or_else(|| format!("No value for handler: {handler}"))
}

#[tauri::command]
pub async fn osc_get_all_values(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let receiver = lock_or_recover(&state.osc_receiver);
    let values = receiver.get_all_values();
    serde_json::to_value(values).map_err(|e| e.to_string())
}

/// Change le port du receiver OSC — stop l'ancien, recrée un receiver en
/// préservant mappings, targets, enable state, puis démarre
#[tauri::command]
pub async fn set_osc_receiver_port(port: u16, state: State<'_, AppState>) -> Result<(), String> {
    let (mappings, targets, enabled) = {
        let mut receiver = lock_or_recover(&state.osc_receiver);
        receiver.stop();
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
            .map_err(|e| format!("Failed to restore mapping: {e}"))?;
    }
    new_receiver
        .start()
        .map_err(|e| format!("Failed to start OSC receiver on port {port}: {e}"))?;

    *lock_or_recover(&state.osc_receiver) = new_receiver;
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
) -> Result<(), String> {
    let profile_enum = OscProfile::from_str(&profile)
        .map_err(|e| format!("Invalid OSC profile '{profile}': {e}"))?;
    let osc_sender = OscSender::new(profile_enum, address.clone(), port);
    let mut merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt
        .set_osc_target(address.clone(), port, osc_sender)
        .map_err(|e| format!("Failed to set OSC target: {e:?}"))?;
    eprintln!("[INFO] OSC output now sending to {address}:{port} ({profile})");
    Ok(())
}

/// Récupère le port actuel du receiver OSC
#[tauri::command]
pub async fn get_osc_receiver_port(state: State<'_, AppState>) -> Result<u16, String> {
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
) -> Result<(), String> {
    // Anti-loop : ignorer les echoes OSC IN pendant le panic
    lock_or_recover(&state.osc_receiver).suppress_ms(200);

    let sender = lock_or_recover(&state.osc_sender);
    let (addr, values) = sender.format_position(osc_id, nalgebra::Vector3::new(x, y, z));

    // Récupérer l'adresse de destination depuis le sender
    let dest_addr = sender.destination();
    drop(sender);

    // Créer un socket temporaire pour envoyer
    let socket =
        std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("Socket bind failed: {e}"))?;
    socket
        .connect(dest_addr)
        .map_err(|e| format!("Connect failed: {e}"))?;

    let args: Vec<rosc::OscType> = values
        .iter()
        .map(|v| rosc::OscType::Float(*v as f32))
        .collect();
    let packet = rosc::OscPacket::Message(rosc::OscMessage { addr, args });
    let bytes = rosc::encoder::encode(&packet).map_err(|e| format!("OSC encode failed: {e}"))?;
    socket
        .send(&bytes)
        .map_err(|e| format!("OSC send failed: {e}"))?;
    Ok(())
}
