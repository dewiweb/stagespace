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

    #[test]
    fn pose_positions_absentes_par_defaut() {
        // Une pose sans champ positions (json partiel) = vide, pas une erreur.
        let decoded: Pose = serde_json::from_str(r#"{"name":"x"}"#).unwrap();
        assert!(decoded.positions.is_empty());
    }
}
