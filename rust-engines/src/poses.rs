//! Poses — presets de positions nommés (design : docs/position-presets-design.md).
//!
//! Une pose est une photographie partielle de positions par **track_id**
//! (l'identité opérateur — survit au remapping OSC, règle namespace).
//! Partielle par nature : seules les tracks renseignées sont concernées
//! par les recalls. Stockage backend (`AppState`), persisté dans la
//! section `poses` de l'enveloppe .hfg.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

/// Map à clés track_id (u32) — JSON ne porte que des clés string :
/// même pattern de désérialisation que `cuelist::manual_positions`
/// (robustesse enum taggée — serde perd la coercion native des clés
/// numériques quand le type transite par un `Content` bufferisé).
fn de_track_key_map<'de, D, V>(deserializer: D) -> Result<HashMap<u32, V>, D::Error>
where
    D: serde::Deserializer<'de>,
    V: Deserialize<'de>,
{
    let raw = HashMap::<String, V>::deserialize(deserializer)?;
    raw.into_iter()
        .map(|(k, v)| {
            k.parse::<u32>()
                .map(|kk| (kk, v))
                .map_err(serde::de::Error::custom)
        })
        .collect()
}

/// Pose — preset de positions nommé.
///
/// `positions` : track_id → position **canonique** [x, y, z] (espace
/// pré-postprocess — même espace que les ancres, trackpos et positions
/// manuelles ; les macros s'appliquent à l'émission comme partout).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Pose {
    /// Nom unique — identité de la pose (clé de la map backend, adressage
    /// OSC `/stagespace/pose/* <name>`). Renommer = supprimer + recréer.
    pub name: String,
    /// Positions par track_id — partiel par nature.
    #[serde(default, deserialize_with = "de_track_key_map")]
    #[ts(type = "Record<number, [number, number, number]>")]
    pub positions: HashMap<u32, [f64; 3]>,
}

/// Résolveur de références de poses — construit par le chemin de spawn
/// (qui connaît le mapping track↔objet du move et les positions live),
/// injecté au compile via `LiveInputs.pose_resolver`. La résolution est
/// un **snapshot au compile** : le move joue avec les positions résolues
/// à cet instant — ré-éditer une pose ne modifie pas un move en vol.
///
/// Indexation : les endpoints sont résolus par **index local d'objet**
/// du move (0..n_objects), `track_ids[local]` donnant la track_id
/// opérateur — même convention que la capture d'ancre `Current`.
pub struct PoseResolver {
    /// track_id par index local d'objet du move.
    pub track_ids: Vec<u32>,
    /// Position live capturée au spawn par index local (chaîne
    /// `last_position` complète : canonique → manuelle → trackpos).
    /// `None` = jamais émise, pas de trackpos — vraiment inconnue.
    pub live_positions: Vec<Option<[f64; 3]>>,
    /// Snapshot de la table de poses au spawn.
    pub poses: HashMap<String, Pose>,
    /// Warnings de résolution collectés au compile — lus par le spawn
    /// pour remonter nack OSC / toast UI / preflight score.
    pub warnings: std::sync::Mutex<Vec<String>>,
}

impl PoseResolver {
    /// La pose existe-t-elle dans le snapshot (et non vide) ?
    pub fn pose_exists(&self, name: &str) -> bool {
        self.poses
            .get(name)
            .is_some_and(|p| !p.positions.is_empty())
    }

    /// Résout un endpoint pour un objet local — sans fallback croisé :
    /// `"live"` → position live capturée ; `"pose:<name>"` → position de
    /// la track dans la pose. `None` = non résolvable tel quel.
    fn endpoint(&self, spec: &str, obj: usize) -> Option<[f64; 3]> {
        if spec == "live" {
            return self.live_positions.get(obj).copied().flatten();
        }
        let name = spec.strip_prefix("pose:")?;
        let track = self.track_ids.get(obj)?;
        self.poses.get(name)?.positions.get(track).copied()
    }

    fn warn(&self, msg: String) {
        self.warnings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(msg);
    }

