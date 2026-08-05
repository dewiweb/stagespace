use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use uuid::Uuid;

/// Identifiant unique pour un nœud
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub Uuid);

impl NodeId {
    pub fn new() -> Self {
        NodeId(Uuid::new_v4())
    }

    pub fn from_uuid(uuid: Uuid) -> Self {
        NodeId(uuid)
    }
}

impl Default for NodeId {
    fn default() -> Self {
        Self::new()
    }
}

/// Types de nœuds disponibles
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NodeType {
    // Nœuds structurels
    Objects,
    Duration,
    Output,
    Group,
    Mix,
    Sequence,
    Crossfade,
    /// Point d'entrée du graph global (représente les positions mergées)
    Input,

    // Moteurs math
    Circular,
    Elliptical,
    Spiral,
    Lissajous,
    Figure8,
    Linear,
    Oscillation,
    PerlinNoise,
    Formation,
    Converge,
    Pendulum,
    RoseCurve,
    Helix,
    CustomTrajectory,
    Wave,

    // Moteurs physique
    Bouncing,
    Spring,
    Follow,
    Swarm,
    Avoidance,

    // Splines
    DrawSpline,
    EvaluateSpline,
    TrimSpline,
    OffsetSpline,

    // Falloffs
    TimeFalloff,
    PointDistanceFalloff,
    DirectionalFalloff,
    AudioAmplitudeFalloff,

    // Modificateurs
    Scale,
    Rotate,
    Offset,
    PhaseShift,
    BarycentricGroup,
    Mirror,
    Clamp,
    LFO,
    Jitter,

    // Post-processing nodes (graph global — appliqués après merge)
    RadiusScale,
    HeightOffset,
    PerTrackDepth,
    Barycenter,
    AudioFalloff,
    ManualPosition,

    /// Référence vers un sub-graph (move) dans le graph global.
    /// Param: `move_id` (string) — l'ID du move à référencer.
    /// Source : pas d'input, produit des positions (comme un engine).
    MoveRef,

    /// Node Merge — représente le MergeRuntime dans le graph global.
    /// Source visuelle : pas d'input (le merge est géré par le MergeRuntime).
    /// Params : strategy (override/crossfade/blend/priority), fade_duration.
    /// Fonctionnellement équivalent à Input (produit les positions mergées).
    Merge,

    // Sources
    BPM,
    AudioAmplitude,
    AudioSpectrum,
    OSCInput,
}

/// Un nœud dans le graphe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub node_type: NodeType,
    pub params: serde_json::Value,
    pub position: (f32, f32), // Position dans l'UI (x, y)
}

impl Node {
    pub fn new(node_type: NodeType) -> Self {
        Node {
            id: NodeId::new(),
            node_type,
            params: serde_json::json!({}),
            position: (0.0, 0.0),
        }
    }

    pub fn with_params(node_type: NodeType, params: serde_json::Value) -> Self {
        Node {
            id: NodeId::new(),
            node_type,
            params,
            position: (0.0, 0.0),
        }
    }
}

/// Une connexion entre deux nœuds
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: NodeId,
    pub to: NodeId,
    pub from_port: String,
    pub to_port: String,
}

/// Le graphe complet
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: HashMap<NodeId, Node>,
    pub edges: Vec<Edge>,
}

impl Graph {
    pub fn new() -> Self {
        Graph {
            nodes: HashMap::new(),
            edges: Vec::new(),
        }
    }

    pub fn add_node(&mut self, node: Node) {
        self.nodes.insert(node.id, node);
    }

    pub fn remove_node(&mut self, id: NodeId) {
        self.nodes.remove(&id);
        self.edges.retain(|e| e.from != id && e.to != id);
    }

    pub fn add_edge(&mut self, edge: Edge) {
        self.edges.push(edge);
    }

    pub fn remove_edge(&mut self, from: NodeId, to: NodeId) {
        self.edges.retain(|e| !(e.from == from && e.to == to));
    }

    /// Récupère les nœuds connectés en sortie d'un nœud
    pub fn get_outputs(&self, id: NodeId) -> Vec<NodeId> {
        self.edges
            .iter()
            .filter(|e| e.from == id)
            .map(|e| e.to)
            .collect()
    }

    /// Récupère les nœuds connectés en entrée d'un nœud
    pub fn get_inputs(&self, id: NodeId) -> Vec<NodeId> {
        self.edges
            .iter()
            .filter(|e| e.to == id)
            .map(|e| e.from)
            .collect()
    }

    /// Détection de cycles (DFS avec marquage GRAY/BLACK)
    pub fn has_cycle(&self) -> bool {
        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();

        for &node_id in self.nodes.keys() {
            if !visited.contains(&node_id) && self.dfs_cycle(node_id, &mut visited, &mut rec_stack)
            {
                return true;
            }
        }

        false
    }

    fn dfs_cycle(
        &self,
        node_id: NodeId,
        visited: &mut HashSet<NodeId>,
        rec_stack: &mut HashSet<NodeId>,
    ) -> bool {
        visited.insert(node_id);
        rec_stack.insert(node_id);

        for neighbor in self.get_outputs(node_id) {
            if !visited.contains(&neighbor) {
                if self.dfs_cycle(neighbor, visited, rec_stack) {
                    return true;
                }
            } else if rec_stack.contains(&neighbor) {
                return true;
            }
        }

        rec_stack.remove(&node_id);
        false
    }
}

impl Default for Graph {
    fn default() -> Self {
        Self::new()
    }
}
