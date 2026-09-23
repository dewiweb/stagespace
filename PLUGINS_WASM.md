# PLUGINS_WASM.md — Système de plugins WASM pour nodes custom

Branche : `feat/wasm-plugins`
Statut : **Phases 1+3 livrées** (`3527441`, `343b73d`) — runtime host
fonctionnel + intégration Tauri (registry dans AppState, commands
`list_plugins`/`reload_plugins`, `compile_graph_live` = chemin unique de
compile). 17 tests plugins verts, contrats TS générés.

## Prochaines étapes (ordre recommandé)

1. ~~**Phase 3 — Tauri**~~ ✅ `343b73d` : `AppState.plugin_registry`
   (`Arc<Mutex>`) + `plugins_dir` (`<data_dir>/com.stagespace.studio/plugins/`,
   créé + scanné au boot, erreurs non fatales) ; commands `list_plugins` /
   `reload_plugins` → `PluginRegistryReport { manifests, errors, plugins_dir }` ;
   **`compile_graph_live(graph, &Shared)`** = chemin unique (audio + OSC +
   plugins) pour `activate_move`, `update_move_graph_merged` et le respawn de
   cues ; `PluginManifest`/`PluginKind`/`PluginParamDef`/`PluginRegistryReport`
   exportés ts-rs. Note : erreurs rapportées dans le report (toasts frontend)
   plutôt qu'en events — suffisant tant que le scan est déclenché par l'UI.
2. **Phase 6/7 restants** — plugin dans le pool `MATH` du fuzzer génératif,
   test `list_plugins` tauri, import `.ssx` depuis l'UI (dialog → copie dans
   le dossier + rescan), docs `CONTRIBUTING.md` + `AGENTS.md`, icône bundle.

Règle transversale : **ABI v1 = engines uniquement**. Modifier/composite
demandent de passer la closure upstream au guest → ABI v2, hors scope.

> Objectif : permettre à des développeurs tiers d'étendre la palette de nodes
> STAGESPACE sans recompiler l'app, via des modules WebAssembly packagés dans
> un bundle `.ssx` (zip) contenant code + manifeste déclaratif.

## 1. Principes directeurs

- **Registry unifié, deux backends** — le compiler ne dispatche plus via un
  `match NodeType` figé mais via un `NodeRegistry` :
  ```rust
  enum NodeImpl {
      Native(Box<dyn Engine>),  // built-ins actuels, inchangés
      Wasm(PluginEngine),       // plugins .ssx
  }
  ```
  Les built-ins sont *enregistrés* au boot (pas recompilés en wasm — sinon
  dépendance circulaire au build + ABI v2 obligatoire pour les modifiers).
  Dogfooding réel : si le registry marche pour les built-ins, il marche pour
  les plugins. Migration vers wasm possible plus tard sans changer l'archi.
- **Le plugin est un node conteneur `NodeType::Plugin`** — `params.plugin_id`
  désigne le plugin ; les autres params sont ceux déclarés par le manifeste.
  `NodeType` reste `Copy` (un variant `Custom(String)` le tuerait), le format
  `.hfg`/cues/snapshots est inchangé. L'UI affiche le nom du plugin via le
  registry, pas le type brut.
- **Le manifeste est la source de vérité UI** — le plugin déclare ses params
  (schema) et ses ports ; `NodeParamsPanel` est déjà schema-driven
  (`ParamDef[]`), il suffit de brancher le registry dessus.
- **Sandbox strict** — code tiers non fiable dans la boucle 60 FPS :
  wasmtime + fuel + traps. Pas de WASI, calcul pur uniquement.
- **Pas d'ABI Rust instable** — dylib exclu définitivement (pas d'ABI stable,
  panic cross-FFI, packaging 3-plateformes inmaintenable).
- **F(t) respecté** — un plugin implémente la même signature pure
  `position(t, i, n, d, params) -> Vec3` que les engines natifs.

## 2. Format de bundle `.ssx`

Archive zip à extension dédiée (modèle `.vsix`) :

```
lemniscate.ssx
├── manifest.json      (obligatoire, validé au chargement)
├── module.wasm        (obligatoire, wasm32-unknown-unknown, pas de WASI)
├── icon.svg           (optionnel — palette)
└── README.md          (optionnel — doc affichée dans l'app)
```

### 2.1 Manifeste (`manifest.json`)

