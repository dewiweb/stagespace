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
    use crate::compiler::Compiler;
    use crate::graph::{Edge, Graph, Node, NodeId, NodeType};
    use crate::merge_runtime::{merge_positions, MergeStrategy};
    use crate::rng::SimpleRng;
    use crate::validator::Validator;

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
    ];

    const COMPOSITES: &[NodeType] = &[
        NodeType::Mix,
        NodeType::Group,
        NodeType::Sequence,
        NodeType::Crossfade,
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
            | NodeType::Jitter => extend(&mut v, &[MATH, MODIFIERS]),
            // Les modifiers ne peuvent pas alimenter Sequence.
            NodeType::Sequence => extend(&mut v, &[MATH, PHYSICS, COMPOSITES]),
            NodeType::Mix | NodeType::Group | NodeType::Crossfade => {
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
        )
    }

    struct Gen<'a> {
        rng: &'a mut SimpleRng,
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
            self.graph.add_edge(Edge {
                from,
                to,
                from_port: "output".to_string(),
                to_port: to_port.to_string(),
            });
        }

        /// Crée un node engine feuille (Objects + Duration câblés).
        fn leaf(&mut self, node_type: NodeType) -> NodeId {
            let params = match node_type {
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
            self.wire(self.objects, id, "input");
            self.wire(self.duration, id, "duration");
            id
        }

        /// Paramètres légèrement randomisés pour couvrir les chemins
        /// de lecture des modifiers/composites.
        fn params_for(&mut self, node_type: NodeType) -> serde_json::Value {
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
                // (Output, un autre Group, Crossfade). Sous Mix/Sequence le
                // validator rejette le mismatch, à juste titre.
                .filter(|t| {
                    **t != NodeType::Group
                        || matches!(
                            parent,
                            NodeType::Output | NodeType::Group | NodeType::Crossfade
                        )
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
            let params = self.params_for(wrapper.clone());
            let id = self.add_node(Node::with_params(wrapper.clone(), params));
            if matches!(
                wrapper,
                NodeType::Sequence | NodeType::Crossfade | NodeType::Mix
            ) {
                self.may_hide_motion = true;
            }
            if COMPOSITES.contains(&wrapper) {
                let a = self.producer(depth + 1, max_depth, wrapper.clone());
                let b = self.producer(depth + 1, max_depth, wrapper.clone());
                self.wire(a, id, "input_a");
                self.wire(b, id, "input_b");
            } else {
                let child = self.producer(depth + 1, max_depth, wrapper);
                self.wire(child, id, "input");
            }
            id
        }
    }

    /// Construit un graphe complet (Objects + Duration + arbre + Output).
    /// Retourne le graphe, n_objects, si un leaf "toujours mobile" existe et
    /// si une bascule temporelle peut le masquer.
    fn build_graph(seed: u64, max_depth: usize) -> (Graph, usize, bool, bool) {
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
            graph,
            objects: objects_id,
            duration: duration_id,
            has_moving_leaf: false,
            may_hide_motion: false,
        };

        let root = gen.producer(0, max_depth, NodeType::Output);
        let output = gen.add_node(Node::new(NodeType::Output));
        gen.wire(root, output, "input");

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
                let f = Compiler::compile(&graph)
                    .unwrap_or_else(|e| panic!("compile failed ({tag}): {e:?}"));

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
                let f = Compiler::compile(&graph)
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
        let bogus_ports = ["input", "input_a", "input_b", "duration", "bogus"];

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
                            from_port: "output".to_string(),
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
                if let Ok(f) = Compiler::compile(&graph) {
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
}
