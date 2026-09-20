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
            | NodeType::Zone
            | NodeType::Velocity
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
        // Déclarations d'effets — extraites par `extract_graph_effects`,
        // pass-through dans la chaîne de positions.
        NodeType::Zone | NodeType::Velocity => Ok(Box::new(|_ctx, positions| positions)),
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
    let default_scale = get_param_f64_or(node, "scale", 1.0);
    Ok(Box::new(move |_ctx, positions| {
        // Si le MacroState a un scale != 1.0, l'utiliser ; sinon utiliser le param du node
        let macro_scale = _ctx.macros.get_scale();
        let scale = if (macro_scale - 1.0).abs() > 1e-10 {
            macro_scale
        } else {
            default_scale
        };
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, pos * scale))
            .collect()
    }))
}

fn compile_rotate(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let _default_yaw = get_param_f64_or(node, "yaw", 0.0);
    let _default_pitch = get_param_f64_or(node, "pitch", 0.0);
    let _default_roll = get_param_f64_or(node, "roll", 0.0);
    Ok(Box::new(move |ctx, positions| {
        let (yaw, pitch, roll) = ctx.macros.get_rotation();
        let has_rotation = yaw != 0.0 || pitch != 0.0 || roll != 0.0;
        if !has_rotation {
            return positions;
        }
        use nalgebra::Rotation3;
        let ry = Rotation3::from_axis_angle(&nalgebra::Vector3::y_axis(), yaw.to_radians());
        let rx = Rotation3::from_axis_angle(&nalgebra::Vector3::x_axis(), pitch.to_radians());
        let rz = Rotation3::from_axis_angle(&nalgebra::Vector3::z_axis(), roll.to_radians());
        let rot = rz * rx * ry;
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, rot * pos))
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
        // Comme default_post_process_fn : pos + origin + shift
        // (les positions des engines sont relatives à l'origin)
        let offset = ctx.origin + Vector3::new(dx, dy, dz);
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, pos + offset))
            .collect()
    }))
}

fn compile_radius_scale(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let _default = get_param_f64_or(node, "radius_scale", 1.0);
    Ok(Box::new(move |ctx, positions| {
        let radius_scale = ctx.macros.get_radius_scale();
        if (radius_scale - 1.0).abs() <= 1e-10 {
            return positions;
        }
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, origin + (pos - origin) * radius_scale))
            .collect()
    }))
}

fn compile_height_offset(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let _default = get_param_f64_or(node, "height_offset", 0.0);
    Ok(Box::new(move |ctx, positions| {
        let height_offset = ctx.macros.get_height_offset();
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
                (idx, origin + (pos - origin) * depth)
            })
            .collect()
    }))
}

fn compile_barycenter(_node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Le node Barycenter calcule l'origin depuis les track_positions
    // et l'utilise comme centre pour les transformations ultérieures.
    // Il ne modifie pas les positions lui-même — il met à jour l'origin.
    // Note : dans l'architecture actuelle, l'origin est déjà calculée
    // par l'app et passée dans le contexte. Ce node est un no-op pour l'instant.
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
        match target.as_str() {
            "scale" => positions
                .into_iter()
                .map(|(idx, pos)| (idx, pos * factor))
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
    let axis = node
        .params
        .get("axis")
        .and_then(|v| v.as_str())
        .unwrap_or("x")
        .to_string();
    Ok(Box::new(move |_ctx, positions| match axis.as_str() {
        "x" => positions
            .into_iter()
            .map(|(idx, pos)| (idx, Vector3::new(-pos.x, pos.y, pos.z)))
            .collect(),
        "y" => positions
            .into_iter()
            .map(|(idx, pos)| (idx, Vector3::new(pos.x, -pos.y, pos.z)))
            .collect(),
        "z" => positions
            .into_iter()
            .map(|(idx, pos)| (idx, Vector3::new(pos.x, pos.y, -pos.z)))
            .collect(),
        _ => positions,
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
