//! Canaux spatiaux étendus par objet : gain, spread, distance, presence,
//! yaw, aperture, lfe — envoyés en OSC en plus de la position.

use crate::commands::error::IpcError;
use crate::AppState;
use serde::Deserialize;
use stagespace_engines::kinematics::{ChannelModulation, KinematicSource};
use stagespace_engines::osc_sender::{SpatialChannel, SpatialChannels};
use stagespace_engines::zones::{Zone, ZoneShape};
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
) -> Result<(), IpcError> {
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
) -> Result<(), IpcError> {
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
pub async fn clear_all_spatial_channels(state: State<'_, AppState>) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_all_object_channels();
    Ok(())
}

/// Liste les canaux spatiaux statiques par objet (pour UI/persistance)
#[tauri::command]
pub async fn list_spatial_channels(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<usize, SpatialChannels>, IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.object_channels())
}

/// Liste les règles de modulation cinématique actives
#[tauri::command]
pub async fn list_channel_modulations(
    state: State<'_, AppState>,
) -> Result<Vec<ChannelModulation>, IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.modulations())
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
    /// Position du listener pour la source `angvel` (défaut : origine)
    pub listener: Option<[f64; 3]>,
}

/// Ajoute une règle de modulation cinématique (vitesse/accélération/jerk
/// mesurés sur la trajectoire finale → canal spatial).
/// value = clamp(source * scale + offset, min, max)
/// object_index absent = tous les objets.
#[tauri::command]
pub async fn add_channel_modulation(
    params: ModulationParams,
    state: State<'_, AppState>,
) -> Result<usize, IpcError> {
    let mut rule = ChannelModulation::new(
        KinematicSource::from_str(&params.source)?,
        SpatialChannel::from_str(&params.channel)?,
        params.scale,
    );
    rule.offset = params.offset.unwrap_or(0.0);
    rule.min = params.min.unwrap_or(f64::NEG_INFINITY);
    rule.max = params.max.unwrap_or(f64::INFINITY);
    rule.object = params.object_index;
    if let Some(l) = params.listener {
        rule.listener = l;
    }
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.add_modulation(rule))
}

/// Supprime une règle de modulation par index
#[tauri::command]
pub async fn remove_channel_modulation(
    index: usize,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    if merge_rt.remove_modulation(index) {
        Ok(())
    } else {
        Err(IpcError::not_found(format!(
            "No modulation at index {index}"
        )))
    }
}

/// Efface toutes les règles de modulation cinématique
#[tauri::command]
pub async fn clear_channel_modulations(state: State<'_, AppState>) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_modulations();
    Ok(())
}

/// Définit le lissage des mesures cinématiques [0, 1)
#[tauri::command]
pub async fn set_kinematic_smoothing(
    smoothing: f64,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_kinematic_smoothing(smoothing);
    Ok(())
}

/// Paramètres d'une zone d'effet spatial
#[derive(Deserialize)]
pub struct ZoneParams {
    /// "sphere" (center+radius) ou "box" (min+max)
    pub shape: String,
    /// sphere : [cx, cy, cz] ; box : [min_x, min_y, min_z]
    pub a: [f64; 3],
    /// sphere : rayon ; box : ignoré (utiliser b)
    pub radius: Option<f64>,
    /// box : [max_x, max_y, max_z]
    pub b: Option<[f64; 3]>,
    /// Largeur de transition au-delà du bord (défaut 0 = bord franc)
    pub falloff: Option<f64>,
    /// Canaux cibles à pleine influence
    pub channels: std::collections::HashMap<String, f64>,
    /// Objets concernés (défaut : tous)
    pub objects: Option<Vec<usize>>,
}

/// Ajoute une zone d'effet spatial : les canaux listés sont tirés vers leurs
/// valeurs cibles proportionnellement à l'influence (smoothstep sur falloff).
#[tauri::command]
pub async fn add_zone(params: ZoneParams, state: State<'_, AppState>) -> Result<usize, IpcError> {
    let shape = match params.shape.to_lowercase().as_str() {
        "sphere" => ZoneShape::Sphere {
            center: params.a,
            radius: params.radius.unwrap_or(1.0),
        },
        "box" => ZoneShape::Box {
            min: params.a,
            max: params.b.ok_or("Box zone requires 'b' (max corner)")?,
        },
        s => {
            return Err(IpcError::validation(format!(
                "Unknown zone shape '{s}' (sphere|box)"
            )))
        }
    };
    let mut channels = SpatialChannels::default();
    for (name, value) in &params.channels {
        channels.set(SpatialChannel::from_str(name)?, *value);
    }
    if channels.is_empty() {
        return Err(IpcError::validation("Zone requires at least one channel"));
    }
    let zone = Zone {
        shape,
        falloff: params.falloff.unwrap_or(0.0).max(0.0),
        channels,
        objects: params.objects,
        enabled: true,
    };
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.add_zone(zone))
}

/// Supprime une zone par index
#[tauri::command]
pub async fn remove_zone(index: usize, state: State<'_, AppState>) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    if merge_rt.remove_zone(index) {
        Ok(())
    } else {
        Err(IpcError::not_found(format!("No zone at index {index}")))
    }
}

/// Efface toutes les zones
#[tauri::command]
pub async fn clear_zones(state: State<'_, AppState>) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_zones();
    Ok(())
}

/// Liste les zones actives
#[tauri::command]
pub async fn list_zones(state: State<'_, AppState>) -> Result<Vec<Zone>, IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.zones())
}

/// Liste les effets déclarés par le graph global (nodes `Zone` / `Velocity`)
/// — séparés des effets manuels (add_zone/add_channel_modulation).
#[tauri::command]
pub async fn list_graph_effects(state: State<'_, AppState>) -> Result<serde_json::Value, IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let (zones, modulations) = merge_rt.graph_effects();
    Ok(serde_json::json!({
        "zones": zones,
        "modulations": modulations,
    }))
}
