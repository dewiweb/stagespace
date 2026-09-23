# PLUGINS_WASM.md — Système de plugins WASM pour nodes custom

Branche : `feat/wasm-plugins`
Statut : **design approuvé — implémentation non commencée**

> Objectif : permettre à des développeurs tiers d'étendre la palette de nodes
> STAGESPACE sans recompiler l'app, via des modules WebAssembly packagés dans
> un bundle `.ssx` (zip) contenant code + manifeste déclaratif.

## 1. Principes directeurs

- **Le plugin n'est pas un nouveau `NodeType`** — c'est un node conteneur
  générique `NodeType::Plugin` dont le comportement vit dans les params
  (`plugin_id` + params déclarés par le plugin). Le graphe, les `.hfg`, les
  cues et les snapshots traversent sans changement de format.
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

Cible `wasm32-unknown-unknown`, pas de WASI. Mémoire linéaire partagée :

```rust
// Exporté par le plugin
fn plugin_alloc(len: u32) -> u32;                        // alloue params JSON
fn plugin_position(t: f64, i: u32, n: u32, d: f64,
                  params_ptr: u32, params_len: u32) -> u32; // → ptr vers [f64;3]
fn plugin_free(ptr: u32, len: u32);
```

Host : sérialise `params` JSON → `plugin_alloc` → écrit en mémoire linéaire →
appelle `plugin_position` → lit 24 bytes `[x,y,z]` → `finite_or_zero` →
`plugin_free`. Trap wasmtime → position zero + erreur loguée (jamais de
propagation au worker 60 FPS). `fuel` activé : budget par appel, un plugin en
boucle infinie consomme son fuel et trap au lieu de geler le runtime.

## 3. Plan d'implémentation par phases

### Phase 1 — Runtime host (rust-engines)

- [ ] `Cargo.toml` : `wasmtime` (feature `fuel`), `zip` (manifest extraction)
- [ ] `src/plugins/manifest.rs` — `PluginManifest` (serde) + validation
      (champs requis, `abi_version`, kinds, param types)
- [ ] `src/plugins/loader.rs` — `load_bundle(path) -> Result<Plugin>`
      (zip → manifest valide → `wasmtime::Module` précompilé)
- [ ] `src/plugins/registry.rs` — `PluginRegistry` : scan d'un dossier,
      `HashMap<id, Plugin>`, erreurs collectées sans bloquer les autres
- [ ] `src/engines/plugin.rs` — `PluginEngine` implémente `Engine` :
      wrapper wasmtime `Instance` + `Store` (fuel), traduction params JSON
- [ ] `src/graph.rs` — `NodeType::Plugin`
- [ ] `src/compiler.rs` — arm `NodeType::Plugin => PluginEngine::new(plugin_id)`
      ; erreur `InvalidParameter` si `plugin_id` absent/inconnu du registry
- [ ] `src/validator.rs` — `Plugin` traité comme engine : ports
      `input`+`duration`, alimente Output/composites/modifiers, exige
      Objects+Duration (gratuit via `graph_has_engines`)

### Phase 2 — Registry dans le compilateur

Le compiler doit résoudre `plugin_id` → `Plugin` à la compile. Deux options :
- (a) `Compiler::new(graph, plugin_registry: &PluginRegistry)` — propre,
  signature changeante mais interne
- (b) registry global `OnceLock` — simple mais global mutable, test-hostile
→ **(a)** : passer une référence registry dans `compile_graph` et les call
sites src-tauri (`activate_move`, `update_global_graph`, `sample_graph`).

### Phase 3 — Tauri (src-tauri)

- [ ] `AppState.plugin_registry: Arc<PluginRegistry>`
- [ ] Dossier plugins : `<app_data_dir>/plugins/` (tauri `path()` API)
- [ ] Commands : `list_plugins() -> Vec<PluginManifest>` (scan + erreurs),
      `reload_plugins()` (re-scan, utilisé après ajout de fichier)
- [ ] Events : `plugin-error` (toast au chargement raté)
- [ ] ts-rs : `PluginManifest` exporté → `npm run contracts`

### Phase 4 — Frontend

- [ ] `store/types/index.ts` : `'Plugin'` dans l'union `NodeType`
- [ ] `utils/connectionRules.ts` : `Plugin` = règles engine
      (`getInputPorts` → `['input','duration']`, `isValidConnection` miroir)
- [ ] `nodeParamSchema.ts` : catégorie "Plugins" + entrée générique
      `Plugin` (params de base : `plugin_id` en select des plugins chargés)
- [ ] `stores/plugins.ts` (slice Zustand) : `usePluginStore` fetch
      `list_plugins` au boot + sur `reload`
- [ ] `NodeEditor.tsx` : palette — sous-catégorie dynamique, un item par
      plugin du registry (`plugin_id` pré-rempli au drop)
- [ ] `NodeParamsPanel` : pour les nodes `Plugin`, schema =
      `PARAM_SCHEMA['Plugin']` de base **+** `pluginStore.schema(plugin_id)`
      — `NodeParamField` rend déjà tout génériquement, aucun nouveau composant
- [ ] Icône `icon.svg` du bundle dans la palette (optionnel MVP)

### Phase 5 — SDK invité (`stagespace-plugin-sdk`)

- [ ] Nouveau crate workspace `plugin-sdk/` (rlib, cible wasm32)
- [ ] Macro `#[stagespace_plugin]` : génère `plugin_alloc/position/free`,
      parse params JSON → struct typée, `Vec3` de retour
- [ ] Crate `stagespace-pack` (CLI) : `pack module.wasm manifest.json → .ssx`
      + validation du manifeste côté auteur
- [ ] Plugin d'exemple `examples/lemniscate` documenté de bout en bout

### Phase 6 — Tests

- [ ] **rust-engines** : modules WAT inline (`wasmtime` feature `wat`) —
      pas besoin du toolchain wasm32 en CI. Cas : position correcte, params
      JSON lus, trap → zero + pas de panic, fuel épuisé → zero, manifeste
      invalide → erreur propre, `abi_version` incompatible → refus
- [ ] **compiler_tests** : graphe `Objects→Plugin→Output` compile et échantillonne
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
| Boucle infinie dans le plugin | `fuel` wasmtime — budget fini par appel, trap contrôlé |
| Panic/crash plugin | Traps wasmtime — jamais de UB host, position zero + log |
| Allocation hostiles | `plugin_alloc` borné (cap `params_len`, ex. 64 KB) |
| Appel lent (> frame budget) | fuel + timing check, log `plugin-slow` au-delà de ~500 µs |
| I/O depuis le plugin | Pas de WASI — aucun import host exposé en v1 |
| Plugin malveillant | Sandbox wasm = code non fiable sans accès système ; signature/checksum de bundles = phase ultérieure |

## 5. Hors scope (v1 plugins)

- ❌ `kind: "modifier" | "composite"` — ABI v1 = engines purs uniquement
  (un modifier exigerait de passer la closure upstream en mémoire wasm —
  faisable mais ABI v2)
- ❌ Host functions (`log`, `audio`, `osc_in`) — `capabilities` réservé
- ❌ Marketplace / signature / sandboxing renforcé
- ❌ Hot-reload d'un plugin en cours de playback (re-scan = redémarrage
  ou recall de cue)

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
