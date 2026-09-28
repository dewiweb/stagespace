# stagespace-plugin-sdk

SDK pour écrire des plugins WASM STAGESPACE (nodes custom, bundles `.ssx`).

## Écrire un plugin

Crate `cdylib`, cible `wasm32-unknown-unknown` :

```toml
# Cargo.toml
[lib]
crate-type = ["cdylib"]

[dependencies]
stagespace-plugin-sdk = { path = "../plugin-sdk" }
serde_json = "1.0"

[profile.release]
lto = true
opt-level = "s"
panic = "abort"
```

```rust
// src/lib.rs
use stagespace_plugin_sdk::{get_f64, stagespace_plugin};

/// f(t, i, n, d, params) -> (x, y, z)
/// t = temps (s), i = index objet, n = n_objects, d = duration du graphe.
/// params = le JSON des params du node (ceux du manifeste + plugin_id).
fn position(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value) -> (f64, f64, f64) {
    let radius = get_f64(params, "radius", 1.0);
    let phase = 2.0 * std::f64::consts::PI * (t / d.max(f64::EPSILON) + i as f64 / n.max(1) as f64);
    (radius * phase.cos(), 0.0, radius * phase.sin())
}

stagespace_plugin!(position);
```

`manifest.json` — voir `plugin-examples/lemniscate/manifest.json` pour le
format complet (`id`, `abi_version: 1`, `kind: "engine"`, `params[]`).

## Builder + packager

```bash
cd mon-plugin
cargo build --release --target wasm32-unknown-unknown

# packer (depuis plugin-sdk)
cargo run --release --features packer --bin stagespace-pack -- \
    manifest.json target/wasm32-unknown-unknown/release/mon_plugin.wasm \
    -o mon_plugin.ssx
```

## Installer

Déposer le `.ssx` dans le dossier plugins :

| OS | Chemin |
|---|---|
| Linux | `~/.local/share/com.stagespace.studio/plugins/` |
| macOS | `~/Library/Application Support/com.stagespace.studio/plugins/` |
| Windows | `%APPDATA%/com.stagespace.studio/plugins/` |

Puis `reload_plugins` (UI ou CLI) — le node `Plugin` du graphe référence le
plugin via `params.plugin_id = "<id du manifeste>"`.

## Règles d'un bon plugin

- **Déterministe** : `position(t, i, params)` doit retourner la même valeur
  pour les mêmes entrées (le runtime échantillonne en parallèle et compare).
- **Pas d'état mutable global** au-delà des buffers ABI.
- **Rapide** : appelé à 60 FPS × n_objects — un appel > ~100k instructions
  est tué par le fuel (position zero pour la frame).
- **Params robustes** : toujours des défauts via `get_f64`/`get_bool`/`get_str`
  — les params peuvent être absents (vieux graphes, valeur non saisie).
- Retours finis : `NaN`/`inf` → l'host convertit en (0,0,0) mais c'est un bug.
