/// compile_engine + extract_params — compilation des nœuds moteurs — méthodes `impl Compiler` extraites de mod.rs
/// (règle modularisation : découpage mécanique, comportement identique).
use super::*;

impl Compiler {
    /// Compile un nœud moteur en fonction
    pub(crate) fn compile_engine(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let node_type = node.node_type.clone();
        let params = Self::extract_params(graph, node)?;
        let patch = build_slot_patch(&params, live, node);

        // Déterminer si ce moteur est un moteur audio qui nécessite l'injection
        // des valeurs audio temps réel dans params.extra
        let is_audio_engine = matches!(
            node_type,
            NodeType::BPM
                | NodeType::AudioAmplitude
                | NodeType::AudioSpectrum
                | NodeType::AudioAmplitudeFalloff
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
            NodeType::Pendulum => Box::new(crate::engines::pendulum::Pendulum::default()),
            NodeType::RoseCurve => Box::new(crate::engines::rose_curve::RoseCurve),
            NodeType::Helix => Box::new(crate::engines::helix::Helix),
            NodeType::Bouncing => Box::new(crate::engines::bouncing::Bouncing::default()),
            NodeType::Avoidance => Box::new(crate::engines::avoidance::Avoidance::default()),
            NodeType::Spring => Box::new(crate::engines::spring::Spring::default()),
            NodeType::Follow => Box::new(crate::engines::follow::Follow::default()),
            NodeType::Swarm => Box::new(crate::engines::swarm::Swarm::default()),
            NodeType::VectorField => Box::new(crate::engines::vector_field::VectorField::default()),
            // Expressions précompilées en AST borné (audit B3) — les
            // erreurs de parse/longueur/profondeur échouent la compile
            // avec InvalidParameter au lieu d'un re-parse à chaque tick.
            NodeType::CustomTrajectory => Box::new(
                crate::engines::custom_trajectory::CustomTrajectory::new(&params)
                    .map_err(CompilationError::InvalidParameter)?,
            ),
            NodeType::Wave => Box::new(crate::engines::wave::Wave),
            NodeType::BPM => Box::new(crate::engines::bpm::BpmEngine),
            NodeType::AudioAmplitude => {
                Box::new(crate::engines::audio_amplitude::AudioAmplitudeEngine)
            }
            NodeType::AudioSpectrum => {
                Box::new(crate::engines::audio_spectrum::AudioSpectrumEngine)
            }
            NodeType::OSCInput => Box::new(crate::engines::osc_input::OscInputEngine),
            NodeType::TimeFalloff => Box::new(crate::engines::time_falloff::TimeFalloffEngine),
            NodeType::PointDistanceFalloff => {
                Box::new(crate::engines::point_distance_falloff::PointDistanceFalloffEngine)
            }
            NodeType::DirectionalFalloff => {
                Box::new(crate::engines::directional_falloff::DirectionalFalloffEngine)
            }
            NodeType::AudioAmplitudeFalloff => {
                Box::new(crate::engines::audio_amplitude_falloff::AudioAmplitudeFalloffEngine)
            }
            NodeType::DrawSpline => Box::new(crate::engines::spline::DrawSpline),
            NodeType::EvaluateSpline => Box::new(crate::engines::spline::EvaluateSpline),
            NodeType::TrimSpline => Box::new(crate::engines::spline::TrimSpline),
            NodeType::OffsetSpline => Box::new(crate::engines::spline::OffsetSpline),
            // Plugin WASM — résolution via params.plugin_id dans le registry.
            // Sans registry branché (compile() simple) : erreur explicite.
            NodeType::Plugin => {
                let plugin_id = params
                    .extra
                    .get("plugin_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let registry_arc = live.plugins.as_ref().ok_or_else(|| {
                    CompilationError::InvalidParameter(
                        "Plugin node requires a plugin registry (use compile_with_live_inputs)"
                            .to_string(),
                    )
                })?;
                let registry = registry_arc.lock().unwrap_or_else(|e| e.into_inner());
                let plugin = registry.get(plugin_id).ok_or_else(|| {
                    CompilationError::InvalidParameter(format!(
                        "unknown plugin_id '{plugin_id}' — plugin absent du dossier plugins/ ou erreur de chargement"
                    ))
                })?;
                Box::new(
                    crate::plugins::PluginEngine::new(plugin, registry.wasm_engine()).map_err(
                        |e| {
                            CompilationError::InvalidParameter(format!("plugin '{plugin_id}': {e}"))
                        },
                    )?,
                )
            }
            _ => return Err(CompilationError::InvalidNodeType(node_type)),
        };