```json
{
  "id": "lemniscate",
  "name": "Lemniscate",
  "version": "1.0.0",
  "author": "...",
  "abi_version": 1,
  "kind": "engine",
  "category": "Plugins",
  "description": "Figure-∞ paramétrique",
  "ports": { "inputs": ["input", "duration"], "outputs": ["trajectory"] },
  "params": [
    { "key": "scale",  "type": "number", "default": 1.0, "min": 0.1, "max": 10, "label": "Scale", "live": true },
    { "key": "aspect", "type": "number", "default": 1.414 }
  ],
  "capabilities": []
}
```

- `abi_version` : gate de compatibilité — l'host refuse `abi_version > HOST_ABI`.
- `kind` : `engine` (MVP) ; `modifier` | `composite` en phase ultérieure.
- `params[]` : mêmes types que `ParamDef` frontend (`number`, `boolean`,
  `enum`, `vec3`, `text`) — rendu direct par `NodeParamField` existant.
- `capabilities` : deny par défaut ; futur `audio`, `osc_in`.

### 2.2 ABI v1 (contrat host ↔ invité)

Cible `wasm32-unknown-unknown`, pas de WASI. Buffers **statiques** en mémoire
linéaire — pas d'alloc/free côté invité (SDK trivial, tests WAT sans
allocateur) :

```rust
// Exportés par le plugin
fn plugin_params_ptr() -> i32;   // buffer ≥ 64 KB réservé dans .data
fn plugin_result_ptr() -> i32;   // buffer 24 bytes ([f64;3]) dans .data
fn plugin_position(t: f64, i: i32, n: i32, d: f64, params_len: i32);
// + export "memory"
```

Host : sérialise `params` JSON (cap 64 KB) → écrit à `params_ptr` → appelle
`plugin_position` → lit 24 bytes à `result_ptr` → `finite_or_zero`. Buffers
sûrs car le `Store` wasmtime est `Mutex`-guardé par node (accès séquentiel).
Trap → position zero + erreur loguée (jamais de propagation au worker 60 FPS).
`fuel` activé : budget par appel, une boucle infinie trap au lieu de geler
le runtime.

## 3. Plan d'implémentation par phases

### Phase 1 — Runtime host (rust-engines) — ✅ `3527441`

- [x] `Cargo.toml` : `wasmtime` v38 (fuel activé via `Config`), `zip` v2.4
- [x] `src/plugins/manifest.rs` — `PluginManifest` (serde) + validation
      (id, `abi_version ≤ HOST_ABI_VERSION`, kinds, types de params)
- [x] `src/plugins/loader.rs` — `load_bundle`/`load_bundle_bytes`
      (zip → manifeste validé → `wasmtime::Module` + check exports ABI)
- [x] `src/plugins/registry.rs` — `PluginRegistry` : `scan_dir`,
      `register_wasm` (tests/embarqués), erreurs collectées non fatales
- [x] `src/plugins/wasm_engine.rs` — `PluginEngine` implémente `Engine` :
      Store mutex-guardé, buffers statiques, fuel 100k/appel, trap→zeros,
      premier erreur loguée via `log_plugin_error`
- [x] `src/graph.rs` — `NodeType::Plugin` (wire `"Plugin"`)
- [x] `src/compiler.rs` — arm `NodeType::Plugin` résolvant `params.plugin_id`
      via `LiveInputs.plugins` ; `compile_with_live_inputs` publique
- [x] `src/validator.rs` — `Plugin` traité comme engine : ports
      `input`+`duration`, alimente Output/composites/modifiers, sub-graph
      only, arité n_objects automatique
- [x] Frontend minimal : union `'Plugin'`, `connectionRules`, catégorie
      "Plugins", schema `plugin_id`
- [x] 14 tests WAT inline (`plugin_tests.rs`) : positions, trap→zero,
      fuel, roundtrip `.ssx`, intégration validate+compile+sample

### Phase 2 — Registry dans le compilateur

`Compiler` reçoit `plugins: Option<Arc<PluginRegistry>>` (builder
`.with_plugin_registry()`, défaut `None` → les nodes `Plugin` échouent à la
compile avec `InvalidParameter("plugin_id inconnu ou absent")`). Call sites
src-tauri mis à jour en Phase 3. Le `match` actuel de `compile_engine` reste
tel quel en v1 — le registry unifié `NodeImpl::{Native,Wasm}` est une
refactorisation ultérieure optionnelle ; Phase 1 ajoute seulement l'arm
`NodeType::Plugin` qui consulte le registry.

### Phase 3 — Tauri (src-tauri) — ✅ `343b73d`

