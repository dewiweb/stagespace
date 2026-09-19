//! Cinématique des objets — mesure de vitesse, accélération et jerk sur les
//! positions finales (post-merge, post-post-process, donc ce que le renderer
//! reçoit réellement), puis modulation des canaux spatiaux par ces mesures.
//!
//! Architecture :
//! - `KinematicState` par objet, thread-local dans le merge thread (pas de lock)
//! - `ChannelModulation` : règles configurables (source → canal, scale/offset/clamp)
//! - `apply_modulations` : calcule les canaux modulés, qui surchargent les
//!   canaux statiques via `SpatialChannels::overlay`

use crate::osc_sender::{SpatialChannel, SpatialChannels};
use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

/// Source cinématique mesurable sur la trajectoire d'un objet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KinematicSource {
    /// Norme de la vitesse (unités scène / s)
    Speed,
    /// Norme de l'accélération (unités scène / s²)
    Acceleration,
    /// Norme du jerk (unités scène / s³)
    Jerk,
}

impl FromStr for KinematicSource {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "speed" | "velocity" | "vel" => Ok(KinematicSource::Speed),
            "acceleration" | "accel" => Ok(KinematicSource::Acceleration),
            "jerk" => Ok(KinematicSource::Jerk),
            _ => Err(format!("Unknown kinematic source: {s}")),
        }
    }
}

/// Serde helper : f64 ±∞ ↔ JSON null (JSON ne représente pas l'infini).
/// `serialize` écrit null pour les valeurs non finies ; `deserialize` lit
/// null comme la borne par défaut du champ.
mod serde_neg_inf {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
        if v.is_finite() {
            s.serialize_some(v)
        } else {
            s.serialize_none()
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
        Ok(Option::<f64>::deserialize(d)?.unwrap_or(f64::NEG_INFINITY))
    }
}
mod serde_pos_inf {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
        if v.is_finite() {
            s.serialize_some(v)
        } else {
            s.serialize_none()
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
        Ok(Option::<f64>::deserialize(d)?.unwrap_or(f64::INFINITY))
    }
}

/// Règle de modulation : source cinématique → canal spatial.
///
/// `value = clamp(source * scale + offset, min, max)`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelModulation {
    /// Objet cible — None = tous les objets
    pub object: Option<usize>,
    /// Source cinématique mesurée
    pub source: KinematicSource,
    /// Canal spatial modulé
    pub channel: SpatialChannel,
    /// Facteur d'échelle appliqué à la mesure
    pub scale: f64,
    /// Décalage ajouté après le scale
    pub offset: f64,
    /// Borne basse du résultat (−∞ = pas de borne, sérialisé null)
    #[serde(with = "serde_neg_inf")]
    pub min: f64,
    /// Borne haute du résultat (+∞ = pas de borne, sérialisé null)
    #[serde(with = "serde_pos_inf")]
    pub max: f64,
}

impl ChannelModulation {
    pub fn new(source: KinematicSource, channel: SpatialChannel, scale: f64) -> Self {
        Self {
            object: None,
            source,
            channel,
            scale,
            offset: 0.0,
            min: f64::NEG_INFINITY,
            max: f64::INFINITY,
        }
    }

    /// Construit une règle depuis les params d'un node graphe `Velocity` :
    /// `{source, channel, scale, offset, min, max, object}` — `min`/`max`
    /// acceptent null/vide/absent pour "pas de borne" (±∞) ; les champs
    /// numériques acceptent les strings de l'éditeur (`"0.5"`).
    pub fn from_node_params(params: &serde_json::Value) -> Result<Self, String> {
        use crate::node_params as np;
        let get = |key: &str| params.get(key).and_then(np::flex_f64);
        let source = KinematicSource::from_str(
            params
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or("speed"),
        )?;
        let channel = SpatialChannel::from_str(
            params
                .get("channel")
                .and_then(|v| v.as_str())
                .ok_or("Velocity node requires 'channel'")?,
        )?;
        Ok(ChannelModulation {
            object: params.get("object").and_then(np::flex_usize),
            source,
            channel,
            scale: get("scale").unwrap_or(1.0),
            offset: get("offset").unwrap_or(0.0),
            min: get("min").unwrap_or(f64::NEG_INFINITY),
            max: get("max").unwrap_or(f64::INFINITY),
        })
    }
}

/// État cinématique d'un objet — positions/vitesses précédentes + mesures
/// lissées. Possédé par le merge thread (aucune synchronisation requise).
#[derive(Debug, Clone, Copy, Default)]
pub struct KinematicState {
    prev_pos: Option<Vector3<f64>>,
    prev_vel: Option<Vector3<f64>>,
    prev_accel: Option<Vector3<f64>>,
    /// Nombre d'échantillons valides accumulés (échauffement des dérivées)
    age: u8,
    /// Vitesse lissée (unités/s)
    pub speed: f64,
    /// Accélération lissée (unités/s²)
    pub accel: f64,
    /// Jerk lissé (unités/s³)
    pub jerk: f64,
}

