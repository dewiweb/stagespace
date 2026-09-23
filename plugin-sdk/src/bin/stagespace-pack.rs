//! `stagespace-pack` — package un plugin WASM en bundle `.ssx`.
//!
//! Usage :
//!   stagespace-pack manifest.json module.wasm [-o out.ssx]
//!   stagespace-pack --check manifest.json        (validation seule)
//!
//! Le manifeste est validé avec les mêmes règles que l'host (id, abi_version,
//! types de params) avant l'écriture — un bundle qui échoue ici échouerait
//! au chargement dans l'app.

use std::io::Write;
use std::path::PathBuf;

// Règles de validation du manifeste — dupliquées de rust-engines pour rester
// standalone (le SDK ne doit pas dépendre de l'engine). Garder aligné avec
// plugins/manifest.rs::validate.
fn validate_manifest(m: &serde_json::Value) -> Result<(), String> {
    let id = m["id"].as_str().unwrap_or_default();
    if id.is_empty() || id.len() > 64 {
        return Err("id must be 1-64 chars".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!("id '{id}' must be [a-zA-Z0-9_-] only"));
    }
    if m["name"].as_str().unwrap_or_default().is_empty() {
        return Err("name must be non-empty".into());
    }
    let abi = m["abi_version"].as_u64().unwrap_or(0);
    if abi == 0 || abi > 1 {
        return Err(format!("abi_version {abi} not supported (host ABI = 1)"));
    }
    if m["kind"].as_str() != Some("engine") {
        return Err("kind must be \"engine\" (ABI v1)".into());
    }
    const VALID_TYPES: &[&str] = &["number", "boolean", "enum", "vec3", "text", "string"];
    let mut seen = std::collections::HashSet::new();
    for p in m["params"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let key = p["key"].as_str().unwrap_or_default();
        if key.is_empty() {
            return Err("param key must be non-empty".into());
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("duplicate param key '{key}'"));
        }
        let ty = p["type"].as_str().unwrap_or_default();
        if !VALID_TYPES.contains(&ty) {
            return Err(format!("param '{key}': unknown type '{ty}'"));
        }
        if ty == "enum" && p["options"].as_array().is_none_or(|o| o.is_empty()) {
            return Err(format!("param '{key}': enum type requires options"));
        }
        if let (Some(min), Some(max)) = (p["min"].as_f64(), p["max"].as_f64()) {
            if min >= max {
                return Err(format!("param '{key}': min must be < max"));
            }
        }
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() == 3 && args[1] == "--check" {
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&args[2]).expect("read manifest"))
                .expect("parse manifest");
        match validate_manifest(&manifest) {
            Ok(()) => {
                println!("manifest OK");
                return;
            }
            Err(e) => {
                eprintln!("manifest invalid: {e}");
                std::process::exit(1);
            }
        }
    }

    if args.len() < 3 {
        eprintln!("usage: stagespace-pack manifest.json module.wasm [-o out.ssx]");
        std::process::exit(2);
    }

    let manifest_path = PathBuf::from(&args[1]);
    let wasm_path = PathBuf::from(&args[2]);
    let out_path = args
        .windows(2)
        .find(|w| w[0] == "-o")
        .map(|w| PathBuf::from(&w[1]))
        .unwrap_or_else(|| {
            manifest_path.with_file_name(format!(
                "{}.ssx",
                manifest_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
            ))
        });

    let manifest_str = std::fs::read_to_string(&manifest_path).expect("read manifest");
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str).expect("parse manifest");
    if let Err(e) = validate_manifest(&manifest) {
        eprintln!("manifest invalid: {e}");
        std::process::exit(1);
    }
    let wasm = std::fs::read(&wasm_path).expect("read wasm");

    let file = std::fs::File::create(&out_path).expect("create .ssx");
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();
    zip.start_file("manifest.json", opts).unwrap();
    zip.write_all(manifest_str.as_bytes()).unwrap();
    zip.start_file("module.wasm", opts).unwrap();
    zip.write_all(&wasm).unwrap();
    zip.finish().unwrap();

    println!(
        "packed {} → {} ({} bytes wasm)",
        manifest["id"].as_str().unwrap_or("?"),
        out_path.display(),
        wasm.len()
    );
}
