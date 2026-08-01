//! Graph compiler for HOLOFLOW
//! 
//! Converts a node graph into a single composite function f(t) that can be
//! evaluated at runtime without re-interpreting the graph each frame.
//! 
//! Design principles:
//! - Graph is compiled once, then evaluated many times.
//! - Each node is a pure function of its inputs (and t).
//! - Cycles are detected and rejected at compile time.
//! - The output of the graph is a list of OSC messages per frame.

use crate::engine::{EngineParams, TrajectoryFn};
use crate::error::{HoloflowError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Unique node identifier
pub type NodeId = String;

/// Types of nodes in the graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NodeType {
    /// Trajectory engine (circular, spiral, lissajous, ...)
    Engine { engine_type: String },
    /// Spatial modifier (scale, rotate, offset)
    Modifier { modifier_type: String },
    /// Output node (sends OSC)
    Output { address_template: String },
    /// Constant value
    Constant { x: f32, y: f32, z: f32 },
    /// Audio input / source
    Audio { source_type: String },
    /// Falloff (time, distance, audio amplitude)
    Falloff { falloff_type: String },
}

/// A node in the graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub node_type: NodeType,
    /// Node-specific parameters
    pub params: EngineParams,
    /// Number of output channels (for engines generating multiple objects)
    pub n_objects: usize,
}

/// An edge connecting two nodes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: NodeId,
    pub to: NodeId,
    /// Which input slot on the target node this edge feeds
    pub to_input: String,
}

/// A complete graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: HashMap<NodeId, Node>,
    pub edges: Vec<Edge>,
}

impl Graph {
    /// Create an empty graph
    pub fn new() -> Self {
        Graph {
            nodes: HashMap::new(),
            edges: Vec::new(),
        }
    }
    
    /// Add a node
    pub fn add_node(&mut self, node: Node) {
        self.nodes.insert(node.id.clone(), node);
    }
    
    /// Add an edge
    pub fn add_edge(&mut self, edge: Edge) {
        self.edges.push(edge);
    }
    
    /// Validate the graph (no cycles, valid node references)
    pub fn validate(&self) -> Result<()> {
        // Check all edges reference existing nodes
        for edge in &self.edges {
            if !self.nodes.contains_key(&edge.from) {
                return Err(HoloflowError::EngineError(format!("Unknown node: {}", edge.from)));
            }
            if !self.nodes.contains_key(&edge.to) {
                return Err(HoloflowError::EngineError(format!("Unknown node: {}", edge.to)));
            }
        }
        
        // Cycle detection using DFS
        let mut adj: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
        for edge in &self.edges {
            adj.entry(edge.from.clone()).or_default().push(edge.to.clone());
        }
        
        let mut visiting = HashSet::new();
        let mut visited = HashSet::new();
        
        fn dfs(
            node: &NodeId,
            adj: &HashMap<NodeId, Vec<NodeId>>,
            visiting: &mut HashSet<NodeId>,
            visited: &mut HashSet<NodeId>,
        ) -> Result<()> {
            if visiting.contains(node) {
                return Err(HoloflowError::EngineError(format!("Cycle detected involving node {}", node)));
            }
            if visited.contains(node) {
                return Ok(());
            }
            visiting.insert(node.clone());
            if let Some(neighbors) = adj.get(node) {
                for neighbor in neighbors {
                    dfs(neighbor, adj, visiting, visited)?;
                }
            }
            visiting.remove(node);
            visited.insert(node.clone());
            Ok(())
        }
        
        for node_id in self.nodes.keys() {
            dfs(node_id, &adj, &mut visiting, &mut visited)?;
        }
        
        Ok(())
    }
}

/// Compiled graph — a single callable function
/// 
/// The compiled function evaluates each node in topological order and
/// produces the final OSC output for a given time `t`.
#[derive(Clone)]
pub struct CompiledGraph {
    /// Evaluation order of node IDs
    order: Vec<NodeId>,
    /// Node data
    nodes: HashMap<NodeId, Node>,
    /// Precomputed adjacency: for each node, list of (output value, target node, target input)
    edges: Vec<Edge>,
    /// Engine functions for Engine nodes
    engines: HashMap<NodeId, TrajectoryFn>,
}

/// Runtime value flowing through the graph
#[derive(Debug, Clone, Copy, Default)]
pub struct Value {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32, // Optional 4th channel for falloffs / audio
}

