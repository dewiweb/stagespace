//! Fonctions utilitaires pour le MergeRuntime : merge de positions et post-process par défaut

use crate::runtime::{PostProcessContext, PostProcessFn};
use std::collections::HashMap;

use super::move_state::MergeStrategy;

/// Type alias for a single move's positions entry:
/// (move_id, fade, weight, priority, positions per object_index).
/// Le fade effectif utilisé par les stratégies est `fade × weight`.
pub type MoveEntry = (String, f64, f64, u32, Vec<(usize, nalgebra::Vector3<f64>)>);

/// Merge les positions de plusieurs moves selon la stratégie choisie.
///
/// Déterminisme : les candidats de chaque track sont triés par move_id avant
/// résolution — le résultat ne dépend ni de l'ordre de `move_positions` ni de
/// l'ordre d'itération d'une HashMap. Les égalités (même fade / même priorité)
/// sont départagées par move_id lexicographique (le plus grand gagne).
pub fn merge_positions(
    move_positions: &[MoveEntry],
    strategy: MergeStrategy,
) -> Vec<(usize, nalgebra::Vector3<f64>)> {
    if move_positions.is_empty() {
        // Pas de moves actifs : ne rien envoyer (ni OSC, ni positions).
        // Le 3D view garde les positions manuelles via useObjects3D.
        // Évite d'envoyer 64 positions zero en OSC à 60 FPS.
        return Vec::new();
    }

    // Si un seul move, pas de merge nécessaire
    if move_positions.len() == 1 {
        return move_positions[0].4.clone();
    }

    // Collecter toutes les positions par object_index, avec
    // (fade effectif = fade × weight, priority, move_id, pos)
    type Candidates<'a> = Vec<(f64, u32, &'a str, nalgebra::Vector3<f64>)>;
    let mut positions_by_index: HashMap<usize, Candidates<'_>> = HashMap::new();
    for (move_id, fade, weight, priority, positions) in move_positions {
        let effective_fade = fade * weight;
        for (idx, pos) in positions {
            positions_by_index.entry(*idx).or_default().push((
                effective_fade,
                *priority,
                move_id.as_str(),
                *pos,
            ));
        }
    }

    // Trier les candidats par move_id : ordre de sommation et tie-breaks
    // reproductibles quelle que soit l'ordre d'entrée / de la HashMap source.
    for candidates in positions_by_index.values_mut() {
        candidates.sort_unstable_by(|a, b| a.2.cmp(b.2));
    }

    // Résoudre selon la stratégie.
    // IMPORTANT: on itère sur les indices réels présents dans positions_by_index
    // (qui sont les track_indices globaux), PAS sur 0..n_objects.
    // Les track_indices peuvent être non-contigus (ex: [1, 3, 4, 5, 6, 8]).
    let mut all_indices: Vec<usize> = positions_by_index.keys().copied().collect();
    all_indices.sort_unstable();
    all_indices
        .into_iter()
        .map(|obj_idx| {
            let candidates = positions_by_index.get(&obj_idx);
            let pos = match (strategy, candidates) {
                (_, None) => nalgebra::Vector3::zeros(),
                (_, Some(c)) if c.is_empty() => nalgebra::Vector3::zeros(),
                // Override : prendre la position avec le fade le plus élevé.
                // Tie-break déterministe : move_id le plus grand.
                (MergeStrategy::Override, Some(c)) => c
                    .iter()
                    .max_by(|a, b| {
                        a.0.partial_cmp(&b.0)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then_with(|| a.2.cmp(b.2))
                    })
                    .map(|(_, _, _, pos)| *pos)
                    .unwrap_or(nalgebra::Vector3::zeros()),
                // Crossfade / Blend : moyenne pondérée par fade.
                // L'ordre des candidats est trié par move_id → somme stable.
                (MergeStrategy::Crossfade, Some(c)) | (MergeStrategy::Blend, Some(c)) => {
                    let total_weight: f64 = c.iter().map(|(f, _, _, _)| f.abs()).sum();
                    if total_weight > 1e-10 {
                        c.iter()
                            .map(|(f, _, _, pos)| pos * (*f / total_weight))
                            .sum()
                    } else {
                        c[0].3
                    }
                }
                // Priority : le move avec la priorité la plus élevée gagne.
                // En cas d'égalité de priorité, on départage par fade le plus élevé
                // (pour que le fade out d'un move cède la place à un move de même
                // priorité), puis par move_id — déterministe entre runs.
                (MergeStrategy::Priority, Some(c)) => c
                    .iter()
                    .max_by(|a, b| {
                        a.1.cmp(&b.1)
                            .then_with(|| {
                                a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
                            })
                            .then_with(|| a.2.cmp(b.2))
                    })
                    .map(|(_, _, _, pos)| *pos)
                    .unwrap_or(nalgebra::Vector3::zeros()),
            };
            (obj_idx, pos)
        })
        .collect()
}

