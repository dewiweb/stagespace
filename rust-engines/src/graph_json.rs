//! Contrat wire du graphe — la sérialisation `{ nodes, edges }` échangée
//! entre le frontend (React Flow), les fichiers .hfg et les snapshots de cue.
//!
//! Avant T5c, `graph_json` traversait l'IPC en `serde_json::Value`/`unknown` :
//! un payload malformé n'échouait qu'au parser, avec des messages d'accès de
//! champs. Le contrat typé fait échouer la désérialisation à la frontière avec
//! une erreur claire, et `schema_version` permet d'identifier les fichiers
//! écrits par une version future (rejet propre au lieu d'un degrade silencieux).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Version courante du schéma graph_json. Payloads sans champ = legacy (0).
pub const GRAPH_JSON_SCHEMA_VERSION: u32 = 1;

/// Enveloppe `{ nodes, edges }` sérialisée par React Flow / les .hfg.
/// Les champs React Flow non listés (selected, dragging, measured…) sont
/// ignorés à la désérialisation et perdus à la re-sérialisation — le graphe
/// wire n'est pas un état d'éditeur.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphJson {
    /// Version du schéma. Les payloads anciens n'ont pas ce champ → None
    /// (lu comme 0 = legacy). Le backend rejette les versions supérieures
    /// à GRAPH_JSON_SCHEMA_VERSION.
    #[serde(default)]
    #[ts(optional)]
    #[ts(type = "number | null")]
    pub schema_version: Option<u32>,
    #[serde(default)]
    pub nodes: Vec<GraphNodeJson>,
    #[serde(default)]
    pub edges: Vec<GraphEdgeJson>,
}

impl GraphJson {
    /// Version effective — None (payload legacy) ≡ 0.
    pub fn version(&self) -> u32 {
        self.schema_version.unwrap_or(0)
    }

    /// Vérifie la version du schéma — à appeler à la frontière (IPC / fichier).
    /// Un graphe écrit par une version future est rejeté explicitement.
    pub fn check_version(&self) -> Result<(), String> {
        if self.version() > GRAPH_JSON_SCHEMA_VERSION {
            return Err(format!(
                "Graph schema_version {} > supported {} — file written by a newer version",
                self.version(),
                GRAPH_JSON_SCHEMA_VERSION
            ));
        }
        Ok(())
    }
}

/// Un node React Flow : `id` + `data` (vraie donnée) + `type` RF (souvent
/// "custom" — le type d'engine vit dans `data.type`, `rf_type` est le
/// fallback) + `position` (layout éditeur, préservée pour le round-trip).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphNodeJson {
    pub id: String,
    /// `type` React Flow — décoratif côté engine.
    #[serde(rename = "type", default)]
    #[ts(optional)]
    #[ts(type = "string | null")]
    pub rf_type: Option<String>,
    /// Données du node — `type` (engine) et `params`. La structure interne
    /// reste ouverte : chaque node valide ses params au compile.
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub data: GraphNodeData,
    /// Position éditeur — ignorée par le runtime, round-trip pour le .hfg.
    #[serde(default)]
    #[ts(optional)]
    #[ts(type = "import('./GraphNodePosition').GraphNodePosition | null")]
    pub position: Option<GraphNodePosition>,
}

/// `node.data` — le type d'engine et ses params.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphNodeData {
    /// Type d'engine ("circular", "swarm", …) — la source de vérité du type.
    #[serde(rename = "type", default)]
    #[ts(optional)]
    #[ts(type = "string | null")]
    pub node_type: Option<String>,
    /// Params du node — validés par chaque engine au compile, pas ici.
    #[serde(default)]
    #[ts(type = "unknown")]
    pub params: serde_json::Value,
}

/// Position éditeur d'un node (px React Flow).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphNodePosition {
    pub x: f64,
    pub y: f64,
}

/// Une edge React Flow — `source`/`target` sont les ids frontend des nodes ;
/// les handles nomment le port (`output`, `input`, `duration`, `spline`, …).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[allow(non_snake_case)]
pub struct GraphEdgeJson {
    pub source: String,
    pub target: String,
    #[serde(default)]
    #[ts(optional)]
    #[ts(type = "string | null")]
    pub sourceHandle: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    #[ts(type = "string | null")]
    pub targetHandle: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_react_flow_superset() {
        // Payload typique React Flow — champs extra ignorés proprement.
        let v = serde_json::json!({
            "nodes": [{
                "id": "n1", "type": "custom", "selected": true,
                "data": {"type": "circular", "params": {"radius": 2.0}},
                "position": {"x": 10.0, "y": 20.0}, "measured": {"width": 100}
            }],
            "edges": [{
                "id": "e1", "source": "n1", "target": "n2",
                "sourceHandle": "out", "targetHandle": "in"
            }]
        });
        let g: GraphJson = serde_json::from_value(v).unwrap();
        assert_eq!(g.version(), 0); // legacy — pas de champ
        assert_eq!(g.nodes[0].data.node_type.as_deref(), Some("circular"));
        assert_eq!(g.edges[0].sourceHandle.as_deref(), Some("out"));
        assert!(g.check_version().is_ok());
    }

    #[test]
    fn rejects_future_schema_version() {
        let g = GraphJson {
            schema_version: Some(GRAPH_JSON_SCHEMA_VERSION + 1),
            nodes: vec![],
            edges: vec![],
        };
        assert!(g.check_version().is_err());
    }
}