impl KinematicState {
    /// Met à jour l'état avec la position finale de l'objet pour cette frame.
    ///
    /// `smoothing` ∈ [0, 1) : coefficient one-pole — 0 = mesure brute,
    /// 0.7 = fort lissage (~3 frames de constante de temps à 60 FPS).
    /// Les dérivées ne sont rapportées qu'une fois assez d'échantillons
    /// accumulés (vitesse : 2, accélération : 3, jerk : 4) pour éviter les
    /// pics parasites à l'apparition de l'objet.
    pub fn update(&mut self, pos: Vector3<f64>, dt: f64, smoothing: f64) {
        if dt <= 0.0 {
            return;
        }
        let alpha = smoothing.clamp(0.0, 0.99);

        let vel = self
            .prev_pos
            .map(|p| (pos - p) / dt)
            .unwrap_or_else(Vector3::zeros);
        let accel = self
            .prev_vel
            .map(|v| (vel - v) / dt)
            .unwrap_or_else(Vector3::zeros);
        let jerk = self
            .prev_accel
            .map(|a| (accel - a) / dt)
            .unwrap_or_else(Vector3::zeros);

        self.prev_pos = Some(pos);
        self.prev_vel = Some(vel);
        self.prev_accel = Some(accel);
        self.age = self.age.saturating_add(1);

        let raw_speed = if self.age >= 2 { vel.norm() } else { 0.0 };
        let raw_accel = if self.age >= 3 { accel.norm() } else { 0.0 };
        let raw_jerk = if self.age >= 4 { jerk.norm() } else { 0.0 };

        self.speed = alpha * self.speed + (1.0 - alpha) * raw_speed;
        self.accel = alpha * self.accel + (1.0 - alpha) * raw_accel;
        self.jerk = alpha * self.jerk + (1.0 - alpha) * raw_jerk;
    }

    /// Valeur courante d'une source cinématique
    pub fn value(&self, source: KinematicSource) -> f64 {
        match source {
            KinematicSource::Speed => self.speed,
            KinematicSource::Acceleration => self.accel,
            KinematicSource::Jerk => self.jerk,
        }
    }
}

