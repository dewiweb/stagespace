//! Compilations des nodes de post-processing en transformations
//!
//! Chaque fonction compile un node en une `TransformFn` — une closure qui
//! transforme les positions selon les paramètres du node et l'état du MacroState.

use crate::graph::{Node, NodeType};
use crate::runtime::PostProcessContext;
use nalgebra::Vector3;

use super::PostProcessCompileError;

/// Une transformation compilée
pub(crate) type TransformFn = Box<
    dyn Fn(&PostProcessContext, Vec<(usize, Vector3<f64>)>) -> Vec<(usize, Vector3<f64>)>
        + Send
        + Sync,
>;

/// Vrai si le node est un node de post-processing
pub(crate) fn is_post_process_node(node_type: &NodeType) -> bool {
    matches!(
        node_type,
        NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::RadiusScale
            | NodeType::HeightOffset
            | NodeType::PerTrackDepth
            | NodeType::Barycenter
            | NodeType::AudioFalloff
            | NodeType::ManualPosition
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter
    )
}

/// Compile la chaîne de nodes en une liste de transformations
pub(crate) fn compile_chain(chain: &[Node]) -> Result<Vec<TransformFn>, PostProcessCompileError> {
    chain.iter().map(compile_transform_node).collect()
}

/// Compile un node de post-processing en une transformation
fn compile_transform_node(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    match node.node_type {
        NodeType::Scale => compile_scale(node),
        NodeType::Rotate => compile_rotate(node),
        NodeType::Offset => compile_offset(node),
        NodeType::RadiusScale => compile_radius_scale(node),
        NodeType::HeightOffset => compile_height_offset(node),
        NodeType::PerTrackDepth => compile_per_track_depth(node),
        NodeType::Barycenter => compile_barycenter(node),
        NodeType::AudioFalloff => compile_audio_falloff(node),
        NodeType::ManualPosition => compile_manual_position(node),
        NodeType::Mirror => compile_mirror(node),
        NodeType::Clamp => compile_clamp(node),
        NodeType::LFO => compile_lfo(node),
        NodeType::Jitter => compile_jitter(node),
        _ => Err(PostProcessCompileError::InvalidNode(format!(
            "{:?} is not a post-process node",
            node.node_type
        ))),
    }
}

// ─── Helpers pour lire les params ───

#[allow(dead_code)]
fn get_param_f64(node: &Node, key: &str) -> Result<f64, PostProcessCompileError> {
    node.params
        .get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| PostProcessCompileError::MissingParameter(key.to_string()))
}

fn get_param_f64_or(node: &Node, key: &str, default: f64) -> f64 {
    node.params
        .get(key)
        .and_then(|v| v.as_f64())
        .unwrap_or(default)
}

fn get_param_array_f64(node: &Node, key: &str) -> Vec<f64> {
    node.params
        .get(key)
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default()
}

// ─── Compilations des nodes ───

fn compile_scale(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Audit T2 : le schema UI partagé envoie `x`/`y`/`z` (per-axe, comme
    // le modifier sub-graph) — l'ancienne impl ne lisait que `scale`
    // (scalaire) → les params étaient silencieusement ignorés. On accepte
    // les deux : `x/y/z` primer s'ils sont présents, sinon `scale` est
    // pris comme scale uniforme (rétro-compat des .hfg existants).
    let has_axes = node.params.get("x").is_some()
        || node.params.get("y").is_some()
        || node.params.get("z").is_some();
    let axes = Vector3::new(
        get_param_f64_or(node, "x", 1.0),
        get_param_f64_or(node, "y", 1.0),
        get_param_f64_or(node, "z", 1.0),
    );
    let uniform = get_param_f64_or(node, "scale", 1.0);
    Ok(Box::new(move |ctx, positions| {
        // Macro prioritaire quand ≠ 1.0 (même pattern que Rotate/Offset) —
        // elle prend le dessus comme scale uniforme live.
        let macro_scale = ctx.macros.get_scale();
        let scale_vec = if (macro_scale - 1.0).abs() > 1e-10 {
            Vector3::new(macro_scale, macro_scale, macro_scale)
        } else if has_axes {
            axes
        } else {
            Vector3::new(uniform, uniform, uniform)
        };
        // Positions world-space : le scale pivote autour de l'origin globale
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    crate::spatial_transform::pivot_scale(pos, origin, scale_vec),
                )
            })
            .collect()
    }))
}

