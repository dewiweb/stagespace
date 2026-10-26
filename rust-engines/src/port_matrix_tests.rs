//! Tests exhaustifs du modèle de ports typés.
//!
//! La règle unique du graphe est : une edge `A.out_p → B.in_p` est valide
//! ssi `out_p.port_type == in_p.port_type`. Ce fichier vérifie la règle sur
//! TOUTES les combinaisons de ports déclarés du catalogue, puis exerce les
//! scénarios réels valides et invalides (arité, required, cycles, contextes,
//! déterminisme).
#[cfg(test)]
mod tests {
    use crate::compiler::Compiler;
    use crate::graph::{Edge, Graph, Node, NodeId, NodeType};
    use crate::node_spec::{all_node_specs, node_spec, PortType};
    use crate::validator::{GraphContext, ValidationError, Validator};
    use serde_json::json;

    // ─── Helpers ────────────────────────────────────────────────────────

    fn edge(from: NodeId, to: NodeId, fp: &str, tp: &str) -> Edge {
        Edge {
            from,
            to,
            from_port: fp.to_string(),
            to_port: tp.to_string(),
        }
    }

    /// Graphe à deux nodes + une edge — sert à isoler le check de type de
    /// port (les erreurs de topologie MissingRequiredNode/contexte sont
    /// ignorées, on ne regarde que les TypeMismatch sur l'edge).
    fn type_mismatches(
        from_t: NodeType,
        fp: &str,
        to_t: NodeType,
        tp: &str,
    ) -> Vec<ValidationError> {
        let mut g = Graph::new();
        let a = Node::new(from_t);
        let b = Node::new(to_t);
        let (ia, ib) = (a.id, b.id);
        g.add_node(a);
        g.add_node(b);
        g.add_edge(edge(ia, ib, fp, tp));
        let errs = Validator::validate(&g).err().unwrap_or_default();
        errs.into_iter()
            .filter(|e| matches!(e, ValidationError::TypeMismatch(_)))
            .collect()
    }

    /// Graphe move minimal valide : Objects→E(objects), Duration→E(duration),
    /// puis `tail` chaînée jusqu'à Output.in. `tail` = liste de
    /// (type, port_cible, edges_supplémentaires).
    fn move_graph(
        engine: NodeType,
        tail: &[(NodeType, Vec<(usize, &str)>)], // (node, [(idx_source, port)])
    ) -> Graph {
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, json!({"duration": 4.0}));
        let eng = Node::new(engine);
        let out = Node::new(NodeType::Output);
        let (io, id_, ie, iout) = (objects.id, duration.id, eng.id, out.id);
        g.add_node(objects);
        g.add_node(duration);
        g.add_node(eng);
        g.add_node(out);
        g.add_edge(edge(io, ie, "objects", "objects"));
        g.add_edge(edge(id_, ie, "duration", "duration"));

