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
        let errors = Self::validate_detailed(graph, context, plugin_kinds);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.into_iter().map(|(e, _)| e).collect())
        }
    }

    /// Même validation que `validate_with_plugin_kinds` mais chaque erreur
    /// emporte les `NodeId` concernés — consommé par `diagnose`.
    pub(crate) fn validate_detailed(
        graph: &Graph,
        context: GraphContext,
        plugin_kinds: &std::collections::HashMap<crate::graph::NodeId, crate::plugins::PluginKind>,
    ) -> Vec<(ValidationError, Vec<NodeId>)> {
        let mut errors: Vec<(ValidationError, Vec<NodeId>)> = Vec::new();

        // -1. Bornes dures AVANT toute traversée récursive (has_cycle est
        // itératif mais le compile/éval downstream ne le sont pas —
        // stack overflow = abort du process, cf. audit B2).
        Self::check_complexity(graph, &mut errors);

        // 0. Vérifier que les nodes sont compatibles avec le contexte
        Self::validate_context_compatibility(graph, context, &mut errors);

        // 1. Vérifier les cycles
        if graph.has_cycle() {
            errors.push((ValidationError::CycleDetected, cycle_nodes(graph)));
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
                            errors.push((
                                ValidationError::MissingRequiredNode(required_type),
                                vec![],
                            ));
                        }
                    }
                }
            }
            GraphContext::Global => {
                // Pas d'Objects/Duration requis en global ; le graph global
                // a juste besoin d'un Output et d'au moins une source
                // (Input, Merge, ou MoveRef).
                let has_source = graph
                    .nodes
                    .values()
                    .any(|n| matches!(n.node_type, NodeType::Merge | NodeType::MoveRef));
                if !has_source {
                    errors.push((
                        ValidationError::MissingRequiredNode(NodeType::Merge),
                        vec![],
                    ));
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
                    errors.push((
                        ValidationError::MissingRequiredNode(NodeType::SignalOut),
                        vec![],
                    ));
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
            errors.push((
                ValidationError::MissingRequiredNode(NodeType::Output),
                vec![],
            ));
        }

        // Un seul node Objects — plusieurs seraient ambigus (le parser
        // résoudrait n_objects de façon non déterministe via HashMap::find).
        let objects_ids: Vec<NodeId> = graph
            .nodes
            .values()
            .filter(|n| n.node_type == NodeType::Objects)
            .map(|n| n.id)
            .collect();
        let objects_count = objects_ids.len();
        if objects_count > 1 {
            errors.push((
                ValidationError::InvalidConnection(format!(
                    "{objects_count} Objects nodes found — at most one is allowed"
                )),
                objects_ids.clone(),
            ));
        }

        let duration_ids: Vec<NodeId> = graph
            .nodes
            .values()
            .filter(|n| n.node_type == NodeType::Duration)
            .map(|n| n.id)
            .collect();
        let duration_count = duration_ids.len();
        if duration_count > 1 {
            errors.push((
                ValidationError::InvalidConnection(
                    "Multiple Duration nodes in a subgraph (1 allowed)".to_string(),
                ),
                duration_ids.clone(),
            ));
        }

        // 3. Vérifier les endpoints existants + doublons + self-loops.
        // La légalité de la connexion elle-même est évaluée au niveau PORT
        // dans validate_type_compatibility (existence + égalité de type).
        let mut seen_edges: HashSet<(NodeId, NodeId, &str, &str)> = HashSet::new();
        for edge in &graph.edges {
            if !seen_edges.insert((edge.from, edge.to, &edge.from_port, &edge.to_port)) {
                errors.push((
                    ValidationError::InvalidConnection(format!(
                        "duplicate edge {:?} -> {:?} ({} -> {})",
                        edge.from, edge.to, edge.from_port, edge.to_port
                    )),
                    vec![edge.from, edge.to],
                ));
            }
            match (graph.nodes.get(&edge.from), graph.nodes.get(&edge.to)) {
                (Some(from_node), _) if edge.from == edge.to => {
                    errors.push((
                        ValidationError::InvalidConnection(format!(
                            "self-loop on {:?} is not allowed",
                            from_node.node_type
                        )),
                        vec![edge.from],
                    ));
                }
                (None, _) | (_, None) => {
                    errors.push((
                        ValidationError::InvalidConnection(format!(
                            "edge references missing node(s): {:?} -> {:?}",
                            edge.from, edge.to
                        )),
                        vec![],
                    ));
                }
                _ => {}
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

        // 6. Règles structurelles du graph global : chaîne source →
        //    transforms → Output, capteurs branchés sur le dernier node.
        if context == GraphContext::Global {
            Self::validate_global_chain(graph, &mut errors);
        }

        errors
    }

    /// Vérifie qu'aucun node n'est présent dans un contexte où il n'a pas de sens.
    /// Bornes dures sur la taille et la profondeur du graphe — passent
    /// avant tout le reste. Entièrement itératif (Kahn) : safe même sur
    /// un graphe cyclique (les nœuds dans le cycle restent à degré > 0 et
    /// ne contribuent ni profondeur ni chemins — le cycle est signalé
    /// par has_cycle juste après).
    fn check_complexity(graph: &Graph, errors: &mut Vec<(ValidationError, Vec<NodeId>)>) {
        if graph.nodes.len() > MAX_GRAPH_NODES {
            errors.push((
                ValidationError::TooComplex(format!(
                    "{} nodes (max {MAX_GRAPH_NODES})",
                    graph.nodes.len()
                )),
                vec![],
            ));
        }
        if graph.edges.len() > MAX_GRAPH_EDGES {
            errors.push((
                ValidationError::TooComplex(format!(
                    "{} edges (max {MAX_GRAPH_EDGES})",
                    graph.edges.len()
                )),
                vec![],
            ));
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
            errors.push((
                ValidationError::TooComplex(format!("DAG depth {max_depth} (max {MAX_DAG_DEPTH})")),
                vec![],
            ));
        }
        if total_paths > MAX_EXPANDED_PATHS {
            errors.push((ValidationError::TooComplex(format!(
                "expanded path count exceeds {MAX_EXPANDED_PATHS} (shared sub-DAGs multiply compile work)"
            )), vec![]));
        }
    }

    fn validate_context_compatibility(
        graph: &Graph,
        context: GraphContext,
        errors: &mut Vec<(ValidationError, Vec<NodeId>)>,
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
                errors.push((
                    ValidationError::ContextIncompatible(format!(
                        "{:?} is only allowed in {allowed} graphs",
                        node.node_type
                    )),
                    vec![node.id],
                ));
            }
        }
    }

    /// Détecte si le graphe contient des engines — dérivé des ports :
    /// tout node consommant un `ObjectSet` a besoin d'Objects résolubles
    /// (engines, physics, splines, falloffs, sources, plugins engine).
    fn graph_has_engines(graph: &Graph) -> bool {
        graph.nodes.values().any(|n| {
            crate::node_spec::node_spec(&n.node_type)
                .has_input_type(crate::node_spec::PortType::ObjectSet)
        })
    }

    /// Ports d'entrée effectifs d'un node — le `PluginKind` du manifeste
    /// restreint le superset déclaré pour les plugins ; `None` (kind non
    /// résolu) retourne le superset permissif.
    fn effective_input_ports(
        node_type: &NodeType,
        plugin_kind: Option<crate::plugins::PluginKind>,
    ) -> Vec<crate::node_spec::PortDef> {
        if *node_type == NodeType::Plugin {
            return crate::node_spec::NodeSpec::plugin_input_ports(plugin_kind);
        }
        crate::node_spec::node_spec(node_type).inputs.clone()
    }

    /// La règle de connexion unique : les deux ports existent et portent
    /// le même `PortType`. C'est tout — pas de matrice de catégories, pas
    /// de cas particulier : `Objects` ne peut alimenter qu'un port
    /// `ObjectSet` parce que son unique sortie est typée `ObjectSet`, etc.
    fn validate_type_compatibility(
        graph: &Graph,
        errors: &mut Vec<(ValidationError, Vec<NodeId>)>,
        plugin_kinds: &std::collections::HashMap<crate::graph::NodeId, crate::plugins::PluginKind>,
    ) {
        for edge in &graph.edges {
            let (Some(from_node), Some(to_node)) =
                (graph.nodes.get(&edge.from), graph.nodes.get(&edge.to))
            else {
                continue;
            };

            let from_port =
                crate::node_spec::node_spec(&from_node.node_type).output_port(&edge.from_port);
            let Some(from_port) = from_port else {
                errors.push((
                    ValidationError::TypeMismatch(format!(
                        "{:?} has no output port '{}'",
                        from_node.node_type, edge.from_port
                    )),
                    vec![edge.from, edge.to],
                ));
                continue;
            };

            let to_kind = plugin_kinds.get(&to_node.id).copied();
            let to_port = Self::effective_input_ports(&to_node.node_type, to_kind)
                .into_iter()
                .find(|p| p.name == edge.to_port);
            let Some(to_port) = to_port else {
                errors.push((
                    ValidationError::TypeMismatch(format!(
                        "{:?} has no input port '{}', connected from {:?}",
                        to_node.node_type, edge.to_port, from_node.node_type
                    )),
                    vec![edge.from, edge.to],
                ));
                continue;
            };

            if from_port.port_type != to_port.port_type {
                errors.push((
                    ValidationError::TypeMismatch(format!(
                        "port type mismatch: {:?}.{} ({:?}) → {:?}.{} ({:?})",
                        from_node.node_type,
                        edge.from_port,
                        from_port.port_type,
                        to_node.node_type,
                        edge.to_port,
                        to_port.port_type
                    )),
                    vec![edge.from, edge.to],
                ));
            }
        }
    }

    /// Vérifie l'arité des entrées :
    /// - au plus 1 edge par port d'entrée nommé (le fan-in est rejeté —
    ///   le compiler réduirait silencieusement à un seul upstream)
    /// - chaque port `required` reçoit au moins un edge (générique : couvre
    ///   Output.in, modifier.in, composite a/b, SignalOut.signal,
    ///   EvaluateSpline.spline et les ports plugin kindés)
    /// - chaque engine doit pouvoir résoudre n_objects (param propre ou
    ///   edge Objects direct — même convention que Compiler::resolve_n_objects)
    fn validate_input_arity(
        graph: &Graph,
        context: GraphContext,
        errors: &mut Vec<(ValidationError, Vec<NodeId>)>,
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
                    errors.push((
                        ValidationError::TypeMismatch(format!(
                            "{:?} input port '{port}' receives {count} edges — only one allowed",
                            node.node_type
                        )),
                        vec![node.id],
                    ));
                }
            }

            // Ports requis : chaque PortDef.required doit être connecté.
            let kind = plugin_kinds.get(&node.id).copied();
            for p in Self::effective_input_ports(&node.node_type, kind) {
                if p.required && !incoming.iter().any(|e| e.to_port == p.name) {
                    errors.push((
                        ValidationError::InvalidConnection(format!(
                            "{:?} required input port '{}' is not connected",
                            node.node_type, p.name
                        )),
                        vec![node.id],
                    ));
                }
            }

            // Plugin kind-aware : un engine plugin n'accepte aucune entrée
            // Positions — une edge trajectoire serait silencieusement
            // ignorée au compile.
            if node.node_type == NodeType::Plugin {
                use crate::plugins::PluginKind as K;
                if kind == Some(K::Engine) {
                    let traj_count = incoming
                        .iter()
                        .filter(|e| matches!(e.to_port.as_str(), "in" | "a" | "b"))
                        .count();
                    if traj_count > 0 {
                        errors.push((
                            ValidationError::InvalidConnection(format!(
                                "Plugin (engine) takes no trajectory input, got {traj_count}"
                            )),
                            vec![node.id],
                        ));
                    }
                }
            }

            // Chaque engine doit résoudre n_objects avec la même convention
            // que le compiler : param propre, sinon edge direct depuis un
            // node Objects. Sans les deux, MissingParameter au compile.
            // Détecté par le port `ObjectSet` — les modifiers/composites
            // (n_objects propagé depuis l'upstream) n'en ont pas.
            if context == GraphContext::SubGraph
                && Self::effective_input_ports(&node.node_type, kind)
                    .iter()
                    .any(|p| p.port_type == crate::node_spec::PortType::ObjectSet)
                && node
                    .params
                    .get("n_objects")
                    .and_then(|v| v.as_u64())
                    .is_none()
                && !incoming.iter().any(|e| {
                    matches!(graph.nodes.get(&e.from), Some(n) if n.node_type == NodeType::Objects)
                })
            {
                errors.push((ValidationError::InvalidConnection(format!(
                    "{:?} has no Objects input and no n_objects parameter",
                    node.node_type
                )), vec![node.id]));
            }
        }
    }

    /// Règles structurelles du graph global :
    /// - la chaîne `in` de l'Output doit remonter jusqu'à EXACTEMENT une
    ///   source (`Merge` ou `MoveRef`) — les transforms s'ordonnent entre
    ///   elle et l'Output ;
    /// - un capteur (`Zone`/`Velocity`) observe les positions envoyées :
    ///   son `in` doit être alimenté par le node qui alimente `Output.in`
    ///   (fan-out du dernier node de la chaîne).
    fn validate_global_chain(graph: &Graph, errors: &mut Vec<(ValidationError, Vec<NodeId>)>) {
        let is_source = |t: &NodeType| matches!(t, NodeType::Merge | NodeType::MoveRef);
        let is_sensor = |t: &NodeType| matches!(t, NodeType::Zone | NodeType::Velocity);

        let Some(output) = graph
            .nodes
            .values()
            .find(|n| n.node_type == NodeType::Output)
        else {
            return; // MissingRequiredNode déjà signalé
        };
        // Le node qui alimente l'Output — l'extrémité réelle de la chaîne.
        let Some(feeder) = graph
            .edges
            .iter()
            .find(|e| e.to == output.id && e.to_port == "in")
            .map(|e| e.from)
        else {
            return; // required input 'in' déjà signalé
        };

        // Remonter la chaîne `in` jusqu'au head — vérifier qu'il est une
        // source. Arity garantit au plus un edge par port `in`.
        let mut head = feeder;
        let mut visited = std::collections::HashSet::new();
        while visited.insert(head) {
            match graph
                .edges
                .iter()
                .find(|e| e.to == head && e.to_port == "in")
            {
                Some(e) => head = e.from,
                None => break,
            }
        }
        if let Some(head_node) = graph.nodes.get(&head) {
            if !is_source(&head_node.node_type) {
                errors.push((
                    ValidationError::InvalidConnection(format!(
                        "global chain must start at a source (Merge or MoveRef), found {:?}",
                        head_node.node_type
                    )),
                    vec![head],
                ));
            }
        }

        // Plus d'une source reachable depuis l'Output — ambiguïté.
        let mut reachable: std::collections::HashSet<crate::graph::NodeId> =
            std::collections::HashSet::new();
        let mut stack = vec![output.id];
        reachable.insert(output.id);
        while let Some(id) = stack.pop() {
            for e in &graph.edges {
                if e.to == id && reachable.insert(e.from) {
                    stack.push(e.from);
                }
            }
        }
        let src_ids: Vec<NodeId> = reachable
            .iter()
            .filter(|id| {
                graph
                    .nodes
                    .get(id)
                    .map(|n| is_source(&n.node_type))
                    .unwrap_or(false)
            })
            .copied()
            .collect();
        let n_sources = src_ids.len();
        if n_sources > 1 {
            errors.push((ValidationError::InvalidConnection(format!(
                "{n_sources} source nodes (Merge/MoveRef) reachable from Output — exactly one allowed"
            )), src_ids.clone()));
        }

        // Capteurs : leur `in` doit venir du node qui alimente l'Output.
        for node in graph.nodes.values() {
            if !is_sensor(&node.node_type) {
                continue;
            }
            let fed_by_final = graph
                .edges
                .iter()
                .any(|e| e.to == node.id && e.to_port == "in" && e.from == feeder);
            if !fed_by_final {
                errors.push((
                    ValidationError::InvalidConnection(format!(
                        "{:?} observes the final positions — connect it to the node feeding Output",
                        node.node_type
                    )),
                    vec![node.id],
                ));
            }
        }
    }

    /// Vérifie la compatibilité des comptages (n_objects)
    fn validate_count_compatibility(
        graph: &Graph,
        errors: &mut Vec<(ValidationError, Vec<NodeId>)>,
    ) {
        // Branches `b` des Group : la frontière du Group est le n_objects
        // résolu de la branche A — les engines sous `b` portent volontairement
        // un comptage différent (la split). Exempts du check Objects == engine.
        let mut group_b_branch: std::collections::HashSet<crate::graph::NodeId> =
            std::collections::HashSet::new();
        for edge in &graph.edges {
            if edge.to_port != "b" {
                continue;
            }
            let is_group_b = graph
                .nodes
                .get(&edge.to)
                .map(|n| n.node_type == NodeType::Group)
                .unwrap_or(false);
            if !is_group_b {
                continue;
            }
            let mut stack = vec![edge.from];
            while let Some(id) = stack.pop() {
                if group_b_branch.insert(id) {
                    for e in &graph.edges {
                        if e.to == id {
                            stack.push(e.from);
                        }
                    }
                }
            }
        }

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
                    | NodeType::Jitter
                    | NodeType::SpeedScale
                    | NodeType::Delay
                    | NodeType::Freeze => inputs
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
                    NodeType::Mix | NodeType::Sequence | NodeType::Crossfade | NodeType::Switch => {
                        graph
                            .get_binary_inputs(node.id)
                            .first()
                            .and_then(|id| graph.nodes.get(id))
                            .map(|n| effective_n_objects(graph, n, fallback, depth + 1))
                            .unwrap_or(fallback)
                    }
                    // Plugin : modifier/composite propagent depuis l'entrée
                    // trajectoire (port 'a' en priorité, puis 'in', 'b') —
                    // les carriers Objects/Duration ne peuvent pas atterrir
                    // sur un port Positions (types disjoints).
                    NodeType::Plugin => graph
                        .edges
                        .iter()
                        .filter(|e| e.to == node.id)
                        .filter(|e| matches!(e.to_port.as_str(), "a" | "in" | "b"))
                        .min_by_key(|e| match e.to_port.as_str() {
                            "a" => 0,
                            "b" => 1,
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
                        if group_b_branch.contains(&node.id) {
                            continue;
                        }
                        let node_n_objects =
                            node.params
                                .get("n_objects")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(n_objects as u64) as usize;

                        if node_n_objects != n_objects {
                            errors.push((
                                ValidationError::CountMismatch(format!(
                                    "Objects has {} but {:?} has {}",
                                    n_objects, node.node_type, node_n_objects
                                )),
                                vec![],
                            ));
                        }

                        // T3 : les engines à interaction mutuelle coûtent
                        // O(n²) par pas de simulation — au-delà de
                        // MAX_INTERACTION_AGENTS un frame à 60 FPS ne tient
                        // plus. Refus à la validation plutôt qu'un lag live.
                        if matches!(node.node_type, NodeType::Swarm | NodeType::Avoidance)
                            && node_n_objects > crate::engines::MAX_INTERACTION_AGENTS
                        {
                            errors.push((
                                ValidationError::TooComplex(format!(
                                    "{:?} with {} agents exceeds the O(n²) per-step budget \
                                 (max {} interaction agents)",
                                    node.node_type,
                                    node_n_objects,
                                    crate::engines::MAX_INTERACTION_AGENTS
                                )),
                                vec![],
                            ));
                        }
                    }
                    // Mix/Sequence/Crossfade/Switch : les deux entrées doivent
                    // avoir le même n_objects (blend/route per-object)
                    NodeType::Mix | NodeType::Sequence | NodeType::Crossfade | NodeType::Switch => {
                        let inputs = graph.get_inputs(node.id);
                        if inputs.len() >= 2 {
                            let node_a = graph.nodes.get(&inputs[0]);
                            let node_b = graph.nodes.get(&inputs[1]);

                            if let (Some(na), Some(nb)) = (node_a, node_b) {
                                let n_a = resolve(na);
                                let n_b = resolve(nb);

                                if n_a != n_b {
                                    errors.push((ValidationError::CountMismatch(format!(
                                        "{:?} node: input A has {n_a} objects but input B has {n_b} objects",
                                        node.node_type
                                    )), vec![]));
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
/// Nodes participants à un cycle — résidu du peeling de Kahn (tout node
/// encore à degré entrant > 0 après retrait itératif des puits).
fn cycle_nodes(graph: &Graph) -> Vec<NodeId> {
    let mut indegree: std::collections::HashMap<NodeId, usize> =
        graph.nodes.keys().map(|id| (*id, 0)).collect();
    for e in &graph.edges {
        if graph.nodes.contains_key(&e.from) {
            *indegree.entry(e.to).or_insert(0) += 1;
        }
    }
    let mut queue: std::collections::VecDeque<NodeId> = indegree
        .iter()
        .filter(|(_, d)| **d == 0)
        .map(|(id, _)| *id)
        .collect();
    while let Some(id) = queue.pop_front() {
        for e in &graph.edges {
            if e.from == id {
                if let Some(d) = indegree.get_mut(&e.to) {
                    *d -= 1;
                    if *d == 0 {
                        queue.push_back(e.to);
                    }
                }
            }
        }
    }
    indegree
        .into_iter()
        .filter(|(_, d)| *d > 0)
        .map(|(id, _)| id)
        .collect()
}

fn is_signal_node(node_type: &NodeType) -> bool {
    crate::node_spec::node_spec(node_type).scope == crate::node_spec::NodeScope::SignalOnly
}

// ── Diagnose live — source de vérité unique des règles du graphe ──────

/// Sévérité d'un diagnostic de graphe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum IssueSeverity {
    Error,
    Warning,
}

/// Diagnostic de graphe — `node_ids` = clés stables `__fe_id` (ou uuid)
/// permettant à l'éditeur de surligner les nodes concernés.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct GraphIssue {
    pub severity: IssueSeverity,
    pub message: String,
    pub node_ids: Vec<String>,
}

/// Diagnostics du graphe : erreurs = exactement ce que
/// `validate_with_context` rapporte (même acceptation), plus les cibles
/// `param:` du domaine signal résolues contre `move_graph`. Warnings =
/// dead nodes (ne peuvent atteindre aucun terminal du contexte).
pub fn diagnose(
    graph: &Graph,
    context: GraphContext,
    move_graph: Option<&Graph>,
) -> Vec<GraphIssue> {
    let mut issues: Vec<GraphIssue> = Vec::new();
    let key_of = |id: &NodeId| -> String {
        graph
            .nodes
            .get(id)
            .map(crate::param_slots::node_key)
            .unwrap_or_else(|| id.0.to_string())
    };

    for (e, ids) in Validator::validate_detailed(graph, context, &Default::default()) {
        issues.push(GraphIssue {
            severity: IssueSeverity::Error,
            message: e.to_string(),
            node_ids: ids.iter().map(&key_of).collect(),
        });
    }

    // Cibles `param:` des SignalOut — résolues contre le move graph.
    if context == GraphContext::Signal {
        for node in graph.nodes.values() {
            if node.node_type != NodeType::SignalOut {
                continue;
            }
            let target = node
                .params
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if let Err(msg) = crate::signal_compiler::validate_param_target(target, move_graph) {
                issues.push(GraphIssue {
                    severity: IssueSeverity::Error,
                    message: msg,
                    node_ids: vec![key_of(&node.id)],
                });
            }
        }
    }

    // Dead nodes — ne peuvent atteindre aucun terminal du contexte.
    // Global : les capteurs Zone/Velocity correctement câblés comptent
    // comme terminaux (ils n'ont pas de sortie mais observent la chaîne).
    let mut terminals: Vec<NodeId> = Vec::new();
    match context {
        GraphContext::SubGraph | GraphContext::Global => {
            terminals.extend(
                graph
                    .nodes
                    .values()
                    .filter(|n| n.node_type == NodeType::Output)
                    .map(|n| n.id),
            );
        }
        GraphContext::Signal => {
            terminals.extend(
                graph
                    .nodes
                    .values()
                    .filter(|n| n.node_type == NodeType::SignalOut)
                    .map(|n| n.id),
            );
        }
    }
    if context == GraphContext::Global {
        if let Some(output) = graph
            .nodes
            .values()
            .find(|n| n.node_type == NodeType::Output)
        {
            let feeder = graph
                .edges
                .iter()
                .find(|e| e.to == output.id && e.to_port == "in")
                .map(|e| e.from);
            if let Some(f) = feeder {
                terminals.extend(
                    graph
                        .nodes
                        .values()
                        .filter(|n| {
                            matches!(n.node_type, NodeType::Zone | NodeType::Velocity)
                                && graph
                                    .edges
                                    .iter()
                                    .any(|e| e.to == n.id && e.to_port == "in" && e.from == f)
                        })
                        .map(|n| n.id),
                );
            }
        }
    }
    // BFS backward depuis les terminaux → nodes "vivants".
    let mut alive: std::collections::HashSet<NodeId> = terminals.iter().copied().collect();
    let mut stack = terminals;
    while let Some(id) = stack.pop() {
        for e in &graph.edges {
            if e.to == id && alive.insert(e.from) {
                stack.push(e.from);
            }
        }
    }
    let dead: Vec<String> = graph
        .nodes
        .values()
        .filter(|n| !alive.contains(&n.id))
        .map(|n| key_of(&n.id))
        .collect();
    if !dead.is_empty() {
        issues.push(GraphIssue {
            severity: IssueSeverity::Warning,
            message: format!(
                "{} dead node(s) — no path to any graph terminal",
                dead.len()
            ),
            node_ids: dead,
        });
    }

    issues
}