fn compile_rotate(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Le schema UI partagé expose angleX/Y/Z (radians, convention sub-graph) ;
    // le graph global documente yaw/pitch/roll (degrés, convention macros).
    // On accepte les deux : la clé canonique prime, l'alias radian est
    // converti en degrés.
    let alias_deg = |k: &str| {
        node.params
            .get(k)
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
            .to_degrees()
    };
    let default_yaw = get_param_f64_or(node, "yaw", alias_deg("angleY"));
    let default_pitch = get_param_f64_or(node, "pitch", alias_deg("angleX"));
    let default_roll = get_param_f64_or(node, "roll", alias_deg("angleZ"));
    Ok(Box::new(move |ctx, positions| {
        // Macros prioritaires quand non nulles — sinon les params du node
        // servent de valeur (même pattern que Scale/Offset).
        let (my, mp, mr) = ctx.macros.get_rotation();
        let yaw = if my != 0.0 { my } else { default_yaw };
        let pitch = if mp != 0.0 { mp } else { default_pitch };
        let roll = if mr != 0.0 { mr } else { default_roll };
        // Ordre canonique `spatial_transform::euler_rotation` (X→Y→Z),
        // unifié avec le modifier sub-graph et le post-process par défaut
        // — l'ancien ordre rz*rx*ry divergeait, les rotations ne
        // commutent pas (audit T2 : triple implémentation des transforms).
        let Some(rot) = crate::spatial_transform::euler_rotation(
            pitch.to_radians(),
            yaw.to_radians(),
            roll.to_radians(),
        ) else {
            return positions;
        };
        // Positions world-space : rotation autour de l'origin globale
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    crate::spatial_transform::pivot_rotate(pos, origin, &rot),
                )
            })
            .collect()
    }))
}

fn compile_offset(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let default_x = get_param_f64_or(node, "x", 0.0);
    let default_y = get_param_f64_or(node, "y", 0.0);
    let default_z = get_param_f64_or(node, "z", 0.0);
    Ok(Box::new(move |ctx, positions| {
        let shift = ctx.macros.get_shift();
        let dx = if shift.x != 0.0 { shift.x } else { default_x };
        let dy = if shift.y != 0.0 { shift.y } else { default_y };
        let dz = if shift.z != 0.0 { shift.z } else { default_z };
        // Positions world-space : l'origin du move est déjà appliquée par le
        // worker — l'offset est une translation pure (pas de + origin ici)
        let offset = Vector3::new(dx, dy, dz);
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, pos + offset))
            .collect()
    }))
}

fn compile_radius_scale(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let default = get_param_f64_or(node, "radius_scale", 1.0);
    Ok(Box::new(move |ctx, positions| {
        let macro_val = ctx.macros.get_radius_scale();
        let radius_scale = if (macro_val - 1.0).abs() > 1e-10 {
            macro_val
        } else {
            default
        };
        if (radius_scale - 1.0).abs() <= 1e-10 {
            return positions;
        }
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    crate::spatial_transform::pivot_scale(
                        pos,
                        origin,
                        Vector3::repeat(radius_scale),
                    ),
                )
            })
            .collect()
    }))
}

fn compile_height_offset(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let default = get_param_f64_or(node, "height_offset", 0.0);
    Ok(Box::new(move |ctx, positions| {
        let macro_val = ctx.macros.get_height_offset();
        let height_offset = if macro_val.abs() > 1e-10 {
            macro_val
        } else {
            default
        };
        if height_offset.abs() <= 1e-10 {
            return positions;
        }
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, Vector3::new(pos.x, pos.y + height_offset, pos.z)))
            .collect()
    }))
}

fn compile_per_track_depth(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let default_depths = get_param_array_f64(node, "depths");
    Ok(Box::new(move |ctx, positions| {
        // Priorité : track_depths du contexte > param du node
        let depths = if !ctx.track_depths.is_empty() {
            ctx.track_depths
        } else {
            &default_depths
        };
        if depths.is_empty() {
            return positions;
        }
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| {
                let depth = depths.get(idx).copied().unwrap_or(1.0);
                (
                    idx,
                    crate::spatial_transform::pivot_scale(pos, origin, Vector3::repeat(depth)),
                )
            })
            .collect()
    }))
}

fn compile_barycenter(_node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Pass-through sur les positions : `compile_post_process` bascule
    // `ctx.origin` sur l'isobarycentre des track_positions quand il
    // rencontre ce node — les transforms qui le suivent pivotent autour
    // du centre réel du groupe.
    Ok(Box::new(|_ctx, positions| positions))
}

fn compile_audio_falloff(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let amount = get_param_f64_or(node, "amount", 1.0);
    let target = node
        .params
        .get("target")
        .and_then(|v| v.as_str())
        .unwrap_or("scale")
        .to_string();
    Ok(Box::new(move |ctx, positions| {
        // Lire l'amplitude audio depuis l'AudioState
        let amplitude = ctx
            .audio_state
            .amplitude
            .as_ref()
            .map(|a| a.rms)
            .unwrap_or(0.0);
        // Appliquer un facteur basé sur l'amplitude
        let factor = 1.0 + (amplitude - 0.5) * amount;
        let origin = ctx.origin;
        match target.as_str() {
            "scale" => positions
                .into_iter()
                .map(|(idx, pos)| {
                    (
                        idx,
                        crate::spatial_transform::pivot_scale(pos, origin, Vector3::repeat(factor)),
                    )
                })
                .collect(),
            "height" => {
                let offset = (amplitude - 0.5) * amount;
                positions
                    .into_iter()
                    .map(|(idx, pos)| (idx, Vector3::new(pos.x, pos.y + offset, pos.z)))
                    .collect()
            }
            _ => positions,
        }
    }))
}