- [x] `AppState.plugin_registry: Option<Arc<Mutex<PluginRegistry>>>` +
      `plugins_dir` — construits dans `.manage` (pas d'AppHandle →
      `dirs::data_dir()` + identifier `com.stagespace.studio`)
- [x] `Shared.plugin_registry` propagé aux call sites de compile
- [x] `compile_graph_live(graph, &Shared)` — audio + OSC + plugins, utilisé
      par `activate_move`, `update_move_graph_merged`, respawn de cues
- [x] Commands : `list_plugins` / `reload_plugins` → `PluginRegistryReport`
      (manifestes + erreurs formatées + chemin du dossier)
- [x] ts-rs : `PluginManifest`/`PluginKind`/`PluginParamDef`/
      `PluginRegistryReport` exportés → contrats régénérés

### Phase 4 — Frontend — ✅ livré

- [x] `store/types/index.ts` : `'Plugin'` dans l'union `NodeType` (Phase 1)
- [x] `utils/connectionRules.ts` : `Plugin` = règles engine (Phase 1)
- [x] `nodeParamSchema.ts` : catégorie "Plugins" + `PARAM_SCHEMA['Plugin']`
      + helpers `pluginParamDefs`/`pluginNodeSchema`/`pluginDefaultParams`
      (manifeste → `ParamDef`, defaults depuis `params[].default`)
- [x] `slices/pluginSlice.ts` dans `useGraphStore` : `plugins`/`pluginErrors`/
      `pluginsDir`/`pluginsLoaded`, `fetchPlugins` (boot dans App + lazy au
      mount du NodeEditor), `reloadPlugins` (toasts + erreurs de scan)
- [x] `NodeEditor.tsx` : catégorie "Plugins" dynamique — un item par
      manifeste (nom + version + tooltip description/auteur), création de
      node pré-remplie (`plugin_id` + defaults), hint du dossier plugins
      quand vide, erreurs de scan affichées, bouton ↻ Rescan ; l'item
      générique `Plugin` reste pour saisie manuelle de `plugin_id`
- [x] `NodeParamsPanel` : schema Plugin = `plugin_id` + defs du manifeste ;
      chips affichent le nom du plugin (avec occurrence indexée)
- [x] `CustomNode` : label = nom du manifeste (fallback `data.label`),
      params inline mergés dans le node expandé
- [ ] Icône `icon.svg` du bundle dans la palette (optionnel MVP)

### Phase 5 — SDK invité (`stagespace-plugin-sdk`) — ✅ livré

- [x] Crate `plugin-sdk/` (rlib minimal — `serde_json` seul, zéro dep native)
      + macro `stagespace_plugin!(fn)` (macro déclarative, pas de proc-macro
      crate) générant les exports ABI : `plugin_params_ptr`,
      `plugin_result_ptr`, `plugin_position` — buffers statiques 64 KB/24 B,
      params désérialisés en `serde_json::Value` + helpers `get_f64`/`get_bool`/
      `get_str` avec défauts
- [x] CLI `stagespace-pack` (binaire du même crate, feature-gated `packer` →
      `zip` optionnel pour ne pas compiler du C dans le graphe wasm32) :
      `stagespace-pack manifest.json module.wasm -o out.ssx` + `--check`
- [x] Exemple `plugin-examples/lemniscate/` (figure-∞, params scale/aspect/
      speed) compilé `wasm32-unknown-unknown`, packagé `lemniscate.ssx`,
      documenté dans `plugin-sdk/README.md` + README dédié
- [x] Pipeline prouvé de bout en bout : `real_ssx_fixture_executes` charge le
      `.ssx` committé (`rust-engines/tests/fixtures/`) via `PluginRegistry` →
      `compile_with_live_inputs` → positions correctes, params JSON reçus

### Phase 6 — Tests

- [x] **rust-engines** : modules WAT inline (`wasmtime` feature `wat`) —
      pas besoin du toolchain wasm32 en CI. Cas : position correcte, params
      JSON lus, trap → zero + pas de panic, fuel épuisé → zero, manifeste
      invalide → erreur propre, `abi_version` incompatible → refus (Phase 1)
- [x] **Fixture `.ssx` réelle** committée (`tests/fixtures/lemniscate.ssx`) —
      pipeline SDK→wasm→registry→compile→sample testé en CI sans toolchain
