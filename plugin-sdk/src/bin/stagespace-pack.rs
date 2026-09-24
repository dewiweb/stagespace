//! `stagespace-pack` — package un plugin WASM en bundle `.ssx`.
//!
//! Usage :
//!   stagespace-pack manifest.json module.wasm [-o out.ssx]
//!   stagespace-pack --check manifest.json        (validation seule)
//!
//! Le manifeste est désérialisé dans des structs typées mirroring
//! `rust-engines/src/plugins/manifest.rs` — un mauvais type JSON (string au
//! lieu de number, params non-array…) échoue ici comme il échouerait au
//! chargement dans l'app. Garder aligné avec `manifest.rs::validate`.

use serde::Deserialize;
use std::io::Write;
use std::path::PathBuf;
use std::process::exit;

const HOST_ABI_VERSION: u32 = 2;
const VALID_TYPES: &[&str] = &["number", "boolean", "enum", "vec3", "text", "string"];
const VALID_KINDS: &[&str] = &["engine", "modifier", "composite"];
const WASM_MAGIC: &[u8; 4] = b"\0asm";
const MAX_BUNDLE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
struct ManifestCheck {
    id: String,
    name: String,
    version: String,
    abi_version: u32,
    kind: String,
    #[serde(default)]
    params: Vec<ParamCheck>,
}

#[derive(Deserialize)]
struct ParamCheck {
    key: String,
    #[serde(rename = "type")]
    param_type: String,
    min: Option<f64>,
    max: Option<f64>,
    options: Option<Vec<String>>,
}

fn fail(msg: impl std::fmt::Display) -> ! {
    eprintln!("error: {msg}");
    exit(1);
}

fn validate_manifest(m: &ManifestCheck) -> Result<(), String> {
    if m.id.is_empty() || m.id.len() > 64 {
        return Err("id must be 1-64 chars".into());
    }
    if !m
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!("id '{}' must be [a-zA-Z0-9_-] only", m.id));
    }
    if m.name.is_empty() {
        return Err("name must be non-empty".into());
    }
    if m.version.is_empty() {
        return Err("version must be non-empty".into());
    }
    if m.abi_version == 0 || m.abi_version > HOST_ABI_VERSION {
        return Err(format!(
            "abi_version {} not supported (host ABI = {HOST_ABI_VERSION})",
            m.abi_version
        ));
    }
    if !VALID_KINDS.contains(&m.kind.as_str()) {
        return Err(format!(
            "kind '{}' unknown (expected one of {VALID_KINDS:?})",
            m.kind
        ));
    }
    // Aligné sur le host : modifier/composite exigent abi_version 2
    // (le buffer plugin_inputs_ptr n'existe pas en v1).
    if m.abi_version == 1 && m.kind != "engine" {
        return Err(format!(
            "kind '{}' requires abi_version 2 (v1 = engines only)",
            m.kind
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for p in &m.params {
        if p.key.is_empty() {
            return Err("param key must be non-empty".into());
        }
        if !seen.insert(p.key.clone()) {
            return Err(format!("duplicate param key '{}'", p.key));
        }
        if !VALID_TYPES.contains(&p.param_type.as_str()) {
            return Err(format!(
                "param '{}': unknown type '{}' (expected one of {VALID_TYPES:?})",
                p.key, p.param_type
            ));
        }
        if p.param_type == "enum" && p.options.as_ref().is_none_or(|o| o.is_empty()) {
            return Err(format!("param '{}': enum type requires options", p.key));
        }
        if let (Some(min), Some(max)) = (p.min, p.max) {
            if min >= max {
                return Err(format!("param '{}': min must be < max", p.key));
            }
        }
    }
    Ok(())
}

fn read_manifest(path: &std::path::Path) -> (String, ManifestCheck) {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => fail(format!("cannot read {}: {e}", path.display())),
    };
    let manifest: ManifestCheck = match serde_json::from_str(&raw) {
        Ok(m) => m,
        Err(e) => fail(format!("invalid manifest: {e}")),
    };
    if let Err(e) = validate_manifest(&manifest) {
        fail(format!("invalid manifest: {e}"));
    }
    (raw, manifest)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // stagespace-pack --check manifest.json
    if args.len() == 3 && args[1] == "--check" {
        read_manifest(std::path::Path::new(&args[2]));
        println!("manifest OK");
        return;
    }

    // stagespace-pack manifest.json module.wasm [-o out.ssx]
    if args.len() < 3 || args[1].starts_with('-') {
        eprintln!("usage: stagespace-pack manifest.json module.wasm [-o out.ssx]");
        eprintln!("       stagespace-pack --check manifest.json");
        exit(2);
    }
    let manifest_path = PathBuf::from(&args[1]);
    let wasm_path = PathBuf::from(&args[2]);
    let out_path = match args.iter().position(|a| a == "-o") {
        Some(i) => match args.get(i + 1) {
            Some(v) => PathBuf::from(v),
            None => fail("-o requires an output path"),
        },
        None => manifest_path.with_file_name(format!(
            "{}.ssx",
            manifest_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
        )),
    };

    let (manifest_str, manifest) = read_manifest(&manifest_path);
    let wasm = match std::fs::read(&wasm_path) {
        Ok(b) => b,
        Err(e) => fail(format!("cannot read {}: {e}", wasm_path.display())),
    };
    if wasm.len() as u64 > MAX_BUNDLE_BYTES {
        fail(format!(
            "wasm too large ({} bytes > {MAX_BUNDLE_BYTES})",
            wasm.len()
        ));
    }
    if !wasm.starts_with(WASM_MAGIC) {
        fail(format!(
            "{} is not a wasm module (missing \\0asm magic)",
            wasm_path.display()
        ));
    }

    let file = match std::fs::File::create(&out_path) {
        Ok(f) => f,
        Err(e) => fail(format!("cannot create {}: {e}", out_path.display())),
    };
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();
    // Les erreurs Zip et io diffèrent → closure unifiée en String.
    let write_zip = || -> Result<(), String> {
        zip.start_file("manifest.json", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(manifest_str.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.start_file("module.wasm", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(&wasm).map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    };
    if let Err(e) = write_zip() {
        fail(format!("cannot write bundle: {e}"));
    }

    println!(
        "packed {} → {} ({} bytes wasm)",
        manifest.id,
        out_path.display(),
        wasm.len()
    );
}