impl Value {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Value { x, y, z, w: 0.0 }
    }
    
    pub fn scale(&self, s: f32) -> Self {
        Value {
            x: self.x * s,
            y: self.y * s,
            z: self.z * s,
            w: self.w * s,
        }
    }
    
    pub fn add(&self, other: &Value) -> Self {
        Value {
            x: self.x + other.x,
            y: self.y + other.y,
            z: self.z + other.z,
            w: self.w + other.w,
        }
    }
}

/// Compiled output: a list of OSC addresses and their values
#[derive(Debug, Clone)]
pub struct CompiledOutput {
    pub object_id: usize,
    pub address: String,
    pub value: Value,
}

impl CompiledGraph {
    /// Compile a graph into an executable function
    pub fn compile(graph: Graph) -> Result<Self> {
        graph.validate()?;
        
        // Topological sort
        let order = topological_sort(&graph)?;
        
        // Map engine types to functions
        let mut engines = HashMap::new();
        for (id, node) in &graph.nodes {
            if let NodeType::Engine { engine_type } = &node.node_type {
                let func = engine_function(engine_type)?;
                engines.insert(id.clone(), func);
            }
        }
        
        Ok(CompiledGraph {
            order,
            nodes: graph.nodes,
            edges: graph.edges,
            engines,
        })
    }
    
    /// Evaluate the graph at time `t` and return all output messages
    pub fn evaluate(&self, t: f32) -> Vec<CompiledOutput> {
        let mut values: HashMap<NodeId, Vec<Value>> = HashMap::new();
        let mut outputs = Vec::new();
        
        for node_id in &self.order {
            let node = self.nodes.get(node_id).unwrap();
            
            // Compute this node's value
            let node_values = match &node.node_type {
                NodeType::Engine { engine_type: _ } => {
                    let func = *self.engines.get(node_id).unwrap_or(&(default_engine as TrajectoryFn));
                    (0..node.n_objects)
                        .map(|obj_idx| {
                            let (x, y, z) = func(t, obj_idx, &node.params);
                            Value::new(x, y, z)
                        })
                        .collect()
                }
                NodeType::Constant { x, y, z } => {
                    vec![Value::new(*x, *y, *z); node.n_objects.max(1)]
                }
                NodeType::Modifier { modifier_type } => {
                    // Collect inputs
                    let mut inputs: Vec<Value> = Vec::new();
                    for edge in &self.edges {
                        if edge.to == *node_id && edge.to_input == "in" {
                            if let Some(src_values) = values.get(&edge.from) {
                                inputs.extend(src_values.iter().copied());
                            }
                        }
                    }
                    apply_modifier(modifier_type, &inputs, node)
                }
                NodeType::Output { address_template } => {
                    // Collect inputs and produce outputs
                    let mut object_idx = 0;
                    for edge in &self.edges {
                        if edge.to == *node_id {
                            if let Some(src_values) = values.get(&edge.from) {
                                for (i, val) in src_values.iter().enumerate() {
                                    let address = address_template.replace("{}", &(i + 1).to_string());
                                    outputs.push(CompiledOutput {
                                        object_id: object_idx + i + 1,
                                        address,
                                        value: *val,
                                    });
                                }
                                object_idx += src_values.len();
                            }
                        }
                    }
                    vec![]
                }
                NodeType::Audio { .. } => {
                    // Placeholder — audio sources are handled separately
                    vec![Value::default(); node.n_objects.max(1)]
                }
                NodeType::Falloff { .. } => {
                    // Placeholder — falloffs return an influence value in w channel
                    vec![Value::default(); node.n_objects.max(1)]
                }
            };
            
            values.insert(node_id.clone(), node_values);
        }
        
        outputs
    }
}

/// Default engine if mapping is missing
fn default_engine(_t: f32, _obj: usize, _params: &EngineParams) -> (f32, f32, f32) {
    (0.0, 0.0, 0.0)
}

/// Map engine type string to trajectory function
fn engine_function(engine_type: &str) -> Result<TrajectoryFn> {
    use crate::engine::*;
    match engine_type {
        "circular" => Ok(circular_trajectory),
        "spiral" => Ok(spiral_trajectory),
        "lissajous" => Ok(lissajous_trajectory),
        "figure8" => Ok(figure8_trajectory),
        "linear" => Ok(linear_trajectory),
        _ => Err(HoloflowError::EngineError(format!("Unknown engine type: {}", engine_type))),
    }
}

