/// compile_mix/group/sequence/switch/crossfade + binary_inputs — nœuds structurels à deux entrées — méthodes `impl Compiler` extraites de mod.rs
/// (règle modularisation : découpage mécanique, comportement identique).
use super::*;

impl Compiler {
    /// Compile un nœud Mix : interpolation linéaire entre deux trajectoires
    pub(crate) fn compile_mix(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Mix")?;

        let blend = node
            .params
            .get("blend")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .clamp(0.0, 1.0);
        let over = live.param_slots.clone();
        let i_blend = sidx(&over, node, "blend");

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;

        Ok(Box::new(move |t: f64, object_index: usize| {
            let pos_a = func_a(t, object_index);
            let pos_b = func_b(t, object_index);
            pos_a * (1.0 - sval(&over, i_blend, blend)) + pos_b * sval(&over, i_blend, blend)
        }))
    }

    /// Compile un nœud Group : combine deux trajectoires (objets 0..n_a suivent A, n_a..n_a+n_b suivent B)
    pub(crate) fn compile_group(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Group")?;

        // n_objects de la branche A détermine la frontière entre les deux groupes
        let n_objects_a = Self::resolve_n_objects(graph, node_a)?;

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;

        Ok(Box::new(move |t: f64, object_index: usize| {
            if object_index < n_objects_a {
                func_a(t, object_index)
            } else {
                func_b(t, object_index - n_objects_a)
            }
        }))
    }

    /// Compile un nœud Sequence : enchaîne deux trajectoires temporellement
    pub(crate) fn compile_sequence(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Sequence")?;

        // La bascule A→B se fait à la fin de A : durée propre du nœud, sinon celle
        // héritée du nœud Duration connecté en amont.
        let duration_a = Self::resolve_duration(graph, node_a);
        if !(duration_a.is_finite() && duration_a > 0.0) {
            return Err(CompilationError::InvalidParameter(format!(
                "Sequence node: input A has a non-positive duration ({duration_a})"
            )));
        }

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;

        Ok(Box::new(move |t: f64, object_index: usize| {
            if t < duration_a {
                func_a(t, object_index)
            } else {
                func_b(t - duration_a, object_index)
            }
        }))
    }

    /// Compile un nœud Switch : sélectionne A ou B par index — choix
    /// manuel/OSC-driven, pas temporel (contrairement à Sequence/Crossfade).
    pub(crate) fn compile_switch(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Switch")?;
        let select = node
            .params
            .get("select")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;
        let over = live.param_slots.clone();
        let i_select = sidx(&over, node, "select");
        Ok(Box::new(move |t: f64, i: usize| {
            if sval(&over, i_select, select) < 0.5 {
                func_a(t, i)
            } else {
                func_b(t, i)
            }
        }))
    }

    /// Compile un nœud Crossfade : enchaîne A → B avec une période de crossfade
    /// Pendant le crossfade, les deux trajectoires sont blendées linéairement
    pub(crate) fn compile_crossfade(
        graph: &Graph,
        node: &Node,
        live: &LiveInputs,
    ) -> Result<CompiledFunction, CompilationError> {
        let (node_a, node_b) = Self::binary_inputs(graph, node, "Crossfade")?;

        let duration_a = Self::resolve_duration(graph, node_a);
        if !(duration_a.is_finite() && duration_a > 0.0) {
            return Err(CompilationError::InvalidParameter(format!(
                "Crossfade node: input A has a non-positive duration ({duration_a})"
            )));
        }

        let fade_duration = node
            .params
            .get("fade_duration")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0)
            .min(duration_a * 0.5); // Le fade ne peut pas dépasser la moitié de A

        let func_a = Self::compile_node(graph, node_a, live)?;
        let func_b = Self::compile_node(graph, node_b, live)?;
        let over = live.param_slots.clone();
        let i_fade_duration = sidx(&over, node, "fade_duration");

        Ok(Box::new(move |t: f64, object_index: usize| {
            let fade_duration = sval(&over, i_fade_duration, fade_duration).min(duration_a * 0.5);
            let fade_start = duration_a - fade_duration;
            if t < fade_start {
                // Phase A pure
                func_a(t, object_index)
            } else if t < duration_a {
                // Phase crossfade : blend linéaire A → B
                let progress = (t - fade_start) / fade_duration;
                let pos_a = func_a(t, object_index);
                let pos_b = func_b(t - fade_start, object_index);
                pos_a * (1.0 - progress) + pos_b * progress
            } else {
                // Phase B pure
                func_b(t - fade_start, object_index)
            }
        }))
    }

    /// Résout les deux entrées d'un nœud composite binaire (Mix, Group, Sequence, Crossfade)
    pub(crate) fn binary_inputs<'g>(
        graph: &'g Graph,
        node: &Node,
        label: &str,
    ) -> Result<(&'g Node, &'g Node), CompilationError> {
        // Port-aware : input_a/input_b ont une sémantique distincte — utiliser
        // l'ordre d'insertion inverserait silencieusement A/B quand l'utilisateur
        // câble B avant A.
        let inputs = graph.get_binary_inputs(node.id);
        if inputs.len() < 2 {
            return Err(CompilationError::MissingParameter(format!(
                "{label} node requires 2 trajectory inputs, got {}",
                inputs.len()
            )));
        }
        Ok((
            Self::node_ref(graph, inputs[0])?,
            Self::node_ref(graph, inputs[1])?,
        ))
    }
}
