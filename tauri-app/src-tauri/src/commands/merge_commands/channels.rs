//! Canaux spatiaux étendus par objet : gain, spread, distance, presence,
//! yaw, aperture, lfe — envoyés en OSC en plus de la position.

use crate::AppState;
use stagespace_engines::osc_sender::SpatialChannel;
use std::str::FromStr;
use tauri::State;

use super::lock_or_recover;

/// Définit un canal spatial étendu pour un objet
#[tauri::command]
pub async fn set_spatial_channel(
    object_index: usize,
    channel: String,
    value: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ch = SpatialChannel::from_str(&channel)?;
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_object_channel(object_index, ch, value);
    Ok(())
}

/// Efface un canal spatial pour un objet (channel absent = tous les canaux)
#[tauri::command]
pub async fn clear_spatial_channel(
    object_index: usize,
    channel: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ch = match channel {
        Some(c) => Some(SpatialChannel::from_str(&c)?),
        None => None,
    };
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_object_channel(object_index, ch);
    Ok(())
}

/// Efface tous les canaux spatiaux de tous les objets
#[tauri::command]
pub async fn clear_all_spatial_channels(state: State<'_, AppState>) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_all_object_channels();
    Ok(())
}
