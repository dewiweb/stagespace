//! Tests du système de plugins WASM — modules écrits en WAT inline
//! (wasmtime compile le texte wat nativement, pas de toolchain wasm32
//! requis en CI).

#[cfg(test)]
mod tests {
    use crate::compiler::{Compiler, LiveInputs};
    use crate::engines::{Engine, EngineParams};
    use crate::graph::{Edge, Graph, Node, NodeType};
    use crate::plugins::{
        load_bundle_bytes, PluginEngine, PluginKind, PluginManifest, PluginParamDef,
        PluginRegistry, HOST_ABI_VERSION,
    };
    use crate::validator::Validator;
    use serde_json::json;
    use std::io::{Cursor, Write};
    use std::sync::{Arc, Mutex};

    /// Plugin de test minimal : écrit (t, i, params_len) dans le buffer
    /// résultat — prouve le passage des scalaires ET du JSON de params.
    const ECHO_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32)
    (f64.store (i32.const 0) (local.get 0))
    (f64.store (i32.const 8) (f64.convert_i32_s (local.get 1)))
    (f64.store (i32.const 16) (f64.convert_i32_s (local.get 4)))))
"#;

    /// Plugin qui trap systématiquement.
    const TRAP_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32)
    unreachable))
"#;

    /// Plugin en boucle infinie — doit être tué par le fuel, pas geler.
    const INFINITE_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32)
    (loop (br 0))))