fn compile_manual_position(_node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    Ok(Box::new(move |ctx, positions| {
        if ctx.manual_positions.is_empty() {
            return positions;
        }
        positions
            .into_iter()
            .map(|(idx, pos)| {
                if let Some(manual) = ctx.manual_positions.get(&idx) {
                    (idx, Vector3::new(manual[0], manual[1], manual[2]))
                } else {
                    (idx, pos)
                }
            })
            .collect()
    }))
}

fn compile_mirror(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Audit T2 : l'ancienne impl lisait `axis` (x/y/z) alors que le schema
    // UI partagé envoie `plane` (xy/xz/yz) + `offset` — le node miroir
    // global était silencieusement cassé (toujours "x"). Le schema
    // canonique est celui du modifier sub-graph : plane + offset, via
    // `modifiers::mirror`. `axis` reste accepté en alias legacy :
    // axis "x" ⇔ plane "yz" (réflexion de x), "y" ⇔ "xz", "z" ⇔ "xy".
    let plane = node
        .params
        .get("plane")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            node.params
                .get("axis")
                .and_then(|v| v.as_str())
                .map(|a| match a {
                    "x" => "yz".to_string(),
                    "y" => "xz".to_string(),
                    "z" => "xy".to_string(),
                    other => other.to_string(),
                })
        })
        .unwrap_or_else(|| "xz".to_string());
    let offset = get_param_f64_or(node, "offset", 0.0);
    Ok(Box::new(move |ctx, positions| {
        // Positions world-space : le plan du miroir pivote autour de
        // l'origin globale (offset relatif à l'origin).
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    crate::spatial_transform::pivot_mirror(pos, origin, &plane, offset),
                )
            })
            .collect()
    }))
}

fn compile_clamp(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Accepte les deux schémas : min/max scalaires OU min_x..max_z par axe
    // (clés du node Clamp sub-graph — le frontend envoie les deux selon le
    // contexte). Bornes swappées si min > max : f64::clamp paniquerait dans
    // le merge thread → blackout OSC.
    let lo = Vector3::new(
        get_param_f64_or(node, "min_x", get_param_f64_or(node, "min", -10.0)),
        get_param_f64_or(node, "min_y", get_param_f64_or(node, "min", -10.0)),
        get_param_f64_or(node, "min_z", get_param_f64_or(node, "min", -10.0)),
    );
    let hi = Vector3::new(
        get_param_f64_or(node, "max_x", get_param_f64_or(node, "max", 10.0)),
        get_param_f64_or(node, "max_y", get_param_f64_or(node, "max", 10.0)),
        get_param_f64_or(node, "max_z", get_param_f64_or(node, "max", 10.0)),
    );
    Ok(Box::new(move |_ctx, positions| {
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, crate::engines::modifiers::clamp(pos, lo, hi)))
            .collect()
    }))
}

fn compile_lfo(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Même sémantique que le modifier sub-graph — l'oscillation s'applique
    // ici aux positions MERGÉES (tous les moves) avec ctx.t = temps du
    // MergeRuntime. Cas d'usage : offset global animé, "breathing" de toute
    // la scène.
    let waveform = node
        .params
        .get("waveform")
        .and_then(|v| v.as_str())
        .unwrap_or("sine")
        .to_string();
    let frequency = get_param_f64_or(node, "frequency", 0.5);
    let amplitude = get_param_f64_or(node, "amplitude", 0.5);
    let axis = node
        .params
        .get("axis")
        .and_then(|v| v.as_str())
        .unwrap_or("y")
        .to_string();
    let phase = get_param_f64_or(node, "phase", 0.0);
    Ok(Box::new(move |ctx, positions| {
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    crate::engines::modifiers::lfo(
                        pos, ctx.t, &waveform, frequency, amplitude, &axis, phase,
                    ),
                )
            })
            .collect()
    }))
}

fn compile_jitter(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Bruit par objet (idx = track_index global → seed stable par track),
    // déterministe comme en sub-graph.
    let intensity = get_param_f64_or(node, "intensity", 0.2);
    let frequency = get_param_f64_or(node, "frequency", 2.0);
    let seed = get_param_f64_or(node, "seed", 42.0);
    Ok(Box::new(move |ctx, positions| {
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    crate::engines::modifiers::jitter(pos, ctx.t, idx, intensity, frequency, seed),
                )
            })
            .collect()
    }))
}
