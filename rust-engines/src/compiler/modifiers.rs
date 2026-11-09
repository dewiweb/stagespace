/// compile_modifier — dispatch des nœuds modificateurs (Scale/Rotate/Offset/…) — méthodes `impl Compiler` extraites de mod.rs
/// (règle modularisation : découpage mécanique, comportement identique).
use super::*;

impl Compiler {
    /// Compile un nœud modificateur : wrap une trajectoire upstream
    pub(crate) fn compile_modifier(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let inputs = graph.get_inputs(node.id);
        let upstream_id = inputs.first().ok_or_else(|| {
            CompilationError::MissingParameter(format!(
                "{:?} requires 1 trajectory input, got {}",
                node.node_type,
                inputs.len()
            ))
        })?;
        let upstream_node = Self::node_ref(graph, *upstream_id)?;
        let upstream_fn = Self::compile_node(graph, upstream_node, live)?;
        let node_type = node.node_type.clone();
        let over = live.param_slots.clone();

        match node_type {
            NodeType::Scale => {
                let sx = node.params.get("x").and_then(|v| v.as_f64()).unwrap_or(1.0);
                let sy = node.params.get("y").and_then(|v| v.as_f64()).unwrap_or(1.0);
                let sz = node.params.get("z").and_then(|v| v.as_f64()).unwrap_or(1.0);
                let over = over.clone();
                let i_x = sidx(&over, node, "x");
                let i_y = sidx(&over, node, "y");
                let i_z = sidx(&over, node, "z");
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::scale(
                        upstream_fn(t, i),
                        sval(&over, i_x, sx),
                        sval(&over, i_y, sy),
                        sval(&over, i_z, sz),
                    )
                }))
            }
            NodeType::Offset => {
                let ox = node.params.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let oy = node.params.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let oz = node.params.get("z").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let over = over.clone();
                let i_x = sidx(&over, node, "x");
                let i_y = sidx(&over, node, "y");
                let i_z = sidx(&over, node, "z");
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::offset(
                        upstream_fn(t, i),
                        sval(&over, i_x, ox),
                        sval(&over, i_y, oy),
                        sval(&over, i_z, oz),
                    )
                }))
            }
            NodeType::Rotate => {
                let ax = node
                    .params
                    .get("angleX")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let ay = node
                    .params
                    .get("angleY")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let az = node
                    .params
                    .get("angleZ")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let over = over.clone();
                let i_angle_x = sidx(&over, node, "angleX");
                let i_angle_y = sidx(&over, node, "angleY");
                let i_angle_z = sidx(&over, node, "angleZ");
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::rotate(
                        upstream_fn(t, i),
                        sval(&over, i_angle_x, ax),
                        sval(&over, i_angle_y, ay),
                        sval(&over, i_angle_z, az),
                    )
                }))
            }
            NodeType::PhaseShift => {
                let shift = node
                    .params
                    .get("shift")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.1);
                let duration = Self::resolve_duration(graph, node);
                let over = over.clone();
                let i_shift = sidx(&over, node, "shift");
                Ok(Box::new(move |t, i| {
                    let t_shifted = crate::engines::modifiers::phase_shift_time(
                        t,
                        i,
                        sval(&over, i_shift, shift),
                        duration,
                    );
                    upstream_fn(t_shifted, i)
                }))
            }
            NodeType::Mirror => {
                let plane = node
                    .params
                    .get("plane")
                    .and_then(|v| v.as_str())
                    .unwrap_or("xz")
                    .to_string();
                let offset = node
                    .params
                    .get("offset")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let over = over.clone();
                let i_offset = sidx(&over, node, "offset");
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::mirror(
                        upstream_fn(t, i),
                        &plane,
                        sval(&over, i_offset, offset),
                    )
                }))
            }
            NodeType::Clamp => {
                let min_x = node
                    .params
                    .get("min_x")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(-100.0);
                let min_y = node
                    .params
                    .get("min_y")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(-100.0);
                let min_z = node
                    .params
                    .get("min_z")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(-100.0);
                let max_x = node
                    .params
                    .get("max_x")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(100.0);
                let max_y = node
                    .params
                    .get("max_y")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(100.0);
                let max_z = node
                    .params
                    .get("max_z")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(100.0);
                let over = over.clone();
                let i_min_x = sidx(&over, node, "min_x");
                let i_min_y = sidx(&over, node, "min_y");
                let i_min_z = sidx(&over, node, "min_z");
                let i_max_x = sidx(&over, node, "max_x");
                let i_max_y = sidx(&over, node, "max_y");
                let i_max_z = sidx(&over, node, "max_z");
                Ok(Box::new(move |t, i| {
                    let min = Vector3::new(
                        sval(&over, i_min_x, min_x),
                        sval(&over, i_min_y, min_y),
                        sval(&over, i_min_z, min_z),
                    );
                    let max = Vector3::new(
                        sval(&over, i_max_x, max_x),
                        sval(&over, i_max_y, max_y),
                        sval(&over, i_max_z, max_z),
                    );
                    crate::engines::modifiers::clamp(upstream_fn(t, i), min, max)
                }))
            }
            NodeType::LFO => {
                let waveform = node
                    .params
                    .get("waveform")
                    .and_then(|v| v.as_str())
                    .unwrap_or("sine")
                    .to_string();
                let frequency = node
                    .params
                    .get("frequency")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                let amplitude = node
                    .params
                    .get("amplitude")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                let axis = node
                    .params
                    .get("axis")
                    .and_then(|v| v.as_str())
                    .unwrap_or("y")
                    .to_string();
                let phase = node
                    .params
                    .get("phase")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let over = over.clone();
                let i_frequency = sidx(&over, node, "frequency");
                let i_amplitude = sidx(&over, node, "amplitude");
                let i_phase = sidx(&over, node, "phase");
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::lfo(
                        upstream_fn(t, i),
                        t,
                        &waveform,
                        sval(&over, i_frequency, frequency),
                        sval(&over, i_amplitude, amplitude),
                        &axis,
                        sval(&over, i_phase, phase),
                    )
                }))
            }
            NodeType::SpeedScale => {
                let factor = node
                    .params
                    .get("factor")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0);
                let over = over.clone();
                let i_factor = sidx(&over, node, "factor");
                Ok(Box::new(move |t, i| {
                    // factor n'a pas de borne max — un delta hostile peut
                    // rendre t non-fini en amont : on borne l'argument.
                    upstream_fn((t * sval(&over, i_factor, factor)).clamp(-1e15, 1e15), i)
                }))
            }
            NodeType::Delay => {
                let delay = node
                    .params
                    .get("delay")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                let over = over.clone();
                let i_delay = sidx(&over, node, "delay");
                Ok(Box::new(move |t, i| {
                    upstream_fn((t - sval(&over, i_delay, delay)).clamp(-1e15, 1e15), i)
                }))
            }
            NodeType::Freeze => {
                let enabled = node
                    .params
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let over = over.clone();
                let i_enabled = sidx(&over, node, "enabled");
                // Hold partagé avec le Runtime : survit au hot-swap du graphe.
                // Fallback closure-local si aucune map n'est fournie (tests).
                let shared = live.held_positions.clone();
                let local: Arc<
                    std::sync::Mutex<std::collections::HashMap<String, nalgebra::Vector3<f64>>>,
                > = Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
                let node_id = node.id;
                Ok(Box::new(move |t, i| {
                    if sval(&over, i_enabled, f64::from(enabled)) < 0.5 {
                        return upstream_fn(t, i);
                    }
                    let held_map = shared.as_ref().unwrap_or(&local);
                    let mut h = held_map.lock().unwrap_or_else(|e| e.into_inner());
                    let key = format!("{}:{i}", node_id.0);
                    *h.entry(key).or_insert_with(|| upstream_fn(t, i))
                }))
            }
            NodeType::Jitter => {
                let intensity = node
                    .params
                    .get("intensity")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.2);
                let over = over.clone();
                let i_intensity = sidx(&over, node, "intensity");
                let i_frequency = sidx(&over, node, "frequency");
                let frequency = node
                    .params
                    .get("frequency")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(2.0);
                let seed = node
                    .params
                    .get("seed")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(42.0);
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::jitter(
                        upstream_fn(t, i),
                        t,
                        i,
                        sval(&over, i_intensity, intensity),
                        sval(&over, i_frequency, frequency),
                        seed,
                    )
                }))
            }
            other => Err(CompilationError::InvalidNodeType(other)),
        }
    }

}
