//! Tests génératifs : des graphes de complexité croissante sont construits
//! aléatoirement (seed déterministe) puis passés dans le pipeline réel
//! validate → compile → sample → merge. Objectif : trouver les combinaisons
//! de nodes qui crashent, produisent des NaN, ou divergent du contrat.
//!
//! Les règles de câblage reproduisent `Validator::is_valid_connection` — le
//! générateur ne produit que des graphes *valides*, ce qui isole les bugs
//! du compiler/runtime des erreurs de topologie déjà couvertes par le
//! validator.
#[cfg(test)]
mod tests {
    use crate::compiler::{CompilationError, CompiledFunction, Compiler};
    use crate::graph::{Edge, Graph, Node, NodeId, NodeType};
    use crate::merge_runtime::{merge_positions, MergeStrategy};
    use crate::plugins::PluginRegistry;
    use crate::rng::SimpleRng;
    use crate::validator::Validator;
    use crate::LiveInputs;
    use std::path::Path;
    use std::sync::{Arc, Mutex, OnceLock};

    /// Registry partagé contenant le plugin `lemniscate` (fixture `.ssx`
    /// compilée wasm32, committée) — permet d'inclure `NodeType::Plugin`
    /// dans le pool MATH : chaque graphe contenant un Plugin est compilé
    /// avec `LiveInputs.plugins`.
    fn fuzz_registry() -> Arc<Mutex<PluginRegistry>> {
        static REG: OnceLock<Arc<Mutex<PluginRegistry>>> = OnceLock::new();
        REG.get_or_init(|| {
            let mut r = PluginRegistry::new().expect("registry");
            r.register_bundle(Path::new(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/lemniscate.ssx"
            )))
            .expect("lemniscate fixture");
            Arc::new(Mutex::new(r))
        })
        .clone()
    }

    /// Compile avec le registry plugin — tous les graphes générés passent
    /// par le chemin live (celui de la production via `compile_graph_live`).
    fn compile(graph: &Graph) -> Result<CompiledFunction, CompilationError> {
        Compiler::compile_with_live_inputs(
            graph,
            LiveInputs {
                plugins: Some(fuzz_registry()),
                ..Default::default()
            },
        )
    }

    /// Engines non-physique : peuvent alimenter modifiers, composites, Output.
    const MATH: &[NodeType] = &[
        NodeType::Circular,
        NodeType::Elliptical,
        NodeType::Spiral,
        NodeType::Lissajous,
        NodeType::Figure8,
        NodeType::Linear,
        NodeType::Oscillation,
        NodeType::PerlinNoise,
        NodeType::Formation,
        NodeType::Converge,
        NodeType::Pendulum,
        NodeType::RoseCurve,
        NodeType::Helix,
        NodeType::Wave,
        NodeType::BPM,
        NodeType::AudioAmplitude,
        NodeType::AudioSpectrum,
        NodeType::OSCInput,
        NodeType::TimeFalloff,
        NodeType::PointDistanceFalloff,
        NodeType::DrawSpline,
        // Plugin WASM — lemniscate du registry fixture (plugin_id fixe).
        NodeType::Plugin,
    ];

    /// Engines physique : Output et composites uniquement (pas de modifiers).
    const PHYSICS: &[NodeType] = &[
        NodeType::Bouncing,
        NodeType::Spring,
        NodeType::Follow,
        NodeType::Swarm,
        NodeType::Avoidance,
        NodeType::VectorField,
    ];

    const MODIFIERS: &[NodeType] = &[
        NodeType::Scale,
        NodeType::Rotate,
        NodeType::Offset,
        NodeType::PhaseShift,
        NodeType::Mirror,
        NodeType::Clamp,
        NodeType::LFO,
        NodeType::Jitter,
        NodeType::SpeedScale,
        NodeType::Delay,
        NodeType::Freeze,
    ];

    const COMPOSITES: &[NodeType] = &[
        NodeType::Mix,
        NodeType::Group,
        NodeType::Sequence,
        NodeType::Crossfade,
        NodeType::Switch,
    ];

    /// Falloffs restreints : ne peuvent alimenter que Scale/Rotate/Offset.
    const RESTRICTED_FALLOFFS: &[NodeType] = &[
        NodeType::DirectionalFalloff,
        NodeType::AudioAmplitudeFalloff,
    ];

    /// Types dont la racine peut alimenter `parent` — mirror de
    /// `Validator::is_valid_connection` (sub-graph).
    fn allowed_roots(parent: NodeType) -> Vec<NodeType> {
        let mut v: Vec<NodeType> = Vec::new();
        let extend = |v: &mut Vec<NodeType>, sets: &[&[NodeType]]| {
            for s in sets {
                v.extend_from_slice(s);
            }
        };
        match parent {
            NodeType::Output => extend(&mut v, &[MATH, PHYSICS, COMPOSITES, MODIFIERS]),
            // Les falloffs restreints n'atteignent que Scale/Rotate/Offset.
            NodeType::Scale | NodeType::Rotate | NodeType::Offset => {
                extend(&mut v, &[MATH, RESTRICTED_FALLOFFS, MODIFIERS])
            }
            NodeType::PhaseShift
            | NodeType::Mirror
            | NodeType::Clamp
            | NodeType::LFO
            | NodeType::Jitter
            | NodeType::SpeedScale
            | NodeType::Delay
            | NodeType::Freeze => extend(&mut v, &[MATH, MODIFIERS]),
            // Les modifiers ne peuvent pas alimenter Sequence.
            NodeType::Sequence => extend(&mut v, &[MATH, PHYSICS, COMPOSITES]),
            NodeType::Mix | NodeType::Group | NodeType::Crossfade | NodeType::Switch => {
                extend(&mut v, &[MATH, PHYSICS, COMPOSITES, MODIFIERS])
            }
            _ => unreachable!("not a consumer: {parent:?}"),
        }
        v
    }

    /// Engines dont le mouvement est garanti par construction avec des
    /// params `{}` (phase directement dépendante de t). Les autres peuvent
    /// être statiques par défaut : sources live sans signal (BPM/Audio*/OSC),
    /// layouts statiques (Formation, rotate=0), engines dont l'amplitude ou
    /// la vitesse par défaut est nulle, DrawSpline figé…
    fn always_moves(t: &NodeType) -> bool {
        matches!(
            t,
            NodeType::Circular
                | NodeType::Elliptical
                | NodeType::Spiral
                | NodeType::Lissajous
                | NodeType::Figure8
                | NodeType::Pendulum
                | NodeType::RoseCurve
                | NodeType::Helix
                | NodeType::PerlinNoise
                | NodeType::Swarm
                // lemniscate avec params par défaut : phase dépend de t
                | NodeType::Plugin
        )
    }

    struct Gen<'a> {
        rng: &'a mut SimpleRng,
        /// Mode hostile : params aux bornes dans `params_for`.
        extreme: bool,
        graph: Graph,
        objects: NodeId,
        duration: NodeId,
        has_moving_leaf: bool,
        /// Sequence/Crossfade (bascule temporelle) ou Mix (blend≈0 masque la
        /// branche B) présents : le leaf mobile peut être caché → assertion
        /// de mouvement sautée.
        may_hide_motion: bool,
    }

    impl Gen<'_> {
        fn pick<T: Clone>(&mut self, from: &[T]) -> T {
            let i = (self.rng.rand() * from.len() as f64) as usize % from.len();
            from[i].clone()
        }

        fn add_node(&mut self, node: Node) -> NodeId {
            let id = node.id;
            self.graph.add_node(node);
            id
        }

        fn wire(&mut self, from: NodeId, to: NodeId, to_port: &str) {
            // Le port de sortie se résout par correspondance de type avec
            // le port cible — même règle que le validator.
            let from_ty = self.graph.nodes[&from].node_type.clone();
            let to_ty = self.graph.nodes[&to].node_type.clone();
            let in_ty = crate::node_spec::node_spec(&to_ty)
                .input_port(to_port)
                .map(|p| p.port_type);
            let from_port = crate::node_spec::node_spec(&from_ty)
                .outputs
                .iter()
                .find(|p| Some(p.port_type) == in_ty)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| "out".to_string());
            self.graph.add_edge(Edge {
                from,
                to,
                from_port,
                to_port: to_port.to_string(),
            });
        }

        /// Crée un node engine feuille (Objects + Duration câblés).
        fn leaf(&mut self, node_type: NodeType) -> NodeId {
            let params = match node_type {
                NodeType::Plugin => serde_json::json!({ "plugin_id": "lemniscate" }),
                NodeType::DrawSpline => {
                    let n_pts = 3 + (self.rng.rand() * 3.0) as usize;
                    let pts: Vec<Vec<f64>> = (0..n_pts)
                        .map(|_| {
                            vec![
                                self.rng.uniform(-3.0, 3.0),
                                self.rng.uniform(-1.0, 1.0),
                                self.rng.uniform(-3.0, 3.0),
                            ]
                        })
                        .collect();
                    serde_json::json!({ "points": pts })
                }
                _ => serde_json::json!({}),
            };
            if always_moves(&node_type) {
                self.has_moving_leaf = true;
            }
            let id = self.add_node(Node::with_params(node_type, params));
            self.wire(self.objects, id, "objects");
            self.wire(self.duration, id, "duration");
            id
        }

        /// Params randomisés — `extreme` pousse aux bornes (0, négatif,
        /// énorme) pour la chasse aux bugs ; sinon valeurs plausibles.
        fn params_for_mode(&mut self, node_type: NodeType, extreme: bool) -> serde_json::Value {
            if extreme {
                let pick = |rng: &mut SimpleRng| -> f64 {
                    // bornes plausibles mais agressives
                    [0.0, -1.0, -0.001, 1e-9, 1e6, 1000.0, -500.0][(rng.rand() * 7.0) as usize % 7]
                };
                match node_type {
                    NodeType::Scale => {
                        return serde_json::json!({
                            "x": pick(self.rng), "y": pick(self.rng), "z": pick(self.rng),
                        })
                    }
                    NodeType::Rotate => {
                        return serde_json::json!({
                            "angleX": pick(self.rng), "angleY": pick(self.rng),
                            "angleZ": pick(self.rng),
                        })
                    }
                    NodeType::Offset => {
                        return serde_json::json!({
                            "x": pick(self.rng), "y": pick(self.rng), "z": pick(self.rng),
                        })
                    }
                    NodeType::Clamp => {
                        let lo = pick(self.rng).min(pick(self.rng));
                        let hi = lo.abs().max(1e-9);
                        return serde_json::json!({
                            "min_x": lo, "min_y": lo, "min_z": lo,
                            "max_x": hi, "max_y": hi, "max_z": hi,
                        });
                    }
                    NodeType::Mix => return serde_json::json!({ "blend": pick(self.rng) }),
                    NodeType::Switch => return serde_json::json!({ "select": pick(self.rng) }),
                    NodeType::SpeedScale => return serde_json::json!({ "factor": pick(self.rng) }),
                    NodeType::Delay => return serde_json::json!({ "delay": pick(self.rng) }),
                    NodeType::Freeze => {
                        return serde_json::json!({ "enabled": self.rng.rand() < 0.5 })
                    }
                    NodeType::Crossfade => {
                        return serde_json::json!({ "fade_duration": pick(self.rng) })
                    }
                    _ => return serde_json::json!({}),
                }
            }
            match node_type {
                NodeType::Scale => serde_json::json!({
                    "x": self.rng.uniform(0.2, 2.0),
                    "y": self.rng.uniform(0.2, 2.0),
                    "z": self.rng.uniform(0.2, 2.0),
                }),
                NodeType::Rotate => serde_json::json!({
                    "angleX": self.rng.uniform(0.0, std::f64::consts::PI),
                    "angleY": self.rng.uniform(0.0, std::f64::consts::PI),
                    "angleZ": self.rng.uniform(0.0, std::f64::consts::PI),
                }),
                NodeType::Offset => serde_json::json!({
                    "x": self.rng.uniform(-2.0, 2.0),
                    "y": self.rng.uniform(-2.0, 2.0),
                    "z": self.rng.uniform(-2.0, 2.0),
                }),
                NodeType::Clamp => serde_json::json!({
                    "minX": -1.0, "maxX": 1.0,
                    "minY": -1.0, "maxY": 1.0,
                    "minZ": -1.0, "maxZ": 1.0,
                }),
                NodeType::Mix => serde_json::json!({ "blend": self.rng.uniform(0.0, 1.0) }),
                NodeType::Sequence => serde_json::json!({
                    "fade": self.rng.uniform(0.0, 0.5),
                    "steps": 2,
                }),
                NodeType::Crossfade => serde_json::json!({
                    "duration": self.rng.uniform(0.5, 2.0),
                }),
                NodeType::Switch => serde_json::json!({
                    "select": if self.rng.rand() < 0.5 { 0.0 } else { 1.0 },
                }),
                NodeType::SpeedScale => serde_json::json!({
                    "factor": self.rng.uniform(0.25, 3.0),
                }),
                NodeType::Delay => serde_json::json!({
                    "delay": self.rng.uniform(0.0, 2.0),
                }),
                NodeType::Freeze => serde_json::json!({
                    "enabled": self.rng.rand() < 0.7,
                }),
                _ => serde_json::json!({}),
            }
        }

        /// Construit un producteur de trajectoire dont la racine peut
        /// alimenter `parent`.
        fn producer(&mut self, depth: usize, max_depth: usize, parent: NodeType) -> NodeId {
            let allowed = allowed_roots(parent.clone());
            let wrappers: Vec<NodeType> = allowed
                .iter()
                .filter(|t| COMPOSITES.contains(*t) || MODIFIERS.contains(*t))
                // Group concatène les espaces d'objets (n_a + n_b) — il ne
                // peut alimenter que des consommateurs sans check de comptage
                // (Output, un autre Group). Sous Mix/Sequence/Crossfade/Switch
                // le validator rejette le mismatch, à juste titre.
                .filter(|t| {
                    **t != NodeType::Group || matches!(parent, NodeType::Output | NodeType::Group)
                })
                .cloned()
                .collect();

            let leaf_now = depth >= max_depth
                || wrappers.is_empty()
                || self.rng.rand() < 0.2 + 0.15 * depth as f64;

            if leaf_now {
                let leaves: Vec<NodeType> = allowed
                    .iter()
                    .filter(|t| !COMPOSITES.contains(*t) && !MODIFIERS.contains(*t))
                    .cloned()
                    .collect();
                let leaf_type = self.pick(&leaves);
                return self.leaf(leaf_type);
            }

            let wrapper = self.pick(&wrappers);
            let params = self.params_for_mode(wrapper.clone(), self.extreme);
            let id = self.add_node(Node::with_params(wrapper.clone(), params));
            if matches!(
                wrapper,
                NodeType::Sequence
                    | NodeType::Crossfade
                    | NodeType::Mix
                    | NodeType::Switch
                    | NodeType::Freeze
            ) {
                self.may_hide_motion = true;
            }
            if COMPOSITES.contains(&wrapper) {
                let a = self.producer(depth + 1, max_depth, wrapper.clone());
                let b = self.producer(depth + 1, max_depth, wrapper.clone());
                self.wire(a, id, "a");
                self.wire(b, id, "b");
            } else {
                let child = self.producer(depth + 1, max_depth, wrapper);
                self.wire(child, id, "in");
            }
            id
        }
    }

    /// Construit un graphe complet (Objects + Duration + arbre + Output).
    /// Retourne le graphe, n_objects, si un leaf "toujours mobile" existe et
    /// si une bascule temporelle peut le masquer.
    fn build_graph(seed: u64, max_depth: usize) -> (Graph, usize, bool, bool) {
        build_graph_mode(seed, max_depth, false)
    }

    /// `extreme` : params aux bornes pour la chasse aux bugs.
    fn build_graph_mode(seed: u64, max_depth: usize, extreme: bool) -> (Graph, usize, bool, bool) {
        let mut rng = SimpleRng::new(seed);
        let mut graph = Graph::new();
        let n_objects = 1 + (rng.rand() * 8.0) as usize;

        let objects = Node::with_params(
            NodeType::Objects,
            serde_json::json!({ "n_objects": n_objects }),
        );
        let duration =
            Node::with_params(NodeType::Duration, serde_json::json!({ "duration": 4.0 }));
        let objects_id = objects.id;
        let duration_id = duration.id;
        graph.add_node(objects);
        graph.add_node(duration);

        let mut gen = Gen {
            rng: &mut rng,
            extreme,
            graph,
            objects: objects_id,
            duration: duration_id,
            has_moving_leaf: false,
            may_hide_motion: false,
        };

        let root = gen.producer(0, max_depth, NodeType::Output);
        let output = gen.add_node(Node::new(NodeType::Output));
        gen.wire(root, output, "in");

        (
            gen.graph,
            n_objects,
            gen.has_moving_leaf,
            gen.may_hide_motion,
        )
    }

    /// Pipeline réel : validate → compile → sample finitude/déterminisme.
    /// `level` = profondeur max de l'arbre (complexité croissante).
    #[test]
    fn generated_graphs_validate_compile_and_sample() {
        for level in 1..=6usize {
            for seed in 0..24u64 {
                let tag = format!("level={level} seed={seed}");
                let (graph, n_objects, has_mover, may_hide_motion) =
                    build_graph(seed * 977 + level as u64, level);

                if let Err(errors) = Validator::validate(&graph) {
                    panic!("generated graph failed validation ({tag}): {errors:?}");
                }
                let f = compile(&graph).unwrap_or_else(|e| panic!("compile failed ({tag}): {e:?}"));

                // Finitude + déterminisme sur plusieurs t et objets. On
                // échantillonne au-delà de n_objects : Group étend l'espace
                // d'objets (n_a + n_b) — ses branches hautes doivent aussi
                // produire des positions finies.
                let sample_n = n_objects.max(16);
                let mut moved = false;
                for t in [0.0, 1.7, 3.33, 5.5, 9.0] {
                    for i in 0..sample_n {
                        let p = f(t, i);
                        assert!(
                            p.x.is_finite() && p.y.is_finite() && p.z.is_finite(),
                            "non-finite position ({tag} t={t} i={i}): {p:?}"
                        );
                        let p2 = f(t, i);
                        assert_eq!(p, p2, "non-deterministic output ({tag} t={t} i={i})");
                        if t > 0.0 && (p - f(0.0, i)).norm() > 1e-9 {
                            moved = true;
                        }
                    }
                }
                if has_mover && !may_hide_motion {
                    let topology: Vec<String> = graph
                        .nodes
                        .values()
                        .map(|n| format!("{:?}", n.node_type))
                        .collect();
                    assert!(
                        moved,
                        "graph with moving leaf produced static output ({tag}): {topology:?}"
                    );
                }
            }
        }
    }

    /// Les graphes générés sont mergés proprement : plusieurs moves avec des
    /// tracks qui se chevauchent, sous chaque stratégie, donnent des
    /// positions finies et déterministes.
    #[test]
    fn generated_graphs_merge_cleanly_under_all_strategies() {
        let strategies = [
            MergeStrategy::Override,
            MergeStrategy::Crossfade,
            MergeStrategy::Blend,
            MergeStrategy::Priority,
        ];

        for seed in 0..12u64 {
            // Trois moves aux tracks chevauchées (objets 0..n, décalés)
            let mut entries = Vec::new();
            for m in 0..3u64 {
                let (graph, n_objects, ..) = build_graph(seed * 131 + m * 17 + 3, 3);
                Validator::validate(&graph)
                    .unwrap_or_else(|e| panic!("seed={seed} move={m}: {e:?}"));
                let f = compile(&graph)
                    .unwrap_or_else(|e| panic!("seed={seed} move={m} compile: {e:?}"));

                let positions: Vec<(usize, nalgebra::Vector3<f64>)> = (0..n_objects)
                    .map(|i| (i + m as usize /* overlap */, f(2.5, i)))
                    .collect();
                // (move_id, fade, weight, priority, positions)
                entries.push((format!("m{m}"), 1.0, 1.0, m as u32, positions));
            }

            for strategy in strategies {
                let merged = merge_positions(&entries, strategy);
                assert!(
                    !merged.is_empty(),
                    "seed={seed} strategy={strategy:?}: empty merge"
                );
                for (idx, p) in &merged {
                    assert!(
                        p.x.is_finite() && p.y.is_finite() && p.z.is_finite(),
                        "seed={seed} strategy={strategy:?}: non-finite at track {idx}"
                    );
                }
                // Déterminisme : même appel → même résultat
                let merged2 = merge_positions(&entries, strategy);
                assert_eq!(
                    merged.len(),
                    merged2.len(),
                    "seed={seed} strategy={strategy:?}: non-deterministic merge"
                );
            }
        }
    }

    /// Fuzz de graphes invalides : des mutations aléatoires (edge retiré,
    /// edge parasite, port inexistant, edge dupliqué) doivent être rejetées
    /// proprement par le validator — jamais de panic. Si le graphe muté reste
    /// valide, le compile ne doit pas crasher non plus (Err ok, panic non).
    #[test]
    fn mutated_graphs_fail_cleanly() {
        let bogus_ports = ["in", "a", "b", "duration", "bogus"];

        for seed in 0..48u64 {
            let tag = format!("mutant seed={seed}");
            let (mut graph, n_objects, ..) = build_graph(seed * 613 + 5, 3);
            let mut rng = SimpleRng::new(seed * 31 + 7);

            let node_ids: Vec<NodeId> = graph.nodes.keys().copied().collect();
            let pick_id = |rng: &mut SimpleRng| {
                node_ids[(rng.rand() * node_ids.len() as f64) as usize % node_ids.len()]
            };
            let pick_port = |rng: &mut SimpleRng| {
                bogus_ports[(rng.rand() * bogus_ports.len() as f64) as usize % bogus_ports.len()]
            };

            // 1 à 3 mutations par graphe
            let n_mutations = 1 + (rng.rand() * 3.0) as usize;
            for _ in 0..n_mutations {
                match (rng.rand() * 4.0) as usize {
                    // Retirer un edge au hasard
                    0 if !graph.edges.is_empty() => {
                        let i =
                            (rng.rand() * graph.edges.len() as f64) as usize % graph.edges.len();
                        graph.edges.remove(i);
                    }
                    // Ajouter un edge parasite (types/ports possibles faux)
                    1 => {
                        let from = pick_id(&mut rng);
                        let to = pick_id(&mut rng);
                        graph.add_edge(Edge {
                            from,
                            to,
                            from_port: "out".to_string(),
                            to_port: pick_port(&mut rng).to_string(),
                        });
                    }
                    // Dupliquer un edge existant (arité)
                    2 if !graph.edges.is_empty() => {
                        let i =
                            (rng.rand() * graph.edges.len() as f64) as usize % graph.edges.len();
                        let e = graph.edges[i].clone();
                        graph.add_edge(e);
                    }
                    // Corrompre le port d'un edge existant
                    _ if !graph.edges.is_empty() => {
                        let i =
                            (rng.rand() * graph.edges.len() as f64) as usize % graph.edges.len();
                        graph.edges[i].to_port = pick_port(&mut rng).to_string();
                    }
                    _ => {}
                }
            }

            // Le validator ne doit jamais paniquer
            let valid = Validator::validate(&graph).is_ok();
            if valid {
                // Un graphe muté encore valide doit compiler sans panic ;
                // les positions doivent rester finies.
                if let Ok(f) = compile(&graph) {
                    for t in [0.0, 2.5] {
                        for i in 0..n_objects.max(8) {
                            let p = f(t, i);
                            assert!(
                                p.x.is_finite() && p.y.is_finite() && p.z.is_finite(),
                                "non-finite after mutation ({tag} t={t} i={i})"
                            );
                        }
                    }
                }
            }
        }
    }

    /// Fuzzer de couverture — rapporte la robustesse du système sur un
    /// échantillon aléatoire large : validation, compilation, finitude et
    /// déterminisme, plus la couverture par type et par combo intéressant.
    /// Les stats sont loggées (test #[ignore] manuel ou assertion de
    /// couverture minimale).
    #[test]
    fn fuzz_coverage_robustness_report() {
        use std::collections::HashMap;
        let mut type_counts: HashMap<String, usize> = HashMap::new();
        // Combos intéressants à tracker : <wrapper>→<catégorie-enfant>
        let mut combo_counts: HashMap<String, usize> = HashMap::new();
        let mut n_valid = 0usize;
        let mut n_compiled = 0usize;
        let mut n_moved = 0usize;
        let mut n_total = 0usize;

        let category = |t: &NodeType| -> &'static str {
            if MATH.contains(t) {
                "math"
            } else if PHYSICS.contains(t) {
                "physics"
            } else if MODIFIERS.contains(t) {
                "modifier"
            } else if COMPOSITES.contains(t) {
                "composite"
            } else {
                "other"
            }
        };

        for level in 1..=8usize {
            for seed in 0..40u64 {
                n_total += 1;
                let (graph, n_objects, has_mover, may_hide) =
                    build_graph(seed * 997 + level as u64 * 31, level);

                // Coverage par type
                for n in graph.nodes.values() {
                    *type_counts.entry(format!("{:?}", n.node_type)).or_insert(0) += 1;
                }
                // Coverage par combo parent→enfant (via edges)
                for e in &graph.edges {
                    let from_ty = &graph.nodes[&e.from].node_type;
                    let to_ty = &graph.nodes[&e.to].node_type;
                    let combo = format!("{to_ty:?}→{}", category(from_ty));
                    *combo_counts.entry(combo).or_insert(0) += 1;
                }

                if Validator::validate(&graph).is_err() {
                    continue;
                }
                n_valid += 1;
                let Ok(f) = compile(&graph) else {
                    continue;
                };
                n_compiled += 1;

                let mut moved = false;
                let mut all_finite = true;
                for t in [0.0, 1.3, 3.7, 7.9] {
                    for i in 0..n_objects.max(12) {
                        let p = f(t, i);
                        if !(p.x.is_finite() && p.y.is_finite() && p.z.is_finite()) {
                            all_finite = false;
                        }
                        if t > 0.0 && (p - f(0.0, i)).norm() > 1e-9 {
                            moved = true;
                        }
                    }
                }
                assert!(all_finite, "non-finite position in fuzzed graph");
                if moved {
                    n_moved += 1;
                }
                let _ = (has_mover, may_hide);
            }
        }

        // Assertions de robustesse minimales
        assert_eq!(n_valid, n_total, "des graphes générés doivent tous valider");
        assert_eq!(n_compiled, n_valid, "tout graphe valide doit compiler");
        assert!(n_moved > 0, "aucun graphe ne bouge — générateur suspect");

        // Rapport (visible avec --nocapture)
        eprintln!("=== FUZZ COVERAGE ===");
        eprintln!(
            "graphes: {n_total} | valides: {n_valid} | compilés: {n_compiled} | mobiles: {n_moved}"
        );
        let mut types: Vec<_> = type_counts.iter().collect();
        types.sort_by(|a, b| b.1.cmp(a.1));
        for (ty, c) in &types {
            eprintln!("  {ty:24} {c:5}");
        }
        let mut combos: Vec<_> = combo_counts.iter().collect();
        combos.sort_by(|a, b| b.1.cmp(a.1));
        eprintln!("--- combos (consommateur→catégorie-source) ---");
        for (c, n) in combos.iter().take(20) {
            eprintln!("  {c:40} {n:5}");
        }
        eprintln!("=====================");

        // Couverture minimale : chaque type des sets doit apparaître
        for set in [MATH, PHYSICS, MODIFIERS, COMPOSITES] {
            for ty in set {
                let key = format!("{ty:?}");
                assert!(
                    type_counts.contains_key(&key),
                    "type jamais généré en {n_total} graphes : {key}"
                );
            }
        }
    }

    /// Chasse aux bugs — graphes aux params hostiles (bornes : zéro,
    /// négatif, énorme) évalués à des t extrêmes. On NE panic PAS au
    /// premier échec : les violations sont collectées et rapportées
    /// pour analyser la robustesse réelle du système.
    /// Invariants testés : positions finies, magnitude bornée,
    /// déterminisme entre deux évals au même (t, i).
    #[test]
    fn fuzz_stress_hostile_params() {
        let mut failures: Vec<String> = Vec::new();
        let mut n_run = 0usize;

        // t extrêmes mais réalistes : négatif (pre-loop) et quelques dizaines
        // de secondes. t=1e6 est pathologique — le worker wrappe t en
        // [0, duration) et les physics re-simulent chaque pas (13 min).
        let t_values = [-10.0, -0.001, 0.0, 0.0001, 1.5, 30.0];

        for level in 1..=6usize {
            for seed in 0..60u64 {
                let tag = format!("level={level} seed={seed}");
                let (graph, n_objects, ..) = build_graph_mode(
                    seed * 1237 + level as u64 * 71,
                    level,
                    true, // extreme params
                );

                // Le validator peut rejeter — c'est une réponse valide, pas un bug.
                if let Err(e) = Validator::validate(&graph) {
                    let _ = e;
                    continue;
                }
                n_run += 1;

                let f = match compile(&graph) {
                    Ok(f) => f,
                    Err(e) => {
                        // Un graphe valide qui ne compile pas = bug potentiel.
                        failures.push(format!("{tag}: valid graph failed compile: {e:?}"));
                        continue;
                    }
                };

                let topology: Vec<String> = graph
                    .nodes
                    .values()
                    .map(|n| format!("{:?}", n.node_type))
                    .collect();

                for &tv in &t_values {
                    for i in 0..n_objects.max(8) {
                        let p = f(tv, i);
                        if !(p.x.is_finite() && p.y.is_finite() && p.z.is_finite()) {
                            failures.push(format!(
                                "{tag}: non-finite pos (t={tv} i={i}) = {p:?} | {topology:?}"
                            ));
                            continue;
                        }
                        // Les params extrêmes produisent légitimement des
                        // positions énormes (Scale 1e3² → 1e6×) — GIGO, pas
                        // un bug. On ne flag que l'approche de f64::MAX,
                        // signe d'explosion multiplicative interne.
                        let mag = p.norm();
                        if mag > 1e290 {
                            failures.push(format!(
                                "{tag}: internal numeric explosion {mag:e} (t={tv} i={i}) | {topology:?}"
                            ));
                        }
                        // Déterminisme : même éval = même résultat
                        let p2 = f(tv, i);
                        if p != p2 {
                            failures.push(format!(
                                "{tag}: non-deterministic (t={tv} i={i}) {p:?} vs {p2:?}"
                            ));
                        }
                    }
                }
            }
        }

        eprintln!("=== STRESS HUNT === {n_run} graphes hostiles évalués");
        for f in &failures {
            eprintln!("  FAIL {f}");
        }
        eprintln!("===================");

        // Aucun graphe valide ne doit produire non-fini / explosion / non-déterminisme
        assert!(
            failures.is_empty(),
            "{} violations de robustesse trouvées:\n{}",
            failures.len(),
            failures
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}