        // Chaîne : prev ← engine, puis chaque node de tail. La dernière
        // node alimente Output.in.
        let mut prev = ie;
        let mut ids = vec![ie];
        for (nt, links) in tail {
            let n = Node::new(nt.clone());
            let iid = n.id;
            g.add_node(n);
            ids.push(iid);
            for (src_idx, port) in links {
                let src = ids[*src_idx];
                let fp = if src == io {
                    "objects"
                } else if src == id_ {
                    "duration"
                } else {
                    "out"
                };
                g.add_edge(edge(src, iid, fp, port));
            }
            prev = iid;
        }
        g.add_edge(edge(prev, iout, "out", "in"));
        g
    }

    // ─── 1. Matrice exhaustive des paires de ports ──────────────────────

    /// Pour chaque spec du catalogue, chaque port de sortie × chaque port
    /// d'entrée de chaque autre node : la présence d'un TypeMismatch doit
    /// être exactement équivalente à `out.port_type != in.port_type`.
    /// C'est LA propriété fondatrice du nouveau modèle.
    #[test]
    fn port_type_equality_is_the_complete_rule() {
        let mut combos = 0usize;
        for from_spec in all_node_specs() {
            for out_p in &from_spec.outputs {
                for to_spec in all_node_specs() {
                    for in_p in &to_spec.inputs {
                        combos += 1;
                        let errs = type_mismatches(
                            from_spec.node_type.clone(),
                            &out_p.name,
                            to_spec.node_type.clone(),
                            &in_p.name,
                        );
                        if out_p.port_type == in_p.port_type {
                            assert!(
                                errs.is_empty(),
                                "{:?}.{} ({:?}) → {:?}.{} ({:?}) devrait être valide : {errs:?}",
                                from_spec.node_type,
                                out_p.name,
                                out_p.port_type,
                                to_spec.node_type,
                                in_p.name,
                                in_p.port_type,
                            );
                        } else {
                            assert!(
                                !errs.is_empty(),
                                "{:?}.{} ({:?}) → {:?}.{} ({:?}) devrait être rejeté",
                                from_spec.node_type,
                                out_p.name,
                                out_p.port_type,
                                to_spec.node_type,
                                in_p.name,
                                in_p.port_type,
                            );
                        }
                    }
                }
            }
        }
        // Garde-fou : la matrice couvre réellement le catalogue, pas
        // un sous-ensemble vide si la table venait à régresser.
        assert!(combos > 1500, "matrice trop petite : {combos} combinaisons");
    }

    /// Aucun port déclaré ne doit porter un ancien nom (legacy aliases
    /// supprimés du modèle).
    #[test]
    fn no_legacy_port_names_remain() {
        for spec in all_node_specs() {
            for p in spec.inputs.iter().chain(spec.outputs.iter()) {
                assert!(
                    !matches!(
                        p.name.as_str(),
                        "input" | "input_a" | "input_b" | "output" | "trajectory"
                    ),
                    "{:?} port '{}' est un nom legacy",
                    spec.node_type,
                    p.name
                );
            }
        }
    }

    /// Chaque port de sortie apparaît au moins une fois comme type
    /// compatible avec un port d'entrée existant — un type orphelin
    /// serait une erreur de conception du catalogue.
    #[test]
    fn every_output_type_is_consumable() {
        for spec in all_node_specs() {
            for out_p in &spec.outputs {
                let consumed = all_node_specs()
                    .iter()
                    .any(|s| s.inputs.iter().any(|ip| ip.port_type == out_p.port_type));
                assert!(
                    consumed,
                    "{:?}.{} ({:?}) ne peut alimenter aucun port du catalogue",
                    spec.node_type, out_p.name, out_p.port_type
                );
            }
        }
    }

    // ─── 2. Graphes valides end-to-end ──────────────────────────────────

    /// Chaîne canonique Objects+Duration→engine→Output pour CHAQUE node
    /// moteur du catalogue (engine_in = objects+duration).
    #[test]
    fn every_engine_compiles_in_canonical_chain() {
        for spec in all_node_specs() {
            let is_engine = spec.inputs.iter().any(|p| {
                p.port_type == PortType::ObjectSet
            }) && spec.outputs.iter().any(|p| p.port_type == PortType::Positions)
                && spec.scope != crate::node_spec::NodeScope::GlobalOnly
                && spec.scope != crate::node_spec::NodeScope::SignalOnly
                // Les nodes spline ont un port 'spline' requis — couverts
                // par spline_chain_compiles, pas par la chaîne canonique.
                && !spec
                    .inputs
                    .iter()
                    .any(|p| p.port_type == PortType::Spline)
                // Plugin nécessite un registry — couvert par plugin_tests.
                && spec.node_type != NodeType::Plugin;
            if !is_engine {
                continue;
            }
            let g = move_graph(spec.node_type.clone(), &[]);
            let f = Compiler::compile(&g)
                .unwrap_or_else(|e| panic!("{:?} canonical chain failed: {e:?}", spec.node_type));
            let p = f(1.0, 0);
            assert!(p.x.is_finite() && p.y.is_finite() && p.z.is_finite());
        }
    }

    /// Tout modifier (positions_in + out_pos, SubOnly) doit compiler au
    /// milieu d'une chaîne engine→modifier→Output, ET après un engine
    /// physique — la restriction physics→modifier était arbitraire.
    #[test]
    fn physics_to_modifier_is_legal() {
        for phys in [
            NodeType::Bouncing,
            NodeType::Spring,
            NodeType::Follow,
            NodeType::Swarm,
            NodeType::Avoidance,
        ] {
            for modifier in [NodeType::Scale, NodeType::Rotate, NodeType::Offset] {
                let g = move_graph(phys.clone(), &[(modifier.clone(), vec![(0, "in")])]);
                assert!(
                    Validator::validate(&g).is_ok(),
                    "{phys:?} → {modifier:?} devrait valider : {:?}",
                    Validator::validate(&g).err()
                );
            }
        }
    }

    /// modifier → composite (a/b) : valide — le compilateur compile
    /// déjà la duration à travers les modifiers.
    #[test]
    fn modifier_to_sequence_is_legal() {
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, json!({"duration": 4.0}));
        let e1 = Node::new(NodeType::Circular);
        let e2 = Node::new(NodeType::Spiral);
        let scale = Node::new(NodeType::Scale);
        let seq = Node::new(NodeType::Sequence);
        let out = Node::new(NodeType::Output);
        let (io, id_, i1, i2, isc, isq, iout) = (
            objects.id,
            duration.id,
            e1.id,
            e2.id,
            scale.id,
            seq.id,
            out.id,
        );
        for n in [objects, duration, e1, e2, scale, seq, out] {
            g.add_node(n);
        }
        g.add_edge(edge(io, i1, "objects", "objects"));
        g.add_edge(edge(id_, i1, "duration", "duration"));
        g.add_edge(edge(io, i2, "objects", "objects"));
        g.add_edge(edge(id_, i2, "duration", "duration"));
        g.add_edge(edge(i1, isc, "out", "in"));
        g.add_edge(edge(isc, isq, "out", "a"));
        g.add_edge(edge(i2, isq, "out", "b"));
        g.add_edge(edge(isq, iout, "out", "in"));
        assert!(Validator::validate(&g).is_ok());
        let f = Compiler::compile(&g).expect("compile modifier→sequence");
        let p = f(0.5, 0);
        assert!(p.x.is_finite() && p.y.is_finite() && p.z.is_finite());
    }

    /// DrawSpline expose DEUX sorties : `out` (Positions — la trajectoire
    /// d'avancement) et `spline` (Spline — la géométrie pour Evaluate/Trim/Offset).
    #[test]
    fn draw_spline_dual_outputs() {
        let spec = node_spec(&NodeType::DrawSpline);
        let outs: Vec<(&str, PortType)> = spec
            .outputs
            .iter()
            .map(|p| (p.name.as_str(), p.port_type))
            .collect();
        assert_eq!(
            outs,
            vec![("out", PortType::Positions), ("spline", PortType::Spline)]
        );
    }

    /// Chaîne spline complète : DrawSpline.spline → EvaluateSpline.spline,
    /// carriers sur objects/duration, out → Output.
    #[test]
    fn spline_chain_compiles() {
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, json!({"duration": 4.0}));
        let draw = Node::with_params(NodeType::DrawSpline, json!({"points": "0,0,0 1,1,0 2,0,1"}));
        let eval = Node::new(NodeType::EvaluateSpline);
        let out = Node::new(NodeType::Output);
        let (io, id_, idr, iev, iout) = (objects.id, duration.id, draw.id, eval.id, out.id);
        for n in [objects, duration, draw, eval, out] {
            g.add_node(n);
        }
        g.add_edge(edge(io, idr, "objects", "objects"));
        g.add_edge(edge(id_, idr, "duration", "duration"));
        g.add_edge(edge(io, iev, "objects", "objects"));
        g.add_edge(edge(id_, iev, "duration", "duration"));
        g.add_edge(edge(idr, iev, "spline", "spline"));
        g.add_edge(edge(iev, iout, "out", "in"));
        assert!(
            Validator::validate(&g).is_ok(),
            "{:?}",
            Validator::validate(&g).err()
        );
        let f = Compiler::compile(&g).expect("compile spline chain");
        let p = f(0.5, 0);
        assert!(p.x.is_finite() && p.y.is_finite() && p.z.is_finite());
    }

    // ─── 3. Graphes invalides — chaque faute a son erreur ───────────────

    /// Carriers croisés : Objects→duration et Duration→objects doivent
    /// être rejetés (ObjectSet ≠ Duration).
    #[test]
    fn crossed_carriers_rejected() {
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, json!({"duration": 4.0}));
        let eng = Node::new(NodeType::Circular);
        let out = Node::new(NodeType::Output);
        let (io, id_, ie, iout) = (objects.id, duration.id, eng.id, out.id);
        for n in [objects, duration, eng, out] {
            g.add_node(n);
        }
        g.add_edge(edge(io, ie, "objects", "duration")); // WRONG
        g.add_edge(edge(id_, ie, "duration", "objects")); // WRONG
        g.add_edge(edge(ie, iout, "out", "in"));
        let errs = Validator::validate(&g).unwrap_err();
        let mm = errs
            .iter()
            .filter(|e| matches!(e, ValidationError::TypeMismatch(_)))
            .count();
        assert!(mm >= 2, "attendu ≥2 TypeMismatch, obtenu {errs:?}");
    }

    /// Objects ne peut PAS alimenter un port Positions (le flux n'est pas
    /// une trajectoire — c'est la faute historique de `Feeds`).
    #[test]
    fn objects_to_positions_rejected() {
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let scale = Node::new(NodeType::Scale);
        let (io, isc) = (objects.id, scale.id);
        g.add_node(objects);
        g.add_node(scale);
        g.add_edge(edge(io, isc, "objects", "in"));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::TypeMismatch(_))));
    }

    /// Ports inexistants → TypeMismatch explicite ("has no output port" /
    /// "has no input port") — déterministe, pas de silent fallback.
    #[test]
    fn nonexistent_ports_rejected() {
        let errs_out = type_mismatches(NodeType::Circular, "input_a", NodeType::Output, "in");
        let errs_in = type_mismatches(NodeType::Circular, "out", NodeType::Output, "objects");
        assert_eq!(errs_out.len(), 1);
        assert_eq!(errs_in.len(), 1);
    }

    /// Fan-in : deux edges sur le MÊME port d'entrée → rejet (le compilateur
    /// réduirait silencieusement à un seul upstream).
    #[test]
    fn duplicate_input_port_rejected() {
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, json!({"duration": 4.0}));
        let e1 = Node::new(NodeType::Circular);
        let e2 = Node::new(NodeType::Spiral);
        let scale = Node::new(NodeType::Scale);
        let out = Node::new(NodeType::Output);
        let (io, id_, i1, i2, isc, iout) =
            (objects.id, duration.id, e1.id, e2.id, scale.id, out.id);
        for n in [objects, duration, e1, e2, scale, out] {
            g.add_node(n);
        }
        g.add_edge(edge(io, i1, "objects", "objects"));
        g.add_edge(edge(id_, i1, "duration", "duration"));
        g.add_edge(edge(io, i2, "objects", "objects"));
        g.add_edge(edge(id_, i2, "duration", "duration"));
        g.add_edge(edge(i1, isc, "out", "in"));
        g.add_edge(edge(i2, isc, "out", "in")); // 'in' déjà pris
        g.add_edge(edge(isc, iout, "out", "in"));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(
            errs.iter().any(|e| matches!(
                e,
                ValidationError::TypeMismatch(m) if m.contains("receives 2 edges")
            )),
            "{errs:?}"
        );
    }

    /// Required : modifier sans 'in', composite sans 'a'/'b', Output sans
    /// 'in', SignalOut sans 'signal' — chaque manquant produit une erreur.
    #[test]
    fn required_ports_enforced() {
        // Modifier nu → required 'in' manquant
        let mut g = Graph::new();
        g.add_node(Node::new(NodeType::Scale));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(
            errs.iter().any(|e| matches!(
                e,
                ValidationError::InvalidConnection(m) if m.contains("'in'")
            )),
            "{errs:?}"
        );

        // Output nu → required 'in' manquant
        let mut g = Graph::new();
        g.add_node(Node::new(NodeType::Output));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(errs.iter().any(|e| matches!(
            e,
            ValidationError::InvalidConnection(m) if m.contains("'in'")
        )));

        // Composite avec seulement 'a' → 'b' requis manquant
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, json!({"duration": 4.0}));
        let eng = Node::new(NodeType::Circular);
        let mix = Node::new(NodeType::Mix);
        let out = Node::new(NodeType::Output);
        let (io, id_, ie, im, iout) = (objects.id, duration.id, eng.id, mix.id, out.id);
        for n in [objects, duration, eng, mix, out] {
            g.add_node(n);
        }
        g.add_edge(edge(io, ie, "objects", "objects"));
        g.add_edge(edge(id_, ie, "duration", "duration"));
        g.add_edge(edge(ie, im, "out", "a"));
        g.add_edge(edge(im, iout, "out", "in"));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(
            errs.iter().any(|e| matches!(
                e,
                ValidationError::InvalidConnection(m) if m.contains("'b'")
            )),
            "{errs:?}"
        );
    }

    /// Cycle : Scale→Rotate→Scale — détecté par le validator.
    #[test]
    fn cycle_rejected() {
        let mut g = Graph::new();
        let a = Node::new(NodeType::Scale);
        let b = Node::new(NodeType::Rotate);
        let (ia, ib) = (a.id, b.id);
        g.add_node(a);
        g.add_node(b);
        g.add_edge(edge(ia, ib, "out", "in"));
        g.add_edge(edge(ib, ia, "out", "in"));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::CycleDetected)));
    }

    /// Contextes : node GlobalOnly dans un sub-graph et inverse —
    /// rejet par ContextIncompatible (le check de type de port passe,
    /// c'est le domaine qui est faux).
    #[test]
    fn scope_violations_rejected() {
        // Merge (GlobalOnly) dans un sub-graph
        let mut g = Graph::new();
        g.add_node(Node::new(NodeType::Merge));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(
            errs.iter()
                .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
            "{errs:?}"
        );

        // Circular (SubOnly) dans un graphe global
        let mut g = Graph::new();
        let merge = Node::new(NodeType::Merge);
        let circ = Node::new(NodeType::Circular);
        let out = Node::new(NodeType::Output);
        let (im, ic, io) = (merge.id, circ.id, out.id);
        for n in [merge, circ, out] {
            g.add_node(n);
        }
        g.add_edge(edge(im, ic, "out", "in"));
        g.add_edge(edge(ic, io, "out", "in"));
        let errs = Validator::validate_with_context(&g, GraphContext::Global).unwrap_err();
        assert!(
            errs.iter()
                .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
            "{errs:?}"
        );
    }

    /// Domaines disjoints : Signal ne peut pas traverser le sub-graph
    /// Positions, même si les ports ont le même nom.
    #[test]
    fn signal_positions_domains_do_not_mix() {
        // SignalConst (Signal) → Scale.in (Positions) : TypeMismatch
        let errs = type_mismatches(NodeType::SignalConst, "out", NodeType::Scale, "in");
        assert_eq!(errs.len(), 1);
        // SignalConst dans un graphe de positions → contexte rejeté aussi
        let mut g = Graph::new();
        g.add_node(Node::new(NodeType::SignalConst));
        let errs = Validator::validate(&g).unwrap_err();
        assert!(!errs.is_empty());
    }

    // ─── 4. Déterminisme ────────────────────────────────────────────────

    /// Le même graphe construit avec les edges dans un ordre différent
    /// produit le même verdict et une compilation identique.
    #[test]
    fn edge_order_does_not_change_semantics() {
        fn build(order: &[usize]) -> Graph {
            let mut g = Graph::new();
            let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
            let duration = Node::with_params(NodeType::Duration, json!({"duration": 4.0}));
            let e1 = Node::new(NodeType::Circular);
            let e2 = Node::new(NodeType::Spiral);
            let mix = Node::new(NodeType::Mix);
            let out = Node::new(NodeType::Output);
            let (io, id_, i1, i2, im, iout) =
                (objects.id, duration.id, e1.id, e2.id, mix.id, out.id);
            // IDs fixes pour que les deux graphes soient identiques
            let mut objs = objects;
            objs.id = io;
            let mut dur = duration;
            dur.id = id_;
            for n in [objs, dur, e1, e2, mix, out] {
                g.add_node(n);
            }
            let all = [
                edge(io, i1, "objects", "objects"),
                edge(io, i2, "objects", "objects"),
                edge(id_, i1, "duration", "duration"),
                edge(id_, i2, "duration", "duration"),
                edge(i1, im, "out", "a"),
                edge(i2, im, "out", "b"),
                edge(im, iout, "out", "in"),
            ];
            for &i in order {
                g.add_edge(all[i].clone());
            }
            g
        }
        let g1 = build(&[0, 1, 2, 3, 4, 5, 6]);
        let g2 = build(&[6, 5, 4, 3, 2, 1, 0]);
        assert_eq!(
            Validator::validate(&g1).is_ok(),
            Validator::validate(&g2).is_ok()
        );
        let f1 = Compiler::compile(&g1).expect("g1");
        let f2 = Compiler::compile(&g2).expect("g2");
        for t in [0.0, 0.5, 1.7] {
            for i in 0..3 {
                assert_eq!(f1(t, i), f2(t, i), "t={t} obj={i}");
            }
        }
    }
}
