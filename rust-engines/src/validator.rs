use crate::graph::{Graph, Node, NodeId, NodeType};
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
    /// Graph de modulation — domaine scalaire (Signal* nodes uniquement).
    /// Produit des deltas de macros, pas des positions.
    Signal,
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
    /// Graphe trop grand/profond — rejeté avant toute traversée récursive
    /// (un stack overflow = abort du process entier, cf. audit B2).
    TooComplex(String),
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
            ValidationError::TooComplex(msg) => write!(f, "graph too complex: {msg}"),
        }
    }
}

/// Résultat de validation
pub type ValidationResult = Result<(), Vec<ValidationError>>;

/// Bornes dures anti-DoS / anti-stack-overflow (audit B2). Le compile
/// (`compile_node`) et l'évaluation de la closure compilée sont récursifs
/// en profondeur de DAG ; un stack overflow tue le process entier
/// (SIGSEGV — catch_unwind ne peut pas l'intercepter). Tout graphe
/// dépassant ces bornes est rejeté avant toute traversée.
pub const MAX_GRAPH_NODES: usize = 512;
pub const MAX_GRAPH_EDGES: usize = 4096;
pub const MAX_DAG_DEPTH: usize = 128;
/// Borne sur l'expansion DAG→arbre : `compile_node` n'a pas de
/// mémoïsation — un node partagé par K parents est compilé et évalué
/// K fois (Mix(a,a) à chaque niveau → 2^profondeur). Le compte de
/// chemins sature à cette valeur → rejet au lieu d'exploser.
pub const MAX_EXPANDED_PATHS: u64 = 8192;

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
        Self::validate_with_plugin_kinds(graph, context, &std::collections::HashMap::new())
    }

    /// Validation kind-aware : `plugin_kinds` associe chaque node Plugin à
    /// son `PluginKind` résolu dans le registry (compiler). Sans entrée
    /// pour un node Plugin, les règles restent permissives (superset des
    /// ports) — l'arité exacte est garantie au compile.
    pub(crate) fn validate_with_plugin_kinds(
        graph: &Graph,
        context: GraphContext,
        plugin_kinds: &std::collections::HashMap<crate::graph::NodeId, crate::plugins::PluginKind>,
    ) -> ValidationResult {
        let mut errors = Vec::new();

        // -1. Bornes dures AVANT toute traversée récursive (has_cycle est
        // itératif mais le compile/éval downstream ne le sont pas —
        // stack overflow = abort du process, cf. audit B2).
        Self::check_complexity(graph, &mut errors);

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
            GraphContext::Signal => {
                // Le terminal du domaine signal est SignalOut — un graph
                // sans sink compile mais ne produit aucun delta.
                let has_out = graph
                    .nodes
                    .values()
                    .any(|n| n.node_type == NodeType::SignalOut);
                if !has_out {
                    errors.push(ValidationError::MissingRequiredNode(NodeType::SignalOut));
                }
            }
        }

        // Output est obligatoire dans les domaines trajectoire — le graph
        // signal termine sur SignalOut.
        if context != GraphContext::Signal
            && !graph
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
                    } else if !Self::is_valid_connection(
                        &from_node.node_type,
                        &to_node.node_type,
                        plugin_kinds.get(&to_node.id).copied(),
                    ) {
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
        Self::validate_type_compatibility(graph, &mut errors, plugin_kinds);
        Self::validate_input_arity(graph, context, &mut errors, plugin_kinds);

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
    /// Bornes dures sur la taille et la profondeur du graphe — passent
    /// avant tout le reste. Entièrement itératif (Kahn) : safe même sur
    /// un graphe cyclique (les nœuds dans le cycle restent à degré > 0 et
    /// ne contribuent ni profondeur ni chemins — le cycle est signalé
    /// par has_cycle juste après).
    fn check_complexity(graph: &Graph, errors: &mut Vec<ValidationError>) {
        if graph.nodes.len() > MAX_GRAPH_NODES {
            errors.push(ValidationError::TooComplex(format!(
                "{} nodes (max {MAX_GRAPH_NODES})",
                graph.nodes.len()
            )));
        }
        if graph.edges.len() > MAX_GRAPH_EDGES {
            errors.push(ValidationError::TooComplex(format!(
                "{} edges (max {MAX_GRAPH_EDGES})",
                graph.edges.len()
            )));
        }
        if graph.nodes.is_empty() {
            return;
        }

        // Ordre topologique (Kahn) → profondeur max du DAG + nombre de
        // chemins saturé. paths[v] = somme des chemins des parents — la
        // valeur exacte du nombre de fois que compile_node compilerait v.
        let mut indegree: std::collections::HashMap<crate::graph::NodeId, usize> =
            std::collections::HashMap::with_capacity(graph.nodes.len());
        for e in &graph.edges {
            if graph.nodes.contains_key(&e.from) && graph.nodes.contains_key(&e.to) {
                *indegree.entry(e.to).or_insert(0) += 1;
            }
        }
        let mut queue: std::collections::VecDeque<crate::graph::NodeId> = graph
            .nodes
            .keys()
            .filter(|id| !indegree.contains_key(id))
            .copied()
            .collect();
        let mut depth: std::collections::HashMap<crate::graph::NodeId, usize> =
            std::collections::HashMap::with_capacity(graph.nodes.len());
        let mut paths: std::collections::HashMap<crate::graph::NodeId, u64> =
            std::collections::HashMap::with_capacity(graph.nodes.len());
        let mut max_depth = 0usize;
        let mut total_paths: u64 = 0;
        while let Some(id) = queue.pop_front() {
            let d = *depth.get(&id).unwrap_or(&0);
            let p = *paths.get(&id).unwrap_or(&1);
            if d > max_depth {
                max_depth = d;
            }
            total_paths = total_paths.saturating_add(p);
            if max_depth > MAX_DAG_DEPTH && total_paths > MAX_EXPANDED_PATHS {
                break; // les deux bornes saturées — plus rien à mesurer
            }
            for succ in graph.get_outputs(id) {
                let nd = d + 1;
                let e = depth.entry(succ).or_insert(0);
                if nd > *e {
                    *e = nd;
                }
                let pe = paths.entry(succ).or_insert(0);
                *pe = pe.saturating_add(p).min(MAX_EXPANDED_PATHS + 1);
                if let Some(deg) = indegree.get_mut(&succ) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(succ);
                    }
                }
            }
        }
        if max_depth > MAX_DAG_DEPTH {
            errors.push(ValidationError::TooComplex(format!(
                "DAG depth {max_depth} (max {MAX_DAG_DEPTH})"
            )));
        }
        if total_paths > MAX_EXPANDED_PATHS {
            errors.push(ValidationError::TooComplex(format!(
                "expanded path count exceeds {MAX_EXPANDED_PATHS} (shared sub-DAGs multiply compile work)"
            )));
        }
    }

    fn validate_context_compatibility(
        graph: &Graph,
        context: GraphContext,
        errors: &mut Vec<ValidationError>,
    ) {
        for node in graph.nodes.values() {
            let incompatible = match context {
                GraphContext::SubGraph => {
                    is_global_only_node(&node.node_type) || is_signal_node(&node.node_type)
                }
                GraphContext::Global => {
                    is_subgraph_only_node(&node.node_type) || is_signal_node(&node.node_type)
                }
                GraphContext::Signal => !is_signal_node(&node.node_type),
            };
            if incompatible {
                let allowed = match crate::node_spec::node_spec(&node.node_type).scope {
                    crate::node_spec::NodeScope::SubOnly => "sub-graph",
                    crate::node_spec::NodeScope::GlobalOnly => "global",
                    crate::node_spec::NodeScope::Both => "sub-graph or global",
                    crate::node_spec::NodeScope::SignalOnly => "signal",
                };
                errors.push(ValidationError::ContextIncompatible(format!(
                    "{:?} is only allowed in {allowed} graphs",
                    node.node_type
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
                    | NodeType::Plugin
            )
        })
    }

    /// Un type produit une trajectoire connectable à un modifier natif —
    /// dérivé du `NodeSpec` (node_spec.rs), anciennement une liste explicite.
    fn feeds_modifier(t: &NodeType) -> bool {
        crate::node_spec::node_spec(t).feeds_modifier()
    }

    /// Un type produit une trajectoire connectable à un composite natif —
    /// feeds_modifier + physics + composites, moins les falloffs limités.
    fn feeds_composite(t: &NodeType) -> bool {
        crate::node_spec::node_spec(t).feeds_composite()
    }

    /// Vérifie si une connexion entre deux types de nœuds est valide —
    /// délégué au `Feeds` déclaratif du `NodeSpec` (node_spec.rs).
    fn is_valid_connection(
        from_type: &NodeType,
        to_type: &NodeType,
        to_plugin_kind: Option<crate::plugins::PluginKind>,
    ) -> bool {
        use crate::node_spec::node_spec;
        // Plugin WASM : le kind du manifeste détermine qui peut l'alimenter.
        // Kind inconnu (registry non branché) → permissif ; l'arité exacte
        // est garantie au compile.
        if *to_type == NodeType::Plugin {
            use crate::plugins::PluginKind as K;
            return match to_plugin_kind {
                Some(K::Engine) => {
                    matches!(from_type, NodeType::Objects | NodeType::Duration)
                }
                Some(K::Modifier) => Self::feeds_modifier(from_type),
                Some(K::Composite) => Self::feeds_composite(from_type),
                None => {
                    matches!(from_type, NodeType::Objects | NodeType::Duration)
                        || Self::feeds_composite(from_type)
                }
            };
        }
        node_spec(from_type).can_feed(node_spec(to_type))
    }

    /// Vérifie que les noms de ports utilisés par les edges existent pour les types connectés.
    fn validate_type_compatibility(
        graph: &Graph,
        errors: &mut Vec<ValidationError>,
        plugin_kinds: &std::collections::HashMap<crate::graph::NodeId, crate::plugins::PluginKind>,
    ) {
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
            if !Self::has_input_port(
                &to_node.node_type,
                &edge.to_port,
                plugin_kinds.get(&to_node.id).copied(),
            ) {
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

    /// Indique si un type de nœud expose un port de sortie avec ce nom —
    /// dérivé de `NodeSpec::outputs` (Output est le seul terminal).
    fn has_output_port(node_type: &NodeType, port: &str) -> bool {
        crate::node_spec::node_spec(node_type)
            .outputs
            .iter()
            .any(|p| p == port)
    }

    /// Indique si un type de nœud expose un port d'entrée avec ce nom.
    /// `plugin_kind` : kind résolu du manifeste pour les nodes Plugin —
    /// engine → input+duration, modifier → input, composite → input_a/b.
    /// Kind inconnu → superset permissif.
    fn has_input_port(
        node_type: &NodeType,
        port: &str,
        plugin_kind: Option<crate::plugins::PluginKind>,
    ) -> bool {
        // Plugin : ports dictés par le kind du manifeste (ABI v2).
        if *node_type == NodeType::Plugin {
            use crate::plugins::PluginKind as K;
            let inputs: &[&str] = match plugin_kind {
                Some(K::Engine) => &["input", "duration"],
                Some(K::Modifier) => &["input"],
                Some(K::Composite) => &["input", "input_a", "input_b"],
                None => &["input", "input_a", "input_b", "duration"],
            };
            return inputs.contains(&port);
        }
        // Natifs : ports déclarés dans le NodeSpec (node_spec.rs).
        crate::node_spec::node_spec(node_type)
            .inputs
            .iter()
            .any(|p| p == port)
    }

    /// Vérifie l'arité des entrées :
    /// - au plus 1 edge par port d'entrée nommé (deux edges sur "input" sont
    ///   silencieusement réduits à un par le compiler — erreur ici)
    /// - les composites binaires exigent exactement 2 entrées
    /// - Output et les modifiers exigent au moins 1 entrée (sinon le compile
    ///   échoue tard avec OutputNotConnected / MissingParameter)
    /// - chaque engine doit pouvoir résoudre n_objects (param propre ou
    ///   edge Objects direct — même convention que Compiler::resolve_n_objects)
    fn validate_input_arity(
        graph: &Graph,
        context: GraphContext,
        errors: &mut Vec<ValidationError>,
        plugin_kinds: &std::collections::HashMap<crate::graph::NodeId, crate::plugins::PluginKind>,
    ) {
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

            // SignalOut déconnecté = sink mort — le graph compile mais ne
            // produit rien (même règle qu'Output).
            if node.node_type == NodeType::SignalOut && incoming.is_empty() {
                errors.push(ValidationError::InvalidConnection(
                    "SignalOut requires a signal input, got 0".to_string(),
                ));
            }

            // Output et les modifiers exigent une entrée — sinon le compile
            // échoue tard (OutputNotConnected / MissingParameter).
            if matches!(
                node.node_type,
                NodeType::Output
                    | NodeType::Scale
                    | NodeType::Rotate
                    | NodeType::Offset
                    | NodeType::PhaseShift
                    | NodeType::Mirror
                    | NodeType::Clamp
                    | NodeType::LFO
                    | NodeType::Jitter
            ) && incoming.is_empty()
            {
                errors.push(ValidationError::InvalidConnection(format!(
                    "{:?} requires a trajectory input, got 0",
                    node.node_type
                )));
            }

            // Plugin kind-aware : modifier/composite exigent leurs entrées
            // trajectoire (hors carriers Objects/Duration) ; un engine
            // plugin n'en accepte aucune — une edge trajectoire vers un
            // engine serait silencieusement ignorée au compile.
            if node.node_type == NodeType::Plugin {
                use crate::plugins::PluginKind as K;
                let kind = plugin_kinds.get(&node.id).copied();
                let traj_count = incoming
                    .iter()
                    .filter(|e| matches!(e.to_port.as_str(), "input" | "input_a" | "input_b"))
                    .filter(|e| {
                        !matches!(
                            graph.nodes.get(&e.from).map(|n| &n.node_type),
                            Some(NodeType::Objects) | Some(NodeType::Duration)
                        )
                    })
                    .count();
                match kind {
                    Some(K::Modifier) if traj_count == 0 => {
                        errors.push(ValidationError::InvalidConnection(
                            "Plugin (modifier) requires 1 trajectory input, got 0".to_string(),
                        ));
                    }
                    Some(K::Composite) if traj_count != 2 => {
                        errors.push(ValidationError::InvalidConnection(format!(
                            "Plugin (composite) requires exactly 2 trajectory inputs, got {traj_count}"
                        )));
                    }
                    Some(K::Engine) if traj_count > 0 => {
                        errors.push(ValidationError::InvalidConnection(format!(
                            "Plugin (engine) takes no trajectory input, got {traj_count}"
                        )));
                    }
                    _ => {}
                }
            }

            // Chaque engine doit résoudre n_objects avec la même convention
            // que le compiler : param propre, sinon edge direct depuis un
            // node Objects. Sans les deux, MissingParameter au compile.
            // Plugin modifier/composite : n_objects propage depuis
            // l'upstream (pas de port 'duration' → règle déjà court-circuitée).
            if context == GraphContext::SubGraph
                && !(node.node_type == NodeType::Plugin
                    && plugin_kinds.get(&node.id).copied()
                        != Some(crate::plugins::PluginKind::Engine))
                && Self::has_input_port(
                    &node.node_type,
                    "duration",
                    plugin_kinds.get(&node.id).copied(),
                )
                && node
                    .params
                    .get("n_objects")
                    .and_then(|v| v.as_u64())
                    .is_none()
                && !incoming.iter().any(|e| {
                    matches!(graph.nodes.get(&e.from), Some(n) if n.node_type == NodeType::Objects)
                })
            {
                errors.push(ValidationError::InvalidConnection(format!(
                    "{:?} has no Objects input and no n_objects parameter",
                    node.node_type
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

            // Résolution identique au compiler (resolve_n_objects) : param
            // propre → Objects amont → propagation à travers modifiers
            // (entrée unique) et composites (Group somme a+b, les autres
            // délèguent à input_a) → défaut = le n_objects global du graphe.
            fn effective_n_objects(graph: &Graph, node: &Node, fallback: u64, depth: usize) -> u64 {
                if depth > 64 {
                    return fallback;
                }
                if let Some(v) = node.params.get("n_objects").and_then(|v| v.as_u64()) {
                    return v;
                }
                let inputs = graph.get_inputs(node.id);
                if let Some(v) = inputs
                    .iter()
                    .filter_map(|id| graph.nodes.get(id))
                    .find(|n| n.node_type == NodeType::Objects)
                    .and_then(|n| n.params.get("n_objects").and_then(|v| v.as_u64()))
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
                        .map(|n| effective_n_objects(graph, n, fallback, depth + 1))
                        .unwrap_or(fallback),
                    NodeType::Group => graph
                        .get_binary_inputs(node.id)
                        .iter()
                        .take(2)
                        .filter_map(|id| graph.nodes.get(id))
                        .map(|n| effective_n_objects(graph, n, fallback, depth + 1))
                        .sum(),
                    NodeType::Mix | NodeType::Sequence | NodeType::Crossfade => graph
                        .get_binary_inputs(node.id)
                        .first()
                        .and_then(|id| graph.nodes.get(id))
                        .map(|n| effective_n_objects(graph, n, fallback, depth + 1))
                        .unwrap_or(fallback),
                    // Plugin : modifier/composite propagent depuis l'entrée
                    // trajectoire (input_a en priorité, sinon 'input') — les
                    // carriers Objects/Duration sont déjà résolus au-dessus.
                    NodeType::Plugin => graph
                        .edges
                        .iter()
                        .filter(|e| e.to == node.id)
                        .filter(|e| matches!(e.to_port.as_str(), "input_a" | "input" | "input_b"))
                        .filter(|e| {
                            !matches!(
                                graph.nodes.get(&e.from).map(|n| &n.node_type),
                                Some(NodeType::Objects) | Some(NodeType::Duration)
                            )
                        })
                        .min_by_key(|e| match e.to_port.as_str() {
                            "input_a" => 0,
                            "input" => 1,
                            _ => 2,
                        })
                        .and_then(|e| graph.nodes.get(&e.from))
                        .map(|n| effective_n_objects(graph, n, fallback, depth + 1))
                        .unwrap_or(fallback),
                    _ => fallback,
                }
            }
            let resolve = |node: &Node| -> usize {
                effective_n_objects(graph, node, n_objects as u64, 0) as usize
            };

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

                        // T3 : les engines à interaction mutuelle coûtent
                        // O(n²) par pas de simulation — au-delà de
                        // MAX_INTERACTION_AGENTS un frame à 60 FPS ne tient
                        // plus. Refus à la validation plutôt qu'un lag live.
                        if matches!(node.node_type, NodeType::Swarm | NodeType::Avoidance)
                            && node_n_objects > crate::engines::MAX_INTERACTION_AGENTS
                        {
                            errors.push(ValidationError::TooComplex(format!(
                                "{:?} with {} agents exceeds the O(n²) per-step budget \
                                 (max {} interaction agents)",
                                node.node_type,
                                node_n_objects,
                                crate::engines::MAX_INTERACTION_AGENTS
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
                                let n_a = resolve(na);
                                let n_b = resolve(nb);

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
                                let n_a = resolve(na);
                                let n_b = resolve(nb);

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
    crate::node_spec::node_spec(node_type).scope == crate::node_spec::NodeScope::GlobalOnly
}

/// Vrai si le node n'a de sens que dans un sub-graph (mouvement).
/// Dérivé de `NodeSpec::scope` — inclut les modifiers non compilables en
/// post-process (PhaseShift agit sur le temps) et les composites binaires (le
/// graph global est une chaîne linéaire, pas de sémantique A/B).
fn is_subgraph_only_node(node_type: &NodeType) -> bool {
    crate::node_spec::node_spec(node_type).scope == crate::node_spec::NodeScope::SubOnly
}

/// Vrai si le node appartient au domaine signal (scope SignalOnly).
fn is_signal_node(node_type: &NodeType) -> bool {
    crate::node_spec::node_spec(node_type).scope == crate::node_spec::NodeScope::SignalOnly
}