    /// Résout la paire `(from, to)` d'un objet local selon la matrice de
    /// fallback du design (§7) :
    /// - `to` non résoluble → **freeze-in-place** (cible = départ, l'objet
    ///   ne bouge pas mais participe au merge — takeover possible)
    /// - `from` non résoluble (même après fallback live du morph) →
    ///   **appear-at-target** (départ = cible — la seule info honnête)
    /// - morph : track absente de la pose `from` → départ = position live
    ///
    /// Retourne `(from, to)`.
    pub fn resolve_pair(&self, from_spec: &str, to_spec: &str, obj: usize) -> ([f64; 3], [f64; 3]) {
        let track = self.track_ids.get(obj).copied().unwrap_or(0);
        let live = self.live_positions.get(obj).copied().flatten();
        let raw_to = self.endpoint(to_spec, obj);
        // `from` : résolution du spec, puis fallback live pour le morph
        // (track dans B mais pas dans A → départ live). Pour from="live"
        // endpoint() EST déjà le live — l'or() est idempotent.
        let from_candidate = self.endpoint(from_spec, obj).or(live);

        let to = match raw_to {
            Some(t) => t,
            None => match from_candidate {
                Some(f) => {
                    self.warn(format!(
                        "poseramp obj {obj} (track {track}) : absent de la cible '{to_spec}' — freeze-in-place"
                    ));
                    f
                }
                None => {
                    // Coin pathologique : absent de la cible ET aucune
                    // position connue (slot hand-authored sur objet jamais
                    // positionné). Impossible via pose_goto (distribution
                    // pré-filtrée). Loud warning — jamais silencieux.
                    self.warn(format!(
                        "poseramp obj {obj} (track {track}) : ni cible ni position connue — figé à l'origine"
                    ));
                    [0.0, 0.0, 0.0]
                }
            },
        };
        let from = match from_candidate {
            Some(f) => f,
            None => {
                self.warn(format!(
                    "poseramp obj {obj} (track {track}) : pas de position de départ — appear-at-target"
                ));
                to
            }
        };
        (from, to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pose_json_roundtrip() {
        let mut positions = HashMap::new();
        positions.insert(1u32, [2.0, 1.5, 0.0]);
        positions.insert(3u32, [-2.5, 2.0, 0.0]);
        let pose = Pose {
            name: "line-up".to_string(),
            positions,
        };
        let json = serde_json::to_string(&pose).unwrap();
        let decoded: Pose = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.name, "line-up");
        assert_eq!(decoded.positions.get(&1), Some(&[2.0, 1.5, 0.0]));
        assert_eq!(decoded.positions.get(&3), Some(&[-2.5, 2.0, 0.0]));
        assert_eq!(decoded.positions.len(), 2);
    }

    fn resolver_fixture() -> PoseResolver {
        let mut positions = HashMap::new();
        positions.insert(1u32, [1.0, 0.0, 0.0]);
        positions.insert(2u32, [2.0, 0.0, 0.0]);
        let mut poses = HashMap::new();
        poses.insert(
            "line-up".to_string(),
            Pose {
                name: "line-up".to_string(),
                positions,
            },
        );
        PoseResolver {
            track_ids: vec![1, 2, 3],
            live_positions: vec![Some([9.0, 9.0, 9.0]), None, Some([5.0, 5.0, 5.0])],
            poses,
            warnings: std::sync::Mutex::new(Vec::new()),
        }
    }

    #[test]
    fn resolver_nominal() {
        let r = resolver_fixture();
        let (from, to) = r.resolve_pair("live", "pose:line-up", 0);
        assert_eq!(from, [9.0, 9.0, 9.0]); // live capturé
        assert_eq!(to, [1.0, 0.0, 0.0]); // pose
        assert!(r.warnings.lock().unwrap().is_empty());
    }

    #[test]
    fn resolver_freeze_in_place() {
        // obj 1 (track 2) EST dans la pose ; obj 2 (track 3) n'y est pas
        // → freeze-in-place : cible = départ.
        let r = resolver_fixture();
        let (from, to) = r.resolve_pair("live", "pose:line-up", 2);
        assert_eq!(from, [5.0, 5.0, 5.0]);
        assert_eq!(to, [5.0, 5.0, 5.0], "freeze-in-place : to == from");
        assert_eq!(r.warnings.lock().unwrap().len(), 1);
    }

    #[test]
    fn resolver_appear_at_target() {
        // obj 1 (track 2) : pas de position live → départ = cible.
        let r = resolver_fixture();
        let (from, to) = r.resolve_pair("live", "pose:line-up", 1);
        assert_eq!(to, [2.0, 0.0, 0.0]);
        assert_eq!(from, to, "appear-at-target : from == to");
    }

    #[test]
    fn resolver_morph_fallback_live() {
        // morph from pose:A — track absente de A → départ = live.
        let r = resolver_fixture();
        let (from, _to) = r.resolve_pair("pose:line-up", "pose:line-up", 2);
        assert_eq!(from, [5.0, 5.0, 5.0], "morph : track hors de from → live");
    }

    #[test]
    fn resolver_both_unknown_corner() {
        // Coin pathologique : ni cible ni position connue — warning loud.
        let r = resolver_fixture();
        let mut r2 = resolver_fixture();
        r2.live_positions = vec![None, None, None];
        let (from, to) = r2.resolve_pair("live", "pose:inexistante-x", 2);
        assert_eq!(from, [0.0, 0.0, 0.0]);
        assert_eq!(to, [0.0, 0.0, 0.0]);
        assert!(!r2.warnings.lock().unwrap().is_empty());
        let _ = r;
    }

    #[test]
    fn pose_positions_absentes_par_defaut() {
        // Une pose sans champ positions (json partiel) = vide, pas une erreur.
        let decoded: Pose = serde_json::from_str(r#"{"name":"x"}"#).unwrap();
        assert!(decoded.positions.is_empty());
    }
}