        // Construire la closure selon le type d'engine
        let has_audio = live.audio.is_some() && is_audio_engine;

        // Engine OSC — injecte la dernière valeur reçue à l'adresse du node
        // (extra["osc_value"]) à chaque frame. Sans cache branché, le node
        // retombe sur son cercle statique — comportement inchangé.
        let osc_values = if node_type == NodeType::OSCInput {
            live.osc_values.clone()
        } else {
            None
        };

        if has_audio {
            // Engine audio — injecte les valeurs audio live dans params.extra
            let audio_arc = live
                .audio
                .as_ref()
                .ok_or_else(|| CompilationError::MissingParameter("audio source".into()))?
                .clone();
            let patch = patch.clone();
            Ok(Box::new(move |t: f64, object_index: usize| {
                with_patched_params(&params, &patch, |p| {
                    let mut live_params = p.clone();
                    if let Some(map) = live_params.extra.as_object_mut() {
                        inject_audio_values(map, &audio_arc);
                    }
                    engine.position(t, object_index, &live_params)
                })
            }))
        } else if let Some(values) = osc_values {
            let patch = patch.clone();
            let address = params
                .extra
                .get("address")
                .and_then(|v| v.as_str())
                .unwrap_or("*")
                .to_string();
            Ok(Box::new(move |t: f64, object_index: usize| {
                with_patched_params(&params, &patch, |p| {
                    let mut live_params = p.clone();
                    {
                        let guard = values.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(v) = guard.get(address.as_str()) {
                            // Scalaire → valeur unique ; multi-arg → array (XYZ direct)
                            let injected = if v.len() == 1 {
                                serde_json::json!(v[0])
                            } else {
                                serde_json::json!(v)
                            };
                            if let Some(map) = live_params.extra.as_object_mut() {
                                map.insert("osc_value".to_string(), injected);
                            }
                        }
                    }
                    engine.position(t, object_index, &live_params)
                })
            }))
        } else {
            // Engine non-audio — closure simple
            Ok(Box::new(move |t: f64, object_index: usize| {
                with_patched_params(&params, &patch, |p| engine.position(t, object_index, p))
            }))
        }
    }

    /// Extrait les paramètres du graphe pour un nœud
    pub(crate) fn extract_params(graph: &Graph, node: &Node) -> Result<EngineParams, CompilationError> {
        // n_objects et duration sont résolus depuis le nœud lui-même, sinon héritées
        // des nœuds Objects / Duration connectés en amont.
        let n_objects = Self::resolve_n_objects(graph, node)?;
        let duration = Self::resolve_duration(graph, node);

        // Bornes hautes (audit I12) : duration>24 h ou fps>240 n'ont aucun
        // cas d'usage réel — un worker à 10 kHz ou une durée d'un an sont
        // des erreurs de paramétrage, pas des features.
        const MAX_DURATION: f64 = 86_400.0; // 24 h
        const MAX_FPS: f64 = 240.0;

        if !(duration.is_finite() && duration > 0.0 && duration <= MAX_DURATION) {
            return Err(CompilationError::InvalidParameter(format!(
                "duration must be finite and in (0, {MAX_DURATION}], got {duration}"
            )));
        }

        let fps = node
            .params
            .get("fps")
            .and_then(|v| v.as_f64())
            .unwrap_or(DEFAULT_FPS);

        if !(fps.is_finite() && fps > 0.0 && fps <= MAX_FPS) {
            return Err(CompilationError::InvalidParameter(format!(
                "fps must be finite and in (0, {MAX_FPS}], got {fps}"
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

        // Pour les nodes spline (EvaluateSpline/TrimSpline/OffsetSpline) :
        // Si un DrawSpline est connecté en amont, utiliser ses points (données brutes).
        // tension/closed restent dans EvaluateSpline (paramètres d'interpolation).
        if matches!(
            node.node_type,
            NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline
        ) {
            let upstream_spline = graph
                .get_inputs(node.id)
                .iter()
                .filter_map(|id| graph.nodes.get(id))
                .find(|n| n.node_type == NodeType::DrawSpline);
            if let Some(draw) = upstream_spline {
                if let Some(map) = extra.as_object_mut() {
                    // Points depuis DrawSpline (source de données)
                    if let Some(points) = draw.params.get("points") {
                        map.insert("points".to_string(), points.clone());
                    }
                    // tension/closed restent dans EvaluateSpline (interpolation)
                }
            }
        }

        Ok(EngineParams {
            n_objects,
            duration,
            fps,
            extra,
        })
    }
}