- [x] **compiler_tests** : graphe `Objects→Plugin→Output` compile et échantillonne
- [ ] **validator_tests** : Plugin accepté comme engine, rejeté comme cible
      de modifier upstream invalide
- [ ] **generative_graph_tests** : `Plugin` dans le pool `MATH` (avec un
      plugin de test enregistré) → fuzz automatique
- [ ] **tauri** : `list_plugins` sur dossier fixture (1 valide + 1 manifeste
      cassé → erreur rapportée sans échec global)
- [ ] **frontend** : palette affiche le plugin mocké, `NodeParamsPanel`
      rend le schema dynamique

### Phase 7 — CI / release

- [ ] `ci.yml` : aucun job nouveau requis pour le host (wasmtime compile en
      natif). Le build du plugin exemple (wasm32 target) = job séparé
      optionnel ou artefact précompilé committé pour les fixtures
- [ ] Docs : section "Développer un plugin" dans `CONTRIBUTING.md` +
      README du SDK
- [ ] `AGENTS.md` : section plugins (dossier, ABI, commandes de test)

## 4. Sécurité & temps réel

| Risque | Mitigation |
|---|---|
| Boucle infinie dans le plugin | `fuel` wasmtime — 100k instr./appel, posé **avant** `Instance::new` (les sections `start` sont bornées aussi), reset par appel, fail-fast si le moteur n'a pas `consume_fuel` |
| Panic/crash plugin | Traps wasmtime — jamais de UB host, position zero + log une fois |
| `memory.grow` hostile | `StoreLimits` : 32 MiB mémoire linéaire, 10k éléments de table, 1 mémoire par instance — le fuel ne borne PAS le grow |
| Déclaration mémoire hostile | Rejet au load : shared / memory64 / minimum > 512 pages (32 MiB) |
| Zip bomb | Caps de décompression : fichier `.ssx` ≤ 64 MB, `manifest.json` ≤ 256 KB, `module.wasm` ≤ 16 MB — lecture via `take()` bornée |
| Import destructeur | `import_plugin` : src == dest détecté par `canonicalize` (la copie est sautée, jamais de troncature), taille bornée, `file_name` seul (pas de traversal) |
| Scan bloquant | `spawn_blocking` pour scan/import — la compilation wasmtime ne tourne jamais sur l'executor async |
| Allocation hostiles | Buffers ABI statiques, cap `params_len` 64 KB |
| I/O depuis le plugin | Pas de WASI, **zéro import** — tout module déclarant un import est rejeté au load |
| Plugin malveillant | Sandbox wasm = code non fiable sans accès système ; signature/checksum de bundles = phase ultérieure |

### Cycle de vie du registry

- `scan_dir` **réconcilie** : un `.ssx` supprimé désenregistre son plugin au
  rescan (désinstallation effective sans redémarrage)
- Deux fichiers déclarant le même `manifest.id` → erreur collectée
  ("duplicate plugin id"), first-wins déterministe par ordre alphabétique
- **Snapshot semantics** : les moves déjà compilés conservent leur
  `Arc<Plugin>` — un rescan n'affecte que les compilations futures
- `register_wasm` (tests / futurs embarqués) applique la même validation
  de module que les bundles fichier

## 5. Hors scope (v1 plugins)

- ❌ `kind: "modifier" | "composite"` — ABI v1 = engines purs uniquement
  (un modifier exigerait de passer la closure upstream en mémoire wasm —
  faisable mais ABI v2)
- ❌ Host functions (`log`, `audio`, `osc_in`) — `capabilities` réservé
- ❌ Marketplace / signature / sandboxing renforcé
- ❌ Hot-reload d'un plugin en cours de playback (un rescan n'affecte que
  les compilations futures — les moves actifs gardent leur snapshot)

## 6. Effort estimé

| Phase | Charge | Risque |
|---|---|---|
| 1 — runtime host | M | ABI mémoire linéaire (gestion ptr/len) |
| 2 — registry compiler | S | Signature `compile_graph` — toucher call sites |
| 3 — Tauri | S | — |
| 4 — frontend | M | Palette dynamique (le reste est schema-driven) |
| 5 — SDK | M | Macro proc-macro (ou codegen simple sans macro en MVP) |
| 6 — tests | S | WAT inline évite le toolchain wasm32 en CI |
| 7 — CI/docs | XS | — |

Le point le plus délicat est l'ABI mémoire linéaire (alloc/free/write/read
de `plugin_position`). Le reste est de la plomberie dans des seams déjà
propres (Engine trait, registry, schema-driven UI).
