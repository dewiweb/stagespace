/// resolve_plugin*/compile_plugin — nœuds Plugin WASM — méthodes `impl Compiler` extraites de mod.rs
/// (règle modularisation : découpage mécanique, comportement identique).
use super::*;

impl Compiler {
    /// Résout le `Arc<Plugin>` d'un node Plugin via `params.plugin_id` —
    /// erreur claire si registry absent ou id inconnu.
    pub(crate) fn resolve_plugin(
        node: &Node,
        live: &LiveInputs,
    ) -> Result<Arc<crate::plugins::Plugin>, CompilationError> {
        let plugin_id = node
            .params
            .get("plugin_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let registry_arc = live.plugins.as_ref().ok_or_else(|| {
            CompilationError::InvalidParameter(
                "Plugin node requires a plugin registry (use compile_with_live_inputs)".to_string(),
            )
        })?;
        let registry = registry_arc.lock().unwrap_or_else(|e| e.into_inner());
        registry.get(plugin_id).ok_or_else(|| {
            CompilationError::InvalidParameter(format!(
                "unknown plugin_id '{plugin_id}' — plugin absent du dossier plugins/ ou erreur de chargement"
            ))
        })
    }

    /// Kinds des nodes Plugin du graphe, résolus dans le registry —
    /// utilisé par le validator pour appliquer les règles par kind.
    /// Les ids inconnus n'entrent pas dans la map : le compile échouera
    /// ensuite avec l'erreur explicite de `resolve_plugin`.
    pub(crate) fn resolve_plugin_kinds(
        graph: &Graph,
        live: &LiveInputs,
    ) -> std::collections::HashMap<crate::graph::NodeId, crate::plugins::PluginKind> {
        let mut kinds = std::collections::HashMap::new();
        let Some(registry_arc) = live.plugins.as_ref() else {
            return kinds;
        };
        let registry = registry_arc.lock().unwrap_or_else(|e| e.into_inner());
        for node in graph.nodes.values() {
            if node.node_type != NodeType::Plugin {
                continue;
            }
            if let Some(id) = node.params.get("plugin_id").and_then(|v| v.as_str()) {
                if let Some(p) = registry.get(id) {
                    kinds.insert(node.id, p.manifest.kind);
                }
            }
        }
        kinds
    }

    /// Entrées trajectoire d'un node Plugin, ordonnées par port (`a`,
    /// `b`, `in`) — les ports Positions de l'ABI v2. Les carriers
    /// Objects/Duration ne peuvent pas atterrir ici (types disjoints).
    pub(crate) fn plugin_trajectory_inputs(
        graph: &Graph,
        node: &Node,
    ) -> Vec<crate::graph::NodeId> {
        let mut edges: Vec<&crate::graph::Edge> = graph
            .edges
            .iter()
            .filter(|e| e.to == node.id)
            .filter(|e| matches!(e.to_port.as_str(), "a" | "b" | "in"))
            .collect();
        edges.sort_by_key(|e| match e.to_port.as_str() {
            "a" => 0,
            "b" => 1,
            _ => 2,
        });
        edges.iter().map(|e| e.from).collect()
    }

    /// Compile un node Plugin selon le kind de son manifeste.
    pub(crate) fn compile_plugin(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        use crate::plugins::PluginKind;
        let plugin = Self::resolve_plugin(node, live)?;
        let plugin_id = plugin.manifest.id.clone();
        let wasm_engine = {
            let registry = live
                .plugins
                .as_ref()
                .ok_or_else(|| CompilationError::MissingParameter("plugin registry".into()))?
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            registry.wasm_engine().clone()
        };

        match plugin.manifest.kind {
            // Engine : déléguer à compile_engine — il re-résout le plugin
            // (HashMap + clone d'Arc, compile-time seulement) et gère les
            // conventions Objects/Duration/n_objects des engines.
            PluginKind::Engine => Self::compile_engine(graph, node, live),
            PluginKind::Modifier => {
                let inputs = Self::plugin_trajectory_inputs(graph, node);
                let upstream_id = inputs.first().ok_or_else(|| {
                    CompilationError::MissingParameter(format!(
                        "plugin '{plugin_id}' (modifier) requires 1 trajectory input, got {}",
                        inputs.len()
                    ))
                })?;
                let upstream_node = Self::node_ref(graph, *upstream_id)?;
                let upstream_fn = Self::compile_node(graph, upstream_node, live)?;
                let engine =
                    crate::plugins::PluginEngine::new(plugin, &wasm_engine).map_err(|e| {
                        CompilationError::InvalidParameter(format!("plugin '{plugin_id}': {e}"))
                    })?;
                // extract_params résout n_objects/duration (propagation
                // upstream) et les injecte dans extra — même convention
                // que les engines natifs.
                let params = Self::extract_params(graph, node)?;
                Ok(Box::new(move |t, i| {
                    engine.eval(t, i, &params, &[upstream_fn(t, i)])
                }))
            }
            PluginKind::Composite => {
                let inputs = Self::plugin_trajectory_inputs(graph, node);
                if inputs.len() != 2 {
                    return Err(CompilationError::MissingParameter(format!(
                        "plugin '{plugin_id}' (composite) requires 2 trajectory inputs, got {}",
                        inputs.len()
                    )));
                }
                let node_a = Self::node_ref(graph, inputs[0])?;
                let node_b = Self::node_ref(graph, inputs[1])?;
                let func_a = Self::compile_node(graph, node_a, live)?;
                let func_b = Self::compile_node(graph, node_b, live)?;
                let engine =
                    crate::plugins::PluginEngine::new(plugin, &wasm_engine).map_err(|e| {
                        CompilationError::InvalidParameter(format!("plugin '{plugin_id}': {e}"))
                    })?;
                let params = Self::extract_params(graph, node)?;
                Ok(Box::new(move |t, i| {
                    engine.eval(t, i, &params, &[func_a(t, i), func_b(t, i)])
                }))
            }
        }
    }
}
