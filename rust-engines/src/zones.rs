//! Zones — régions de l'espace qui modulent les canaux spatiaux des objets
//! qui s'y trouvent (P4 — SFFX contrôle-side : l'effet suit la position).
//!
//! Une [`Zone`] définit une forme (sphère ou boîte), une liste de canaux
//! cibles, et une largeur de transition (`falloff`). L'influence ∈ [0,1]
//! est lissée par smoothstep au-delà du bord ; la valeur émise est
//! `lerp(base, zone_value, influence)` où `base` est la valeur courante
//! (statique ou modulée cinématiquement) ou le neutre du canal si absente.
//!
//! Évalué dans le merge thread après les modulations cinématiques, sur les
//! positions finales — comme P2, les zones réagissent au mouvement réellement
//! envoyé au renderer (post-merge, post-macros).

use crate::osc_sender::{SpatialChannel, SpatialChannels};
use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Forme d'une zone d'effet spatial
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(tag = "shape", rename_all = "snake_case")]
#[ts(export)]
pub enum ZoneShape {
    /// Sphère : centre + rayon
    Sphere { center: [f64; 3], radius: f64 },
    /// Boîte alignée sur les axes : coins min/max
    Box { min: [f64; 3], max: [f64; 3] },
}

impl ZoneShape {
    /// Distance signée au bord : < 0 à l'intérieur, 0 au bord, > 0 dehors.
    /// SDF standard pour la boîte (pénétration négative à l'intérieur).
    pub fn signed_distance(&self, p: &Vector3<f64>) -> f64 {
        match self {
            ZoneShape::Sphere { center, radius } => {
                let c = Vector3::new(center[0], center[1], center[2]);
                (p - c).norm() - radius
            }
            ZoneShape::Box { min, max } => {
                let c = Vector3::new(
                    (min[0] + max[0]) / 2.0,
                    (min[1] + max[1]) / 2.0,
                    (min[2] + max[2]) / 2.0,
                );
                let h = Vector3::new(
                    (max[0] - min[0]) / 2.0,
                    (max[1] - min[1]) / 2.0,
                    (max[2] - min[2]) / 2.0,
                );
                let q = (p - c).abs() - h;
                let outside = Vector3::new(q.x.max(0.0), q.y.max(0.0), q.z.max(0.0)).norm();
                outside + q.x.max(q.y).max(q.z).min(0.0)
            }
        }
    }
}

/// Zone d'effet spatial : à l'intérieur, les canaux listés sont tirés vers
/// leurs valeurs cibles proportionnellement à l'influence.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Zone {
    /// Forme de la zone
    pub shape: ZoneShape,
    /// Largeur de la transition en unités scène au-delà du bord (0 = bord franc)
    pub falloff: f64,
    /// Canaux cibles à pleine influence
    pub channels: SpatialChannels,
    /// Objets concernés — `None` = tous. Une liste vide (`Some([])`)
    /// équivaut à `None` : "aucun objet listé" s'applique à tous —
    /// éviter qu'une liste vide ne désactive silencieusement la zone.
    pub objects: Option<Vec<usize>>,
    /// Zone active
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Valeur neutre d'un canal quand aucune base (statique/modulée) n'existe —
/// le blend part de là. Tous les canaux neutres à 0.0 : `gain` est une
/// échelle en dB (0 dB = unité) — une base à 1.0 biaisait chaque blend
/// de +1 dB.
fn neutral(_channel: SpatialChannel) -> f64 {
    0.0
}

impl Zone {
    /// Influence de la zone sur une position : 1 à l'intérieur, décroissance
    /// smoothstep sur `falloff` unités au-delà du bord, 0 ensuite.
    pub fn influence(&self, pos: &Vector3<f64>) -> f64 {
        let d = self.shape.signed_distance(pos);
        if self.falloff <= 0.0 {
            return if d <= 0.0 { 1.0 } else { 0.0 };
        }
        1.0 - smoothstep(d / self.falloff)
    }