"#;

    fn manifest(id: &str) -> PluginManifest {
        PluginManifest {
            id: id.to_string(),
            name: format!("Test {id}"),
            version: "1.0.0".to_string(),
            author: None,
            abi_version: HOST_ABI_VERSION,
            kind: PluginKind::Engine,
            category: None,
            description: None,
            params: vec![],
            capabilities: vec![],
        }
    }

    fn registry_with(id: &str, wat: &str) -> Arc<Mutex<PluginRegistry>> {
        let mut reg = PluginRegistry::new().expect("registry");
        reg.register_wasm(manifest(id), wat.as_bytes())
            .expect("register");
        Arc::new(Mutex::new(reg))
    }

    fn engine_params() -> EngineParams {
        EngineParams {
            n_objects: 4,
            duration: 10.0,
            fps: 60.0,
            extra: json!({"plugin_id": "echo", "gain": 2.0}),
        }
    }

    // ---------- Manifeste ----------

    #[test]
    fn manifest_accepts_valid() {
        assert!(manifest("lemniscate").validate().is_ok());
    }

    #[test]
    fn manifest_rejects_bad_abi_version() {
        let mut m = manifest("x");
        m.abi_version = HOST_ABI_VERSION + 1;
        assert!(m.validate().unwrap_err().contains("abi_version"));
        m.abi_version = 0;
        assert!(m.validate().is_err());
    }

    #[test]
    fn manifest_rejects_bad_id() {
        let m = manifest("bad id!");
        assert!(m.validate().unwrap_err().contains("id"));
        let m = manifest("");
        assert!(m.validate().is_err());
    }

    #[test]
    fn manifest_rejects_duplicate_param_keys() {
        let param = |key: &str| PluginParamDef {
            key: key.into(),
            param_type: "number".into(),
            default: json!(1.0),
            min: None,
            max: None,
            step: None,
            label: None,
            options: None,
            live: None,
        };
        let mut m = manifest("x");
        m.params = vec![param("a"), param("a")];
        assert!(m.validate().unwrap_err().contains("duplicate"));
    }

    // ---------- Engine wasm ----------

    #[test]
    fn wasm_engine_computes_positions() {
        let reg = registry_with("echo", ECHO_WAT);
        let reg = reg.lock().unwrap_or_else(|e| e.into_inner());
        let plugin = reg.get("echo").expect("plugin");
        let engine = PluginEngine::new(plugin, reg.wasm_engine()).expect("engine");
        let params = engine_params();

        let p = engine.position(2.0, 3, &params);
        assert_eq!(p.x, 2.0);
        assert_eq!(p.y, 3.0);
        // z = params_len — le JSON sérialisé a été écrit et mesuré
        assert!(p.z > 0.0, "params_len should be > 0, got {}", p.z);
    }

    #[test]
    fn wasm_engine_trap_returns_zero_not_panic() {
        let reg = registry_with("trapper", TRAP_WAT);
        let reg = reg.lock().unwrap_or_else(|e| e.into_inner());
        let plugin = reg.get("trapper").expect("plugin");
        let engine = PluginEngine::new(plugin, reg.wasm_engine()).expect("engine");
        let p = engine.position(1.0, 0, &engine_params());
        assert_eq!(p, nalgebra::Vector3::zeros());
        // Deuxième appel — le store reste utilisable après un trap
        let p2 = engine.position(2.0, 1, &engine_params());
        assert_eq!(p2, nalgebra::Vector3::zeros());
    }

    #[test]
    fn wasm_engine_infinite_loop_killed_by_fuel() {
        let reg = registry_with("loopy", INFINITE_WAT);
        let reg = reg.lock().unwrap_or_else(|e| e.into_inner());
        let plugin = reg.get("loopy").expect("plugin");
        let engine = PluginEngine::new(plugin, reg.wasm_engine()).expect("engine");
        let start = std::time::Instant::now();
        let p = engine.position(1.0, 0, &engine_params());
        assert_eq!(p, nalgebra::Vector3::zeros());
        assert!(
            start.elapsed().as_secs() < 10,
            "fuel should kill the loop quickly"
        );
    }

    #[test]
    fn wasm_engine_rejects_missing_exports() {
        let wat = r#"(module (memory (export "memory") 1))"#;
        // Couche 1 : rejet au register (validate_module).
        let mut reg = PluginRegistry::new().expect("registry");
        match reg.register_wasm(manifest("bare"), wat.as_bytes()) {
            Ok(_) => panic!("missing exports should fail at register"),
            Err(e) => assert!(e.to_string().contains("plugin_params_ptr")),
        }
        // Couche 2 : PluginEngine::new revérifie (Plugin construit à la main).
        let module = wasmtime::Module::new(reg.wasm_engine(), wat.as_bytes()).expect("module");
        let plugin = Arc::new(crate::plugins::Plugin {
            manifest: manifest("bare"),
            module,
            origin: None,
        });
        match PluginEngine::new(plugin, reg.wasm_engine()) {
            Ok(_) => panic!("missing exports should fail at instantiate"),
            Err(e) => assert!(e.to_string().contains("plugin_params_ptr")),
        }
    }

    // ---------- Bundle .ssx ----------

    fn make_ssx(manifest_json: &str, wasm: &[u8]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            if !manifest_json.is_empty() {
                zip.start_file("manifest.json", opts).unwrap();
                zip.write_all(manifest_json.as_bytes()).unwrap();
            }
            zip.start_file("module.wasm", opts).unwrap();
            zip.write_all(wasm).unwrap();
            zip.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn bundle_roundtrip_loads() {
        let bytes = make_ssx(
            &serde_json::to_string(&manifest("zipped")).unwrap(),
            ECHO_WAT.as_bytes(),
        );
        let reg = PluginRegistry::new().expect("registry");
        let plugin = load_bundle_bytes(reg.wasm_engine(), &bytes).expect("load_bundle_bytes");
        assert_eq!(plugin.manifest.id, "zipped");
    }

    #[test]
    fn bundle_rejects_missing_manifest() {
        let bytes = make_ssx("", ECHO_WAT.as_bytes());
        let reg = PluginRegistry::new().expect("registry");
        let err = match load_bundle_bytes(reg.wasm_engine(), &bytes) {
            Ok(_) => panic!("missing manifest should fail"),
            Err(e) => e,
        };
        assert!(err.to_string().contains("manifest.json"));
    }

    // ---------- Intégration graphe ----------

    fn plugin_graph(plugin_id: &str) -> Graph {
        let mut g = Graph::new();
        let objects = Node::with_params(NodeType::Objects, json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, json!({"duration": 10.0}));
        let plugin = Node::with_params(NodeType::Plugin, json!({"plugin_id": plugin_id}));
        let output = Node::new(NodeType::Output);

        let (id_objects, id_duration, id_plugin, id_output) =
            (objects.id, duration.id, plugin.id, output.id);
        g.add_node(objects);
        g.add_node(duration);
        g.add_node(plugin);
        g.add_node(output);

        g.add_edge(Edge {
            from: id_objects,
            to: id_plugin,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        g.add_edge(Edge {
            from: id_duration,
            to: id_plugin,
            from_port: "output".to_string(),
            to_port: "duration".to_string(),
        });
        g.add_edge(Edge {
            from: id_plugin,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        g
    }

    #[test]
    fn plugin_graph_validates() {
        let g = plugin_graph("echo");
        let result = Validator::validate(&g);
        assert!(result.is_ok(), "validation failed: {:?}", result.err());
    }

    #[test]
    fn plugin_graph_compiles_and_samples() {
        let reg = registry_with("echo", ECHO_WAT);
        let g = plugin_graph("echo");
        let f = Compiler::compile_with_live_inputs(
            &g,
            LiveInputs {
                plugins: Some(reg),
                ..Default::default()
            },
        )
        .expect("compile");
        let p = f(1.5, 2);
        assert_eq!(p.x, 1.5);
        assert_eq!(p.y, 2.0);
    }

    #[test]
    fn plugin_node_without_registry_fails_at_compile() {
        let g = plugin_graph("echo");
        let err = match Compiler::compile(&g) {
            Ok(_) => panic!("Plugin node without registry should fail"),
            Err(e) => e,
        };
        assert!(format!("{err:?}").contains("plugin registry"));
    }

    /// Charge le vrai bundle `.ssx` du plugin exemple (compilé wasm32 par le
    /// SDK) — lemniscate à t=0,i=0 : phase=0 → x=scale, y=z=0.
    #[test]
    fn real_ssx_fixture_executes() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/lemniscate.ssx");
        let mut reg = PluginRegistry::new().expect("registry");
        reg.register_bundle(std::path::Path::new(path))
            .expect("load fixture");

        let g = {
            let mut g = plugin_graph("lemniscate");
            let plugin = g
                .nodes
                .values_mut()
                .find(|n| n.node_type == NodeType::Plugin)
                .expect("plugin node");
            plugin.params = json!({"plugin_id": "lemniscate", "scale": 2.0});
            g
        };
        let reg = Arc::new(Mutex::new(reg));
        let f = Compiler::compile_with_live_inputs(
            &g,
            LiveInputs {
                plugins: Some(reg),
                ..Default::default()
            },
        )
        .expect("compile");

        let p0 = f(0.0, 0);
        assert!(
            (p0.x - 2.0).abs() < 1e-9,
            "x should be scale=2, got {}",
            p0.x
        );
        assert!(p0.y.abs() < 1e-9 && p0.z.abs() < 1e-9);

        // t>0 → la figure-∞ bouge (x diminue, z devient non-nul)
        let p1 = f(0.5, 0);
        assert!(p1.x.abs() < 2.0, "should move along the curve");
        assert!(p1.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn plugin_node_unknown_id_fails_at_compile() {
        let reg = registry_with("echo", ECHO_WAT);
        let g = plugin_graph("nonexistent");
        let err = match Compiler::compile_with_live_inputs(
            &g,
            LiveInputs {
                plugins: Some(reg),
                ..Default::default()
            },
        ) {
            Ok(_) => panic!("unknown plugin_id should fail"),
            Err(e) => e,
        };
        assert!(format!("{err:?}").contains("nonexistent"));
    }

    // ---------- Durcissements host (review) ----------

    /// Module déclarant un import : l'ABI v1 n'accorde aucune fonction host —
    /// rejet au load, pas à la première instanciation.
    #[test]
    fn module_with_imports_rejected_at_load() {
        let wat = r#"
(module
  (import "env" "host_fn" (func))
  (memory (export "memory") 1)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32)))
"#;
        let mut reg = PluginRegistry::new().expect("registry");
        match reg.register_wasm(manifest("imported"), wat.as_bytes()) {
            Ok(_) => panic!("module with imports should be rejected"),
            Err(e) => assert!(e.to_string().contains("import"), "{e}"),
        }
    }

    /// Mémoire minimum au-delà du cap rejetée au load — un `(memory N)` énorme
    /// commiterait la RAM host à l'instanciation.
    #[test]
    fn module_with_huge_memory_rejected() {
        let wat = r#"
(module
  (memory (export "memory") 600)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32)))
"#;
        let bytes = make_ssx(
            &serde_json::to_string(&manifest("fatmem")).unwrap(),
            wat.as_bytes(),
        );
        let reg = PluginRegistry::new().expect("registry");
        match load_bundle_bytes(reg.wasm_engine(), &bytes) {
            Ok(_) => panic!("huge memory should be rejected"),
            Err(e) => assert!(e.to_string().contains("memory"), "{e}"),
        }
    }

    /// `memory.grow` au-delà du StoreLimits retourne -1 (pas de commit) —
    /// le plugin le voit dans son résultat : prouve que le limiter borne le
    /// grow, pas seulement la déclaration initiale.
    #[test]
    fn memory_grow_beyond_limit_denied() {
        let wat = r#"
(module
  (memory (export "memory") 1)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32)
    (f64.store (i32.const 0)
      (f64.convert_i32_s (memory.grow (i32.const 600))))))
"#;
        let reg = registry_with("greedy", wat);
        let reg = reg.lock().unwrap_or_else(|e| e.into_inner());
        let plugin = reg.get("greedy").expect("plugin");
        let engine = PluginEngine::new(plugin, reg.wasm_engine()).expect("engine");
        let p = engine.position(0.0, 0, &engine_params());
        assert_eq!(p.x, -1.0, "memory.grow must be denied (-1), got {}", p.x);
    }

    /// Section `start` : le fuel est posé AVANT l'instanciation — une init
    /// bornée s'exécute, une boucle infinie en start trap (pas de gel).
    #[test]
    fn start_section_bounded_by_fuel() {
        // start qui boucle ~10k fois : sous le budget → instancie OK.
        let ok_wat = r#"
(module
  (memory (export "memory") 1)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32))
  (func $init (local $i i32)
    (loop $l
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_s (local.get $i) (i32.const 10000)))))
  (start $init))
