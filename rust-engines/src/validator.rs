use crate::graph::{Graph, NodeType};

/// Erreur de validation
#[derive(Debug, Clone)]
pub enum ValidationError {
    CycleDetected,
    MissingRequiredNode(NodeType),
    InvalidConnection(String),
    TypeMismatch(String),
    CountMismatch(String),
}

/// Résultat de validation
pub type ValidationResult = Result<(), Vec<ValidationError>>;

/// Validateur de graphe
pub struct Validator;

impl Validator {
    /// Valide un graphe complet
    pub fn validate(graph: &Graph) -> ValidationResult {
        let mut errors = Vec::new();

        // 1. Vérifier les cycles
        if graph.has_cycle() {
            errors.push(ValidationError::CycleDetected);
        }

        // 2. Vérifier les nœuds obligatoires
        // Objects et Duration sont obligatoires seulement s'il y a des moteurs directs
        let has_engines = graph.nodes.values().any(|n| matches!(n.node_type,
            NodeType::Circular | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
            | NodeType::Linear | NodeType::Oscillation | NodeType::Formation | NodeType::PerlinNoise
            | NodeType::Converge | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix
            | NodeType::Bouncing | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance
            | NodeType::CustomTrajectory | NodeType::BPM | NodeType::AudioAmplitude
            | NodeType::TimeFalloff | NodeType::PointDistanceFalloff
            | NodeType::Wave
        ));
        
        if has_engines {
            let required_nodes = vec![NodeType::Objects, NodeType::Duration];
            for required_type in required_nodes {
                if !graph.nodes.values().any(|n| n.node_type == required_type) {
                    errors.push(ValidationError::MissingRequiredNode(required_type));
                }
            }
        }
        
        // Output est toujours obligatoire
        if !graph.nodes.values().any(|n| n.node_type == NodeType::Output) {
            errors.push(ValidationError::MissingRequiredNode(NodeType::Output));
        }

        // 3. Vérifier les connexions valides
        for edge in &graph.edges {
            if let Some(from_node) = graph.nodes.get(&edge.from) {
                if let Some(to_node) = graph.nodes.get(&edge.to) {
                    if !Self::is_valid_connection(&from_node.node_type, &to_node.node_type) {
                        errors.push(ValidationError::InvalidConnection(format!(
                            "{} -> {}",
                            format!("{:?}", from_node.node_type),
                            format!("{:?}", to_node.node_type)
                        )));
                    }
                }
            }
        }

        // 4. Vérifier la compatibilité des types
        Self::validate_type_compatibility(graph, &mut errors);

        // 5. Vérifier la compatibilité des comptages
        Self::validate_count_compatibility(graph, &mut errors);

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Vérifie si une connexion entre deux types de nœuds est valide
    fn is_valid_connection(from_type: &NodeType, to_type: &NodeType) -> bool {
        match from_type {
            // Moteurs peuvent connecter à Output, Mix, Group, Sequence, Crossfade, modifiers
            NodeType::Circular | NodeType::Elliptical | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
            | NodeType::Linear | NodeType::Oscillation | NodeType::PerlinNoise | NodeType::Formation
            | NodeType::Converge | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix
            | NodeType::CustomTrajectory | NodeType::BPM | NodeType::AudioAmplitude | NodeType::Wave
            | NodeType::DrawSpline | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline => {
                matches!(to_type,
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
            NodeType::Bouncing | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance => {
                matches!(to_type, 
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
            | NodeType::BarycentricGroup | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter => {
                matches!(to_type, NodeType::Output | NodeType::Mix | NodeType::Group | NodeType::Crossfade
                    | NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift
                    | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter)
            }

            // Sources
            NodeType::AudioSpectrum | NodeType::OSCInput => {
                matches!(to_type, NodeType::TimeFalloff | NodeType::AudioAmplitudeFalloff
                    | NodeType::DirectionalFalloff | NodeType::PointDistanceFalloff)
            }

            // Structurels
            NodeType::Objects => {
                matches!(to_type, NodeType::Circular | NodeType::Elliptical | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
                    | NodeType::Linear | NodeType::Oscillation | NodeType::Formation | NodeType::PerlinNoise | NodeType::Converge
                    | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix | NodeType::Bouncing
                    | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance
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
                    | NodeType::DrawSpline | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline)
            }
            NodeType::Output => false, // Output n'a pas de sortie
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
            NodeType::Objects | NodeType::Duration
            | NodeType::AudioSpectrum | NodeType::OSCInput
            | NodeType::DrawSpline => &[],

            // Moteurs : entrée générale + durée depuis un nœud Duration
            NodeType::Circular | NodeType::Elliptical | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
            | NodeType::Linear | NodeType::Oscillation | NodeType::Formation | NodeType::PerlinNoise
            | NodeType::Converge | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix
            | NodeType::Bouncing | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance
            | NodeType::CustomTrajectory | NodeType::Wave
            | NodeType::BPM | NodeType::AudioAmplitude
            | NodeType::TimeFalloff | NodeType::PointDistanceFalloff
            | NodeType::DirectionalFalloff | NodeType::AudioAmplitudeFalloff => &["input", "duration"],

            // Modificateurs / splines : une seule entrée
            NodeType::Scale | NodeType::Rotate | NodeType::Offset | NodeType::PhaseShift | NodeType::BarycentricGroup
            | NodeType::Mirror | NodeType::Clamp | NodeType::LFO | NodeType::Jitter
            | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline
            | NodeType::Output => &["input"],

            // Composites binaires : acceptent input, input_a, input_b
            // (input_a/input_b sont les ports visuels A/B ; le compiler distingue par ordre des edges)
            NodeType::Mix | NodeType::Group | NodeType::Sequence | NodeType::Crossfade => &["input", "input_a", "input_b"],
        };
        inputs.contains(&port)
    }

    /// Vérifie la compatibilité des comptages (n_objects)
    fn validate_count_compatibility(graph: &Graph, errors: &mut Vec<ValidationError>) {
        // Trouver le nœud Objects
        let objects_node = graph.nodes.values().find(|n| n.node_type == NodeType::Objects);
        
        if let Some(objects_node) = objects_node {
            let n_objects = objects_node.params.get("n_objects")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as usize;

            // Vérifier que tous les moteurs ont le même n_objects
            for node in graph.nodes.values() {
                match node.node_type {
                    NodeType::Circular | NodeType::Elliptical | NodeType::Spiral | NodeType::Lissajous | NodeType::Figure8
                    | NodeType::Linear | NodeType::Oscillation | NodeType::Formation | NodeType::PerlinNoise
                    | NodeType::Converge | NodeType::Pendulum | NodeType::RoseCurve | NodeType::Helix
                    | NodeType::Bouncing | NodeType::Spring | NodeType::Follow | NodeType::Swarm | NodeType::Avoidance
                    | NodeType::CustomTrajectory | NodeType::Wave
                    | NodeType::DrawSpline | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline => {
                        let node_n_objects = node.params.get("n_objects")
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
                                let n_a = na.params.get("n_objects").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                                let n_b = nb.params.get("n_objects").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                                
                                if n_a != n_b {
                                    errors.push(ValidationError::CountMismatch(format!(
                                        "Mix node: input A has {} objects but input B has {} objects",
                                        n_a, n_b
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
                                let n_a = na.params.get("n_objects").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                                let n_b = nb.params.get("n_objects").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                                
                                if n_a != n_b {
                                    errors.push(ValidationError::CountMismatch(format!(
                                        "Sequence node: input A has {} objects but input B has {} objects",
                                        n_a, n_b
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