    /// Vrai si la zone s'applique à cet objet.
    /// `objects: Some([])` est traité comme `None` (tous les objets).
    pub fn applies_to(&self, obj: usize) -> bool {
        self.enabled
            && self
                .objects
                .as_ref()
                .is_none_or(|o| o.is_empty() || o.contains(&obj))
    }

    /// Construit une Zone depuis les params d'un node graphe :
    /// `{shape, center|min+max, radius, falloff, channels, objects, enabled}`.
    /// Les champs acceptent les valeurs JSON ou les strings de l'éditeur
    /// (`channels` : objet ou `"gain=0,spread=1"` ; `objects` : array ou
    /// `"0,2,4"` ; vec3 : array ou `"x,y,z"`).
    pub fn from_node_params(params: &serde_json::Value) -> Result<Self, String> {
        use crate::node_params as np;
        use std::str::FromStr;
        let shape_str = params
            .get("shape")
            .and_then(|v| v.as_str())
            .unwrap_or("sphere")
            .to_lowercase();
        let shape = match shape_str.as_str() {
            "sphere" => ZoneShape::Sphere {
                center: params
                    .get("center")
                    .and_then(np::flex_vec3)
                    .unwrap_or([0.0, 0.0, 0.0]),
                radius: np::param_f64_or(params, "radius", 1.0),
            },
            "box" => ZoneShape::Box {
                min: params
                    .get("min")
                    .and_then(np::flex_vec3)
                    .ok_or("Zone box requires 'min' [x,y,z]")?,
                max: params
                    .get("max")
                    .and_then(np::flex_vec3)
                    .ok_or("Zone box requires 'max' [x,y,z]")?,
            },
            s => return Err(format!("Unknown zone shape '{s}' (sphere|box)")),
        };
        let mut channels = SpatialChannels::default();
        for (name, v) in params
            .get("channels")
            .map(np::flex_f64_map)
            .unwrap_or_default()
        {
            channels.set(SpatialChannel::from_str(&name)?, v);
        }
        if channels.is_empty() {
            return Err("Zone requires at least one channel".to_string());
        }
        Ok(Zone {
            shape,
            falloff: np::param_f64_or(params, "falloff", 0.0).max(0.0),
            channels,
            objects: params.get("objects").and_then(np::flex_usize_list),
            enabled: params
                .get("enabled")
                .and_then(np::flex_bool)
                .unwrap_or(true),
        })
    }
}

/// Applique toutes les zones sur les canaux effectifs d'un objet.
/// Chaque zone blend `effective[ch] = lerp(base_ou_neutre, zone[ch], influence)`.
/// Les zones s'appliquent dans l'ordre de la liste (composables).
pub fn apply_zones(
    zones: &[Zone],
    obj: usize,
    pos: &Vector3<f64>,
    effective: &mut SpatialChannels,
) {
    for zone in zones {
        if !zone.applies_to(obj) {
            continue;
        }
        let influence = zone.influence(pos);
        if influence <= 0.0 {
            continue;
        }
        for (ch, zone_value) in zone.channels.iter() {
            let base = effective.get(ch).unwrap_or_else(|| neutral(ch));
            effective.set(ch, base * (1.0 - influence) + zone_value * influence);
        }
    }
}

