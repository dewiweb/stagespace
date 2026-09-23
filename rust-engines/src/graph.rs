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
    /// Champ de vecteurs procédural — advection + steering.
    /// Les objets sont advectés par un champ v(p) (vortex/sink/source/flow/noise)
    /// avec steering inertiel, wander et containment — mouvement perpétuel.
    VectorField,

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

    /// Zone d'effet spatial (graph global uniquement).
    /// Pass-through dans la chaîne de positions — ses params déclarent une
    /// zone extraite à la compilation et évaluée par le MergeRuntime sur les
    /// positions finales (canaux étendus tirés vers les valeurs cibles).
    /// Params : shape ("sphere"|"box"), center|min+max, radius, falloff,
    /// channels ({gain:0,...}), objects (optionnel).
    Zone,

    /// Modulation cinématique → canal spatial (graph global uniquement).
    /// Pass-through — déclare une règle vitesse/accélération/jerk → canal.
    /// Params : source ("speed"|"accel"|"jerk"), channel, scale, offset,
    /// min, max, object (optionnel).
    Velocity,

    // Sources
    BPM,
    AudioAmplitude,
    AudioSpectrum,
    OSCInput,

    /// Node conteneur pour les plugins WASM (bundles .ssx).
    /// `params.plugin_id` désigne le plugin dans le PluginRegistry ;
    /// les autres params sont ceux déclarés par son manifeste.
    /// Comportement : engine de sub-graph (ports input+duration).
    Plugin,
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

    /// Supprime les edges `from → to`. Si `to_port` est fourni, seuls les
    /// edges arrivant sur ce port sont supprimés — les edges parallèles entre
    /// les mêmes nodes sur d'autres ports sont conservés (le compiler est
    /// port-aware : input_a/input_b/duration ont une sémantique distincte).
    pub fn remove_edge(&mut self, from: NodeId, to: NodeId, to_port: Option<&str>) {
        self.edges
            .retain(|e| !(e.from == from && e.to == to && to_port.is_none_or(|p| e.to_port == p)));
    }

    /// Entrées d'un composite binaire (Mix, Group, Sequence, Crossfade)
    /// ordonnées par port : le node connecté à `input_a` en premier, celui
    /// connecté à `input_b` ensuite. Les edges sans port explicite (legacy
    /// "input") remplissent les slots restants dans l'ordre d'insertion —
    /// le résultat est déterministe quelle que soit la convention de ports.
    pub fn get_binary_inputs(&self, id: NodeId) -> Vec<NodeId> {
        let mut port_a: Option<NodeId> = None;
        let mut port_b: Option<NodeId> = None;
        let mut unnamed: Vec<NodeId> = Vec::new();

        for e in self.edges.iter().filter(|e| e.to == id) {
            match e.to_port.as_str() {
                "input_a" if port_a.is_none() => port_a = Some(e.from),
                "input_b" if port_b.is_none() => port_b = Some(e.from),
                _ => unnamed.push(e.from),
            }
        }

        let mut unnamed = unnamed.into_iter();
        let a = port_a.or_else(|| unnamed.next());
        let b = port_b.or_else(|| unnamed.next());

        let mut ordered = Vec::new();
        if let Some(x) = a {
            ordered.push(x);
        }
        if let Some(x) = b {
            ordered.push(x);
        }
        ordered.extend(unnamed);
        ordered
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