/// Applique les règles de modulation aux états cinématiques.
///
/// Retourne les canaux modulés par objet — à combiner avec les canaux
/// statiques via `SpatialChannels::overlay` (la modulation a priorité sur
/// les canaux qu'elle cible).
pub fn apply_modulations(
    rules: &[ChannelModulation],
    states: &HashMap<usize, KinematicState>,
) -> HashMap<usize, SpatialChannels> {
    let mut out: HashMap<usize, SpatialChannels> = HashMap::new();
    if rules.is_empty() {
        return out;
    }
    for rule in rules {
        for (obj, state) in states {
            if let Some(target) = rule.object {
                if target != *obj {
                    continue;
                }
            }
            let value =
                (state.value(rule.source) * rule.scale + rule.offset).clamp(rule.min, rule.max);
            out.entry(*obj).or_default().set(rule.channel, value);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kinematic_source_from_str() {
        assert_eq!(
            KinematicSource::from_str("speed").unwrap(),
            KinematicSource::Speed
        );
        assert_eq!(
            KinematicSource::from_str("VELOCITY").unwrap(),
            KinematicSource::Speed
        );
        assert_eq!(
            KinematicSource::from_str("accel").unwrap(),
            KinematicSource::Acceleration
        );
        assert_eq!(
            KinematicSource::from_str("jerk").unwrap(),
            KinematicSource::Jerk
        );
        assert!(KinematicSource::from_str("nope").is_err());
    }

    #[test]
    fn test_speed_constant_velocity() {
        let mut st = KinematicState::default();
        let dt = 1.0 / 60.0;
        // Mouvement à 2 unités/s selon x
        for i in 0..10 {
            st.update(Vector3::new(i as f64 * 2.0 * dt, 0.0, 0.0), dt, 0.0);
        }
        assert!((st.speed - 2.0).abs() < 1e-9);
        // Vitesse constante → accélération ~0
        assert!(st.accel < 1e-6);
    }

    #[test]
    fn test_warmup_no_spike() {
        let mut st = KinematicState::default();
        let dt = 1.0 / 60.0;
        // Objet apparaît déjà en mouvement — la 1re frame ne doit pas
        // produire de pic d'accélération
        st.update(Vector3::zeros(), dt, 0.0);
        assert_eq!(st.speed, 0.0);
        st.update(Vector3::new(1.0, 0.0, 0.0), dt, 0.0);
        assert!(st.speed > 0.0);
        assert_eq!(st.accel, 0.0); // pas encore assez d'échantillons
        assert_eq!(st.jerk, 0.0);
    }

    #[test]
    fn test_acceleration_constant() {
        let mut st = KinematicState::default();
        let dt = 0.1;
        // pos = 0.5 * a * t² avec a = 4 → vel = a*t, accel = 4
        for i in 0..20 {
            let t = i as f64 * dt;
            st.update(Vector3::new(0.5 * 4.0 * t * t, 0.0, 0.0), dt, 0.0);
        }
        assert!((st.accel - 4.0).abs() < 0.3);
    }

    #[test]
    fn test_smoothing() {
        let mut smooth = KinematicState::default();
        let mut raw = KinematicState::default();
        let dt = 1.0 / 60.0;
        // Échauffement à l'arrêt
        for _ in 0..5 {
            smooth.update(Vector3::zeros(), dt, 0.8);
            raw.update(Vector3::zeros(), dt, 0.0);
        }
        // Saut de position : la mesure brute voit toute la vitesse,
        // la lissée monte progressivement
        smooth.update(Vector3::new(1.0, 0.0, 0.0), dt, 0.8);
        raw.update(Vector3::new(1.0, 0.0, 0.0), dt, 0.0);
        assert!(raw.speed > 0.0);
        assert!(smooth.speed < raw.speed);
        // Quand l'objet s'arrête, la brute retombe à 0 immédiatement
        // alors que la lissée garde une traîne
        smooth.update(Vector3::new(1.0, 0.0, 0.0), dt, 0.8);
        raw.update(Vector3::new(1.0, 0.0, 0.0), dt, 0.0);
        assert_eq!(raw.speed, 0.0);
        assert!(smooth.speed > raw.speed);
    }

    #[test]
    fn test_apply_modulations_global() {
        let mut states = HashMap::new();
        let mut st = KinematicState::default();
        st.speed = 3.0;
        states.insert(0usize, st);
        states.insert(1usize, st);

        let rules = vec![ChannelModulation::new(
            KinematicSource::Speed,
            SpatialChannel::Spread,
            0.2,
        )];
        let out = apply_modulations(&rules, &states);
        assert_eq!(out.len(), 2);
        assert!((out[&0].spread.unwrap() - 0.6).abs() < 1e-9);
        assert!((out[&1].spread.unwrap() - 0.6).abs() < 1e-9);
    }

    #[test]
    fn test_apply_modulations_per_object_and_clamp() {
        let mut states = HashMap::new();
        let mut st = KinematicState::default();
        st.speed = 10.0;
        states.insert(0usize, st);
        states.insert(1usize, st);

        let mut rule = ChannelModulation::new(KinematicSource::Speed, SpatialChannel::Gain, 1.0);
        rule.object = Some(1);
        rule.min = -12.0;
        rule.max = 6.0;
        let out = apply_modulations(&[rule], &states);
        assert!(!out.contains_key(&0)); // filtré
        assert_eq!(out[&1].gain, Some(6.0)); // clampé
    }

    #[test]
    fn test_apply_modulations_offset() {
        let mut states = HashMap::new();
        states.insert(0usize, KinematicState::default()); // speed = 0

        let mut rule =
            ChannelModulation::new(KinematicSource::Speed, SpatialChannel::Presence, 2.0);
        rule.offset = 10.0;
        let out = apply_modulations(&[rule], &states);
        assert_eq!(out[&0].presence, Some(10.0));
    }

    #[test]
    fn test_from_node_params_defaults() {
        let m = ChannelModulation::from_node_params(&serde_json::json!({
            "source": "speed", "channel": "spread", "scale": 0.1
        }))
        .unwrap();
        assert_eq!(m.source, KinematicSource::Speed);
        assert_eq!(m.channel, SpatialChannel::Spread);
        assert_eq!(m.scale, 0.1);
        assert_eq!(m.offset, 0.0);
        assert_eq!(m.min, f64::NEG_INFINITY);
        assert_eq!(m.max, f64::INFINITY);
        assert!(m.object.is_none());
    }

    #[test]
    fn test_from_node_params_string_forms() {
        let m = ChannelModulation::from_node_params(&serde_json::json!({
            "source": "jerk", "channel": "presence",
            "scale": "0.5", "offset": "0.1",
            "min": "", "max": "1.0", "object": "2"
        }))
        .unwrap();
        assert_eq!(m.source, KinematicSource::Jerk);
        assert_eq!(m.scale, 0.5);
        assert_eq!(m.offset, 0.1);
        assert_eq!(m.min, f64::NEG_INFINITY); // "" = pas de borne
        assert_eq!(m.max, 1.0);
        assert_eq!(m.object, Some(2));
    }

    #[test]
    fn test_from_node_params_errors() {
        // channel manquant → erreur
        assert!(ChannelModulation::from_node_params(&serde_json::json!({})).is_err());
        // canal inconnu → erreur
        assert!(ChannelModulation::from_node_params(&serde_json::json!({
            "channel": "bogus"
        }))
        .is_err());
        // source inconnue → erreur
        assert!(ChannelModulation::from_node_params(&serde_json::json!({
            "source": "bogus", "channel": "gain"
        }))
        .is_err());
    }
}