/// Vrai si au moins une zone active pourrait produire un canal pour cet objet
/// (utilisé pour éviter de créer un SpatialChannels vide inutilement)
pub fn any_zone_applies(zones: &[Zone], obj: usize, pos: &Vector3<f64>) -> bool {
    zones
        .iter()
        .any(|z| z.applies_to(obj) && z.influence(pos) > 0.0 && !z.channels.is_empty())
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    fn sphere_zone(radius: f64, falloff: f64, gain: f64) -> Zone {
        let mut channels = SpatialChannels::default();
        channels.gain = Some(gain);
        Zone {
            shape: ZoneShape::Sphere {
                center: [0.0, 0.0, 0.0],
                radius,
            },
            falloff,
            channels,
            objects: None,
            enabled: true,
        }
    }

    #[test]
    fn test_sphere_influence_inside() {
        let z = sphere_zone(2.0, 0.5, 0.0);
        assert_eq!(z.influence(&Vector3::new(0.0, 0.0, 0.0)), 1.0);
        assert_eq!(z.influence(&Vector3::new(2.0, 0.0, 0.0)), 1.0); // au bord
    }

    #[test]
    fn test_sphere_influence_falloff() {
        let z = sphere_zone(2.0, 1.0, 0.0);
        // À mi-falloff (d = 0.5 → t = 0.5) : smoothstep(0.5) = 0.5 → influence 0.5
        let inf = z.influence(&Vector3::new(2.5, 0.0, 0.0));
        assert!((inf - 0.5).abs() < 1e-9, "influence={inf}");
        // Au-delà du falloff : 0
        assert_eq!(z.influence(&Vector3::new(3.0, 0.0, 0.0)), 0.0);
    }

    #[test]
    fn test_box_signed_distance() {
        let s = ZoneShape::Box {
            min: [-1.0, -1.0, -1.0],
            max: [1.0, 1.0, 1.0],
        };
        assert_eq!(s.signed_distance(&Vector3::new(0.0, 0.0, 0.0)), -1.0);
        assert_eq!(s.signed_distance(&Vector3::new(1.0, 0.0, 0.0)), 0.0);
        assert!((s.signed_distance(&Vector3::new(2.0, 0.0, 0.0)) - 1.0).abs() < 1e-9);
        // Coin : distance euclidienne
        let d = s.signed_distance(&Vector3::new(2.0, 2.0, 0.0));
        assert!((d - std::f64::consts::SQRT_2).abs() < 1e-9, "d={d}");
    }

    #[test]
    fn test_apply_zones_blends_toward_zone_value() {
        // Zone gain=0 — objet dedans → gain 0 ; dehors → rien émis
        let z = sphere_zone(2.0, 0.0, 0.0);
        let mut eff = SpatialChannels::default();
        apply_zones(&[z.clone()], 0, &Vector3::new(1.0, 0.0, 0.0), &mut eff);
        assert_eq!(eff.gain, Some(0.0));
        let mut eff2 = SpatialChannels::default();
        apply_zones(&[z], 0, &Vector3::new(5.0, 0.0, 0.0), &mut eff2);
        assert!(eff2.gain.is_none());
    }

    #[test]
    fn test_apply_zones_blends_with_base() {
        // Base statique gain=1.0, zone gain=0, influence 0.5 → 0.5
        let z = sphere_zone(2.0, 1.0, 0.0);
        let mut eff = SpatialChannels::default();
        eff.gain = Some(1.0);
        apply_zones(&[z], 0, &Vector3::new(2.5, 0.0, 0.0), &mut eff);
        assert!((eff.gain.unwrap() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_zone_object_filter() {
        let mut z = sphere_zone(2.0, 0.0, 0.0);
        z.objects = Some(vec![1, 2]);
        assert!(z.applies_to(1));
        assert!(!z.applies_to(0));
    }

    #[test]
    fn test_zone_disabled() {
        let mut z = sphere_zone(2.0, 0.0, 0.0);
        z.enabled = false;
        assert!(!z.applies_to(0));
        let mut eff = SpatialChannels::default();
        apply_zones(&[z], 0, &Vector3::new(0.0, 0.0, 0.0), &mut eff);
        assert!(eff.is_empty());
    }

    #[test]
    fn test_multiple_zones_compose() {
        // Deux zones qui se chevauchent : chaque blend s'applique en séquence
        let z1 = sphere_zone(3.0, 0.0, 0.0); // gain→0 dans r=3
        let mut ch2 = SpatialChannels::default();
        ch2.spread = Some(1.0);
        let z2 = Zone {
            shape: ZoneShape::Sphere {
                center: [0.0, 0.0, 0.0],
                radius: 1.0,
            },
            falloff: 0.0,
            channels: ch2,
            objects: None,
            enabled: true,
        };
        let mut eff = SpatialChannels::default();
        apply_zones(&[z1, z2], 0, &Vector3::new(0.0, 0.0, 0.0), &mut eff);
        assert_eq!(eff.gain, Some(0.0)); // z1
        assert_eq!(eff.spread, Some(1.0)); // z2
    }

    #[test]
    fn test_any_zone_applies() {
        let z = sphere_zone(1.0, 0.0, 0.5);
        assert!(any_zone_applies(
            &[z.clone()],
            0,
            &Vector3::new(0.0, 0.0, 0.0)
        ));
        assert!(!any_zone_applies(&[z], 0, &Vector3::new(9.0, 0.0, 0.0)));
    }

    #[test]
    fn test_from_node_params_sphere_json() {
        let z = Zone::from_node_params(&serde_json::json!({
            "shape": "sphere", "center": [1, 0, 0], "radius": 2.5,
            "falloff": 0.5, "channels": {"gain": 0.0, "spread": 1.0}
        }))
        .unwrap();
        match z.shape {
            ZoneShape::Sphere { center, radius } => {
                assert_eq!(center, [1.0, 0.0, 0.0]);
                assert_eq!(radius, 2.5);
            }
            _ => panic!("expected sphere"),
        }
        assert_eq!(z.channels.gain, Some(0.0));
        assert_eq!(z.channels.spread, Some(1.0));
        assert_eq!(z.falloff, 0.5);
        assert!(z.enabled);
        assert!(z.objects.is_none());
    }

    #[test]
    fn test_from_node_params_string_forms() {
        // Les champs texte de l'éditeur arrivent en string — le parse est tolérant.
        let z = Zone::from_node_params(&serde_json::json!({
            "shape": "box", "min": "-1,-1,-1", "max": "[1,1,1]",
            "channels": "gain=0,spread=1", "objects": "0,2,4",
            "falloff": "0.25", "enabled": "true"
        }))
        .unwrap();
        match z.shape {
            ZoneShape::Box { min, max } => {
                assert_eq!(min, [-1.0, -1.0, -1.0]);
                assert_eq!(max, [1.0, 1.0, 1.0]);
            }
            _ => panic!("expected box"),
        }
        assert_eq!(z.objects, Some(vec![0, 2, 4]));
        assert_eq!(z.falloff, 0.25);
        assert_eq!(z.channels.gain, Some(0.0));
    }

    #[test]
    fn test_from_node_params_errors() {
        // Pas de channels → erreur
        assert!(Zone::from_node_params(&serde_json::json!({"shape": "sphere"})).is_err());
        // Shape inconnue → erreur
        assert!(Zone::from_node_params(&serde_json::json!({
            "shape": "cone", "channels": {"gain": 0}
        }))
        .is_err());
        // Canal inconnu → erreur
        assert!(Zone::from_node_params(&serde_json::json!({
            "channels": {"bogus": 0}
        }))
        .is_err());
        // Box sans min/max → erreur
        assert!(Zone::from_node_params(&serde_json::json!({
            "shape": "box", "channels": {"gain": 0}
        }))
        .is_err());
    }

    #[test]
    fn test_gain_neutral_is_zero_db() {
        // Le gain est en dB : sans base, le blend part de 0 dB (pas 1.0 —
        // une base à 1.0 biaisait chaque blend de +1 dB).
        // Zone gain=-6, influence 0.5, pas de base → lerp(0, -6, 0.5) = -3
        let z = sphere_zone(2.0, 1.0, -6.0);
        let mut eff = SpatialChannels::default();
        apply_zones(&[z], 0, &Vector3::new(2.5, 0.0, 0.0), &mut eff);
        assert!(
            (eff.gain.unwrap() - (-3.0)).abs() < 1e-9,
            "gain={:?}",
            eff.gain
        );
    }

    #[test]
    fn test_empty_objects_list_means_all() {
        // Some([]) ≡ None : une liste vide doit s'appliquer à tous les objets
        // (sinon la zone est silencieusement morte).
        let mut z = sphere_zone(2.0, 0.0, 0.0);
        z.objects = Some(vec![]);
        assert!(z.applies_to(0));
        assert!(z.applies_to(42));
        let mut eff = SpatialChannels::default();
        apply_zones(&[z], 7, &Vector3::new(0.0, 0.0, 0.0), &mut eff);
        assert_eq!(eff.gain, Some(0.0));
    }
}
