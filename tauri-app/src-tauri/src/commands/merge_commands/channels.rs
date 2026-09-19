//! Canaux spatiaux étendus par objet : gain, spread, distance, presence,
//! yaw, aperture, lfe — envoyés en OSC en plus de la position.

use crate::AppState;
use serde::Deserialize;
use stagespace_engines::kinematics::{ChannelModulation, KinematicSource};
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

/// Paramètres d'une règle de modulation cinématique
#[derive(Deserialize)]
pub struct ModulationParams {
    /// Source cinématique : speed | accel | jerk
    pub source: String,
    /// Canal spatial cible : gain | spread | distance | presence | yaw | aperture | lfe
    pub channel: String,
    /// Facteur d'échelle
    pub scale: f64,
    /// Décalage (défaut 0)
    pub offset: Option<f64>,
    /// Borne basse (défaut -inf)
    pub min: Option<f64>,
    /// Borne haute (défaut +inf)
    pub max: Option<f64>,
    /// Objet cible (défaut : tous)
    pub object_index: Option<usize>,
}

/// Ajoute une règle de modulation cinématique (vitesse/accélération/jerk
/// mesurés sur la trajectoire finale → canal spatial).
/// value = clamp(source * scale + offset, min, max)
/// object_index absent = tous les objets.
#[tauri::command]
pub async fn add_channel_modulation(
    params: ModulationParams,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let mut rule = ChannelModulation::new(
        KinematicSource::from_str(&params.source)?,
        SpatialChannel::from_str(&params.channel)?,
        params.scale,
    );
    rule.offset = params.offset.unwrap_or(0.0);
    rule.min = params.min.unwrap_or(f64::NEG_INFINITY);
    rule.max = params.max.unwrap_or(f64::INFINITY);
    rule.object = params.object_index;
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.add_modulation(rule))
}

/// Supprime une règle de modulation par index
#[tauri::command]
pub async fn remove_channel_modulation(
    index: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    if merge_rt.remove_modulation(index) {
        Ok(())
    } else {
        Err(format!("No modulation at index {index}"))
    }
}

/// Efface toutes les règles de modulation cinématique
#[tauri::command]
pub async fn clear_channel_modulations(state: State<'_, AppState>) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_modulations();
    Ok(())
}

/// Définit le lissage des mesures cinématiques [0, 1)
#[tauri::command]
pub async fn set_kinematic_smoothing(
    smoothing: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_kinematic_smoothing(smoothing);
    Ok(())
}
