//! Parser partagé pour les fichiers projet Holophonix (`.hol`).
//!
//! Format : `{"hol": {"ae": ["/track/{id}/{param} {value}", ...]}}` —
//! un array de strings au format OSC plat. Certains exports exposent `ae`
//! directement à la racine.
//!
//! Convention AED → XYZ (identique pour le backend Tauri et le CLI) :
//! `azim = 0` ⇒ front (+Y), `azim > 0` horaire (vers +X), `elev` = hauteur (+Z).
//! ```text
//! x = dist · cos(elev) · sin(azim)
//! y = dist · cos(elev) · cos(azim)
//! z = dist · sin(elev)
//! ```
//! Les tracks qui portent déjà `xyz` (ou `x`/`y`/`z` séparés) gardent ces
//! valeurs — AED n'est utilisé qu'en fallback.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// Une track importée d'un projet .hol
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HolTrack {
    pub id: u32,
    pub name: String,
    pub position: [f64; 3],
    pub color: String,
}

/// Conversion AED (degrés, mètres) → XYZ selon la convention Holophonix.
pub fn aed_to_xyz(azim_deg: f64, elev_deg: f64, dist: f64) -> [f64; 3] {
    let azim = azim_deg.to_radians();
    let elev = elev_deg.to_radians();
    [
        dist * elev.cos() * azim.sin(),
        dist * elev.cos() * azim.cos(),
        dist * elev.sin(),
    ]
}

/// État d'accumulation par track pendant le parse des lignes OSC.
#[derive(Default)]
struct TrackAcc {
    name: Option<String>,
    color: Option<String>,
    azim: Option<f64>,
    elev: Option<f64>,
    dist: Option<f64>,
    xyz: Option<[f64; 3]>,
}

/// Parse le contenu d'un fichier `.hol` → tracks triées par id croissant.
pub fn parse_hol_project(content: &str) -> Result<Vec<HolTrack>, String> {
    parse_hol_project_with_warnings(content).map(|(tracks, _)| tracks)
}

