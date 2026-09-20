use crate::graph::{Graph, NodeId, NodeType};
use std::collections::HashSet;
use std::fmt;

/// Contexte de validation : sub-graph (mouvement) ou graph global (post-processing).
///
/// Certains nodes n'ont de sens que dans un contexte :
/// - `Input`, `MoveRef`, `Merge`, `RadiusScale`, `HeightOffset`, `PerTrackDepth`,
///   `Barycenter`, `AudioFalloff`, `ManualPosition` → graph global uniquement
/// - `Objects`, `Duration`, tous les moteurs, splines, falloffs, sources → sub-graph uniquement
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphContext {
    SubGraph,
    Global,
}

/// Erreur de validation
#[derive(Debug, Clone)]
pub enum ValidationError {
    CycleDetected,
    MissingRequiredNode(NodeType),
    InvalidConnection(String),
    TypeMismatch(String),
    CountMismatch(String),
    /// Node présent dans un contexte où il n'a pas de sens (sub-graph vs global)
    ContextIncompatible(String),
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ValidationError::CycleDetected => write!(f, "cycle detected in graph"),
            ValidationError::MissingRequiredNode(t) => {
                write!(f, "missing required node {t:?}")
            }
            ValidationError::InvalidConnection(msg) => write!(f, "invalid connection: {msg}"),
            ValidationError::TypeMismatch(msg) => write!(f, "type mismatch: {msg}"),
            ValidationError::CountMismatch(msg) => write!(f, "count mismatch: {msg}"),
            ValidationError::ContextIncompatible(msg) => {
                write!(f, "context incompatible: {msg}")
            }
        }
    }
}

/// Résultat de validation
pub type ValidationResult = Result<(), Vec<ValidationError>>;

/// Validateur de graphe
pub struct Validator;

impl Validator {
    /// Valide un graphe complet (contexte sub-graph par défaut).
    ///
    /// Pour valider un graph global, utiliser `validate_with_context(graph, GraphContext::Global)`.
    pub fn validate(graph: &Graph) -> ValidationResult {
        Self::validate_with_context(graph, GraphContext::SubGraph)
    }

