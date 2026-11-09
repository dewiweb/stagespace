/// resolve_n_objects/resolve_duration — résolution récursive des héritages Objects/Duration — méthodes `impl Compiler` extraites de mod.rs
/// (règle modularisation : découpage mécanique, comportement identique).
use super::*;

impl Compiler {
    /// Résout n_objects d'un nœud : paramètre propre, sinon nœud Objects en
    /// amont, sinon propagation depuis les entrées trajectoires — un modifier
    /// laisse passer le compte de son entrée, un Group concatène les deux
    /// espaces d'objets (n_a + n_b), Mix/Sequence/Crossfade délèguent à
    /// input_a (le validator garantit l'égalité des deux entrées).
    pub(crate) fn resolve_n_objects(graph: &Graph, node: &Node) -> Result<usize, CompilationError> {
        let raw = Self::resolve_n_objects_depth(graph, node, 0)?;
        if raw == 0 || raw > MAX_OBJECTS as u64 {
            return Err(CompilationError::InvalidParameter(format!(
                "n_objects must be in 1..={MAX_OBJECTS}, got {raw}"
            )));
        }
        Ok(raw as usize)
    }

    pub(crate) fn resolve_n_objects_depth(
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
            | NodeType::Jitter
            | NodeType::SpeedScale
            | NodeType::Delay
            | NodeType::Freeze => {
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
            NodeType::Mix | NodeType::Sequence | NodeType::Crossfade | NodeType::Switch => {
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
    pub(crate) fn resolve_duration(graph: &Graph, node: &Node) -> f64 {
        Self::resolve_duration_depth(graph, node, 0)
    }

    pub(crate) fn resolve_duration_depth(graph: &Graph, node: &Node, depth: usize) -> f64 {
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
            | NodeType::Jitter
            | NodeType::Delay
            | NodeType::Freeze => inputs
                .first()
                .and_then(|id| graph.nodes.get(id))
                .map(|n| Self::resolve_duration_depth(graph, n, depth + 1))
                .unwrap_or(DEFAULT_DURATION),
            NodeType::SpeedScale => {
                let factor = node
                    .params
                    .get("factor")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0)
                    .max(1e-9);
                inputs
                    .first()
                    .and_then(|id| graph.nodes.get(id))
                    .map(|n| Self::resolve_duration_depth(graph, n, depth + 1) / factor)
                    .unwrap_or(DEFAULT_DURATION)
            }
            NodeType::Sequence => {
                let binary = graph.get_binary_inputs(node.id);
                binary
                    .iter()
                    .take(2)
                    .filter_map(|id| graph.nodes.get(id))
                    .map(|n| Self::resolve_duration_depth(graph, n, depth + 1))
                    .sum::<f64>()
            }
            NodeType::Mix | NodeType::Group | NodeType::Crossfade | NodeType::Switch => {
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

}