/// PostProcessFn par défaut — reproduit le comportement hardcodé d'avant la Phase 2.
///
/// Ordre d'application :
/// 1. radius_scale (radial scaling par rapport à l'origin)
/// 2. height_offset (translation Y)
/// 3. depth (interpolation origin ↔ pos)
/// 4. scale (uniform scaling)
/// 5. rotation (yaw → pitch → roll)
/// 6. origin + shift (translation finale)
pub fn default_post_process_fn() -> PostProcessFn {
    Box::new(|ctx: &PostProcessContext, positions| {
        let scale = ctx.macros.get_scale();
        let shift = ctx.macros.get_shift();
        let (yaw, pitch, roll) = ctx.macros.get_rotation();
        let radius_scale = ctx.macros.get_radius_scale();
        let height_offset = ctx.macros.get_height_offset();
        let origin = ctx.origin;

        // Précalculer la matrice de rotation
        let has_rotation = yaw != 0.0 || pitch != 0.0 || roll != 0.0;
        let rot_matrix = if has_rotation {
            use nalgebra::Rotation3;
            let ry = Rotation3::from_axis_angle(&nalgebra::Vector3::y_axis(), yaw.to_radians());
            let rx = Rotation3::from_axis_angle(&nalgebra::Vector3::x_axis(), pitch.to_radians());
            let rz = Rotation3::from_axis_angle(&nalgebra::Vector3::z_axis(), roll.to_radians());
            Some(rz * rx * ry)
        } else {
            None
        };

        positions
            .iter()
            .map(|(obj_idx, pos)| {
                // ManualPosition : si une position manuelle existe, l'utiliser
                let pos = if let Some(manual) = ctx.manual_positions.get(obj_idx) {
                    nalgebra::Vector3::new(manual[0], manual[1], manual[2])
                } else {
                    *pos
                };

                // radius_scale : scaling radial par rapport à l'origin
                let pos_scaled_radius = if (radius_scale - 1.0).abs() > 1e-10 {
                    origin + (pos - origin) * radius_scale
                } else {
                    pos
                };

                // height_offset : translation Y post-engine
                let pos_with_height = if height_offset.abs() > 1e-10 {
                    nalgebra::Vector3::new(
                        pos_scaled_radius.x,
                        pos_scaled_radius.y + height_offset,
                        pos_scaled_radius.z,
                    )
                } else {
                    pos_scaled_radius
                };

                // depth : interpoler entre origin et pos
                let depth = ctx.track_depths.get(*obj_idx).copied().unwrap_or(1.0);
                let pos_with_depth = origin + (pos_with_height - origin) * depth;

                // scale → rotation → origin + shift
                let pos_scaled = pos_with_depth * scale;
                let pos_rotated = if let Some(ref rot) = rot_matrix {
                    rot * pos_scaled
                } else {
                    pos_scaled
                };
                let pos_final = pos_rotated + origin + shift;

                (*obj_idx, pos_final)
            })
            .collect()
    })
}
