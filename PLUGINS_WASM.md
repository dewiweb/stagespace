# PLUGINS_WASM.md — Système de plugins WASM pour nodes custom

Branche : `feat/wasm-plugins`
Statut : **Phase 1 livrée** (`3527441`) — runtime host fonctionnel : manifeste,
loader `.ssx`, registry wasmtime (fuel), `PluginEngine`, `NodeType::Plugin`,
wiring validator/compiler/frontend minimal. 14 tests WAT verts.

## Prochaines étapes (ordre recommandé)

1. **Phase 3 — Tauri** : rendre les plugins chargeables dans l'app réelle.
   `AppState.plugin_registry: Arc<PluginRegistry>` construit au boot via
   `scan_dir(<app_data_dir>/plugins/)` ; commands `list_plugins` /
   `reload_plugins` ; events `plugin-error` → toasts ; **tous les call sites
   de compile basculent sur `compile_with_live_inputs`** (`activate_move`,
   `update_global_graph`, `sample_graph`, cue respawn) — sans ça un graphe
   contenant un node Plugin échoue avec "requires a plugin registry" ;
   `#[derive(TS)]` sur `PluginManifest` + `npm run contracts`.
2. **Phase 5 — SDK** : crate `plugin-sdk/` (macro `#[stagespace_plugin]`
   générant les 3 exports + parse params JSON → struct), CLI `stagespace-pack`
   (`module.wasm` + `manifest.json` → `.ssx` + validation), exemple
   `lemniscate` compilé `wasm32-unknown-unknown` — permet de tester la Phase 3
   sur un vrai plugin, pas seulement du WAT.
3. **Phase 4 — Frontend dynamique** : slice `usePluginStore` (fetch au boot +
   reload), palette "Plugins" avec un item par plugin chargé (nom réel +
   `plugin_id` pré-rempli), `NodeParamsPanel` merge
   `PARAM_SCHEMA['Plugin']` + schema du manifeste (`NodeParamField` rend déjà
   tous les types génériquement), label du node = nom du plugin dans
   `CustomNode`.
4. **Phase 6/7** — tests E2E (fixture `.ssx` précompilée committée), docs
   `CONTRIBUTING.md`, section plugins dans `AGENTS.md`.

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