/// Parse + diagnostics : les données malformées sont droppées mais RAPPORTÉES
/// (ligne + raison) — un `dist` typo déplaçait la source à front-1m en silence.
/// Les params inconnus sont dédupliqués dans un warning agrégé.
pub fn parse_hol_project_with_warnings(
    content: &str,
) -> Result<(Vec<HolTrack>, Vec<String>), String> {
    let project: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("Failed to parse JSON: {e}"))?;

    // L'array "ae" peut être sous hol.ae ou directement à la racine.
    let ae_array = project["hol"]["ae"]
        .as_array()
        .or_else(|| project["ae"].as_array())
        .ok_or_else(|| "No 'ae' array found in .hol file".to_string())?;

    let mut acc: HashMap<u32, TrackAcc> = HashMap::new();
    let mut track_ids: BTreeSet<u32> = BTreeSet::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut unknown_params: BTreeSet<String> = BTreeSet::new();

    for (line_idx, item) in ae_array.iter().enumerate() {
        let Some(line) = item.as_str() else {
            warnings.push(format!("line {}: non-string entry skipped", line_idx + 1));
            continue;
        };
        if !line.starts_with("/track/") {
            continue;
        }
        // "/track/{id}/{param} {value}" → ["", "track", "{id}", "{param} {value}"]
        let parts: Vec<&str> = line.splitn(4, '/').collect();
        if parts.len() < 4 {
            warnings.push(format!(
                "line {}: malformed track path '{line}'",
                line_idx + 1
            ));
            continue;
        }
        let Ok(id) = parts[2].parse::<u32>() else {
            warnings.push(format!(
                "line {}: invalid track id '{}' in '{line}'",
                line_idx + 1,
                parts[2]
            ));
            continue;
        };
        track_ids.insert(id);
        let rest = parts[3];
        let (param, value) = match rest.split_once(' ') {
            Some((p, v)) => (p, v.trim()),
            None => (rest.trim(), ""),
        };
        let entry = acc.entry(id).or_default();

        match param {
            "name" => {
                entry.name = Some(value.trim_matches('"').to_string());
            }
            "color" => {
                // Deux formats vus dans le wild : "#RRGGBB" (string) ou
                // "r g b a" (floats 0-1 séparés par des espaces).
                let v = value.trim_matches('"');
                if v.starts_with('#') {
                    entry.color = Some(v.to_string());
                } else {
                    let comps: Vec<f64> = v
                        .split_whitespace()
                        .filter_map(|s| s.parse().ok())
                        .collect();
                    if comps.len() >= 3 {
                        let r = (comps[0].clamp(0.0, 1.0) * 255.0) as u8;
                        let g = (comps[1].clamp(0.0, 1.0) * 255.0) as u8;
                        let b = (comps[2].clamp(0.0, 1.0) * 255.0) as u8;
                        entry.color = Some(format!("#{r:02x}{g:02x}{b:02x}"));
                    } else {
                        warnings.push(format!(
                            "line {}: track {id} unparseable color '{v}'",
                            line_idx + 1
                        ));
                    }
                }
            }
            "azim" | "elev" | "dist" => match value.parse::<f64>() {
                Ok(v) => match param {
                    "azim" => entry.azim = Some(v),
                    "elev" => entry.elev = Some(v),
                    _ => entry.dist = Some(v),
                },
                Err(_) => warnings.push(format!(
                    "line {}: track {id} invalid {param} value '{value}'",
                    line_idx + 1
                )),
            },
            "xyz" | "aed" => {
                // Format combiné : "x y z" ou "a e d" (aussi comma-separated)
                let comps: Vec<f64> = value
                    .trim_matches('"')
                    .split(|c: char| c.is_whitespace() || c == ',')
                    .filter(|s| !s.is_empty())
                    .filter_map(|s| s.parse().ok())
                    .collect();
                if comps.len() >= 3 {
                    if param == "xyz" {
                        entry.xyz = Some([comps[0], comps[1], comps[2]]);
                    } else {
                        // aed combiné → conversion immédiate en xyz
                        entry.xyz = Some(aed_to_xyz(comps[0], comps[1], comps[2]));
                    }
                } else {
                    warnings.push(format!(
                        "line {}: track {id} invalid {param} value '{value}'",
                        line_idx + 1
                    ));
                }
            }
            // Axes séparés (certains exports Holophonix)
            "x" | "y" | "z" => match value.parse::<f64>() {
                Ok(v) => {
                    let xyz = entry.xyz.get_or_insert([0.0, 0.0, 0.0]);
                    let axis = match param {
                        "x" => 0,
                        "y" => 1,
                        _ => 2,
                    };
                    xyz[axis] = v;
                }
                Err(_) => warnings.push(format!(
                    "line {}: track {id} invalid {param} value '{value}'",
                    line_idx + 1
                )),
            },
            _ => {
                unknown_params.insert(param.to_string());
            }
        }
    }

    if track_ids.is_empty() {
        return Err("No tracks found in .hol file".to_string());
    }

    if !unknown_params.is_empty() {
        warnings.push(format!(
            "unrecognized track params ignored: {}",
            unknown_params.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }

    let tracks = track_ids
        .iter()
        .map(|id| {
            let a = acc.get(id);
            let name = a
                .and_then(|a| a.name.clone())
                .unwrap_or_else(|| format!("Track {id}"));
            let color = a
                .and_then(|a| a.color.clone())
                .unwrap_or_else(|| "#888888".to_string());
            let has_position = a.and_then(|a| a.xyz).is_some() || a.and_then(|a| a.dist).is_some();
            if !has_position {
                warnings.push(format!(
                    "track {id}: no position data — defaulted to front (0,1,0)"
                ));
            }
            let position = match a.and_then(|a| a.xyz) {
                Some(xyz) => xyz,
                None => aed_to_xyz(
                    a.and_then(|a| a.azim).unwrap_or(0.0),
                    a.and_then(|a| a.elev).unwrap_or(0.0),
                    a.and_then(|a| a.dist).unwrap_or(1.0),
                ),
            };
            HolTrack {
                id: *id,
                name,
                position,
                color,
            }
        })
        .collect();

    Ok((tracks, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r##"{
        "hol": {
            "ae": [
                "/track/1/name \"Lead Vocal\"",
                "/track/1/color \"#FF4444\"",
                "/track/1/azim 45.0",
                "/track/1/elev 0.0",
                "/track/1/dist 1.5",
                "/track/5/name \"Bass\"",
                "/track/5/azim 0.0",
                "/track/5/elev -15.0",
                "/track/5/dist 2.0"
            ]
        }
    }"##;

    #[test]
    fn test_parse_fixture_aed() {
        let tracks = parse_hol_project(FIXTURE).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].id, 1);
        assert_eq!(tracks[0].name, "Lead Vocal");
        assert_eq!(tracks[0].color, "#FF4444");

        // Track 1 : azim=45°, elev=0, dist=1.5 → x=y=1.5·sin(45°)≈1.0607, z=0
        let p = tracks[0].position;
        assert!((p[0] - 1.0607).abs() < 1e-3, "x={}", p[0]);
        assert!((p[1] - 1.0607).abs() < 1e-3, "y={}", p[1]);
        assert!(p[2].abs() < 1e-9, "z={}", p[2]);

        // Track 5 : azim=0 ⇒ front → x=0, y=dist·cos(elev), z=dist·sin(elev)
        // C'est le discriminant du bug sin/cos swappé de l'ancien parser CLI.
        let p5 = tracks[1].position;
        assert!(p5[0].abs() < 1e-9, "x={}", p5[0]);
        assert!((p5[1] - 2.0 * (15f64.to_radians().cos())).abs() < 1e-3);
        assert!((p5[2] + 2.0 * (15f64.to_radians().sin())).abs() < 1e-3);
    }

    #[test]
    fn test_xyz_param_wins_over_aed() {
        let content = r#"{"hol": {"ae": [
            "/track/1/xyz 1.0 2.0 3.0",
            "/track/1/azim 45.0",
            "/track/2/x -1.5",
            "/track/2/y 0.5"
        ]}}"#;
        let tracks = parse_hol_project(content).unwrap();
        assert_eq!(tracks[0].position, [1.0, 2.0, 3.0]);
        assert_eq!(tracks[1].position, [-1.5, 0.5, 0.0]);
    }

    #[test]
    fn test_color_float_format() {
        let content = r#"{"ae": ["/track/1/color 1.0 0.5 0.0 1.0"]}"#;
        let tracks = parse_hol_project(content).unwrap();
        assert_eq!(tracks[0].color, "#ff7f00");
    }

    #[test]
    fn test_empty_file_errors() {
        assert!(parse_hol_project("{}").is_err());
        assert!(parse_hol_project("not json").is_err());
        assert!(parse_hol_project(r#"{"hol": {"ae": []}}"#).is_err());
    }

    #[test]
    fn test_defaults() {
        // Track sans name/color/azim → defaults sains
        let content = r#"{"hol": {"ae": ["/track/3/dist 2.0"]}}"#;
        let tracks = parse_hol_project(content).unwrap();
        assert_eq!(tracks[0].name, "Track 3");
        assert_eq!(tracks[0].color, "#888888");
        // azim=0 elev=0 dist=2 → front à 2m
        assert!((tracks[0].position[1] - 2.0).abs() < 1e-9);
    }
}