    /// Valide un graphe complet avec un contexte explicite (sub-graph ou global).
    pub fn validate_with_context(graph: &Graph, context: GraphContext) -> ValidationResult {
        let mut errors = Vec::new();

        // 0. Vérifier que les nodes sont compatibles avec le contexte
        Self::validate_context_compatibility(graph, context, &mut errors);

        // 1. Vérifier les cycles
        if graph.has_cycle() {
            errors.push(ValidationError::CycleDetected);
        }

        // 2. Vérifier les nœuds obligatoires (différents selon le contexte)
        match context {
            GraphContext::SubGraph => {
                // Objects et Duration sont obligatoires seulement s'il y a des moteurs directs
                let has_engines = Self::graph_has_engines(graph);
                if has_engines {
                    // Un node Objects/Duration ne compte que s'il est connecté
                    // au graphe — un node orphelin ne fournit ni n_objects ni
                    // duration aux engines (le compiler échouerait plus tard
                    // avec un MissingParameter moins clair).
                    for required_type in [NodeType::Objects, NodeType::Duration] {
                        let connected = graph.nodes.values().any(|n| {
                            n.node_type == required_type && !graph.get_outputs(n.id).is_empty()
                        });
                        if !connected {
                            errors.push(ValidationError::MissingRequiredNode(required_type));
                        }
                    }
                }
            }
            GraphContext::Global => {
                // Pas d'Objects/Duration requis en global ; le graph global
                // a juste besoin d'un Output et d'au moins une source
                // (Input, Merge, ou MoveRef).
                let has_source = graph.nodes.values().any(|n| {
                    matches!(
                        n.node_type,
                        NodeType::Input | NodeType::Merge | NodeType::MoveRef
                    )
                });
                if !has_source {
                    errors.push(ValidationError::MissingRequiredNode(NodeType::Input));
                }
            }
        }

        // Output est toujours obligatoire
        if !graph
            .nodes
            .values()
            .any(|n| n.node_type == NodeType::Output)
        {
            errors.push(ValidationError::MissingRequiredNode(NodeType::Output));
        }

        // Un seul node Objects — plusieurs seraient ambigus (le parser
        // résoudrait n_objects de façon non déterministe via HashMap::find).
        let objects_count = graph
            .nodes
            .values()
            .filter(|n| n.node_type == NodeType::Objects)
            .count();
        if objects_count > 1 {
            errors.push(ValidationError::InvalidConnection(format!(
                "{objects_count} Objects nodes found — at most one is allowed"
            )));
        }

        // 3. Vérifier les connexions valides + endpoints existants + doublons
        let mut seen_edges: HashSet<(NodeId, NodeId, &str, &str)> = HashSet::new();
        for edge in &graph.edges {
            if !seen_edges.insert((edge.from, edge.to, &edge.from_port, &edge.to_port)) {
                errors.push(ValidationError::InvalidConnection(format!(
                    "duplicate edge {:?} -> {:?} ({} -> {})",
                    edge.from, edge.to, edge.from_port, edge.to_port
                )));
            }
            match (graph.nodes.get(&edge.from), graph.nodes.get(&edge.to)) {
                (Some(from_node), Some(to_node)) => {
                    if edge.from == edge.to {
                        errors.push(ValidationError::InvalidConnection(format!(
                            "self-loop on {:?} is not allowed",
                            from_node.node_type
                        )));
                    } else if !Self::is_valid_connection(&from_node.node_type, &to_node.node_type) {
                        errors.push(ValidationError::InvalidConnection(format!(
                            "{:?} -> {:?}",
                            from_node.node_type, to_node.node_type
                        )));
                    }
                }
                _ => errors.push(ValidationError::InvalidConnection(format!(
                    "edge references missing node(s): {:?} -> {:?}",
                    edge.from, edge.to
                ))),
            }
        }

        // 4. Vérifier la compatibilité des types + arité des ports
        Self::validate_type_compatibility(graph, &mut errors);
        Self::validate_input_arity(graph, &mut errors);

        // 5. Vérifier la compatibilité des comptages (sub-graph uniquement —
        //    le graph global n'a pas de node Objects pour définir n_objects)
        if context == GraphContext::SubGraph {
            Self::validate_count_compatibility(graph, &mut errors);
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Vérifie qu'aucun node n'est présent dans un contexte où il n'a pas de sens.
    fn validate_context_compatibility(
        graph: &Graph,
        context: GraphContext,
        errors: &mut Vec<ValidationError>,
    ) {
        for node in graph.nodes.values() {
            let incompatible = match context {
                GraphContext::SubGraph => is_global_only_node(&node.node_type),
                GraphContext::Global => is_subgraph_only_node(&node.node_type),
            };
            if incompatible {
                errors.push(ValidationError::ContextIncompatible(format!(
                    "{:?} is only allowed in {} graphs",
                    node.node_type,
                    match context {
                        GraphContext::SubGraph => "global",
                        GraphContext::Global => "sub-graph",
                    }
                )));
            }
        }
    }

    /// Détecte si le graphe contient des moteurs (sub-graph).
    fn graph_has_engines(graph: &Graph) -> bool {
        graph.nodes.values().any(|n| {
            matches!(
                n.node_type,
                NodeType::Circular
                    | NodeType::Elliptical
                    | NodeType::Spiral
                    | NodeType::Lissajous
                    | NodeType::Figure8
                    | NodeType::Linear
                    | NodeType::Oscillation
                    | NodeType::Formation
                    | NodeType::PerlinNoise
                    | NodeType::Converge
                    | NodeType::Pendulum
                    | NodeType::RoseCurve
                    | NodeType::Helix
                    | NodeType::Bouncing
                    | NodeType::Spring
                    | NodeType::Follow
                    | NodeType::Swarm
                    | NodeType::Avoidance
                    | NodeType::VectorField
                    | NodeType::CustomTrajectory
                    | NodeType::BPM
                    | NodeType::AudioAmplitude
                    | NodeType::TimeFalloff
                    | NodeType::PointDistanceFalloff
                    | NodeType::DirectionalFalloff
                    | NodeType::AudioAmplitudeFalloff
                    | NodeType::Wave
                    // Splines + sources audio/OSC : compilés comme des engines,
                    // ils ont aussi besoin d'Objects/Duration résolubles
                    | NodeType::DrawSpline
                    | NodeType::EvaluateSpline
                    | NodeType::TrimSpline
                    | NodeType::OffsetSpline
                    | NodeType::AudioSpectrum
                    | NodeType::OSCInput
            )
        })
    }

    /// Vérifie si une connexion entre deux types de nœuds est valide
    fn is_valid_connection(from_type: &NodeType, to_type: &NodeType) -> bool {
        match from_type {
            // Moteurs peuvent connecter à Output, Mix, Group, Sequence, Crossfade, modifiers
            NodeType::Circular | NodeType::Elliptical | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
            | NodeType::Linear | NodeType::Oscillation | NodeType::PerlinNoise | NodeType::Formation
            | NodeType::Converge | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix
            | NodeType::CustomTrajectory | NodeType::BPM | NodeType::AudioAmplitude | NodeType::Wave
            | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline => {
                matches!(to_type,
                    NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade |
                    NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
                )
            }

            // DrawSpline = source de données spline, peut alimenter EvaluateSpline/TrimSpline/OffsetSpline
            // ou les mêmes cibles que les moteurs
            NodeType::DrawSpline => {
                matches!(to_type,
                    NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline |
                    NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade |
                    NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
                )
            }

            // Falloffs implémentés
            NodeType::TimeFalloff | NodeType::PointDistanceFalloff => {
                matches!(to_type,
                    NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade |
                    NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
                )
            }

            // Moteurs physique
            NodeType::Bouncing | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance | NodeType::VectorField => {
                matches!(
                    to_type,
                    NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade
                )
            }

            // Splines : DrawSpline est une source (pas d'input), les autres sont des moteurs
            // (déjà couverts par le match des moteurs ci-dessus)

            // Falloffs
            NodeType::DirectionalFalloff | NodeType::AudioAmplitudeFalloff => {
                matches!(to_type, NodeType::Scale | NodeType::Rotate | NodeType::Offset)
            }

            // Modificateurs
            NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
            | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
            // Post-processing nodes (graph global)
            | NodeType::RadiusScale | NodeType::HeightOffset | NodeType::PerTrackDepth
            | NodeType::Barycenter | NodeType::AudioFalloff | NodeType::ManualPosition
            | NodeType::Zone | NodeType::Velocity => {
                matches!(to_type, NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Crossfade
                    | NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
                    | NodeType::RadiusScale | NodeType::HeightOffset | NodeType::PerTrackDepth
                    | NodeType::Barycenter | NodeType::AudioFalloff | NodeType::ManualPosition
                    | NodeType::Zone | NodeType::Velocity)
            }

            // Sources
            NodeType::AudioSpectrum | NodeType::OSCInput => {
                matches!(
                    to_type,
                    NodeType::TimeFalloff | NodeType::AudioAmplitudeFalloff
                        | NodeType::DirectionalFalloff | NodeType::PointDistanceFalloff
                )
            }

            // Structurels
            NodeType::Objects => {
                matches!(to_type, NodeType::Circular | NodeType::Elliptical | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
                    | NodeType::Linear | NodeType::Oscillation | NodeType::Formation | NodeType::PerlinNoise | NodeType::Converge
                    | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix | NodeType::Bouncing
                    | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance | NodeType::VectorField
                    | NodeType::CustomTrajectory | NodeType::Wave
                    | NodeType::BPM | NodeType::AudioAmplitude
                    | NodeType::DrawSpline | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline)
            }
            NodeType::Duration => {
                matches!(to_type, NodeType::Circular | NodeType::Elliptical | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
                    | NodeType::Linear | NodeType::Oscillation | NodeType::Formation | NodeType::PerlinNoise | NodeType::Converge
                    | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix
                    | NodeType::CustomTrajectory | NodeType::Wave
                    | NodeType::BPM | NodeType::AudioAmplitude
                    | NodeType::Bouncing | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance | NodeType::VectorField
                    | NodeType::DrawSpline | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline)
            }
            NodeType::Output => false, // Output n'a pas de sortie
            // Input (graph global) : peut connecter vers n'importe quel post-process node
            NodeType::Input => {
                matches!(to_type,
                    NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
                    | NodeType::RadiusScale | NodeType::HeightOffset | NodeType::PerTrackDepth
                    | NodeType::Barycenter | NodeType::AudioFalloff | NodeType::ManualPosition
                    | NodeType::Zone | NodeType::Velocity
                    | NodeType::Output
                )
            }
            // MoveRef : source qui produit des positions (comme un engine).
            // Peut connecter vers les post-process nodes, Output, et composites.
            NodeType::MoveRef => {
                matches!(to_type,
                    NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
                    | NodeType::RadiusScale | NodeType::HeightOffset | NodeType::PerTrackDepth
                    | NodeType::Barycenter | NodeType::AudioFalloff | NodeType::ManualPosition
                    | NodeType::Zone | NodeType::Velocity
                    | NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Crossfade
                )
            }
            // Merge : équivalent à Input (représente le MergeRuntime).
            NodeType::Merge => {
                matches!(to_type,
                    NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
                    | NodeType::RadiusScale | NodeType::HeightOffset | NodeType::PerTrackDepth
                    | NodeType::Barycenter | NodeType::AudioFalloff | NodeType::ManualPosition
                    | NodeType::Zone | NodeType::Velocity
                    | NodeType::Output
                )
            }
            NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade => {
                // Composites peuvent connecter à Output ou à d'autres composites
                matches!(to_type, NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade)
            }
        }
    }

    /// Vérifie que les noms de ports utilisés par les edges existent pour les types connectés.
    fn validate_type_compatibility(graph: &Graph, errors: &mut Vec<ValidationError>) {
        for edge in &graph.edges {
            let from_node = match graph.nodes.get(&edge.from) {
                Some(n) => n,
                None => continue,
            };
            let to_node = match graph.nodes.get(&edge.to) {
                Some(n) => n,
                None => continue,
            };

            // Un nœud source sans port de sortie (ex. Output) ne peut rien émettre.
            if !Self::has_output_port(&from_node.node_type, &edge.from_port) {
                errors.push(ValidationError::TypeMismatch(format!(
                    "{:?} has no output port '{}'",
                    from_node.node_type, edge.from_port
                )));
            }

            // Le port d'entrée cible doit exister pour le type cible.
            if !Self::has_input_port(&to_node.node_type, &edge.to_port) {
                errors.push(ValidationError::TypeMismatch(format!(
                    "{:?} has no input port '{}', connected from {:?}",
                    to_node.node_type, edge.to_port, from_node.node_type
                )));
            }

            // Un port 'duration' ne peut être alimenté que par un nœud Duration.
            if edge.to_port == "duration" && from_node.node_type != NodeType::Duration {
                errors.push(ValidationError::TypeMismatch(format!(
                    "Only Duration can connect to a 'duration' port, got {:?}",
                    from_node.node_type
                )));
            }
        }
    }

    /// Indique si un type de nœud expose un port de sortie avec ce nom.
    fn has_output_port(node_type: &NodeType, port: &str) -> bool {
        match node_type {
            // Output est terminal : il n'a pas de sortie.
            NodeType::Output => false,
            // Tous les autres nœuds émettent actuellement sur un seul port "output".
            _ if port == "output" => true,
            _ => false,
        }
    }

    /// Indique si un type de nœud expose un port d'entrée avec ce nom.
    fn has_input_port(node_type: &NodeType, port: &str) -> bool {
        let inputs: &[&str] = match node_type {
            // Sources / terminaux : aucune entrée
            NodeType::Objects
            | NodeType::Duration
            | NodeType::AudioSpectrum
            | NodeType::OSCInput
            | NodeType::Input
            | NodeType::MoveRef
            | NodeType::Merge => &[],

            // Moteurs : entrée générale + durée depuis un nœud Duration
            NodeType::Circular
            | NodeType::Elliptical
            | NodeType::Spiral
            | NodeType::Lissajous
            | NodeType::Figure8
            | NodeType::Linear
            | NodeType::Oscillation
            | NodeType::Formation
            | NodeType::PerlinNoise
            | NodeType::Converge
            | NodeType::Pendulum
            | NodeType::RoseCurve
            | NodeType::Helix
            | NodeType::Bouncing
            | NodeType::Spring
            | NodeType::Follow
            | NodeType::Swarm
            | NodeType::Avoidance
            | NodeType::VectorField
            | NodeType::CustomTrajectory
            | NodeType::Wave
            | NodeType::BPM
            | NodeType::AudioAmplitude
            | NodeType::TimeFalloff
            | NodeType::PointDistanceFalloff
            | NodeType::DirectionalFalloff
            | NodeType::AudioAmplitudeFalloff
            | NodeType::DrawSpline => &["input", "duration"],

            // Modificateurs : une seule entrée
            NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::PhaseShift
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter
            | NodeType::RadiusScale
            | NodeType::HeightOffset
            | NodeType::PerTrackDepth
            | NodeType::Barycenter
            | NodeType::AudioFalloff
            | NodeType::ManualPosition
            | NodeType::Zone
            | NodeType::Velocity
            | NodeType::Output => &["input"],

            // Splines : input (trajectoire/objets) + spline (données depuis
            // DrawSpline) + duration. Sans le port 'spline' dédié, DrawSpline
            // et Objects se disputent 'input' → arité invalide.
            NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline => {
                &["input", "duration", "spline"]
            }

            // Composites binaires : acceptent input, input_a, input_b
            // (input_a/input_b sont les ports visuels A/B ; le compiler
            // résout A/B par nom de port via Graph::get_binary_inputs)
            NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade => {
                &["input", "input_a", "input_b"]
            }
        };
        inputs.contains(&port)
    }

    /// Vérifie l'arité des entrées :
    /// - au plus 1 edge par port d'entrée nommé (deux edges sur "input" sont
    ///   silencieusement réduits à un par le compiler — erreur ici)
    /// - les composites binaires exigent exactement 2 entrées
    fn validate_input_arity(graph: &Graph, errors: &mut Vec<ValidationError>) {
        for node in graph.nodes.values() {
            let incoming: Vec<&crate::graph::Edge> =
                graph.edges.iter().filter(|e| e.to == node.id).collect();

            // Un même port ne peut recevoir qu'un seul edge
            let mut port_counts: std::collections::HashMap<&str, usize> =
                std::collections::HashMap::new();
            for e in &incoming {
                *port_counts.entry(e.to_port.as_str()).or_insert(0) += 1;
            }
            for (port, count) in port_counts {
                if count > 1 {
                    errors.push(ValidationError::TypeMismatch(format!(
                        "{:?} input port '{port}' receives {count} edges — only one allowed",
                        node.node_type
                    )));
                }
            }

            // Les composites binaires exigent exactement 2 entrées
            if matches!(
                node.node_type,
                NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade
            ) && incoming.len() != 2
            {
                errors.push(ValidationError::InvalidConnection(format!(
                    "{:?} requires exactly 2 trajectory inputs, got {}",
                    node.node_type,
                    incoming.len()
                )));
            }
        }
    }

    /// Vérifie la compatibilité des comptages (n_objects)
    fn validate_count_compatibility(graph: &Graph, errors: &mut Vec<ValidationError>) {
        // Trouver le nœud Objects
        let objects_node = graph
            .nodes
            .values()
            .find(|n| n.node_type == NodeType::Objects);

        if let Some(objects_node) = objects_node {
            let n_objects = objects_node
                .params
                .get("n_objects")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as usize;

            // Vérifier que tous les moteurs ont le même n_objects
            for node in graph.nodes.values() {
                match node.node_type {
                    NodeType::Circular
                    | NodeType::Elliptical
                    | NodeType::Spiral
                    | NodeType::Lissajous
                    | NodeType::Figure8
                    | NodeType::Linear
                    | NodeType::Oscillation
                    | NodeType::Formation
                    | NodeType::PerlinNoise
                    | NodeType::Converge
                    | NodeType::Pendulum
                    | NodeType::RoseCurve
                    | NodeType::Helix
                    | NodeType::Bouncing
                    | NodeType::Spring
                    | NodeType::Follow
                    | NodeType::Swarm
                    | NodeType::Avoidance
                    | NodeType::VectorField
                    | NodeType::CustomTrajectory
                    | NodeType::Wave
                    | NodeType::DrawSpline
                    | NodeType::EvaluateSpline
                    | NodeType::TrimSpline
                    | NodeType::OffsetSpline => {
                        let node_n_objects =
                            node.params
                                .get("n_objects")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(n_objects as u64) as usize;

                        if node_n_objects != n_objects {
                            errors.push(ValidationError::CountMismatch(format!(
                                "Objects has {} but {:?} has {}",
                                n_objects, node.node_type, node_n_objects
                            )));
                        }
                    }
                    // Mix : les deux entrées doivent avoir le même n_objects
                    NodeType::Mix => {
                        let inputs = graph.get_inputs(node.id);
                        if inputs.len() >= 2 {
                            let node_a = graph.nodes.get(&inputs[0]);
                            let node_b = graph.nodes.get(&inputs[1]);

                            if let (Some(na), Some(nb)) = (node_a, node_b) {
                                let n_a =
                                    na.params
                                        .get("n_objects")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(1) as usize;
                                let n_b =
                                    nb.params
                                        .get("n_objects")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(1) as usize;

                                if n_a != n_b {
                                    errors.push(ValidationError::CountMismatch(format!(
                                        "Mix node: input A has {n_a} objects but input B has {n_b} objects"
                                    )));
                                }
                            }
                        }
                    }
                    // Sequence : les deux entrées doivent avoir le même n_objects
                    NodeType::Sequence => {
                        let inputs = graph.get_inputs(node.id);
                        if inputs.len() >= 2 {
                            let node_a = graph.nodes.get(&inputs[0]);
                            let node_b = graph.nodes.get(&inputs[1]);

                            if let (Some(na), Some(nb)) = (node_a, node_b) {
                                let n_a =
                                    na.params
                                        .get("n_objects")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(1) as usize;
                                let n_b =
                                    nb.params
                                        .get("n_objects")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(1) as usize;

                                if n_a != n_b {
                                    errors.push(ValidationError::CountMismatch(format!(
                                        "Sequence node: input A has {n_a} objects but input B has {n_b} objects"
                                    )));
                                }
                            }
                        }
                    }
                    // Group : les n_objects peuvent être différents (concaténation)
                    NodeType::Group => {
                        // Pas de validation spécifique pour Group
                    }
                    _ => {}
                }
            }
        }
    }
}

/// Vrai si le node n'a de sens que dans le graph global (post-processing).
fn is_global_only_node(node_type: &NodeType) -> bool {
    matches!(
        node_type,
        NodeType::Input
            | NodeType::MoveRef
            | NodeType::Merge
            | NodeType::RadiusScale
            | NodeType::HeightOffset
            | NodeType::PerTrackDepth
            | NodeType::Barycenter
            | NodeType::AudioFalloff
            | NodeType::ManualPosition
            | NodeType::Zone
            | NodeType::Velocity
    )
}

/// Vrai si le node n'a de sens que dans un sub-graph (mouvement).
fn is_subgraph_only_node(node_type: &NodeType) -> bool {
    matches!(
        node_type,
        // Structurels sub-graph
        NodeType::Objects
            | NodeType::Duration
            // Moteurs math
            | NodeType::Circular
            | NodeType::Elliptical
            | NodeType::Spiral
            | NodeType::Lissajous
            | NodeType::Figure8
            | NodeType::Linear
            | NodeType::Oscillation
            | NodeType::Formation
            | NodeType::PerlinNoise
            | NodeType::Converge
            | NodeType::Pendulum
            | NodeType::RoseCurve
            | NodeType::Helix
            // Moteurs physique
            | NodeType::Bouncing
            | NodeType::Spring
            | NodeType::Follow
            | NodeType::Swarm
            | NodeType::Avoidance
            | NodeType::VectorField
            // Splines
            | NodeType::DrawSpline
            | NodeType::EvaluateSpline
            | NodeType::TrimSpline
            | NodeType::OffsetSpline
            | NodeType::CustomTrajectory
            // Falloffs
            | NodeType::TimeFalloff
            | NodeType::PointDistanceFalloff
            | NodeType::DirectionalFalloff
            | NodeType::AudioAmplitudeFalloff
            // Sources
            | NodeType::BPM
            | NodeType::AudioAmplitude
            | NodeType::AudioSpectrum
            | NodeType::OSCInput
            | NodeType::Wave
            // Modifiers/compilables uniquement dans un sub-graph : absents de
            // is_post_process_node → un graph global les accepterait à la
            // validation puis échouerait à la compile.
            | NodeType::PhaseShift
            | NodeType::LFO
            | NodeType::Jitter
            // Composites binaires : le graph global est une chaîne linéaire
            // (pas de sémantique A/B en post-processing).
            | NodeType::Mix
            | NodeType::Group
            | NodeType::Sequence
            | NodeType::Crossfade
    )
}
