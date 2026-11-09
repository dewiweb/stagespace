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

/// Positions tenues par les nodes Freeze — partagées entre recompiles.
pub type HeldPositions = Arc<Mutex<HashMap<String, nalgebra::Vector3<f64>>>>;

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
    /// Table de slots de params modulables — construite par le caller via
    /// `ParamSlots::build(&graph)` et partagée avec la signal_fn du move.
    /// Les closures capturent les indices de leurs slots ; la valeur
    /// effective est `base + delta` (additif), lue par AtomicU64 sans lock.
    pub param_slots: Option<Arc<crate::param_slots::ParamSlots>>,
    /// Positions tenues des nodes Freeze — partagées entre recompiles
    /// (le hold survit au hot-swap). Clé : `{node_id}:{object_index}`.
    pub held_positions: Option<HeldPositions>,
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
        Self::compile_inner(graph, None, None, None, None, None)
    }

    /// Compile un graphe avec accès à l'audio state temps réel
    /// Les engines audio (BPM, AudioAmplitude, AudioAmplitudeFalloff) liront
    /// les valeurs audio live au lieu des paramètres statiques
    pub fn compile_with_audio(
        graph: &Graph,
        audio_state: Arc<Mutex<AudioState>>,
    ) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(graph, Some(audio_state), None, None, None, None)
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
        Self::compile_inner(graph, Some(audio_state), None, None, None, None)
    }

    /// Compile un graphe avec un ensemble complet d'entrées live —
    /// audio, valeurs OSC reçues, registry de plugins WASM.
    pub fn compile_with_live_inputs(
        graph: &Graph,
        live: LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        Self::compile_inner(
            graph,
            live.audio,
            live.osc_values,
            live.plugins,
            live.param_slots,
            live.held_positions,
        )
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
        Self::compile_inner(graph, Some(audio_state), Some(osc_values), None, None, None)
    }

    fn compile_inner(
        graph: &Graph,
        audio_state: Option<Arc<Mutex<AudioState>>>,
        osc_values: Option<OscValueMap>,
        plugins: Option<Arc<Mutex<PluginRegistry>>>,
        param_slots: Option<Arc<crate::param_slots::ParamSlots>>,
        held_positions: Option<HeldPositions>,
    ) -> Result<CompiledFunction, CompilationError> {
        let live = LiveInputs {
            audio: audio_state,
            osc_values,
            plugins,
            param_slots,
            held_positions,
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
        //    On compile chaque chaîne et on crée une fonction de routage.
        //    Tri par (start, end, node_id) : l'ordre HashMap des nodes est
        //    aléatoire entre compilations — sans tri, des ranges qui se
        //    chevauchent donneraient un gagnant non déterministe.
        let mut routed: Vec<(usize, usize, &Node)> = Vec::new();
        for output_node in &output_nodes {
            // Parser track_range : "0-11" ou "12-22"
            let track_range = output_node
                .params
                .get("track_range")
                .and_then(|v| v.as_str())
                .unwrap_or("0-");

            let parse_range = |s: &str| -> Option<usize> { s.trim().parse().ok() };
            let (start_idx, end_idx) = if track_range.contains('-') {
                let parts: Vec<&str> = track_range.splitn(2, '-').collect();
                let s = parse_range(parts[0]).ok_or_else(|| {
                    CompilationError::InvalidParameter(format!(
                        "Output track_range '{track_range}' has a non-numeric start"
                    ))
                })?;
                let e = if parts[1].trim().is_empty() {
                    usize::MAX
                } else {
                    parse_range(parts[1]).ok_or_else(|| {
                        CompilationError::InvalidParameter(format!(
                            "Output track_range '{track_range}' has a non-numeric end"
                        ))
                    })?
                };
                (s, e)
            } else if let Ok(s) = track_range.trim().parse::<usize>() {
                (s, usize::MAX)
            } else {
                return Err(CompilationError::InvalidParameter(format!(
                    "Output track_range '{track_range}' is not a valid range"
                )));
            };
            routed.push((start_idx, end_idx, output_node));
        }
        routed.sort_by_key(|(s, e, n)| (*s, *e, n.id.0.as_u128()));

        let mut sub_functions: Vec<(usize, usize, CompiledFunction)> = Vec::new();
        for (start_idx, end_idx, output_node) in &routed {
            let inputs = graph.get_inputs(output_node.id);
            let node_id = inputs.first().ok_or(CompilationError::OutputNotConnected)?;
            let node = Self::node_ref(graph, *node_id)?;
            let compiled = Self::compile_node(graph, node, &live)?;
            sub_functions.push((*start_idx, *end_idx, compiled));
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

    /// Durée effective du cycle du graphe — résolution depuis l'input
    /// d'Output (propagation : Sequence = a+b, Mix/Group/Crossfade/
    /// Switch = max). Utilisée par le spawn pour comparer spec.duration
    /// à la durée réellement bakée dans les engines.
    pub fn resolved_cycle_duration(graph: &Graph) -> Option<f64> {
        let output = graph
            .nodes
            .values()
            .find(|n| n.node_type == NodeType::Output)?;
        let upstream = graph
            .get_inputs(output.id)
            .first()
            .and_then(|id| graph.nodes.get(id))?;
        Some(Self::resolve_duration(graph, upstream))
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
            NodeType::Switch => Self::compile_switch(graph, node, live),
            NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::PhaseShift
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter
            | NodeType::SpeedScale
            | NodeType::Delay
            | NodeType::Freeze => Self::compile_modifier(graph, node, live),
            // Plugin : le kind du manifeste décide du chemin de compile —
            // engine (f(t) pur), modifier (wrap 1 upstream) ou composite
            // (combine 2 upstreams).
            NodeType::Plugin => Self::compile_plugin(graph, node, live),
            _ => Self::compile_engine(graph, node, live),
        }
    }
}

// ── Modulation de params par slots (domaine signal `param:`) ──
mod slots;
use slots::{build_slot_patch, inject_audio_values, sidx, sval, with_patched_params};

// ── Sous-modules (extraction mécanique — règle modularisation) ──
mod combiners;
mod engines;
mod modifiers;
mod plugins;
mod resolvers;
