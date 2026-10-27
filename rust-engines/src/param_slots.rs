//! Table de slots de paramètres modulables — liaison compile-time entre le
//! graphe d'un move (domaine position) et son graphe de modulation
//! (domaine signal).
//!
//! Chaque param `modulable` de chaque node du graphe compilé reçoit un slot
//! (`AtomicU64` — bits f64). Les closures compilées capturent l'index de
//! leur slot : la valeur effective lue à chaque eval est `base + delta`,
//! sans lock, sans string, sans alloc. Le worker du move écrit les deltas
//! une fois par frame (zero → somme des deltas du signal graph → bump de
//! `generation`), puis évalue les positions : la modulation est visible à
//! la frame suivante au plus tard.
//!
//! Clé d'un node : son `__fe_id` (id React Flow, injecté par le parser
//! backend) s'il existe, sinon l'UUID interne. C'est ce qui rend les
//! cibles `param:<node_id>:<key>` stables à travers les recompilations —
//! les UUID internes sont régénérés à chaque `build_graph_from_json`.

use crate::graph::{Graph, Node};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Clé de ciblage d'un node pour les slots — `__fe_id` prioritaire.
pub fn node_key(node: &Node) -> String {
    node.params
        .get("__fe_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}", node.id.0))
}

/// Table de slots partagée entre la position_fn, la sample_fn et la
/// signal_fn d'un même move — un swap atomique garantit qu'elles
/// proviennent toujours du même compile.
pub struct ParamSlots {
    /// (node_key, param_key) → index dans `values`.
    pub index: HashMap<(String, String), usize>,
    /// Deltas courants (bits f64) — un slot par param modulable.
    pub values: Arc<[AtomicU64]>,
    /// Compteur de frames — bumpé après chaque écriture de deltas ; les
    /// caches de params patchés des engines le comparent pour ne rebuild
    /// qu'une fois par frame.
    pub generation: Arc<AtomicU64>,
    /// node_key → NodeType — validation des cibles `param:` à la compile
    /// du signal graph (type-wide expansion, unknown key, non-modulable).
    pub node_types: HashMap<String, crate::graph::NodeType>,
}

impl ParamSlots {
    /// Construit la table pour un graphe de move : un slot par param
    /// `modulable` (Number/Boolean non structural) de chaque node.
    /// Itération triée par NodeId — la table est déterministe pour un
    /// graphe donné (mêmes indices entre compiles identiques).
    pub fn build(graph: &Graph) -> Arc<ParamSlots> {
        let mut nodes: Vec<&Node> = graph.nodes.values().collect();
        nodes.sort_by_key(|n| n.id.0.as_u128());

        let mut index = HashMap::new();
        let mut node_types = HashMap::new();
        let mut count = 0usize;
        for node in nodes {
            let key = node_key(node);
            node_types.insert(key.clone(), node.node_type.clone());
            let spec = crate::node_spec::node_spec(&node.node_type);
            for p in &spec.params {
                if p.modulable {
                    index.insert((key.clone(), p.key.clone()), count);
                    count += 1;
                }
            }
        }
        let values: Vec<AtomicU64> = (0..count).map(|_| AtomicU64::new(0)).collect();
        Arc::new(ParamSlots {
            index,
            values: values.into(),
            generation: Arc::new(AtomicU64::new(0)),
            node_types,
        })
    }

    /// Table vide — runtime sans graphe compilé (pré-play).
    pub fn empty() -> Arc<ParamSlots> {
        Arc::new(ParamSlots {
            index: HashMap::new(),
            values: Vec::new().into(),
            generation: Arc::new(AtomicU64::new(0)),
            node_types: HashMap::new(),
        })
    }

    /// Index du slot `(node_key, param_key)` — résolution compile-time.
    pub fn slot_of(&self, node: &str, key: &str) -> Option<usize> {
        self.index
            .get(&(node.to_string(), key.to_string()))
            .copied()
    }

    /// Delta courant d'un slot — `Relaxed` : la lecture sert une frame,
    /// la cohérence par param suffit (pas de lecture multi-slots atomique).
    #[inline]
    pub fn delta(&self, idx: usize) -> f64 {
        f64::from_bits(self.values[idx].load(Ordering::Relaxed))
    }

    /// Écrit une frame de deltas : zero tous les slots, puis ajoute
    /// chaque delta fini, puis bump `generation`. Un delta non-fini
    /// contribue 0 cette frame — pas de hold de la dernière valeur.
    /// Seul le worker écrit → load+store suffit (pas de CAS).
    pub fn apply_frame(&self, deltas: &[(usize, f64)]) {
        for v in self.values.iter() {
            v.store(0.0f64.to_bits(), Ordering::Relaxed);
        }
        for (idx, d) in deltas {
            if !d.is_finite() {
                continue;
            }
            if let Some(slot) = self.values.get(*idx) {
                let cur = f64::from_bits(slot.load(Ordering::Relaxed));
                slot.store((cur + d).to_bits(), Ordering::Relaxed);
            }
        }
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    /// Generation courante — comparée par les caches de params patchés.
    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }
}
