use crate::engines::{Engine, EngineParams, MAX_OBJECTS};
use crate::graph::{Graph, Node, NodeId, NodeType};
use crate::validator::Validator;
use crate::logging::{log_graph_compilation, log_compilation_success, log_compilation_error};
use crate::audio::AudioState;
use nalgebra::Vector3;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Erreur de compilation
#[derive(Debug, Clone)]
pub enum CompilationError {
    ValidationFailed(String),
    MissingNode(NodeId),
    MissingOutputNode,
    OutputNotConnected,
    InvalidNodeType(NodeType),
    MissingParameter(String),
    InvalidParameter(String),
}

/// Durée par défaut d'une trajectoire, en secondes
const DEFAULT_DURATION: f64 = 4.0;
/// Fréquence d'échantillonnage par défaut des moteurs à intégration
const DEFAULT_FPS: f64 = 60.0;

/// Fonction compilée
pub type CompiledFunction = Box<dyn Fn(f64, usize) -> Vector3<f64> + Send + Sync>;

/// Compilateur de graphe
pub struct Compiler;

impl Compiler {
    /// Compile un graphe en une fonction composite
    pub fn compile(graph: &Graph) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(graph, None)
    }

    /// Compile un graphe avec accès à l'audio state temps réel
    /// Les engines audio (BPM, AudioAmplitude, AudioAmplitudeFalloff) liront
    /// les valeurs audio live au lieu des paramètres statiques
    pub fn compile_with_audio(
        graph: &Graph,
        audio_state: Arc<Mutex<AudioState>>,
    ) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(graph, Some(audio_state))
    }

    fn compile_inner(
        graph: &Graph,
        audio_state: Option<Arc<Mutex<AudioState>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        let start = Instant::now();
        log_graph_compilation(graph.nodes.len(), graph.edges.len());

        // 1. Valider le graphe
        if let Err(errors) = Validator::validate(graph) {
            let error_msg = errors
                .iter()
                .map(|e| format!("{:?}", e))
                .collect::<Vec<_>>()
                .join(", ");
            log_compilation_error(&error_msg);
            return Err(CompilationError::ValidationFailed(error_msg));
        }

        // 2. Trouver tous les nœuds Output
        let output_nodes: Vec<&Node> = graph
            .nodes
            .values()
            .filter(|n| n.node_type == NodeType::Output)
            .collect();

        if output_nodes.is_empty() {
            return Err(CompilationError::MissingOutputNode);
        }

        // 3. Cas simple : un seul Output → comportement original
        if output_nodes.len() == 1 {
            let output_node = output_nodes[0];
            let inputs = graph.get_inputs(output_node.id);
            let node_id = inputs.first().ok_or(CompilationError::OutputNotConnected)?;
            let node = Self::node_ref(graph, *node_id)?;
            let result = Self::compile_node(graph, node, &audio_state);
            if result.is_ok() {
                let duration_ms = start.elapsed().as_millis() as u128;
                log_compilation_success(duration_ms);
            }
            return result;
        }

        // 4. Cas multi-Output : chaque Output a un param "track_range" (ex: "0-11" ou "12-22")
        //    On compile chaque chaîne et on crée une fonction de routage
        let mut sub_functions: Vec<(usize, usize, CompiledFunction)> = Vec::new();

        for output_node in &output_nodes {
            let inputs = graph.get_inputs(output_node.id);
            let node_id = inputs.first().ok_or(CompilationError::OutputNotConnected)?;
            let node = Self::node_ref(graph, *node_id)?;
            let compiled = Self::compile_node(graph, node, &audio_state)?;

            // Parser track_range : "0-11" ou "12-22"
            let track_range = output_node
                .params
                .get("track_range")
                .and_then(|v| v.as_str())
                .unwrap_or("0-");

            let (start_idx, end_idx) = if track_range.contains('-') {
                let parts: Vec<&str> = track_range.splitn(2, '-').collect();
                let s: usize = parts[0].trim().parse().unwrap_or(0);
                let e: usize = if parts[1].trim().is_empty() {
                    usize::MAX
                } else {
                    parts[1].trim().parse().unwrap_or(usize::MAX)
                };
                (s, e)
            } else {
                (track_range.trim().parse().unwrap_or(0), usize::MAX)
            };

            sub_functions.push((start_idx, end_idx, compiled));
        }

        // Créer la fonction de routage
        let routing_fn: CompiledFunction = Box::new(move |t, obj_idx| {
            for (start, end, fn_ref) in &sub_functions {
                if obj_idx >= *start && obj_idx <= *end {
                    // Ajuster l'index pour que chaque sub-function commence à 0
                    return fn_ref(t, obj_idx - *start);
                }
            }
            // Si aucune route ne correspond, retourner l'origine
            Vector3::new(0.0, 0.0, 0.0)
        });

        let duration_ms = start.elapsed().as_millis() as u128;
        log_compilation_success(duration_ms);
        Ok(routing_fn)
    }

    /// Résout un NodeId en référence de nœud, sans paniquer si absent
    fn node_ref(graph: &Graph, id: NodeId) -> Result<&Node, CompilationError> {
        graph
            .nodes
            .get(&id)
            .ok_or(CompilationError::MissingNode(id))
    }

    /// Compile un nœud (moteur, composite, modifier ou spline) en fonction
    fn compile_node(
        graph: &Graph,
        node: &Node,
        audio: &Option<Arc<Mutex<AudioState>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        match node.node_type {
            NodeType::Mix => Self::compile_mix(graph, node, audio),
            NodeType::Group => Self::compile_group(graph, node, audio),
            NodeType::Sequence => Self::compile_sequence(graph, node, audio),
            NodeType::Crossfade => Self::compile_crossfade(graph, node, audio),
            NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::PhaseShift
            | NodeType::BarycentricGroup
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter => Self::compile_modifier(graph, node, audio),
            _ => Self::compile_engine(graph, node, audio),
        }
    }

    /// Compile un nœud modificateur : wrap une trajectoire upstream
    fn compile_modifier(
        graph: &Graph,
        node: &Node,
        audio: &Option<Arc<Mutex<AudioState>>>,
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
        let upstream_fn = Self::compile_node(graph, upstream_node, audio)?;
        let node_type = node.node_type.clone();

        match node_type {
            NodeType::Scale => {
                let sx = node.params.get("x").and_then(|v| v.as_f64()).unwrap_or(1.0);
                let sy = node.params.get("y").and_then(|v| v.as_f64()).unwrap_or(1.0);
                let sz = node.params.get("z").and_then(|v| v.as_f64()).unwrap_or(1.0);
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::scale(upstream_fn(t, i), sx, sy, sz)
                }))
            }
            NodeType::Offset => {
                let ox = node.params.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let oy = node.params.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let oz = node.params.get("z").and_then(|v| v.as_f64()).unwrap_or(0.0);
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::offset(upstream_fn(t, i), ox, oy, oz)
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
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::rotate(upstream_fn(t, i), ax, ay, az)
                }))
            }
            NodeType::PhaseShift => {
                let shift = node.params.get("shift").and_then(|v| v.as_f64()).unwrap_or(0.1);
                let duration = Self::resolve_duration(graph, node);
                Ok(Box::new(move |t, i| {
                    let t_shifted = crate::engines::modifiers::phase_shift_time(t, i, shift, duration);
                    upstream_fn(t_shifted, i)
                }))
            }
            NodeType::BarycentricGroup => {
                let cx = node
                    .params
                    .get("centerX")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let cy = node
                    .params
                    .get("centerY")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let cz = node
                    .params
                    .get("centerZ")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let center = Vector3::new(cx, cy, cz);
                let n_objects = Self::resolve_n_objects(graph, node)?;
                Ok(Box::new(move |t, i| {
                    let pos = upstream_fn(t, i);
                    // Compute all positions for barycenter
                    let all: Vec<_> = (0..n_objects).map(|j| upstream_fn(t, j)).collect();
                    crate::engines::modifiers::barycentric_group(pos, &all, center)
                }))
            }
            NodeType::Mirror => {
                let plane = node.params.get("plane")
                    .and_then(|v| v.as_str())
                    .unwrap_or("xz")
                    .to_string();
                let offset = node.params.get("offset")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::mirror(upstream_fn(t, i), &plane, offset)
                }))
            }
            NodeType::Clamp => {
                let min_x = node.params.get("min_x").and_then(|v| v.as_f64()).unwrap_or(-100.0);
                let min_y = node.params.get("min_y").and_then(|v| v.as_f64()).unwrap_or(-100.0);
                let min_z = node.params.get("min_z").and_then(|v| v.as_f64()).unwrap_or(-100.0);
                let max_x = node.params.get("max_x").and_then(|v| v.as_f64()).unwrap_or(100.0);
                let max_y = node.params.get("max_y").and_then(|v| v.as_f64()).unwrap_or(100.0);
                let max_z = node.params.get("max_z").and_then(|v| v.as_f64()).unwrap_or(100.0);
                let min = Vector3::new(min_x, min_y, min_z);
                let max = Vector3::new(max_x, max_y, max_z);
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::clamp(upstream_fn(t, i), min, max)
                }))
            }
            NodeType::LFO => {
                let waveform = node.params.get("waveform")
                    .and_then(|v| v.as_str())
                    .unwrap_or("sine")
                    .to_string();
                let frequency = node.params.get("frequency")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                let amplitude = node.params.get("amplitude")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                let axis = node.params.get("axis")
                    .and_then(|v| v.as_str())
                    .unwrap_or("y")
                    .to_string();
                let phase = node.params.get("phase")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::lfo(upstream_fn(t, i), t, &waveform, frequency, amplitude, &axis, phase)
                }))
            }
            NodeType::Jitter => {
                let intensity = node.params.get("intensity")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.2);
                let frequency = node.params.get("frequency")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(2.0);
                let seed = node.params.get("seed")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(42.0);
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::jitter(upstream_fn(t, i), t, i, intensity, frequency, seed)
                }))
            }
            _ => unreachable!(),
        }
    }

    /// Compile un nœud Mix : interpolation linéaire entre deux trajectoires
    fn compile_mix(
        graph: &Graph,
        node: &Node,
        audio: &Option<Arc<Mutex<AudioState>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Mix")?;

        let blend = node
            .params
            .get("blend")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .clamp(0.0, 1.0);

        let func_a = Self::compile_node(graph, node_a, audio)?;
        let func_b = Self::compile_node(graph, node_b, audio)?;

        Ok(Box::new(move |t: f64, object_index: usize| {
            let pos_a = func_a(t, object_index);
            let pos_b = func_b(t, object_index);
            pos_a * (1.0 - blend) + pos_b * blend
        }))
    }

    /// Compile un nœud Group : combine deux trajectoires (objets 0..n_a suivent A, n_a..n_a+n_b suivent B)
    fn compile_group(
        graph: &Graph,
        node: &Node,
        audio: &Option<Arc<Mutex<AudioState>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Group")?;

        // n_objects de la branche A détermine la frontière entre les deux groupes
        let n_objects_a = Self::resolve_n_objects(graph, node_a)?;

        let func_a = Self::compile_node(graph, node_a, audio)?;
        let func_b = Self::compile_node(graph, node_b, audio)?;

        Ok(Box::new(move |t: f64, object_index: usize| {
            if object_index < n_objects_a {
                func_a(t, object_index)
            } else {
                func_b(t, object_index - n_objects_a)
            }
        }))
    }

    /// Compile un nœud Sequence : enchaîne deux trajectoires temporellement
    fn compile_sequence(
        graph: &Graph,
        node: &Node,
        audio: &Option<Arc<Mutex<AudioState>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Sequence")?;

        // La bascule A→B se fait à la fin de A : durée propre du nœud, sinon celle
        // héritée du nœud Duration connecté en amont.
        let duration_a = Self::resolve_duration(graph, node_a);
        if !(duration_a.is_finite() && duration_a > 0.0) {
            return Err(CompilationError::InvalidParameter(format!(
                "Sequence node: input A has a non-positive duration ({duration_a})"
            )));
        }

        let func_a = Self::compile_node(graph, node_a, audio)?;
        let func_b = Self::compile_node(graph, node_b, audio)?;

        Ok(Box::new(move |t: f64, object_index: usize| {
            if t < duration_a {
                func_a(t, object_index)
            } else {
                func_b(t - duration_a, object_index)
            }
        }))
    }

    /// Compile un nœud Crossfade : enchaîne A → B avec une période de crossfade
    /// Pendant le crossfade, les deux trajectoires sont blendées linéairement
    fn compile_crossfade(
        graph: &Graph,
        node: &Node,
        audio: &Option<Arc<Mutex<AudioState>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Crossfade")?;

        let duration_a = Self::resolve_duration(graph, node_a);
        if !(duration_a.is_finite() && duration_a > 0.0) {
            return Err(CompilationError::InvalidParameter(format!(
                "Crossfade node: input A has a non-positive duration ({duration_a})"
            )));
        }

        let fade_duration = node.params.get("fade_duration")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0)
            .min(duration_a * 0.5); // Le fade ne peut pas dépasser la moitié de A

        let func_a = Self::compile_node(graph, node_a, audio)?;
        let func_b = Self::compile_node(graph, node_b, audio)?;

        Ok(Box::new(move |t: f64, object_index: usize| {
            let fade_start = duration_a - fade_duration;
            if t < fade_start {
                // Phase A pure
                func_a(t, object_index)
            } else if t < duration_a {
                // Phase crossfade : blend linéaire A → B
                let progress = (t - fade_start) / fade_duration;
                let pos_a = func_a(t, object_index);
                let pos_b = func_b(t - fade_start, object_index);
                pos_a * (1.0 - progress) + pos_b * progress
            } else {
                // Phase B pure
                func_b(t - fade_start, object_index)
            }
        }))
    }

    /// Résout les deux entrées d'un nœud composite binaire (Mix, Group, Sequence, Crossfade)
    fn binary_inputs<'g>(
        graph: &'g Graph,
        node: &Node,
        label: &str,
    ) -> Result<(&'g Node, &'g Node), CompilationError> {
        let inputs = graph.get_inputs(node.id);
        if inputs.len() < 2 {
            return Err(CompilationError::MissingParameter(format!(
                "{label} node requires 2 trajectory inputs, got {}",
                inputs.len()
            )));
        }
        Ok((
            Self::node_ref(graph, inputs[0])?,
            Self::node_ref(graph, inputs[1])?,
        ))
    }

    /// Résout n_objects d'un nœud : paramètre propre, sinon nœud Objects en amont
    fn resolve_n_objects(graph: &Graph, node: &Node) -> Result<usize, CompilationError> {
        let raw = node
            .params
            .get("n_objects")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                graph
                    .get_inputs(node.id)
                    .iter()
                    .filter_map(|id| graph.nodes.get(id))
                    .find(|n| n.node_type == NodeType::Objects)
                    .and_then(|n| n.params.get("n_objects").and_then(|v| v.as_u64()))
            })
            .ok_or_else(|| CompilationError::MissingParameter("n_objects".to_string()))?;

        if raw == 0 || raw > MAX_OBJECTS as u64 {
            return Err(CompilationError::InvalidParameter(format!(
                "n_objects must be in 1..={MAX_OBJECTS}, got {raw}"
            )));
        }
        Ok(raw as usize)
    }

    /// Résout la durée d'un nœud : paramètre propre, sinon nœud Duration en amont
    fn resolve_duration(graph: &Graph, node: &Node) -> f64 {
        node.params
            .get("duration")
            .and_then(|v| v.as_f64())
            .or_else(|| {
                graph
                    .get_inputs(node.id)
                    .iter()
                    .filter_map(|id| graph.nodes.get(id))
                    .find(|n| n.node_type == NodeType::Duration)
                    .and_then(|n| n.params.get("duration").and_then(|v| v.as_f64()))
            })
            .unwrap_or(DEFAULT_DURATION)
    }

    /// Compile un nœud moteur en fonction
    fn compile_engine(
        graph: &Graph,
        node: &Node,
        audio: &Option<Arc<Mutex<AudioState>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        let node_type = node.node_type.clone();
        let params = Self::extract_params(graph, node)?;

        // Déterminer si ce moteur est un moteur audio qui nécessite l'injection
        // des valeurs audio temps réel dans params.extra
        let is_audio_engine = matches!(
            node_type,
            NodeType::BPM | NodeType::AudioAmplitude
            | NodeType::AudioSpectrum | NodeType::AudioAmplitudeFalloff
        );

        let engine: Box<dyn Engine + Send + Sync> = match node_type {
            NodeType::Circular => Box::new(crate::engines::circular::Circular),
            NodeType::Elliptical => Box::new(crate::engines::elliptical::Elliptical),
            NodeType::Spiral => Box::new(crate::engines::spiral::Spiral),
            NodeType::Lissajous => Box::new(crate::engines::lissajous::Lissajous),
            NodeType::Figure8 => Box::new(crate::engines::figure8::Figure8),
            NodeType::Linear => Box::new(crate::engines::linear::Linear),
            NodeType::Oscillation => Box::new(crate::engines::oscillation::Oscillation),
            NodeType::Formation => Box::new(crate::engines::formation::Formation),
            NodeType::PerlinNoise => Box::new(crate::engines::perlin_noise::PerlinNoise),
            NodeType::Converge => Box::new(crate::engines::converge::Converge),
            NodeType::Pendulum => Box::new(crate::engines::pendulum::Pendulum),
            NodeType::RoseCurve => Box::new(crate::engines::rose_curve::RoseCurve),
            NodeType::Helix => Box::new(crate::engines::helix::Helix),
            NodeType::Bouncing => Box::new(crate::engines::bouncing::Bouncing),
            NodeType::Avoidance => Box::new(crate::engines::avoidance::Avoidance),
            NodeType::Spring => Box::new(crate::engines::spring::Spring),
            NodeType::Follow => Box::new(crate::engines::follow::Follow),
            NodeType::Swarm => Box::new(crate::engines::swarm::Swarm),
            NodeType::CustomTrajectory => Box::new(crate::engines::custom_trajectory::CustomTrajectory),
            NodeType::Wave => Box::new(crate::engines::wave::Wave),
            NodeType::BPM => Box::new(crate::engines::bpm::BpmEngine),
            NodeType::AudioAmplitude => Box::new(crate::engines::audio_amplitude::AudioAmplitudeEngine),
            NodeType::AudioSpectrum => Box::new(crate::engines::audio_spectrum::AudioSpectrumEngine),
            NodeType::OSCInput => Box::new(crate::engines::osc_input::OscInputEngine),
            NodeType::TimeFalloff => Box::new(crate::engines::time_falloff::TimeFalloffEngine),
            NodeType::PointDistanceFalloff => Box::new(crate::engines::point_distance_falloff::PointDistanceFalloffEngine),
            NodeType::DirectionalFalloff => Box::new(crate::engines::directional_falloff::DirectionalFalloffEngine),
            NodeType::AudioAmplitudeFalloff => Box::new(crate::engines::audio_amplitude_falloff::AudioAmplitudeFalloffEngine),
            NodeType::DrawSpline => Box::new(crate::engines::spline::DrawSpline),
            NodeType::EvaluateSpline => Box::new(crate::engines::spline::EvaluateSpline),
            NodeType::TrimSpline => Box::new(crate::engines::spline::TrimSpline),
            NodeType::OffsetSpline => Box::new(crate::engines::spline::OffsetSpline),
            _ => return Err(CompilationError::InvalidNodeType(node_type)),
        };

        // Pour les moteurs audio : capturer l'Arc<Mutex<AudioState>> et injecter
        // les valeurs live dans params.extra à chaque appel
        if is_audio_engine {
            if let Some(audio_arc) = audio {
                let audio_arc = audio_arc.clone();
                Ok(Box::new(move |t: f64, object_index: usize| {
                    // Cloner les params et injecter les valeurs audio live
                    let mut live_params = params.clone();
                    if let Some(map) = live_params.extra.as_object_mut() {
                        let audio = audio_arc.lock().unwrap_or_else(|e| e.into_inner());
                        // Injecter BPM
                        if let Some(bpm_data) = &audio.bpm {
                            map.insert("bpm".to_string(), serde_json::json!(bpm_data.bpm));
                            map.insert("bpm_confidence".to_string(), serde_json::json!(bpm_data.confidence));
                            map.insert("last_beat_time".to_string(), serde_json::json!(bpm_data.last_beat_time));
                        }
                        // Injecter amplitude par bande
                        if let Some(amp) = &audio.amplitude {
                            map.insert("amplitude".to_string(), serde_json::json!(amp.rms));
                            map.insert("amplitude_rms".to_string(), serde_json::json!(amp.rms));
                            map.insert("amplitude_bass".to_string(), serde_json::json!(amp.bass));
                            map.insert("amplitude_mid".to_string(), serde_json::json!(amp.mid));
                            map.insert("amplitude_high".to_string(), serde_json::json!(amp.high));
                        }
                        // Injecter spectre — deux formats pour compatibilité:
                        // 1. "spectrum" (array) — lu par AudioSpectrum engine
                        // 2. "spectrum_band_0..N" — lu par AudioSpectrum engine (fallback)
                        if let Some(spec) = &audio.spectrum {
                            // Prendre les 16 premiers bins, groupés en 8 bandes par paire
                            let n_bands = 8;
                            let bins_per_band = (spec.spectrum.len() / n_bands).max(1);
                            let bands: Vec<f64> = (0..n_bands).map(|i| {
                                let start = i * bins_per_band;
                                let end = ((i + 1) * bins_per_band).min(spec.spectrum.len());
                                if start >= end { return 0.0; }
                                let sum: f64 = spec.spectrum[start..end].iter().sum();
                                sum / (end - start) as f64
                            }).collect();
                            map.insert("spectrum".to_string(), serde_json::json!(bands));
                            for (i, val) in bands.iter().enumerate() {
                                map.insert(
                                    format!("spectrum_band_{}", i),
                                    serde_json::json!(val),
                                );
                            }
                        }
                    }
                    engine.position(t, object_index, &live_params)
                }))
            } else {
                // Pas d'audio_state disponible — utiliser les params statiques
                Ok(Box::new(move |t: f64, object_index: usize| {
                    engine.position(t, object_index, &params)
                }))
            }
        } else {
            // Moteur non-audio — closure simple
            Ok(Box::new(move |t: f64, object_index: usize| {
                engine.position(t, object_index, &params)
            }))
        }
    }

    /// Extrait les paramètres du graphe pour un nœud
    fn extract_params(graph: &Graph, node: &Node) -> Result<EngineParams, CompilationError> {
        // n_objects et duration sont résolus depuis le nœud lui-même, sinon héritées
        // des nœuds Objects / Duration connectés en amont.
        let n_objects = Self::resolve_n_objects(graph, node)?;
        let duration = Self::resolve_duration(graph, node);

        if !(duration.is_finite() && duration > 0.0) {
            return Err(CompilationError::InvalidParameter(format!(
                "duration must be finite and > 0, got {duration}"
            )));
        }

        let fps = node
            .params
            .get("fps")
            .and_then(|v| v.as_f64())
            .unwrap_or(DEFAULT_FPS);

        if !(fps.is_finite() && fps > 0.0) {
            return Err(CompilationError::InvalidParameter(format!(
                "fps must be finite and > 0, got {fps}"
            )));
        }

        // Paramètres spécifiques au moteur, avec duration/n_objects résolus injectés
        // pour que les moteurs lisant `extra` voient les mêmes valeurs que EngineParams.
        let mut extra = node.params.clone();
        if let Some(map) = extra.as_object_mut() {
            map.insert("duration".to_string(), serde_json::json!(duration));
            map.insert("n_objects".to_string(), serde_json::json!(n_objects));
        } else {
            extra = serde_json::json!({ "duration": duration, "n_objects": n_objects });
        }

        Ok(EngineParams {
            n_objects,
            duration,
            fps,
            extra,
        })
    }
}
