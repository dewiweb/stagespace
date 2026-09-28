use crate::audio::AudioState;
use crate::engines::{Engine, EngineParams, MAX_OBJECTS};
use crate::graph::{Graph, Node, NodeId, NodeType};
use crate::logging::{log_compilation_error, log_compilation_success, log_graph_compilation};
use crate::plugins::PluginRegistry;
use crate::validator::Validator;
use nalgebra::Vector3;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Overrides de paramètres audio — mis à jour à chaque frame par le runtime,
/// lus par les engines via la closure compilée.
/// Permet aux audio mods (radius, height, turns, offset, rotation) d'affecter
/// la trajectoire en temps réel sans recompilation.
pub type AudioParamOverrides = Arc<Mutex<HashMap<String, f64>>>;

/// Dernières valeurs OSC reçues par adresse — partagées avec l'OscReceiver,
/// lues à chaque frame par les engines OSCInput via la closure compilée.
pub type OscValueMap = Arc<Mutex<HashMap<String, Vec<f64>>>>;

/// Entrées live disponibles pendant l'évaluation d'une frame —
/// audio state (BPM/amplitude/spectre) + dernières valeurs OSC reçues
/// + registry des plugins WASM (résolution de `params.plugin_id`).
#[derive(Clone, Default)]
pub struct LiveInputs {
    pub audio: Option<Arc<Mutex<AudioState>>>,
    pub osc_values: Option<OscValueMap>,
    /// Mutex car le registry peut être rechargé en live (`reload_plugins`) —
    /// les closures déjà compilées gardent leur `Arc<Plugin>` snapshot,
    /// les nouvelles compilations voient les plugins à jour.
    pub plugins: Option<Arc<Mutex<PluginRegistry>>>,
}

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
        Self::compile_inner(graph, None, None, None)
    }

    /// Compile un graphe avec accès à l'audio state temps réel
    /// Les engines audio (BPM, AudioAmplitude, AudioAmplitudeFalloff) liront
    /// les valeurs audio live au lieu des paramètres statiques
    pub fn compile_with_audio(
        graph: &Graph,
        audio_state: Arc<Mutex<AudioState>>,
    ) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(graph, Some(audio_state), None, None)
    }

    /// Compile un graphe avec audio state + overrides de paramètres audio
    /// NOTE: les overrides ne sont plus injectés dans params.extra — les audio mods
    /// agissent maintenant sur les macros (système unifié). L'argument overrides est
    /// gardé pour compatibilité API mais ignoré.
    pub fn compile_with_audio_and_overrides(
        graph: &Graph,
        audio_state: Arc<Mutex<AudioState>>,
        _overrides: AudioParamOverrides,
    ) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(graph, Some(audio_state), None, None)
    }

    /// Compile un graphe avec un ensemble complet d'entrées live —
    /// audio, valeurs OSC reçues, registry de plugins WASM.
    pub fn compile_with_live_inputs(
        graph: &Graph,
        live: LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(graph, live.audio, live.osc_values, live.plugins)
    }

    /// Compile un graphe avec audio state + cache des valeurs OSC reçues.
    /// Les nodes `OSCInput` lisent `extra["osc_value"]` depuis la map
    /// (clé = param `address` du node) à chaque frame — sans ça le node
    /// produit un cercle statique.
    pub fn compile_with_audio_osc(
        graph: &Graph,
        audio_state: Arc<Mutex<AudioState>>,
        _overrides: AudioParamOverrides,
        osc_values: OscValueMap,
    ) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(graph, Some(audio_state), Some(osc_values), None)
    }

    fn compile_inner(
        graph: &Graph,
        audio_state: Option<Arc<Mutex<AudioState>>>,
        osc_values: Option<OscValueMap>,
        plugins: Option<Arc<Mutex<PluginRegistry>>>,
    ) -> Result<CompiledFunction, CompilationError> {
        let live = LiveInputs {
            audio: audio_state,
            osc_values,
            plugins,
        };
        let start = Instant::now();
        log_graph_compilation(graph.nodes.len(), graph.edges.len());

        // Kinds des nodes Plugin résolus dans le registry — le validator
        // en a besoin pour appliquer les règles engine/modifier/composite.
        let plugin_kinds = Self::resolve_plugin_kinds(graph, &live);

        // 1. Valider le graphe
        if let Err(errors) = Validator::validate_with_plugin_kinds(
            graph,
            crate::validator::GraphContext::SubGraph,
            &plugin_kinds,
        ) {
            let error_msg = errors
                .iter()
                .map(|e| format!("{e:?}"))
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
            let result = Self::compile_node(graph, node, &live);
            if result.is_ok() {
                let duration_ms = start.elapsed().as_millis();
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
            let compiled = Self::compile_node(graph, node, &live)?;

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

        let duration_ms = start.elapsed().as_millis();
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
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        match node.node_type {
            NodeType::Mix => Self::compile_mix(graph, node, live),
            NodeType::Group => Self::compile_group(graph, node, live),
            NodeType::Sequence => Self::compile_sequence(graph, node, live),
            NodeType::Crossfade => Self::compile_crossfade(graph, node, live),
            NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::PhaseShift
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter => Self::compile_modifier(graph, node, live),
            // Plugin : le kind du manifeste décide du chemin de compile —
            // engine (f(t) pur), modifier (wrap 1 upstream) ou composite
            // (combine 2 upstreams).
            NodeType::Plugin => Self::compile_plugin(graph, node, live),
            _ => Self::compile_engine(graph, node, live),
        }
    }

    /// Résout le `Arc<Plugin>` d'un node Plugin via `params.plugin_id` —
    /// erreur claire si registry absent ou id inconnu.
    fn resolve_plugin(
        node: &Node,
        live: &LiveInputs,
    ) -> Result<Arc<crate::plugins::Plugin>, CompilationError> {
        let plugin_id = node
            .params
            .get("plugin_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let registry_arc = live.plugins.as_ref().ok_or_else(|| {
            CompilationError::InvalidParameter(
                "Plugin node requires a plugin registry (use compile_with_live_inputs)".to_string(),
            )
        })?;
        let registry = registry_arc.lock().unwrap_or_else(|e| e.into_inner());
        registry.get(plugin_id).ok_or_else(|| {
            CompilationError::InvalidParameter(format!(
                "unknown plugin_id '{plugin_id}' — plugin absent du dossier plugins/ ou erreur de chargement"
            ))
        })
    }

    /// Kinds des nodes Plugin du graphe, résolus dans le registry —
    /// utilisé par le validator pour appliquer les règles par kind.
    /// Les ids inconnus n'entrent pas dans la map : le compile échouera
    /// ensuite avec l'erreur explicite de `resolve_plugin`.
    fn resolve_plugin_kinds(
        graph: &Graph,
        live: &LiveInputs,
    ) -> std::collections::HashMap<crate::graph::NodeId, crate::plugins::PluginKind> {
        let mut kinds = std::collections::HashMap::new();
        let Some(registry_arc) = live.plugins.as_ref() else {
            return kinds;
        };
        let registry = registry_arc.lock().unwrap_or_else(|e| e.into_inner());
        for node in graph.nodes.values() {
            if node.node_type != NodeType::Plugin {
                continue;
            }
            if let Some(id) = node.params.get("plugin_id").and_then(|v| v.as_str()) {
                if let Some(p) = registry.get(id) {
                    kinds.insert(node.id, p.manifest.kind);
                }
            }
        }
        kinds
    }

    /// Entrées trajectoire d'un node Plugin, ordonnées par port
    /// (`input_a`, puis `input`, puis `input_b`) — hors carriers
    /// Objects/Duration qui ne transportent pas de positions.
    fn plugin_trajectory_inputs(graph: &Graph, node: &Node) -> Vec<crate::graph::NodeId> {
        let mut edges: Vec<&crate::graph::Edge> = graph
            .edges
            .iter()
            .filter(|e| e.to == node.id)
            .filter(|e| matches!(e.to_port.as_str(), "input" | "input_a" | "input_b"))
            .filter(|e| {
                !matches!(
                    graph.nodes.get(&e.from).map(|n| &n.node_type),
                    Some(NodeType::Objects) | Some(NodeType::Duration)
                )
            })
            .collect();
        edges.sort_by_key(|e| match e.to_port.as_str() {
            "input_a" => 0,
            "input" => 1,
            _ => 2,
        });
        edges.iter().map(|e| e.from).collect()
    }

    /// Compile un node Plugin selon le kind de son manifeste.
    fn compile_plugin(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        use crate::plugins::PluginKind;
        let plugin = Self::resolve_plugin(node, live)?;
        let plugin_id = plugin.manifest.id.clone();
        let wasm_engine = {
            let registry = live
                .plugins
                .as_ref()
                .expect("registry checked by resolve_plugin")
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            registry.wasm_engine().clone()
        };

        match plugin.manifest.kind {
            // Engine : déléguer à compile_engine — il re-résout le plugin
            // (HashMap + clone d'Arc, compile-time seulement) et gère les
            // conventions Objects/Duration/n_objects des engines.
            PluginKind::Engine => Self::compile_engine(graph, node, live),
            PluginKind::Modifier => {
                let inputs = Self::plugin_trajectory_inputs(graph, node);
                let upstream_id = inputs.first().ok_or_else(|| {
                    CompilationError::MissingParameter(format!(
                        "plugin '{plugin_id}' (modifier) requires 1 trajectory input, got {}",
                        inputs.len()
                    ))
                })?;
                let upstream_node = Self::node_ref(graph, *upstream_id)?;
                let upstream_fn = Self::compile_node(graph, upstream_node, live)?;
                let engine =
                    crate::plugins::PluginEngine::new(plugin, &wasm_engine).map_err(|e| {
                        CompilationError::InvalidParameter(format!("plugin '{plugin_id}': {e}"))
                    })?;
                // extract_params résout n_objects/duration (propagation
                // upstream) et les injecte dans extra — même convention
                // que les engines natifs.
                let params = Self::extract_params(graph, node)?;
                Ok(Box::new(move |t, i| {
                    engine.eval(t, i, &params, &[upstream_fn(t, i)])
                }))
            }
            PluginKind::Composite => {
                let inputs = Self::plugin_trajectory_inputs(graph, node);
                if inputs.len() != 2 {
                    return Err(CompilationError::MissingParameter(format!(
                        "plugin '{plugin_id}' (composite) requires 2 trajectory inputs, got {}",
                        inputs.len()
                    )));
                }
                let node_a = Self::node_ref(graph, inputs[0])?;
                let node_b = Self::node_ref(graph, inputs[1])?;
                let func_a = Self::compile_node(graph, node_a, live)?;
                let func_b = Self::compile_node(graph, node_b, live)?;
                let engine =
                    crate::plugins::PluginEngine::new(plugin, &wasm_engine).map_err(|e| {
                        CompilationError::InvalidParameter(format!("plugin '{plugin_id}': {e}"))
                    })?;
                let params = Self::extract_params(graph, node)?;
                Ok(Box::new(move |t, i| {
                    engine.eval(t, i, &params, &[func_a(t, i), func_b(t, i)])
                }))
            }
        }
    }

    /// Compile un nœud modificateur : wrap une trajectoire upstream
    fn compile_modifier(
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
                let shift = node
                    .params
                    .get("shift")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.1);
                let duration = Self::resolve_duration(graph, node);
                Ok(Box::new(move |t, i| {
                    let t_shifted =
                        crate::engines::modifiers::phase_shift_time(t, i, shift, duration);
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
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::mirror(upstream_fn(t, i), &plane, offset)
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
                let min = Vector3::new(min_x, min_y, min_z);
                let max = Vector3::new(max_x, max_y, max_z);
                Ok(Box::new(move |t, i| {
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
                Ok(Box::new(move |t, i| {
                    crate::engines::modifiers::lfo(
                        upstream_fn(t, i),
                        t,
                        &waveform,
                        frequency,
                        amplitude,
                        &axis,
                        phase,
                    )
                }))
            }
            NodeType::Jitter => {
                let intensity = node
                    .params
                    .get("intensity")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.2);
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
                        intensity,
                        frequency,
                        seed,
                    )
                }))
            }
            other => Err(CompilationError::InvalidNodeType(other)),
        }
    }

    /// Compile un nœud Mix : interpolation linéaire entre deux trajectoires
    fn compile_mix(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Mix")?;

        let blend = node
            .params
            .get("blend")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .clamp(0.0, 1.0);

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;

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
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Group")?;

        // n_objects de la branche A détermine la frontière entre les deux groupes
        let n_objects_a = Self::resolve_n_objects(graph, node_a)?;

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;

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
        live: &LiveInputs,
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

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;

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
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Crossfade")?;

        let duration_a = Self::resolve_duration(graph, node_a);
        if !(duration_a.is_finite() && duration_a > 0.0) {
            return Err(CompilationError::InvalidParameter(format!(
                "Crossfade node: input A has a non-positive duration ({duration_a})"
            )));
        }

        let fade_duration = node
            .params
            .get("fade_duration")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0)
            .min(duration_a * 0.5); // Le fade ne peut pas dépasser la moitié de A

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;

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
        // Port-aware : input_a/input_b ont une sémantique distincte — utiliser
        // l'ordre d'insertion inverserait silencieusement A/B quand l'utilisateur
        // câble B avant A.
        let inputs = graph.get_binary_inputs(node.id);
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

    /// Résout n_objects d'un nœud : paramètre propre, sinon nœud Objects en
    /// amont, sinon propagation depuis les entrées trajectoires — un modifier
    /// laisse passer le compte de son entrée, un Group concatène les deux
    /// espaces d'objets (n_a + n_b), Mix/Sequence/Crossfade délèguent à
    /// input_a (le validator garantit l'égalité des deux entrées).
    fn resolve_n_objects(graph: &Graph, node: &Node) -> Result<usize, CompilationError> {
        let raw = Self::resolve_n_objects_depth(graph, node, 0)?;
        if raw == 0 || raw > MAX_OBJECTS as u64 {
            return Err(CompilationError::InvalidParameter(format!(
                "n_objects must be in 1..={MAX_OBJECTS}, got {raw}"
            )));
        }
        Ok(raw as usize)
    }

    fn resolve_n_objects_depth(
        graph: &Graph,
        node: &Node,
        depth: usize,
    ) -> Result<u64, CompilationError> {
        if depth > 64 {
            return Err(CompilationError::InvalidParameter(
                "n_objects resolution exceeded depth limit (cycle?)".to_string(),
            ));
        }
        if let Some(v) = node.params.get("n_objects").and_then(|v| v.as_u64()) {
            return Ok(v);
        }
        let inputs = graph.get_inputs(node.id);
        if let Some(v) = inputs
            .iter()
            .filter_map(|id| graph.nodes.get(id))
            .find(|n| n.node_type == NodeType::Objects)
            .and_then(|n| n.params.get("n_objects").and_then(|v| v.as_u64()))
        {
            return Ok(v);
        }
        match node.node_type {
            NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::PhaseShift
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter => {
                let upstream = inputs
                    .first()
                    .ok_or_else(|| CompilationError::MissingParameter("n_objects".to_string()))?;
                let upstream_node = Self::node_ref(graph, *upstream)?;
                Self::resolve_n_objects_depth(graph, upstream_node, depth + 1)
            }
            NodeType::Group => {
                let binary = graph.get_binary_inputs(node.id);
                let mut total = 0u64;
                for id in binary.iter().take(2) {
                    let input_node = Self::node_ref(graph, *id)?;
                    total += Self::resolve_n_objects_depth(graph, input_node, depth + 1)?;
                }
                Ok(total)
            }
            NodeType::Mix | NodeType::Sequence | NodeType::Crossfade => {
                let binary = graph.get_binary_inputs(node.id);
                let first = binary
                    .first()
                    .ok_or_else(|| CompilationError::MissingParameter("n_objects".to_string()))?;
                let input_node = Self::node_ref(graph, *first)?;
                Self::resolve_n_objects_depth(graph, input_node, depth + 1)
            }
            // Plugin modifier/composite : propage depuis l'entrée
            // trajectoire (Objects/Duration déjà résolus plus haut pour
            // les engines).
            NodeType::Plugin => {
                let traj = Self::plugin_trajectory_inputs(graph, node);
                let first = traj
                    .first()
                    .ok_or_else(|| CompilationError::MissingParameter("n_objects".to_string()))?;
                let input_node = Self::node_ref(graph, *first)?;
                Self::resolve_n_objects_depth(graph, input_node, depth + 1)
            }
            _ => Err(CompilationError::MissingParameter("n_objects".to_string())),
        }
    }

    /// Résout la durée d'un nœud : paramètre propre, sinon nœud Duration en
    /// amont, sinon propagation depuis les entrées trajectoires — modifier →
    /// entrée, Sequence → durée totale du cycle (a + b), Group/Mix/Crossfade →
    /// max des branches (les deux tournent en parallèle). Utilisée par
    /// compile_sequence pour la bascule A→B : sans propagation, une entrée
    /// composite/modifier basculait silencieusement au défaut.
    fn resolve_duration(graph: &Graph, node: &Node) -> f64 {
        Self::resolve_duration_depth(graph, node, 0)
    }

    fn resolve_duration_depth(graph: &Graph, node: &Node, depth: usize) -> f64 {
        if depth > 64 {
            return DEFAULT_DURATION;
        }
        if let Some(v) = node.params.get("duration").and_then(|v| v.as_f64()) {
            return v;
        }
        let inputs = graph.get_inputs(node.id);
        if let Some(v) = inputs
            .iter()
            .filter_map(|id| graph.nodes.get(id))
            .find(|n| n.node_type == NodeType::Duration)
            .and_then(|n| n.params.get("duration").and_then(|v| v.as_f64()))
        {
            return v;
        }
        match node.node_type {
            NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::PhaseShift
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter => inputs
                .first()
                .and_then(|id| graph.nodes.get(id))
                .map(|n| Self::resolve_duration_depth(graph, n, depth + 1))
                .unwrap_or(DEFAULT_DURATION),
            NodeType::Sequence => {
                let binary = graph.get_binary_inputs(node.id);
                binary
                    .iter()
                    .take(2)
                    .filter_map(|id| graph.nodes.get(id))
                    .map(|n| Self::resolve_duration_depth(graph, n, depth + 1))
                    .sum::<f64>()
            }
            NodeType::Mix | NodeType::Group | NodeType::Crossfade => {
                let binary = graph.get_binary_inputs(node.id);
                binary
                    .iter()
                    .take(2)
                    .filter_map(|id| graph.nodes.get(id))
                    .map(|n| Self::resolve_duration_depth(graph, n, depth + 1))
                    .fold(0.0, f64::max)
            }
            // Plugin modifier/composite : durée propagée depuis la
            // première entrée trajectoire (sémantique modifier).
            NodeType::Plugin => Self::plugin_trajectory_inputs(graph, node)
                .first()
                .and_then(|id| graph.nodes.get(id))
                .map(|n| Self::resolve_duration_depth(graph, n, depth + 1))
                .unwrap_or(DEFAULT_DURATION),
            _ => DEFAULT_DURATION,
        }
    }

    /// Compile un nœud moteur en fonction
    fn compile_engine(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let node_type = node.node_type.clone();
        let params = Self::extract_params(graph, node)?;

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
            let audio_arc = live.audio.as_ref().expect("checked by has_audio").clone();
            Ok(Box::new(move |t: f64, object_index: usize| {
                let mut live_params = params.clone();
                if let Some(map) = live_params.extra.as_object_mut() {
                    inject_audio_values(map, &audio_arc);
                }
                engine.position(t, object_index, &live_params)
            }))
        } else if let Some(values) = osc_values {
            let address = params
                .extra
                .get("address")
                .and_then(|v| v.as_str())
                .unwrap_or("*")
                .to_string();
            Ok(Box::new(move |t: f64, object_index: usize| {
                let mut live_params = params.clone();
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
            }))
        } else {
            // Engine non-audio — closure simple
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

// ── Helper functions for live audio injection ──

/// Injecte les valeurs audio temps réel dans les params extra d'un engine
fn inject_audio_values(
    map: &mut serde_json::Map<String, serde_json::Value>,
    audio_arc: &Arc<Mutex<AudioState>>,
) {
    let audio = audio_arc.lock().unwrap_or_else(|e| e.into_inner());
    // BPM
    if let Some(bpm_data) = &audio.bpm {
        map.insert("bpm".to_string(), serde_json::json!(bpm_data.bpm));
        map.insert(
            "bpm_confidence".to_string(),
            serde_json::json!(bpm_data.confidence),
        );
        map.insert(
            "last_beat_time".to_string(),
            serde_json::json!(bpm_data.last_beat_time),
        );
    }
    // Amplitude par bande
    if let Some(amp) = &audio.amplitude {
        map.insert("amplitude".to_string(), serde_json::json!(amp.rms));
        map.insert("amplitude_rms".to_string(), serde_json::json!(amp.rms));
        map.insert("amplitude_bass".to_string(), serde_json::json!(amp.bass));
        map.insert("amplitude_mid".to_string(), serde_json::json!(amp.mid));
        map.insert("amplitude_high".to_string(), serde_json::json!(amp.high));
    }
    // Spectre — array + bandes individuelles
    if let Some(spec) = &audio.spectrum {
        let n_bands = 8;
        let bins_per_band = (spec.spectrum.len() / n_bands).max(1);
        let bands: Vec<f64> = (0..n_bands)
            .map(|i| {
                let start = i * bins_per_band;
                let end = ((i + 1) * bins_per_band).min(spec.spectrum.len());
                if start >= end {
                    return 0.0;
                }
                let sum: f64 = spec.spectrum[start..end].iter().sum();
                sum / (end - start) as f64
            })
            .collect();
        map.insert("spectrum".to_string(), serde_json::json!(bands));
        for (i, val) in bands.iter().enumerate() {
            map.insert(format!("spectrum_band_{i}"), serde_json::json!(val));
        }
    }
}
