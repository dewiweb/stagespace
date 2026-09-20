#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use crate::animation::{
        Animation, AnimationState, AudioMod, AudioModSource, AudioModTarget, ShapeType,
        TrackAssignment,
    };
    use crate::audio::{AmplitudeData, AudioState, BPMData};
    use crate::compiler::Compiler;
    use crate::engines::EngineParams;
    use crate::graph::{Edge, Graph, Node, NodeId, NodeType};

    use crate::runtime::Runtime;
    use serde_json::json;
    use std::time::Duration;

    /// Construit un graphe simple Objects → Duration → Circular → Output
    /// (réplique ce que fait build_graph_from_shape côté Tauri)
    fn build_graph_from_shape(anim: &Animation, n_objects: usize) -> Graph {
        let mut graph = Graph::new();

        let objects_id = NodeId::new();
        let duration_id = NodeId::new();
        let engine_id = NodeId::new();
        let output_id = NodeId::new();

        let n_objs = n_objects.max(1);

        graph.add_node(Node {
            id: objects_id,
            node_type: NodeType::Objects,
            params: json!({ "n_objects": n_objs }),
            position: (50.0, 200.0),
        });

        graph.add_node(Node {
            id: duration_id,
            node_type: NodeType::Duration,
            params: json!({ "duration": anim.duration }),
            position: (50.0, 50.0),
        });

        let engine_type = match anim.shape {
            ShapeType::Circle => NodeType::Circular,
            ShapeType::Elliptical => NodeType::Elliptical,
            ShapeType::Spiral => NodeType::Spiral,
            ShapeType::Lissajous => NodeType::Lissajous,
            ShapeType::Figure8 => NodeType::Figure8,
            ShapeType::Helix => NodeType::Helix,
            ShapeType::RoseCurve => NodeType::RoseCurve,
            ShapeType::Linear => NodeType::Linear,
            _ => NodeType::Circular,
        };

        let mut engine_params = serde_json::Map::new();
        for (k, v) in &anim.shape_params {
            engine_params.insert(k.clone(), json!(v));
        }
        engine_params.insert("n_objects".to_string(), json!(n_objs));

        graph.add_node(Node {
            id: engine_id,
            node_type: engine_type,
            params: json!(engine_params),
            position: (300.0, 150.0),
        });

        graph.add_node(Node {
            id: output_id,
            node_type: NodeType::Output,
            params: json!({}),
            position: (550.0, 150.0),
        });

        graph.add_edge(Edge {
            from: objects_id,
            to: engine_id,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: duration_id,
            to: engine_id,
            from_port: "output".to_string(),
            to_port: "duration".to_string(),
        });
        graph.add_edge(Edge {
            from: engine_id,
            to: output_id,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        graph
    }

    #[test]
    fn test_animation_default() {
        let anim = Animation::default();
        assert_eq!(anim.shape, ShapeType::Circle);
        assert_eq!(anim.speed, 1.0);
        assert_eq!(anim.duration, 4.0);
        assert_eq!(anim.scale, 1.0);
        assert!(anim.assignments.is_empty());
        assert!(anim.audio_mods.is_empty());
    }

    #[test]
    fn test_animation_serialization() {
        let mut anim = Animation::default();
        anim.name = "Test Circle".to_string();
        anim.shape = ShapeType::Circle;
        anim.shape_params.insert("radius".to_string(), 3.0);
        anim.assignments.push(TrackAssignment {
            track_id: 1,
            depth: 1.0,
            phase_offset: 0.0,
        });
        anim.assignments.push(TrackAssignment {
            track_id: 2,
            depth: 0.5,
            phase_offset: 90.0,
        });
        anim.audio_mods.push(AudioMod {
            source: AudioModSource::AmplitudeBass,
            target: AudioModTarget::RadiusScale,
            amount: 0.8,
            base_value: 2.0,
            smoothing: 0.3,
        });

        let json_str = serde_json::to_string(&anim).unwrap();
        let deserialized: Animation = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.name, "Test Circle");
        assert_eq!(deserialized.shape, ShapeType::Circle);
        assert_eq!(deserialized.shape_params.get("radius"), Some(&3.0));
        assert_eq!(deserialized.assignments.len(), 2);
        assert_eq!(deserialized.assignments[1].depth, 0.5);
        assert_eq!(deserialized.audio_mods.len(), 1);
        assert_eq!(deserialized.audio_mods[0].amount, 0.8);
    }

    #[test]
    fn test_animation_state_depth_and_phase() {
        let mut anim = Animation::default();
        anim.assignments = vec![
            TrackAssignment {
                track_id: 1,
                depth: 1.0,
                phase_offset: 0.0,
            },
            TrackAssignment {
                track_id: 2,
                depth: 0.5,
                phase_offset: 90.0,
            },
            TrackAssignment {
                track_id: 3,
                depth: 0.0,
                phase_offset: 180.0,
            },
        ];

        let track_ids = vec![1, 2, 3];
        let state = AnimationState::from_animation(&anim, &track_ids);

        assert_eq!(state.track_depths, vec![1.0, 0.5, 0.0]);
        assert_eq!(state.track_phase_offsets[0], 0.0);
        assert_eq!(state.track_phase_offsets[1], 90.0);
        assert_eq!(state.track_phase_offsets[2], 180.0);
    }

    #[test]
    fn test_phase_spread() {
        let mut anim = Animation::default();
        anim.phase_spread = 1.0; // 100% spread
        anim.assignments = vec![
            TrackAssignment {
                track_id: 1,
                depth: 1.0,
                phase_offset: 0.0,
            },
            TrackAssignment {
                track_id: 2,
                depth: 1.0,
                phase_offset: 0.0,
            },
            TrackAssignment {
                track_id: 3,
                depth: 1.0,
                phase_offset: 0.0,
            },
            TrackAssignment {
                track_id: 4,
                depth: 1.0,
                phase_offset: 0.0,
            },
        ];

        let track_ids = vec![1, 2, 3, 4];
        let state = AnimationState::from_animation(&anim, &track_ids);

        // Avec 4 tracks et spread=1.0, chaque track est décalée de 90°
        assert_eq!(state.track_phase_offsets[0], 0.0);
        assert_eq!(state.track_phase_offsets[1], 90.0);
        assert_eq!(state.track_phase_offsets[2], 180.0);
        assert_eq!(state.track_phase_offsets[3], 270.0);
    }

    #[test]
    fn test_audio_mod_computation() {
        let mut anim = Animation::default();
        anim.audio_mods = vec![
            AudioMod {
                source: AudioModSource::AmplitudeBass,
                target: AudioModTarget::RadiusScale,
                amount: 1.0,
                base_value: 2.0,
                smoothing: 0.0, // pas de smoothing pour le test
            },
            AudioMod {
                source: AudioModSource::Bpm,
                target: AudioModTarget::Speed,
                amount: 0.5,
                base_value: 1.0,
                smoothing: 0.0,
            },
        ];

        let track_ids = vec![1, 2];
        let mut state = AnimationState::from_animation(&anim, &track_ids);

        // Audio state avec bass=0.5 et bpm=120
        let mut audio = AudioState::new();
        audio.amplitude = Some(AmplitudeData {
            rms: 0.3,
            bass: 0.5,
            mid: 0.2,
            high: 0.1,
        });
        audio.bpm = Some(BPMData {
            bpm: 120.0,
            confidence: 1.0,
            last_beat_time: 0.0,
        });

        let params = state.compute_audio_modulated_params(&audio);

        // delta = amount * bass = 1.0 * 0.5 = 0.5 (delta sur radius_scale)
        assert_eq!(params.get("radius_scale"), Some(&0.5));
        // delta = amount * (bpm/120) = 0.5 * 1.0 = 0.5 (delta sur speed)
        assert_eq!(params.get("speed"), Some(&0.5));
    }

    #[test]
    fn test_audio_mod_smoothing() {
        let mut anim = Animation::default();
        anim.audio_mods = vec![AudioMod {
            source: AudioModSource::AmplitudeRms,
            target: AudioModTarget::Scale,
            amount: 1.0,
            base_value: 1.0,
            smoothing: 0.9, // 90% smoothing = très lissé
        }];

        let track_ids = vec![1];
        let mut state = AnimationState::from_animation(&anim, &track_ids);

        let mut audio = AudioState::new();
        audio.amplitude = Some(AmplitudeData {
            rms: 1.0,
            bass: 0.0,
            mid: 0.0,
            high: 0.0,
        });

        // Première frame : smoothed = 0 * 0.9 + 1.0 * 0.1 = 0.1
        let p1 = state.compute_audio_modulated_params(&audio);
        let scale1 = p1.get("scale").copied().unwrap_or(0.0);
        assert!((scale1 - 0.1).abs() < 1e-10, "expected 0.1, got {scale1}");

        // Deuxième frame : smoothed = 0.1 * 0.9 + 1.0 * 0.1 = 0.19
        let p2 = state.compute_audio_modulated_params(&audio);
        let scale2 = p2.get("scale").copied().unwrap_or(0.0);
        assert!((scale2 - 0.19).abs() < 1e-10, "expected 0.19, got {scale2}");
    }

    #[test]
    fn test_full_flow_circle_animation() {
        // 1. Créer une animation Circle
        let mut anim = Animation::default();
        anim.shape = ShapeType::Circle;
        anim.shape_params.insert("radius".to_string(), 2.0);
        anim.duration = 4.0;
        anim.speed = 1.0;
        anim.assignments = vec![
            TrackAssignment {
                track_id: 1,
                depth: 1.0,
                phase_offset: 0.0,
            },
            TrackAssignment {
                track_id: 2,
                depth: 0.5,
                phase_offset: 0.0,
            },
        ];

        let osc_ids = vec![1, 2];

        // 2. Construire le graphe
        let graph = build_graph_from_shape(&anim, osc_ids.len());

        // 3. Compiler
        let compiled = Compiler::compile(&graph);
        assert!(compiled.is_ok(), "Compilation failed: {:?}", compiled.err());

        // 4. Créer le runtime (worker — écrit dans un PositionBuffer)
        let runtime = Runtime::new();
        runtime.set_position_buffer(std::sync::Arc::new(
            crate::position_buffer::PositionBuffer::new(),
        ));

        // 5. Set l'animation state
        let anim_state = AnimationState::from_animation(&anim, &osc_ids);
        runtime.set_animation_state(anim_state);

        // 6. Set les macros
        runtime.macros().set_speed(anim.speed);
        runtime.macros().set_scale(anim.scale);

        // 7. Lancer le playback
        let params = EngineParams {
            n_objects: osc_ids.len(),
            duration: anim.duration,
            fps: 60.0,
            extra: json!({}),
        };
        let result = runtime.play_compiled(compiled.unwrap(), params, osc_ids);
        assert!(result.is_ok(), "Playback failed: {result:?}");
        assert!(runtime.is_running());

        // 8. Attendre un peu puis arrêter
        std::thread::sleep(Duration::from_millis(100));
        runtime.stop();
        assert!(!runtime.is_running());
    }

    #[test]
    fn test_full_flow_with_audio_mods() {
        let mut anim = Animation::default();
        anim.shape = ShapeType::Circle;
        anim.shape_params.insert("radius".to_string(), 2.0);
        anim.duration = 4.0;
        anim.audio_mods = vec![AudioMod {
            source: AudioModSource::AmplitudeBass,
            target: AudioModTarget::RadiusScale,
            amount: 1.0,
            base_value: 2.0,
            smoothing: 0.0,
        }];

        let osc_ids = vec![1, 2, 3];

        let graph = build_graph_from_shape(&anim, osc_ids.len());
        let compiled = Compiler::compile(&graph).expect("compile");

        let runtime = Runtime::new();
        runtime.set_position_buffer(std::sync::Arc::new(
            crate::position_buffer::PositionBuffer::new(),
        ));

        let anim_state = AnimationState::from_animation(&anim, &osc_ids);
        runtime.set_animation_state(anim_state);

        // Pousser un audio state
        let mut audio = AudioState::new();
        audio.amplitude = Some(AmplitudeData {
            rms: 0.5,
            bass: 0.8,
            mid: 0.3,
            high: 0.1,
        });
        runtime.set_audio_state(audio);

        let params = EngineParams {
            n_objects: osc_ids.len(),
            duration: anim.duration,
            fps: 60.0,
            extra: json!({}),
        };
        let result = runtime.play_compiled(compiled, params, osc_ids);
        assert!(
            result.is_ok(),
            "Playback with audio mods failed: {result:?}"
        );

        std::thread::sleep(Duration::from_millis(50));
        runtime.stop();
    }

    #[test]
    fn test_depth_zero_track_doesnt_move() {
        // Une track avec depth=0 ne doit pas bouger (reste à l'origin)
        let mut anim = Animation::default();
        anim.shape = ShapeType::Circle;
        anim.shape_params.insert("radius".to_string(), 5.0);
        anim.duration = 4.0;
        anim.assignments = vec![
            TrackAssignment {
                track_id: 1,
                depth: 1.0,
                phase_offset: 0.0,
            },
            TrackAssignment {
                track_id: 2,
                depth: 0.0,
                phase_offset: 0.0,
            }, // depth=0
        ];

        let osc_ids = vec![1, 2];
        let state = AnimationState::from_animation(&anim, &osc_ids);

        assert_eq!(state.track_depths[0], 1.0);
        assert_eq!(state.track_depths[1], 0.0);
        // Le runtime fera: pos = origin + (raw_pos - origin) * 0 = origin
        // Donc la track 2 reste à l'origin
    }

    #[test]
    fn test_phase_offset_shifts_time() {
        // Une track avec phase_offset=180° doit être à l'opposé du cercle
        let mut anim = Animation::default();
        anim.shape = ShapeType::Circle;
        anim.shape_params.insert("radius".to_string(), 1.0);
        anim.duration = 4.0;
        anim.assignments = vec![
            TrackAssignment {
                track_id: 1,
                depth: 1.0,
                phase_offset: 0.0,
            },
            TrackAssignment {
                track_id: 2,
                depth: 1.0,
                phase_offset: 180.0,
            },
        ];

        let osc_ids = vec![1, 2];
        let state = AnimationState::from_animation(&anim, &osc_ids);

        // phase_offset=180° avec duration=4s → décalage temporel = (180/360)*4 = 2s
        assert_eq!(state.track_phase_offsets[0], 0.0);
        assert_eq!(state.track_phase_offsets[1], 180.0);
    }

    #[test]
    fn test_multiple_shapes_compile() {
        let shapes = vec![
            ShapeType::Circle,
            ShapeType::Elliptical,
            ShapeType::Spiral,
            ShapeType::Figure8,
            ShapeType::Lissajous,
            ShapeType::Helix,
            ShapeType::RoseCurve,
        ];

        for shape in shapes {
            let mut anim = Animation::default();
            anim.shape = shape.clone();
            anim.shape_params.insert("radius".to_string(), 2.0);
            anim.duration = 4.0;

            let graph = build_graph_from_shape(&anim, 4);
            let result = Compiler::compile(&graph);
            assert!(
                result.is_ok(),
                "Shape {:?} failed to compile: {:?}",
                shape,
                result.err()
            );
        }
    }
}