/// Apply a modifier node
fn apply_modifier(modifier_type: &str, inputs: &[Value], node: &Node) -> Vec<Value> {
    if inputs.is_empty() {
        return vec![Value::default(); node.n_objects.max(1)];
    }
    
    match modifier_type {
        "scale" => {
            let sx = node.params.get("sx", 1.0);
            let sy = node.params.get("sy", 1.0);
            let sz = node.params.get("sz", 1.0);
            inputs
                .iter()
                .map(|v| Value {
                    x: v.x * sx,
                    y: v.y * sy,
                    z: v.z * sz,
                    w: v.w,
                })
                .collect()
        }
        "offset" => {
            let ox = node.params.get("ox", 0.0);
            let oy = node.params.get("oy", 0.0);
            let oz = node.params.get("oz", 0.0);
            inputs
                .iter()
                .map(|v| Value {
                    x: v.x + ox,
                    y: v.y + oy,
                    z: v.z + oz,
                    w: v.w,
                })
                .collect()
        }
        "mix" => {
            // Average all inputs
            let n = inputs.len().max(1) as f32;
            let sum = inputs.iter().fold(Value::default(), |acc, v| acc.add(v));
            vec![sum.scale(1.0 / n); node.n_objects.max(1)]
        }
        _ => inputs.to_vec(),
    }
}

/// Topological sort of the graph nodes
fn topological_sort(graph: &Graph) -> Result<Vec<NodeId>> {
    let mut in_degree: HashMap<NodeId, usize> = HashMap::new();
    let mut adj: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    
    for id in graph.nodes.keys() {
        in_degree.insert(id.clone(), 0);
    }
    
    for edge in &graph.edges {
        in_degree.entry(edge.to.clone()).and_modify(|e| *e += 1);
        adj.entry(edge.from.clone()).or_default().push(edge.to.clone());
    }
    
    let mut queue: Vec<NodeId> = in_degree
        .iter()
        .filter(|(_, d)| **d == 0)
        .map(|(id, _)| id.clone())
        .collect();
    
    let mut order = Vec::new();
    
    while let Some(node_id) = queue.pop() {
        order.push(node_id.clone());
        if let Some(neighbors) = adj.get(&node_id) {
            for neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push(neighbor.clone());
                    }
                }
            }
        }
    }
    
    if order.len() != graph.nodes.len() {
        return Err(HoloflowError::EngineError("Graph contains a cycle".to_string()));
    }
    
    Ok(order)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_compile_simple_graph() {
        let mut graph = Graph::new();
        
        graph.add_node(Node {
            id: "engine".to_string(),
            node_type: NodeType::Engine { engine_type: "circular".to_string() },
            params: {
                let mut p = EngineParams::default();
                p.custom.insert("radius".to_string(), 1.0);
                p
            },
            n_objects: 1,
        });
        
        graph.add_node(Node {
            id: "out".to_string(),
            node_type: NodeType::Output { address_template: "/track/{}/xyz".to_string() },
            params: EngineParams::default(),
            n_objects: 1,
        });
        
        graph.add_edge(Edge {
            from: "engine".to_string(),
            to: "out".to_string(),
            to_input: "in".to_string(),
        });
        
        let compiled = CompiledGraph::compile(graph).unwrap();
        let outputs = compiled.evaluate(0.0);
        
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].address, "/track/1/xyz");
        assert!((outputs[0].value.x - 1.0).abs() < 0.01);
    }
    
    #[test]
    fn test_cycle_detection() {
        let mut graph = Graph::new();
        
        graph.add_node(Node {
            id: "a".to_string(),
            node_type: NodeType::Constant { x: 0.0, y: 0.0, z: 0.0 },
            params: EngineParams::default(),
            n_objects: 1,
        });
        
        graph.add_node(Node {
            id: "b".to_string(),
            node_type: NodeType::Constant { x: 0.0, y: 0.0, z: 0.0 },
            params: EngineParams::default(),
            n_objects: 1,
        });
        
        graph.add_edge(Edge { from: "a".to_string(), to: "b".to_string(), to_input: "in".to_string() });
        graph.add_edge(Edge { from: "b".to_string(), to: "a".to_string(), to_input: "in".to_string() });
        
        let result = CompiledGraph::compile(graph);
        assert!(result.is_err());
    }
}