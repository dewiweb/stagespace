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
    /// Vitesse angulaire autour du listener (°/s) — mesure perceptuelle :
    /// ω = |d × v| / |d|² en 3D. Une source lointaine rapide bouge
    /// "lentement", une source proche lente bouge "vite". Le point
    /// d'écoute est défini par la règle (`listener`, défaut : origine).
    AngularSpeed,
}

impl FromStr for KinematicSource {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "speed" | "velocity" | "vel" => Ok(KinematicSource::Speed),
            "acceleration" | "accel" => Ok(KinematicSource::Acceleration),
            "jerk" => Ok(KinematicSource::Jerk),
            "angvel" | "angular" | "angular_speed" | "angularspeed" | "perceptual" => {
                Ok(KinematicSource::AngularSpeed)
            }
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
    /// Position du listener pour `AngularSpeed` (défaut : origine).
    /// `#[serde(default)]` pour la rétrocompat des cues persistées.
    #[serde(default)]
    pub listener: [f64; 3],
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
            listener: [0.0, 0.0, 0.0],
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
        // Garde-fou : f64::clamp panique si min > max — un node Velocity
        // mal configuré tuerait le merge thread. On swap les bornes au
        // parsing plutôt que de rejeter la règle (le show continue).
        let min = get("min").unwrap_or(f64::NEG_INFINITY);
        let max = get("max").unwrap_or(f64::INFINITY);
        let (min, max) = if min <= max { (min, max) } else { (max, min) };
        Ok(ChannelModulation {
            object: params.get("object").and_then(np::flex_usize),
            source,
            channel,
            scale: get("scale").unwrap_or(1.0),
            offset: get("offset").unwrap_or(0.0),
            min,
            max,
            listener: params
                .get("listener")
                .and_then(np::flex_vec3)
                .unwrap_or([0.0, 0.0, 0.0]),
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
    /// Dernière position (sert à la vitesse angulaire)
    pos: Vector3<f64>,
    /// Vitesse lissée vectorielle (unités/s) — sert à la vitesse angulaire
    vel_smooth: Vector3<f64>,
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
        self.pos = pos;
        self.vel_smooth = alpha * self.vel_smooth + (1.0 - alpha) * vel;

        let raw_speed = if self.age >= 2 { vel.norm() } else { 0.0 };
        let raw_accel = if self.age >= 3 { accel.norm() } else { 0.0 };
        let raw_jerk = if self.age >= 4 { jerk.norm() } else { 0.0 };

        self.speed = alpha * self.speed + (1.0 - alpha) * raw_speed;
        self.accel = alpha * self.accel + (1.0 - alpha) * raw_accel;
        self.jerk = alpha * self.jerk + (1.0 - alpha) * raw_jerk;
    }

    /// Rayon minimal pour la mesure angulaire — une source traversant la
    /// tête de l'auditeur donne une vitesse angulaire grande mais finie.
    const MIN_ANGULAR_RADIUS: f64 = 0.05;

    /// Vitesse angulaire autour d'un point d'écoute (°/s).
    /// ω = |d × v| / r² : la composante transverse de la vitesse rapportée
    /// à la distance — c'est ce que le système auditif perçoit (borne
    /// perceptuelle : au-delà de ~90-180°/s la localisation se brouille).
    pub fn angular_speed_deg(&self, listener: Vector3<f64>) -> f64 {
        if self.age < 2 {
            return 0.0;
        }
        let d = self.pos - listener;
        let r = d.norm().max(Self::MIN_ANGULAR_RADIUS);
        d.cross(&self.vel_smooth).norm() / (r * r) * (180.0 / std::f64::consts::PI)
    }

    /// Valeur courante d'une source cinématique
    pub fn value(&self, source: KinematicSource) -> f64 {
        match source {
            KinematicSource::Speed => self.speed,
            KinematicSource::Acceleration => self.accel,
            KinematicSource::Jerk => self.jerk,
            // AngularSpeed dépend du listener (paramètre de la règle, pas de
            // l'état) — la mesure est calculée dans apply_modulations.
            KinematicSource::AngularSpeed => 0.0,
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
            let measured = match rule.source {
                KinematicSource::AngularSpeed => {
                    state.angular_speed_deg(Vector3::from(rule.listener))
                }
                _ => state.value(rule.source),
            };
            // Défense en profondeur : f64::clamp panique si min > max —
            // une règle construite hors from_node_params (deserialization,
            // code direct) avec des bornes inversées ne doit pas tuer le
            // merge thread. On swap plutôt que paniquer.
            let (lo, hi) = if rule.min <= rule.max {
                (rule.min, rule.max)
            } else {
                (rule.max, rule.min)
            };
            let value = (measured * rule.scale + rule.offset).clamp(lo, hi);
            // Ne jamais émettre un canal NaN/inf (mesure ou scale/offset
            // non finis) — ça se propagerait jusqu'à l'OSC.
            if value.is_finite() {
                out.entry(*obj).or_default().set(rule.channel, value);
            }
        }
    }
    out
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
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
    fn test_angular_speed_orbiting_object() {
        // Objet en orbite à r=1, vitesse angulaire réelle 1 rad/s → 57.3°/s
        let mut st = KinematicState::default();
        let dt = 1.0 / 60.0;
        for i in 0..120 {
            let t = i as f64 * dt;
            st.update(Vector3::new(t.cos(), t.sin(), 0.0), dt, 0.0);
        }
        let deg = st.angular_speed_deg(Vector3::zeros());
        assert!(
            (deg - 57.2958).abs() < 2.0,
            "angvel={deg}°/s, attendu ~57.3"
        );
    }

    #[test]
    fn test_angular_speed_radial_motion_is_zero() {
        // Mouvement purement radial vers le listener → pas de composante
        // transverse → vitesse angulaire nulle
        let mut st = KinematicState::default();
        let dt = 1.0 / 60.0;
        for i in 0..30 {
            let x = 2.0 - i as f64 * dt; // approche à 1 u/s selon x
            st.update(Vector3::new(x, 0.0, 0.0), dt, 0.0);
        }
        assert!(st.angular_speed_deg(Vector3::zeros()) < 1e-6);
    }

    #[test]
    fn test_angular_speed_far_object_perceived_slower() {
        // Même vitesse linéaire : un objet proche "bouge" perceptuellement
        // plus vite qu'un objet lointain
        let dt = 1.0 / 60.0;
        let mut near = KinematicState::default();
        let mut far = KinematicState::default();
        for i in 0..30 {
            let t = i as f64 * dt;
            near.update(Vector3::new(0.5, t, 0.0), dt, 0.0);
            far.update(Vector3::new(5.0, t, 0.0), dt, 0.0);
        }
        let listener = Vector3::zeros();
        let w_near = near.angular_speed_deg(listener);
        let w_far = far.angular_speed_deg(listener);
        assert!(w_near > w_far * 5.0, "near={w_near} far={w_far}");
    }

    #[test]
    fn test_angular_speed_modulation_rule() {
        // Règle complète : source angvel + listener → canal
        let mut st = KinematicState::default();
        let dt = 1.0 / 60.0;
        for i in 0..120 {
            let t = i as f64 * dt;
            st.update(Vector3::new(2.0 * t.cos(), 2.0 * t.sin(), 0.0), dt, 0.0);
        }
        let mut states = HashMap::new();
        states.insert(0usize, st);
        let rule = ChannelModulation::from_node_params(&serde_json::json!({
            "source": "angvel", "channel": "presence", "listener": [0, 0, 0]
        }))
        .unwrap();
        let out = apply_modulations(&[rule], &states);
        // ω orbital = 1 rad/s → ~57.3°/s (indépendant du rayon)
        let v = out[&0].presence.unwrap();
        assert!((v - 57.30).abs() < 2.0, "presence={v}");
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

    #[test]
    fn test_from_node_params_inverted_bounds_swapped() {
        // min > max : f64::clamp paniquerait — les bornes sont swappées au
        // parsing pour ne pas tuer le merge thread.
        let m = ChannelModulation::from_node_params(&serde_json::json!({
            "source": "speed", "channel": "spread", "min": 5.0, "max": -5.0
        }))
        .unwrap();
        assert_eq!(m.min, -5.0);
        assert_eq!(m.max, 5.0);
    }

    #[test]
    fn test_apply_modulations_inverted_bounds_no_panic() {
        // Règle construite directement (pas via from_node_params) avec
        // min > max — ne doit pas paniquer dans le chemin apply.
        let mut states = HashMap::new();
        let mut st = KinematicState::default();
        st.speed = 10.0;
        states.insert(0usize, st);
        let mut rule = ChannelModulation::new(KinematicSource::Speed, SpatialChannel::Gain, 1.0);
        rule.min = 6.0;
        rule.max = -12.0; // inversé
        let out = apply_modulations(&[rule], &states);
        // bornes swappées → clamp(10, -12, 6) = 6
        assert_eq!(out[&0].gain, Some(6.0));
    }

    #[test]
    fn test_apply_modulations_non_finite_value_skipped() {
        // scale infini → valeur non-finie → canal non émis (pas de NaN en OSC)
        let mut states = HashMap::new();
        let mut st = KinematicState::default();
        st.speed = 1.0;
        states.insert(0usize, st);
        let mut rule = ChannelModulation::new(
            KinematicSource::Speed,
            SpatialChannel::Spread,
            f64::INFINITY,
        );
        rule.offset = 0.0;
        let out = apply_modulations(&[rule], &states);
        assert!(out.get(&0).is_none_or(|c| c.spread.is_none()));
    }
}