"#;
        let mut reg = PluginRegistry::new().expect("registry");
        reg.register_wasm(manifest("initok"), ok_wat.as_bytes())
            .expect("bounded start should instantiate");
        let plugin = reg.get("initok").expect("plugin");
        assert!(PluginEngine::new(plugin, reg.wasm_engine()).is_ok());

        // start en boucle infinie : le fuel le tue à l'instanciation —
        // erreur, jamais de gel.
        let bad_wat = r#"
(module
  (memory (export "memory") 1)
  (func (export "plugin_params_ptr") (result i32) (i32.const 1024))
  (func (export "plugin_result_ptr") (result i32) (i32.const 0))
  (func (export "plugin_position") (param f64 i32 i32 f64 i32))
  (func $init (loop (br 0)))
  (start $init))
"#;
        let mut reg2 = PluginRegistry::new().expect("registry");
        reg2.register_wasm(manifest("initbad"), bad_wat.as_bytes())
            .expect("registers (start runs at instantiate, not load)");
        let plugin2 = reg2.get("initbad").expect("plugin");
        assert!(
            PluginEngine::new(plugin2, reg2.wasm_engine()).is_err(),
            "infinite start must be killed by fuel"
        );
    }

    /// Zip bomb : manifest.json déclaré géant → lecture cappée → JSON
    /// tronqué → erreur de manifeste, pas d'allocation non bornée.
    #[test]
    fn oversized_manifest_rejected() {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            // Stored = pas de compression → la taille écrite est réelle.
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("manifest.json", opts).unwrap();
            let big = vec![b' '; 512 * 1024]; // 512 KB > cap 256 KB
            zip.write_all(&big).unwrap();
            zip.start_file("module.wasm", opts).unwrap();
            zip.write_all(ECHO_WAT.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        let reg = PluginRegistry::new().expect("registry");
        assert!(load_bundle_bytes(reg.wasm_engine(), &buf.into_inner()).is_err());
    }

    /// scan_dir : un fichier supprimé désenregistre son plugin au rescan ;
    /// deux fichiers déclarant le même id → erreur "duplicate", first-wins.
    #[test]
    fn scan_dir_reconciles_removals_and_duplicates() {
        let dir = std::env::temp_dir().join(format!("ssx-scan-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let manifest_a = serde_json::to_string(&manifest("dup")).unwrap();
        std::fs::write(
            dir.join("a.ssx"),
            make_ssx(&manifest_a, ECHO_WAT.as_bytes()),
        )
        .expect("write a");
        std::fs::write(
            dir.join("b.ssx"),
            make_ssx(&manifest_a, ECHO_WAT.as_bytes()),
        )
        .expect("write b");

        let mut reg = PluginRegistry::new().expect("registry");
        let loaded = reg.scan_dir(&dir);
        assert_eq!(loaded, 1, "first file wins, second is a duplicate");
        assert_eq!(reg.manifests().len(), 1);
        assert!(
            reg.errors().iter().any(|(_, e)| e.contains("duplicate")),
            "duplicate id should be reported: {:?}",
            reg.errors()
        );

        // Suppression du fichier → rescan retire le plugin.
        std::fs::remove_file(dir.join("a.ssx")).expect("rm a");
        std::fs::remove_file(dir.join("b.ssx")).expect("rm b");
        let loaded = reg.scan_dir(&dir);
        assert_eq!(loaded, 0);
        assert!(reg.manifests().is_empty(), "deleted plugin must unregister");
        assert!(reg.get("dup").is_none());

        std::fs::remove_dir_all(&dir).ok();
    }
}
